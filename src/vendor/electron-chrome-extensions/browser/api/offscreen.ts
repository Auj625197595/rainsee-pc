import { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'

import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

const log = (...args: any[]) => console.log('[crx-offscreen]', ...args)
const warn = (...args: any[]) => console.warn('[crx-offscreen]', ...args)

/**
 * Minimum browser-window dimensions. Some Chromium internals refuse to spin up
 * a renderer for a 0x0 window, so keep a tiny but non-zero size; the window is
 * never shown so the footprint is irrelevant.
 */
const HIDDEN_WIDTH = 1
const HIDDEN_HEIGHT = 1
const OFFSCREEN_CONTEXT_TYPE = 'OFFSCREEN_DOCUMENT'
const LEGACY_OFFSCREEN_CONTEXT_TYPE = 'OFFSCREEN'
const CRASH_STREAK_RESET_MS = 5 * 60 * 1000
const CRASH_RETRY_DELAYS_MS = [250, 1000, 5000, 15000, 30000]

/**
 * The documented `chrome.offscreen.Reason` enum. `createDocument` validates each
 * supplied reason against this set and throws "Reason X is not supported" for
 * unknown values, matching Chrome's synchronous validation.
 */
const ALLOWED_REASONS = new Set<string>([
  'AUDIO_PLAYBACK',
  'IFRAME_SCRIPTING',
  'DOM_SCRAPING',
  'BLOBS',
  'DOM_PARSER',
  'USER_MEDIA',
  'DISPLAY_MEDIA',
  'WEB_RTC',
  'CLIPBOARD',
  'LOCAL_STORAGE',
  'WORKERS',
  'BATTERY_STATUS',
  'MATCH_MEDIA',
  'GEOLOCATION',
  'TESTING',
])

interface OffscreenDocument {
  documentId: string
  extensionId: string
  url: string
  /** The hidden window hosting the document's renderer. */
  window: BrowserWindow
}

interface OffscreenCrashRecovery {
  retryAt: number
  crashCount: number
  lastCrashAt: number
  reason: string
  exitCode?: number
}

interface ContextFilter {
  contextIds?: string[]
  contextTypes?: string[]
  documentId?: string
  documentIds?: string[]
  documentOrigins?: string[]
  documentUrls?: string[]
  frameIds?: number[]
  incognito?: boolean
  tabIds?: number[]
  windowIds?: number[]
}

interface OffscreenContext {
  contextId: string
  contextType: string
  documentId: string
  documentOrigin: string
  documentUrl: string
  url: string
  frameId: number
  incognito: boolean
  tabId: number
  windowId: number
}

/**
 * Implements `chrome.offscreen` (MV3).
 *
 * Electron has no native document-loader behind `chrome.offscreen` (it exposes
 * the binding surface but createDocument does not actually load a page), so we
 * load the extension page (e.g. Tampermonkey's `offscreen.html`) as a hidden
 * `BrowserWindow` in the extension session. Because that session has the
 * crx-preload registered (see `prependPreload`), the page automatically gets
 * the full `chrome.*` surface — including `chrome.runtime.onMessage` /
 * `sendMessage`. The page's `runtime.onMessage.addListener(cb)` call registers
 * a `frame`-type listener with the router (host = the document's webContents),
 * which makes it discoverable by `MessagingAPI.runtimeMessageHostsFor`. The
 * background's `chrome.runtime.sendMessage({ target: 'offscreen', ... })` is
 * then delivered to it and its `sendResponse` flows back — no further wiring
 * needed.
 *
 * At most one offscreen document may exist per extension (Chrome constraint).
 */
export class OffscreenAPI {
  /** extensionId -> document. Chrome allows at most one per extension. */
  private docs = new Map<string, OffscreenDocument>()
  /** Deduplicates createDocument and lazy-message opens for the same extension. */
  private opening = new Map<string, Promise<OffscreenDocument>>()
  /**
   * Recreating inside Electron's crash callback can re-enter Chromium teardown.
   * Delay the next requested open with a bounded backoff, but never turn a
   * transient renderer crash into a long-lived extension outage.
   */
  private crashRecovery = new Map<string, OffscreenCrashRecovery>()

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    const opts = { permission: 'offscreen' as chrome.runtime.ManifestPermissions }

    handle('offscreen.createDocument', this.createDocument, opts)
    handle('offscreen.closeDocument', this.closeDocument, opts)
    handle('offscreen.hasDocument', this.hasDocument, opts)
    handle('offscreen.getContexts', this.getContexts, opts)

    // Drop any offscreen document whose extension is unloaded/reloaded.
    const sessionExtensions = this.ctx.session.extensions || this.ctx.session
    sessionExtensions.on('extension-unloaded', (_event: any, extension: Electron.Extension) => {
      this.crashRecovery.delete(extension.id)
      this.destroyFor(extension.id, 'extension-unloaded')
    })

    // `runtime.getContexts` (used by extensions to detect an existing offscreen
    // document after a restart) is backed by the same registry so it stays
    // consistent with createDocument/closeDocument. No permission gate: `runtime`
    // is an implicit/auto-granted permission that extensions never declare, so
    // gating on it would reject the call and make callers (e.g. Tampermonkey)
    // skip createDocument entirely.
    handle('runtime.getContexts', this.runtimeGetContexts)

    this.ctx.offscreen = { ensureDocument: this.ensureDocument }
  }

  /**
   * Electron exposes chrome.offscreen in MV3 workers but can restore its native,
   * loader-less implementation after our preload patch. If such an extension
   * actually sends a message to its conventional offscreen target, lazily load
   * that document before MessagingAPI dispatches the message. Unlike the old
   * startup workaround this has no side effect until the extension uses it.
   */
  private ensureDocument = async (extensionId: string): Promise<boolean> => {
    if (this.docs.has(extensionId)) return true
    const sessionExtensions = this.ctx.session.extensions || this.ctx.session
    const extension = sessionExtensions.getExtension?.(extensionId)
    if (!extension || !extension.manifest?.permissions?.includes('offscreen')) return false
    if (!existsSync(path.join(extension.path, 'offscreen.html'))) return false
    try {
      await this.openDocument(extensionId, this.resolveUrl(extensionId, 'offscreen.html'))
      return true
    } catch (err: any) {
      warn('lazy message-triggered load failed ext=', extensionId, err && err.message)
      return false
    }
  }

  private resolveUrl(extensionId: string, url: string): string {
    const clean = String(url || '').replace(/^\/+/, '')
    return `chrome-extension://${extensionId}/${clean}`
  }

  private async waitForCrashBackoff(extensionId: string): Promise<void> {
    while (true) {
      const crash = this.crashRecovery.get(extensionId)
      if (!crash) return
      const remainingMs = crash.retryAt - Date.now()
      if (remainingMs <= 0) return
      log(
        'waiting before renderer recovery ext=',
        extensionId,
        'remainingMs=',
        remainingMs,
        'crashCount=',
        crash.crashCount,
      )
      await new Promise((resolve) => setTimeout(resolve, remainingMs))
    }
  }

  private recordCrash(extensionId: string, reason: string, exitCode?: number) {
    const now = Date.now()
    const prior = this.crashRecovery.get(extensionId)
    const crashCount =
      prior && now - prior.lastCrashAt < CRASH_STREAK_RESET_MS ? prior.crashCount + 1 : 1
    const delayMs = CRASH_RETRY_DELAYS_MS[Math.min(crashCount - 1, CRASH_RETRY_DELAYS_MS.length - 1)]
    const crash: OffscreenCrashRecovery = {
      retryAt: now + delayMs,
      crashCount,
      lastCrashAt: now,
      reason,
      exitCode,
    }
    this.crashRecovery.set(extensionId, crash)
    return { crash, delayMs }
  }

  /** Deduplicate explicit createDocument calls and lazy crash recovery. */
  private async openDocument(extensionId: string, url: string): Promise<OffscreenDocument> {
    if (this.docs.has(extensionId)) return this.docs.get(extensionId)!
    const pending = this.opening.get(extensionId)
    if (pending) return pending

    const task = (async () => {
      await this.waitForCrashBackoff(extensionId)
      const sessionExtensions = this.ctx.session.extensions || this.ctx.session
      if (!sessionExtensions.getExtension?.(extensionId)) {
        throw new Error('chrome.offscreen extension was unloaded during recovery')
      }
      return this.openDocumentWindow(extensionId, url)
    })()
    this.opening.set(extensionId, task)
    try {
      return await task
    } finally {
      if (this.opening.get(extensionId) === task) this.opening.delete(extensionId)
    }
  }

  /** Core: open the hidden window for a given resolved URL and track it. */
  private async openDocumentWindow(extensionId: string, url: string): Promise<OffscreenDocument> {
    const documentId = randomUUID()
    log('openDocument ext=', extensionId, 'url=', url, 'documentId=', documentId)

    const preloadPath = this.ctx.preloadPath
    const win = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      focusable: false,
      frame: false,
      resizable: false,
      width: HIDDEN_WIDTH,
      height: HIDDEN_HEIGHT,
      webPreferences: {
        session: this.ctx.session,
        // Belt-and-suspenders with the session-registered preload: the session
        // already injects crx-preload for frames, but co-sited/sandboxed
        // renderers can skip it (see popup.ts). Setting it explicitly mirrors
        // PopupView / SidePanelView and guarantees the page gets chrome.*.
        preload: preloadPath,
        sandbox: false,
        contextIsolation: false,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        backgroundThrottling: false,
        javascript: true,
      },
    })

    // Never let this hidden window open real browser tabs from its page.
    win.webContents.setWindowOpenHandler(({ url: openUrl }) => {
      try {
        if (openUrl && openUrl !== 'about:blank') {
          this.ctx.store.impl?.createTab?.({ url: openUrl, active: true } as any)
        }
      } catch {}
      return { action: 'deny' }
    })

    const doc: OffscreenDocument = { documentId, extensionId, url, window: win }
    this.docs.set(extensionId, doc)
    try {
      const preferences = (win.webContents as any).getLastWebPreferences?.()
      log(
        'offscreen webContents created ext=',
        extensionId,
        'documentId=',
        documentId,
        'webContentsId=',
        win.webContents.id,
        'sandbox=',
        preferences?.sandbox,
        'contextIsolation=',
        preferences?.contextIsolation,
        'hasPreload=',
        Boolean(preferences?.preload),
      )
    } catch {
      // Diagnostics must not affect document creation.
    }

    win.webContents.on('did-start-loading', () => {
      log('offscreen did-start-loading ext=', extensionId, 'documentId=', documentId)
    })
    win.webContents.on('dom-ready', () => {
      log('offscreen dom-ready ext=', extensionId, 'documentId=', documentId)
    })
    win.webContents.on('did-finish-load', () => {
      log('offscreen did-finish-load ext=', extensionId, 'documentId=', documentId)
    })
    win.webContents.on(
      'did-fail-load',
      (_event, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => {
        warn(
          'offscreen did-fail-load ext=',
          extensionId,
          'documentId=',
          documentId,
          'isMainFrame=',
          isMainFrame,
          'code=',
          errorCode,
          'description=',
          errorDescription,
          'url=',
          validatedURL,
        )
      },
    )
    win.webContents.on('console-message', (_event, ...args: any[]) => {
      const details =
        args.length > 0 && typeof args[0] === 'object' && args[0] !== null
          ? {
              level: args[0].level,
              message: args[0].message,
              line: args[0].lineNumber,
              sourceId: args[0].sourceId,
            }
          : { level: args[0], message: args[1], line: args[2], sourceId: args[3] }
      const { level, message, line, sourceId } = details
      if (level < 2) return
      warn(
        'offscreen console ext=',
        extensionId,
        'documentId=',
        documentId,
        'level=',
        level,
        'message=',
        message,
        'source=',
        sourceId,
        'line=',
        line,
      )
    })

    // Auto-cleanup if the window dies on its own. Do not call BrowserWindow
    // destroy from the render-process-gone callback: Chromium is still tearing
    // down the renderer there, and synchronous destruction can re-enter that
    // native teardown path. Forget the document immediately, then destroy the
    // window on the next task.
    const handleWindowClosed = () => {
      if (this.docs.get(extensionId) === doc) {
        this.docs.delete(extensionId)
        log('offscreen window closed ext=', extensionId, 'documentId=', documentId)
      }
    }
    win.once('closed', handleWindowClosed)
    win.webContents.once('render-process-gone', (_event, details: any) => {
      if (details?.reason === 'clean-exit') {
        handleWindowClosed()
        return
      }
      const { crash, delayMs } = this.recordCrash(
        extensionId,
        details?.reason || 'unknown',
        details?.exitCode,
      )
      if (this.docs.get(extensionId) === doc) this.docs.delete(extensionId)
      win.removeListener('closed', handleWindowClosed)
      warn(
        'offscreen renderer gone ext=',
        extensionId,
        'documentId=',
        documentId,
        'reason=',
        crash.reason,
        'exitCode=',
        crash.exitCode,
        'retryDelayMs=',
        delayMs,
        'crashCount=',
        crash.crashCount,
      )
      setTimeout(() => {
        try {
          if (!win.isDestroyed()) win.destroy()
        } catch (err: any) {
          warn('deferred destroy failed ext=', extensionId, err && err.message)
        }
      }, 0)
    })

    try {
      await win.webContents.loadURL(url)
    } catch (err: any) {
      warn('openDocument load failed ext=', extensionId, 'url=', url, err && err.message)
      this.destroyFor(extensionId, 'load-failed')
      throw err
    }

    if (this.docs.get(extensionId) !== doc || win.isDestroyed() || win.webContents.isDestroyed()) {
      throw new Error('chrome.offscreen renderer exited during startup')
    }

    // Give the page a tick to register its runtime.onMessage listener. The SW's
    // first message (e.g. Tampermonkey's "config" handshake) races with
    // did-finish-load; a tiny delay here closes that window without a busy-wait.
    await new Promise((r) => setTimeout(r, 0))
    log('openDocument ready ext=', extensionId, 'url=', url)
    return doc
  }

  private createDocument = async (
    event: ExtensionEvent,
    details: { url: string; reasons?: string[]; justification?: string } = { url: '' },
  ): Promise<void> => {
    const extensionId = event.extension.id
    if (!details || !details.url) {
      throw new Error("chrome.offscreen.createDocument: 'url' is required")
    }
    if (typeof details.url !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(details.url)) {
      // Chrome requires a relative path that resolves to a packed page within
      // the calling extension; it rejects absolute / cross-origin URLs
      // synchronously with "must be a relative path" before any load. resolveUrl
      // would otherwise turn "https://evil/x" into a broken
      // "chrome-extension://<id>/https://evil/x" that 404s at load time.
      throw new Error("chrome.offscreen.createDocument: 'url' must be a relative path")
    }
    if (!Array.isArray(details.reasons) || details.reasons.length === 0) {
      throw new Error("chrome.offscreen.createDocument: 'reasons' is required")
    }
    for (const reason of details.reasons) {
      if (!ALLOWED_REASONS.has(reason)) {
        throw new Error(`Reason "${reason}" is not supported.`)
      }
    }
    if (!details.justification || typeof details.justification !== 'string') {
      throw new Error("chrome.offscreen.createDocument: 'justification' is required")
    }
    const existing = this.docs.get(extensionId)
    if (existing) {
      throw new Error('Only a single offscreen document is allowed.')
    }
    const url = this.resolveUrl(extensionId, details.url)
    await this.openDocument(extensionId, url)
  }

  private closeDocument = async (event: ExtensionEvent): Promise<void> => {
    this.destroyFor(event.extension.id, 'closeDocument')
  }

  private hasDocument = async (
    event: ExtensionEvent,
    filter?: { url?: string },
  ): Promise<boolean> => {
    const doc = this.docs.get(event.extension.id)
    if (!doc) return false
    if (filter && typeof filter.url === 'string') {
      return doc.url === this.resolveUrl(event.extension.id, filter.url)
    }
    return true
  }

  private contextMatches(context: OffscreenContext, filter?: ContextFilter): boolean {
    if (
      Array.isArray(filter?.contextIds) &&
      filter!.contextIds.length > 0 &&
      !filter!.contextIds.includes(context.contextId)
    ) {
      return false
    }
    if (
      Array.isArray(filter?.contextTypes) &&
      filter!.contextTypes.length > 0 &&
      !filter!.contextTypes.includes(OFFSCREEN_CONTEXT_TYPE) &&
      !filter!.contextTypes.includes(LEGACY_OFFSCREEN_CONTEXT_TYPE)
    ) {
      return false
    }
    if (filter?.documentId && filter.documentId !== context.documentId) return false
    if (
      Array.isArray(filter?.documentIds) &&
      filter!.documentIds.length > 0 &&
      !filter!.documentIds.includes(context.documentId)
    ) {
      return false
    }
    if (
      Array.isArray(filter?.documentOrigins) &&
      filter!.documentOrigins.length > 0 &&
      !filter!.documentOrigins.includes(context.documentOrigin)
    ) {
      return false
    }
    if (
      Array.isArray(filter?.documentUrls) &&
      filter!.documentUrls.length > 0 &&
      !filter!.documentUrls.includes(context.documentUrl)
    ) {
      return false
    }
    if (
      Array.isArray(filter?.frameIds) &&
      filter!.frameIds.length > 0 &&
      !filter!.frameIds.includes(context.frameId)
    ) {
      return false
    }
    if (typeof filter?.incognito === 'boolean' && filter.incognito !== context.incognito) {
      return false
    }
    if (
      Array.isArray(filter?.tabIds) &&
      filter!.tabIds.length > 0 &&
      !filter!.tabIds.includes(context.tabId)
    ) {
      return false
    }
    if (
      Array.isArray(filter?.windowIds) &&
      filter!.windowIds.length > 0 &&
      !filter!.windowIds.includes(context.windowId)
    ) {
      return false
    }
    return true
  }

  private toContext(doc: OffscreenDocument): OffscreenContext {
    let documentOrigin = ''
    try {
      const parsed = new URL(doc.url)
      documentOrigin =
        parsed.origin === 'null' && parsed.host
          ? `${parsed.protocol}//${parsed.host}`
          : parsed.origin
    } catch {}
    return {
      contextId: doc.documentId,
      contextType: OFFSCREEN_CONTEXT_TYPE,
      documentId: doc.documentId,
      documentOrigin,
      documentUrl: doc.url,
      // Retain `url` for the older internal offscreen.getContexts compatibility
      // surface while runtime.getContexts consumers use Chrome's documentUrl.
      url: doc.url,
      frameId: 0,
      incognito: !this.ctx.session.isPersistent(),
      tabId: -1,
      windowId: -1,
    }
  }

  private getContexts = async (
    event: ExtensionEvent,
    filter?: ContextFilter,
  ): Promise<any[]> => {
    const doc = this.docs.get(event.extension.id)
    if (!doc) return []
    const context = this.toContext(doc)
    return this.contextMatches(context, filter) ? [context] : []
  }

  private runtimeGetContexts = async (
    event: ExtensionEvent,
    filter?: ContextFilter,
  ): Promise<any[]> => {
    const doc = this.docs.get(event.extension.id)
    if (!doc) return []
    const context = this.toContext(doc)
    return this.contextMatches(context, filter) ? [context] : []
  }

  private destroyFor(extensionId: string, reason: string) {
    const doc = this.docs.get(extensionId)
    if (!doc) return
    this.docs.delete(extensionId)
    log('destroy offscreen ext=', extensionId, 'documentId=', doc.documentId, 'reason=', reason)
    try {
      if (!doc.window.isDestroyed()) {
        doc.window.removeAllListeners('closed')
        doc.window.destroy()
      }
    } catch (err: any) {
      warn('destroy failed ext=', extensionId, err && err.message)
    }
  }
}
