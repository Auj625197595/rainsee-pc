import { webContents as electronWebContents } from 'electron'
import { randomUUID } from 'node:crypto'

import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

const log = (...args: any[]) => console.log('[crx-capture]', ...args)

/**
 * chrome.desktopCapture + chrome.tabCapture (MV3 and MV2).
 *
 * Chrome hands extensions an opaque stream id which any document of the same
 * extension later passes to getUserMedia({ mandatory: { chromeMediaSource:
 * 'desktop' | 'tab', chromeMediaSourceId } }). Electron has neither API, and
 * its closest primitive (WebContents.getMediaSourceId) is bound to ONE
 * consumer WebContents and expires after ~10s. MV3 extensions typically mint
 * the id in the service worker and consume it in an offscreen document that
 * may not exist yet, so the consumer is unknown at mint time.
 *
 * We therefore issue our own opaque ids (`crx-desktop:` / `crx-tab:`). The
 * renderer wraps navigator.mediaDevices.getUserMedia in extension pages and
 * resolves those ids here at consume time, against the real consumer frame:
 * desktop ids map to the desktopCapturer source the user picked, tab ids are
 * turned into WebContents.getMediaSourceId(consumer). Ids are scoped to the
 * issuing extension, mirroring Chrome.
 *
 * Resolving an id also records a short-lived grant for the consumer
 * WebContents so the host permission handler can allow the follow-up media
 * request without a second prompt (Chrome treats the stream id itself as the
 * user's consent; offscreen documents cannot show a prompt at all).
 */

const STREAM_ID_TTL_MS = 60_000
const GRANT_TTL_MS = 10_000

const DESKTOP_PREFIX = 'crx-desktop:'
const TAB_PREFIX = 'crx-tab:'

interface IssuedStream {
  extensionId: string
  kind: 'desktop' | 'tab'
  expires: number
  /** desktop: desktopCapturer source id ("screen:0:0" / "window:123:0"). */
  sourceId?: string
  /** desktop: whether the user agreed to share system audio. */
  audio?: boolean
  /** tab: the captured tab. */
  targetWebContentsId?: number
  /** tab: Chrome's consumerTabId restriction, when given. */
  consumerWebContentsId?: number
}

export interface DesktopMediaChoice {
  id: string
  name: string
  shareAudio: boolean
}

/** WebContents id -> expiry of a capture grant produced by resolveStreamId. */
const captureGrants = new Map<number, number>()

/**
 * True when `webContentsId` resolved an extension capture stream id within
 * the last few seconds. The host permission handler uses this to allow the
 * resulting getUserMedia media request without prompting.
 */
export function hasRecentCaptureGrant(webContentsId: number): boolean {
  const expires = captureGrants.get(webContentsId)
  if (!expires) return false
  if (expires < Date.now()) {
    captureGrants.delete(webContentsId)
    return false
  }
  return true
}

export class CaptureAPI {
  private streams = new Map<string, IssuedStream>()
  /** `${extensionId}:${requestId}` of the chooser currently on screen. */
  private activeChooser: string | null = null

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('desktopCapture.chooseDesktopMedia', this.chooseDesktopMedia, {
      permission: 'desktopCapture',
    })
    handle('desktopCapture.cancelChooseDesktopMedia', this.cancelChooseDesktopMedia, {
      permission: 'desktopCapture',
    })
    handle('tabCapture.getMediaStreamId', this.getMediaStreamId, {
      permission: 'tabCapture',
    })
    handle('tabCapture.getCapturedTabs', this.getCapturedTabs, {
      permission: 'tabCapture',
    })
    // Called from the getUserMedia wrapper. Ownership is checked against the
    // issuing extension, so no separate manifest permission gate.
    handle('capture.resolveStreamId', this.resolveStreamId)

    const sessionExtensions = this.ctx.session.extensions || this.ctx.session
    sessionExtensions.on('extension-unloaded', (_event: any, extension: Electron.Extension) => {
      for (const [id, stream] of this.streams) {
        if (stream.extensionId === extension.id) this.streams.delete(id)
      }
    })
  }

  private prune() {
    const now = Date.now()
    for (const [id, stream] of this.streams) {
      if (stream.expires < now) this.streams.delete(id)
    }
  }

  private issue(stream: Omit<IssuedStream, 'expires'>): string {
    this.prune()
    const prefix = stream.kind === 'desktop' ? DESKTOP_PREFIX : TAB_PREFIX
    const id = `${prefix}${randomUUID()}`
    this.streams.set(id, { ...stream, expires: Date.now() + STREAM_ID_TTL_MS })
    return id
  }

  /** Resolve a Chrome tab id to its WebContents (host ids may be remapped). */
  private tabWebContents(tabId: number): Electron.WebContents | undefined {
    const direct = this.ctx.store.getTabById(tabId)
    if (direct) return direct
    const resolve = this.ctx.store.impl.resolveTabId
    if (typeof resolve !== 'function') return undefined
    for (const tab of this.ctx.store.tabs) {
      if (!tab.isDestroyed() && resolve(tab.id) === tabId) return tab
    }
    return undefined
  }

  private chooseDesktopMedia = async (
    event: ExtensionEvent,
    requestId: number,
    sources?: string[],
    targetTab?: { id?: number },
  ): Promise<{ streamId: string; canRequestAudioTrack: boolean }> => {
    const empty = { streamId: '', canRequestAudioTrack: false }
    const choose = this.ctx.store.impl.chooseDesktopMedia
    if (typeof choose !== 'function') return empty

    const extension = event.extension
    let tabId: number | undefined
    if (targetTab && typeof targetTab.id === 'number') {
      tabId = targetTab.id
    } else if (event.type === 'frame' && this.ctx.store.tabs.has(event.sender)) {
      tabId = this.ctx.store.impl.resolveTabId?.(event.sender.id) ?? event.sender.id
    }

    const key = `${extension.id}:${requestId}`
    this.activeChooser = key
    let choice: DesktopMediaChoice | null = null
    try {
      choice = await choose({
        extensionId: extension.id,
        extensionName: extension.name,
        sources: Array.isArray(sources) ? sources : ['screen', 'window'],
        tabId,
      })
    } finally {
      if (this.activeChooser === key) this.activeChooser = null
    }
    if (!choice) {
      log('chooseDesktopMedia cancelled ext=', extension.id)
      return empty
    }

    const wantsAudio = Array.isArray(sources) && sources.includes('audio')
    const audio = wantsAudio && choice.shareAudio === true
    const streamId = this.issue({
      extensionId: extension.id,
      kind: 'desktop',
      sourceId: choice.id,
      audio,
    })
    log('chooseDesktopMedia ext=', extension.id, 'source=', choice.id, 'audio=', audio)
    return { streamId, canRequestAudioTrack: audio }
  }

  private cancelChooseDesktopMedia = (event: ExtensionEvent, requestId: number) => {
    const key = `${event.extension.id}:${requestId}`
    if (this.activeChooser !== key) return
    this.activeChooser = null
    this.ctx.store.impl.cancelChooseDesktopMedia?.()
  }

  private getMediaStreamId = (
    event: ExtensionEvent,
    options: { targetTabId?: number; consumerTabId?: number } = {},
  ): string => {
    const target =
      typeof options?.targetTabId === 'number'
        ? this.tabWebContents(options.targetTabId)
        : this.ctx.store.getActiveTabOfCurrentWindow(event)
    if (!target || target.isDestroyed()) {
      throw new Error(
        typeof options?.targetTabId === 'number'
          ? `No tab with id: ${options.targetTabId}.`
          : 'Error starting tab capture',
      )
    }

    let consumerWebContentsId: number | undefined
    if (typeof options?.consumerTabId === 'number') {
      const consumer = this.tabWebContents(options.consumerTabId)
      if (!consumer) throw new Error(`No tab with id: ${options.consumerTabId}.`)
      consumerWebContentsId = consumer.id
    }

    const streamId = this.issue({
      extensionId: event.extension.id,
      kind: 'tab',
      targetWebContentsId: target.id,
      consumerWebContentsId,
    })
    log('tabCapture.getMediaStreamId ext=', event.extension.id, 'target=', target.id)
    return streamId
  }

  private getCapturedTabs = (): chrome.tabCapture.CaptureInfo[] => []

  /**
   * Pages that lost crx-preload (sandboxed / offscreen renderers) reach these
   * handlers through the SHIM's SW API proxy, so the event sender is the
   * worker. Locate the consuming page by its URL among the extension's own
   * WebContents; only the issuing extension's pages can match.
   */
  private findExtensionPage(extensionId: string, url?: string): Electron.WebContents | undefined {
    if (typeof url !== 'string' || !url.startsWith(`chrome-extension://${extensionId}/`)) {
      return undefined
    }
    const strip = (u: string) => u.split('#')[0]
    return electronWebContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && strip(wc.getURL()) === strip(url))
  }

  private resolveStreamId = (
    event: ExtensionEvent,
    streamId: string,
    consumerUrl?: string,
  ): { kind: 'desktop' | 'tab'; sourceId: string; audio: boolean } => {
    this.prune()
    const stream = typeof streamId === 'string' ? this.streams.get(streamId) : undefined
    if (!stream || stream.extensionId !== event.extension.id) {
      throw new Error('Invalid state')
    }
    const consumer =
      event.type === 'frame' ? event.sender : this.findExtensionPage(event.extension.id, consumerUrl)
    if (!consumer) {
      throw new Error('getUserMedia is not available in this context')
    }
    if (
      typeof stream.consumerWebContentsId === 'number' &&
      stream.consumerWebContentsId !== consumer.id
    ) {
      throw new Error('Invalid state')
    }

    let sourceId: string
    let audio: boolean
    if (stream.kind === 'desktop') {
      sourceId = stream.sourceId!
      audio = stream.audio === true
    } else {
      const target = electronWebContents.fromId(stream.targetWebContentsId!)
      if (!target || target.isDestroyed()) throw new Error('Invalid state')
      sourceId = target.getMediaSourceId(consumer)
      audio = true
    }

    captureGrants.set(consumer.id, Date.now() + GRANT_TTL_MS)
    // Chromium attributes a tab-capture media request to the CAPTURED tab
    // (securityOrigin = the extension), so grant that WebContents too.
    if (stream.kind === 'tab' && typeof stream.targetWebContentsId === 'number') {
      captureGrants.set(stream.targetWebContentsId, Date.now() + GRANT_TTL_MS)
    }
    return { kind: stream.kind, sourceId, audio }
  }
}
