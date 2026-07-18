import { BrowserWindow, ipcMain, webContents } from 'electron'
import debug from 'debug'

import { ExtensionContext } from '../context'
import { matchesPattern } from './common'

const d = debug('electron-chrome-extensions:messaging')

// Per-message/-port diagnostic logging is very hot (every runtime/tabs message
// and every port frame passes through it) and mirror-logs synchronously to the
// main log file, measurably slowing IPC — and it prints message contents. Off
// by default; set CRX_VERBOSE=1 to enable. Use `debug` (DEBUG=...) for the
// gated `d()` traces instead.
const CRX_VERBOSE = !!process.env.CRX_VERBOSE
const diag = CRX_VERBOSE
  ? (...args: any[]) => {
      try {
        console.log('[crx-msg]', ...args)
      } catch {}
    }
  : (..._args: any[]) => {}

const diagErr = (err: any) => {
  try {
    return (err && (err.stack || err.message)) || String(err)
  } catch {
    return String(err)
  }
}

const msgBrief = (message: any) => {
  try {
    if (message == null || typeof message !== 'object') return String(message)
    const parts: string[] = []
    const transfer = message.transfer
    if (transfer && typeof transfer === 'object') {
      if (transfer.type != null) parts.push(`transfer.type=${String(transfer.type)}`)
      if (transfer.id != null) parts.push(`transfer.id=${String(transfer.id)}`)
      const data = transfer.data
      if (data && typeof data === 'object') {
        parts.push(`transfer.dataKeys=${Object.keys(data).slice(0, 8).join(',')}`)
        if (typeof data.imageDataUrl === 'string') parts.push(`imageDataUrl.len=${data.imageDataUrl.length}`)
      }
    }
    for (const key of ['id', 'type', 'method', 'name', 'target', 'to', 'from', 'action']) {
      const val = message[key]
      if (val != null && typeof val !== 'object') parts.push(`${key}=${String(val)}`)
    }
    for (const outerKey of ['message', 'payload', 'data']) {
      const inner = message[outerKey]
      if (!inner || typeof inner !== 'object') continue
      for (const key of ['id', 'type', 'method', 'name', 'target', 'to', 'from', 'action']) {
        const val = inner[key]
        if (val != null && typeof val !== 'object') parts.push(`${outerKey}.${key}=${String(val)}`)
      }
    }
    if (parts.length) return parts.join(' ')
    return `keys=${Object.keys(message).slice(0, 8).join(',')}`
  } catch {
    return typeof message
  }
}

const respBrief = (response: any) => {
  try {
    if (response === undefined) return 'undefined'
    if (response === null) return 'null'
    if (typeof response !== 'object') return `${typeof response}:${String(response).slice(0, 80)}`
    if (Array.isArray(response)) return `array(${response.length})`
    const parts = [`object keys=${Object.keys(response).slice(0, 8).join(',')}`]
    if (Array.isArray(response.scripts)) {
      parts.push(`scripts.len=${response.scripts.length}`)
      try {
        parts.push(
          `scripts.ids=${response.scripts
            .slice(0, 5)
            .map((script: any) => script?.name || script?.id || script?.uuid || '?')
            .join(',')}`,
        )
      } catch {}
    }
    if (Array.isArray(response.contexters)) parts.push(`contexters.len=${response.contexters.length}`)
    if (response.injectMode != null) parts.push(`injectMode=${String(response.injectMode)}`)
    if (response.contentMode != null) parts.push(`contentMode=${String(response.contentMode)}`)
    return parts.join(' ')
  } catch {
    return typeof response
  }
}

const frameBrief = (frame?: Electron.WebFrameMain) => {
  if (!frame) return 'none'
  let url = ''
  let isMain = false
  let frameTreeNodeId: any = ''
  try {
    url = frame.url || ''
  } catch {}
  try {
    isMain = frame.parent === null
  } catch {}
  try {
    frameTreeNodeId = (frame as any).frameTreeNodeId
  } catch {}
  return `frameId=${isMain ? 0 : frameTreeNodeId} main=${isMain} url=${url.slice(0, 160)}`
}

/**
 * How long to keep an extension's service worker warm after its last
 * content-script port closes / last one-shot message settles. Mirrors Chrome
 * keeping an event SW alive briefly past its last connection.
 */
const KEEPALIVE_IDLE_MS = 30_000
const WORKER_READY_TIMEOUT_MS = 30_000

/**
 * Implements extension messaging primitives that Electron does not provide:
 *   - chrome.runtime.connect / onConnect       (long-lived Port)
 *   - chrome.runtime.sendMessage / onMessage   (one-shot)
 *   - chrome.tabs.sendMessage                  (background/popup -> content script)
 *
 * Bridges normal web-page frames (where dynamically-registered content scripts
 * run, see scripting.ts + content-bridge.ts) and the extension's MV3 background
 * service worker.
 *
 * Routing surfaces:
 *   - Page frames talk to the main process over the global `ipcMain`.
 *   - Service workers talk over their own `serviceWorker.ipc`. We attach the
 *     same handlers to each extension SW as it starts (mirrors router.ts).
 *
 * Performance: the background SW is resolved through a synchronous cache
 * (`liveWorker`) rather than `startWorkerForScope` per message, and is kept
 * alive with `ServiceWorkerMain.startTask()` while a content-script port is
 * open. Without this the MV3 SW idle-stops between messages and gets
 * cold-restarted (re-evaluating the whole background bundle) on the next one —
 * which made e.g. Tampermonkey extremely slow.
 *
 * onConnect / onMessage are delivered to the SW through the router's existing
 * event mechanism (`sendEvent` -> `crx-${eventName}`), which already knows how
 * to wake a worker and deliver `crx-runtime.onConnect` / `crx-runtime.onMessage`.
 * Per-port message frames use dynamic channels `crx-port-post:<portId>` and
 * `crx-port-disconnect:<portId>`. Extension-page owners that bridge through a
 * tab preload post on explicit owner channels; the router then emits
 * `crx-port-post-to-frame:<portId>` or `crx-port-post-to-owner:<portId>` so
 * same-WebFrame iframe/content pairs do not hear their own messages.
 */
interface PortEntry {
  id: string
  extensionId: string
  /** Page-frame end of the port. */
  frame: Electron.WebFrameMain
  /**
   * Optional extension page/popup frame that opened this tab port. When present,
   * messages from `frame` should be delivered back here, not to the background
   * worker. This covers chrome.tabs.connect() from popup/extension iframes.
   */
  ownerFrame?: Electron.WebFrameMain
  /** True once we've seen the SW accept the connection. */
  swReady: boolean
  /** Messages from the frame buffered until the SW end is ready. */
  pendingToSw: any[]
  /** True while this port is holding a keep-alive ref on its extension's SW. */
  keptAlive?: boolean
  /**
   * MV2 background page webContents, when the background end of this port is a
   * persistent page rather than a service worker. Set in onPortConnect's MV2
   * fallback; deliverToBackground / teardownPort route to it instead of the SW.
   */
  bgHost?: Electron.WebContents
}

interface KeepAliveEntry {
  task: { end: () => void }
  refs: number
  idle?: ReturnType<typeof setTimeout>
}

// ipcMain is process-global, while each browser session needs its own API
// state. Install the IPC endpoints once and route each frame to the API that
// owns its session.
const messagingBySession = new WeakMap<Electron.Session, MessagingAPI>()
let messagingIpcInstalled = false

export class MessagingAPI {
  private ports = new Map<string, PortEntry>()
  private portCounter = 0
  private msgCounter = 0
  /** Pending tabs.sendMessage responses keyed by messageId. */
  private csResponses = new Map<string, (response: any) => void>()
  private attachedWorkers = new WeakSet<any>()

  /** Cache of the live service worker per extension (avoids async lookups). */
  private swByExt = new Map<string, any>()
  /** versionId -> extensionId, so the cache can be evicted when a worker stops. */
  private swVersionToExt = new Map<number, string>()
  /** Keep-alive tasks holding extensions' SWs awake during active messaging. */
  private keepAlive = new Map<string, KeepAliveEntry>()

  constructor(private ctx: ExtensionContext) {
    messagingBySession.set(ctx.session, this)
    if (!messagingIpcInstalled) {
      messagingIpcInstalled = true
      const apiFor = (event: any) => {
        try {
          return messagingBySession.get(event?.sender?.session)
        } catch {
          return undefined
        }
      }

      // Handlers for page-frame originated IPC (global ipcMain).
      ipcMain.handle('crx-port-connect', (event, extensionId, info) =>
        apiFor(event)?.onPortConnect(event, extensionId, info),
      )
      // MV2 background pages emit these channels over the global ipcMain.
      ipcMain.on('crx-port-accept', (event, portId) =>
        apiFor(event)?.onPortAccept(event, portId),
      )
      ipcMain.on('crx-port-post', (event, portId, message) =>
        apiFor(event)?.onPortPost(event, portId, message),
      )
      ipcMain.on('crx-port-post-from-owner', (event, portId, message) =>
        apiFor(event)?.onPortPostFromOwner(event, portId, message),
      )
      ipcMain.on('crx-port-disconnect', (event, portId) =>
        apiFor(event)?.onPortDisconnect(event, portId),
      )
      ipcMain.on('crx-port-disconnect-from-owner', (event, portId) =>
        apiFor(event)?.onPortDisconnectFromOwner(event, portId),
      )
      ipcMain.handle('crx-runtime-message', (event, extensionId, message) =>
        apiFor(event)?.onRuntimeMessage(event, extensionId, message),
      )
      ipcMain.on('crx-cs-message-response', (event, messageId, response) =>
        apiFor(event)?.onCsMessageResponse(event, messageId, response),
      )
      // Relay native storage.onChanged to frames in the sender's session.
      ipcMain.on('crx-storage-changed', (event, extensionId, area, changes) =>
        apiFor(event)?.onStorageChanged(event, extensionId, area, changes),
      )
    }

    // Handlers for service-worker originated IPC. Attach as workers start.
    this.attachWorkerHandlers()
  }

  /** ipcMain path: MV2 background pages are normal webContents, so their
   *  notifyStorageChanged lands on global ipcMain. Every ExtensionContext's
   *  handler fires, so gate on the sender's session. */
  private onStorageChanged = (event: any, extensionId: string, area: string, changes: any) => {
    if (event?.sender && event.sender.session !== this.ctx.session) return
    this.broadcastStorageChanged(extensionId, area, changes)
  }

  /** Relay a storage change to every frame in this session. The content-script
   *  bridge filters by extensionId, so broadcasting broadly is a harmless no-op
   *  in frames that don't host this extension's bridge. */
  private broadcastStorageChanged = (extensionId: string, area: string, changes: any) => {
    const payload = { extensionId, area, changes }
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed() || wc.session !== this.ctx.session) continue
      try {
        // Deliver to every frame (content scripts run in subframes too), not
        // just the main frame that webContents.send targets.
        const frames = [wc.mainFrame, ...(wc.mainFrame?.framesInSubtree || [])]
        const seen = new Set<any>()
        for (const frame of frames) {
          if (!frame || seen.has(frame)) continue
          seen.add(frame)
          try {
            frame.send('crx-storage-changed', payload)
          } catch {
            /* frame gone/unreachable */
          }
        }
      } catch {
        try {
          wc.send('crx-storage-changed', payload)
        } catch {
          /* webContents gone */
        }
      }
    }
  }

  private get swApi(): any {
    return (this.ctx.session as any).serviceWorkers
  }

  // ---- Service worker handlers + cache + keep-alive ------------------------

  /** Attach messaging IPC handlers to extension service workers as they start,
   *  and maintain the live-worker cache from their running status. */
  private attachWorkerHandlers() {
    const swApi = this.swApi
    if (!swApi || typeof swApi.on !== 'function') return

    const attach = (versionId: number) => {
      const sw = swApi.getWorkerFromVersionID?.(versionId)
      if (!sw || this.attachedWorkers.has(sw)) return
      if (!sw.scope?.startsWith('chrome-extension://')) return
      this.attachedWorkers.add(sw)
      try {
        sw.ipc.handle('crx-port-connect', this.onPortConnect)
        sw.ipc.on('crx-port-post', this.onPortPost)
        sw.ipc.on('crx-port-disconnect', this.onPortDisconnect)
        sw.ipc.on('crx-port-accept', this.onPortAccept)
        sw.ipc.handle('crx-runtime-message', this.onRuntimeMessage)
        sw.ipc.on('crx-cs-message-response', this.onCsMessageResponse)
        // MV3: the SW relays native storage.onChanged over sw.ipc (not global
        // ipcMain). This SW is already scoped to our session, so broadcast
        // directly. (_extId from the envelope, not the SW scope.)
        sw.ipc.on(
          'crx-storage-changed',
          (_event: any, extensionId: string, area: string, changes: any) =>
            this.broadcastStorageChanged(extensionId, area, changes),
        )
        d(`attached messaging handlers to SW ${sw.scope}`)
      } catch (err) {
        d(`failed attaching SW handlers: ${err}`)
      }
    }

    swApi.on('running-status-changed', ({ runningStatus, versionId }: any) => {
      if (runningStatus === 'starting') {
        attach(versionId)
      } else if (runningStatus === 'running') {
        attach(versionId)
        this.cacheWorker(versionId)
      } else if (runningStatus === 'stopping' || runningStatus === 'stopped') {
        this.evictWorker(versionId)
      }
    })
  }

  private extIdFromScope(scope?: string): string | undefined {
    const prefix = 'chrome-extension://'
    if (!scope || !scope.startsWith(prefix)) return undefined
    const rest = scope.slice(prefix.length)
    const slash = rest.indexOf('/')
    return slash === -1 ? rest : rest.slice(0, slash)
  }

  private cacheWorker(versionId: number) {
    const sw = this.swApi?.getWorkerFromVersionID?.(versionId)
    if (!sw) return
    const extId = this.extIdFromScope(sw.scope)
    if (!extId) return
    this.swByExt.set(extId, sw)
    this.swVersionToExt.set(versionId, extId)
  }

  private evictWorker(versionId: number) {
    const extId = this.swVersionToExt.get(versionId)
    this.swVersionToExt.delete(versionId)
    if (!extId) return
    const cached = this.swByExt.get(extId)
    // Only evict if the cache still points at this (now-stopped) version.
    if (!cached || cached.isDestroyed?.() || cached.versionId === versionId) {
      this.swByExt.delete(extId)
    }
    // The worker is gone — its keep-alive task is dead. Drop the entry so the
    // next port re-acquires a task on the replacement worker.
    const ka = this.keepAlive.get(extId)
    if (ka) {
      if (ka.idle) clearTimeout(ka.idle)
      this.keepAlive.delete(extId)
    }
  }

  /** Synchronously return the running SW for an extension, if one exists. */
  private liveWorker(extensionId: string): any {
    const cached = this.swByExt.get(extensionId)
    if (cached && !cached.isDestroyed?.()) return cached
    if (cached) this.swByExt.delete(extensionId)

    const scope = this.extensionScope(extensionId)
    try {
      const running = this.swApi?.getAllRunning?.() || {}
      for (const key of Object.keys(running)) {
        const info = running[key]
        if (!info || info.scope !== scope) continue
        const versionId = typeof info.versionId === 'number' ? info.versionId : Number(key)
        const sw = this.swApi.getWorkerFromVersionID?.(versionId)
        if (sw && !sw.isDestroyed?.()) {
          this.swByExt.set(extensionId, sw)
          this.swVersionToExt.set(versionId, extensionId)
          return sw
        }
      }
    } catch (err) {
      d('liveWorker(%s) failed: %o', extensionId, err)
    }
    return undefined
  }

  /** Return the running SW, cold-starting it only if necessary. */
  private async ensureWorker(extensionId: string): Promise<any> {
    const live = this.liveWorker(extensionId)
    if (live) return live
    const scope = this.extensionScope(extensionId)
    d('cold-start SW for %s', extensionId)
    let startError: any
    try {
      await this.swApi.startWorkerForScope(scope)
    } catch (err) {
      // Electron rejects when this scope is already in `starting`. That does
      // not mean startup failed: keep waiting for the existing worker instead
      // of dropping the message that triggered the cold start.
      startError = err
      d('startWorkerForScope(%s) rejected while waiting: %o', extensionId, err)
    }
    // startWorkerForScope can resolve while the worker is still `starting`:
    // its preload + control script haven't evaluated, so no runtime.onMessage
    // listener exists yet and a crx-runtime.onMessage sent now is dropped (the
    // popup gets undefined back and crashes). Wait until the worker is truly
    // `running` before handing it back. Mirrors Chrome, which only delivers a
    // message to a fully-started SW and queues it across the cold start.
    await this.waitWorkerRunning(extensionId)
    const ready = this.liveWorker(extensionId)
    if (ready) return ready
    if (startError) throw startError
    throw new Error(`Timed out waiting for extension service worker: ${extensionId}`)
  }

  /** Resolve once extensionId's SW appears in getAllRunning — i.e. its control
   *  script has evaluated and onMessage listeners are registered — or after
   *  `timeoutMs`. liveWorker updates the cache as a side effect, so callers
   *  re-read it after this resolves. */
  private waitWorkerRunning(
    extensionId: string,
    timeoutMs = WORKER_READY_TIMEOUT_MS,
  ): Promise<void> {
    if (this.liveWorker(extensionId)) return Promise.resolve()
    const started = Date.now()
    const deadline = started + timeoutMs
    return new Promise((resolve) => {
      const tick = () => {
        if (this.liveWorker(extensionId)) {
          d('waitWorkerRunning(%s) ready after %dms', extensionId, Date.now() - started)
          return resolve()
        }
        if (Date.now() >= deadline) {
          d('waitWorkerRunning(%s) TIMED OUT after %dms', extensionId, Date.now() - started)
          return resolve()
        }
        setTimeout(tick, 50)
      }
      tick()
    })
  }

  /** Hold a keep-alive task on the extension's SW (ref-counted). */
  private acquireKeepAlive(extensionId: string) {
    let ka = this.keepAlive.get(extensionId)
    if (!ka) {
      const sw = this.liveWorker(extensionId)
      if (!sw || typeof sw.startTask !== 'function') return
      let task: { end: () => void }
      try {
        task = sw.startTask()
      } catch (err) {
        d('startTask failed for %s: %o', extensionId, err)
        return
      }
      ka = { task, refs: 0 }
      this.keepAlive.set(extensionId, ka)
      d('keep-alive acquired for %s', extensionId)
    }
    if (ka.idle) {
      clearTimeout(ka.idle)
      ka.idle = undefined
    }
    ka.refs++
  }

  /** Release a keep-alive ref; ends the task after an idle debounce. */
  private releaseKeepAlive(extensionId: string) {
    const ka = this.keepAlive.get(extensionId)
    if (!ka) return
    ka.refs = Math.max(0, ka.refs - 1)
    if (ka.refs > 0) return
    if (ka.idle) clearTimeout(ka.idle)
    ka.idle = setTimeout(() => {
      const cur = this.keepAlive.get(extensionId)
      if (!cur || cur.refs > 0) return
      try {
        cur.task.end()
      } catch {}
      this.keepAlive.delete(extensionId)
      d('keep-alive ended for %s', extensionId)
    }, KEEPALIVE_IDLE_MS)
  }

  private extensionScope(extensionId: string) {
    return `chrome-extension://${extensionId}/`
  }

  private senderFrameOf(event: any): Electron.WebFrameMain | undefined {
    // Frame events expose senderFrame; SW events do not.
    return event.senderFrame || undefined
  }

  private senderMainFrameOf(event: any): Electron.WebFrameMain | undefined {
    try {
      return event?.sender?.mainFrame || undefined
    } catch {
      return undefined
    }
  }

  private senderUrlOf(event: any): string {
    try {
      const frameUrl = event?.senderFrame?.url
      if (typeof frameUrl === 'string' && frameUrl) return frameUrl
    } catch {}
    try {
      const wcUrl = event?.sender?.getURL?.()
      if (typeof wcUrl === 'string') return wcUrl
    } catch {}
    return ''
  }

  private isWebContentsLike(sender: any): sender is Electron.WebContents {
    return (
      !!sender &&
      typeof sender.id === 'number' &&
      typeof sender.isDestroyed === 'function' &&
      typeof sender.getURL === 'function' &&
      typeof sender.getType === 'function' &&
      typeof sender.getOwnerBrowserWindow === 'function'
    )
  }

  private isUntrackedExtensionPageSender(event: any, extensionId?: string) {
    if (!extensionId || !event?.sender) return false
    if (this.ctx.store.tabs.has(event.sender)) return false
    const senderUrl = this.senderUrlOf(event)
    if (senderUrl.startsWith(`chrome-extension://${extensionId}/`)) return true
    if (!this.isWebContentsLike(event.sender)) return false

    try {
      const senderWindow = BrowserWindow.fromWebContents(event.sender)
      const parentWindow =
        senderWindow && !senderWindow.isDestroyed() && typeof (senderWindow as any).getParentWindow === 'function'
          ? (senderWindow as any).getParentWindow()
          : undefined
      return !!(parentWindow && !parentWindow.isDestroyed() && this.ctx.store.windows.has(parentWindow))
    } catch {
      return false
    }
  }

  private activeTabForPopupSender(event: any) {
    const sender = event?.sender
    if (!sender) return this.ctx.store.getActiveTabOfCurrentWindow(event)
    if (this.ctx.store.tabs.has(sender)) return undefined

    if (this.isWebContentsLike(sender)) {
      try {
        const senderWindow = BrowserWindow.fromWebContents(sender)
        const parentWindow =
          senderWindow && !senderWindow.isDestroyed() && typeof (senderWindow as any).getParentWindow === 'function'
            ? (senderWindow as any).getParentWindow()
            : undefined
        if (parentWindow && !parentWindow.isDestroyed()) {
          const tab = this.ctx.store.getActiveTabFromWindow(parentWindow)
          if (tab && !tab.isDestroyed()) return tab
        }
      } catch {}
    }

    return this.ctx.store.getActiveTabOfCurrentWindow(event)
  }

  private isPopupAuthoredContentMessage(message: any) {
    try {
      if (!message || typeof message !== 'object') return false
      const from = message.from
      const to = message.to
      return (
        typeof from === 'string' &&
        from.startsWith('popup:') &&
        typeof to === 'string' &&
        to.startsWith('content:')
      )
    } catch {
      return false
    }
  }

  private resolveTabForSender(
    event: any,
    extensionId: string | undefined,
    tabId: number | undefined,
    reason: 'sendMessage' | 'connect',
    message?: any,
  ) {
    const requested = typeof tabId === 'number' ? tabId : undefined
    const requestedTab =
      typeof requested === 'number'
        ? this.ctx.store.getTabById(requested)
        : this.ctx.store.getActiveTabOfCurrentWindow(event)
    if (requestedTab && !requestedTab.isDestroyed()) return requestedTab

    if (
      typeof requested !== 'number' ||
      (!this.isUntrackedExtensionPageSender(event, extensionId) &&
        !this.isPopupAuthoredContentMessage(message))
    ) {
      return undefined
    }

    const fallback = this.activeTabForPopupSender(event)
    if (!fallback || fallback.isDestroyed()) return undefined

    diag(
      `tabs.${reason} stale popup tab ext=${extensionId || ''} requested=${requested} senderWc=${
        event?.sender?.id ?? 'n/a'
      } fallback=${fallback.id} senderUrl=${this.senderUrlOf(event).slice(0, 160)}`,
    )
    return fallback
  }

  /** Build the `sender` object passed to onConnect/onMessage listeners. */
  private buildSender(extensionId: string, frame?: Electron.WebFrameMain) {
    const sender: any = { id: extensionId }
    if (frame) {
      let url = ''
      try {
        url = frame.url
      } catch {}
      sender.url = url
      // Chrome's MessageSender convention: the outermost (main) frame reports
      // frameId 0 and frameType 'outermost_frame'; sub-frames report a non-zero
      // frameId and 'sub_frame'. Electron's frameTreeNodeId is an unrelated
      // internal id (never 0 for the main frame), so extensions that test
      // `frameId === 0` / `frameType === 'outermost_frame'` to detect the top
      // frame (e.g. Tampermonkey) would otherwise treat every page as a
      // restricted sub-frame.
      let isMainFrame = false
      try {
        isMainFrame = frame.parent === null
      } catch {}
      try {
        sender.frameId = isMainFrame ? 0 : frame.frameTreeNodeId
      } catch {}
      sender.frameType = isMainFrame ? 'outermost_frame' : 'sub_frame'
      // Resolve the tab id from the owning WebContents.
      const owner = this.findTabForFrame(frame)
      if (owner) {
        const cached = this.ctx.store.tabDetailsCache.get(owner.id) || {}
        const win = this.ctx.store.tabToWindow.get(owner)
        const winOk = !!(win && !win.isDestroyed())
        sender.tab = {
          ...cached,
          id: owner.id,
          url: cached.url || url,
          index: this.ctx.store.getTabIndex(owner),
          windowId: winOk ? win.id : typeof cached.windowId === 'number' ? cached.windowId : -1,
        }
      }
    }
    return sender
  }

  private findTabForFrame(frame: Electron.WebFrameMain): Electron.WebContents | undefined {
    try {
      let top = frame
      try {
        top = frame.top || frame
      } catch {}
      for (const tab of this.ctx.store.tabs) {
        if (tab.isDestroyed()) continue
        if (tab.mainFrame === frame || tab.mainFrame === top) return tab
      }
    } catch {}
    return undefined
  }

  private findFrameForTab(
    tab: Electron.WebContents,
    frameId?: number,
  ): Electron.WebFrameMain | undefined {
    try {
      if (frameId === undefined || frameId === null || frameId < 0) return tab.mainFrame
      if (frameId === 0) return tab.mainFrame
      const frames = (tab.mainFrame as any).framesInSubtree || []
      for (const frame of frames) {
        if (frame === tab.mainFrame) continue
        if ((frame as any).frameTreeNodeId === frameId) return frame
      }
    } catch {}
    return frameId === undefined || frameId === null || frameId < 0 ? tab.mainFrame : undefined
  }

  private framesForTab(
    tab: Electron.WebContents,
    frameId?: number,
  ): Electron.WebFrameMain[] {
    if (typeof frameId === 'number' && frameId >= 0) {
      const frame = this.findFrameForTab(tab, frameId)
      return frame ? [frame] : []
    }

    const frames: Electron.WebFrameMain[] = []
    const seen = new Set<Electron.WebFrameMain>()
    const add = (frame: Electron.WebFrameMain | undefined) => {
      if (!frame || seen.has(frame)) return
      seen.add(frame)
      frames.push(frame)
    }

    try {
      add(tab.mainFrame)
      const subtree = (tab.mainFrame as any).framesInSubtree || []
      for (const frame of subtree) add(frame)
    } catch {
      add(tab.mainFrame)
    }

    return frames
  }

  private frameMatchesManifestContentScript(
    extension: Electron.Extension | undefined,
    frame: Electron.WebFrameMain,
  ) {
    const scripts = (extension?.manifest as any)?.content_scripts
    if (!Array.isArray(scripts) || scripts.length === 0) return false

    let url = ''
    try {
      url = frame.url || ''
    } catch {}
    if (!url) return false

    let isMainFrame = true
    try {
      isMainFrame = frame.parent === null
    } catch {}

    return scripts.some((script: any) => {
      if (!isMainFrame && !script.all_frames && !script.allFrames) return false

      const matches = Array.isArray(script.matches) ? script.matches : []
      if (!matches.some((pattern: string) => !!matchesPattern(pattern, url))) return false

      const excludes = Array.isArray(script.exclude_matches)
        ? script.exclude_matches
        : Array.isArray(script.excludeMatches)
          ? script.excludeMatches
          : []
      if (excludes.some((pattern: string) => !!matchesPattern(pattern, url))) return false

      return true
    })
  }

  private sendMessageToFrame(
    frame: Electron.WebFrameMain,
    channel: 'crx-cs-message' | 'crx-dynamic-cs-message',
    message: any,
    sender: any,
  ) {
    const messageId = `cs${++this.msgCounter}`
    const started = Date.now()
    diag(
      `send ${messageId} channel=${channel} ext=${sender && sender.id} ${frameBrief(frame)} msg=${msgBrief(message)}`,
    )
    return new Promise((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (r: any) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        this.csResponses.delete(messageId)
        diag(
          `finish ${messageId} channel=${channel} ms=${Date.now() - started} response=${respBrief(r)}`,
        )
        resolve(r)
      }
      this.csResponses.set(messageId, finish)
      timer = setTimeout(() => {
        diag(`timeout ${messageId} channel=${channel} ms=${Date.now() - started}`)
        finish(undefined)
      }, 5000)
      try {
        frame.send(channel, messageId, message, sender)
      } catch (err) {
        diag(`frame.send failed ${messageId} channel=${channel} err=${diagErr(err)}`)
        finish(undefined)
      }
    })
  }

  // ---- Port: frame -> SW connect ------------------------------------------

  private onPortConnect = async (event: any, extensionId: string, info: { name?: string }) => {
    const frame = this.senderFrameOf(event)
    if (!frame) {
      d('port connect from non-frame sender ignored')
      return ''
    }
    const portId = `p${++this.portCounter}`
    const entry: PortEntry = {
      id: portId,
      extensionId,
      frame,
      swReady: false,
      pendingToSw: [],
    }
    this.ports.set(portId, entry)

    const sender = this.buildSender(extensionId, frame)

    // Clean up if the frame's WebContents is destroyed.
    const ownerWc = this.findTabForFrame(frame)
    ownerWc?.once('destroyed', () => this.teardownPort(portId, 'frame'))

    // Deliver onConnect directly to the background end (a content-script port
    // connects to the background, not to other hosts like an open popup — so we
    // target the worker/page rather than router.sendEvent, which would broadcast
    // to every listener and cause duplicate accepts).
    //
    // Resolution order: (1) a live MV3 SW already running; (2) an MV2 persistent
    // background page; (3) MV3 SW cold-start. The MV2 page is checked before
    // cold-starting so an MV2 extension (which has no SW scope) never pays for a
    // startWorkerForScope round-trip that cannot succeed.
    const liveSw = this.liveWorker(extensionId)
    diag(`onPortConnect ext=${extensionId} name=${info?.name || ''} liveSw=${!!liveSw}`)
    if (liveSw) {
      try {
        liveSw.send('crx-runtime.onConnect', { portId, name: info?.name || '', sender })
        this.acquireKeepAlive(extensionId)
        entry.keptAlive = true
        d(`port ${portId} connect (name=${info?.name}) ext=${extensionId}`)
        return portId
      } catch (err) {
        d(`deliver onConnect to live SW failed for ${extensionId}: ${err}`)
      }
    }

    const bg = this.ctx.router.backgroundHostFor(extensionId)
    let _bgUrl = ''
    try {
      if (bg) _bgUrl = bg.getURL()
    } catch {}
    diag(`onPortConnect bgPage=${!!bg} destroyed=${bg ? bg.isDestroyed() : false} url=${_bgUrl}`)
    if (bg && !bg.isDestroyed()) {
      entry.bgHost = bg
      bg.once('destroyed', () => this.teardownPort(portId, 'frame'))
      try {
        bg.send('crx-runtime.onConnect', { portId, name: info?.name || '', sender })
      } catch (err) {
        d(`failed to deliver onConnect to bgPage for ${extensionId}: ${err}`)
        this.ports.delete(portId)
        return ''
      }
      d(`port ${portId} connect (name=${info?.name}) ext=${extensionId} [MV2 bgPage]`)
      return portId
    }

    try {
      const sw = await this.ensureWorker(extensionId)
      sw.send('crx-runtime.onConnect', { portId, name: info?.name || '', sender })
      this.acquireKeepAlive(extensionId)
      entry.keptAlive = true
      d(`port ${portId} connect (name=${info?.name}) ext=${extensionId} [SW cold-start]`)
      return portId
    } catch (err) {
      d(`failed to deliver onConnect (no live SW, no MV2 bgPage) for ${extensionId}: ${err}`)
      this.ports.delete(portId)
      return ''
    }
  }

  /** SW signals it has set up its end of the port. Flush buffered messages. */
  private onPortAccept = (_event: any, portId: string) => {
    const entry = this.ports.get(portId)
    if (!entry) return
    entry.swReady = true
    const pending = entry.pendingToSw
    entry.pendingToSw = []
    for (const msg of pending) this.deliverToBackground(entry, msg)
  }

  private onPortPost = (event: any, portId: string, message: any) => {
    const _c = Array.isArray(message) ? message[0] : (message && typeof message === 'object' ? 'obj:' + Object.keys(message).slice(0, 4).join(',') : typeof message)
    const _extra = Array.isArray(message) && message[0] === 11 ? ` W=${message[5]} frame=${message[4]} M=${message[1]}` : ''
    diag(`onPortPost portId=${portId} case=${_c}${_extra} len=${Array.isArray(message) ? message.length : ''}`)
    const entry = this.ports.get(portId)
    if (!entry) {
      diag(`onPortPost no entry portId=${portId}`)
      return
    }
    const sourceFrame = this.senderFrameOf(event)
    if (sourceFrame && entry.ownerFrame) {
      const target = sourceFrame === entry.frame ? entry.ownerFrame : entry.frame
      const channel =
        target === entry.ownerFrame
          ? `crx-port-post-to-owner:${portId}`
          : `crx-port-post-to-frame:${portId}`
      try {
        diag(
          `port frame->owner port=${portId} target=${frameBrief(target)} msg=${msgBrief(message)}`,
        )
        target.send(channel, message)
      } catch (err) {
        d(`deliver to frame peer failed for ${portId}: ${err}`)
      }
    } else if (sourceFrame && sourceFrame === entry.frame) {
      // content frame -> background (MV3 SW or MV2 bgPage)
      diag(`port frame->bg port=${portId} swReady=${entry.swReady} bgHost=${!!entry.bgHost}`)
      if (!entry.swReady) entry.pendingToSw.push(message)
      else this.deliverToBackground(entry, message)
    } else {
      // background (SW with no sourceFrame, or MV2 bgPage whose frame !== entry.frame) -> content frame
      try {
        const channel = entry.ownerFrame
          ? `crx-port-post-to-frame:${portId}`
          : `crx-port-post:${portId}`
        diag(`port sw->frame port=${portId} target=${frameBrief(entry.frame)} msg=${msgBrief(message)}`)
        entry.frame.send(channel, message)
      } catch (err) {
        d(`deliver to frame failed for ${portId}: ${err}`)
      }
    }
  }

  private onPortPostFromOwner = (_event: any, portId: string, message: any) => {
    const entry = this.ports.get(portId)
    if (!entry) return
    if (!entry.ownerFrame) {
      this.onPortPost(_event, portId, message)
      return
    }
    try {
      diag(`port owner->frame port=${portId} target=${frameBrief(entry.frame)} msg=${msgBrief(message)}`)
      entry.frame.send(`crx-port-post-to-frame:${portId}`, message)
    } catch (err) {
      d(`deliver owner message to frame failed for ${portId}: ${err}`)
    }
  }

  private deliverToBackground(entry: PortEntry, message: any) {
    // MV2 persistent background page: deliver directly to its webContents.
    if (entry.bgHost && !entry.bgHost.isDestroyed()) {
      try {
        entry.bgHost.send(`crx-port-post:${entry.id}`, message)
      } catch (err) {
        d(`deliver to bgPage failed for ${entry.id}: ${err}`)
      }
      return
    }
    // MV3 service worker: kept alive while the port is open, so it is normally
    // resolvable synchronously — no per-message `startWorkerForScope`.
    const sw = this.liveWorker(entry.extensionId)
    if (sw) {
      try {
        sw.send(`crx-port-post:${entry.id}`, message)
        return
      } catch (err) {
        d(`deliver to SW (live) failed for ${entry.id}: ${err}`)
      }
    }
    // Rare fallback: worker not currently resolvable — cold-start once.
    this.ensureWorker(entry.extensionId)
      .then((w) => w.send(`crx-port-post:${entry.id}`, message))
      .catch((err) => d(`deliver to SW failed for ${entry.id}: ${err}`))
  }

  private onPortDisconnect = (event: any, portId: string) => {
    const frame = this.senderFrameOf(event)
    const from = frame ? 'frame' : 'sw'
    this.teardownPort(portId, from)
  }

  private onPortDisconnectFromOwner = (_event: any, portId: string) => {
    this.teardownPort(portId, 'sw')
  }

  private teardownPort(portId: string, from: 'frame' | 'sw') {
    const entry = this.ports.get(portId)
    if (!entry) return
    this.ports.delete(portId)
    if (from === 'frame') {
      if (entry.ownerFrame) {
        try {
          entry.ownerFrame.send(`crx-port-disconnect:${portId}`)
        } catch {}
        try {
          entry.frame.send(`crx-port-disconnect:${portId}`)
        } catch {}
      } else {
        // Notify the background end if it's alive — MV2 bgPage or a live SW.
        // (No point cold-starting a SW just to tell it a port closed.)
        if (entry.bgHost && !entry.bgHost.isDestroyed()) {
          try {
            entry.bgHost.send(`crx-port-disconnect:${portId}`)
          } catch {}
        } else {
          const sw = this.liveWorker(entry.extensionId)
          if (sw) {
            try {
              sw.send(`crx-port-disconnect:${portId}`)
            } catch {}
          }
        }
      }
    } else {
      // Notify frame end.
      try {
        entry.frame.send(`crx-port-disconnect:${portId}`)
      } catch {}
      if (entry.ownerFrame) {
        try {
          entry.ownerFrame.send(`crx-port-disconnect:${portId}`)
        } catch {}
      }
    }
    if (entry.keptAlive) {
      entry.keptAlive = false
      this.releaseKeepAlive(entry.extensionId)
    }
    d(`port ${portId} disconnected (from ${from})`)
  }

  // ---- One-shot: runtime.sendMessage --------------------------------------

  private onRuntimeMessage = async (event: any, extensionId: string, message: any) => {
    const frame = this.senderFrameOf(event)
    const sender = this.buildSender(extensionId, frame)
    if (event?.type === 'service-worker') {
      return this.dispatchRuntimeMessageFromBackground(event, extensionId, message, sender)
    }
    // Resolve the receiving end with the same order onPortConnect uses: (1) a
    // live MV3 SW; (2) an MV2 persistent background page; (3) MV3 SW cold-start.
    // Without the MV2 fallback, a content script's one-shot runtime.sendMessage
    // to an MV2 extension (e.g. Dark Reader's "cs-bg-document-connect" frame
    // registration) routes only through ensureWorker, which knows solely about
    // SWs — for an MV2 extension startWorkerForScope is a no-op (skipped at
    // load), so the message is dropped, the background's TabManager.tabs is
    // never populated, canAccessTab() returns false, and the popup reports
    // every page as "protected" (isInjected=false). The MV2 page is checked
    // before cold-start so an MV2 extension never pays for a startWorkerForScope
    // round-trip that cannot succeed. acquireKeepAlive is a safe no-op for MV2
    // (no SW → liveWorker() undefined → early return).
    let sw: any = this.liveWorker(extensionId)
    if (!sw) {
      const bg = this.ctx.router.backgroundHostFor(extensionId)
      if (bg && !bg.isDestroyed()) {
        sw = bg
      }
    }
    if (!sw) {
      try {
        sw = await this.ensureWorker(extensionId)
      } catch (err) {
        d(`onRuntimeMessage: failed to resolve worker for ${extensionId}: ${err}`)
        return undefined
      }
    }
    // Keep the SW warm across a burst of one-shot messages so it doesn't
    // idle-stop and cold-restart between calls. (No-op for MV2 background
    // pages, which have no SW task to keep alive.)
    this.acquireKeepAlive(extensionId)
    try {
      return await this.requestResponse(sw, extensionId, message, sender)
    } finally {
      this.releaseKeepAlive(extensionId)
    }
  }

  private requestResponse(
    sw: any,
    extensionId: string,
    message: any,
    sender: any,
    timeoutMs = 5000,
  ): Promise<any> {
    const messageId = `m${++this.msgCounter}`
    return new Promise((resolve) => {
      let settled = false
      const finish = (r: any) => {
        if (settled) return
        settled = true
        this.csResponses.delete(messageId)
        resolve(r)
      }
      this.csResponses.set(messageId, finish)
      // Timeout so a missing listener doesn't hang the invoke.
      setTimeout(() => finish(undefined), timeoutMs)
      try {
        sw.send('crx-runtime.onMessage', { messageId, message, sender })
      } catch (err) {
        d(`failed to deliver onMessage to worker for ${extensionId}: ${err}`)
        finish(undefined)
      }
    })
  }

  private async dispatchRuntimeMessageFromBackground(
    event: any,
    extensionId: string,
    message: any,
    sender: any,
  ): Promise<any> {
    const extension = event?.extension
    const attempts: Array<Promise<any>> = []

    // Electron's native chrome.offscreen surface can reappear after the preload
    // patch but has no document loader. Wait for the permission/file-gated lazy
    // fallback before enumerating frame listeners, otherwise the first config
    // message sees no offscreen host and Tampermonkey aborts script install.
    if (message && message.target === 'offscreen') {
      await this.ctx.offscreen?.ensureDocument(extensionId)

      // Prefer the normal preload-backed request/response bridge whenever the
      // offscreen page registered one. The hidden page is an extension host,
      // but other open extension pages may be hosts too, so target only the
      // conventional offscreen document instead of broadcasting this private
      // request to every popup/options page.
      const offscreenHosts = this.runtimeMessageHostsFor(extensionId).filter((host) => {
        try {
          return new URL(host.getURL?.() || '').pathname === '/offscreen.html'
        } catch {
          return false
        }
      })
      if (offscreenHosts.length > 0) {
        const offscreenAttempts = offscreenHosts.map((host) =>
          this.sendRuntimeMessageToHost(host, message, sender),
        )
        return offscreenAttempts.length === 1
          ? offscreenAttempts[0]
          : this.resolveFirstDefined(offscreenAttempts)
      }

      // A sandboxed offscreen BrowserWindow can lose crx-preload entirely.
      // Send a private request back to the source SW; the source shim relays it
      // over the native `crx-page-listen:offscreen` Port and keeps the normal
      // runtime.sendMessage response callback alive until the page answers.
      return this.requestResponse(
        event.serviceWorker || this.liveWorker(extensionId),
        extensionId,
        { __crxOffscreenRelay: true, message, sender },
        sender,
        30000,
      )
    }

    const hosts = this.runtimeMessageHostsFor(extensionId)
    const deliveries = this.runtimeContentScriptDeliveries(extension, extensionId)

    for (const host of hosts) {
      attempts.push(this.sendRuntimeMessageToHost(host, message, sender))
    }

    for (const delivery of deliveries) {
      attempts.push(this.sendMessageToFrame(delivery.frame, delivery.channel, message, sender))
    }

    // Sandboxed extension pages (popup/options co-sited with the running MV3 SW)
    // skip crx-preload entirely, so runtimeMessageHostsFor never sees them and
    // host.send can't reach them (no ipcRenderer bridge in the main world). Such
    // pages open a long-lived 'crx-page-listen' Port to the SW (SHIM; native
    // connect survives the sandbox). Fan this broadcast out as a 'crx-page-
    // broadcast' event and the SW's SHIM forwards it onto every saved Port,
    // dispatching the captured onMessage listeners (__crxPageOnMsg). This is the
    // only runtime channel into a sandboxed popup — executeJavaScript Promise
    // hangs there, and native MV3 SW→popup doesn't deliver.
    try {
      this.ctx.router.sendEvent(extensionId, 'crx-page-broadcast', { message, sender })
    } catch {
      // best-effort — sendEvent throws if no SW listener registered yet
    }

    if (attempts.length === 0) return Promise.resolve(undefined)
    if (attempts.length === 1) return attempts[0]
    return this.resolveFirstDefined(attempts)
  }

  private runtimeMessageHostsFor(extensionId: string): Electron.WebContents[] {
    const eventListeners = (this.ctx.router as any)?.listeners?.get?.('runtime.onMessage')
    if (!Array.isArray(eventListeners) || eventListeners.length === 0) return []

    const hosts: Electron.WebContents[] = []
    const seen = new Set<Electron.WebContents>()
    for (const listener of eventListeners) {
      if (!listener || listener.type !== 'frame' || listener.extensionId !== extensionId) continue
      const host = listener.host
      if (!host || seen.has(host)) continue
      try {
        if (host.isDestroyed()) continue
      } catch {}

      let url = ''
      try {
        url = host.getURL?.() || ''
      } catch {}
      if (!url.startsWith(`chrome-extension://${extensionId}/`)) continue

      seen.add(host)
      hosts.push(host)
    }
    return hosts
  }

  private runtimeContentScriptDeliveries(
    extension: Electron.Extension | undefined,
    extensionId: string,
  ): Array<{
    frame: Electron.WebFrameMain
    channel: 'crx-cs-message' | 'crx-dynamic-cs-message'
  }> {
    const deliveries: Array<{
      frame: Electron.WebFrameMain
      channel: 'crx-cs-message' | 'crx-dynamic-cs-message'
    }> = []
    const seen = new Set<string>()

    for (const tab of this.ctx.store.tabs) {
      if (tab.isDestroyed()) continue
      for (const frame of this.framesForTab(tab)) {
        const hasDynamicReceiver = this.ctx.dynamicContentScripts.has(extensionId, frame)
        const hasManifestReceiver = this.frameMatchesManifestContentScript(extension, frame)
        const routes: Array<'crx-cs-message' | 'crx-dynamic-cs-message'> = []
        if (hasDynamicReceiver) routes.push('crx-dynamic-cs-message')
        if (hasManifestReceiver) routes.push('crx-cs-message')
        for (const channel of routes) {
          let key = channel
          try {
            key = `${channel}:${tab.id}:${frame === tab.mainFrame ? 0 : (frame as any).frameTreeNodeId}`
          } catch {}
          if (seen.has(key)) continue
          seen.add(key)
          deliveries.push({ frame, channel })
        }
      }
    }

    return deliveries
  }

  private sendRuntimeMessageToHost(
    host: Electron.WebContents,
    message: any,
    sender: any,
  ): Promise<any> {
    const messageId = `m${++this.msgCounter}`
    const started = Date.now()
    let hostUrl = ''
    try {
      hostUrl = host.getURL?.() || ''
    } catch {}
    diag(
      `send ${messageId} channel=crx-runtime.onMessage ext=${sender && sender.id} host=${
        host.id
      } url=${hostUrl.slice(0, 160)} msg=${msgBrief(message)}`,
    )
    return new Promise((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (r: any) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        this.csResponses.delete(messageId)
        diag(
          `finish ${messageId} channel=crx-runtime.onMessage ms=${
            Date.now() - started
          } response=${respBrief(r)}`,
        )
        resolve(r)
      }
      this.csResponses.set(messageId, finish)
      timer = setTimeout(() => {
        diag(`timeout ${messageId} channel=crx-runtime.onMessage ms=${Date.now() - started}`)
        finish(undefined)
      }, 5000)
      try {
        host.send('crx-runtime.onMessage', { messageId, message, sender })
      } catch (err) {
        diag(`host.send failed ${messageId} channel=crx-runtime.onMessage err=${diagErr(err)}`)
        finish(undefined)
      }
    })
  }

  private resolveFirstDefined(attempts: Array<Promise<any>>): Promise<any> {
    return new Promise((resolve) => {
      let settled = false
      let pending = attempts.length
      const finish = (r: any) => {
        if (settled) return
        pending--
        if (r !== undefined) {
          settled = true
          resolve(r)
        } else if (pending <= 0) {
          settled = true
          resolve(undefined)
        }
      }
      attempts.forEach((attempt) => attempt.then(finish, () => finish(undefined)))
    })
  }

  private onCsMessageResponse = (_event: any, messageId: string, response: any) => {
    const cb = this.csResponses.get(messageId)
    diag(`response ipc ${messageId} found=${!!cb} response=${respBrief(response)}`)
    if (cb) cb(response)
  }

  // ---- tabs.sendMessage: background/popup -> content script ---------------

  /** Registered as the 'tabs.sendMessage' API handler (see index.ts wiring). */
  sendMessageToTab = (
    event: any,
    tabId: number | undefined,
    message: any,
    options?: { frameId?: number },
  ): Promise<any> => {
    const extensionId = event?.extension?.id
    diag(
      `tabs.sendMessage enter ext=${extensionId || ''} tabId=${
        typeof tabId === 'number' ? tabId : 'current'
      } options=${JSON.stringify(options || {})} msg=${msgBrief(message)}`,
    )
    const tab = this.resolveTabForSender(event, extensionId, tabId, 'sendMessage', message)
    if (!tab || tab.isDestroyed()) {
      diag(
        `tabs.sendMessage no tab ext=${extensionId || ''} requested=${
          typeof tabId === 'number' ? tabId : 'current'
        } senderWc=${event?.sender?.id ?? 'n/a'} senderUrl=${this.senderUrlOf(event).slice(0, 160)}`,
      )
      return Promise.resolve(undefined)
    }
    if (!extensionId) {
      diag(`tabs.sendMessage no extension id tab=${tab.id}`)
      return Promise.resolve(undefined)
    }

    const targetFrames = this.framesForTab(tab, options?.frameId)
    if (targetFrames.length === 0) {
      diag(`tabs.sendMessage no frame ext=${extensionId} tab=${tab.id} frameId=${options?.frameId}`)
      return Promise.resolve(undefined)
    }

    const deliveries: Array<{
      frame: Electron.WebFrameMain
      channel: 'crx-cs-message' | 'crx-dynamic-cs-message'
    }> = []
    for (const frame of targetFrames) {
      const hasDynamicReceiver = this.ctx.dynamicContentScripts.has(extensionId, frame)
      const hasManifestReceiver = this.frameMatchesManifestContentScript(event?.extension, frame)
      const routes: Array<'crx-cs-message' | 'crx-dynamic-cs-message'> = []
      if (hasDynamicReceiver) routes.push('crx-dynamic-cs-message')
      if (hasManifestReceiver) routes.push('crx-cs-message')
      diag(
        `tabs.sendMessage candidate ext=${extensionId} tab=${tab.id} target=${frameBrief(
          frame,
        )} dynamic=${hasDynamicReceiver} manifest=${hasManifestReceiver} routes=${
          routes.join(',') || 'none'
        }`,
      )
      for (const channel of routes) deliveries.push({ frame, channel })
    }

    if (deliveries.length === 0) {
      deliveries.push({ frame: targetFrames[0], channel: 'crx-cs-message' })
      diag(
        `tabs.sendMessage fallback ext=${extensionId} tab=${tab.id} target=${frameBrief(
          targetFrames[0],
        )}`,
      )
    }

    const sender = this.buildSender(extensionId, this.senderFrameOf(event))
    const attempts = deliveries.map(({ frame, channel }) =>
      this.sendMessageToFrame(frame, channel, message, sender),
    )
    if (attempts.length === 1) return attempts[0]

    return this.resolveFirstDefined(attempts)
  }

  // ---- tabs.connect: background/popup -> content script (long-lived Port) --

  /**
   * Registered as the 'tabs.connect' API handler. Opens a long-lived Port from
   * the caller (background SW / popup / options page) to a content script.
   *
   * Reuses the frame<->SW Port machinery: the content script is the "frame"
   * end of the PortEntry and the caller is the "SW" end. onPortPost/onPortDisconnect
   * route by whether the sender is a frame, so:
   *   - caller posts (from SW/popup-ipc) -> delivered to entry.frame (the CS)
   *   - CS posts (from its frame ipc)    -> delivered to the SW (caller)
   *
   * LIMITATION: when the caller is a popup/options PAGE (a frame, not the SW),
   * the CS->caller direction routes to the SW instead of the popup, because the
   * hub keys direction off "is the sender a frame". The dominant tabs.connect
   * caller is the background SW, for which routing is exact.
   */
  connectToTab = (
    event: any,
    tabId: number | undefined,
    info: { name?: string; frameId?: number; __crxOwnerFrameBridge?: boolean },
  ): string => {
    const tab = this.resolveTabForSender(event, event?.extension?.id, tabId, 'connect')
    if (!tab || tab.isDestroyed()) return ''
    const portId = `p${++this.portCounter}`
    const targetFrame = this.findFrameForTab(tab, info?.frameId)
    if (!targetFrame) return ''
    const ownerFrame =
      this.senderFrameOf(event) ||
      (info?.__crxOwnerFrameBridge ? this.senderMainFrameOf(event) || tab.mainFrame : undefined)
    const hasOwnerFrame = !!(
      ownerFrame &&
      (ownerFrame !== targetFrame || info?.__crxOwnerFrameBridge)
    )
    const entry: PortEntry = {
      id: portId,
      extensionId: event.extension.id,
      frame: targetFrame,
      ownerFrame: hasOwnerFrame ? ownerFrame : undefined,
      // The caller (extension context) is already alive. For popup/extension
      // iframe callers the ownerFrame is the far end; for SW callers the SW end
      // is ready immediately.
      swReady: true,
      pendingToSw: [],
    }
    this.ports.set(portId, entry)

    // For an MV2 persistent background-page caller (no SW), record the bg page
    // as this port's background host — mirroring onPortConnect. The MV2 bg page
    // is not a resolvable framework "frame", so ownerFrame stays undefined and a
    // content→bg echo routes through deliverToBackground; without bgHost set it
    // would fall through to a (nonexistent) SW and be silently dropped, making
    // the bg.tabs.connect Port appear to time out. Harmless for MV3 (no bg page)
    // and when ownerFrame is set (the line-793 directional path takes precedence).
    if (!this.liveWorker(event.extension.id)) {
      const bg = this.ctx.router.backgroundHostFor(event.extension.id)
      if (bg && !bg.isDestroyed()) {
        entry.bgHost = bg
        bg.once('destroyed', () => this.teardownPort(portId, 'frame'))
      }
    }

    const sender = this.buildSender(event.extension.id, this.senderFrameOf(event))

    // Tear down if the tab is destroyed mid-connection.
    tab.once('destroyed', () => this.teardownPort(portId, 'frame'))
    if (hasOwnerFrame) {
      const ownerTab = this.findTabForFrame(ownerFrame!)
      ownerTab?.once('destroyed', () => this.teardownPort(portId, 'frame'))
    }

    try {
      targetFrame.send('crx-runtime.onConnect', {
        portId,
        name: info?.name || '',
        sender,
      })
    } catch (err) {
      d(`connectToTab: failed to deliver onConnect to tab ${tabId}: ${err}`)
      this.ports.delete(portId)
      return ''
    }

    this.acquireKeepAlive(event.extension.id)
    entry.keptAlive = true

    diag(
      `tabs.connect port=${portId} ext=${event.extension.id} tab=${
        typeof tabId === 'number' ? tabId : 'current'
      } name=${info?.name || ''} frameId=${info?.frameId ?? 'auto'} owner=${frameBrief(
        ownerFrame,
      )} target=${frameBrief(targetFrame)} ownerBridge=${!!info?.__crxOwnerFrameBridge}`,
    )
    d(`tabs.connect port ${portId} (name=${info?.name}) ext=${event.extension.id} tab=${tabId}`)
    return portId
  }
}
