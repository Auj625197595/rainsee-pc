import { BrowserWindow, ipcMain, webContents } from 'electron'
import debug from 'debug'

import { ExtensionContext } from '../context'
import { sendToLiveFrame, sendToLiveMainFrame } from '../safe-send'
import { matchesPattern } from './common'

const d = debug('electron-chrome-extensions:messaging')

// Per-message/-port diagnostic logging is very hot (every runtime/tabs message
// and every port frame passes through it) and mirror-logs synchronously to the
// main log file, measurably slowing IPC — and it prints message contents. Off
// by default; set CRX_VERBOSE=1 to enable. Use `debug` (DEBUG=...) for the
// gated `d()` traces instead.
const CRX_VERBOSE = process.env.CRX_VERBOSE === '1'
const CRX_PERF = process.env.CRX_PERF === '1' || CRX_VERBOSE
const diag = CRX_VERBOSE
  ? (...args: any[]) => {
      try {
        console.log('[crx-msg]', ...args)
      } catch {}
    }
  : (..._args: any[]) => {}

const workerDiagIds = new WeakMap<object, number>()
let nextWorkerDiagId = 0
const workerDiagId = (worker: any): string => {
  if (!worker || (typeof worker !== 'object' && typeof worker !== 'function')) return '-'
  let id = workerDiagIds.get(worker)
  if (!id) {
    id = ++nextWorkerDiagId
    workerDiagIds.set(worker, id)
  }
  return `w${id}`
}

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
    if (response.errorcode != null) parts.push(`errorcode=${String(response.errorcode)}`)
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

export const framePathFromTop = (frame?: Electron.WebFrameMain): number[] | undefined => {
  if (!frame) return undefined
  const path: number[] = []
  const seen = new Set<Electron.WebFrameMain>()
  let current: Electron.WebFrameMain | null = frame
  try {
    while (current && current.parent) {
      if (seen.has(current)) return undefined
      seen.add(current)
      const parent = current.parent
      const index = parent.frames.indexOf(current)
      if (index < 0) return undefined
      path.unshift(index)
      current = parent
    }
    return current ? path : undefined
  } catch {
    return undefined
  }
}

export const resolveFramePath = (
  mainFrame: Electron.WebFrameMain | undefined,
  path: unknown,
): Electron.WebFrameMain | undefined => {
  if (!mainFrame || !Array.isArray(path) || path.length > 64) return undefined
  let current = mainFrame
  try {
    for (const index of path) {
      if (!Number.isInteger(index) || index < 0) return undefined
      const next = current.frames[index]
      if (!next) return undefined
      current = next
    }
    return current
  } catch {
    return undefined
  }
}

/**
 * How long to keep an extension's service worker warm after its last
 * content-script port closes / last one-shot message settles. Mirrors Chrome
 * keeping an event SW alive briefly past its last connection.
 */
const KEEPALIVE_IDLE_MS = 30_000
const WORKER_READY_TIMEOUT_MS = 30_000
const PORT_ACCEPT_TIMEOUT_MS = 3_000
const WORKER_PULL_IDLE_TIMEOUT_MS = 2_000
const WORKER_PULL_PORT_TIMEOUT_MS = 30_000
const WORKER_INBOUND_PROTOCOL = 3
const WEB_REQUEST_WORKER_GRACE_MS = 8000
const webRequestGrace = new WeakMap<any, { task: any; timer: ReturnType<typeof setTimeout> }>()
const isMediaWebRequestChannel = (channel: string, args: any[]) =>
  channel.startsWith('crx-webRequest.') &&
  (args[0]?.type === 'media' ||
    args[0]?.type === 'object' ||
    /\.(?:m3u8|mpd|mp4|webm|ts)(?:$|[?#])/i.test(args[0]?.url || ''))
const PORT_ACCEPT_MAX_ATTEMPTS = 3
// External messages commonly proxy native-host operations (signing, hardware
// tokens, user confirmation, etc.). Chrome keeps a `return true` message
// channel open for the asynchronous response; a short transport timeout makes
// otherwise-valid operations fail under normal latency. Keep a long safety
// bound only to prevent a broken listener from leaking the IPC request and SW
// keep-alive forever.
const EXTERNAL_MESSAGE_RESPONSE_TIMEOUT_MS = 5 * 60_000

/**
 * Some enterprise sites select a store-specific extension id from their
 * browser-brand branch. Bank of Communications currently asks for the Chrome
 * Web Store id even when the installed CFCA package is the Microsoft Edge
 * Add-ons build. Both packages are the same BCM bridge, but their signing keys
 * (and therefore ids) differ.
 *
 * Keep this deliberately narrow: an alias is accepted only when the expected
 * installed id exists and its manifest identity matches. The normal
 * externally_connectable origin gate is still applied to the resolved target.
 */
const EXTERNAL_EXTENSION_ID_ALIASES: Record<string, { targetId: string; manifestName: string }> = {
  ecbgehmicnopimcfcklikjihlgiemmpl: {
    targetId: 'klkahbiiopldhaabkgfpnanafeiggnmi',
    manifestName: 'CFCA SecEditCtl.BCM Extension',
  },
}

// Autofill diagnostics intentionally log only protocol metadata. Never log
// message bodies because fill scripts can contain usernames/passwords.
const isAutofillDiagnosticMessage = (message: any): boolean => {
  if (!CRX_VERBOSE) return false
  const command = message && typeof message === 'object' ? message.command : undefined
  return (
    typeof command === 'string' &&
    /^(fillForm|triggerAutoSubmitLogin|collectPageDetails|collectPageDetailsResponse|bgCollectPageDetails|triggerAutofillScriptInjection|ignoreFieldFocus)$/.test(
      command,
    )
  )
}

const autofillDiag = (...args: any[]) => {
  try {
    console.warn('[crx-autofill]', ...args)
  } catch {}
}

const safeAutofillUrl = (value: any): string => {
  const raw = typeof value === 'string' ? value : ''
  if (!raw) return ''
  try {
    const url = new URL(raw)
    return `${url.origin}${url.pathname}`
  } catch {
    return raw.split(/[?#]/, 1)[0]
  }
}

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
  /** Inbound connection metadata retained until the SW acknowledges the Port. */
  connect?: {
    eventName: string
    name: string
    sender: any
    attempts: number
    timer?: ReturnType<typeof setTimeout>
    result: Promise<boolean>
    settle: (accepted: boolean) => void
  }
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

interface WorkerReadiness {
  versionId: number
  worker: any
  running: boolean
  bridgeReady: boolean
  details?: any
  inboundProtocol?: number
  inboundQueue?: Array<{channel: string; args: any[]}>
  inboundWakePending?: boolean
  inboundPull?: {
    resolve: (packet: {channel: string; args: any[]} | null) => void
    timer?: ReturnType<typeof setTimeout>
  }
}

interface MessagePerfEntry {
  extensionId: string
  direction: string
  count: number
  approxBytes: number
}

const approxMessageBytes = (message: any): number => {
  if (message == null) return 0
  if (typeof message === 'string') return message.length * 2
  if (typeof message === 'number' || typeof message === 'boolean') return 8
  if (ArrayBuffer.isView(message)) return message.byteLength
  if (message instanceof ArrayBuffer) return message.byteLength
  if (Array.isArray(message)) return 16 + message.length * 8
  if (typeof message !== 'object') return 0
  let bytes = 16
  for (const key of Object.keys(message).slice(0, 32)) {
    bytes += key.length * 2 + 8
    const value = message[key]
    if (typeof value === 'string') bytes += value.length * 2
  }
  return bytes
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
  /** The readiness object whose private IPC channels are bound for each SW generation. */
  private workerHandlerGenerations = new Map<string, WorkerReadiness>()

  /** Cache of the live service worker per extension (avoids async lookups). */
  private swByExt = new Map<string, any>()
  /** versionId -> extensionId, so the cache can be evicted when a worker stops. */
  private swVersionToExt = new Map<number, string>()
  /** Keep-alive tasks holding extensions' SWs awake during active messaging. */
  private keepAlive = new Map<string, KeepAliveEntry>()
  /** Hosted API readiness is scoped to a concrete worker generation. */
  private workerReadiness = new Map<string, WorkerReadiness>()
  /** Coalesce concurrent events onto one MV3 cold-start/readiness operation. */
  private workerStartup = new Map<string, Promise<any>>()
  private messagePerfStartedAt = Date.now()
  private messagePerf = new Map<string, MessagePerfEntry>()

  private recordMessagePerf(extensionId: string, direction: string, message?: any) {
    if (!CRX_PERF) return
    const key = `${extensionId}:${direction}`
    const value = this.messagePerf.get(key) || {
      extensionId,
      direction,
      count: 0,
      approxBytes: 0,
    }
    value.count++
    value.approxBytes += approxMessageBytes(message)
    this.messagePerf.set(key, value)

    const now = Date.now()
    if (now - this.messagePerfStartedAt < 10000) return
    const summaries = Array.from(this.messagePerf.values()).map(
      (item) => `ext=${item.extensionId} ${item.direction}=${item.count}/${item.approxBytes}B`,
    )
    if (summaries.length > 0) {
      console.log(`[crx-perf][messages] windowMs=${now - this.messagePerfStartedAt} ${summaries.join(' | ')}`)
    }
    this.messagePerf.clear()
    this.messagePerfStartedAt = now
  }

  constructor(private ctx: ExtensionContext) {
    this.ctx.messaging = this
    this.ctx.router.setServiceWorkerResolver((extensionId) => this.ensureWorker(extensionId))
    this.ctx.router.setServiceWorkerSender?.((extensionId, worker, channel, ...args) =>
      this.sendToWorker(extensionId, worker, channel, ...args),
    )
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
      ipcMain.handle('crx-port-connect-from-frame', (event, framePath, extensionId, info) => {
        const api = apiFor(event)
        const frameEvent = api?.eventForFramePath(event, framePath)
        return frameEvent ? api?.onPortConnect(frameEvent, extensionId, info) : ''
      })
      // MV2 background pages emit these channels over the global ipcMain.
      ipcMain.on('crx-port-accept', (event, portId) => apiFor(event)?.onPortAccept(event, portId))
      ipcMain.on('crx-port-reject', (event, portId, reason) =>
        apiFor(event)?.onPortReject(event, portId, reason),
      )
      ipcMain.on('crx-port-post', (event, portId, message) => apiFor(event)?.onPortPost(event, portId, message))
      ipcMain.on('crx-port-post-from-frame', (event, framePath, portId, message) => {
        const api = apiFor(event)
        const frameEvent = api?.eventForFramePath(event, framePath)
        if (frameEvent) api?.onPortPost(frameEvent, portId, message)
      })
      ipcMain.on('crx-port-post-from-owner', (event, portId, message) =>
        apiFor(event)?.onPortPostFromOwner(event, portId, message),
      )
      ipcMain.on('crx-port-disconnect', (event, portId) => apiFor(event)?.onPortDisconnect(event, portId))
      ipcMain.on('crx-port-disconnect-from-frame', (event, framePath, portId) => {
        const api = apiFor(event)
        const frameEvent = api?.eventForFramePath(event, framePath)
        if (frameEvent) api?.onPortDisconnect(frameEvent, portId)
      })
      ipcMain.on('crx-port-disconnect-from-owner', (event, portId) =>
        apiFor(event)?.onPortDisconnectFromOwner(event, portId),
      )
      ipcMain.handle('crx-runtime-message', (event, extensionId, message) =>
        apiFor(event)?.onRuntimeMessage(event, extensionId, message),
      )
      ipcMain.handle('crx-runtime-message-from-frame', (event, framePath, extensionId, message) => {
        const api = apiFor(event)
        const frameEvent = api?.eventForFramePath(event, framePath)
        return frameEvent ? api?.onRuntimeMessage(frameEvent, extensionId, message) : undefined
      })
      // Externally-connectable web-page -> extension messaging. A page on a
      // origin listed in the target extension's manifest
      // `externally_connectable.matches` calls chrome.runtime.sendMessage(id, msg)
      // (injected into the page main world by view-preload). Main validates the
      // origin, then delivers to the SW's runtime.onMessageExternal — Chrome's
      // documented externally_connectable surface (banking tokens / DRM / native
      // bridges that expose a page API, e.g. CFCA SecEditCtl.BCM).
      ipcMain.handle('crx-runtime-message-external', (event, extensionId, message) =>
        apiFor(event)?.onRuntimeMessageExternal(event, extensionId, message),
      )
      ipcMain.handle('crx-port-connect-external', (event, extensionId, info) =>
        apiFor(event)?.onPortConnectExternal(event, extensionId, info),
      )
      ipcMain.on('crx-cs-message-response', (event, messageId, response) =>
        apiFor(event)?.onCsMessageResponse(event, messageId, response),
      )
      // Relay native storage.onChanged to frames in the sender's session.
      ipcMain.on('crx-storage-changed', (event, extensionId, area, changes) =>
        apiFor(event)?.onStorageChanged(event, extensionId, area, changes),
      )
      // Fallback for Electron builds that route service-worker IPC through the
      // process-global ipcMain rather than ServiceWorkerMain.ipc.
      ipcMain.on('crx-worker-ready', (event: any, details: any) => {
        const api = apiFor(event) || messagingBySession.get(event?.session)
        const worker = event?.serviceWorker
        if (api && worker) {
          api.markServiceWorkerReady(
            worker,
            details,
          )
        }
      })
    }

    // Handlers for service-worker originated IPC. Attach as workers start.
    this.attachWorkerHandlers()

    const sessionExtensions = ctx.session.extensions || ctx.session
    sessionExtensions.on?.('extension-unloaded', (_event: any, extension: Electron.Extension) => {
      const extensionId = extension.id
      const readiness = this.workerReadiness.get(extensionId)
      this.resolveInboundPull(readiness)
      this.workerReadiness.delete(extensionId)
      this.workerHandlerGenerations.delete(extensionId)
      this.workerStartup.delete(extensionId)
      this.swByExt.delete(extensionId)
      const keepAlive = this.keepAlive.get(extensionId)
      if (keepAlive?.idle) clearTimeout(keepAlive.idle)
      try {
        keepAlive?.task.end()
      } catch {}
      this.keepAlive.delete(extensionId)
      for (const [portId, entry] of Array.from(this.ports)) {
        if (entry.extensionId === extensionId) this.teardownPort(portId, 'sw')
      }
    })
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
            sendToLiveFrame(frame, 'crx-storage-changed', payload)
          } catch {
            /* frame gone/unreachable */
          }
        }
      } catch {
        try {
          sendToLiveMainFrame(wc, 'crx-storage-changed', payload)
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
      if (!sw) return
      if (!sw.scope?.startsWith('chrome-extension://')) return
      const extId = this.extIdFromScope(sw.scope)
      const generation = extId ? this.workerReadiness.get(extId) : undefined
      if (!extId || !generation || generation.versionId !== versionId) return
      if (this.workerHandlerGenerations.get(extId) === generation) {
        // `starting` can expose the worker wrapper before its preload has
        // registered private IPC listeners. Probe again when the lifecycle
        // advances to `running` even though the handlers are already bound.
        try {
          ;(generation.worker || sw).send('crx-worker-wake')
        } catch {}
        return
      }
      diag(`worker attach version=${versionId} worker=${workerDiagId(sw)}`)
      try {
        // ServiceWorkerMain wrappers and versionIds can both be reused after a
        // stop/start. The underlying IPC endpoint is lifetime-scoped, so bind
        // our private channels once per readiness generation, not once per JS
        // wrapper. Clear only channels owned by this bridge before rebinding.
        for (const channel of [
          'crx-port-connect',
          'crx-worker-next-event',
          'crx-runtime-message',
        ]) {
          sw.ipc.removeHandler?.(channel)
        }
        for (const channel of [
          'crx-port-post',
          'crx-port-disconnect',
          'crx-port-accept',
          'crx-port-reject',
          'crx-cs-message-response',
          'crx-worker-ready',
          'crx-storage-changed',
        ]) {
          sw.ipc.removeAllListeners?.(channel)
        }
        sw.ipc.handle('crx-port-connect', this.onPortConnect)
        sw.ipc.on('crx-port-post', this.onPortPost)
        sw.ipc.on('crx-port-disconnect', this.onPortDisconnect)
        sw.ipc.on('crx-port-accept', this.onPortAccept)
        sw.ipc.on('crx-port-reject', this.onPortReject)
        sw.ipc.handle('crx-worker-next-event', this.onWorkerNextEvent)
        sw.ipc.handle('crx-runtime-message', this.onRuntimeMessage)
        sw.ipc.on('crx-cs-message-response', this.onCsMessageResponse)
        sw.ipc.on('crx-worker-ready', (event: any, details: any) => {
          diag(
            `worker ready-ipc version=${versionId} attached=${workerDiagId(sw)} event=${workerDiagId(event?.serviceWorker)}`,
          )
          this.markServiceWorkerReady(
            event?.serviceWorker || sw,
            details,
            sw,
          )
        })
        // MV3: the SW relays native storage.onChanged over sw.ipc (not global
        // ipcMain). This SW is already scoped to our session, so broadcast
        // directly. (_extId from the envelope, not the SW scope.)
        sw.ipc.on('crx-storage-changed', (_event: any, extensionId: string, area: string, changes: any) =>
          this.broadcastStorageChanged(extensionId, area, changes),
        )
        this.workerHandlerGenerations.set(extId, generation)
        d(`attached messaging handlers to SW ${sw.scope}`)
        // The preload may have announced readiness before Electron exposed
        // the running worker wrapper and before this listener was attached.
        // Reuse the private wake channel as an idempotent readiness probe so
        // every running generation gets one handshake after binding.
        try {
          ;(generation.worker || sw).send('crx-worker-wake')
        } catch {
          // The worker can stop between getWorkerFromVersionID and send;
          // lifecycle events will retry binding for the replacement.
        }
      } catch (err) {
        d(`failed attaching SW handlers: ${err}`)
      }
    }

    swApi.on('running-status-changed', ({ runningStatus, versionId }: any) => {
      diag(`worker status=${runningStatus} version=${versionId}`)
      if (runningStatus === 'starting') {
        this.beginWorkerGeneration(versionId, false)
        attach(versionId)
      } else if (runningStatus === 'running') {
        this.beginWorkerGeneration(versionId, true)
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
    const observed = this.swApi?.getWorkerFromVersionID?.(versionId)
    if (!observed) return
    const extId = this.extIdFromScope(observed.scope)
    if (!extId) return
    const readiness = this.workerReadiness.get(extId)
    // Electron may return a new JS wrapper for the same ServiceWorkerMain
    // version. The wrapper which emitted crx-worker-ready owns the live preload
    // IPC endpoint, so it is the canonical object for this generation.
    const sw =
      readiness?.versionId === versionId &&
      readiness.worker?.scope === observed.scope
        ? readiness.worker
        : observed
    diag(
      `worker cache version=${versionId} observed=${workerDiagId(observed)} canonical=${workerDiagId(sw)}`,
    )
    this.swByExt.set(extId, sw)
    this.swVersionToExt.set(versionId, extId)
  }

  private beginWorkerGeneration(versionId: number, running: boolean) {
    const sw = this.swApi?.getWorkerFromVersionID?.(versionId)
    if (!sw) return
    const extId = this.extIdFromScope(sw.scope)
    if (!extId) return
    const current = this.workerReadiness.get(extId)
    diag(
      `worker generation version=${versionId} running=${running} observed=${workerDiagId(sw)} current=${workerDiagId(current?.worker)}`,
    )
    // Electron reuses a service-worker registration's versionId across many
    // stop/start lifetimes. Every `starting` event begins a fresh bridge
    // generation even when the numeric version is unchanged.
    if (!current || current.versionId !== versionId || !running) {
      this.resolveInboundPull(current)
      this.workerReadiness.set(extId, {
        versionId,
        worker: sw,
        running,
        bridgeReady: false,
        inboundQueue: [],
      })
      return
    }
    current.running = true
    this.swByExt.set(extId, current.worker)
    this.swVersionToExt.set(versionId, extId)
  }

  public markServiceWorkerReady(
    serviceWorker: any,
    details?: any,
    sourceWorker?: any,
  ) {
    const extId = this.extIdFromScope(serviceWorker?.scope)
    const versionId = Number(serviceWorker?.versionId)
    if (!extId || !Number.isFinite(versionId)) return
    const running = this.swApi?.getAllRunning?.() || {}
    const liveInfo = running[versionId]
    const current = this.workerReadiness.get(extId)
    diag(
      `worker mark-ready version=${versionId} worker=${workerDiagId(serviceWorker)} current=${workerDiagId(current?.worker)} protocol=${details?.protocol}`,
    )
    if (current && current.versionId !== versionId) return
    // The ready event is delivered through the `sw.ipc` listener registered
    // for this version. Electron may return a different JS wrapper from
    // getWorkerFromVersionID on each call, so wrapper identity is not a valid
    // generation check. The source wrapper's version/scope is the stable
    // boundary; stale generations are still rejected by versionId above.
    if (sourceWorker && !this.isSameWorkerRegistration(sourceWorker, serviceWorker)) return
    // A registration can reuse versionId across stop/start lifetimes. Once a
    // generation has accepted its bridge, a late ready signal from an older
    // ServiceWorkerMain wrapper must not replace the canonical worker.
    if (current?.bridgeReady && current.worker !== serviceWorker) return
    // The preload can finish while Electron still reports the worker as
    // `starting`. Preserve that exact-version ready signal; the subsequent
    // running-status event flips `running`, while readyWorker() continues to
    // require liveWorker() and therefore cannot deliver to a starting worker.
    // Dropping the early signal left a fully running worker permanently marked
    // bridgeReady=false until it was restarted.
    if (liveInfo && liveInfo.scope !== serviceWorker.scope) return
    if (!current && !liveInfo) return
    if (current) {
      current.worker = serviceWorker
      current.running = current.running || !!liveInfo
      current.bridgeReady = true
      current.details = details
      current.inboundProtocol = Number(details?.protocol) || 0
      current.inboundQueue ||= []
    } else {
      this.workerReadiness.set(extId, {
        versionId,
        worker: serviceWorker,
        running: true,
        bridgeReady: true,
        details,
        inboundProtocol: Number(details?.protocol) || 0,
        inboundQueue: [],
      })
    }
    this.swByExt.set(extId, serviceWorker)
    this.swVersionToExt.set(versionId, extId)
    d('worker bridge ready ext=%s versionId=%d', extId, versionId)
  }

  private evictWorker(versionId: number) {
    const extId = this.swVersionToExt.get(versionId)
    this.swVersionToExt.delete(versionId)
    if (!extId) return
    const readiness = this.workerReadiness.get(extId)
    this.resolveInboundPull(readiness)
    this.workerHandlerGenerations.delete(extId)
    if (readiness?.versionId === versionId) this.workerReadiness.delete(extId)
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
    // A Port is bound to one service-worker lifetime. Chrome disconnects the
    // other end when that context disappears; carrying the id into a replacement
    // worker would create a Port that the new worker never accepted.
    for (const [portId, entry] of Array.from(this.ports)) {
      if (entry.extensionId === extId && !entry.bgHost) this.teardownPort(portId, 'sw')
    }
  }

  /** Synchronously return the running SW for an extension, if one exists. */
  private liveWorker(extensionId: string): any {
    const cached = this.swByExt.get(extensionId)
    // running-status-changed is the lifecycle authority. ServiceWorkerMain's
    // isDestroyed() can transiently report true immediately after `running`;
    // treating that as stopped causes a second startWorkerForScope call and a
    // restart loop. evictWorker clears this cache on stopping/stopped.
    if (cached) return cached

    const scope = this.extensionScope(extensionId)
    try {
      const running = this.swApi?.getAllRunning?.() || {}
      for (const key of Object.keys(running)) {
        const info = running[key]
        if (!info || info.scope !== scope) continue
        const versionId = typeof info.versionId === 'number' ? info.versionId : Number(key)
        const readiness = this.workerReadiness.get(extensionId)
        const sw =
          readiness?.versionId === versionId && readiness.worker?.scope === scope
            ? readiness.worker
            : this.swApi.getWorkerFromVersionID?.(versionId)
        if (sw) {
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

  private readyWorker(extensionId: string): any {
    const sw = this.liveWorker(extensionId)
    if (!sw) return undefined
    const ready = this.workerReadiness.get(extensionId)
    return ready?.running && ready.bridgeReady && ready.versionId === sw.versionId
      ? ready.worker
      : undefined
  }

  private isSameWorkerRegistration(left: any, right: any): boolean {
    if (!left || !right) return false
    return (
      Number(left.versionId) === Number(right.versionId) &&
      left.scope === right.scope
    )
  }

  private sendToWorker(extensionId: string, worker: any, channel: string, ...args: any[]) {
    // webRequest listeners commonly start a follow-up async API call
    // (Cat Catch calls tabs.get before writing its media cache). The pull
    // protocol ends its transport task as soon as the packet is read, which
    // can let MV3 suspend the worker before that callback resolves. Keep a
    // bounded task alive for network events only; unrelated extension events
    // retain the normal idle lifecycle.
    if (isMediaWebRequestChannel(channel, args) && typeof worker?.startTask === 'function') {
      try {
        const existing = webRequestGrace.get(worker)
        if (existing) {
          clearTimeout(existing.timer)
          existing.timer = setTimeout(() => {
            webRequestGrace.delete(worker)
            try { existing.task?.end?.() } catch {}
          }, WEB_REQUEST_WORKER_GRACE_MS)
          existing.timer.unref?.()
        } else {
          const task = worker.startTask()
          const timer = setTimeout(() => {
            webRequestGrace.delete(worker)
            try { task?.end?.() } catch {}
          }, WEB_REQUEST_WORKER_GRACE_MS)
          timer.unref?.()
          webRequestGrace.set(worker, { task, timer })
        }
      } catch {}
    }
    const readiness = this.workerReadiness.get(extensionId)
    if (
      readiness?.worker === worker &&
      readiness.inboundProtocol === WORKER_INBOUND_PROTOCOL &&
      readiness.bridgeReady &&
      readiness.running
    ) {
      const packet = {channel, args}
      const pull = readiness.inboundPull
      if (pull) {
        clearTimeout(pull.timer)
        readiness.inboundPull = undefined
        diag(`worker pull-send channel=${channel} worker=${workerDiagId(worker)}`)
        pull.resolve(packet)
      } else {
        ;(readiness.inboundQueue ||= []).push(packet)
        diag(`worker pull-queue channel=${channel} worker=${workerDiagId(worker)}`)
        if (readiness.inboundWakePending) return
        readiness.inboundWakePending = true
        try {
          // This private signal carries no extension event. It only asks the
          // preload to resume its worker-originated pull after an idle boundary.
          worker.send('crx-worker-wake')
        } catch (error) {
          readiness.inboundWakePending = false
          this.forgetWorkerIfCached(extensionId, worker)
          throw error
        }
      }
      return
    }
    diag(`worker native-send channel=${channel} worker=${workerDiagId(worker)}`)
    try {
      worker.send(channel, ...args)
    } catch (error) {
      // A worker can disappear before Chromium emits stopping/stopped. Do
      // not retain the dead wrapper: the next delivery must cold-start and
      // bind to the replacement generation instead of repeatedly failing.
      this.forgetWorkerIfCached(extensionId, worker)
      throw error
    }
  }

  private forgetWorkerIfCached(extensionId: string, worker: any) {
    if (this.swByExt.get(extensionId) !== worker) return
    this.swByExt.delete(extensionId)
    const versionId = Number(worker?.versionId)
    if (Number.isFinite(versionId)) this.swVersionToExt.delete(versionId)
    const readiness = this.workerReadiness.get(extensionId)
    if (readiness?.worker === worker) {
      this.resolveInboundPull(readiness)
      this.workerReadiness.delete(extensionId)
    }
  }

  private resolveInboundPull(readiness?: WorkerReadiness) {
    const pull = readiness?.inboundPull
    if (!pull) return
    if (pull.timer) clearTimeout(pull.timer)
    readiness!.inboundPull = undefined
    pull.resolve(null)
  }

  private hasActiveWorkerPort(extensionId: string) {
    for (const entry of this.ports.values()) {
      if (entry.extensionId === extensionId && !entry.bgHost) return true
    }
    return false
  }

  private onWorkerNextEvent = async (event: any) => {
    const worker = event?.serviceWorker
    const extId = this.extIdFromScope(worker?.scope)
    const versionId = Number(worker?.versionId)
    const readiness = extId ? this.workerReadiness.get(extId) : undefined
    if (
      !extId ||
      !readiness ||
      !this.isSameWorkerRegistration(readiness.worker, worker) ||
      readiness.versionId !== versionId ||
      !readiness.bridgeReady
    ) {
      return null
    }
    readiness.inboundWakePending = false
    let pullTask: {end: () => void} | undefined
    try {
      if (typeof worker.startTask === 'function') pullTask = worker.startTask()
    } catch {}
    const endPullTask = () => {
      if (!pullTask) return
      const task = pullTask
      pullTask = undefined
      try {
        task.end()
      } catch {}
    }
    const queued = readiness.inboundQueue?.shift()
    if (queued) {
      endPullTask()
      return queued
    }
    if (readiness.inboundPull) {
      endPullTask()
      return null
    }
    return await new Promise<{channel: string; args: any[]} | null>((resolve) => {
      const pullResolve = (packet: {channel: string; args: any[]} | null) => {
        endPullTask()
        resolve(packet)
      }
      const pull: NonNullable<WorkerReadiness['inboundPull']> = {
        resolve: pullResolve,
      }
      const arm = () => {
        const timeoutMs = this.hasActiveWorkerPort(extId)
          ? WORKER_PULL_PORT_TIMEOUT_MS
          : WORKER_PULL_IDLE_TIMEOUT_MS
        pull.timer = setTimeout(() => {
          if (readiness.inboundPull !== pull) return
          if (this.hasActiveWorkerPort(extId)) {
            arm()
            return
          }
          readiness.inboundPull = undefined
          pullResolve(null)
        }, timeoutMs)
      }
      readiness.inboundPull = pull
      arm()
    })
  }

  /** Return the running SW, coalescing concurrent cold starts per extension. */
  private ensureWorker(extensionId: string): Promise<any> {
    const ready = this.readyWorker(extensionId)
    if (ready) return Promise.resolve(ready)
    const pending = this.workerStartup.get(extensionId)
    if (pending) return pending
    const startup = this.startAndWaitWorker(extensionId)
    this.workerStartup.set(extensionId, startup)
    const clear = () => {
      if (this.workerStartup.get(extensionId) === startup) {
        this.workerStartup.delete(extensionId)
      }
    }
    startup.then(clear, clear)
    return startup
  }

  private async startAndWaitWorker(extensionId: string): Promise<any> {
    const live = this.liveWorker(extensionId)
    const scope = this.extensionScope(extensionId)
    d('%s SW for %s', live ? 'await ready' : 'cold-start', extensionId)
    let startError: any
    if (!live) try {
      const startedWorker = await this.swApi.startWorkerForScope(scope)
      diag(
        `worker start-resolved ext=${extensionId} worker=${workerDiagId(startedWorker)} cached=${workerDiagId(this.swByExt.get(extensionId))}`,
      )
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
    await this.waitWorkerReady(extensionId)
    const worker = this.readyWorker(extensionId)
    if (worker) return worker
    if (startError) throw startError
    throw new Error(`Timed out waiting for extension service worker: ${extensionId}`)
  }

  /** Resolve once extensionId's SW appears in getAllRunning — i.e. its control
   *  script has evaluated and onMessage listeners are registered — or after
   *  `timeoutMs`. liveWorker updates the cache as a side effect, so callers
   *  re-read it after this resolves. */
  private waitWorkerReady(extensionId: string, timeoutMs = WORKER_READY_TIMEOUT_MS): Promise<void> {
    if (this.readyWorker(extensionId)) return Promise.resolve()
    const started = Date.now()
    const deadline = started + timeoutMs
    return new Promise((resolve) => {
      const tick = () => {
        if (this.readyWorker(extensionId)) {
          d('waitWorkerReady(%s) ready after %dms', extensionId, Date.now() - started)
          return resolve()
        }
        if (Date.now() >= deadline) {
          d('waitWorkerReady(%s) TIMED OUT after %dms', extensionId, Date.now() - started)
          return resolve()
        }
        setTimeout(tick, 50)
      }
      tick()
    })
  }

  public async acquireServiceWorker(
    extensionId: string,
    timeoutMs = WORKER_READY_TIMEOUT_MS,
  ): Promise<(() => void) | undefined> {
    const extension = (this.ctx.session.extensions || this.ctx.session).getExtension?.(extensionId)
    const manifest = extension?.manifest
    if (manifest?.manifest_version !== 3 || !manifest?.background?.service_worker) return undefined
    await this.waitForWorkerWithTimeout(extensionId, timeoutMs)
    const worker = this.readyWorker(extensionId)
    if (!worker || typeof worker.startTask !== 'function') {
      throw new Error(`Extension service worker bridge is not ready: ${extensionId}`)
    }
    const task = worker.startTask()
    let released = false
    return () => {
      if (released) return
      released = true
      try {
        task.end()
      } catch {}
    }
  }

  private async waitForWorkerWithTimeout(extensionId: string, timeoutMs: number): Promise<any> {
    if (this.readyWorker(extensionId)) return this.readyWorker(extensionId)
    const work = this.ensureWorker(extensionId)
    if (timeoutMs >= WORKER_READY_TIMEOUT_MS) return work
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Timed out waiting for extension service worker bridge: ${extensionId}`)),
            timeoutMs,
          )
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /** Hold a keep-alive task on the extension's SW (ref-counted). */
  private acquireKeepAlive(extensionId: string) {
    let ka = this.keepAlive.get(extensionId)
    if (!ka) {
      const sw = this.readyWorker(extensionId)
      if (!sw || typeof sw.startTask !== 'function') {
        this.recordMessagePerf(extensionId, 'keepAliveUnavailable')
        return
      }
      let task: { end: () => void }
      try {
        diag(`worker start-task ext=${extensionId} worker=${workerDiagId(sw)}`)
        task = sw.startTask()
      } catch (err) {
        this.recordMessagePerf(extensionId, 'keepAliveFailed')
        d('startTask failed for %s: %o', extensionId, err)
        return
      }
      ka = { task, refs: 0 }
      this.keepAlive.set(extensionId, ka)
      this.recordMessagePerf(extensionId, 'keepAliveAcquired')
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

  private eventForFramePath(event: any, path: unknown) {
    const frame = resolveFramePath(this.senderMainFrameOf(event), path)
    if (!frame) return undefined
    return {
      sender: event?.sender,
      senderFrame: frame,
      type: event?.type,
      extension: event?.extension,
    }
  }

  private sendToFrameWithSubframeRelay(frame: Electron.WebFrameMain, channel: string, ...args: any[]) {
    const directlySent = sendToLiveFrame(frame, channel, ...args)
    const path = framePathFromTop(frame)
    if (!path || path.length === 0) return directlySent
    let top = frame
    try {
      while (top.parent) top = top.parent
    } catch {
      return directlySent
    }
    const relayed = sendToLiveFrame(top, 'crx-subframe-dispatch', path, channel, args)
    return directlySent || relayed
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
        typeof from === 'string' && from.startsWith('popup:') && typeof to === 'string' && to.startsWith('content:')
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
      (!this.isUntrackedExtensionPageSender(event, extensionId) && !this.isPopupAuthoredContentMessage(message))
    ) {
      return undefined
    }

    const fallback = this.activeTabForPopupSender(event)
    if (!fallback || fallback.isDestroyed()) return undefined

    if (CRX_VERBOSE) {
      diag(
        `tabs.${reason} stale popup tab ext=${extensionId || ''} requested=${requested} senderWc=${
          event?.sender?.id ?? 'n/a'
        } fallback=${fallback.id} senderUrl=${this.senderUrlOf(event).slice(0, 160)}`,
      )
    }
    return fallback
  }

  /** Build the `sender` object passed to onConnect/onMessage listeners.
   *  extensionId may be `undefined` for externally_connectable web-page senders
   *  (Chrome MessageSender: id is the *sending* extension's id; a web page has
   *  none). */
  private buildSender(extensionId: string | undefined, frame?: Electron.WebFrameMain) {
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

  private findFrameForTab(tab: Electron.WebContents, frameId?: number): Electron.WebFrameMain | undefined {
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

  private framesForTab(tab: Electron.WebContents, frameId?: number): Electron.WebFrameMain[] {
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

  private frameMatchesManifestContentScript(extension: Electron.Extension | undefined, frame: Electron.WebFrameMain) {
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
    if (isAutofillDiagnosticMessage(message)) {
      autofillDiag(
        `frame.send id=${messageId} channel=${channel} ext=${sender?.id || ''} ` +
          `frame=${frameBrief(frame)} command=${message.command}`,
      )
    }
    if (CRX_VERBOSE) {
      diag(
        `send ${messageId} channel=${channel} ext=${sender && sender.id} ${frameBrief(frame)} msg=${msgBrief(message)}`,
      )
    }
    return new Promise((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (r: any) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        this.csResponses.delete(messageId)
        if (CRX_VERBOSE) {
          diag(`finish ${messageId} channel=${channel} ms=${Date.now() - started} response=${respBrief(r)}`)
        }
        if (isAutofillDiagnosticMessage(message)) {
          autofillDiag(
            `frame.finish id=${messageId} channel=${channel} ms=${Date.now() - started} ` +
              `command=${message.command} response=${r === undefined ? 'undefined' : r === null ? 'null' : typeof r}`,
          )
        }
        resolve(r)
      }
      this.csResponses.set(messageId, finish)
      timer = setTimeout(() => {
        if (CRX_VERBOSE) diag(`timeout ${messageId} channel=${channel} ms=${Date.now() - started}`)
        finish(undefined)
      }, 5000)
      try {
        if (!this.sendToFrameWithSubframeRelay(frame, channel, messageId, message, sender)) {
          finish(undefined)
        }
      } catch (err) {
        if (CRX_VERBOSE) {
          diag(`frame.send failed ${messageId} channel=${channel} err=${diagErr(err)}`)
        }
        finish(undefined)
      }
    })
  }

  // ---- Port: frame -> SW connect ------------------------------------------

  private onPortConnect = async (
    event: any,
    extensionId: string,
    info: { name?: string },
    eventName: string = 'runtime.onConnect',
    senderExtensionId: string | undefined = extensionId,
  ) => {
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

    const sender = this.buildSender(senderExtensionId, frame)
    if (senderExtensionId === undefined) {
      const senderUrl = this.senderUrlOf(event)
      if (senderUrl) {
        sender.url = senderUrl
        try {
          sender.origin = new URL(senderUrl).origin
        } catch {
          /* best-effort */
        }
      }
    }

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
    const liveSw = this.readyWorker(extensionId)
    if (CRX_VERBOSE) {
      diag(`onPortConnect ext=${extensionId} name=${info?.name || ''} liveSw=${!!liveSw}`)
    }
    if (liveSw) {
      try {
        const connect = this.createPortConnect(eventName, info?.name || '', sender)
        entry.connect = connect
        this.acquireKeepAlive(extensionId)
        entry.keptAlive = true
        this.deliverPortConnect(entry, liveSw)
        d(`port ${portId} connect (name=${info?.name}) ext=${extensionId} event=${eventName}`)
        return (await connect.result) ? portId : ''
      } catch (err) {
        d(`deliver onConnect to live SW failed for ${extensionId}: ${err}`)
        if (entry.connect?.timer) clearTimeout(entry.connect.timer)
        entry.connect = undefined
        if (entry.keptAlive) {
          entry.keptAlive = false
          this.releaseKeepAlive(extensionId)
        }
      }
    }

    const bg = this.ctx.router.backgroundHostFor(extensionId)
    if (CRX_VERBOSE) {
      let bgUrl = ''
      try {
        if (bg) bgUrl = bg.getURL()
      } catch {}
      diag(`onPortConnect bgPage=${!!bg} destroyed=${bg ? bg.isDestroyed() : false} url=${bgUrl}`)
    }
    if (bg && !bg.isDestroyed()) {
      entry.bgHost = bg
      bg.once('destroyed', () => this.teardownPort(portId, 'frame'))
      try {
        if (
          !sendToLiveMainFrame(bg, `crx-${eventName}`, {
            portId,
            name: info?.name || '',
            sender,
          })
        ) {
          this.ports.delete(portId)
          return ''
        }
      } catch (err) {
        d(`failed to deliver onConnect to bgPage for ${extensionId}: ${err}`)
        this.ports.delete(portId)
        return ''
      }
      d(`port ${portId} connect (name=${info?.name}) ext=${extensionId} event=${eventName} [MV2 bgPage]`)
      return portId
    }

    try {
      const sw = await this.ensureWorker(extensionId)
      // The frame can disappear while a cold worker is booting. Do not attach
      // a new connection promise to an entry that teardownPort already removed.
      if (this.ports.get(portId) !== entry) return ''
      const connect = this.createPortConnect(eventName, info?.name || '', sender)
      entry.connect = connect
      this.acquireKeepAlive(extensionId)
      entry.keptAlive = true
      this.deliverPortConnect(entry, sw)
      d(`port ${portId} connect (name=${info?.name}) ext=${extensionId} event=${eventName} [SW cold-start]`)
      return (await connect.result) ? portId : ''
    } catch (err) {
      d(`failed to deliver onConnect (no live SW, no MV2 bgPage) for ${extensionId}: ${err}`)
      this.teardownPort(portId, 'sw')
      return ''
    }
  }

  // ---- External (externally_connectable) ------------------------------

  /** Resolve a narrowly-scoped store-id alias to an installed extension. */
  private resolveExternalTargetExtensionId(requestedId: string): string | undefined {
    if (!requestedId) return undefined
    const extensions = (this.ctx.session as any).extensions || this.ctx.session
    const getExtension =
      typeof extensions.getExtension === 'function'
        ? (id: string) => extensions.getExtension(id)
        : (_id: string): any => undefined

    if (getExtension(requestedId)) return requestedId

    const alias = EXTERNAL_EXTENSION_ID_ALIASES[requestedId]
    if (!alias) return undefined
    const target = getExtension(alias.targetId)
    if (!target) return undefined
    const manifestName = String((target.manifest as any)?.name || target.name || '')
    if (manifestName !== alias.manifestName) return undefined

    try {
      console.log(`[crx-external] alias requested=${requestedId} resolved=${alias.targetId} name=${manifestName}`)
    } catch {}
    return alias.targetId
  }

  /** Chrome-standard externally_connectable origin gate: true iff senderUrl is
   *  in the target extension's manifest `externally_connectable.matches`. */
  private isExternallyConnectable(targetExtensionId: string, senderUrl: string): boolean {
    if (!senderUrl || !targetExtensionId) return false
    const extensions = (this.ctx.session as any).extensions || this.ctx.session
    const extension =
      typeof extensions.getExtension === 'function' ? extensions.getExtension(targetExtensionId) : undefined
    if (!extension) return false
    const ec = (extension.manifest as any)?.externally_connectable
    if (!ec) return false
    // Web pages are authorized via `matches`. (`ids` governs extension-to-
    // extension external messaging, which a page sender — no extension id —
    // cannot originate.) matches uses standard match-pattern syntax.
    const matches: string[] = Array.isArray(ec.matches) ? ec.matches : []
    if (matches.length === 0) return false
    return matches.some((p) => {
      try {
        return matchesPattern(p, senderUrl)
      } catch {
        return false
      }
    })
  }

  /** Page -> extension one-shot message (chrome.runtime.sendMessage(id, msg)
   *  from a web page). Validates externally_connectable, then delivers to the
   *  SW's runtime.onMessageExternal with a Chrome web-page sender (id undefined). */
  private onRuntimeMessageExternal = async (event: any, requestedExtensionId: string, message: any): Promise<any> => {
    const frame = this.senderFrameOf(event)
    const senderUrl = this.senderUrlOf(event)
    const targetExtensionId = this.resolveExternalTargetExtensionId(requestedExtensionId)
    if (!targetExtensionId) {
      try {
        console.log(`[crx-external] missing requested=${requestedExtensionId} url=${senderUrl.slice(0, 120)}`)
      } catch {}
      return undefined
    }
    if (!this.isExternallyConnectable(targetExtensionId, senderUrl)) {
      d(`onMessageExternal: reject ${senderUrl.slice(0, 120)} not externally_connectable for ${targetExtensionId}`)
      try {
        console.log(`[crx-external] rejected ext=${targetExtensionId} url=${senderUrl.slice(0, 120)}`)
      } catch {}
      // Chrome: the page's callback fires with chrome.runtime.lastError set and
      // an undefined response.
      return undefined
    }
    const sender = this.buildSender(undefined, frame)
    if (senderUrl) {
      sender.url = senderUrl
      try {
        sender.origin = new URL(senderUrl).origin
      } catch {
        /* best-effort */
      }
    }
    if (CRX_VERBOSE) {
      diag(`onMessageExternal ext=${targetExtensionId} url=${senderUrl.slice(0, 120)} msg=${msgBrief(message)}`)
    }
    try {
      console.log(
        `[crx-external] accepted ext=${targetExtensionId} url=${senderUrl.slice(0, 120)} message=${msgBrief(message)}`,
      )
    } catch {}
    // Resolve the receiving end (live SW / MV2 bg page / cold-start SW).
    let sw: any = this.readyWorker(targetExtensionId)
    if (!sw) {
      const bg = this.ctx.router.backgroundHostFor(targetExtensionId)
      if (bg && !bg.isDestroyed()) sw = bg
    }
    if (!sw) {
      try {
        sw = await this.ensureWorker(targetExtensionId)
      } catch (err) {
        d(`onMessageExternal: failed to resolve worker for ${targetExtensionId}: ${err}`)
        return undefined
      }
    }
    this.acquireKeepAlive(targetExtensionId)
    try {
      const response = await this.requestResponse(
        sw,
        targetExtensionId,
        message,
        sender,
        EXTERNAL_MESSAGE_RESPONSE_TIMEOUT_MS,
        'runtime.onMessageExternal',
      )
      try {
        console.log(`[crx-external] completed ext=${targetExtensionId} response=${respBrief(response)}`)
      } catch {}
      return response
    } finally {
      this.releaseKeepAlive(targetExtensionId)
    }
  }

  /** Page -> extension long-lived Port (chrome.runtime.connect(id, name) from a
   *  web page). Same externally_connectable gate as the one-shot path; reuses
   *  the PortEntry machinery but delivers runtime.onConnectExternal. */
  private onPortConnectExternal = async (
    event: any,
    requestedExtensionId: string,
    info: { name?: string },
  ): Promise<string> => {
    const senderUrl = this.senderUrlOf(event)
    const extensionId = this.resolveExternalTargetExtensionId(requestedExtensionId)
    if (!extensionId) return ''
    if (!this.isExternallyConnectable(extensionId, senderUrl)) {
      d(`onConnectExternal: reject ${senderUrl.slice(0, 120)} not externally_connectable for ${extensionId}`)
      return ''
    }
    // A web page has no sending extension id. Passing the target extension id
    // here would make onConnectExternal listeners mistake the page for the
    // extension itself (or for an extension-to-extension connection).
    return this.onPortConnect(event, extensionId, info, 'runtime.onConnectExternal', undefined)
  }

  /** SW signals it has set up its end of the port. Flush buffered messages. */
  private onPortAccept = (_event: any, portId: string) => {
    diag(`worker port-accept port=${portId} event=${workerDiagId(_event?.serviceWorker)}`)
    const entry = this.ports.get(portId)
    if (!entry) return
    const connect = entry.connect
    if (connect?.timer) clearTimeout(connect.timer)
    entry.connect = undefined
    entry.swReady = true
    const pending = entry.pendingToSw
    entry.pendingToSw = []
    for (const msg of pending) this.deliverToBackground(entry, msg)
    connect?.settle(true)
  }

  private onPortReject = (_event: any, portId: string, reason?: string) => {
    const entry = this.ports.get(portId)
    if (!entry || entry.swReady) return
    d('port %s rejected by %s: %s', portId, entry.extensionId, reason || 'no receiver')
    this.teardownPort(portId, 'sw')
  }

  private createPortConnect(eventName: string, name: string, sender: any) {
    let settled = false
    let resolveResult!: (accepted: boolean) => void
    const result = new Promise<boolean>((resolve) => {
      resolveResult = resolve
    })
    return {
      eventName,
      name,
      sender,
      attempts: 0,
      result,
      settle: (accepted: boolean) => {
        if (settled) return
        settled = true
        resolveResult(accepted)
      },
    }
  }

  private deliverPortConnect(entry: PortEntry, sw: any) {
    const connect = entry.connect
    if (!connect || !this.ports.has(entry.id)) return
    connect.attempts++
    diag(`worker port-send port=${entry.id} worker=${workerDiagId(sw)} attempt=${connect.attempts}`)
    this.sendToWorker(entry.extensionId, sw, `crx-${connect.eventName}`, {
      portId: entry.id,
      name: connect.name,
      sender: connect.sender,
    })
    if (connect.timer) clearTimeout(connect.timer)
    connect.timer = setTimeout(() => {
      const current = this.ports.get(entry.id)
      if (!current || current.swReady || current.connect !== connect) return
      if (connect.attempts < PORT_ACCEPT_MAX_ATTEMPTS) {
        const worker = this.readyWorker(entry.extensionId)
        if (worker) {
          d('retry unaccepted port %s for %s', entry.id, entry.extensionId)
          try {
            this.deliverPortConnect(entry, worker)
            return
          } catch {}
        }
      }
      console.warn(
        `[crx-messaging] Port receiving end did not accept connection ext=${entry.extensionId} port=${entry.id}`,
      )
      this.teardownPort(entry.id, 'sw')
      // The renderer returned neither accept nor an explicit no-listener reject.
      // This is a proven hosted-bridge failure, not normal MV3 idle shutdown.
      void this.ctx
        .recoverServiceWorker?.(entry.extensionId, WORKER_READY_TIMEOUT_MS, true)
        .then((release) => release?.())
        .catch((error) =>
          d('foreground recovery after unaccepted port failed for %s: %o', entry.extensionId, error),
        )
    }, PORT_ACCEPT_TIMEOUT_MS)
  }

  private onPortPost = (event: any, portId: string, message: any) => {
    if (CRX_VERBOSE) {
      const messageCase = Array.isArray(message)
        ? message[0]
        : message && typeof message === 'object'
        ? 'obj:' + Object.keys(message).slice(0, 4).join(',')
        : typeof message
      const extra =
        Array.isArray(message) && message[0] === 11 ? ` W=${message[5]} frame=${message[4]} M=${message[1]}` : ''
      diag(
        `onPortPost portId=${portId} case=${messageCase}${extra} len=${Array.isArray(message) ? message.length : ''}`,
      )
    }
    const entry = this.ports.get(portId)
    if (!entry) {
      diag(`onPortPost no entry portId=${portId}`)
      return
    }
    const sourceFrame = this.senderFrameOf(event)
    if (sourceFrame && entry.ownerFrame) {
      this.recordMessagePerf(entry.extensionId, 'portFramePeer', message)
      const target = sourceFrame === entry.frame ? entry.ownerFrame : entry.frame
      const channel =
        target === entry.ownerFrame ? `crx-port-post-to-owner:${portId}` : `crx-port-post-to-frame:${portId}`
      try {
        if (CRX_VERBOSE) {
          diag(`port frame->owner port=${portId} target=${frameBrief(target)} msg=${msgBrief(message)}`)
        }
        if (target === entry.frame) this.sendToFrameWithSubframeRelay(target, channel, message)
        else sendToLiveFrame(target, channel, message)
      } catch (err) {
        d(`deliver to frame peer failed for ${portId}: ${err}`)
      }
    } else if (sourceFrame && sourceFrame === entry.frame) {
      // content frame -> background (MV3 SW or MV2 bgPage)
      this.recordMessagePerf(entry.extensionId, 'portToBackground', message)
      if (CRX_VERBOSE) {
        diag(`port frame->bg port=${portId} swReady=${entry.swReady} bgHost=${!!entry.bgHost}`)
      }
      if (!entry.swReady) entry.pendingToSw.push(message)
      else this.deliverToBackground(entry, message)
    } else {
      // background (SW with no sourceFrame, or MV2 bgPage whose frame !== entry.frame) -> content frame
      this.recordMessagePerf(entry.extensionId, 'portToFrame', message)
      try {
        const channel = entry.ownerFrame ? `crx-port-post-to-frame:${portId}` : `crx-port-post:${portId}`
        if (CRX_VERBOSE) {
          diag(`port sw->frame port=${portId} target=${frameBrief(entry.frame)} msg=${msgBrief(message)}`)
        }
        this.sendToFrameWithSubframeRelay(entry.frame, channel, message)
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
    this.recordMessagePerf(entry.extensionId, 'portOwnerToFrame', message)
    try {
      if (CRX_VERBOSE) {
        diag(`port owner->frame port=${portId} target=${frameBrief(entry.frame)} msg=${msgBrief(message)}`)
      }
      this.sendToFrameWithSubframeRelay(entry.frame, `crx-port-post-to-frame:${portId}`, message)
    } catch (err) {
      d(`deliver owner message to frame failed for ${portId}: ${err}`)
    }
  }

  private deliverToBackground(entry: PortEntry, message: any) {
    // MV2 persistent background page: deliver directly to its webContents.
    if (entry.bgHost && !entry.bgHost.isDestroyed()) {
      try {
        sendToLiveMainFrame(entry.bgHost, `crx-port-post:${entry.id}`, message)
      } catch (err) {
        d(`deliver to bgPage failed for ${entry.id}: ${err}`)
      }
      return
    }
    // MV3 service worker: kept alive while the port is open, so it is normally
    // resolvable synchronously — no per-message `startWorkerForScope`.
    const sw = this.readyWorker(entry.extensionId)
    if (sw) {
      try {
        this.sendToWorker(entry.extensionId, sw, `crx-port-post:${entry.id}`, message)
        return
      } catch (err) {
        d(`deliver to SW (live) failed for ${entry.id}: ${err}`)
      }
    }
    // Rare fallback: worker not currently resolvable — cold-start once.
    this.ensureWorker(entry.extensionId)
      .then((w) => this.sendToWorker(entry.extensionId, w, `crx-port-post:${entry.id}`, message))
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
    const readiness = this.workerReadiness.get(entry.extensionId)
    const wake = readiness?.inboundPull
    if (wake && !this.hasActiveWorkerPort(entry.extensionId)) {
      this.resolveInboundPull(readiness)
    }
    const connect = entry.connect
    if (connect?.timer) clearTimeout(connect.timer)
    entry.connect = undefined
    connect?.settle(false)
    if (from === 'frame') {
      if (entry.ownerFrame) {
        try {
          sendToLiveFrame(entry.ownerFrame, `crx-port-disconnect:${portId}`)
        } catch {}
        try {
          this.sendToFrameWithSubframeRelay(entry.frame, `crx-port-disconnect:${portId}`)
        } catch {}
      } else {
        // Notify the background end if it's alive — MV2 bgPage or a live SW.
        // (No point cold-starting a SW just to tell it a port closed.)
        if (entry.bgHost && !entry.bgHost.isDestroyed()) {
          try {
            sendToLiveMainFrame(entry.bgHost, `crx-port-disconnect:${portId}`)
          } catch {}
        } else {
          const sw = this.liveWorker(entry.extensionId)
          if (sw) {
            try {
              this.sendToWorker(entry.extensionId, sw, `crx-port-disconnect:${portId}`)
            } catch {}
          }
        }
      }
    } else {
      // Notify frame end.
      try {
        this.sendToFrameWithSubframeRelay(entry.frame, `crx-port-disconnect:${portId}`)
      } catch {}
      if (entry.ownerFrame) {
        try {
          sendToLiveFrame(entry.ownerFrame, `crx-port-disconnect:${portId}`)
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
    this.recordMessagePerf(
      extensionId,
      event?.type === 'service-worker' ? 'runtimeFromBackground' : 'runtimeToBackground',
      message,
    )
    const frame = this.senderFrameOf(event)
    const sender = this.buildSender(extensionId, frame)
    if (isAutofillDiagnosticMessage(message)) {
      autofillDiag(
        `runtime.recv ext=${extensionId} command=${message.command} eventType=${event?.type || ''} ` +
          `senderTab=${sender?.tab?.id ?? ''} senderFrame=${sender?.frameId ?? ''} ` +
          `url=${safeAutofillUrl(sender?.url || sender?.tab?.url)}`,
      )
    }
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
    let sw: any = this.readyWorker(extensionId)
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
      // Chrome runtime.sendMessage from a content script is delivered to the
      // extension's background context and to every open extension page. The
      // previous implementation only queried the service worker, so a popup
      // collecting page details never received collectPageDetailsResponse and
      // consequently reported that the selected item could not be autofilled.
      const attempts: Array<Promise<any>> = [this.requestResponse(sw, extensionId, message, sender)]
      const hosts = this.runtimeMessageHostsFor(extensionId, event?.sender).filter((host) => host !== sw)
      if (isAutofillDiagnosticMessage(message)) {
        autofillDiag(
          `runtime.broadcast ext=${extensionId} command=${message.command} hosts=${hosts.length} pageBroker=true`,
        )
      }
      for (const host of hosts) {
        attempts.push(this.sendRuntimeMessageToHost(host, message, sender))
      }
      // Sandboxed extension pages are reached through the page-listen Port
      // broker. This mirrors dispatchRuntimeMessageFromBackground, but avoids
      // sending the content-script message back to other content scripts.
      try {
        this.ctx.router.sendEvent(extensionId, 'crx-page-broadcast', {
          message,
          sender,
        })
      } catch {
        // best-effort; no page-listen receiver may be registered
      }
      return attempts.length === 1 ? attempts[0] : this.resolveFirstDefined(attempts)
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
    eventName = 'runtime.onMessage',
  ): Promise<any> {
    const messageId = `m${++this.msgCounter}`
    return new Promise((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (r: any) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        this.csResponses.delete(messageId)
        resolve(r)
      }
      this.csResponses.set(messageId, finish)
      // Timeout so a missing listener doesn't hang the invoke.
      timer = setTimeout(() => finish(undefined), timeoutMs)
      try {
        this.sendToWorker(extensionId, sw, `crx-${eventName}`, { messageId, message, sender })
        if (isAutofillDiagnosticMessage(message)) {
          autofillDiag(`runtime.send id=${messageId} event=${eventName} ext=${extensionId} command=${message.command}`)
        }
      } catch (err) {
        d(`failed to deliver ${eventName} to worker for ${extensionId}: ${err}`)
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
        const offscreenAttempts = offscreenHosts.map((host) => this.sendRuntimeMessageToHost(host, message, sender))
        return offscreenAttempts.length === 1 ? offscreenAttempts[0] : this.resolveFirstDefined(offscreenAttempts)
      }

      // A sandboxed offscreen BrowserWindow can lose crx-preload entirely.
      // Send a private request back to the source SW; the source shim relays it
      // over the native `crx-page-listen:offscreen` Port and keeps the normal
      // runtime.sendMessage response callback alive until the page answers.
      return this.requestResponse(
        event.serviceWorker || this.readyWorker(extensionId),
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
      this.ctx.router.sendEvent(extensionId, 'crx-page-broadcast', {
        message,
        sender,
      })
    } catch {
      // best-effort — sendEvent throws if no SW listener registered yet
    }

    if (attempts.length === 0) return Promise.resolve(undefined)
    if (attempts.length === 1) return attempts[0]
    return this.resolveFirstDefined(attempts)
  }

  private runtimeMessageHostsFor(extensionId: string, excludeHost?: Electron.WebContents): Electron.WebContents[] {
    const eventListeners = (this.ctx.router as any)?.listeners?.get?.('runtime.onMessage')
    if (!Array.isArray(eventListeners) || eventListeners.length === 0) return []

    const hosts: Electron.WebContents[] = []
    const seen = new Set<Electron.WebContents>()
    for (const listener of eventListeners) {
      if (!listener || listener.type !== 'frame' || listener.extensionId !== extensionId) continue
      const host = listener.host
      if (!host || seen.has(host)) continue
      // Chrome does not deliver runtime.sendMessage back to the sending
      // extension page. Content-script senders have a tab WebContents here,
      // while extension-page senders can be excluded by identity.
      if (excludeHost && host === excludeHost) continue
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

  private sendRuntimeMessageToHost(host: Electron.WebContents, message: any, sender: any): Promise<any> {
    const messageId = `m${++this.msgCounter}`
    const started = Date.now()
    if (CRX_VERBOSE) {
      let hostUrl = ''
      try {
        hostUrl = host.getURL?.() || ''
      } catch {}
      diag(
        `send ${messageId} channel=crx-runtime.onMessage ext=${sender && sender.id} host=${host.id} url=${hostUrl.slice(
          0,
          160,
        )} msg=${msgBrief(message)}`,
      )
    }
    return new Promise((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (r: any) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        this.csResponses.delete(messageId)
        if (CRX_VERBOSE) {
          diag(`finish ${messageId} channel=crx-runtime.onMessage ms=${Date.now() - started} response=${respBrief(r)}`)
        }
        resolve(r)
      }
      this.csResponses.set(messageId, finish)
      timer = setTimeout(() => {
        if (CRX_VERBOSE) {
          diag(`timeout ${messageId} channel=crx-runtime.onMessage ms=${Date.now() - started}`)
        }
        finish(undefined)
      }, 5000)
      try {
        if (
          !sendToLiveMainFrame(host, 'crx-runtime.onMessage', {
            messageId,
            message,
            sender,
          })
        ) {
          finish(undefined)
        }
      } catch (err) {
        if (CRX_VERBOSE) {
          diag(`host.send failed ${messageId} channel=crx-runtime.onMessage err=${diagErr(err)}`)
        }
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
    if (CRX_VERBOSE) {
      diag(`response ipc ${messageId} found=${!!cb} response=${respBrief(response)}`)
      autofillDiag(
        `cs.response id=${messageId} found=${!!cb} response=${
          response === undefined ? 'undefined' : response === null ? 'null' : typeof response
        }`,
      )
    }
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
    if (extensionId) this.recordMessagePerf(extensionId, 'tabsToContent', message)
    if (CRX_VERBOSE) {
      diag(
        `tabs.sendMessage enter ext=${extensionId || ''} tabId=${
          typeof tabId === 'number' ? tabId : 'current'
        } options=${JSON.stringify(options || {})} msg=${msgBrief(message)}`,
      )
    }
    if (isAutofillDiagnosticMessage(message)) {
      autofillDiag(
        `tabs.send.enter ext=${extensionId || ''} tabId=${typeof tabId === 'number' ? tabId : 'current'} frameId=${
          options?.frameId ?? ''
        } command=${message.command}`,
      )
    }
    const tab = this.resolveTabForSender(event, extensionId, tabId, 'sendMessage', message)
    if (!tab || tab.isDestroyed()) {
      if (CRX_VERBOSE) {
        diag(
          `tabs.sendMessage no tab ext=${extensionId || ''} requested=${
            typeof tabId === 'number' ? tabId : 'current'
          } senderWc=${event?.sender?.id ?? 'n/a'} senderUrl=${this.senderUrlOf(event).slice(0, 160)}`,
        )
      }
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
      if (CRX_VERBOSE) {
        diag(
          `tabs.sendMessage candidate ext=${extensionId} tab=${tab.id} target=${frameBrief(
            frame,
          )} dynamic=${hasDynamicReceiver} manifest=${hasManifestReceiver} routes=${routes.join(',') || 'none'}`,
        )
      }
      for (const channel of routes) deliveries.push({ frame, channel })
    }

    // Chrome rejects tabs.sendMessage immediately when the target document has
    // no content script from this extension. Sending to the frame anyway leaves
    // the request pending until sendMessageToFrame's five-second safety timeout.
    // Besides being observably different from Chrome, that stalls popup startup
    // for extensions which probe the active tab and intentionally catch the
    // no-receiver error (uBlacklist is one example). Dynamic scripts injected by
    // scripting.executeScript/userScripts are covered by dynamicContentScripts,
    // so an empty delivery list really does mean that no receiver is present.
    if (deliveries.length === 0) {
      if (CRX_VERBOSE) {
        diag(`tabs.sendMessage no receiver ext=${extensionId} tab=${tab.id}`)
      }
      return Promise.resolve(undefined)
    }

    const sender = this.buildSender(extensionId, this.senderFrameOf(event))
    const attempts = deliveries.map(({ frame, channel }) => this.sendMessageToFrame(frame, channel, message, sender))
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
    const hasOwnerFrame = !!(ownerFrame && (ownerFrame !== targetFrame || info?.__crxOwnerFrameBridge))
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
      if (
        !this.sendToFrameWithSubframeRelay(targetFrame, 'crx-runtime.onConnect', {
          portId,
          name: info?.name || '',
          sender,
        })
      ) {
        this.ports.delete(portId)
        return ''
      }
    } catch (err) {
      d(`connectToTab: failed to deliver onConnect to tab ${tabId}: ${err}`)
      this.ports.delete(portId)
      return ''
    }

    this.acquireKeepAlive(event.extension.id)
    entry.keptAlive = true

    if (CRX_VERBOSE) {
      diag(
        `tabs.connect port=${portId} ext=${event.extension.id} tab=${
          typeof tabId === 'number' ? tabId : 'current'
        } name=${info?.name || ''} frameId=${info?.frameId ?? 'auto'} owner=${frameBrief(
          ownerFrame,
        )} target=${frameBrief(targetFrame)} ownerBridge=${!!info?.__crxOwnerFrameBridge}`,
      )
    }
    d(`tabs.connect port ${portId} (name=${info?.name}) ext=${event.extension.id} tab=${tabId}`)
    return portId
  }
}
