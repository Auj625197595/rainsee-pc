import { ipcRenderer, contextBridge, webFrame } from 'electron'
import { addExtensionListener, removeExtensionListener } from './event'
import {
  RUNTIME_CONTEXT_TYPE,
  RuntimeContextTypeMap,
} from '../runtime-context-type'


/**
 * Self-contained (no closures): install the MV3 `browser` fallback.
 *
 * Chrome 148+ provides `browser` natively and guarantees identities such as
 * `browser.tabs === chrome.tabs`; it does not require the namespace root
 * objects themselves to be identical. Preserve Electron/Chromium's native
 * object whenever it exists. For an MV3 context where it is absent, use the
 * runtime guard recommended by Chrome and fall back to `chrome`.
 *
 * Must stay self-contained: it is serialized into the main world via
 * executeInMainWorld.
 */
function installBrowserNamespaceFallback() {
  try {
    const g: any = globalThis as any
    const chromeObj = g.chrome
    if (!chromeObj) return

    let manifest: any
    try {
      manifest = chromeObj.runtime?.getManifest?.()
    } catch {}
    if (manifest?.manifest_version !== 3) return

    // Chrome 148-151 disables the browser namespace for the entire extension
    // when devtools_page is declared. Leaving it absent is important: an
    // installed webextension-polyfill must be allowed to wrap chrome instead of
    // seeing browser and becoming a no-op. Chrome 152 removes this exception.
    if (manifest.devtools_page) {
      let chromiumMajor = 0
      try {
        const match = String(g.navigator?.userAgent || '').match(/(?:Chrome|Chromium)\/(\d+)/)
        chromiumMajor = match ? Number(match[1]) : 0
      } catch {}
      if (chromiumMajor >= 148 && chromiumMajor < 152) return
    }

    const isWorker = typeof window === 'undefined'
    try {
      if (g.browser && !isWorker) return
    } catch {}

    // Extension pages preserve a native browser namespace. In a service worker,
    // Electron can expose a partial browser object with runtime.id but without
    // runtime/tabs/permissions events. WXT selects that object and crashes
    // during synchronous listener registration. Chrome exposes one complete API
    // surface, so make the worker alias exact even when browser already exists.
    try {
      g.browser = chromeObj
    } catch {}
    try {
      if (isWorker || !g.browser) {
        Object.defineProperty(g, 'browser', {
          value: chromeObj,
          configurable: true,
          writable: true,
        })
      }
    } catch {
      /* non-configurable binding */
    }
  } catch {
    /* never let this break startup */
  }
}

const WORKER_INBOUND_PROTOCOL = 3

const deferTask = (fn: () => void, delay = 0) => {
  try {
    if (typeof globalThis.setTimeout === 'function') {
      globalThis.setTimeout(fn, delay)
      return
    }
  } catch {
    /* fall through */
  }
  if (delay > 0) {
    Promise.resolve().then(() => deferTask(fn, 0))
    return
  }
  Promise.resolve().then(fn)
}

// Module-top-level helper (NOT inside injectExtensionAPIs) so every scope —
// including deeply nested factory closures that webpack/terser may otherwise
// split into a scope that cannot see a function-body local (observed at runtime
// as "crxStripUncloneable is not defined") — can reference it. Electron IPC
// uses V8 serialization, which — unlike window.postMessage's structured clone —
// does NOT support Blob/File; this recursively replaces Blob/File with a small
// marker so an extension sendMessage/Port RESPONSE carrying an imageBlob can
// cross the SW->main IPC. dessant's image preparer (j1) regenerates the Blob
// from imageDataUrl, so the strip is lossless.
const crxStripUncloneable = (val: any, seen?: WeakSet<any>): any => {
  // Functions / symbols can't cross V8 serialization — drop them, otherwise ONE
  // non-cloneable arg aborts the whole IPC send (e.g. an API call whose options
  // object accidentally carries a function). Primitives pass through unchanged.
  const t = typeof val
  if (val == null) return val
  if (t === 'function' || t === 'symbol') return undefined
  if (t !== 'object') return val
  try {
    if (typeof Blob !== 'undefined' && val instanceof Blob) {
      const out: any = { __crxBlob: true, type: val.type || '', size: val.size || 0 }
      for (const k of Object.keys(val)) {
        try {
          const d = Object.getOwnPropertyDescriptor(val, k)
          if (!d || typeof d.get === 'function' || typeof d.set === 'function') continue
          out[k] = crxStripUncloneable(d.value, seen)
        } catch {
          // best-effort
        }
      }
      return out
    }
    if (typeof File !== 'undefined' && val instanceof File) {
      const out: any = {
        __crxFile: true,
        type: val.type || '',
        size: val.size || 0,
        name: val.name || '',
      }
      for (const k of Object.keys(val)) {
        try {
          const d = Object.getOwnPropertyDescriptor(val, k)
          if (!d || typeof d.get === 'function' || typeof d.set === 'function') continue
          out[k] = crxStripUncloneable(d.value, seen)
        } catch {
          // best-effort
        }
      }
      return out
    }
  } catch {
    // best-effort
  }
  if (!seen) seen = new WeakSet<any>()
  if (seen.has(val)) return null
  try {
    seen.add(val)
  } catch {
    // best-effort
  }
  if (Array.isArray(val)) {
    const arr: any[] = []
    for (const v of val) arr.push(crxStripUncloneable(v, seen))
    seen.delete(val)
    return arr
  }
  const out: any = {}
  for (const k of Object.keys(val)) {
    try {
      const d = Object.getOwnPropertyDescriptor(val, k)
      if (!d) continue
      // Skip uncloneable accessor properties up front; invoking a getter
      // that throws would itself abort the clone.
      if (typeof d.get === 'function' || typeof d.set === 'function') continue
      out[k] = crxStripUncloneable(d.value, seen)
    } catch {
      // best-effort
    }
  }
  // `seen` tracks the current recursion path, not every object encountered.
  // Shared references are legal structured-clone input (Tampermonkey reuses
  // one DNR action object across many rules) and must be cloned again when a
  // sibling branch reaches them. Only an ancestor reference is a real cycle.
  seen.delete(val)
  return out
}

// Chrome uses JSON serialization for extension messaging. Electron's IPC uses
// V8 structured clone instead, so passing the original value changes observable
// behavior and rejects host objects such as DOM nodes. Keep this separate from
// crxStripUncloneable: other extension APIs are not JSON-message channels.
const crxSerializeMessage = (value: any): any => {
  const serialized = JSON.stringify(value)
  return serialized === undefined ? undefined : JSON.parse(serialized)
}

// Autofill tracing lives inside mainWorldScript (crxIsAutofillMessage); it
// reads this flag via electronContext.autofillVerbose because serialized
// main-world code has no access to `process`.
const crxAutofillVerbose =
  typeof process !== 'undefined' && process?.env?.CRX_VERBOSE === '1'

const crxBlobToDataUrl = (blob: Blob): Promise<string | undefined> =>
  new Promise((resolve) => {
    try {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined)
      reader.onerror = () => resolve(undefined)
      reader.onabort = () => resolve(undefined)
      reader.readAsDataURL(blob)
    } catch {
      resolve(undefined)
    }
  })

const crxStripPortMessage = async (val: any, seen?: WeakSet<any>): Promise<any> => {
  const t = typeof val
  if (val == null) return val
  if (t === 'function' || t === 'symbol') return undefined
  if (t !== 'object') return val
  try {
    if (typeof Blob !== 'undefined' && val instanceof Blob) {
      const out: any = {
        __crxBlob: true,
        type: val.type || '',
        size: val.size || 0,
      }
      if (typeof File !== 'undefined' && val instanceof File) out.name = val.name || ''
      const dataUrl = await crxBlobToDataUrl(val)
      if (dataUrl) {
        out.imageDataUrl = dataUrl
        out.dataUrl = dataUrl
      }
      for (const k of Object.keys(val)) {
        try {
          const d = Object.getOwnPropertyDescriptor(val, k)
          if (!d || typeof d.get === 'function' || typeof d.set === 'function') continue
          const stripped = await crxStripPortMessage(d.value, seen)
          if (stripped !== undefined || !(k in out)) out[k] = stripped
        } catch {
          // best-effort
        }
      }
      return out
    }
  } catch {
    // best-effort
  }
  if (!seen) seen = new WeakSet<any>()
  if (seen.has(val)) return null
  try {
    seen.add(val)
  } catch {
    // best-effort
  }
  if (Array.isArray(val)) {
    const arr: any[] = []
    for (const item of val) arr.push(await crxStripPortMessage(item, seen))
    seen.delete(val)
    return arr
  }
  const out: any = {}
  for (const k of Object.keys(val)) {
    try {
      const d = Object.getOwnPropertyDescriptor(val, k)
      if (!d || typeof d.get === 'function' || typeof d.set === 'function') continue
      const stripped = await crxStripPortMessage(d.value, seen)
      if (stripped !== undefined) out[k] = stripped
    } catch {
      // best-effort
    }
  }
  seen.delete(val)
  return out
}

const crxSendPortMessage = (portId: string, message: any) => {
  const transfer = message && typeof message === 'object' ? message.transfer : undefined
  if (!transfer || !transfer.transferResponse) {
    let wire: any
    try {
      wire = crxSerializeMessage(message)
    } catch {
      wire = crxStripUncloneable(message)
    }
    try {
      ipcRenderer.send('crx-port-post', portId, wire)
    } catch {
      // best-effort
    }
    return
  }
  crxStripPortMessage(message)
    .then((stripped) => ipcRenderer.send('crx-port-post', portId, stripped))
    .catch((err) => {
      try {
        console.warn('crx-port-post strip failed', err)
      } catch {
        // best-effort
      }
      try {
        ipcRenderer.send('crx-port-post', portId, crxStripUncloneable(message))
      } catch {
        // best-effort
      }
    })
}

const crxSendCloneSafe = (channel: string, ...args: any[]) => {
  Promise.all(args.map((arg) => crxStripPortMessage(arg)))
    .then((stripped) => ipcRenderer.send(channel, ...stripped))
    .catch((err) => {
      try {
        console.warn(`${channel} strip failed`, err)
      } catch {
        // best-effort
      }
      try {
        ipcRenderer.send(channel, ...args.map((arg) => crxStripUncloneable(arg)))
      } catch {
        // best-effort
      }
    })
}

export const injectExtensionAPIs = () => {
  interface ExtensionMessageOptions {
    noop?: boolean
    defaultResponse?: any
    serialize?: (...args: any[]) => any[]
  }

  const invokeExtension = async function (
    extensionId: string,
    fnName: string,
    options: ExtensionMessageOptions = {},
    ...args: any[]
  ) {
    const callback = typeof args[args.length - 1] === 'function' ? args.pop() : undefined

    if (process.env.NODE_ENV === 'development') {
      console.log(fnName, args)
    }

    if (options.noop) {
      console.warn(`${fnName} is not yet implemented.`)
      if (callback) callback(options.defaultResponse)
      return Promise.resolve(options.defaultResponse)
    }

    if (options.serialize) {
      args = options.serialize(...args)
    }

    let result

    try {
      // Sanitize args before they cross IPC: a single non-cloneable value
      // (Blob/File left by a serialize miss, a function/symbol tucked into an
      // options object, a Proxy) would make the invoke throw "An object could
      // be cloned" — caught here, but it still drops the whole call. Stripping
      // lets the cloneable remainder through so the API proceeds.
      result = await ipcRenderer.invoke(
        'crx-msg',
        extensionId,
        fnName,
        ...args.map((a: any) => crxStripUncloneable(a)),
      )
    } catch (e) {
      // This legacy isolated-world path swallows IPC errors to undefined. It is
      // now a FALLBACK only: the main-world `invokeExtension` wrapper prefers
      // `invokeExtensionRaw` (which rejects on error) and brackets the trailing
      // callback with chrome.runtime.lastError — so every factory API call
      // surfaces errors per Chrome. This path is only hit when rawFn is absent
      // (it never is, both live in the same electronContext) or for the few
      // direct callers like connectNative.
      console.error(e)
      result = undefined
    }
    // Legacy path swallows errors; also swallow the apiError() sentinel.
    if (result && typeof result === 'object' && typeof result.__crxApiError === 'string') {
      result = undefined
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(fnName, '(result)', result)
    }

    if (callback) {
      callback(result)
    } else {
      return result
    }
  }

  // Like invokeExtension, but REJECTS on failure instead of swallowing the error
  // to `undefined`, and does NOT handle a trailing callback. The main-world API
  // wrappers use this so they can surface chrome.runtime.lastError on a failed
  // callback — the isolated preload world can't set the main world's
  // chrome.runtime, so the caller (mainWorldScript's invokeExtension) drives the
  // callback and brackets it with lastError itself.
  const invokeExtensionRaw = async function (
    extensionId: string,
    fnName: string,
    options: ExtensionMessageOptions = {},
    ...args: any[]
  ) {
    if (options.noop) return options.defaultResponse
    if (options.serialize) args = options.serialize(...args)
    let result: any
    try {
      result = await ipcRenderer.invoke(
        'crx-msg',
        extensionId,
        fnName,
        ...args.map((a: any) => crxStripUncloneable(a)),
      )
    } catch (err: any) {
      // ipcRenderer.invoke wraps handler errors as
      // "Error invoking remote method 'crx-msg': Error: <message>". Chrome
      // surfaces the bare message (extensions string-match on e.g.
      // "Receiving end does not exist"), so unwrap it here for every caller.
      const raw = String((err && err.message) || err || `${fnName} failed`)
      const message = raw
        .replace(/^Error invoking remote method '[^']*':\s*/, '')
        .replace(/^Error:\s*/, '')
      throw new Error(message || `${fnName} failed`)
    }
    // Handlers signal routine API errors (e.g. tabs.sendMessage with no
    // receiver) with a sentinel instead of throwing, so the main process does
    // not log every one of them; see apiError() in messaging.ts.
    if (result && typeof result === 'object' && typeof result.__crxApiError === 'string') {
      throw new Error(result.__crxApiError)
    }
    return result
  }

  // A long-lived Promise returned directly through contextBridge can be
  // observed as an already-resolved `undefined` by some extension contexts.
  // Keep the Promise in the page world and settle it through this callback
  // bridge only after the main-process OAuth handler really completes.
  const launchIdentityWebAuthFlow = (
    extensionId: string,
    details: { url: string; interactive?: boolean },
    complete: (packet: { ok: boolean; value?: string; error?: string }) => void,
  ) => {
    ipcRenderer.invoke('crx-msg', extensionId, 'identity.launchWebAuthFlow', details).then(
      (value: any) => {
        try {
          if (typeof value === 'string' && value) {
            complete({ ok: true, value })
          } else {
            complete({ ok: false, error: 'identity.launchWebAuthFlow returned no redirect URL' })
          }
        } catch {
          /* page context was destroyed */
        }
      },
      (error: any) => {
        try {
          complete({
            ok: false,
            error: String((error && error.message) || error || 'identity.launchWebAuthFlow failed'),
          })
        } catch {
          /* page context was destroyed */
        }
      },
    )
  }

  type ConnectNativeCallback = (connectionId: string, send: (message: any) => void) => void
  const connectNative = (
    extensionId: string,
    application: string,
    receive: (message: any) => void,
    disconnect: () => void,
    callback: ConnectNativeCallback,
  ) => {
    if (typeof application !== 'string' || application.length === 0) {
      throw new TypeError('runtime.connectNative requires a native application name')
    }
    const connectionId = (contextBridge as any).executeInMainWorld({
      func: () => crypto.randomUUID(),
    })
    // Install the IPC listeners before asking the browser process to create
    // the host. A manifest/permission failure can disconnect synchronously;
    // registering afterwards loses that event and leaves Chrome's Port in a
    // permanently connecting state.
    const onMessage = (_event: Electron.IpcRendererEvent, message: any) => {
      receive(message)
    }
    let cleanedUp = false
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      ipcRenderer.off(`crx-native-msg-${connectionId}`, onMessage)
      ipcRenderer.off(`crx-native-msg-${connectionId}-disconnect`, onDisconnect)
    }
    const onDisconnect = () => {
      cleanup()
      disconnect()
    }
    ipcRenderer.on(`crx-native-msg-${connectionId}`, onMessage)
    ipcRenderer.on(`crx-native-msg-${connectionId}-disconnect`, onDisconnect)
    const send = (message: any) => {
      // Native Messaging uses JSON serialization, not Electron's structured
      // clone. This also protects direct preload callers from enumerable
      // methods commonly attached to native-host task objects.
      ipcRenderer.send(`crx-native-msg-${connectionId}`, crxSerializeMessage(message))
    }
    callback(connectionId, send)

    // The main-process handler reports launch/configuration failures through
    // the Port disconnect event. Also handle an IPC rejection here: this is
    // the same terminal transition, so the callback remains idempotent.
    void invokeExtensionRaw(extensionId, 'runtime.connectNative', {}, connectionId, application).catch(() => {
      cleanup()
      disconnect()
    })
  }

  const disconnectNative = (extensionId: string, connectionId: string) => {
    invokeExtension(extensionId, 'runtime.disconnectNative', {}, connectionId)
  }

  // ---- Generic extension messaging (runtime/tabs sendMessage + Port) -------
  // These bridge the extension page / service-worker context to the main
  // process messaging hub (browser/api/messaging.ts) over raw IPC. They live on
  // the electron context (not the main world) because mainWorldScript has no
  // direct ipcRenderer handle, mirroring connectNative above.

  let portUidCounter = 0

  // crxStripUncloneable is defined at MODULE TOP LEVEL (above injectExtensionAPIs)
  // so every nested factory scope — including the native onMessage wrapper, which
  // webpack/terser otherwise split into a scope that could not see a function-body
  // local (hit at runtime as "crxStripUncloneable is not defined") — can reference it.

  /**
   * Open a Port from this context to the extension's background (SW).
   * Follows the connectNative callback pattern so all functions cross the
   * contextBridge as arguments (return values containing functions are fragile).
   */
  const portConnect = (
    extensionId: string,
    name: string,
    receive: (message: any) => void,
    disconnect: () => void,
    ready: (send: (m: any) => void, close: () => void) => void,
  ) => {
    ipcRenderer
      .invoke('crx-port-connect', extensionId, { name })
      .then((portId: string) => {
        if (!portId) {
          disconnect()
          return
        }
        const msgChan = `crx-port-post:${portId}`
        const disChan = `crx-port-disconnect:${portId}`
        const onMsg = (_e: Electron.IpcRendererEvent, message: any) => receive(message)
        const onDis = () => {
          ipcRenderer.off(msgChan, onMsg)
          ipcRenderer.off(disChan, onDis)
          disconnect()
        }
        ipcRenderer.on(msgChan, onMsg)
        ipcRenderer.once(disChan, onDis)
        ready(
          (m: any) => crxSendPortMessage(portId, m),
          () => {
            ipcRenderer.off(msgChan, onMsg)
            ipcRenderer.off(disChan, onDis)
            ipcRenderer.send('crx-port-disconnect', portId)
          },
        )
      })
      .catch((e: any) => {
        console.error('crx-port-connect failed', e)
        disconnect()
      })
  }

  /**
   * Accept an inbound Port (delivered via a 'runtime.onConnect' event carrying a
   * portId) and bind send/receive over its channels.
   */
  const portAccept = (
    portId: string,
    receive: (message: any) => void,
    disconnect: () => void,
    ready: (send: (m: any) => void, close: () => void) => void,
  ) => {
    const msgChan = `crx-port-post:${portId}`
    // Directional channel: when a tabs.connect caller has a resolvable owner
    // frame (MV2 persistent background page, or a popup/options page),
    // connectToTab sets entry.ownerFrame and onPortPost delivers the
    // content→owner direction on `crx-port-post-to-owner:<portId>` instead of
    // the legacy `crx-port-post:<portId>`. Subscribe to both so the owner
    // receives regardless of which channel the hub picks (mirrors the frame
    // side in view-preload, which listens on both). Without this, the
    // content→background echo of a bg.tabs.connect Port is silently dropped
    // for MV2 background pages (the Port appears to time out).
    const ownerMsgChan = `crx-port-post-to-owner:${portId}`
    const disChan = `crx-port-disconnect:${portId}`
    const onMsg = (_e: Electron.IpcRendererEvent, message: any) => receive(message)
    const onDis = () => {
      ipcRenderer.off(msgChan, onMsg)
      ipcRenderer.off(ownerMsgChan, onMsg)
      ipcRenderer.off(disChan, onDis)
      disconnect()
    }
    ipcRenderer.on(msgChan, onMsg)
    ipcRenderer.on(ownerMsgChan, onMsg)
    ipcRenderer.once(disChan, onDis)
    // Tell the hub this end is ready to receive buffered messages.
    ipcRenderer.send('crx-port-accept', portId)
    ready(
      (m: any) => crxSendPortMessage(portId, m),
      () => {
        ipcRenderer.off(msgChan, onMsg)
        ipcRenderer.off(ownerMsgChan, onMsg)
        ipcRenderer.off(disChan, onDis)
        ipcRenderer.send('crx-port-disconnect', portId)
      },
    )
  }

  /** Reject an inbound Port when the target context has no onConnect listener. */
  const portReject = (portId: string) => {
    ipcRenderer.send('crx-port-reject', portId, 'no-listener')
  }

  const tabsPortConnect = (
    extensionId: string,
    tabId: number | undefined,
    info: { name?: string; frameId?: number } | undefined,
    receive: (message: any) => void,
    disconnect: (error?: string) => void,
    ready: (send: (m: any) => void, close: () => void) => void,
  ) => {
    const noReceiver = 'Could not establish connection. Receiving end does not exist.'
    ipcRenderer
      .invoke('crx-msg', extensionId, 'tabs.connect', tabId, {
        name: info?.name || '',
        frameId: info?.frameId,
      })
      .then((portId: string) => {
        if (!portId) {
          disconnect(noReceiver)
          return
        }
        portAccept(portId, receive, () => disconnect(), ready)
      })
      .catch((e: any) => {
        console.error('crx-tabs-connect failed', e)
        disconnect(noReceiver)
      })
  }

  const sendRuntimeMessage = (extensionId: string, message: any) => {
    let serialized: any
    try {
      serialized = crxSerializeMessage(message)
    } catch {
      serialized = undefined
    }
    const p = ipcRenderer.invoke('crx-runtime-message', extensionId, serialized)
    // Attach an observer without changing the returned Promise. Chrome 148
    // propagates a rejected onMessage listener to the sendMessage caller.
    p.then(undefined, () => {})
    return p
  }

  const sendMessageResponse = (messageId: string, response: any, error?: string) => {
    let serialized = response
    try {
      // `undefined` is the bridge's no-response sentinel. Chrome JSON-coerces
      // actual response values, but the sentinel must remain distinguishable
      // so another listener/frame can still provide the first real response.
      if (response !== undefined) serialized = crxSerializeMessage(response)
    } catch {
      serialized = undefined
    }
    // This function is commonly called from a listener Promise continuation.
    // Electron throws synchronously when any argument is not structured-cloneable;
    // allowing that throw to escape would reject the continuation and surface as
    // the recurring renderer-level "An object could not be cloned" error. The
    // response channel is best-effort, just like Chrome when its sender closed.
    try {
      ipcRenderer.send('crx-cs-message-response', messageId, serialized, error)
    } catch (error) {
      try {
        console.warn('[crx-runtime] response IPC dropped', error)
      } catch {
        /* diagnostics must never affect extension execution */
      }
      // Complete the request with Chrome's no-response value when the payload
      // itself cannot cross the bridge. This is preferable to leaving the
      // content caller pending until its transport timeout.
      try {
        ipcRenderer.send('crx-cs-message-response', String(messageId), undefined)
      } catch {
        /* sender/receiver may already be gone */
      }
    }
  }

  // Synchronously fetch this extension's i18n catalog (messages + UI locale).
  // chrome.i18n.getMessage is synchronous, so the page loads the whole catalog
  // once and resolves locally. Resolved in the main process from the extension's
  // _locales for the browser UI language (see browser/api/i18n.ts).
  // sendSync works in frames but NOT in service workers (their IPC is async and
  // routed through sw.ipc), so getI18nAsync is the fallback used to prime the
  // catalog in the background service worker.
  const getI18n = (extensionId: string) => {
    // sendSync is a blocking IPC. In a service worker it has no reachable
    // handler (the SW's IPC is async, routed through sw.ipc, while the
    // 'crx-i18n' sync handler lives on the global ipcMain). Calling it here
    // would block the worker's STARTUP thread until Chromium's 30s
    // StartTimeoutTimer fires — the ~30s extension-background startup stall.
    // Service workers prime their catalog asynchronously via getI18nAsync, so
    // skip the sync path entirely in that context.
    if ((process as any).type === 'service-worker') {
      return null
    }
    try {
      return ipcRenderer.sendSync('crx-i18n', extensionId)
    } catch {
      return null
    }
  }
  const getI18nAsync = (extensionId: string) => {
    try {
      return ipcRenderer.invoke('crx-i18n-async', extensionId)
    } catch {
      return Promise.resolve(null)
    }
  }

  // chrome.runtime.getPlatformInfo is not implemented by Electron's native
  // extension runtime, so extensions that call it during startup (e.g. for
  // engine/region configuration) throw and abort. Compute it once here in the
  // preload's node context — process.platform/arch are unavailable in the
  // self-contained mainWorldScript — and bridge the result through.
  const platformInfo = (() => {
    const osMap: Record<string, string> = {
      win32: 'win',
      darwin: 'mac',
      linux: 'linux',
      android: 'android',
      freebsd: 'openbsd',
      openbsd: 'openbsd',
      sunos: 'linux',
      aix: 'linux',
    }
    const archMap: Record<string, string> = {
      x64: 'x86-64',
      ia32: 'x86-32',
      arm: 'arm',
      arm64: 'arm64',
      mips: 'mips',
      mips64: 'mips64',
    }
    let os = 'linux'
    let arch = 'x86-64'
    try {
      os = osMap[process.platform] || 'linux'
      arch = archMap[process.arch] || 'x86-64'
    } catch {
      // process unavailable — fall back to win/x86-64 defaults below
    }
    return { os, arch, nacl_arch: arch }
  })()

  // Relay native chrome.storage.onChanged from the extension's background
  // context to the main process, which broadcasts it to every frame so
  // content-script chrome.storage.onChanged fires (see content-bridge.ts).
  // Lives on the electron context because mainWorldScript has no direct
  // ipcRenderer handle.
  const notifyStorageChanged = (extensionId: string, area: string, changes: any) => {
    try {
      ipcRenderer.send('crx-storage-changed', extensionId, area, changes)
    } catch {
      /* best-effort */
    }
  }

  let workerInboundPump = false
  let workerInboundWakePending = false
  const ensureWorkerInboundPump = () => {
    if ((process as any).type !== 'service-worker') return false
    if (workerInboundPump) {
      workerInboundWakePending = true
      return true
    }
    workerInboundPump = true
    workerInboundWakePending = false
    void (async () => {
      try {
        while (workerInboundPump) {
          const packet = await ipcRenderer.invoke('crx-worker-next-event')
          // A null packet means the host pull timed out while the worker had
          // no active Port. It is an idle boundary, not a transport failure.
          // Stop here so the worker can follow MV3's normal idle lifecycle;
          // the host sends crx-worker-wake when a new packet is queued.
          if (!packet || typeof packet.channel !== 'string' || !Array.isArray(packet.args)) break
          ipcRenderer.emit(packet.channel, {} as Electron.IpcRendererEvent, ...packet.args)
        }
      } catch {
        /* the worker is stopping or the generation has been evicted */
      } finally {
        workerInboundPump = false
        // A wake can race the idle invoke response: in that window the old
        // pump is still marked active even though the host has already queued
        // the next event. Resume only after the old loop has fully unwound.
        if (workerInboundWakePending) {
          workerInboundWakePending = false
          ensureWorkerInboundPump()
        }
      }
    })()
    return true
  }

  const notifyWorkerReady = (details?: any) => {
    if ((process as any).type !== 'service-worker') return
    try {
      const readyDetails = details || { protocol: WORKER_INBOUND_PROTOCOL }
      ipcRenderer.send('crx-worker-ready', readyDetails)
      ensureWorkerInboundPump()
    } catch {
      /* the worker may already be stopping */
    }
  }

  if ((process as any).type === 'service-worker') {
    // The pull pump intentionally stops at an idle boundary. This private
    // preload-only signal restarts it only when the host has queued work.
    ipcRenderer.on('crx-worker-wake', () => {
      // The host can bind its worker IPC listeners after the first bootstrap
      // ready signal (notably across a starting -> running transition). A
      // wake is also a safe readiness probe, so replay the handshake for the
      // currently live worker generation. notifyWorkerReady also starts or
      // resumes the pull pump, including the wake-during-pull race.
      notifyWorkerReady({ protocol: WORKER_INBOUND_PROTOCOL })
    })
  }

  const electronContext = {
    autofillVerbose: crxAutofillVerbose,
    invokeExtension,
    invokeExtensionRaw,
    launchIdentityWebAuthFlow,
    addExtensionListener,
    removeExtensionListener,
    connectNative,
    disconnectNative,
    portConnect,
    portAccept,
    portReject,
    tabsPortConnect,
    sendRuntimeMessage,
    sendMessageResponse,
    notifyStorageChanged,
    notifyWorkerReady,
    getI18n,
    getI18nAsync,
    platformInfo,
  }

  // Function body to run in the main world.
  // IMPORTANT: This must be self-contained, no closure variable will be included!
  function mainWorldScript(runtimeContextType: RuntimeContextTypeMap) {
    // Use context bridge API or closure variable when context isolation is disabled.
    // `typeof` guard: when serialized into the main world the closure name is
    // unbound, and a bare reference would throw instead of falling back.
    const electron =
      ((globalThis as any).electron as typeof electronContext) ||
      (typeof electronContext !== 'undefined' ? electronContext : (undefined as any))
    const deferTask = (fn: () => void, delay = 0) => {
      if (delay > 0) {
        setTimeout(fn, delay)
      } else {
        Promise.resolve().then(fn)
      }
    }

    const chrome = globalThis.chrome || {}
    const syncBrowserNamespaceAPIs = () => {
      try {
        const manifest = (chrome as any).runtime?.getManifest?.()
        const browser = (globalThis as any).browser
        if (manifest?.manifest_version !== 3 || !browser || browser === chrome) return
        if (manifest.devtools_page) {
          let chromiumMajor = 0
          try {
            const match = String((globalThis as any).navigator?.userAgent || '').match(
              /(?:Chrome|Chromium)\/(\d+)/,
            )
            chromiumMajor = match ? Number(match[1]) : 0
          } catch {}
          if (chromiumMajor >= 148 && chromiumMajor < 152) return
        }
        for (const key of Object.getOwnPropertyNames(chrome)) {
          if (key.startsWith('__crx')) continue
          let value: any
          try {
            value = (chrome as any)[key]
            if (browser[key] === value) continue
          } catch {
            continue
          }
          try {
            Object.defineProperty(browser, key, {
              value,
              configurable: true,
              enumerable: true,
              writable: true,
            })
          } catch {
            try {
              browser[key] = value
            } catch {
              /* native property is locked */
            }
          }
        }
      } catch {
        /* namespace synchronization must never block extension startup */
      }
    }
    const runtimeMessageErrorText = (error: any) =>
      String(
        (error && error.message) || error || 'An extension message listener rejected its Promise.',
      )
    // Keep this helper inside mainWorldScript: executeInMainWorld serializes the
    // function without closure variables. Chrome JSON-serializes Native
    // Messaging payloads, which omits enumerable functions before they cross
    // the context bridge (FDM task objects contain such methods).
    const serializeNativeMessage = (value: any): any => {
      const serialized = JSON.stringify(value)
      return serialized === undefined ? undefined : JSON.parse(serialized)
    }
    // Main-world copies of the module-level crx* helpers (same closure rule).
    const crxSerializeMessage = serializeNativeMessage
    const crxIsAutofillMessage = (message: any): boolean =>
      !!(
        (electron as any)?.autofillVerbose === true &&
        message &&
        typeof message === 'object' &&
        typeof message.command === 'string' &&
        /^(fillForm|triggerAutoSubmitLogin|collectPageDetails|collectPageDetailsResponse|bgCollectPageDetails|triggerAutofillScriptInjection|ignoreFieldFocus)$/.test(
          message.command,
        )
      )
    const crxAutofillLog = (...args: any[]) => {
      try {
        console.warn('[crx-autofill]', ...args)
      } catch {}
    }
    const WORKER_INBOUND_PROTOCOL = 3
    const isWorkerContext =
      typeof (globalThis as any).serviceWorker !== 'undefined' ||
      (typeof window === 'undefined' &&
        typeof (globalThis as any).document === 'undefined')

    // In an MV3 service worker, Chromium bootstraps parts of `chrome.runtime`
    // asynchronously after our preload crosses into the main world. Running the
    // full namespace patch against a throwaway/half-ready object is worse than
    // waiting a tick: extensions can cache that early object and miss later
    // fixes. Dedicated early SW patches (tabs/windows/runtime messaging/storage)
    // cover the boot window; defer the full patch until runtime identity is
    // ready, matching Chrome's "live chrome object becomes usable" behavior.
    if (isWorkerContext) {
      const runtime = (chrome as any).runtime
      if (
        !runtime ||
        typeof runtime.id !== 'string' ||
        !runtime.id ||
        typeof runtime.getManifest !== 'function'
      ) {
        return
      }
    }

    // Sentinel: if this exact chrome object was already patched by an earlier
    // execution this context, bail out. Keeps re-runs idempotent (the SW poll
    // harness and the legacy immediate-inject fallback may both fire).
    if ((chrome as any).__crxPatched) {
      syncBrowserNamespaceAPIs()
      return
    }

    const extensionId = chrome.runtime?.id

    // NOTE: This uses a synchronous IPC to get the extension manifest.
    // To avoid this, JS bindings for RendererExtensionRegistry would be
    // required.
    // OFFSCREEN_DOCUMENT contexts do not have this function defined.
    const manifest: chrome.runtime.Manifest =
      (extensionId && chrome.runtime.getManifest?.()) || ({} as any)

    // Chrome binds permission-gated namespaces when the permission is either
    // required or optional (optional ones then throw until granted). With no
    // readable manifest, keep the namespace so degraded contexts behave as before.
    const manifestDeclaresPermission = (permission: string): boolean => {
      if (!manifest.manifest_version) return true
      const required = (manifest.permissions as string[] | undefined) || []
      const optional = (manifest.optional_permissions as string[] | undefined) || []
      return required.includes(permission) || optional.includes(permission)
    }

    // LAZY extension id. chrome.runtime.id bootstraps asynchronously (SW main
    // world for certain; popup/options during early native bootstrap too), so
    // the closure-captured `extensionId` (above) can be undefined when
    // mainWorldScript runs early. Binding it once into every invokeExtension /
    // addExtensionListener closure would permanently route every call and every
    // event registration to a phantom extension → main router rejects "unknown
    // extension context" → action APIs resolve silent undefined (the "popup
    // tabs.create does nothing" symptom; same failure for tabs.update/remove,
    // cookies.set, bookmarks.create, runtime.onMessage listeners, …). Resolve
    // at CALL time instead — by the time an API/listener is actually used,
    // runtime.id is ready. extId() is used everywhere below that previously
    // closed over the bare `extensionId`.
    const extId = () => (chrome.runtime && chrome.runtime.id) || extensionId

    // Electron does not expose Chromium's extension URLLoader to MV3 service
    // workers.  A cross-origin fetch with non-simple headers (for example a
    // WebDAV PROPFIND carrying Authorization/Depth) therefore performs a CORS
    // preflight in the worker and fails when the server answers OPTIONS with
    // 401.  Route HTTP(S) requests through the main-process session instead;
    // the session uses Chromium's network stack and host-permission checks are
    // applied by the corresponding IPC handler.
    try {
      const g: any = globalThis as any
      if (
        typeof g.fetch === 'function' &&
        typeof g.Request === 'function' &&
        typeof g.Response === 'function' &&
        !g.__crxExtensionFetchPatched &&
        typeof location !== 'undefined' &&
        location.protocol === 'chrome-extension:'
      ) {
        const nativeFetch = g.fetch.bind(g)

        const toBase64 = (buffer: ArrayBuffer) => {
          const bytes = new Uint8Array(buffer)
          let binary = ''
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          }
          return btoa(binary)
        }

        const extensionFetch = async (input: any, init?: any) => {
          const request = new g.Request(input, init)
          let target: URL
          try {
            target = new URL(request.url)
          } catch {
            return nativeFetch(input, init)
          }

          // Keep extension-local resources and non-HTTP schemes on native fetch.
          if (!/^https?:$/.test(target.protocol)) return nativeFetch(input, init)
          // Preserve Fetch's opaque/no-cors and same-origin behavior. The
          // privileged bridge is only needed for normal CORS requests.
          if (request.mode !== 'cors') return nativeFetch(input, init)
          // Electron's Session.fetch currently rejects manual redirects rather
          // than returning a redirect response. Keep the browser-native path
          // for this mode so extensions retain Fetch's opaqueredirect behavior.
          if (request.redirect === 'manual') return nativeFetch(input, init)

          if (request.signal?.aborted) {
            throw new DOMException('The operation was aborted.', 'AbortError')
          }

          const bodyBase64 =
            request.method !== 'GET' && request.method !== 'HEAD'
              ? toBase64(await request.arrayBuffer())
              : ''
          const headers: Array<[string, string]> = []
          request.headers.forEach((value: string, name: string) => headers.push([name, value]))
          const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
          let bridgeStarted = false
          const cancelBridgeRequest = () => {
            void electron
              .invokeExtensionRaw(extId(), 'extension.fetch.cancel', {}, {requestId})
              .catch(() => {})
          }
          request.signal?.addEventListener('abort', cancelBridgeRequest, {once: true})

          try {
            if (request.signal?.aborted) {
              throw new DOMException('The operation was aborted.', 'AbortError')
            }
            bridgeStarted = true
            const packet = await electron.invokeExtensionRaw(
              extId(),
              'extension.fetch',
              {},
              {
                url: request.url,
                method: request.method,
                headers,
                bodyBase64,
                redirect: request.redirect,
                credentials: request.credentials,
                cache: request.cache,
                referrer: request.referrer,
                requestId,
              },
            )
            if (!packet || packet.__crxExtensionFetch !== true) {
              throw new Error('extension.fetch bridge returned an invalid response')
            }
            const body = packet.bodyBase64
              ? Uint8Array.from(atob(packet.bodyBase64), (char) => char.charCodeAt(0))
              : undefined
            const response = new g.Response(body, {
              status: packet.status,
              statusText: packet.statusText || '',
              headers: packet.headers || [],
            })
            try {
              Object.defineProperties(response, {
                url: { value: packet.url || '', configurable: true },
                redirected: { value: packet.redirected === true, configurable: true },
              })
            } catch {
              /* response metadata is best-effort */
            }
            return response
          } catch (error: any) {
            if (request.signal?.aborted) {
              throw new DOMException('The operation was aborted.', 'AbortError')
            }
            const message = String(error?.message || error || '')
            // Permission/validation failures happen before the main-process
            // request is sent, so retain native fetch's CORS/permission error.
            // Once the bridge has started a request, never issue a second
            // network request (important for PUT/PROPFIND and other writes).
            if (bridgeStarted && !message.includes('extension.fetch preflight:')) {
              throw new TypeError(message || 'Failed to fetch')
            }
            try {
              request.signal?.removeEventListener('abort', cancelBridgeRequest)
            } catch {}
            return nativeFetch(input, init)
          } finally {
            try {
              request.signal?.removeEventListener('abort', cancelBridgeRequest)
            } catch {}
          }
        }

        Object.defineProperty(g, '__crxExtensionFetchPatched', {
          value: true,
          configurable: true,
        })
        g.fetch = extensionFetch
      }
    } catch {
      // Never prevent extension startup if the host lacks a standard fetch API.
    }

    // Content-script chrome.storage tunnel (see content-bridge.ts). A normal web
    // page has no native chrome.storage, so the content-script bridge marshals
    // every storage op into a runtime.sendMessage envelope ({__crxStorageOp}).
    // It lands here — the extension context that owns the REAL native store
    // (SW/background/extension page) — where we execute it against
    // chrome.storage[area] and reply with {value} or {__crxStorageErr}. This
    // gives content scripts the SAME store the background uses, per Chrome.
    // Returns true (and calls respond asynchronously) if it handled the message.
    const handleStorageOp = (message: any, respond: (r: any) => void): boolean => {
      if (!message || message.__crxStorageOp !== true) return false
      const done = (r: any) => {
        try {
          respond(r)
        } catch {
          /* channel closed */
        }
      }
      try {
        const st: any = (chrome as any).storage
        const areaObj = st && st[message.area]
        const fn = areaObj && areaObj[message.method]
        if (typeof fn !== 'function') {
          done({ __crxStorageErr: `chrome.storage.${message.area}.${message.method} unavailable` })
          return true
        }
        // Invoke with a callback (works in BOTH MV2 callback-style and MV3,
        // where Chrome runs the callback in addition to returning a Promise)
        // AND honor a returned Promise — whichever settles first wins (done()
        // is idempotent). This covers MV2 background pages whose native
        // chrome.storage.get(keys, cb) returns undefined, not a thenable.
        let settled = false
        const finish = (r: any) => {
          if (settled) return
          settled = true
          done(r)
        }
        const cb = (value: any) => {
          const rt: any = (chrome as any).runtime
          const lastErr = rt && rt.lastError
          if (lastErr) finish({ __crxStorageErr: String(lastErr.message || lastErr) })
          else finish({ value })
        }
        // clear()/get-all take (cb); get/getBytesInUse/set/remove take (arg, cb).
        const call =
          message.method === 'clear'
            ? fn.call(areaObj, cb)
            : fn.call(areaObj, message.arg, cb)
        if (call && typeof call.then === 'function') {
          call.then(
            (value: any) => finish({ value }),
            (err: any) => finish({ __crxStorageErr: String((err && err.message) || err) }),
          )
        }
      } catch (err: any) {
        done({ __crxStorageErr: String((err && err.message) || err) })
      }
      return true
    }

    // Relay native storage.onChanged from the ONE background context (SW for
    // MV3, persistent background page for MV2) to main, which broadcasts it to
    // every frame so content-script chrome.storage.onChanged fires. Gated to a
    // single owner so a change isn't relayed once per open extension page
    // (popup/options also receive native onChanged) → duplicate CS events.
    try {
      let isBgPage = false
      try {
        const bg: any = (manifest as any).background
        if (bg && typeof location !== 'undefined') {
          const p = location.pathname.replace(/^\/+/, '')
          if (bg.scripts && /(^|\/)_generated_background_page\.html$/.test(location.pathname)) {
            isBgPage = true
          }
          if (bg.page && p === String(bg.page).replace(/^\/+/, '')) isBgPage = true
        }
      } catch {
        /* manifest/location probe best-effort */
      }
      const st: any = (chrome as any).storage
      if ((isWorkerContext || isBgPage) && st && st.onChanged && st.onChanged.addListener) {
        st.onChanged.addListener((changes: any, area: string) => {
          const id = extId()
          if (id) electron.notifyStorageChanged(id, area, changes)
        })
      }
    } catch {
      /* never let the storage relay break startup */
    }

    // chrome.runtime.lastError: Chrome sets this during a failed API callback so
    // extensions can branch on it (a near-universal defensive pattern), then
    // clears it once the callback returns. Surface it on the (patched,
    // extensible) chrome.runtime object — `chrome` is frozen at the end of
    // mainWorldScript, but that freeze is shallow, so chrome.runtime itself
    // stays mutable. Best-effort: if runtime is a locked native object it's a
    // no-op, matching the previous behavior.
    const CRX_NO_RECEIVER_ERROR = 'Could not establish connection. Receiving end does not exist.'
    const crxSetLastError = (message?: string) => {
      try {
        const rt: any = (chrome as any).runtime
        if (rt) rt.lastError = message ? { message } : undefined
      } catch {
        /* runtime not writable in this context */
      }
    }

    const invokeExtension =
      (fnName: string, opts: ExtensionMessageOptions = {}) =>
      (...args: any[]) => {
        // Drive a trailing callback ourselves so we can bracket it with
        // chrome.runtime.lastError. invokeExtensionRaw REJECTS on failure (the
        // legacy invokeExtension swallows to undefined, so the error is
        // invisible); fall back to it when the raw bridge is unavailable.
        const cb = typeof args[args.length - 1] === 'function' ? args.pop() : undefined
        const rawFn = (electron as any).invokeExtensionRaw
        const p =
          typeof rawFn === 'function'
            ? Promise.resolve(rawFn(extId(), fnName, opts, ...args))
            : Promise.resolve(electron.invokeExtension(extId(), fnName, opts, ...args))
        if (!cb) {
          // Promise form (MV3). Chrome REJECTS the promise on an API error (it
          // does not set lastError for promise-form calls); surface the raw
          // rejection so extensions using try/await/catch behave as in Chrome.
          return p
        }
        // Callback form. Swallow listener throws (Chrome logs but doesn't crash)
        // and .catch the discarded promise so a throwing callback can't surface
        // as an unhandledRejection.
        p.then(
          (result: any) => {
            crxSetLastError(undefined)
            try {
              cb(result)
            } catch {
              /* listener threw — swallow, mirrors Chrome */
            } finally {
              crxSetLastError(undefined)
            }
          },
          (err: any) => {
            crxSetLastError((err && err.message) || `${fnName} failed`)
            try {
              cb(undefined)
            } catch {
              /* listener threw — swallow, mirrors Chrome */
            } finally {
              crxSetLastError(undefined)
            }
          },
        ).catch(() => {})
        return undefined
      }

    // chrome.desktopCapture / chrome.tabCapture stream ids are opaque tokens
    // issued by browser/api/capture.ts ("crx-desktop:…" / "crx-tab:…"). Chrome
    // lets any document of the issuing extension redeem one through
    // getUserMedia({ mandatory: { chromeMediaSource, chromeMediaSourceId } }).
    // Electron only understands its own desktopCapturer ids and per-consumer
    // WebContents ids, so translate the token at consume time — the main
    // process knows the real consumer frame only now.
    try {
      const md: any =
        typeof navigator !== 'undefined' ? (navigator as any).mediaDevices : undefined
      if (
        md &&
        typeof md.getUserMedia === 'function' &&
        !md.__crxCaptureIdsPatched &&
        typeof location !== 'undefined' &&
        location.protocol === 'chrome-extension:'
      ) {
        const nativeGetUserMedia = md.getUserMedia.bind(md)
        const CRX_STREAM_ID = /^crx-(desktop|tab):/
        const streamIdOf = (track: any): string | null => {
          if (!track || typeof track !== 'object') return null
          const id = track.mandatory?.chromeMediaSourceId ?? track.chromeMediaSourceId
          return typeof id === 'string' && CRX_STREAM_ID.test(id) ? id : null
        }
        const rewrite = (
          track: any,
          resolved: { kind: 'desktop' | 'tab'; sourceId: string },
          isAudio: boolean,
        ) => {
          const mandatory = { ...(track.mandatory || {}) }
          mandatory.chromeMediaSource = resolved.kind
          // Electron's desktop loopback audio takes no source id; a window
          // source id on the audio track makes the whole request fail.
          if (isAudio && resolved.kind === 'desktop') delete mandatory.chromeMediaSourceId
          else mandatory.chromeMediaSourceId = resolved.sourceId
          const next = { ...track, mandatory }
          delete next.chromeMediaSource
          delete next.chromeMediaSourceId
          return next
        }
        const crxGetUserMedia = async function (constraints?: any) {
          const videoId = streamIdOf(constraints?.video)
          const audioId = streamIdOf(constraints?.audio)
          const streamId = videoId || audioId
          if (!streamId) return nativeGetUserMedia(constraints)
          let resolved: { kind: 'desktop' | 'tab'; sourceId: string; audio: boolean }
          try {
            resolved = await invokeExtension('capture.resolveStreamId')(streamId, location.href)
          } catch {
            throw new DOMException('Invalid state', 'AbortError')
          }
          const next: any = { ...constraints }
          if (constraints.video && videoId) {
            next.video = rewrite(constraints.video, resolved, false)
          }
          if (constraints.audio) {
            // Chrome reports canRequestAudioTrack=false when the user did not
            // share audio; many recorders still ask for it unconditionally.
            // Drop the audio track instead of failing the whole capture.
            next.audio =
              resolved.audio && (audioId || resolved.kind === 'desktop')
                ? rewrite(constraints.audio, resolved, true)
                : false
          }
          return nativeGetUserMedia(next)
        }
        Object.defineProperty(md, 'getUserMedia', {
          value: crxGetUserMedia,
          configurable: true,
          writable: true,
        })
        Object.defineProperty(md, '__crxCaptureIdsPatched', { value: true })
      }
    } catch {
      /* mediaDevices unavailable in this context */
    }

    function imageData2base64(imageData: ImageData) {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      canvas.width = imageData.width
      canvas.height = imageData.height
      ctx.putImageData(imageData, 0, 0)

      return canvas.toDataURL()
    }

    class ExtensionEvent<T extends Function> implements chrome.events.Event<T> {
      private listeners: T[] = []

      constructor(private name: string) {}

      // Arrow class fields: bind `this` lexically to the instance. Extensions
      // reach these through webextension-polyfill, which (for namespaces absent
      // from its metadata, e.g. MV3 `action`) extracts and calls `addListener`
      // WITHOUT the event object as `this`. A prototype method would then see
      // `this.name === undefined` and register the listener under the wrong
      // event name — so chrome.action.onClicked / chrome.tabs.* listeners
      // silently never reach the router. Binding via arrow fields fixes that.
      //
      // webRequest 事件第二参是 URL filter(chrome.webRequest.onBeforeRequest
      // .addListener(cb,{urls:[...]},['blocking']))。之前只取 callback 把 filter
      // 丢了,vendored router 又忽略 filter → uBlock 的 WAR guard 对所有 URL 都触发
      // 并返回 {cancel:true} → 全站被拦。这里把 filter 透传给 addExtensionListener,
      // 由 event.ts 按 filter 决定该 listener 是否被调用(贴近 Chrome 原生语义)。
      addListener = (callback: T, filter?: any, _extraInfoSpec?: any) => {
        if (this.listeners.indexOf(callback) !== -1) return
        this.listeners.push(callback)
        electron.addExtensionListener(extId(), this.name, callback, filter, _extraInfoSpec)
      }
      removeListener = (callback: T) => {
        const index = this.listeners.indexOf(callback)
        if (index === -1) return
        this.listeners.splice(index, 1)
        electron.removeExtensionListener(extId(), this.name, callback)
      }

      getRules(callback: (rules: chrome.events.Rule[]) => void): void
      getRules(ruleIdentifiers: string[], callback: (rules: chrome.events.Rule[]) => void): void
      getRules(ruleIdentifiers: any, callback?: any) {
        const cb = typeof ruleIdentifiers === 'function' ? ruleIdentifiers : callback
        if (typeof cb === 'function') cb([])
      }
      hasListener(callback: T): boolean {
        return this.listeners.indexOf(callback) !== -1
      }
      removeRules(ruleIdentifiers?: string[] | undefined, callback?: (() => void) | undefined): void
      removeRules(callback?: (() => void) | undefined): void
      removeRules(ruleIdentifiers?: any, callback?: any) {
        const cb = typeof ruleIdentifiers === 'function' ? ruleIdentifiers : callback
        if (typeof cb === 'function') cb()
      }
      addRules(
        rules: chrome.events.Rule[],
        callback?: ((rules: chrome.events.Rule[]) => void) | undefined,
      ): void {
        if (typeof callback === 'function') callback(rules || [])
      }
      hasListeners(): boolean {
        return this.listeners.length > 0
      }
    }

    class Event<T extends Function> implements Partial<chrome.events.Event<T>> {
      private listeners: T[] = []

      _emit(...args: any[]) {
        // Return each listener's return value so callers can detect async
        // (MV3 Promise-based onMessage: a listener returns a Promise whose
        // resolved value should become the response). Callers that ignore the
        // return value are unaffected.
        const results: any[] = []
        this.listeners.forEach((listener) => {
          try {
            results.push(listener(...args))
          } catch (e) {
            results.push(undefined)
          }
        })
        return results
      }

      addListener(callback: T): void {
        this.listeners.push(callback)
      }
      removeListener(callback: T): void {
        const index = this.listeners.indexOf(callback)
        if (index > -1) {
          this.listeners.splice(index, 1)
        }
      }
      hasListener(callback: T): boolean {
        return this.listeners.indexOf(callback) !== -1
      }
      hasListeners(): boolean {
        return this.listeners.length > 0
      }
    }

    class NativePort implements chrome.runtime.Port {
      private connectionId: string = ''
      private connected = false
      private closed = false
      private pending: any[] = []

      name: string = ''

      _init = (connectionId: string, send: (message: any) => void) => {
        if (this.closed) return
        this.connected = true
        this.connectionId = connectionId
        this._send = send

        this.pending.forEach((msg) => send(msg))
        this.pending = []

        Object.defineProperty(this, '_init', { value: undefined })
      }

      _send(message: any) {
        if (this.closed) {
          throw new Error('Attempting to use a disconnected port')
        }
        this.pending.push(message)
      }

      _receive(message: any) {
        if (this.closed) return
        ;(this.onMessage as any)._emit(message)
      }

      _disconnect() {
        if (this.closed) return
        this.closed = true
        this.connected = false
        ;(this.onDisconnect as any)._emit(this)
      }

      postMessage(message: any) {
        this._send(serializeNativeMessage(message))
      }
      disconnect() {
        if (this.closed) return
        this.closed = true
        this.connected = false
        if (this.connectionId) {
          electron.disconnectNative(extId(), this.connectionId)
        }
      }
      onMessage: chrome.runtime.PortMessageEvent = new Event() as any
      onDisconnect: chrome.runtime.PortDisconnectEvent = new Event() as any
    }

    /**
     * Generic runtime/tabs Port backed by the main-process messaging hub.
     * Used for chrome.runtime.connect / onConnect / tabs.connect.
     */
    class GenericPort implements chrome.runtime.Port {
      name: string = ''
      sender?: chrome.runtime.MessageSender
      onMessage: chrome.runtime.PortMessageEvent = new Event() as any
      onDisconnect: chrome.runtime.PortDisconnectEvent = new Event() as any

      private connected = false
      private closed = false
      private pending: any[] = []
      private _send?: (message: any) => void
      private _close?: () => void

      /** Bind the transport once the main process has assigned a port. */
      _bind(send: (message: any) => void, close: () => void) {
        if (this.closed) {
          close()
          return
        }
        this.connected = true
        this._send = send
        this._close = close
        const pend = this.pending
        this.pending = []
        for (const m of pend) send(m)
      }

      _receive(message: any) {
        ;(this.onMessage as any)._emit(message, this)
      }

      /**
       * `error` is surfaced as chrome.runtime.lastError for the duration of the
       * onDisconnect listeners (Chrome sets it when the connection could not be
       * established, e.g. tabs.connect to a tab with no receiver).
       */
      _remoteDisconnect(error?: string) {
        if (this.closed) return
        this.closed = true
        this.connected = false
        if (error) crxSetLastError(error)
        try {
          ;(this.onDisconnect as any)._emit(this)
        } finally {
          if (error) crxSetLastError(undefined)
        }
      }

      postMessage(message: any) {
        // Chrome throws synchronously on a port that is already disconnected.
        if (this.closed) throw new Error('Attempting to use a disconnected port object')
        if (this.connected && this._send) this._send(message)
        else this.pending.push(message)
      }

      disconnect() {
        if (this.closed) return
        this.closed = true
        this.connected = false
        this._close?.()
      }
    }

    type DeepPartial<T> = {
      [P in keyof T]?: DeepPartial<T[P]>
    }

    type APIFactoryMap = {
      [apiName in keyof typeof chrome]: {
        shouldInject?: () => boolean
        factory: (
          base: DeepPartial<(typeof chrome)[apiName]>,
        ) => DeepPartial<(typeof chrome)[apiName]>
      }
    }

    const browserActionFactory = (base: DeepPartial<typeof globalThis.chrome.browserAction>) => {
      const api = {
        ...base,

        setTitle: invokeExtension('browserAction.setTitle'),
        getTitle: invokeExtension('browserAction.getTitle'),

        setIcon: invokeExtension('browserAction.setIcon', {
          serialize: (details: chrome.action.TabIconDetails) => {
            if (details.imageData) {
              // ImageData can't cross IPC; serialize it to a data URL. This
              // requires a DOM canvas, so it only works in contexts that have
              // `document` (popup/options pages). Service workers have no DOM
              // and no synchronous serialization path (OffscreenCanvas only
              // offers async convertToBlob) — there we must drop imageData and
              // fall back to `path`. Previously ALL mv3 callers were dropped;
              // now only the SW case is.
              const canConvert =
                typeof document !== 'undefined' && typeof ImageData !== 'undefined'
              if (!canConvert) {
                console.warn(
                  'action.setIcon with imageData is not supported in the service worker (no DOM); pass { path } instead.',
                )
                details.imageData = undefined
              } else if (details.imageData instanceof ImageData) {
                details.imageData = imageData2base64(details.imageData) as any
              } else {
                details.imageData = Object.entries(details.imageData).reduce(
                  (obj: any, pair: any[]) => {
                    obj[pair[0]] = imageData2base64(pair[1])
                    return obj
                  },
                  {},
                )
              }
            }

            return [details]
          },
        }),

        setPopup: invokeExtension('browserAction.setPopup'),
        getPopup: invokeExtension('browserAction.getPopup'),

        setBadgeText: invokeExtension('browserAction.setBadgeText'),
        getBadgeText: invokeExtension('browserAction.getBadgeText'),

        setBadgeBackgroundColor: invokeExtension('browserAction.setBadgeBackgroundColor'),
        getBadgeBackgroundColor: invokeExtension('browserAction.getBadgeBackgroundColor'),

        setBadgeTextColor: invokeExtension('browserAction.setBadgeTextColor'),
        getBadgeTextColor: invokeExtension('browserAction.getBadgeTextColor'),

        getUserSettings: invokeExtension('browserAction.getUserSettings'),

        // enable/disable/isEnabled take a bare tabId number (not {tabId}).
        isEnabled: invokeExtension('browserAction.isEnabled'),
        enable: invokeExtension('browserAction.enable'),
        disable: invokeExtension('browserAction.disable'),

        openPopup: invokeExtension('browserAction.openPopup'),

        onClicked: new ExtensionEvent('browserAction.onClicked'),
        // isOnToolbar is constant (no pinning), so this never fires — but the
        // event surface must exist so addListener doesn't throw.
        onUserSettingsChanged: new ExtensionEvent(
          'browserAction.onUserSettingsChanged',
        ),
      }

      return api
    }

    /**
     * Factories for each additional chrome.* API.
     */
    const apiDefinitions: Partial<APIFactoryMap> = {
      action: {
        // Chrome provides chrome.action to ALL mv3 extensions, even those
        // without an `action` manifest key (they just get no default icon).
        shouldInject: () => manifest.manifest_version === 3 && !!(manifest as any).action,
        factory: browserActionFactory,
      },

      browserAction: {
        shouldInject: () => manifest.manifest_version === 2 && !!manifest.browser_action,
        factory: browserActionFactory,
      },

      // chrome.pageAction (MV2). Many older extensions declare `page_action`
      // and call chrome.pageAction.* in their background; without this the
      // namespace is undefined and the background crashes on
      // `pageAction.onClicked.addListener` / `pageAction.show(tabId)`. Backed by
      // the same action backend as browser_action (setTitle/setIcon/setPopup/
      // onClicked); show/hide map to enable/disable (bare tabId, like Chrome).
      pageAction: {
        shouldInject: () =>
          manifest.manifest_version === 2 && !!(manifest as any).page_action,
        factory: (base) => {
          const api: any = browserActionFactory(base as any)
          api.show = api.enable
          api.hide = api.disable
          return api
        },
      },

      alarms: {
        shouldInject: () => manifestDeclaresPermission('alarms'),
        // Electron's native runtime has no chrome.alarms; back it with the
        // main-process AlarmsAPI. create() is fire-and-forget (callers don't
        // await); get/getAll/clear/clearAll resolve via the handler.
        factory: (base) => ({
          ...base,
          create: invokeExtension('alarms.create'),
          get: invokeExtension('alarms.get'),
          getAll: invokeExtension('alarms.getAll'),
          clear: invokeExtension('alarms.clear'),
          clearAll: invokeExtension('alarms.clearAll'),
          onAlarm: new ExtensionEvent('alarms.onAlarm'),
        }),
      },

      commands: {
        shouldInject: () => !manifest.manifest_version || !!(manifest as any).commands,
        factory: (base) => {
          return {
            ...base,
            getAll: invokeExtension('commands.getAll'),
            onCommand: new ExtensionEvent('commands.onCommand'),
          }
        },
      },

      contextMenus: {
        shouldInject: () => manifestDeclaresPermission('contextMenus'),
        factory: (base) => {
          let menuCounter = 0
          const menuCallbacks: {
            [key: string]: chrome.contextMenus.CreateProperties['onclick']
          } = {}
          const menuCreate = invokeExtension('contextMenus.create')

          let hasInternalListener = false
          const addInternalListener = () => {
            api.onClicked.addListener((info, tab) => {
              const callback = menuCallbacks[info.menuItemId]
              if (callback && tab) callback(info, tab)
            })
            hasInternalListener = true
          }

          const api = {
            ...base,
            create: function (
              createProperties: chrome.contextMenus.CreateProperties,
              callback?: Function,
            ) {
              if (typeof createProperties.id === 'undefined') {
                createProperties.id = `${++menuCounter}`
              }
              if (createProperties.onclick) {
                if (!hasInternalListener) addInternalListener()
                menuCallbacks[createProperties.id] = createProperties.onclick
                delete createProperties.onclick
              }
              menuCreate(createProperties, callback)
              return createProperties.id
            },
            update: invokeExtension('contextMenus.update'),
            remove: invokeExtension('contextMenus.remove'),
            removeAll: invokeExtension('contextMenus.removeAll'),
            onClicked: new ExtensionEvent<
              (info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab) => void
            >('contextMenus.onClicked'),
          }

          return api
        },
      },

      cookies: {
        shouldInject: () => manifestDeclaresPermission('cookies'),
        factory: (base) => {
          return {
            ...base,
            get: invokeExtension('cookies.get'),
            getAll: invokeExtension('cookies.getAll'),
            set: invokeExtension('cookies.set'),
            remove: invokeExtension('cookies.remove'),
            getAllCookieStores: invokeExtension('cookies.getAllCookieStores'),
            onChanged: new ExtensionEvent('cookies.onChanged'),
          }
        },
      },

      bookmarks: {
        shouldInject: () => manifestDeclaresPermission('bookmarks'),
        factory: (base) => {
          return {
            ...base,
            get: invokeExtension('bookmarks.get'),
            getChildren: invokeExtension('bookmarks.getChildren'),
            getRecent: invokeExtension('bookmarks.getRecent'),
            getTree: invokeExtension('bookmarks.getTree'),
            getSubTree: invokeExtension('bookmarks.getSubTree'),
            search: invokeExtension('bookmarks.search'),
            create: invokeExtension('bookmarks.create'),
            move: invokeExtension('bookmarks.move'),
            update: invokeExtension('bookmarks.update'),
            remove: invokeExtension('bookmarks.remove'),
            removeTree: invokeExtension('bookmarks.removeTree'),
            onCreated: new ExtensionEvent('bookmarks.onCreated'),
            onRemoved: new ExtensionEvent('bookmarks.onRemoved'),
            onChanged: new ExtensionEvent('bookmarks.onChanged'),
            onMoved: new ExtensionEvent('bookmarks.onMoved'),
            onChildrenReordered: new ExtensionEvent('bookmarks.onChildrenReordered'),
            onImportBegan: new ExtensionEvent('bookmarks.onImportBegan'),
            onImportEnded: new ExtensionEvent('bookmarks.onImportEnded'),
          }
        },
      },

      history: {
        shouldInject: () => manifestDeclaresPermission('history'),
        factory: (base) => {
          return {
            ...base,
            search: invokeExtension('history.search'),
            getVisits: invokeExtension('history.getVisits'),
            addUrl: invokeExtension('history.addUrl'),
            deleteUrl: invokeExtension('history.deleteUrl'),
            deleteRange: invokeExtension('history.deleteRange'),
            deleteAll: invokeExtension('history.deleteAll'),
            onVisited: new ExtensionEvent('history.onVisited'),
            onVisitRemoved: new ExtensionEvent('history.onVisitRemoved'),
          }
        },
      },

      // chrome.downloads — real backend in browser/api/downloads.ts (streams
      // via net.request, tracks state, fires onCreated/onChanged/onErased).
      // Replaces the former all-noop stub. setUiOptions/setShelfEnabled/drag have
      // no Electron meaning and stay no-ops; the rest are functional.
      downloads: {
        shouldInject: () => manifestDeclaresPermission('downloads'),
        factory: (base) => {
          return {
            ...base,
            acceptDanger: invokeExtension('downloads.acceptDanger'),
            cancel: invokeExtension('downloads.cancel'),
            download: invokeExtension('downloads.download'),
            erase: invokeExtension('downloads.erase'),
            getFileIcon: invokeExtension('downloads.getFileIcon'),
            open: invokeExtension('downloads.open'),
            pause: invokeExtension('downloads.pause'),
            removeFile: invokeExtension('downloads.removeFile'),
            resume: invokeExtension('downloads.resume'),
            search: invokeExtension('downloads.search'),
            setUiOptions: invokeExtension('downloads.setUiOptions', { noop: true }),
            setShelfEnabled: invokeExtension('downloads.setShelfEnabled', { noop: true }),
            show: invokeExtension('downloads.show'),
            showDefaultFolder: invokeExtension('downloads.showDefaultFolder'),
            drag: invokeExtension('downloads.drag', { noop: true }),
            onChanged: new ExtensionEvent('downloads.onChanged'),
            onCreated: new ExtensionEvent('downloads.onCreated'),
            onDeterminingFilename: new ExtensionEvent('downloads.onDeterminingFilename'),
            onErased: new ExtensionEvent('downloads.onErased'),
          }
        },
      },

      extension: {
        factory: (base) => {
          return {
            ...base,
            isAllowedFileSchemeAccess: invokeExtension('extension.isAllowedFileSchemeAccess', {
              noop: true,
              defaultResponse: false,
            }),
            isAllowedIncognitoAccess: invokeExtension('extension.isAllowedIncognitoAccess', {
              noop: true,
              defaultResponse: false,
            }),
            // TODO: Add native implementation
            getViews: () => [],
          }
        },
      },

      i18n: {
        // Cover MV2 and MV3. The previous stub hard-coded en-US and returned the
        // message key verbatim, so every extension that localizes through
        // chrome.i18n was stuck in English (Tampermonkey, for instance, picks its
        // UI language from getUILanguage()). Resolve the extension's real _locales
        // catalog for the browser UI language instead (see browser/api/i18n.ts).
        shouldInject: () => true,
        factory: (base) => {
          // navigator.language reflects the app UI language (Chromium honors the
          // app --lang preference), so it's the correct immediate fallback when the
          // catalog hasn't resolved yet — instead of hard-coding en-US.
          const navLang =
            (typeof navigator !== 'undefined' && navigator.language) || 'en-US'

          // Mutable so the async prime (service-worker path) can fill it in after
          // startup. getMessage/getUILanguage read `cat` live.
          let cat: any = {
            uiLocale: navLang,
            messageLocale: String(navLang).replace('-', '_'),
            messages: {},
          }
          const applyCat = (res: any) => {
            if (res && res.uiLocale) {
              cat = {
                uiLocale: res.uiLocale,
                messageLocale: res.messageLocale || cat.messageLocale,
                messages: res.messages || {},
              }
            }
          }

          // Frames (extension pages, popups, content scripts) resolve the catalog
          // synchronously.
          try {
            applyCat((electron as any).getI18n && (electron as any).getI18n(extId()))
          } catch (e) {}
          // Service workers can't use sync IPC (their IPC is async, routed through
          // sw.ipc), so prime asynchronously. Retry a few times to cover the race
          // where the SW preload runs before the SW ipc handler is attached.
          const primeAsync = (attempt: number) => {
            let p: any
            try {
              p = (electron as any).getI18nAsync && (electron as any).getI18nAsync(extId())
            } catch (e) {
              p = null
            }
            if (!p || typeof p.then !== 'function') return
            p.then(applyCat).catch(() => {
              if (attempt < 5) {
                try {
                  if (typeof globalThis.setTimeout === 'function') {
                    globalThis.setTimeout(() => primeAsync(attempt + 1), 150)
                    return
                  }
                } catch {
                  /* fall through to microtask retry */
                }
                Promise.resolve().then(() => primeAsync(attempt + 1))
              }
            })
          }
          primeAsync(0)

          // Chrome message substitution: named placeholders ($name$), then
          // positional $1..$9 from the substitutions arg, and $$ -> $.
          const substitute = (entry: any, subs: any) => {
            let msg = String(entry.message == null ? '' : entry.message)
            const placeholders = entry.placeholders || {}
            msg = msg.replace(/\$([a-zA-Z0-9_@]+)\$/g, (m: string, name: string) => {
              const ph = placeholders[name.toLowerCase()]
              return ph && ph.content != null ? ph.content : m
            })
            const args = subs == null ? [] : Array.isArray(subs) ? subs : [subs]
            msg = msg.replace(/\$(\$|[1-9])/g, (_m: string, p: string) => {
              if (p === '$') return '$'
              const v = args[parseInt(p, 10) - 1]
              return v == null ? '' : String(v)
            })
            return msg
          }

          const isRtl = () =>
            /^(ar|he|fa|ur|ps|sd|ug|yi)(?:[-_]|$)/i.test(cat.messageLocale || '')

          const getMessage = (messageName: string, substitutions?: any) => {
            const name = String(messageName || '')
            switch (name) {
              case '@@extension_id':
                return extId() || ''
              case '@@ui_locale':
                return cat.messageLocale || 'en'
              case '@@bidi_dir':
                return isRtl() ? 'rtl' : 'ltr'
              case '@@bidi_reversed_dir':
                return isRtl() ? 'ltr' : 'rtl'
              case '@@bidi_start_edge':
                return isRtl() ? 'right' : 'left'
              case '@@bidi_end_edge':
                return isRtl() ? 'left' : 'right'
            }
            const entry = cat.messages && cat.messages[name.toLowerCase()]
            if (entry) return substitute(entry, substitutions)
            // Fall back to any native implementation for keys we don't have.
            // `base` (native chrome.i18n) may be undefined in some contexts, so
            // guard it — otherwise a cache miss would throw mid-render.
            if (base && base.getMessage) {
              try {
                return base.getMessage(messageName, substitutions)
              } catch (e) {
                /* ignore */
              }
            }
            return ''
          }

          return {
            ...base,
            getMessage,
            getUILanguage: () => cat.uiLocale || navLang || 'en-US',
            getAcceptLanguages: (callback: any) => {
              const results = [cat.uiLocale || navLang || 'en-US']
              if (callback) {
                queueMicrotask(() => callback(results))
              }
              return Promise.resolve(results)
            },
          }
        },
      },

      notifications: {
        shouldInject: () => manifestDeclaresPermission('notifications'),
        factory: (base) => {
          return {
            ...base,
            clear: invokeExtension('notifications.clear'),
            create: invokeExtension('notifications.create'),
            getAll: invokeExtension('notifications.getAll'),
            getPermissionLevel: invokeExtension('notifications.getPermissionLevel'),
            update: invokeExtension('notifications.update'),
            onClicked: new ExtensionEvent('notifications.onClicked'),
            onButtonClicked: new ExtensionEvent('notifications.onButtonClicked'),
            onClosed: new ExtensionEvent('notifications.onClosed'),
          }
        },
      },

      permissions: {
        factory: (base) => {
          const requestPermission = invokeExtension('permissions.request')
          const request = (...args: any[]) => {
            const invoke = () => requestPermission(...args)
            const hasCallback = typeof args[args.length - 1] === 'function'

            // A native Electron permission prompt can suspend the extension
            // renderer. Give the initiating UI two frames to commit its state
            // transition first, matching Chrome's asynchronous prompt behavior.
            if (typeof requestAnimationFrame !== 'function') return invoke()

            const afterPaint = new Promise<void>((resolve) => {
              let settled = false
              const finish = () => {
                if (settled) return
                settled = true
                clearTimeout(fallback)
                resolve()
              }
              const fallback = setTimeout(finish, 100)
              requestAnimationFrame(() => requestAnimationFrame(finish))
            })

            if (hasCallback) {
              void afterPaint.then(invoke)
              return undefined
            }
            return afterPaint.then(invoke)
          }

          return {
            ...base,
            contains: invokeExtension('permissions.contains'),
            getAll: invokeExtension('permissions.getAll'),
            remove: invokeExtension('permissions.remove'),
            request,
            onAdded: new ExtensionEvent('permissions.onAdded'),
            onRemoved: new ExtensionEvent('permissions.onRemoved'),
          }
        },
      },

      privacy: {
        // chrome.privacy.{network,services,websites} — each leaf is a
        // chrome.types.ChromeSetting. Electron ships no native chrome.privacy,
        // and the old stub returned a no-op ChromeSetting (set/get/clear did
        // nothing, no onChange, only 6 of ~17 settings). That both (a) silently
        // dropped every set(), and (b) left chrome.privacy.network undefined in
        // contexts this factory does not reach (SW / sandboxed popup / content
        // script — covered by the SHIM block in extension-storage-patch.ts),
        // which crashed uBlock Origin's webext.js:144 reading
        // `chrome.privacy[category][setting]`.
        //
        // Now each setting routes get/set/clear to the main-process PrivacyAPI
        // (browser/api/privacy.ts) — persisted to userData/privacy-settings.json
        // and broadcasting privacy.<cat>.<name>.onChange. The router still
        // enforces the permission per method. invokeExtension handles
        // callback-or-promise.
        // Return typed `any` (like omnibox): @types/chrome has no chrome.privacy,
        // so the nested-function literal can't satisfy DeepPartial<any>'s index
        // signature — runtime shape is what matters here.
        //
        // Gated like Chrome: the namespace only exists when "privacy" is a
        // required or optional permission. Extensions feature-detect it
        // (`chrome.privacy && ...`), so exposing it unconditionally sends
        // them down code paths that assume the full native API.
        shouldInject: () => manifestDeclaresPermission('privacy'),
        factory: (base): any => {
          const mk = (cat: string, name: string) => ({
            get: invokeExtension(`privacy.${cat}.${name}.get`),
            set: invokeExtension(`privacy.${cat}.${name}.set`),
            clear: invokeExtension(`privacy.${cat}.${name}.clear`),
            onChange: new ExtensionEvent(`privacy.${cat}.${name}.onChange`),
          })
          return {
            ...base,
            network: {
              networkPredictionEnabled: mk('network', 'networkPredictionEnabled'),
              webRTCIPHandlingPolicy: mk('network', 'webRTCIPHandlingPolicy'),
              globalPrivacyControl: mk('network', 'globalPrivacyControl'),
            },
            services: {
              alternateErrorPagesEnabled: mk('services', 'alternateErrorPagesEnabled'),
              autofillAddressEnabled: mk('services', 'autofillAddressEnabled'),
              autofillCreditCardEnabled: mk('services', 'autofillCreditCardEnabled'),
              passwordSavingEnabled: mk('services', 'passwordSavingEnabled'),
              safeBrowsingEnabled: mk('services', 'safeBrowsingEnabled'),
              safeBrowsingExtendedReportingEnabled: mk(
                'services',
                'safeBrowsingExtendedReportingEnabled',
              ),
              searchSuggestEnabled: mk('services', 'searchSuggestEnabled'),
              spellingServiceEnabled: mk('services', 'spellingServiceEnabled'),
              translationServiceEnabled: mk('services', 'translationServiceEnabled'),
            },
            websites: {
              hyperlinkAuditingEnabled: mk('websites', 'hyperlinkAuditingEnabled'),
              referrersEnabled: mk('websites', 'referrersEnabled'),
              thirdPartyCookiesAllowed: mk('websites', 'thirdPartyCookiesAllowed'),
              cookieControlsEnabled: mk('websites', 'cookieControlsEnabled'),
              protectedContentEnabled: mk('websites', 'protectedContentEnabled'),
            },
          }
        },
      },

      proxy: {
        // This Electron build ships NO native chrome.proxy API. Back it with the
        // main-process ProxyAPI (browser/api/proxy.ts), which applies settings to
        // the browsing session via session.setProxy — so proxy extensions
        // (SwitchyOmega / ZeroOmega) both LOAD (getProxyImpl no longer throws, so
        // background init completes and the options/popup UI renders instead of
        // staying display:none) AND actually switch the proxy. set/clear/get route
        // over the crx-msg router; get returns the last-applied value with
        // levelOfControl. onChange is emitted by the host proxy coordinator.
        // Electron has no equivalent proxy-error stream, so onProxyError stays
        // a local no-op event. Generic: applies to every
        // extension that touches chrome.proxy. The SHIM (extension-storage-patch.ts)
        // routes the SAME calls over the electron bridge for the service-worker /
        // sandboxed contexts this factory does not reach.
        //
        // Only for extensions that declare "proxy" (required or optional),
        // matching Chrome. WXT-style code does `const p = chrome.proxy;
        // p && p.onRequest.addListener(...)`; a partial namespace without
        // onRequest crashes such a service worker at startup.
        shouldInject: () => manifestDeclaresPermission('proxy'),
        factory: (base) => {
          const noopEvent = () => ({
            addListener: () => {},
            removeListener: () => {},
            hasListener: () => false,
          })
          const settings = {
            set: invokeExtension('proxy.settings.set'),
            clear: invokeExtension('proxy.settings.clear'),
            get: invokeExtension('proxy.settings.get'),
            onChange: new ExtensionEvent('proxy.settings.onChange'),
          }
          return {
            ...base,
            settings,
            onProxyError: noopEvent(),
          }
        },
      },

      // chrome.omnibox — this host has no omnibox dropdown, so the namespace is
      // otherwise `undefined` and an extension page/background that calls
      // chrome.omnibox.onInputEntered.addListener(...) during top-level eval
      // throws "Cannot read properties of undefined" and aborts init. Pure
      // no-op (we never dispatch omnibox input). The SW gets its own copy via
      // the dedicated BEFORE-mainWorldScript patch (SW core-ns block); this
      // factory covers MV2 background pages and every other mainWorldScript
      // context (popup/options pages).
      omnibox: {
        shouldInject: () => !manifest.manifest_version || !!(manifest as any).omnibox,
        factory: (): any => {
          const noopEvt = () => ({
            addListener: () => {},
            removeListener: () => {},
            hasListener: () => false,
          })
          return {
            setDefaultSuggestion: () => {},
            onInputStarted: noopEvt(),
            onInputChanged: noopEvt(),
            onInputEntered: noopEvt(),
            onInputCancelled: noopEvt(),
            onInputAccepted: noopEvt(),
            onDeleteSuggestion: noopEvt(),
          }
        },
      },

      runtime: {
        factory: (base) => {
          // Electron natively provides runtime.connect/sendMessage/onConnect/
          // onMessage for messaging between an extension's own contexts
          // (popup/page <-> background).
          //
          // CRITICAL (MV2): for an MV2 extension the background is a PAGE and
          // that native path is the ONLY messaging path. Electron dispatches
          // incoming connections/messages through the native
          // chrome.runtime.onConnect / onMessage OBJECTS themselves — so if we
          // replace those objects with our own wrappers, native delivery
          // silently breaks and the popup's runtime.connect reports
          // "Could not establish connection. Receiving end does not exist."
          // (uBlock Origin's popup hits exactly this.) So for MV2 we leave
          // chrome.runtime completely untouched — pure native passthrough.
          //
          // MV3 only: dynamically-registered content scripts (scripting.ts /
          // user-scripts.ts) run in normal web pages and reach the background
          // SERVICE WORKER through our IPC hub (messaging.ts + content-bridge.ts)
          // rather than natively. For those we make onConnect/onMessage additive
          // so the bridged events also reach the listeners the SW registered.
          const runtimeApi = {
            ...base,
            // connect / sendMessage stay native (from base) — do not override.
            connectNative: (application: string) => {
              if (typeof application !== 'string' || application.length === 0) {
                throw new TypeError('runtime.connectNative requires a native application name')
              }
              const port = new NativePort()
              port.name = application
              const receive = port._receive.bind(port)
              const disconnect = port._disconnect.bind(port)
              const callback: ConnectNativeCallback = (connectionId, send) => {
                port._init(connectionId, send)
              }
              electron.connectNative(extId(), application, receive, disconnect, callback)
              return port
            },
            openOptionsPage: invokeExtension('runtime.openOptionsPage'),
            sendNativeMessage: (application: string, message: any, callback?: (response: any) => void) => {
              if (typeof application !== 'string' || application.length === 0) {
                throw new TypeError('runtime.sendNativeMessage requires a native application name')
              }
              const args: any[] = [application, serializeNativeMessage(message)]
              if (typeof callback === 'function') args.push(callback)
              return invokeExtension('runtime.sendNativeMessage')(...args)
            },
            // Electron's native runtime has no getPlatformInfo; provide one
            // backed by the preload-computed platformInfo. Supports both the
            // promise (MV3) and callback forms. Defers to a native impl if a
            // future Electron adds one.
            getPlatformInfo:
              base.getPlatformInfo ||
              ((callback?: (info: chrome.runtime.PlatformInfo) => void) => {
                const info = ((electron as any).platformInfo || {
                  os: 'win',
                  arch: 'x86-64',
                  nacl_arch: 'x86-64',
                }) as chrome.runtime.PlatformInfo
                if (typeof callback === 'function') {
                  callback(info)
                  return undefined
                }
                return Promise.resolve(info)
              }),
            onInstalled: new ExtensionEvent('runtime.onInstalled'),
            onStartup: new ExtensionEvent('runtime.onStartup'),
            // chrome.runtime.ContextType is a documented static enum present on
            // EVERY extension context (no permission gate). Extensions build a
            // ContextFilter from it, e.g.
            //   getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })
            // Electron's native runtime omits it, so without this the enum reads
            // undefined and getContexts() queries silently match nothing.
            ContextType: runtimeContextType as any,
          }

          // ---- Externally-connectable events (runtime.onMessageExternal /
          // onConnectExternal). Chrome: a web page on an origin listed in the
          // extension's manifest `externally_connectable.matches` can call
          // chrome.runtime.sendMessage(id, msg) / connect(id) (injected into the
          // page main world by view-preload). Main validates the origin
          // (messaging.ts isExternallyConnectable) and delivers here with a
          // web-page sender (id undefined). Registered for BOTH MV2 background
          // pages AND MV3 SWs — externally_connectable applies to both versions,
          // and these events are absent from Electron's native runtime, so they
          // never clash with the MV2 "leave native onConnect/onMessage alone"
          // rule below.
          const bridgedOnMessageExternal = new Event<
            (message: any, sender: any, sendResponse: (response?: any) => void) => boolean | void
          >()
          const onMessageExternal = {
            addListener: (cb: any) => bridgedOnMessageExternal.addListener(cb),
            removeListener: (cb: any) => bridgedOnMessageExternal.removeListener(cb),
            hasListener: (cb: any) => bridgedOnMessageExternal.hasListener(cb),
          }
          electron.addExtensionListener(
            extId(),
            'runtime.onMessageExternal',
            (payload: { messageId: string; message: any; sender: any }) => {
              try {
                console.warn(
                  `[crx-external] dispatch ext=${extId()} listeners=${
                    bridgedOnMessageExternal.hasListeners() ? 1 : 0
                  }`,
                )
              } catch {
                /* best-effort diagnostics */
              }
              let responded = false
              let asyncPending = false
              const sendResponse = (response?: any) => {
                if (responded) return
                responded = true
                electron.sendMessageResponse(payload.messageId, response)
              }
              const sendError = (error: any) => {
                if (responded) return
                responded = true
                electron.sendMessageResponse(
                  payload.messageId,
                  undefined,
                  runtimeMessageErrorText(error),
                )
              }
              const results = (bridgedOnMessageExternal as any)._emit(
                payload.message,
                payload.sender,
                sendResponse,
              ) as any[]
              // Honor Promise returns + `return true` async, mirroring onMessage.
              const promises = (Array.isArray(results) ? results : []).filter(
                (r) => r && typeof r.then === 'function',
              )
              const hasAsyncFlag = (Array.isArray(results) ? results : []).some(
                (r) => r === true,
              )
              if (promises.length > 0) {
                asyncPending = true
              promises.forEach((p) =>
                p.then(
                  (v: any) => {
                    if (!responded) sendResponse(v)
                  },
                  (error: any) => {
                    if (!responded) sendError(error)
                  },
                ),
              )
              }
              if (hasAsyncFlag) {
                asyncPending = true
              }
              if (!asyncPending && !responded) sendResponse(undefined)
            },
          )

          const inboundPortDecisions = new Set<string>()
          const rejectInboundPort = (portId: string) => {
            if (inboundPortDecisions.has(portId)) return
            inboundPortDecisions.add(portId)
            electron.portReject(portId)
          }
          const bridgedOnConnectExternal = new Event<(port: chrome.runtime.Port) => void>()
          const onConnectExternal = {
            addListener: (cb: any) => bridgedOnConnectExternal.addListener(cb),
            removeListener: (cb: any) => bridgedOnConnectExternal.removeListener(cb),
            hasListener: (cb: any) => bridgedOnConnectExternal.hasListener(cb),
          }
          electron.addExtensionListener(
            extId(),
            'runtime.onConnectExternal',
            (payload: { portId: string; name: string; sender: any }) => {
              if (!(bridgedOnConnectExternal as any).hasListeners()) {
                deferTask(() => {
                  if (!(bridgedOnConnectExternal as any).hasListeners()) {
                    rejectInboundPort(payload.portId)
                  } else {
                    dispatchExternalConnect(payload)
                  }
                }, 5000)
                return
              }
              dispatchExternalConnect(payload)
            },
          )
          function dispatchExternalConnect(payload: { portId: string; name: string; sender: any }) {
              if (inboundPortDecisions.has(payload.portId)) return
              inboundPortDecisions.add(payload.portId)
              const port = new GenericPort()
              port.name = payload.name || ''
              port.sender = payload.sender
              electron.portAccept(
                payload.portId,
                (message: any) => port._receive(message),
                () => port._remoteDisconnect(),
                (send: any, close: any) => port._bind(send, close),
              )
              ;(bridgedOnConnectExternal as any)._emit(port)
          }
          ;(runtimeApi as any).onMessageExternal = onMessageExternal
          ;(runtimeApi as any).onConnectExternal = onConnectExternal

          // MV2 (e.g. uBlock Origin): native messaging only. Returning base
          // unwrapped preserves the native onConnect/onMessage objects Electron
          // dispatches through, so popup/page <-> background connect stays native.
          //
          // EXCEPTION — content-script Port bridges: a declarative content script
          // whose chrome.runtime.connect was rerouted by the SHIM onto the messaging
          // hub (__crxCSConnect -> crx-port-connect -> messaging.ts onPortConnect)
          // cannot reach the native onConnect, because the hub delivers a
          // synthesized GenericPort over the `crx-runtime.onConnect` channel.
          // Register a hub onConnect listener here so those content-script
          // connections reach this MV2 background page too, dispatching the
          // GenericPort to the SHIM portbroker's captured onConnect listeners
          // (__crxPortBrokerOnConnect, populated because MV2 bgPages also set
          // __crxPatched at injectExtensionAPIs tail). Native popup/page->bg
          // connect does NOT go through the hub, so there is no double-fire.
          if (manifest.manifest_version !== 3) {
            electron.addExtensionListener(
              extId(),
              'runtime.onConnect',
              (payload: { portId: string; name: string; sender: any }) => {
                // Dispatch the synthesized GenericPort to the SHIM portbroker's
                // captured onConnect listeners (__crxPortBrokerOnConnect). MV2
                // extensions like IDM register onConnect ONLY after their desktop
                // app connects and sends its config (case 4), so at content-connect
                // time the listener array is often still empty. Poll briefly until
                // the extension registers (on Chrome, a connect with no listener
                // disconnects — but the desktop handover usually lands within tens
                // of ms, so waiting recovers the connection instead of dropping it).
                // Messages from the content side buffer in the main process
                // (pendingToSw) until our portAccept, so nothing is lost while we wait.
                const tryDispatch = (): boolean => {
                  const socls: any[] = (globalThis as any).__crxPortBrokerOnConnect
                  if (!Array.isArray(socls) || socls.length === 0) return false
                  const port = new GenericPort()
                  port.name = payload.name || ''
                  port.sender = payload.sender
                  try {
                    console.warn(
                      '[crx-mv2-recv] dispatch portId=' +
                        payload.portId +
                        ' tabId=' +
                        ((payload.sender && payload.sender.tab && payload.sender.tab.id) ?? 'NONE') +
                        ' url=' +
                        ((payload.sender && payload.sender.url) || '').slice(0, 60),
                    )
                  } catch {
                    /* diag */
                  }
                  electron.portAccept(
                    payload.portId,
                    (message: any) => port._receive(message),
                    () => port._remoteDisconnect(),
                    (send: any, close: any) => port._bind(send, close),
                  )
                  for (const fn of socls) {
                    if (typeof fn !== 'function') continue
                    try {
                      fn(port)
                    } catch (e) {
                      try {
                        console.warn(
                          '[crx-mv2-recv] onConnect listener threw: ' + ((e && (e.stack || e.message)) || e),
                        )
                      } catch {
                        /* diag */
                      }
                    }
                  }
                  return true
                }
                if (tryDispatch()) {
                  try {
                    console.warn('[crx-mv2-recv] MV2 onConnect portId=' + payload.portId + ' dispatched immediately')
                  } catch {
                    /* diag */
                  }
                  return
                }
                try {
                  console.warn('[crx-mv2-recv] MV2 onConnect portId=' + payload.portId + ' waiting for extension onConnect listener...')
                } catch {
                  /* diag */
                }
                let tries = 0
                const wait = setInterval(() => {
                  if (tryDispatch()) {
                    clearInterval(wait)
                    try {
                      console.warn('[crx-mv2-recv] MV2 onConnect portId=' + payload.portId + ' dispatched after wait')
                    } catch {
                      /* diag */
                    }
                    return
                  }
                  if (++tries > 200) {
                    // 10s @ 50ms — extension never registered onConnect (desktop
                    // app not installed/running). Give up; the port stays orphaned
                    // and will tear down when the content side disconnects.
                    clearInterval(wait)
                    try {
                      console.warn('[crx-mv2-recv] MV2 onConnect portId=' + payload.portId + ' TIMEOUT — extension never registered onConnect')
                    } catch {
                      /* diag */
                    }
                  }
                }, 50)
              },
            )

          // MV2 inbound runtime.onMessage bridge — the symmetric counterpart of
          // the onConnect bridge above. A content script's one-shot
          // chrome.runtime.sendMessage to an MV2 extension (e.g. Dark Reader's
          // "cs-bg-document-connect" frame registration) is routed by
          // messaging.ts onRuntimeMessage -> bg.send('crx-runtime.onMessage').
          // Without this listener the MV2 path returns at `return runtimeApi`
          // below before the MV3-only onMessage bridge (registered further down)
          // runs, so the IPC is dropped on the floor: the background's
          // TabManager.tabs is never populated, canAccessTab() returns false,
          // and the popup reports every page as "protected" (isInjected=false).
          // Dispatch to the SHIM portbroker's captured onMessage listeners
          // (__crxPortBrokerOnMsg) — the same store the MV3 fallback uses.
          electron.addExtensionListener(
            extId(),
            'runtime.onMessage',
            (payload: { messageId: string; message: any; sender: any }) => {
              let responded = false
              let asyncPending = false
              const sendResponse = (response?: any) => {
                if (responded) return
                responded = true
                electron.sendMessageResponse(payload.messageId, response)
              }
              const sendError = (error: any) => {
                if (responded) return
                responded = true
                electron.sendMessageResponse(
                  payload.messageId,
                  undefined,
                  runtimeMessageErrorText(error),
                )
              }
              // Content-script chrome.storage tunnel: handle before extension
              // listeners so the internal envelope never reaches them.
              if (handleStorageOp(payload.message, sendResponse)) return
              try {
                console.warn(
                  `[crx-mv2-msg] recv mid=${payload.messageId} msgType=${payload.message && payload.message.type} senderTab=${payload.sender && payload.sender.tab ? payload.sender.tab.id : 'none'}`,
                )
              } catch {
                /* diag */
              }
              const sbls: any[] = (globalThis as any).__crxPortBrokerOnMsg
              const results: any[] = []
              if (Array.isArray(sbls) && sbls.length > 0) {
                for (const fn of sbls) {
                  if (typeof fn !== 'function') continue
                  try {
                    results.push(fn(payload.message, payload.sender, sendResponse))
                  } catch {
                    results.push(undefined)
                  }
                }
              }
              const promises = (Array.isArray(results) ? results : []).filter(
                (r) => r && typeof r.then === 'function',
              )
              const hasAsyncFlag = (Array.isArray(results) ? results : []).some(
                (r) => r === true,
              )
              if (promises.length > 0) {
                asyncPending = true
                promises.forEach((p) =>
                  p.then(
                    (v: any) => {
                      if (!responded) sendResponse(v)
                    },
                    (error: any) => {
                      if (!responded) sendError(error)
                    },
                  ),
                )
              }
              if (hasAsyncFlag) {
                asyncPending = true
                try {
                  setTimeout(() => {
                    if (!responded) {
                      sendResponse(
                        payload.message?.type === 'fetch'
                          ? { __crxNoReceiver: true }
                          : undefined,
                      )
                    }
                  }, 30000)
                } catch {
                  /* setTimeout unavailable — rely on caller timeout */
                }
              }
              if (!asyncPending && !responded) {
                sendResponse(
                  payload.message?.type === 'fetch' ? { __crxNoReceiver: true } : undefined,
                )
              }
            },
          )

            return runtimeApi
          }

          // ---- MV3 additive content-script bridge -----------------------------
          // Bridged (content-script side) event sinks.
          const bridgedOnMessage = new Event<
            (message: any, sender: any, sendResponse: (response?: any) => void) => boolean | void
          >()
          const bridgedOnConnect = new Event<(port: chrome.runtime.Port) => void>()

          // Additive event wrappers: forward to native + keep bridged listeners.
          // For the native (base) side we wrap the listener so MV3 Promise-based
          // async responses are driven ourselves and Blob/File members are
          // stripped before the response crosses the SW->caller IPC. Without
          // this, a dessant dispatcher returning `Promise.resolve(imageItem)`
          // (which carries imageBlob, a Blob) from an extension page (tab view,
          // popup — native chrome.runtime.sendMessage, NOT the RSFN bridge) is
          // awaited by the native onMessage and serialized back, throwing
          // "An object could not be cloned".
          const nativeMsgWrappers = new WeakMap<object, any>()
          // Listeners added through the additive API are present twice: the
          // original callback in bridgedOnMessage and its clone-safe wrapper in
          // the native portbroker. Track those wrappers so mixed cold-start
          // registrations can be merged without invoking the same listener
          // twice.
          const bridgedNativeMsgWrappers = new WeakSet<object>()
          const wrapNativeMsgListener = (cb: any) => {
            let wrapper = nativeMsgWrappers.get(cb)
            if (wrapper) return wrapper
            const stripPromiseResponse = (val: any, seen?: WeakSet<any>): any => {
              if (val == null || typeof val !== 'object') return val
              try {
                if (typeof Blob !== 'undefined' && val instanceof Blob) {
                  return {__crxBlob: true, type: val.type || '', size: val.size || 0}
                }
                if (typeof File !== 'undefined' && val instanceof File) {
                  return {
                    __crxFile: true,
                    type: val.type || '',
                    size: val.size || 0,
                    name: val.name || '',
                  }
                }
              } catch {}
              if (!seen) seen = new WeakSet<any>()
              if (seen.has(val)) return null
              seen.add(val)
              try {
                if (Array.isArray(val)) {
                  return val.map((entry) => stripPromiseResponse(entry, seen))
                }
                const out: any = {}
                for (const key of Object.keys(val)) {
                  const descriptor = Object.getOwnPropertyDescriptor(val, key)
                  if (!descriptor || descriptor.get || descriptor.set) continue
                  out[key] = stripPromiseResponse(descriptor.value, seen)
                }
                return out
              } finally {
                seen.delete(val)
              }
            }
            wrapper = (message: any, sender: any, sendResponse: any) => {
              let nativeResponded = false
              const safeSend = (response: any) => {
                if (nativeResponded) return
                nativeResponded = true
                // Self-contained clone-safe strip. This factory is deployed to
                // the SW main world via a self-contained SERIALIZED script where
                // NO closure variable (not even the module-top-level
                // crxStripUncloneable) is in scope — referencing it surfaced as
                // "crxStripUncloneable is not defined", which dropped EVERY
                // native onMessage response (getPlatform -> null -> "Cannot read
                // properties of null (reading 'targetEnv')"). Inlined here so the
                // strip is available regardless of deployment context. Electron
                // IPC V8 serialization can't clone Blob/File; dessant's j1
                // regenerates the Blob from imageDataUrl, so the strip is lossless.
                const strip = (val: any, seen?: WeakSet<any>): any => {
                  if (val == null || typeof val !== 'object') return val
                  try {
                    if (typeof Blob !== 'undefined' && val instanceof Blob) {
                      return {__crxBlob: true, type: val.type || '', size: val.size || 0}
                    }
                    if (typeof File !== 'undefined' && val instanceof File) {
                      return {
                        __crxFile: true,
                        type: val.type || '',
                        size: val.size || 0,
                        name: val.name || '',
                      }
                    }
                  } catch {
                    // best-effort
                  }
                  if (!seen) seen = new WeakSet<any>()
                  if (seen.has(val)) return null
                  try {
                    seen.add(val)
                  } catch {
                    // best-effort
                  }
                  try {
                    if (Array.isArray(val)) {
                      const arr: any[] = []
                      for (const v of val) arr.push(strip(v, seen))
                      return arr
                    }
                    const out: any = {}
                    for (const k of Object.keys(val)) {
                      try {
                        const d = Object.getOwnPropertyDescriptor(val, k)
                        if (!d) continue
                        if (typeof d.get === 'function' || typeof d.set === 'function') continue
                        out[k] = strip(d.value, seen)
                      } catch {
                        // best-effort
                      }
                    }
                    return out
                  } finally {
                    try {
                      seen.delete(val)
                    } catch {
                      // best-effort
                    }
                  }
                }
                try {
                  sendResponse(strip(response))
                } catch (e) {
                  try {
                    console.warn(
                      `[crx-onmsg-native] sendResponse FAIL id=${
                        message && message.id
                      } err=${(e as any) && (e as any).message}`,
                    )
                  } catch {
                    // best-effort diag
                  }
                  try {
                    sendResponse(undefined)
                  } catch {
                    // give up
                  }
                }
              }
              let ret: any
              try {
                ret = cb(message, sender, safeSend)
              } catch (e) {
                try {
                  console.warn(
                    `[crx-onmsg-native] THROW(sync) id=${message && message.id} err=${(e as any) && (e as any).message}`,
                  )
                } catch {
                  // best-effort diag
                }
                safeSend(undefined)
                return undefined
              }
              if (ret && typeof ret.then === 'function') {
                // Chrome 148 understands Promise-returning listeners natively.
                // Preserve the Promise itself so rejection reaches the sender;
                // resolved values are still clone-sanitized for Electron IPC.
                return Promise.resolve(ret).then((v: any) => stripPromiseResponse(v))
              }
              // Sync return value: Chrome would auto-send it as the response
              // (and we can't intercept that serialization). For dessant this
              // branch isn't hit — all dispatchers are async — but strip anyway
              // when a sendResponse callback is provided so a manual send stays
              // safe. Non-Promise, non-undefined returns fall through to Chrome.
              return ret
            }
            try {
              nativeMsgWrappers.set(cb, wrapper)
              bridgedNativeMsgWrappers.add(wrapper)
            } catch {
              // best-effort
            }
            return wrapper
          }
          const onMessage: any = {
            __crxHosted: true,
            addListener: (cb: any) => {
              bridgedOnMessage.addListener(cb)
              ;(base.onMessage as any)?.addListener?.(wrapNativeMsgListener(cb))
            },
            removeListener: (cb: any) => {
              bridgedOnMessage.removeListener(cb)
              const wrapper = nativeMsgWrappers.get(cb)
              if (wrapper) (base.onMessage as any)?.removeListener?.(wrapper)
            },
            hasListener: (cb: any) => bridgedOnMessage.hasListener(cb),
            hasListeners: () => bridgedOnMessage.hasListeners(),
          }
          const onConnect: any = {
            __crxHosted: true,
            addListener: (cb: any) => {
              bridgedOnConnect.addListener(cb)
              base.onConnect?.addListener?.(cb)
            },
            removeListener: (cb: any) => {
              bridgedOnConnect.removeListener(cb)
              base.onConnect?.removeListener?.(cb)
            },
            hasListener: (cb: any) => bridgedOnConnect.hasListener(cb),
            hasListeners: () => bridgedOnConnect.hasListeners(),
          }

          // Inbound one-shot messages bridged from a content script. Main process
          // delivers {messageId, message, sender}; response routed back by id.
          electron.addExtensionListener(
            extId(),
            'runtime.onMessage',
            (payload: { messageId: string; message: any; sender: any }) => {
              let responded = false
              let asyncPending = false
              const sendResponse = (response?: any) => {
                if (responded) return
                responded = true
                electron.sendMessageResponse(payload.messageId, response)
              }
              const sendError = (error: any) => {
                if (responded) return
                responded = true
                electron.sendMessageResponse(
                  payload.messageId,
                  undefined,
                  runtimeMessageErrorText(error),
                )
              }
              // Content-script chrome.storage tunnel: handle before extension
              // listeners so the internal envelope never reaches them.
              if (handleStorageOp(payload.message, sendResponse)) return
              // A cold MV3 startup can register listeners on both sides of the
              // chrome.runtime replacement boundary. Early listeners land in the
              // SHIM portbroker; later listeners land in bridgedOnMessage and also
              // get a clone-safe native wrapper. Chrome broadcasts to every
              // registered listener, so merge both stores and skip only wrappers
              // already represented by their bridged callback. Choosing one store
              // dropped Tampermonkey's early `prepare` handler whenever any later
              // bridged listener existed, leaving the current tab marked forbidden.
              const bridgedListeners: any[] =
                ((bridgedOnMessage as any).listeners as any[]) || []
              let results: any[]
              const offscreenRelay = (globalThis as any).__crxOffscreenRelay
              if (
                payload.message?.__crxOffscreenRelay === true &&
                typeof offscreenRelay === 'function'
              ) {
                try {
                  results = [offscreenRelay(payload.message, payload.sender, sendResponse)]
                } catch {
                  results = [undefined]
                }
              } else {
                results = []
                if (bridgedListeners.length > 0) {
                  results.push(
                    ...((bridgedOnMessage as any)._emit(
                      payload.message,
                      payload.sender,
                      sendResponse,
                    ) as any[]),
                  )
                }
                const sbls: any[] = (globalThis as any).__crxPortBrokerOnMsg
                if (Array.isArray(sbls) && sbls.length > 0) {
                  for (const fn of sbls) {
                    if (typeof fn !== 'function') continue
                    if (bridgedListeners.includes(fn)) continue
                    try {
                      if (bridgedNativeMsgWrappers.has(fn)) continue
                    } catch {
                      // best-effort identity check
                    }
                    try {
                      results.push(fn(payload.message, payload.sender, sendResponse))
                    } catch {
                      results.push(undefined)
                    }
                  }
                }
              }
              // MV3 Promise-based onMessage: a listener returning a Promise has
              // its resolved value sent as the response. _emit now returns each
              // listener's return value; await any Promise (first resolve wins).
              // Without this, dessant's `return Promise.resolve(imageItem)`
              // (asyncResponse:true storageRequest) is discarded and the response
              // is always undefined — the engine never receives the image.
              const promises = (Array.isArray(results) ? results : []).filter(
                (r) => r && typeof r.then === 'function',
              )
              // A listener returning `true` is Chrome's "I will call sendResponse
              // asynchronously" signal. The webextension-polyfill's onMessage
              // wrapper (dessant registers its dispatcher on `browser.runtime`
              // — `hi=r(7272)`, NOT chrome) returns `true` — NOT the dispatcher's
              // Promise — after attaching its own `.then(sendResponse)` to the
              // user's async listener. Without honoring `true`, the sync fallback
              // below fires sendResponse(undefined) immediately and races the
              // polyfill's later sendResponse(data); the undefined wins (responded
              // guard) and the async response is lost. This is exactly the
              // storageRequest failure: response logged undefined at T+0.068s
              // while getStorageItem's storage reads land at T+0.070–0.072s.
              const hasAsyncFlag = (Array.isArray(results) ? results : []).some(
                (r) => r === true,
              )
              if (promises.length > 0) {
                asyncPending = true
                promises.forEach((p) =>
                  p.then(
                    (v: any) => {
                      if (!responded) sendResponse(v)
                    },
                    (error: any) => {
                      if (!responded) sendError(error)
                    },
                  ),
                )
              }
              if (hasAsyncFlag) {
                asyncPending = true
                // The polyfill will invoke sendResponse when its listener's
                // Promise settles. Safety net: if it never does, respond
                // undefined so the caller doesn't wait for its full timeout.
                try {
                  setTimeout(() => {
                    if (!responded) {
                      sendResponse(
                        payload.message?.type === 'fetch'
                          ? { __crxNoReceiver: true }
                          : undefined,
                      )
                    }
                  }, 30000)
                } catch {
                  /* setTimeout unavailable — rely on caller timeout */
                }
              }
              if (!asyncPending && !responded) {
                sendResponse(
                  payload.message?.type === 'fetch' ? { __crxNoReceiver: true } : undefined,
                )
              }
            },
          )

          // Inbound Port connections bridged from a content script
          // (runtime.connect). Main delivers {portId, name, sender}.
          electron.addExtensionListener(
            extId(),
            'runtime.onConnect',
            (payload: { portId: string; name: string; sender: any }) => {
              const connListeners: any[] =
                ((bridgedOnConnect as any).listeners as any[]) || []
              const nativeListeners: any[] = (globalThis as any).__crxPortBrokerOnConnect
              const hasNativeListeners =
                Array.isArray(nativeListeners) &&
                nativeListeners.some((listener) => typeof listener === 'function')
              if (connListeners.length === 0 && !hasNativeListeners) {
                deferTask(() => {
                  const lateListeners: any[] =
                    ((bridgedOnConnect as any).listeners as any[]) || []
                  const lateNative: any[] = (globalThis as any).__crxPortBrokerOnConnect
                  if (
                    lateListeners.length === 0 &&
                    !(Array.isArray(lateNative) &&
                      lateNative.some((listener) => typeof listener === 'function'))
                  ) {
                    rejectInboundPort(payload.portId)
                    return
                  }
                  dispatchConnect(payload, lateListeners, lateNative)
                }, 5000)
                return
              }
              dispatchConnect(payload, connListeners, nativeListeners)
              function dispatchConnect(
                payload: { portId: string; name: string; sender: any },
                connListeners: any[],
                nativeListeners: any[],
              ) {
              if (inboundPortDecisions.has(payload.portId)) return
              inboundPortDecisions.add(payload.portId)
              const port = new GenericPort()
              port.name = payload.name || ''
              port.sender = payload.sender
              electron.portAccept(
                payload.portId,
                (message: any) => port._receive(message),
                () => port._remoteDisconnect(),
                (send: any, close: any) => port._bind(send, close),
              )
                // Mirror onMessage's mixed-startup handling. An extension can
                // register early listeners in the native portbroker and later
                // listeners in the bridged store; Chrome delivers the connection
                // to all of them. Listeners added through our additive wrapper are
                // the same function in both stores and are skipped by identity.
                if (connListeners.length > 0) {
                  ;(bridgedOnConnect as any)._emit(port)
                }
                if (Array.isArray(nativeListeners)) {
                  for (const fn of nativeListeners) {
                    if (typeof fn !== 'function') continue
                    if (connListeners.includes(fn)) continue
                    try {
                      fn(port)
                    } catch {
                      /* best-effort */
                    }
                  }
                }
                }
            },
          )

          // runtime.sendMessage (MV3): keep Electron's native extension-page ↔
          // background dispatch when it exists, and use our IPC hub only as a
          // missing-native fallback. The native onMessage wrapper above now
          // honors Promise returns / `return true` and strips uncloneable response
          // values, so we do not need to double-dispatch a message just because a
          // listener returns undefined.
          //
          // SCOPED to extension PAGES (popup/options/devtools), i.e. contexts
          // where `window` exists. The MV3 service worker keeps native
          // sendMessage for BG→UI pushes. MV2 is untouched: it returns
          // `runtimeApi` above before reaching here.
          const mv3SendMessage = (...args: any[]): any => {
            // Forms: (message) | (message, cb) | (extId, message) |
            // (extId, message, cb) | (extId, message, options, cb).
            const last = args[args.length - 1]
            const cb = typeof last === 'function' ? args.pop() : undefined
            let targetExt = extId()
            let message = args[0]
            let crossExt = false
            if (args.length >= 2 && typeof args[0] === 'string') {
              targetExt = args[0]
              message = args[1]
              crossExt = targetExt !== extId()
            }

            // Same-extension runtime.sendMessage: route over the IPC hub
            // (sendRuntimeMessage → 'crx-runtime-message' → messaging.ts).
            // Electron's NATIVE extension page↔background sendMessage closes the
            // channel before an async listener (`return true` / Promise) can
            // respond, so a native-first path resolves undefined and crashes the
            // popup — Dark Reader's popup destructures `response.data`. The IPC
            // hub honors async returns AND reaches every listener (bridged
            // onMessage + portbroker-captured native listeners), so it is a
            // complete single-delivery replacement: no native leg means no
            // double-dispatch / repeated side effects (the IPC-then-native
            // fallback re-fires a listener when the first path legitimately
            // returns undefined). Cross-extension messaging (the hub is
            // same-ext only) and IPC-unavailable contexts fall back to native.
            // The hub also covers SW → content-script / extension-page pushes,
            // which Electron's native MV3 runtime.sendMessage misses in this host.
            const nativeFn = (base as any)?.sendMessage
            const hasNative = typeof nativeFn === 'function'
            const tryNative = (): Promise<any> => {
              if (!hasNative) return Promise.resolve(undefined)
              try {
                const nativeArgs = crossExt ? [targetExt, message] : [message]
                const r = nativeFn.apply(base, nativeArgs)
                return Promise.resolve(r)
              } catch (error) {
                return Promise.reject(error)
              }
            }
            const tryIpc = (): Promise<any> => {
              if (crossExt || typeof (electron as any).sendRuntimeMessage !== 'function') {
                return Promise.resolve(undefined)
              }
              return Promise.resolve((electron as any).sendRuntimeMessage(targetExt, message))
            }

            // An extension page embedded as a sub-frame of a WEB page (uBO Lite's
            // picker-ui.html overlay, inline password-manager menus) runs in an
            // extension process whose ipcRenderer never reaches the main process
            // in this host: invoke() stays pending forever, so the picker's
            // "Create" button awaited addCustomFilters indefinitely. The top
            // web page's view-preload already relays __crxCsSend →
            // crx-runtime-message-from-frame (with the correct sender frame) and
            // replies by mid, so use that transport for such frames.
            const webEmbedded = (() => {
              try {
                if (typeof window === 'undefined' || window.top === window) return false
                const ao: any = (location as any).ancestorOrigins
                const topOrigin = ao && ao.length ? String(ao[ao.length - 1]) : ''
                return /^https?:/i.test(topOrigin)
              } catch {
                return false
              }
            })()
            const tryTopRelay = (): Promise<any> =>
              new Promise((resolve, reject) => {
                let wire: any
                try {
                  const s = JSON.stringify(message)
                  wire = s === undefined ? undefined : JSON.parse(s)
                } catch (error) {
                  reject(error)
                  return
                }
                const mid = `crxpage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
                let timer: any
                const onResp = (ev: MessageEvent) => {
                  const d: any = ev && ev.data
                  if (!d || !d.__crxCsSendResp || d.mid !== mid) return
                  window.removeEventListener('message', onResp)
                  clearTimeout(timer)
                  if (d.error !== undefined) reject(new Error(String(d.error)))
                  else resolve(d.response)
                }
                window.addEventListener('message', onResp)
                timer = setTimeout(() => {
                  window.removeEventListener('message', onResp)
                  resolve(undefined)
                }, 30000)
                try {
                  window.top!.postMessage(
                    { __crxCsSend: true, mid, extId: targetExt, message: wire },
                    '*',
                  )
                } catch (error) {
                  window.removeEventListener('message', onResp)
                  clearTimeout(timer)
                  reject(error)
                }
              })

            const ipcAvailable =
              !crossExt && typeof (electron as any).sendRuntimeMessage === 'function'
            const merged = !crossExt && webEmbedded
              ? tryTopRelay()
              : ipcAvailable
              ? tryIpc()
              : hasNative
                ? tryNative()
                : Promise.resolve(undefined)

            if (cb) {
              merged.then(
                (r: any) => {
                  try {
                    cb(r)
                  } catch {
                    /* listener threw — swallow, mirrors Chrome behavior */
                  }
                },
                (error: any) => {
                  crxSetLastError(String((error && error.message) || error))
                  try {
                    cb(undefined)
                  } catch {
                    /* listener threw */
                  } finally {
                    deferTask(() => crxSetLastError(undefined))
                  }
                },
              )
              return undefined
            }
            return merged
          }

          return {
            ...runtimeApi,
            sendMessage: mv3SendMessage,
            onMessage,
            onConnect,
          }
        },
      },

      storage: {
        factory: (base) => {
          // IMPORTANT: do NOT spread `base` here. Electron's native
          // chrome.storage exposes `sync`/`managed` as getters that THROW
          // ('"sync" is not available in this instance of Chrome'). A spread
          // (`{...base}`) enumerates and reads every own property, so it would
          // trigger that throwing getter and abort the whole override before
          // `sync: local` is ever assigned — leaving the page with the native
          // throwing API (the exact symptom we're fixing). Instead copy only
          // the areas we know are safe, reading each behind a try/catch, and
          // map the unimplemented backends onto `local` so extensions that call
          // chrome.storage.sync degrade gracefully instead of crashing.
          const safe = (fn: () => any) => {
            try {
              return fn()
            } catch {
              return undefined
            }
          }
          const local = safe(() => base && base.local)
          const session = safe(() => base && base.session)
          const onChanged = safe(() => base && base.onChanged)

          const api: any = {}
          if (local) api.local = local
          if (session) api.session = session
          if (onChanged) api.onChanged = onChanged
          // Chrome without enterprise policy: storage.managed is an EMPTY,
          // read-only area. Aliasing it to local made extensions read their own
          // local data as admin policy (uBlock adminSettings, Bitwarden config).
          const ro = (...a: any[]) => {
            const cb = typeof a[a.length - 1] === 'function' ? a[a.length - 1] : undefined
            const err = new Error('This is a read-only store.')
            if (cb) {
              crxSetLastError(err.message)
              try {
                cb()
              } finally {
                crxSetLastError(undefined)
              }
              return undefined
            }
            return Promise.reject(err)
          }
          const managedValue = (value: any) => (...a: any[]) => {
            const cb = typeof a[a.length - 1] === 'function' ? a[a.length - 1] : undefined
            if (cb) {
              cb(value)
              return undefined
            }
            return Promise.resolve(value)
          }
          api.managed = {
            get: (...a: any[]) => managedValue({})(...a),
            getBytesInUse: (...a: any[]) => managedValue(0)(...a),
            getKeys: (...a: any[]) => managedValue([])(...a),
            set: ro,
            remove: ro,
            clear: ro,
            setAccessLevel: ro,
            onChanged: {
              addListener() {},
              removeListener() {},
              hasListener: () => false,
              hasListeners: () => false,
            },
          }
          // TODO: provide a real sync backend for browsers to opt-in to.
          api.sync = local
          return api
        },
      },

      tabs: {
        factory: (base) => {
          const readInjectedTabs = (): any[] => {
            try {
              if (typeof location === 'undefined' || location.protocol !== 'chrome-extension:') {
                return []
              }
              // localStorage.__crxTabs_lsinjected is shared across ALL same-origin
              // extension contexts (popup, background page, extension-page tabs),
              // so reading it from the background page resurrects stale tabs the
              // popup wrote (uBlock dashboard-already-open bug). Gate it on
              // `hasParent` — only a popup's site-isolated CHILD iframe (which
              // can't reach window.top for the crxbridge hash) needs it; the
              // background page (top-level) and extension-page tabs (globalThis)
              // do not.
              let hasParent = false
              try {
                hasParent =
                  typeof window !== 'undefined' &&
                  !!window.parent &&
                  window.parent !== window
              } catch {
                hasParent = false
              }
              const tryWindow = (w: any): any[] | undefined => {
                if (!w) return undefined
                let tabs: any
                try {
                  const hash = w.location && w.location.hash
                  const match = (hash || '').match(/[?#&]crxbridge=([^&]+)/)
                  tabs = match ? JSON.parse(decodeURIComponent(match[1])) : undefined
                } catch {}
                if (Array.isArray(tabs)) return tabs
                try {
                  tabs = w.__crxTabs
                } catch {}
                if (Array.isArray(tabs)) return tabs
                if (hasParent) {
                  try {
                    const storage = w.localStorage
                    tabs = storage
                      ? JSON.parse(storage.getItem('__crxTabs_lsinjected') || '[]')
                      : undefined
                  } catch {}
                  if (Array.isArray(tabs)) return tabs
                }
                return undefined
              }
              const wins: any[] = [globalThis]
              try {
                if (typeof window !== 'undefined') {
                  if (window.parent && window.parent !== window) wins.push(window.parent)
                  if (window.top && wins.indexOf(window.top) < 0) wins.push(window.top)
                }
              } catch {
                /* cross-origin/top access can throw */
              }
              for (const w of wins) {
                const tabs = tryWindow(w)
                if (Array.isArray(tabs)) return tabs
              }
            } catch {
              /* best-effort */
            }
            return []
          }

          const filterInjectedTabs = (info: any = {}) => {
            const isSet = (value: any) => typeof value !== 'undefined'
            // Match-pattern glob mirroring the main-process matchesPattern/
            // matchesTitlePattern: '*' → '.*', every other char literal. The
            // SHIM fallback runs when the main handler returned [], so it must
            // apply the SAME url/title filters Chrome does — otherwise a popup
            // calling chrome.tabs.query({ url }) would get every injected tab
            // back, breaking extensions that look up their own pages.
            const globMatch = (pattern: string, value: string) => {
              if (pattern === '<all_urls>') return true
              const re = new RegExp(
                '^' +
                  pattern
                    .split('*')
                    .map((p) => p.replace(/[\\^$+?.()|[\]{}]/g, '\\$&'))
                    .join('.*') +
                  '$',
              )
              return re.test(value || '')
            }
            const matchAny = (infoVal: any, value: string) => {
              const patterns: string[] = Array.isArray(infoVal) ? infoVal : [infoVal]
              const v = typeof value === 'string' ? value.split('#')[0] : ''
              return patterns.some(
                (p) => typeof p === 'string' && globMatch(p, v),
              )
            }
            return readInjectedTabs()
              .filter((tab: any) => {
                if (!tab || typeof tab.id !== 'number') return false
                if (isSet(info.active) && !!info.active !== !!tab.active) return false
                if (isSet(info.pinned) && !!info.pinned !== !!tab.pinned) return false
                if (isSet(info.highlighted) && !!info.highlighted !== !!tab.highlighted)
                  return false
                if (isSet(info.discarded) && !!info.discarded !== !!tab.discarded) return false
                if (isSet(info.muted) && !!info.muted !== !!tab.mutedInfo?.muted) return false
                if (isSet(info.status) && info.status !== tab.status) return false
                if (isSet(info.windowId) && info.windowId >= 0 && info.windowId !== tab.windowId)
                  return false
                const groupId = typeof tab.groupId === 'number' ? tab.groupId : -1
                if (isSet(info.groupId) && info.groupId !== groupId) return false
                if (isSet(info.url) && !matchAny(info.url, tab.url)) return false
                if (isSet(info.title) && !matchAny(info.title, tab.title)) return false
                return true
              })
              .map((tab: any) => ({
                ...tab,
                groupId: typeof tab.groupId === 'number' ? tab.groupId : -1,
              }))
          }

          const popupCurrentTabId = () => {
            try {
              const tabs = readInjectedTabs()
              const active = tabs.find(
                (tab: any) =>
                  tab &&
                  (tab.active || tab.selected || tab.highlighted) &&
                  typeof tab.id === 'number',
              )
              return (active || tabs.find((tab: any) => tab && typeof tab.id === 'number'))?.id
            } catch {
              return undefined
            }
          }

          const withInjectedTabsFallback = (name: string, fn: (...args: any[]) => any) => {
            return (...args: any[]) => {
              const cb = typeof args[args.length - 1] === 'function' ? args.pop() : undefined
              const fallback = () => filterInjectedTabs(args[0] || {})
              const p = Promise.resolve()
                .then(() => fn(...args))
                .then((result: any) => {
                  if (name === 'tabs.query' && Array.isArray(result) && result.length === 0) {
                    // The fallback reads globalThis.__crxTabs — a point-in-time
                    // snapshot injected into the popup. That snapshot is fine for
                    // active/currentWindow/windowId queries, but for `url`/`title`
                    // lookups it is stale-by-construction: a tab that was closed
                    // since the snapshot was taken still appears to match, so
                    // extensions (uBlock's vapi-background.js open()) believe
                    // their own page is already open and call `tabs.update` on a
                    // dead id instead of `tabs.create`. Trust the main handler's
                    // [] for url/title queries.
                    const info = args[0] || {}
                    const isLive =
                      typeof info === 'object' &&
                      (typeof info.url !== 'undefined' ||
                        typeof info.title !== 'undefined')
                    if (!isLive) {
                      const tabs = fallback()
                      if (tabs.length) return tabs
                    }
                    return result
                  }
                  return result
                })
                .catch(() => fallback())
              if (cb) {
                p.then((r) => cb(r)).catch(() => cb(fallback()))
                return undefined
              }
              return p
            }
          }

          const fallbackTabConnect = (arg1: any, arg2?: any) => {
            const hasTabId = typeof arg1 === 'number'
            const tabId = normalizePopupTabId(hasTabId ? arg1 : undefined)
            const connectInfo = hasTabId ? arg2 : arg1
            const name =
              (connectInfo && connectInfo.name) ||
              (typeof connectInfo === 'string' ? connectInfo : '')
            const frameId =
              connectInfo && typeof connectInfo.frameId === 'number'
                ? connectInfo.frameId
                : undefined
            const port = new GenericPort()
            port.name = name
            electron
              .invokeExtension(extId(), 'tabs.connect', {}, tabId, { name, frameId })
              .then((portId: string) => {
                if (!portId) {
                  port._remoteDisconnect(CRX_NO_RECEIVER_ERROR)
                  return
                }
                electron.portAccept(
                  portId,
                  (m: any) => port._receive(m),
                  () => port._remoteDisconnect(),
                  (send: any, close: any) => port._bind(send, close),
                )
              })
              .catch(() => port._remoteDisconnect(CRX_NO_RECEIVER_ERROR))
            return port
          }

          const normalizePopupTabId = (tabId: number | undefined) => {
            if (typeof tabId !== 'number') return popupCurrentTabId()
            try {
              if (typeof location === 'undefined' || location.protocol !== 'chrome-extension:') {
                return tabId
              }
              const tabs = readInjectedTabs()
              if (!Array.isArray(tabs) || !tabs.length || tabs.some((tab: any) => tab?.id === tabId)) {
                return tabId
              }
              const current = popupCurrentTabId()
              if (typeof current === 'number') {
                console.warn(
                  `[crx-tabs] normalize stale popup tabId ${tabId} -> ${current}`,
                )
                return current
              }
            } catch {
              /* keep original tabId */
            }
            return tabId
          }

          const api = {
            ...base,
            create: invokeExtension('tabs.create'),
            executeScript: async function (
              arg1: unknown,
              arg2: unknown,
              arg3: unknown,
            ): Promise<any> {
              // Electron's implementation of chrome.tabs.executeScript is in
              // C++, but it doesn't support implicit execution in the active
              // tab. To handle this, we need to get the active tab ID and
              // pass it into the C++ implementation ourselves.
              if (typeof arg1 === 'object') {
                const [activeTab] = await api.query({
                  active: true,
                  windowId: chrome.windows.WINDOW_ID_CURRENT,
                })
                return api.executeScript(activeTab.id, arg1, arg2)
              } else {
                // MV2 file injections carry the SHIM receive bridge; report
                // them (as for scripting.executeScript) before the caller's
                // callback so a following tabs.sendMessage finds the receiver.
                const details: any = arg2 || {}
                const userCb = typeof arg3 === 'function' ? (arg3 as (...a: any[]) => void) : undefined
                if (typeof details.file !== 'string') {
                  return (base.executeScript as typeof chrome.tabs.executeScript)(
                    arg1 as number,
                    arg2 as chrome.tabs.InjectDetails,
                    arg3 as () => {},
                  )
                }
                const mark = () =>
                  Promise.resolve(
                    (electron as any).invokeExtensionRaw(extId(), 'scripting.markInjected', {}, {
                      tabId: arg1,
                      allFrames: !!details.allFrames,
                      frameId: typeof details.frameId === 'number' ? details.frameId : undefined,
                    }),
                  ).catch(() => undefined)
                return new Promise((resolve) => {
                  ;(base.executeScript as any)(arg1, details, (result: any) => {
                    const failed = !!(chrome.runtime && (chrome.runtime as any).lastError)
                    const lastError = failed ? (chrome.runtime as any).lastError : undefined
                    const done = () => {
                      if (userCb) {
                        if (lastError) crxSetLastError(lastError.message)
                        try {
                          userCb(result)
                        } catch {
                        } finally {
                          if (lastError) crxSetLastError(undefined)
                        }
                      }
                      resolve(result)
                    }
                    if (failed) done()
                    else mark().then(done)
                  })
                })
              }
            },
            group: invokeExtension('tabs.group'),
            ungroup: invokeExtension('tabs.ungroup'),
            get: invokeExtension('tabs.get'),
            getCurrent: invokeExtension('tabs.getCurrent'),
            // chrome.tabs.connect(tabId, {name}) -> opens a long-lived Port to
            // the content script in that tab. Main returns the portId; we bind
            // the caller (this extension context) as the receiving end via the
            // same portAccept machinery runtime.onConnect uses.
            connect: fallbackTabConnect,
            getAllInWindow: invokeExtension('tabs.getAllInWindow'),
            insertCSS: invokeExtension('tabs.insertCSS'),
            query: withInjectedTabsFallback('tabs.query', invokeExtension('tabs.query')),
            reload: invokeExtension('tabs.reload'),
            highlight: invokeExtension('tabs.highlight'),
            sendMessage: (...args: any[]): any => {
              // (tabId, message, cb) | (tabId, message, options, cb)
              // plus this app's popup convenience form: (message, options?, cb).
              const cb =
                typeof args[args.length - 1] === 'function' ? args.pop() : undefined
              const hasTabId = typeof args[0] === 'number'
              const tabId = normalizePopupTabId(hasTabId ? args[0] : undefined)
              const message = hasTabId ? args[1] : args[0]
              const options = hasTabId
                ? typeof args[2] === 'object'
                  ? args[2]
                  : undefined
                : typeof args[1] === 'object'
                  ? args[1]
                  : undefined

              let serialized = message
              try {
                serialized = crxSerializeMessage(message)
              } catch {
                serialized = undefined
              }
              if (crxIsAutofillMessage(message)) {
                crxAutofillLog(
                  `tabs.api.send ext=${extId()} tabId=${tabId ?? ''} ` +
                    `frameId=${options?.frameId ?? ''} command=${message.command}`,
                )
              }
              // Chrome rejects (promise form) / sets lastError (callback form)
              // with "Could not establish connection. Receiving end does not
              // exist." when the tab has no receiver — extensions use exactly
              // that to decide whether to inject their content script.
              const rawSend = (electron as any).invokeExtensionRaw
              const routed: Promise<any> = Promise.resolve(
                typeof rawSend === 'function'
                  ? rawSend(extId(), 'tabs.sendMessage', {}, tabId, serialized, options)
                  : electron.invokeExtension(extId(), 'tabs.sendMessage', {}, tabId, serialized, options),
              )

              if (crxIsAutofillMessage(message)) {
                routed.then(
                  (response: any) =>
                    crxAutofillLog(
                      `tabs.api.response command=${message.command} ` +
                        `response=${response === undefined ? 'undefined' : response === null ? 'null' : typeof response}`,
                    ),
                  () => crxAutofillLog(`tabs.api.response command=${message.command} response=reject`),
                )
              }

              if (cb) {
                routed.then(
                  (r: any) => {
                    try {
                      cb(r)
                    } catch {
                      /* listener threw — swallow, mirrors Chrome */
                    }
                  },
                  (err: any) => {
                    crxSetLastError((err && err.message) || 'tabs.sendMessage failed')
                    try {
                      cb(undefined)
                    } catch {
                      /* listener threw — swallow, mirrors Chrome */
                    } finally {
                      crxSetLastError(undefined)
                    }
                  },
                )
                return undefined
              }
              return routed
            },
            update: invokeExtension('tabs.update'),
            remove: invokeExtension('tabs.remove'),
            move: invokeExtension('tabs.move'),
            discard: invokeExtension('tabs.discard'),
            goBack: invokeExtension('tabs.goBack'),
            goForward: invokeExtension('tabs.goForward'),
            onCreated: new ExtensionEvent('tabs.onCreated'),
            onRemoved: new ExtensionEvent('tabs.onRemoved'),
            onUpdated: new ExtensionEvent('tabs.onUpdated'),
            onActivated: new ExtensionEvent('tabs.onActivated'),
            onReplaced: new ExtensionEvent('tabs.onReplaced'),
            // Declared so listeners can register from popup/frame/background
            // contexts even though the host has no tab-reorder/cross-window
            // move API to fire them yet (the SW-dedicated patch already lists
            // these; the frame factory did not).
            onMoved: new ExtensionEvent('tabs.onMoved'),
            onAttached: new ExtensionEvent('tabs.onAttached'),
            onDetached: new ExtensionEvent('tabs.onDetached'),
            onHighlighted: new ExtensionEvent('tabs.onHighlighted'),
            onZoomChange: new ExtensionEvent('tabs.onZoomChange'),
          }
          // MV2-only members (removed from MV3 in Chrome): extensions feature-
          // detect them to pick the scripting path over the legacy one.
          if (manifest.manifest_version === 3) {
            for (const k of ['executeScript', 'insertCSS', 'removeCSS', 'getAllInWindow', 'getSelected']) {
              delete (api as any)[k]
            }
          }
          return api
        },
      },

      // chrome.topSites — real backend in browser/api/topsites.ts (ranks the
      // host's history by visitCount). Replaces the former noop that returned [].
      topSites: {
        shouldInject: () => manifestDeclaresPermission('topSites'),
        factory: (base) => {
          return {
            ...base,
            get: invokeExtension('topSites.get'),
          }
        },
      },

      // chrome.idle — requires the "idle" permission. Backed by powerMonitor
      // (getSystemIdleTime + idle/active/lock-screen events).
      idle: {
        shouldInject: () => manifestDeclaresPermission('idle'),
        factory: (base) => ({
          ...base,
          queryState: invokeExtension('idle.queryState'),
          setDetectionInterval: invokeExtension('idle.setDetectionInterval'),
          onStateChanged: new ExtensionEvent('idle.onStateChanged'),
        }),
      },

      // chrome.power — requires the "power" permission. Maps onto
      // powerSaveBlocker (requestKeepAwake/releaseKeepAwake).
      power: {
        shouldInject: () => manifestDeclaresPermission('power'),
        factory: (base) => ({
          ...base,
          requestKeepAwake: invokeExtension('power.requestKeepAwake'),
          releaseKeepAwake: invokeExtension('power.releaseKeepAwake'),
        }),
      },

      // chrome.desktopCapture — backed by the host screen/window picker
      // (browser/api/capture.ts). chooseDesktopMedia is callback-only in
      // Chrome: it returns a request id synchronously and later calls
      // callback(streamId, { canRequestAudioTrack }); streamId is "" on cancel.
      desktopCapture: {
        shouldInject: () => manifestDeclaresPermission('desktopCapture'),
        factory: (base) => {
          let nextRequestId = 0
          const choose = invokeExtension('desktopCapture.chooseDesktopMedia')
          return {
            ...base,
            DesktopCaptureSourceType: {
              SCREEN: 'screen',
              WINDOW: 'window',
              TAB: 'tab',
              AUDIO: 'audio',
            } as any,
            chooseDesktopMedia: ((sources: string[], targetTabOrCb?: any, maybeCb?: any) => {
              const callback = typeof targetTabOrCb === 'function' ? targetTabOrCb : maybeCb
              const targetTab = typeof targetTabOrCb === 'function' ? undefined : targetTabOrCb
              const requestId = ++nextRequestId
              Promise.resolve(choose(requestId, sources, targetTab))
                .catch(() => null)
                .then((result: any) => {
                  if (typeof callback !== 'function') return
                  try {
                    callback(result?.streamId || '', {
                      canRequestAudioTrack: result?.canRequestAudioTrack === true,
                    })
                  } catch {
                    /* listener threw — swallow, mirrors Chrome */
                  }
                })
              return requestId
            }) as any,
            cancelChooseDesktopMedia: ((requestId: number) => {
              invokeExtension('desktopCapture.cancelChooseDesktopMedia')(requestId)
            }) as any,
          }
        },
      },

      // chrome.tabCapture — getMediaStreamId mints a token that the
      // getUserMedia wrapper redeems for WebContents.getMediaSourceId.
      // capture() (MV2/extension pages) is getMediaStreamId + getUserMedia in
      // one step, using the caller's active tab like Chrome.
      tabCapture: {
        shouldInject: () => manifestDeclaresPermission('tabCapture'),
        factory: (base) => {
          const getMediaStreamId = invokeExtension('tabCapture.getMediaStreamId')
          const toTrack = (wanted: any, extra: any, streamId: string) => {
            if (!wanted) return false
            const mandatory = {
              ...((extra && extra.mandatory) || {}),
              chromeMediaSource: 'tab',
              chromeMediaSourceId: streamId,
            }
            return { ...(extra || {}), mandatory }
          }
          return {
            ...base,
            getMediaStreamId,
            getCapturedTabs: invokeExtension('tabCapture.getCapturedTabs'),
            onStatusChanged: new ExtensionEvent('tabCapture.onStatusChanged'),
            capture: ((options: any, callback?: (stream: MediaStream | null) => void) => {
              const run = async () => {
                const streamId: string = await getMediaStreamId({})
                return navigator.mediaDevices.getUserMedia({
                  audio: toTrack(options?.audio, options?.audioConstraints, streamId),
                  video: toTrack(options?.video, options?.videoConstraints, streamId),
                } as any)
              }
              run().then(
                (stream) => {
                  crxSetLastError(undefined)
                  try {
                    callback?.(stream)
                  } catch {}
                },
                (err: any) => {
                  crxSetLastError((err && err.message) || 'Error starting tab capture')
                  try {
                    callback?.(null)
                  } catch {
                  } finally {
                    crxSetLastError(undefined)
                  }
                },
              )
            }) as any,
          }
        },
      },

      // chrome.system.{cpu,memory,display} — gated on any of the three
      // system.* permissions. Read methods return real Node/Electron data;
      // write methods are accepted as no-ops.
      system: {
        // Each sub-namespace is bound by its own permission in Chrome
        // (system.cpu without "system.display" has no chrome.system.display).
        shouldInject: () =>
          manifestDeclaresPermission('system.cpu') ||
          manifestDeclaresPermission('system.memory') ||
          manifestDeclaresPermission('system.display'),
        factory: (base) => ({
          ...base,
          cpu: manifestDeclaresPermission('system.cpu')
            ? { getInfo: invokeExtension('system.cpu.getInfo') }
            : (base as any)?.cpu,
          memory: manifestDeclaresPermission('system.memory')
            ? { getInfo: invokeExtension('system.memory.getInfo') }
            : (base as any)?.memory,
          display: !manifestDeclaresPermission('system.display') ? (base as any)?.display : {
            getInfo: invokeExtension('system.display.getInfo'),
            getDisplayLayout: invokeExtension('system.display.getDisplayLayout'),
            setDisplayProperties: invokeExtension('system.display.setDisplayProperties', {
              noop: true,
            }),
            setEnabledDisplays: invokeExtension('system.display.setEnabledDisplays', {
              noop: true,
            }),
            setDisplayLayout: invokeExtension('system.display.setDisplayLayout', { noop: true }),
            onDisplayChanged: new ExtensionEvent('system.display.onDisplayChanged'),
          },
        }),
      },

      // chrome.browsingData — gated on "browsingData" permission. Maps onto
      // Electron session.clearCache/clearStorageData + host history impl.
      browsingData: {
        shouldInject: () => manifestDeclaresPermission('browsingData'),
        factory: (base) => ({
          ...base,
          remove: invokeExtension('browsingData.remove'),
          removeAppcache: invokeExtension('browsingData.removeAppcache'),
          removeCache: invokeExtension('browsingData.removeCache'),
          removeCookies: invokeExtension('browsingData.removeCookies'),
          removeDownloads: invokeExtension('browsingData.removeDownloads'),
          removeFileSystems: invokeExtension('browsingData.removeFileSystems'),
          removeFormData: invokeExtension('browsingData.removeFormData'),
          removeHistory: invokeExtension('browsingData.removeHistory'),
          removeIndexedDB: invokeExtension('browsingData.removeIndexedDB'),
          removeLocalStorage: invokeExtension('browsingData.removeLocalStorage'),
          removePluginData: invokeExtension('browsingData.removePluginData'),
          removePasswords: invokeExtension('browsingData.removePasswords'),
          removeWebSQL: invokeExtension('browsingData.removeWebSQL'),
          removeServiceWorkers: invokeExtension('browsingData.removeServiceWorkers'),
          settings: invokeExtension('browsingData.settings'),
        }),
      },

      // chrome.management — gated on "management". Reads from the session's
      // loaded extensions; setEnabled/uninstall delegate to the host impl.
      management: {
        // getSelf / uninstallSelf / getPermissionWarningsByManifest are open to
        // every extension; the rest of the namespace requires "management".
        factory: (base) => ({
          ...base,
          getSelf: invokeExtension('management.getSelf'),
          getPermissionWarningsByManifest: invokeExtension(
            'management.getPermissionWarningsByManifest',
          ),
          uninstallSelf: invokeExtension('management.uninstallSelf'),
          ...(manifestDeclaresPermission('management')
            ? {
                get: invokeExtension('management.get'),
                getAll: invokeExtension('management.getAll'),
                getPermissionWarningsById: invokeExtension(
                  'management.getPermissionWarningsById',
                ),
                setEnabled: invokeExtension('management.setEnabled'),
                uninstall: invokeExtension('management.uninstall'),
                onInstalled: new ExtensionEvent('management.onInstalled'),
                onUninstalled: new ExtensionEvent('management.onUninstalled'),
                onEnabled: new ExtensionEvent('management.onEnabled'),
                onDisabled: new ExtensionEvent('management.onDisabled'),
              }
            : {}),
        }),
      },

      // chrome.declarativeContent — not native in Electron. Mirrors the SW
      // core-ns copy for MV2 background pages; rules are evaluated per tab by
      // browser/api/declarative-content.ts (ShowAction enables the action).
      declarativeContent: {
        shouldInject: () => manifestDeclaresPermission('declarativeContent'),
        factory: (base: any) => {
          const dcType = (instanceType: string) =>
            function (this: any, init?: any) {
              if (init && typeof init === 'object') Object.assign(this, init)
              this.instanceType = instanceType
            }
          return {
            ...base,
            PageStateMatcher: dcType('declarativeContent.PageStateMatcher'),
            ShowAction: dcType('declarativeContent.ShowAction'),
            ShowPageAction: dcType('declarativeContent.ShowPageAction'),
            SetIcon: dcType('declarativeContent.SetIcon'),
            RequestContentScript: dcType('declarativeContent.RequestContentScript'),
            onPageChanged: {
              addRules: invokeExtension('declarativeContent.addRules'),
              removeRules: invokeExtension('declarativeContent.removeRules'),
              getRules: invokeExtension('declarativeContent.getRules'),
              addListener: () => {},
              removeListener: () => {},
              hasListener: () => false,
              hasListeners: () => false,
            },
          }
        },
      } as any,

      // chrome.search — requires the "search" permission. query() opens a search tab
      // via impl.createTab.
      search: {
        shouldInject: () => manifestDeclaresPermission('search'),
        factory: (base) => ({
          ...base,
          query: invokeExtension('search.query'),
          queryInTab: invokeExtension('search.queryInTab'),
        }),
      },

      // chrome.sessions — gated on "sessions". In-memory recently-closed list
      // rebuilt from the store's tab-removed signal.
      sessions: {
        shouldInject: () => manifestDeclaresPermission('sessions'),
        factory: (base) => ({
          ...base,
          getRecentlyClosed: invokeExtension('sessions.getRecentlyClosed'),
          restore: invokeExtension('sessions.restore'),
          getDevices: invokeExtension('sessions.getDevices'),
          onChanged: new ExtensionEvent('sessions.onChanged'),
          MAX_SESSION_RESULTS: 25,
        }),
      },

      // chrome.tabGroups — gated on "tabGroups". Shares in-memory group state
      // with chrome.tabs.group/ungroup (registered from index.ts).
      tabGroups: {
        shouldInject: () => manifestDeclaresPermission('tabGroups'),
        factory: (base) => ({
          ...base,
          // Chrome uses -1 for tabs that do not belong to a tab group.
          TAB_GROUP_ID_NONE: -1,
          get: invokeExtension('tabGroups.get'),
          query: invokeExtension('tabGroups.query'),
          update: invokeExtension('tabGroups.update'),
          move: invokeExtension('tabGroups.move'),
          onCreated: new ExtensionEvent('tabGroups.onCreated'),
          onMoved: new ExtensionEvent('tabGroups.onMoved'),
          onUpdated: new ExtensionEvent('tabGroups.onUpdated'),
          onRemoved: new ExtensionEvent('tabGroups.onRemoved'),
        }),
      },

      // chrome.contentSettings — gated on "contentSettings". Electron has no
      // per-site content settings, so each ChromeSetting returns 'allow' from
      // get() and accepts set/clear as no-ops (extensions querying it get a
      // well-formed value instead of a crash).
      contentSettings: {
        shouldInject: () => manifestDeclaresPermission('contentSettings'),
        factory: (base) => {
          const cs = () => ({
            get: (_d: any, cb: any) => {
              const r = { setting: 'allow', scope: 'regular' }
              if (typeof cb === 'function') cb(r)
              return Promise.resolve(r)
            },
            set: (_d: any, cb: any) => {
              if (typeof cb === 'function') cb()
              return Promise.resolve()
            },
            clear: (_d: any, cb: any) => {
              if (typeof cb === 'function') cb()
              return Promise.resolve()
            },
            onChange: {
              addListener: () => {},
              removeListener: () => {},
              hasListener: () => false,
            },
          })
          return {
            ...base,
            javascript: cs(),
            images: cs(),
            plugins: cs(),
            unsandboxedPlugins: cs(),
            popups: cs(),
            notifications: cs(),
            cookies: cs(),
            automaticDownloads: cs(),
            fullscreen: cs(),
            microphone: cs(),
            camera: cs(),
            midi: cs(),
          }
        },
      },

      // chrome.fontSettings — gated on "fontSettings". Backed by FontSettingsAPI
      // (persisted to userData/font-settings.json; set*/clear* broadcast the
      // matching on*Changed event). getFontList enumerates real OS fonts.
      fontSettings: {
        shouldInject: () => manifestDeclaresPermission('fontSettings'),
        factory: (base) => ({
          ...base,
          getFont: invokeExtension('fontSettings.getFont'),
          setFont: invokeExtension('fontSettings.setFont'),
          clearFont: invokeExtension('fontSettings.clearFont'),
          getDefaultFontSize: invokeExtension('fontSettings.getDefaultFontSize'),
          setDefaultFontSize: invokeExtension('fontSettings.setDefaultFontSize'),
          clearDefaultFontSize: invokeExtension('fontSettings.clearDefaultFontSize'),
          getDefaultFixedFontSize: invokeExtension('fontSettings.getDefaultFixedFontSize'),
          setDefaultFixedFontSize: invokeExtension('fontSettings.setDefaultFixedFontSize'),
          clearDefaultFixedFontSize: invokeExtension('fontSettings.clearDefaultFixedFontSize'),
          getMinimumFontSize: invokeExtension('fontSettings.getMinimumFontSize'),
          setMinimumFontSize: invokeExtension('fontSettings.setMinimumFontSize'),
          clearMinimumFontSize: invokeExtension('fontSettings.clearMinimumFontSize'),
          getFontList: invokeExtension('fontSettings.getFontList'),
          onFontChanged: new ExtensionEvent('fontSettings.onFontChanged'),
          onDefaultFontSizeChanged: new ExtensionEvent('fontSettings.onDefaultFontSizeChanged'),
          onDefaultFixedFontSizeChanged: new ExtensionEvent(
            'fontSettings.onDefaultFixedFontSizeChanged',
          ),
          onMinimumFontSizeChanged: new ExtensionEvent('fontSettings.onMinimumFontSizeChanged'),
        }),
      },

      // chrome.tts — gated on "tts". speak() returns true (queued); on Windows
      // it drives SAPI via powershell. getVoices returns []; pause/resume noop.
      tts: {
        shouldInject: () => manifestDeclaresPermission('tts'),
        factory: (base) => ({
          ...base,
          speak: invokeExtension('tts.speak'),
          stop: invokeExtension('tts.stop'),
          pause: invokeExtension('tts.pause', { noop: true }),
          resume: invokeExtension('tts.resume', { noop: true }),
          isSpeaking: invokeExtension('tts.isSpeaking'),
          getVoices: invokeExtension('tts.getVoices'),
        }),
      },

      // chrome.sidePanel (MV3) — gated on "sidePanel". Backed by SidePanelAPI
      // (per-tab/global options + openPanelOnActionClick behavior); open() asks
      // the host to show its right-docked panel container. No events.
      sidePanel: {
        shouldInject: () => manifestDeclaresPermission('sidePanel'),
        factory: (base) => ({
          ...base,
          open: invokeExtension('sidePanel.open'),
          setOptions: invokeExtension('sidePanel.setOptions'),
          setPanelBehavior: invokeExtension('sidePanel.setPanelBehavior'),
          getOptions: invokeExtension('sidePanel.getOptions'),
          getPanelBehavior: invokeExtension('sidePanel.getPanelBehavior'),
          close: invokeExtension('sidePanel.close'),
          onOpened: new ExtensionEvent('sidePanel.onOpened'),
          onClosed: new ExtensionEvent('sidePanel.onClosed'),
        }),
      },

      // chrome.identity — gated on "identity". launchWebAuthFlow opens the auth
      // URL and resolves with the chromiumapp.org redirect (OAuth implicit/PKCE);
      // getRedirectURL is computed locally. getAuthToken (Google-account
      // specific) fails via lastError so extensions fall back to the web flow.
      identity: {
        shouldInject: () => {
          const required = (manifest.permissions as string[] | undefined) || []
          const optional = (manifest.optional_permissions as string[] | undefined) || []
          return required.includes('identity') || optional.includes('identity')
        },
        factory: (base: any) => ({
          ...base,
          getRedirectURL: (path?: string) => {
            const root = `https://${extId()}.chromiumapp.org/`
            return path ? root + String(path).replace(/^\/+/, '') : root
          },
          launchWebAuthFlow: (...args: any[]) => {
            const callback = typeof args[args.length - 1] === 'function' ? args.pop() : undefined
            const details = args[0]
            const bridge = (electron as any).launchIdentityWebAuthFlow
            const resultPromise: Promise<string> =
              typeof bridge === 'function'
                ? new Promise<string>((resolve, reject) => {
                  // Keep the long-lived Promise in the extension's main world.
                  // Only the completion callback crosses contextBridge.
                  try {
                    bridge(extId(), details, (packet: any) => {
                      if (packet?.ok && typeof packet.value === 'string' && packet.value) {
                        resolve(packet.value)
                      } else {
                        reject(new Error(String(packet?.error || 'identity.launchWebAuthFlow failed')))
                      }
                    })
                  } catch (error) {
                    reject(error)
                  }
                })
                : Promise.resolve(invokeExtension('identity.launchWebAuthFlow')(details)).then(
                  (value: any) => {
                    if (typeof value !== 'string' || !value) {
                      throw new Error('identity.launchWebAuthFlow returned no redirect URL')
                    }
                    return value
                  },
                )

            if (!callback) return resultPromise

            resultPromise.then(
              (value) => {
                crxSetLastError(undefined)
                try {
                  callback(value)
                } catch {
                  /* callback errors are isolated from the API bridge */
                } finally {
                  crxSetLastError(undefined)
                }
              },
              (error: any) => {
                crxSetLastError((error && error.message) || 'identity.launchWebAuthFlow failed')
                try {
                  callback(undefined)
                } catch {
                  /* callback errors are isolated from the API bridge */
                } finally {
                  crxSetLastError(undefined)
                }
              },
            ).catch(() => {})
            return undefined
          },
          getAuthToken: invokeExtension('identity.getAuthToken'),
          removeCachedAuthToken: invokeExtension('identity.removeCachedAuthToken'),
          clearAllCachedAuthTokens: invokeExtension('identity.clearAllCachedAuthTokens'),
          getProfileUserInfo: invokeExtension('identity.getProfileUserInfo'),
          onSignInChanged: new ExtensionEvent('identity.onSignInChanged'),
        }),
      } as any,

      // chrome.declarativeNetRequest (MV3) — gated on either DNR permission.
      // Rules (static rulesets + dynamic + session) are stored and enforced
      // synchronously by the main-process DeclarativeNetRequestAPI via
      // WebRequestAPI's existing session hooks (see declarative-net-request.ts).
      declarativeNetRequest: {
        shouldInject: () => {
          // Either DNR permission, granted (permissions) or declared optional.
          // Inject defensively when the manifest isn't bootstrapped yet (popup/
          // options inject early, before runtime.getManifest is ready, and the
          // __crxPatched sentinel would otherwise permanently skip us).
          const perms = (manifest?.permissions as string[] | undefined) || []
          const optional = (manifest?.optional_permissions as string[] | undefined) || []
          if (perms.length === 0 && optional.length === 0) return true
          const all = [...perms, ...optional]
          return (
            all.includes('declarativeNetRequest') ||
            all.includes('declarativeNetRequestWithHostAccess')
          )
        },
        factory: (base: any) => ({
          ...base,
          updateDynamicRules: invokeExtension('declarativeNetRequest.updateDynamicRules'),
          getDynamicRules: invokeExtension('declarativeNetRequest.getDynamicRules'),
          updateSessionRules: invokeExtension('declarativeNetRequest.updateSessionRules'),
          getSessionRules: invokeExtension('declarativeNetRequest.getSessionRules'),
          getEnabledRulesets: invokeExtension('declarativeNetRequest.getEnabledRulesets'),
          updateEnabledRulesets: invokeExtension('declarativeNetRequest.updateEnabledRulesets'),
          getAvailableStaticRuleCount: invokeExtension(
            'declarativeNetRequest.getAvailableStaticRuleCount',
          ),
          getMatchedRules: invokeExtension('declarativeNetRequest.getMatchedRules'),
          isRegexSupported: invokeExtension('declarativeNetRequest.isRegexSupported'),
          setExtensionActionOptions: invokeExtension(
            'declarativeNetRequest.setExtensionActionOptions',
          ),
          onRuleMatchedDebug: new ExtensionEvent('declarativeNetRequest.onRuleMatchedDebug'),
          // Constants (extensions read these; undefined would throw). Values per
          // the current chrome.declarativeNetRequest spec.
          ResourceType: {
            MAIN_FRAME: 'main_frame',
            SUB_FRAME: 'sub_frame',
            STYLESHEET: 'stylesheet',
            SCRIPT: 'script',
            IMAGE: 'image',
            FONT: 'font',
            OBJECT: 'object',
            XMLHTTPREQUEST: 'xmlhttprequest',
            PING: 'ping',
            CSP_REPORT: 'csp_report',
            MEDIA: 'media',
            WEBSOCKET: 'websocket',
            WEBTRANSPORT: 'webtransport',
            WEBBUNDLE: 'webbundle',
            OTHER: 'other',
          },
          RuleActionType: {
            BLOCK: 'block',
            REDIRECT: 'redirect',
            ALLOW: 'allow',
            UPGRADE_SCHEME: 'upgradeScheme',
            MODIFY_HEADERS: 'modifyHeaders',
            ALLOW_ALL_REQUESTS: 'allowAllRequests',
          },
          RequestMethod: {
            CONNECT: 'connect',
            DELETE: 'delete',
            GET: 'get',
            HEAD: 'head',
            OPTIONS: 'options',
            PATCH: 'patch',
            POST: 'post',
            PUT: 'put',
          },
          DomainType: { FIRST_PARTY: 'firstParty', THIRD_PARTY: 'thirdParty' },
          HeaderOperation: { APPEND: 'append', SET: 'set', REMOVE: 'remove' },
          UnsupportedRegexReason: {
            SYNTAX_ERROR: 'syntaxError',
            MEMORY_LIMIT_EXCEEDED: 'memoryLimitExceeded',
          },
          GUARANTEED_MINIMUM_STATIC_RULES: 30000,
          MAX_NUMBER_OF_DYNAMIC_RULES: 30000,
          MAX_NUMBER_OF_SESSION_RULES: 5000,
          MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES: 5000,
          MAX_NUMBER_OF_ENABLED_STATIC_RULESETS: 50,
          MAX_NUMBER_OF_STATIC_RULESETS: 100,
          MAX_NUMBER_OF_REGEX_RULES: 1000,
          MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES: 5000,
          MAX_NUMBER_OF_UNSAFE_SESSION_RULES: 5000,
          GETMATCHEDRULES_QUOTA_INTERVAL: 600,
          MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL: 20,
          DYNAMIC_RULESET_ID: '_dynamic',
          SESSION_RULESET_ID: '_session',
        }),
      } as any,

      // chrome.userScripts (MV3). Not present in this project's @types/chrome,
      // so typed loosely. Electron has no native implementation; the vendored
      // browser-side UserScriptsAPI stores and injects the scripts.
      userScripts: {
        shouldInject: () => manifestDeclaresPermission('userScripts'),
        factory: (base: any) => {
          return {
            __crxHosted: true,
            // Spec enum (chrome.userScripts.ExecutionWorld). Pure data constant
            // as a fallback; if native `base` already carries it (identical
            // values) that wins via the spread below. `execute()` (Chrome 135+)
            // is intentionally absent — the browser-side API has no handler, and
            // a present-but-rejecting method would defeat feature detection.
            ExecutionWorld: { MAIN: 'MAIN', USER_SCRIPT: 'USER_SCRIPT' },
            ...base,
            register: invokeExtension('userScripts.register'),
            update: invokeExtension('userScripts.update'),
            unregister: invokeExtension('userScripts.unregister'),
            getScripts: invokeExtension('userScripts.getScripts'),
            configureWorld: invokeExtension('userScripts.configureWorld'),
            getWorldConfigurations: invokeExtension('userScripts.getWorldConfigurations'),
            resetWorldConfiguration: invokeExtension('userScripts.resetWorldConfiguration'),
          }
        },
      } as any,

      // chrome.scripting (MV3).
      //
      // executeScript: prefer Electron's native C++ implementation. Electron
      // (>= 35, incl. 42) injects executeScript into the extension's
      // content-script ISOLATED world — exactly like Chrome — so a declarative
      // content script (manifest `content_scripts`) and a later executeScript
      // share the same world and globals. Our IPC fallback below injects into
      // the page MAIN world instead, which breaks extensions that define a
      // helper in their content script and call it from an injected controller
      // (e.g. CircleReader: app.js defines `window.definePlugin` in the
      // isolated world, then loads `controller/*.js` via executeScript and the
      // controller calls `definePlugin`). Only fall back to IPC when no native
      // implementation is present.
      //
      // registerContentScripts and friends stay on the IPC path: Electron's
      // native dynamic content-script registration does not inject into the
      // contextIsolation:false `persist:view` pages this app uses, so the
      // vendored ScriptingAPI handles them (see scripting.ts).
      scripting: {
        shouldInject: () => manifestDeclaresPermission('scripting'),
        factory: (base: any) => {
          const ipcExecuteScript = invokeExtension('scripting.executeScript', {
            // A `func` can't survive structured-clone over IPC; stringify it so
            // the browser side can rebuild and invoke it with `args`.
            serialize: (injection: any = {}) => {
              if (injection && typeof injection.func === 'function') {
                injection = { ...injection, func: injection.func.toString() }
              }
              return [injection]
            },
          })
          const nativeExecuteScript =
            typeof base?.executeScript === 'function' ? base.executeScript.bind(base) : null
          const executeWithStorageCompatibility = (
            injection: any,
            callback?: (...args: any[]) => void,
          ) => {
            if (
              !nativeExecuteScript ||
              String(injection?.world || 'ISOLATED').toUpperCase() === 'MAIN'
            ) {
              return nativeExecuteScript
                ? nativeExecuteScript(injection, callback)
                : ipcExecuteScript(injection, callback)
            }

            // Native executeScript creates/uses an extension-specific isolated
            // world after the preload API overrides have run. Patch that same
            // world before loading the requested file or function.
            const compatibilityInjection = {
              target: injection?.target,
              world: 'ISOLATED',
              injectImmediately: injection?.injectImmediately,
              func: () => {
                try {
                  const chromeApi: any = (globalThis as any).chrome
                  const storage: any = chromeApi && chromeApi.storage
                  if (!storage) return
                  let local: any
                  try {
                    local = storage.local
                  } catch {
                    return
                  }
                  if (!local) return
                  let replaceStorage = false
                  for (const name of ['sync', 'managed']) {
                    let current: any
                    try {
                      current = storage[name]
                    } catch {}
                    if (current === local) continue
                    try {
                      Object.defineProperty(storage, name, {
                        value: local,
                        configurable: true,
                        enumerable: true,
                        writable: true,
                      })
                      if (storage[name] !== local) replaceStorage = true
                    } catch {
                      replaceStorage = true
                    }
                  }
                  if (!replaceStorage) return
                  let session: any
                  let onChanged: any
                  try {
                    session = storage.session
                  } catch {}
                  try {
                    onChanged = storage.onChanged
                  } catch {}
                  const replacement: any = { local, sync: local, managed: local }
                  if (session) replacement.session = session
                  if (onChanged) replacement.onChanged = onChanged
                  try {
                    Object.defineProperty(chromeApi, 'storage', {
                      value: replacement,
                      configurable: true,
                      enumerable: true,
                      writable: true,
                    })
                  } catch {}
                } catch {}
              },
            }

            // Native injections are invisible to the main process. Report the
            // target once the files ran (their SHIM receive bridge is live) and
            // before the caller observes completion, so an immediate
            // tabs.sendMessage reaches them instead of "Receiving end does not
            // exist". Only file injections carry the SHIM bridge.
            const markInjected = () =>
              Array.isArray(injection?.files) && injection.files.length && injection?.target
                ? Promise.resolve(
                    (electron as any).invokeExtensionRaw(
                      extId(),
                      'scripting.markInjected',
                      {},
                      injection.target,
                    ),
                  ).catch(() => undefined)
                : Promise.resolve(undefined)
            const result = Promise.resolve(nativeExecuteScript(compatibilityInjection))
              .catch(() => undefined)
              .then(() => nativeExecuteScript(injection))
              .then((r: any) => markInjected().then(() => r))
            if (!callback) return result
            result.then(
              (r: any) => {
                try {
                  callback(r)
                } catch {}
              },
              (err: any) => {
                crxSetLastError((err && err.message) || 'scripting.executeScript failed')
                try {
                  callback(undefined)
                } catch {
                } finally {
                  crxSetLastError(undefined)
                }
              },
            )
            return undefined
          }
          return {
            ...base,
            registerContentScripts: invokeExtension('scripting.registerContentScripts'),
            unregisterContentScripts: invokeExtension('scripting.unregisterContentScripts'),
            updateContentScripts: invokeExtension('scripting.updateContentScripts'),
            getRegisteredContentScripts: invokeExtension('scripting.getRegisteredContentScripts'),
            executeScript: executeWithStorageCompatibility,
            insertCSS: invokeExtension('scripting.insertCSS'),
            removeCSS: invokeExtension('scripting.removeCSS'),
          }
        },
      } as any,

      webNavigation: {
        shouldInject: () => manifestDeclaresPermission('webNavigation'),
        factory: (base) => {
          return {
            ...base,
            getFrame: invokeExtension('webNavigation.getFrame'),
            getAllFrames: invokeExtension('webNavigation.getAllFrames'),
            onBeforeNavigate: new ExtensionEvent('webNavigation.onBeforeNavigate'),
            onCommitted: new ExtensionEvent('webNavigation.onCommitted'),
            onCompleted: new ExtensionEvent('webNavigation.onCompleted'),
            onCreatedNavigationTarget: new ExtensionEvent(
              'webNavigation.onCreatedNavigationTarget',
            ),
            onDOMContentLoaded: new ExtensionEvent('webNavigation.onDOMContentLoaded'),
            onErrorOccurred: new ExtensionEvent('webNavigation.onErrorOccurred'),
            onHistoryStateUpdated: new ExtensionEvent('webNavigation.onHistoryStateUpdated'),
            onReferenceFragmentUpdated: new ExtensionEvent(
              'webNavigation.onReferenceFragmentUpdated',
            ),
            onTabReplaced: new ExtensionEvent('webNavigation.onTabReplaced'),
          }
        },
      },

      webRequest: {
        shouldInject: () => manifestDeclaresPermission('webRequest'),
        factory: (base) => {
          // Electron 43 binds chrome.webRequest natively, but every event prop
          // resolves to undefined and each read logs "No source for
          // require(webRequestEvent)" as an extension RuntimeError. Copy only
          // the non-event members (enums, *Options, handlerBehaviorChanged,
          // MAX_* constants) by name so the native events are never touched.
          const nativeMembers: Record<string, any> = {}
          try {
            for (const name of Object.getOwnPropertyNames(base || {})) {
              if (/^on[A-Z]/.test(name)) continue
              try {
                nativeMembers[name] = (base as any)[name]
              } catch {}
            }
          } catch {}
          const eventFor = (key: string, name: string) => {
            if (manifest.manifest_version !== 2) return new ExtensionEvent(name)
            let nativeEvent: any
            try {
              nativeEvent = (base as any)?.[key]
            } catch {}
            if (
              nativeEvent &&
              typeof nativeEvent.addListener === 'function' &&
              typeof nativeEvent.removeListener === 'function'
            ) {
              return nativeEvent
            }
            return new ExtensionEvent(name)
          }
          return {
            ...nativeMembers,
            // AdGuard 等扩展依赖这些事件来拦截和统计网络请求
            onBeforeRequest: eventFor('onBeforeRequest', 'webRequest.onBeforeRequest'),
            onBeforeSendHeaders: eventFor(
              'onBeforeSendHeaders',
              'webRequest.onBeforeSendHeaders',
            ),
            onHeadersReceived: eventFor('onHeadersReceived', 'webRequest.onHeadersReceived'),
            // onResponseStarted 是非阻塞的"响应已开始"事件。IDM Integration Module
            // 依赖它检测视频/媒体响应(Kb 处理器)以决定显示下载浮层;原实现漏暴露此事件
            // → IDM 永远收不到媒体响应 → 视频下载条不出现。
            onResponseStarted: new ExtensionEvent('webRequest.onResponseStarted'),
            // onSendHeaders / onBeforeRedirect are non-blocking info events
            // (wired to the session in web-request.ts). onAuthRequired's surface
            // is exposed so proxy/auth extensions that register it don't crash;
            // Electron routes HTTP auth through the app 'login' event, not
            // session.webRequest, so it does not fire from the network stack.
            onSendHeaders: new ExtensionEvent('webRequest.onSendHeaders'),
            onBeforeRedirect: new ExtensionEvent('webRequest.onBeforeRedirect'),
            onAuthRequired: eventFor('onAuthRequired', 'webRequest.onAuthRequired'),
            onCompleted: new ExtensionEvent('webRequest.onCompleted'),
            onErrorOccurred: new ExtensionEvent('webRequest.onErrorOccurred'),
          }
        },
      },

      windows: {
        factory: (base) => {
          return {
            ...base,
            WINDOW_ID_NONE: -1,
            WINDOW_ID_CURRENT: -2,
            get: invokeExtension('windows.get'),
            getCurrent: invokeExtension('windows.getCurrent'),
            getLastFocused: invokeExtension('windows.getLastFocused'),
            getAll: invokeExtension('windows.getAll'),
            create: invokeExtension('windows.create'),
            update: invokeExtension('windows.update'),
            remove: invokeExtension('windows.remove'),
            onCreated: new ExtensionEvent('windows.onCreated'),
            onRemoved: new ExtensionEvent('windows.onRemoved'),
            onFocusChanged: new ExtensionEvent('windows.onFocusChanged'),
            onBoundsChanged: new ExtensionEvent('windows.onBoundsChanged'),
          }
        },
      },
    }

    // Initialize APIs.
    //
    // CRITICAL: each factory must be isolated in its own try/catch. If any
    // single factory throws synchronously (e.g. it touches a native getter
    // that is unimplemented in this Electron build), an unguarded forEach
    // aborts the WHOLE loop — every API after the failing one is left
    // unpatched. That is the root cause of the cascade we hit: `storage`
    // never gets its sync->local override (so chrome.storage.sync keeps
    // throwing in popup/content/SW) and `contextMenus` never gets its
    // `update` shim (so background.js crashes with "Cannot read properties
    // of undefined (reading 'update')"). Per-key isolation guarantees a
    // bad factory only loses its own API, not all the others.
    //
    // We also front-load the highest-value overrides so they land even if a
    // later factory misbehaves. `storage` first: it's the one that crashes
    // extensions hardest (native sync/managed getters throw on access).
    const apiOrder = Object.keys(apiDefinitions)
    apiOrder.sort((a, b) => {
      const priority = (k: string) =>
        k === 'storage' ? 0 : k === 'contextMenus' ? 1 : k === 'permissions' ? 2 : 3
      return priority(a) - priority(b)
    })
    apiOrder.forEach((key: any) => {
      const apiName: keyof typeof chrome = key
      const api = apiDefinitions[apiName]!
      try {
        // Read the native base behind the try too — reading some namespaces
        // can itself throw on unimplemented backends.
        const baseApi = chrome[apiName] as any

        // Allow APIs to opt-out of being available in this context.
        if (api.shouldInject && !api.shouldInject()) {
          return
        }

        // Extension pages created during the MV3 bootstrap can run before
        // Chromium has attached every native namespace (notably
        // chrome.runtime in an offscreen document). Factories are expected to
        // layer their implementation over a namespace object, so give them an
        // empty base until Chromium finishes that attachment instead of
        // aborting the namespace patch with e.g. `undefined.getPlatformInfo`.
        const value = api.factory(baseApi || {})

        // 1) Try to replace the whole namespace object.
        let landed = false
        try {
          Object.defineProperty(chrome, apiName, {
            value,
            enumerable: true,
            configurable: true,
          })
          landed = (chrome as any)[apiName] === value
        } catch {
          /* not configurable — fall through to in-place patch */
        }

        // 2) Electron 42 exposes NATIVE chrome.* (declarativeNetRequest, …) in
        // extension contexts that can be NON-CONFIGURABLE, so the defineProperty
        // above silently no-ops and the native impl stays — e.g.
        // chrome.declarativeNetRequest keeps its native isRegexSupported (no
        // ReDoS guard) / onRuleMatchedDebug shape. Patch our factory's keys
        // ONTO the native object so our framework methods win.
        //
        // SCOPED to namespaces CONFIRMED shadowed by a non-configurable native
        // (currently tabs / declarativeNetRequest / identity). A broad fallback across ALL
        // factories regressed offscreen/runtime messaging for some extensions
        // (their createDocument/sendMessage paths), and every other namespace
        // already worked via the defineProperty path above — so extend this set
        // only when a specific namespace is confirmed shadowed.
        // userScripts: Chromium 138 (Electron 42) exposes a NATIVE
        // chrome.userScripts to MV3 extensions, gated behind an "allow user
        // scripts" toggle Electron has no UI for. In a fully-bootstrapped
        // extension PAGE (e.g. ScriptCat's popup) that native object is present
        // and NON-CONFIGURABLE, so the defineProperty above silently no-ops and
        // native getScripts/register (which throw / return junk without the
        // toggle) stay — ScriptCat's availability probe then fails and shows
        // "Allow User Scripts is not enabled". (In the SW, native isn't
        // bootstrapped yet when this runs, so the factory lands fresh — which is
        // why the SW path works but the popup doesn't.) Patch our IPC-backed
        // methods ONTO the native object so they win. See
        // [[sandboxed-popup-native-tabs-nonconfigurable]].
        // MV3 service workers expose chrome.runtime itself as non-configurable,
        // while its event properties remain configurable. Keep Chromium's
        // outbound sendMessage/id/getManifest surface, but install the hosted
        // inbound event bridge in place. The factory has already captured the
        // original event objects, so listeners registered before this patch
        // remain reachable through the native portbroker merge.
        if (!landed && apiName === 'runtime') {
          const target = (chrome as any).runtime
          // Electron exposes chrome.runtime as a non-configurable native
          // object in some extension pages (notably popups). In that case the
          // whole namespace cannot be replaced, but the native
          // connectNative/sendNativeMessage implementations are disabled and
          // must be replaced with our IPC-backed implementations. Keep the
          // regular messaging methods native and only patch the methods that
          // are owned by this hosted runtime layer.
          const runtimeMethods = [
            'connectNative',
            'sendNativeMessage',
            'openOptionsPage',
            'getPlatformInfo',
          ]
          const runtimeEvents = isWorkerContext
            ? ['onMessage', 'onConnect', 'onMessageExternal', 'onConnectExternal']
            : []
          let runtimeNativePatched = false
          for (const prop of [...runtimeMethods, ...runtimeEvents]) {
            const replacement = (value as any)?.[prop]
            if (!target || replacement == null) continue
            try {
              Object.defineProperty(target, prop, {
                value: replacement,
                configurable: true,
                enumerable: true,
                writable: true,
              })
              if (prop === 'connectNative' && (target as any)[prop] === replacement) {
                runtimeNativePatched = true
              }
            } catch {
              try {
                target[prop] = replacement
                if (prop === 'connectNative' && (target as any)[prop] === replacement) {
                  runtimeNativePatched = true
                }
              } catch {
                /* locked native event — readiness remains false */
              }
            }
          }
          // This marker is intentionally narrower than __crxPatched. The
          // latter records that injection completed, while a non-configurable
          // native runtime may still reject every hosted method. Sandboxed
          // extension-page shims use this marker to decide whether they must
          // install their own fallback.
          try {
            Object.defineProperty(target, '__crxRuntimePatched', {
              value: runtimeNativePatched,
              configurable: true,
              enumerable: false,
              writable: true,
            })
          } catch {
            try {
              target.__crxRuntimePatched = runtimeNativePatched
            } catch {
              /* best effort */
            }
          }
        } else if (apiName === 'runtime' && landed) {
          try {
            Object.defineProperty((chrome as any).runtime, '__crxRuntimePatched', {
              value: true,
              configurable: true,
              enumerable: false,
              writable: true,
            })
          } catch {
            try {
              ;(chrome as any).runtime.__crxRuntimePatched = true
            } catch {
              /* best effort */
            }
          }
        }

        if (
          !landed &&
          (apiName === 'tabs' ||
            apiName === 'declarativeNetRequest' ||
            apiName === 'identity' ||
            apiName === 'userScripts')
        ) {
          const target = (chrome as any)[apiName]
          if (target && typeof target === 'object' && value && typeof value === 'object') {
            for (const prop of Object.keys(value)) {
              try {
                Object.defineProperty(target, prop, {
                  value: (value as any)[prop],
                  configurable: true,
                  enumerable: true,
                  writable: true,
                })
              } catch {
                try {
                  ;(target as any)[prop] = (value as any)[prop]
                } catch {
                  /* prop locked — skip */
                }
              }
            }
          }
          try {
            console.warn(
              `[crx-preload] chrome.${String(apiName)} native non-configurable; patched ${
                Object.keys(value).length
              } factory methods onto native`,
            )
          } catch {
            /* diag */
          }
        }
      } catch (err: any) {
        // Never let one API's failure block the rest (esp. storage).
        console.error(
          `[crx-preload] failed to inject chrome.${String(apiName)}: ${err && err.message}`,
        )
      }
    })

    // Remove access to internals
    // DIAG/FIX: do NOT delete globalThis.electron. ExtensionEvent.addListener
    // (used by chrome.action.onClicked etc.) is invoked by extension code that
    // runs AFTER this injection turn; if deleting the global also tears down the
    // contextBridge proxy the closure holds, those later addListener calls fail
    // silently and the SW never registers its event listeners with the router
    // (observed: runtime.onMessage/onConnect — registered during this turn —
    // work, but action.onClicked/tabs.onActivated never register).
    // delete (globalThis as any).electron

    // Record that this chrome object is fully patched so a second fire (e.g.
    // the SW poll harness firing after a wake) is a no-op.
    try {
      ;(chrome as any).__crxPatched = true
    } catch {
      /* a native root namespace may reject the sentinel — best-effort */
    }

    // Chrome 148+ keeps each API namespace identical across both roots. Keep
    // Chromium's native browser root, but point its MV3 API properties at the
    // hosted chrome implementations installed above.
    syncBrowserNamespaceAPIs()

    // Signal from the same main-world turn that installed the inbound runtime
    // bridge. The host records this against the exact worker version and still
    // waits for Electron's `running` state before delivering any event.
    if (
      isWorkerContext &&
      (chrome as any).runtime?.onMessage?.__crxHosted === true &&
      (chrome as any).runtime?.onConnect?.__crxHosted === true
    ) {
      try {
        ;(electron as any).notifyWorkerReady?.({ protocol: WORKER_INBOUND_PROTOCOL })
      } catch {
        /* worker stopped during bootstrap */
      }
    }

    // Keep the root namespace extensible, matching Chrome. Extensions commonly
    // normalise cross-browser APIs by adding aliases directly to `chrome`
    // (for example `chrome.action = chrome.browserAction` in an MV2 background
    // page). Freezing the object makes that valid compatibility pattern throw
    // before the extension can initialise. Chrome also permits extensions to
    // replace properties on the exposed namespace objects.

    void 0 // no return
  }

  // Service workers (MV3 background) run their script in a MAIN world that has
  // Electron's native `chrome`, while the SW *preload* runs in a separate
  // ISOLATED world that has no `chrome` at all (verified: globalThis.chrome ===
  // undefined in the preload, === object in the main world). The native
  // chrome.storage exposes `sync`/`managed` which throw '"sync" is not
  // available in this instance of Chrome', crashing extensions like Immersive
  // Translate at background.js startup.
  //
  // So we must inject the API overrides INTO THE MAIN WORLD via
  // contextBridge.executeInMainWorld (same mechanism the frame path uses),
  // NOT run mainWorldScript() locally in the isolated preload world — that
  // would mutate a throwaway object the SW script never sees. `webFrame` is
  // frame-only and absent in a SW, so it cannot be the fallback here.
  //
  // Detect the worker by capability, NOT by `process.type`: in Electron 42 the
  // SW preload is admitted via the `location.href` check in preload.ts
  // (process.type is unreliable), so keying off 'service-worker' alone missed
  // and fell through to the dead frame path. A SW has no `window`/`document`.
  const isWorkerLike =
    typeof window === 'undefined' || typeof (globalThis as any).document === 'undefined'
  if (process.type === 'service-worker' || isWorkerLike) {
    const cb: any = contextBridge
    // SW injection health signal used by the host's one-shot self-heal guard.
    // Keep this narrow; the extension API path should not depend on logs.
    try {
      ipcRenderer.send(
        'crx-beacon',
        `sw-branch type=${process.type} isWorkerLike=${isWorkerLike} ` +
          `hasExecInMain=${typeof cb.executeInMainWorld} hasExposeInMain=${typeof cb.exposeInMainWorld} ` +
          `contextIsolated=${(process as any).contextIsolated} sandboxed=${(process as any).sandboxed}`,
      )
    } catch {}
    if (typeof cb.executeInMainWorld !== 'function') {
      console.error(
        '[crx-preload] service worker preload has no contextBridge.executeInMainWorld; ' +
          'chrome API overrides (incl. storage.sync->local) cannot be applied',
      )
      try {
        ipcRenderer.send('crx-beacon', 'sw-branch ABORT: no executeInMainWorld')
      } catch {}
      return
    }
    // mainWorldScript reads globalThis.electron for IPC; expose it first.
    if (typeof cb.exposeInMainWorld === 'function') {
      try {
        cb.exposeInMainWorld('electron', electronContext)
        try {
          ipcRenderer.send('crx-beacon', 'sw-branch exposeInMainWorld(electron) OK')
        } catch {}
      } catch (e: any) {
        try {
          ipcRenderer.send('crx-beacon', `sw-branch exposeInMainWorld THREW: ${e && e.message}`)
        } catch {}
      }
    }
    // ROBUST electron injection for the SW main world. exposeInMainWorld does
    // NOT reliably land `globalThis.electron` on a WOKEN service worker (it
    // works on the first cold start but not on wake-up), which leaves every
    // IPC-backed API — tabs/windows/alarms/contextMenus/... — dead on wake:
    // the dedicated installer (below) bails at `if (!el) return`, mainWorldScript
    // gets no electron, and the prepended shim's lazy EL resolves undefined, so
    // tabs.query falls back to native chrome (active:false / windowId:0).
    //
    // executeInMainWorld is the ONE mechanism proven to reach the SW main world
    // on EVERY start AND wake (the storage + getPlatformInfo patches above rely
    // on it), and it runs synchronously, so installing electron HERE — before
    // the dedicated installer and mainWorldScript — guarantees they see it. Its
    // args are contextBridge-marshaled, so the callable electronContext survives
    // into the main world (the getPlatformInfo patch already passes data via
    // args; functions marshal the same way). Keep exposeInMainWorld above as a
    // belt-and-suspenders fallback for the cold-start path where it works.
    if (typeof cb.executeInMainWorld === 'function') {
      try {
        cb.executeInMainWorld({
          func: (ctx: any) => {
            try {
              const ok = !!(ctx && typeof ctx.invokeExtension === 'function')
              if (ok) {
                ;(globalThis as any).electron = ctx
              }
            } catch {}
          },
          args: [electronContext],
        })
        try {
          ipcRenderer.send('crx-beacon', 'sw-branch electron-via-exec OK')
        } catch {}
      } catch (e: any) {
        try {
          ipcRenderer.send('crx-beacon', `sw-branch electron-via-exec THREW: ${e && e.message}`)
        } catch {}
      }
    }
    // Preserve Chromium's native browser namespace. Only MV3 contexts missing
    // it receive Chrome's documented browser=chrome fallback.
    cb.executeInMainWorld({ func: installBrowserNamespaceFallback })
    // CRITICAL: patch chrome.storage.sync/managed -> local with a DEDICATED,
    // self-contained function FIRST, independent of mainWorldScript.
    //
    // Why not rely on mainWorldScript's storage factory? Empirically (Electron
    // 42 SW main world) mainWorldScript throws somewhere before its storage
    // override lands — executeInMainWorld swallows the error, so storage stays
    // native and chrome.storage.sync keeps throwing. A minimal inline patch is
    // proven to reach the SW main world and stick (sync===local verified). It
    // must be fully self-contained: executeInMainWorld serializes the function
    // with NO closure access.
    cb.executeInMainWorld({
      func: () => {
        try {
          const st: any = (globalThis as any).chrome && (globalThis as any).chrome.storage
          if (!st) return
          let local: any
          try {
            local = st.local
          } catch {
            return
          }
          if (!local) return
          // A newly created Electron MV3 worker can briefly see an empty local
          // area while the persistent store is still hydrating. Share one small
          // hydration probe across startup reads so an actually empty or very
          // large store never causes repeated full-area reads.
          const wrapHydratingGet = (area: any) => {
            if (
              !area ||
              typeof area.get !== 'function' ||
              area.get.__crxHydrationGuard
            ) {
              return
            }
            const origGet = area.get.bind(area)
            const startedAt = Date.now()
            const startupWindowMs = 500
            const fullReadBudgetBytes = 8 * 1024 * 1024
            const overlayTtlMs = 2000
            let hydrationProbe: Promise<any> | undefined
            let hydrationFinished = false
            let overlayCleanupTimer: any
            const overlay: Record<string, {value: any; expiresAt: number}> = Object.create(null)
            const read = (keys: any): Promise<any> => {
              try {
                const result = origGet(keys)
                return result && typeof result.then === 'function'
                  ? Promise.resolve(result)
                  : Promise.resolve(result || {})
              } catch (error) {
                return Promise.reject(error)
              }
            }
            const canReadFullArea = (): Promise<boolean> =>
              new Promise((resolve) => {
                const getBytesInUse = area.getBytesInUse
                if (typeof getBytesInUse !== 'function') {
                  resolve(false)
                  return
                }
                let settled = false
                let timer: any
                const finish = (bytes: any) => {
                  if (settled) return
                  settled = true
                  clearTimeout(timer)
                  resolve(
                    typeof bytes === 'number' &&
                      Number.isFinite(bytes) &&
                      bytes <= fullReadBudgetBytes,
                  )
                }
                timer = setTimeout(() => finish(undefined), 100)
                try {
                  const result = getBytesInUse.call(area, null, finish)
                  if (result && typeof result.then === 'function') {
                    result.then(finish, () => finish(undefined))
                  } else if (typeof result === 'number') {
                    finish(result)
                  }
                } catch {
                  finish(undefined)
                }
              })
            const isEmpty = (value: any) =>
              !!value && typeof value === 'object' && Object.keys(value).length === 0
            const mergeKeys = (keys: string | string[], result: any, source: any) => {
              const requested = typeof keys === 'string' ? [keys] : keys
              let merged = result
              let added = false
              for (const key of requested) {
                if (
                  !Object.prototype.hasOwnProperty.call(result, key) &&
                  Object.prototype.hasOwnProperty.call(source, key)
                ) {
                  if (!added) merged = {...result}
                  merged[key] = source[key]
                  added = true
                }
              }
              return merged
            }
            const readOverlay = () => {
              const now = Date.now()
              const values: Record<string, any> = Object.create(null)
              for (const key of Object.keys(overlay)) {
                if (overlay[key].expiresAt <= now) {
                  delete overlay[key]
                } else {
                  values[key] = overlay[key].value
                }
              }
              return values
            }
            const cleanupOverlay = () => {
              overlayCleanupTimer = undefined
              const now = Date.now()
              let nextExpiry = Number.POSITIVE_INFINITY
              for (const key of Object.keys(overlay)) {
                if (overlay[key].expiresAt <= now) {
                  delete overlay[key]
                } else {
                  nextExpiry = Math.min(nextExpiry, overlay[key].expiresAt)
                }
              }
              if (nextExpiry !== Number.POSITIVE_INFINITY) {
                overlayCleanupTimer = setTimeout(
                  cleanupOverlay,
                  Math.max(0, nextExpiry - now),
                )
              }
            }
            const probeHydration = () => {
              if (hydrationProbe) return hydrationProbe
              if (hydrationFinished) return Promise.resolve({})
              let attempts = 0
              const probe = (): Promise<any> =>
                canReadFullArea().then((allowed) => {
                  if (!allowed) return {}
                  return read(null).then((all) => {
                    if (!isEmpty(all) || ++attempts >= 3) return all
                    return new Promise<void>((resolve) => setTimeout(resolve, 50)).then(probe)
                  })
                })
              hydrationProbe = probe().then(
                (all) => {
                  hydrationFinished = true
                  hydrationProbe = undefined
                  return all
                },
                (error) => {
                  hydrationProbe = undefined
                  throw error
                },
              )
              return hydrationProbe
            }
            const load = (keys: any): Promise<any> =>
              read(keys).then((result) => {
                const specific =
                  typeof keys === 'string' || (Array.isArray(keys) && keys.length > 0)
                if (!specific) return result
                const requested = typeof keys === 'string' ? [keys] : keys
                if (
                  requested.every((key: string) =>
                    Object.prototype.hasOwnProperty.call(result, key),
                  )
                ) {
                  return result
                }
                const withOverlay = mergeKeys(keys, result, readOverlay())
                if (withOverlay !== result || Date.now() - startedAt > startupWindowMs) {
                  return withOverlay
                }
                return probeHydration().then((all) => mergeKeys(keys, result, all))
              })
            const wrapped = (keys: any, cb?: any) => {
              const result = load(keys)
              if (typeof cb === 'function') {
                result.then(
                  (value) => {
                    try {
                      cb(value)
                    } catch {
                      // best-effort
                    }
                  },
                  () => {
                    try {
                      cb({})
                    } catch {
                      // best-effort
                    }
                  },
                )
                return undefined
              }
              return result
            }
            try {
              Object.defineProperty(wrapped, '__crxHydrationGuard', {
                value: true,
                configurable: true,
              })
              Object.defineProperty(wrapped, '__crxRawGet', {
                value: read,
                configurable: true,
              })
              Object.defineProperty(wrapped, '__crxApplyChanges', {
                value: (changes: any) => {
                  const expiresAt = Date.now() + overlayTtlMs
                  for (const key of Object.keys(changes || {})) {
                    const change = changes[key]
                    if (change && Object.prototype.hasOwnProperty.call(change, 'newValue')) {
                      overlay[key] = {value: change.newValue, expiresAt}
                    } else {
                      delete overlay[key]
                    }
                  }
                  if (!overlayCleanupTimer && Object.keys(overlay).length > 0) {
                    overlayCleanupTimer = setTimeout(cleanupOverlay, overlayTtlMs)
                  }
                },
                configurable: true,
              })
            } catch {
              // best-effort
            }
            try {
              area.get = wrapped
            } catch {
              try {
                Object.defineProperty(area, 'get', {
                  value: wrapped,
                  configurable: true,
                  writable: true,
                })
              } catch {
                return
              }
            }
          }
          wrapHydratingGet(local)
          // Self-contained Blob/File strip for storage.set. The SW's native
          // chrome.storage.local is backed by Electron IPC (V8 serialization),
          // which — unlike structured clone — can't clone Blob/File. A
          // storage.set carrying an imageBlob throws "could not be cloned", the
          // whole write is lost, and dessant's image storage dies here
          // (getStorageItem -> undefined -> the engine page never receives the
          // image -> no upload). Strip recursively before the native set;
          // dessant's image preparer (j1) regenerates the Blob from imageDataUrl,
          // so the strip is lossless. Must be fully self-contained (serialized).
          const strip = (val: any, seen?: WeakSet<any>): any => {
            if (val == null || typeof val !== 'object') return val
            try {
              if (typeof Blob !== 'undefined' && val instanceof Blob) {
                return {__crxBlob: true, type: val.type || '', size: val.size || 0}
              }
              if (typeof File !== 'undefined' && val instanceof File) {
                return {
                  __crxFile: true,
                  type: val.type || '',
                  size: val.size || 0,
                  name: val.name || '',
                }
              }
            } catch {
              // best-effort
            }
            if (!seen) seen = new WeakSet<any>()
            if (seen.has(val)) return null
            try {
              seen.add(val)
            } catch {
              // best-effort
            }
            try {
              if (Array.isArray(val)) {
                const arr: any[] = []
                for (const v of val) arr.push(strip(v, seen))
                return arr
              }
              const out: any = {}
              for (const k of Object.keys(val)) {
                try {
                  const d = Object.getOwnPropertyDescriptor(val, k)
                  if (!d) continue
                  if (typeof d.get === 'function' || typeof d.set === 'function') continue
                  out[k] = strip(d.value, seen)
                } catch {
                  // best-effort
                }
              }
              return out
            } finally {
              try {
                seen.delete(val)
              } catch {
                // best-effort
              }
            }
          }
          // Native storage owns change diffing and onChanged delivery. Do not
          // synthesize events here: listeners would receive duplicate or
          // incomplete StorageChange records without reliable old values.
          const wrapSet = (area: any) => {
            if (!area || typeof area.set !== 'function' || area.__crxStripSet) return
            const origSet = area.set.bind(area)
            const wrapped = (items: any, cb?: any) => {
              let stripped: any
              try {
                stripped = strip(items)
              } catch {
                stripped = items
              }
              if (typeof cb === 'function') {
                try {
                  origSet(stripped, cb)
                } catch {
                  try {
                    cb()
                  } catch {
                    // best-effort
                  }
                }
                return undefined
              }
              return origSet(stripped)
            }
            try {
              area.set = wrapped
            } catch {
              try {
                Object.defineProperty(area, 'set', {
                  value: wrapped,
                  configurable: true,
                  writable: true,
                })
              } catch {
                // set not configurable — leave native (may fail on Blob writes)
                return
              }
            }
            try {
              Object.defineProperty(area, '__crxStripSet', {value: true, configurable: true})
            } catch {
              // best-effort
            }
          }
          wrapSet(local)
          let session: any
          try {
            session = st.session
          } catch {
            session = undefined
          }
          wrapSet(session)
          for (const area of ['sync', 'managed']) {
            try {
              Object.defineProperty(st, area, {
                value: local,
                configurable: true,
                enumerable: true,
                writable: true,
              })
            } catch {
              /* area not configurable — leave as-is */
            }
          }
        } catch {
          /* never let the storage patch break SW startup */
        }
      },
    })
    // CRITICAL: install chrome.alarms with a DEDICATED self-contained patch
    // BEFORE mainWorldScript. mainWorldScript's alarms
    // factory is unreliable in the SW main world (same class of issue as
    // storage/getPlatformInfo), so extensions that call chrome.alarms.create
    // during a search/setup flow crash with "Cannot read 'create' of undefined"
    // and tear down the SW. Backed by the bridged `electron` IPC; onAlarm routes
    // back through addExtensionListener.
    cb.executeInMainWorld({
      func: () => {
        try {
          const c: any = (globalThis as any).chrome
          const el: any = (globalThis as any).electron
          if (!c || !c.runtime || !el) return
          if (c.alarms && typeof c.alarms.create === 'function') return // already present
          // chrome.alarms requires the "alarms" permission (required or optional).
          try {
            const m = c.runtime.getManifest ? c.runtime.getManifest() : null
            if (
              m &&
              ![...(m.permissions || []), ...(m.optional_permissions || [])].includes('alarms')
            ) {
              return
            }
          } catch {
            /* unreadable manifest — keep installing */
          }
          const extId = c.runtime.id
          const inv = (name: string) => (...args: any[]) =>
            el.invokeExtension(extId, name, {}, ...args)
          const alarms = {
            create: inv('alarms.create'),
            get: inv('alarms.get'),
            getAll: inv('alarms.getAll'),
            clear: inv('alarms.clear'),
            clearAll: inv('alarms.clearAll'),
            onAlarm: {
              addListener: (cb2: any) => el.addExtensionListener(extId, 'alarms.onAlarm', cb2),
              removeListener: (cb2: any) =>
                el.removeExtensionListener(extId, 'alarms.onAlarm', cb2),
              hasListener: () => false,
            },
          }
          Object.defineProperty(c, 'alarms', {
            value: alarms,
            configurable: true,
            enumerable: true,
            writable: true,
          })
        } catch (e: any) {
          console.error('[crx-preload] SW alarms patch error: ' + (e && e.message))
        }
      },
    })
    // CRITICAL: install dedicated, self-contained patches for runtime/tabs/windows/
    // notifications / contextMenus BEFORE mainWorldScript — same reasoning as
    // the storage/alarms/getPlatformInfo patches above. mainWorldScript is
    // unreliable in the Electron-42 SW main world (throws early; executeInMainWorld
    // swallows the error), so these namespaces would otherwise stay NATIVE.
    //
    // Unlike alarms, the native SW `chrome.tabs`/`chrome.windows` DO exist but are
    // WRONG here: they query Chromium's own tab registry, which does not track the
    // app's BrowserView tabs. So `chrome.tabs.query({active:true})` returns [] and
    // the extension crashes on `result[0].id` ("Cannot read ... 'id'"), and
    // `chrome.notifications`/`chrome.contextMenus` are undefined (".create" crash).
    // Therefore we install UNCONDITIONALLY (no "already present" guard) so our
    // IPC-backed versions replace the wrong native ones. If mainWorldScript later
    // lands its own (richer) versions before freezing `chrome`, those overwrite
    // ours harmlessly; if it throws first, ours remain and the SW survives.
    cb.executeInMainWorld({
      func: () => {
        try {
          const c: any = (globalThis as any).chrome
          const el: any = (globalThis as any).electron
          if (!c || !c.runtime || !el) return
          // executeInMainWorld serializes this function without its closure,
          // so every helper must be declared locally (mainWorldScript's
          // isWorkerContext / GenericPort are NOT visible here).
          const isWorkerContext =
            typeof (globalThis as any).serviceWorker !== 'undefined' ||
            (typeof (globalThis as any).window === 'undefined' &&
              typeof (globalThis as any).document === 'undefined')
          const extId = c.runtime.id
          // Chrome semantics: promise form rejects on API errors ("No tab with
          // id"), callback form gets runtime.lastError. The legacy
          // invokeExtension swallowed both to undefined.
          const inv = (name: string) => (...args: any[]) => {
            const cb = typeof args[args.length - 1] === 'function' ? args.pop() : undefined
            const p: Promise<any> = Promise.resolve(
              typeof el.invokeExtensionRaw === 'function'
                ? el.invokeExtensionRaw(extId, name, {}, ...args)
                : el.invokeExtension(extId, name, {}, ...args),
            )
            if (!cb) return p
            p.then(
              (r: any) => {
                try {
                  cb(r)
                } catch {}
              },
              (error: any) => {
                try {
                  Object.defineProperty(c.runtime, 'lastError', {
                    value: { message: String((error && error.message) || error) },
                    configurable: true,
                  })
                } catch {}
                try {
                  cb(undefined)
                } catch {
                } finally {
                  try {
                    delete c.runtime.lastError
                  } catch {}
                }
              },
            )
            return undefined
          }
          // Minimal chrome.runtime.Port for tabs.connect, mirroring GenericPort.
          const portEvent = () => {
            const ls: any[] = []
            return {
              addListener: (fn: any) => {
                if (typeof fn === 'function' && !ls.includes(fn)) ls.push(fn)
              },
              removeListener: (fn: any) => {
                const i = ls.indexOf(fn)
                if (i >= 0) ls.splice(i, 1)
              },
              hasListener: (fn: any) => ls.includes(fn),
              hasListeners: () => ls.length > 0,
              _emit: (...args: any[]) => {
                for (const fn of ls.slice()) {
                  try {
                    fn(...args)
                  } catch (err) {
                    console.error(err)
                  }
                }
              },
            }
          }
          class Port {
            name: string
            sender: any = undefined
            onMessage: any = portEvent()
            onDisconnect: any = portEvent()
            private connected = false
            private closed = false
            private pending: any[] = []
            private sendFn?: (m: any) => void
            private closeFn?: () => void
            constructor(name: string) {
              this.name = name
            }
            _bind(send: (m: any) => void, close: () => void) {
              if (this.closed) {
                close()
                return
              }
              this.connected = true
              this.sendFn = send
              this.closeFn = close
              const pend = this.pending
              this.pending = []
              for (const m of pend) send(m)
            }
            _receive(message: any) {
              this.onMessage._emit(message, this)
            }
            _remoteDisconnect(error?: string) {
              if (this.closed) return
              this.closed = true
              this.connected = false
              // Chrome exposes the connect failure as runtime.lastError while
              // onDisconnect listeners run.
              if (error) {
                try {
                  Object.defineProperty(c.runtime, 'lastError', {
                    value: { message: String(error) },
                    configurable: true,
                  })
                } catch {}
              }
              try {
                this.onDisconnect._emit(this)
              } finally {
                if (error) {
                  try {
                    delete c.runtime.lastError
                  } catch {}
                }
              }
            }
            postMessage(message: any) {
              if (this.closed) {
                throw new Error('Attempting to use a disconnected port object')
              }
              if (this.connected && this.sendFn) this.sendFn(message)
              else this.pending.push(message)
            }
            disconnect() {
              if (this.closed) return
              this.closed = true
              this.connected = false
              if (this.closeFn) this.closeFn()
            }
          }
          // Chrome dedupes addListener(fn) and reports registrations through
          // hasListener/hasListeners; keep a local mirror of the IPC bindings.
          const evt = (name: string) => {
            const ls: any[] = []
            return {
              addListener: (fn: any) => {
                if (typeof fn !== 'function' || ls.includes(fn)) return
                ls.push(fn)
                el.addExtensionListener(extId, name, fn)
              },
              removeListener: (fn: any) => {
                const i = ls.indexOf(fn)
                if (i < 0) return
                ls.splice(i, 1)
                el.removeExtensionListener(extId, name, fn)
              },
              hasListener: (fn: any) => ls.includes(fn),
              hasListeners: () => ls.length > 0,
            }
          }
          // Chrome 150 binds a namespace only when the manifest allows it
          // (permission — required or optional — or manifest key). Installing
          // one otherwise breaks `chrome.x && chrome.x.onY.addListener()`
          // feature detection. Unreadable manifest → keep installing.
          let swManifest: any = null
          try {
            swManifest = c.runtime.getManifest ? c.runtime.getManifest() : null
          } catch {
            swManifest = null
          }
          const swPerms: string[] = swManifest
            ? [...(swManifest.permissions || []), ...(swManifest.optional_permissions || [])]
            : []
          const declares = (p: string) => !swManifest || swPerms.includes(p)
          const hasKey = (k: string) => !swManifest || !!swManifest[k]
          const install = (key: string, value: any) => {
            // Keep Chromium's native constants/enums (tabs.TabStatus,
            // tabs.WindowType, …) that our replacement object doesn't define.
            try {
              const native = (c as any)[key]
              if (native && typeof native === 'object') {
                for (const prop of Object.keys(native)) {
                  if (prop in value) continue
                  let v: any
                  try {
                    v = native[prop]
                  } catch {
                    continue
                  }
                  if (typeof v !== 'function' && !(v && typeof v.addListener === 'function')) {
                    value[prop] = v
                  }
                }
              }
            } catch {
              /* native namespace unreadable — nothing to preserve */
            }
            // 1) Try to replace the whole namespace object.
            try {
              Object.defineProperty(c, key, {
                value,
                configurable: true,
                enumerable: true,
                writable: true,
              })
            } catch {
              /* not configurable — fall through to in-place method patch */
            }

            // 2) Verify it actually took. Electron 42's native chrome.tabs /
            // chrome.windows in the SW main world can be NON-CONFIGURABLE, so the
            // defineProperty above silently no-ops and the native (wrong) impl
            // stays — the root cause of `tabs.query` returning [] with no [tabs]
            // log. Detect that and patch each method/event ONTO the existing
            // native object instead, which is enough to route through our IPC.
            let landed = false
            try {
              landed = (c as any)[key] === value
            } catch {
              landed = false
            }
            if (!landed) {
              try {
                const target = (c as any)[key]
                if (target && typeof target === 'object') {
                  for (const prop of Object.keys(value)) {
                    try {
                      Object.defineProperty(target, prop, {
                        value: value[prop],
                        configurable: true,
                        enumerable: true,
                        writable: true,
                      })
                    } catch {
                      try {
                        ;(target as any)[prop] = value[prop]
                      } catch {
                        /* this prop is locked — skip it */
                      }
                    }
                  }
                }
              } catch {
                /* in-place patch failed entirely */
              }
            }

          }

          // ---- chrome.runtime.sendMessage ----
          // Native MV3 SW runtime.sendMessage does not reliably reach content
          // scripts / extension pages in this host ("Receiving end does not
          // exist" after background work completes). Route same-extension
          // messages through the IPC hub; cross-extension still falls back to
          // native for standards compatibility.
          if (c.runtime && typeof c.runtime === 'object') {
            // The extension entry script can execute before the full runtime
            // facade is installed. Capture onMessage/onConnect registrations
            // synchronously so WXT can register listeners without observing an
            // undefined event. The hosted dispatchers consume these same
            // arrays once the bridge is ready.
            //
            // ADDITIVE, never capture-only when a native event exists: native
            // onMessage/onConnect is still the transport for extension pages
            // without crx-preload (sandboxed offscreen/popup) and for the SHIM
            // portbroker's internal `crx-page-listen` / `crxreq` ports. A
            // capture-only replacement severed those — Tampermonkey's offscreen
            // requests then relayed to zero saved pages and every call failed
            // with "no response". Mirrors the SHIM's ARE early-event semantics.
            // Arrays are re-read from globalThis on every call because the SHIM
            // portbroker later swaps in its own SBLS/SBLSOC stores.
            const earlyRuntimeEvent = (slot: string, native: any) => {
              const g: any = globalThis as any
              if (!Array.isArray(g[slot])) {
                try {
                  g[slot] = []
                } catch {
                  /* best-effort */
                }
              }
              const store = (): any[] => (Array.isArray(g[slot]) ? g[slot] : [])
              const hasNative = !!native && typeof native.addListener === 'function'
              const nativeRegistered = new WeakSet<object>()
              // Once the SHIM portbroker is installed it wraps this object's
              // addListener, records the extension callback in its own store
              // and then calls us with the callback (onMessage) or an internal
              // port-filtering wrapper (onConnect). Recording again here would
              // double-dispatch hosted IPC deliveries, so the SHIM owns the store.
              const shimOwnsStore = (): boolean => {
                try {
                  return !!(c.runtime as any).__crxPortBrokerSW
                } catch {
                  return false
                }
              }
              return {
                __crxHosted: true,
                addListener: (fn: any) => {
                  if (typeof fn !== 'function') return
                  if (!shimOwnsStore()) {
                    const listeners = store()
                    if (!listeners.includes(fn)) listeners.push(fn)
                  }
                  if (hasNative && !nativeRegistered.has(fn)) {
                    try {
                      native.addListener(fn)
                      nativeRegistered.add(fn)
                    } catch {
                      /* native event rejected the listener - capture still holds it */
                    }
                  }
                },
                removeListener: (fn: any) => {
                  const listeners = store()
                  const index = listeners.indexOf(fn)
                  if (index >= 0) listeners.splice(index, 1)
                  nativeRegistered.delete(fn)
                  if (hasNative && typeof native.removeListener === 'function') {
                    try {
                      native.removeListener(fn)
                    } catch {
                      /* best-effort */
                    }
                  }
                },
                hasListener: (fn: any) => store().includes(fn),
                hasListeners: () => store().length > 0,
              }
            }
            if (isWorkerContext) {
              for (const [eventName, slot] of [
                ['onMessage', '__crxPortBrokerOnMsg'],
                ['onConnect', '__crxPortBrokerOnConnect'],
              ]) {
                try {
                  let native: any
                  try {
                    native = (c.runtime as any)[eventName]
                  } catch {
                    native = undefined
                  }
                  if (native && native.__crxHosted === true) continue
                  Object.defineProperty(c.runtime, eventName, {
                    value: earlyRuntimeEvent(slot, native),
                    configurable: true,
                    enumerable: true,
                    writable: true,
                  })
                } catch {
                  /* locked runtime namespace - leave native */
                }
              }
            }

            // runtime.onInstalled / runtime.onStartup: install BEFORE mainWorldScript.
            // mainWorldScript's runtime.factory (which also defines these two as real
            // ExtensionEvents) only re-fires AFTER chrome.runtime.id is ready (the poll
            // harness below). An extension's top-level background.js often calls
            // chrome.runtime.onStartup.addListener(fn) BEFORE that re-fire lands — it
            // would then bind fn to the NATIVE onStartup object, and once the factory
            // replaces that object the listener is orphaned and the router never learns
            // about it, so the host-fired onInstalled/onStartup never reaches fn.
            // Installing an IPC-bridged event object here (mirrors alarms.onAlarm's
            // dedicated evt()) guarantees addListener always routes through
            // electron.addExtensionListener regardless of timing. If mainWorldScript's
            // factory lands later it overwrites these harmlessly; if it throws, ours
            // remain and the SW still receives the lifecycle events.
            const runtimeLifecycleEvt = (name: string) => evt(name)
            for (const evName of ['runtime.onInstalled', 'runtime.onStartup']) {
              try {
                Object.defineProperty(c.runtime, evName.slice('runtime.'.length), {
                  value: runtimeLifecycleEvt(evName),
                  configurable: true,
                  enumerable: true,
                  writable: true,
                })
              } catch {
                /* runtime event prop locked — leave native */
              }
            }
            const nativeRuntimeSend = typeof c.runtime.sendMessage === 'function'
              ? c.runtime.sendMessage.bind(c.runtime)
              : null
            const runtimeSendMessage = function (...args: any[]): any {
              const last = args[args.length - 1]
              const cb = typeof last === 'function' ? args.pop() : undefined
              let targetExt = extId
              let message = args[0]
              let crossExt = false
              if (args.length >= 2 && typeof args[0] === 'string') {
                targetExt = args[0]
                message = args[1]
                crossExt = targetExt !== extId
              }
              const tryNative = (): Promise<any> => {
                if (!nativeRuntimeSend) return Promise.resolve(undefined)
                try {
                  const nativeArgs = crossExt ? [targetExt, message] : [message]
                  const r = nativeRuntimeSend.apply(c.runtime, nativeArgs)
                  return Promise.resolve(r)
                } catch (error) {
                  return Promise.reject(error)
                }
              }
              const tryIpc = (): Promise<any> => {
                if (crossExt || !el || typeof el.sendRuntimeMessage !== 'function') {
                  return Promise.resolve(undefined)
                }
                return Promise.resolve(el.sendRuntimeMessage(targetExt, message))
              }
              const merged =
                !crossExt && el && typeof el.sendRuntimeMessage === 'function'
                  ? tryIpc()
                  : tryNative()
              if (cb) {
                merged.then(
                  (r: any) => {
                    try {
                      cb(r)
                    } catch {
                      /* listener threw — swallow, mirrors Chrome behavior */
                    }
                  },
                  (error: any) => {
                    const message = String((error && error.message) || error)
                    try {
                      Object.defineProperty(c.runtime, 'lastError', {
                        value: {message},
                        configurable: true,
                      })
                    } catch {}
                    try {
                      cb(undefined)
                    } catch {
                      /* listener threw */
                    } finally {
                      Promise.resolve().then(() => {
                        try {
                          delete c.runtime.lastError
                        } catch {}
                      })
                    }
                  },
                )
                return undefined
              }
              return merged
            }
            try {
              Object.defineProperty(c.runtime, 'sendMessage', {
                value: runtimeSendMessage,
                configurable: true,
                enumerable: true,
                writable: true,
              })
            } catch {
              try {
                c.runtime.sendMessage = runtimeSendMessage
              } catch {
                /* locked runtime namespace — best effort */
              }
            }
          }

          // chrome.offscreen + chrome.runtime.getContexts are installed by a
          // dedicated POLLED injector below. They cannot live here: Chromium
          // bootstraps the native `chrome.offscreen` binding (which Electron
          // exposes but does not back with a real document loader)
          // ASYNCHRONOUSLY after this early executeInMainWorld runs, so an
          // install here is overwritten by native a few hundred ms later. The
          // poll re-asserts our override until it stays stable.

          // ---- chrome.tabs ----

          // ---- chrome.tabs ----
          // `executeScript` is routed to the IPC-backed scripting.executeScript
          // (scripting.ts has a full handler with frame targeting + file
          // injection); there is NO tabs.executeScript handler, so listing it
          // here as a plain invoke would throw "not a registered handler".
          // move/discard/removeCSS have no host API either — left in
          // the list so the method exists (returns undefined via the swallowed
          // router error) rather than being an undefined property.
          // MV3 (the only manifest version with a service worker) has no
          // tabs.executeScript/insertCSS/removeCSS/getAllInWindow: extensions
          // feature-detect them to choose between the MV2 and scripting paths.
          const tabsMethods = [
            'get', 'getCurrent', 'query', 'create', 'update',
            'remove', 'reload', 'duplicate', 'move', 'highlight', 'discard',
            'sendMessage',
            'captureVisibleTab', 'detectLanguage', 'getZoom', 'setZoom',
            'getZoomSettings', 'setZoomSettings', 'goBack', 'goForward',
          ]
          const tabs: any = {
            TAB_ID_NONE: -1,
            TAB_INDEX_NONE: -1,
            MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND: 2,
          }
          for (const m of tabsMethods) tabs[m] = inv(`tabs.${m}`)
          tabs.sendMessage = function (...args: any[]): any {
            const cb =
              typeof args[args.length - 1] === 'function' ? args.pop() : undefined
            const hasTabId = typeof args[0] === 'number'
            const tabId = hasTabId ? args[0] : undefined
            const message = hasTabId ? args[1] : args[0]
            const options = hasTabId
              ? typeof args[2] === 'object'
                ? args[2]
                : undefined
              : typeof args[1] === 'object'
                ? args[1]
                : undefined
            // Raw invoke so a missing receiver rejects as in Chrome instead of
            // being swallowed to undefined by the legacy invokeExtension.
            const routed: Promise<any> = Promise.resolve(
              typeof el.invokeExtensionRaw === 'function'
                ? el.invokeExtensionRaw(extId, 'tabs.sendMessage', {}, tabId, message, options)
                : el.invokeExtension(extId, 'tabs.sendMessage', {}, tabId, message, options),
            )
            if (cb) {
              routed.then(
                (r: any) => {
                  try {
                    cb(r)
                  } catch {}
                },
                (error: any) => {
                  try {
                    Object.defineProperty(c.runtime, 'lastError', {
                      value: { message: String((error && error.message) || error) },
                      configurable: true,
                    })
                  } catch {}
                  try {
                    cb(undefined)
                  } catch {
                  } finally {
                    try {
                      delete c.runtime.lastError
                    } catch {}
                  }
                },
              )
              return undefined
            }
            return routed
          }
          tabs.connect = function (arg1: any, arg2?: any): any {
            const hasTabId = typeof arg1 === 'number'
            const tabId = hasTabId ? arg1 : undefined
            const connectInfo = hasTabId ? arg2 : arg1
            const name =
              (connectInfo && connectInfo.name) ||
              (typeof connectInfo === 'string' ? connectInfo : '')
            const frameId =
              connectInfo && typeof connectInfo.frameId === 'number'
                ? connectInfo.frameId
                : undefined
            const port = new Port(name)
            el.tabsPortConnect(
              extId,
              tabId,
              { name, frameId },
              (message: any) => port._receive(message),
              (error?: string) => port._remoteDisconnect(error),
              (send: any, close: any) => port._bind(send, close),
            )
            return port
          }
          // No tabs.executeScript here: MV3 service workers only have
          // chrome.scripting (Chrome throws on tabs.executeScript in MV3).
          for (const e of [
            'onCreated', 'onUpdated', 'onRemoved', 'onActivated', 'onMoved',
            'onAttached', 'onDetached', 'onReplaced', 'onHighlighted', 'onZoomChange',
          ]) {
            tabs[e] = evt(`tabs.${e}`)
          }
          install('tabs', tabs)

          // ---- chrome.windows ----
          const windows: any = {
            WINDOW_ID_NONE: -1,
            WINDOW_ID_CURRENT: -2,
          }
          for (const m of [
            'get', 'getCurrent', 'getLastFocused', 'getAll', 'create', 'update', 'remove',
          ]) {
            windows[m] = inv(`windows.${m}`)
          }
          for (const e of ['onCreated', 'onRemoved', 'onFocusChanged', 'onBoundsChanged']) {
            windows[e] = evt(`windows.${e}`)
          }
          install('windows', windows)

          // Electron may expose no permissions or commands namespace in an MV3
          // worker even when the manifest declares them. Extensions commonly
          // register these events synchronously at top level, so provide the
          // missing IPC-backed surface without replacing a complete native one.
          const permissions: any = {}
          for (const method of ['contains', 'getAll', 'request', 'remove']) {
            permissions[method] = inv(`permissions.${method}`)
          }
          permissions.onAdded = evt('permissions.onAdded')
          permissions.onRemoved = evt('permissions.onRemoved')
          try {
            if (!c.permissions || typeof c.permissions.contains !== 'function') {
              install('permissions', permissions)
            }
          } catch {
            install('permissions', permissions)
          }

          const commands: any = {
            getAll: inv('commands.getAll'),
            onCommand: evt('commands.onCommand'),
          }
          if (hasKey('commands')) {
            try {
              if (!c.commands || typeof c.commands.getAll !== 'function') {
                install('commands', commands)
              }
            } catch {
              install('commands', commands)
            }
          }

          // ---- chrome.notifications ----
          const notifications: any = {}
          for (const m of [
            'create', 'update', 'clear', 'getAll', 'getPermissionLevel',
          ]) {
            notifications[m] = inv(`notifications.${m}`)
          }
          for (const e of [
            'onClicked', 'onClosed', 'onButtonClicked', 'onShowSettings',
            'onPermissionLevelChanged',
          ]) {
            notifications[e] = evt(`notifications.${e}`)
          }
          if (declares('notifications')) install('notifications', notifications)

          // ---- chrome.contextMenus ----
          // create() must return the menu id synchronously (the extension uses the
          // return value), generating one if absent — mirrors the renderer factory.
          let menuCounter = 0
          const cmCreate = inv('contextMenus.create')
          const contextMenus: any = {
            create: (createProperties: any, callback?: any) => {
              try {
                if (createProperties && typeof createProperties.id === 'undefined') {
                  createProperties.id = `${++menuCounter}`
                }
                // create() returns the id, not a Promise: without a callback a
                // failure (duplicate id) is only an unchecked lastError in Chrome.
                const r = cmCreate(createProperties, callback)
                if (r && typeof r.catch === 'function') r.catch(() => {})
                return createProperties ? createProperties.id : undefined
              } catch {
                return createProperties ? createProperties.id : undefined
              }
            },
            update: inv('contextMenus.update'),
            remove: inv('contextMenus.remove'),
            removeAll: inv('contextMenus.removeAll'),
            onClicked: evt('contextMenus.onClicked'),
          }
          if (declares('contextMenus')) install('contextMenus', contextMenus)

          // ---- chrome.omnibox ----
          // Manifests may declare `omnibox: { keyword }`, so the SW calls
          // chrome.omnibox.onInputEntered.addListener(...) (and the other
          // onInput* events) during top-level background.js evaluation. This host
          // has no omnibox dropdown, so the namespace is otherwise `undefined`
          // and the SW throws "Cannot read properties of undefined (reading
          // 'onInputEntered')" → "Service worker registration failed. Status code:
          // 15". That kills the worker BEFORE its onInstalled/onStartup init
          // handler runs, so the extension never seeds its storage defaults —
          // e.g. instantExcludeList/instantExcludeKeyword/instantDelayOnHover stay
          // undefined and the content script later crashes on
          // `undefined.split('\n')`. Pure no-op events (we never dispatch
          // omnibox input, so there is nothing to forward via addExtensionListener).
          const noopOmniboxEvt = () => ({
            addListener: () => {},
            removeListener: () => {},
            hasListener: () => false,
          })
          const omnibox: any = {
            setDefaultSuggestion: (_suggestion: any) => {},
            onInputStarted: noopOmniboxEvt(),
            onInputChanged: noopOmniboxEvt(),
            onInputEntered: noopOmniboxEvt(),
            onInputCancelled: noopOmniboxEvt(),
            onInputAccepted: noopOmniboxEvt(),
            onDeleteSuggestion: noopOmniboxEvt(),
          }
          if (hasKey('omnibox')) install('omnibox', omnibox)

          // ---- chrome.declarativeContent ----
          // Not native in Electron. SWs build rules at top level with
          // `new chrome.declarativeContent.PageStateMatcher(...)`; without the
          // namespace that throws and the worker dies before registering
          // action.onClicked (and an action.disable() earlier never gets undone).
          // Rules are evaluated per tab by browser/api/declarative-content.ts.
          if (declares('declarativeContent')) {
            const dcType = (instanceType: string) =>
              function (this: any, init?: any) {
                if (init && typeof init === 'object') Object.assign(this, init)
                this.instanceType = instanceType
              }
            install('declarativeContent', {
              PageStateMatcher: dcType('declarativeContent.PageStateMatcher'),
              ShowAction: dcType('declarativeContent.ShowAction'),
              ShowPageAction: dcType('declarativeContent.ShowPageAction'),
              SetIcon: dcType('declarativeContent.SetIcon'),
              RequestContentScript: dcType('declarativeContent.RequestContentScript'),
              onPageChanged: {
                addRules: inv('declarativeContent.addRules'),
                removeRules: inv('declarativeContent.removeRules'),
                getRules: inv('declarativeContent.getRules'),
                addListener: () => {},
                removeListener: () => {},
                hasListener: () => false,
                hasListeners: () => false,
              },
            })
          }

          // ---- chrome.tabCapture / chrome.desktopCapture ----
          // MV3 recorders mint the stream id in the SW and redeem it in an
          // offscreen document (browser/api/capture.ts). chooseDesktopMedia is
          // callback-only and returns its request id synchronously.
          if (declares('tabCapture')) {
            install('tabCapture', {
              getMediaStreamId: inv('tabCapture.getMediaStreamId'),
              getCapturedTabs: inv('tabCapture.getCapturedTabs'),
              onStatusChanged: evt('tabCapture.onStatusChanged'),
            })
          }
          if (declares('desktopCapture')) {
            let desktopRequestId = 0
            const chooseDesktop = inv('desktopCapture.chooseDesktopMedia')
            install('desktopCapture', {
              DesktopCaptureSourceType: {
                SCREEN: 'screen',
                WINDOW: 'window',
                TAB: 'tab',
                AUDIO: 'audio',
              },
              chooseDesktopMedia: (sources: string[], targetTabOrCb?: any, maybeCb?: any) => {
                const callback = typeof targetTabOrCb === 'function' ? targetTabOrCb : maybeCb
                const targetTab = typeof targetTabOrCb === 'function' ? undefined : targetTabOrCb
                const requestId = ++desktopRequestId
                Promise.resolve(chooseDesktop(requestId, sources, targetTab))
                  .catch(() => null)
                  .then((result: any) => {
                    if (typeof callback !== 'function') return
                    try {
                      callback(result?.streamId || '', {
                        canRequestAudioTrack: result?.canRequestAudioTrack === true,
                      })
                    } catch {}
                  })
                return requestId
              },
              cancelChooseDesktopMedia: (requestId: number) => {
                Promise.resolve(inv('desktopCapture.cancelChooseDesktopMedia')(requestId)).catch(
                  () => {},
                )
              },
            })
          }

        } catch (e: any) {
          console.error('[crx-preload] SW core-ns patch error: ' + (e && e.message))
        }
      },
    })
    // Then layer the remaining API overrides (tabs/windows/runtime/etc.). If
    // this throws partway, storage.sync is already safely patched above.
    //
    // ROOT-CAUSE FIX: a woken service worker's native `chrome` is NOT always
    // bootstrapped when this isolated preload first crosses to the main world
    // — `chrome.runtime.id`/`getManifest` are populated asynchronously by
    // Chromium's worker bootstrapping. If mainWorldScript runs in that window
    // it patches a half-initialized chrome (extensionId=undefined → every
    // invokeExtension closure binds to a phantom extension; Object.freeze
    // would then lock it). The dedicated patches above paper over the worst
    // symptoms (storage/tabs/windows/...), but the 14 namespaces only covered
    // by mainWorldScript (action/cookies/bookmarks/history/permissions/...),
    // including the MV3 additive runtime.onMessage/onConnect bridge that
    // content scripts rely on, stay broken.
    //
    // Design: fire mainWorldScript IMMEDIATELY (restoring the original
    // behavior, so the SW's runtime.onMessage listener lands in time for the
    // first content-script message — a delayed fire caused content scripts to
    // get undefined responses and crash) AND poll to re-fire once `chrome` is
    // truly ready. The `__crxPatched` sentinel makes re-fires idempotent:
    //   - if chrome WAS ready at first fire, it patches the real chrome and
    //     the re-fire is a no-op;
    //   - if chrome was NOT ready, the first fire patched a throwaway `{}` and
    //     the re-fire patches the real chrome when it arrives.
    try {
      const probe = (): boolean => {
        try {
          return !!cb.executeInMainWorld({
            func: () => {
              const c = (globalThis as any).chrome
              const e = (globalThis as any).electron
              return !!(
                e &&
                c &&
                c.runtime &&
                typeof c.runtime.id === 'string' &&
                !!c.runtime.id &&
                typeof c.runtime.getManifest === 'function'
              )
            },
          })
        } catch {
          return false
        }
      }
      const fire = () => {
        try {
          cb.executeInMainWorld({
            func: mainWorldScript,
            args: [RUNTIME_CONTEXT_TYPE],
          })
        } catch (e: any) {
          console.error(`[crx-preload] SW mainWorldScript injection error: ${e && e.message}`)
        }
      }
      // Always fire immediately (no blind window before the SW can receive
      // messages), then re-fire once chrome is confirmed ready (idempotent).
      try {
        ipcRenderer.send('crx-beacon', 'sw-mainworld fire=immediate')
      } catch {}
      fire()
      let tries = 0
      const poll = () => {
        deferTask(() => {
          tries++
          if (probe()) {
            try {
              ipcRenderer.send('crx-beacon', `sw-mainworld fire=polled tries=${tries}`)
            } catch {}
            fire()
            // Do not treat "the preload ran" as proof that the API bridge is
            // usable. Electron can finish the isolated preload while Chromium
            // subsequently replaces chrome.tabs in the worker main world with
            // its partial native namespace. Report readiness only after the
            // Chrome-compatible tabs.create route is observable in that world.
            let ready = false
            try {
              ready = !!cb.executeInMainWorld({
                func: () => {
                  const c = (globalThis as any).chrome
                  const e = (globalThis as any).electron
                  let manifest: any = {}
                  try {
                    manifest = c?.runtime?.getManifest?.() || {}
                  } catch {}
                  const permissions = manifest.permissions || []
                  const allPermissions = [
                    ...permissions,
                    ...(manifest.optional_permissions || []),
                  ]
                  const needsUserScripts = allPermissions.includes('userScripts')
                  const needsDnr =
                    allPermissions.includes('declarativeNetRequest') ||
                    allPermissions.includes('declarativeNetRequestWithHostAccess')
                  const needsOffscreen = allPermissions.includes('offscreen')
                  return !!(
                    e &&
                    c &&
                    c.runtime &&
                    typeof c.runtime.id === 'string' &&
                    !!c.runtime.id &&
                    c.runtime.onMessage?.__crxHosted === true &&
                    c.runtime.onConnect?.__crxHosted === true &&
                    c.tabs &&
                    typeof c.tabs.create === 'function' &&
                    (!needsUserScripts ||
                      (c.userScripts?.__crxHosted === true &&
                        typeof c.userScripts.register === 'function' &&
                        typeof c.userScripts.getScripts === 'function')) &&
                    (!needsDnr || c.declarativeNetRequest?.__crxHosted === true) &&
                    (!needsOffscreen || c.offscreen?.__crxHosted === true)
                  )
                },
              })
            } catch {}
            if (ready) {
              try {
                ipcRenderer.send('crx-beacon', 'sw-api-ready')
                ipcRenderer.send('crx-worker-ready', { protocol: WORKER_INBOUND_PROTOCOL })
                ensureWorkerInboundPump()
              } catch {}
              return
            }
            // Chromium may still be replacing the native namespace after
            // runtime.id appears. Keep re-applying for the rest of the normal
            // bootstrap window instead of declaring success too early.
            if (tries <= 600 /* ~15s total readiness window */) {
              // Keep the short cadence while Chromium replaces the native
              // namespace. This readiness signal gates the first message
              // delivery, so a slow cadence can make a healthy worker look
              // unavailable to popup prewarm/recovery.
              poll()
              return
            }
            try {
              ipcRenderer.send('crx-beacon', 'sw-api-incomplete tabs.create')
            } catch {}
            return
          }
          if (tries <= 600 /* ~15s */) {
            poll()
          }
        }, 25)
      }
      poll()
    } catch (e: any) {
      console.error(`[crx-preload] SW poll harness error: ${e && e.message}`)
      // Harness itself failed — fall back to the legacy immediate inject.
      try {
        cb.executeInMainWorld({
          func: mainWorldScript,
          args: [RUNTIME_CONTEXT_TYPE],
        })
      } catch {}
    }
    // chrome.declarativeNetRequest: Electron asynchronously installs its native
    // service-worker binding after the extension shim/mainWorldScript has run.
    // That late bootstrap replaces our IPC-backed methods, splitting DNR state:
    // rules registered through the host API remain in the main-process matcher,
    // while chrome.declarativeNetRequest.getSessionRules() suddenly reads the
    // empty native store. Re-assert the hosted namespace throughout the native
    // bootstrap window so extensions always see the same rules the host enforces.
    try {
      const installDnr = (): boolean => {
        try {
          return !!cb.executeInMainWorld({
            func: (runtimeContextType: RuntimeContextTypeMap) => {
              const c: any = (globalThis as any).chrome
              const elx: any = (globalThis as any).electron
              if (!c || !c.runtime || !elx) return false
              const manifest = c.runtime.getManifest ? c.runtime.getManifest() || {} : {}
              const permissions = [
                ...(manifest.permissions || []),
                ...(manifest.optional_permissions || []),
              ]
              if (
                !permissions.includes('declarativeNetRequest') &&
                !permissions.includes('declarativeNetRequestWithHostAccess')
              ) {
                return true
              }

              const id = c.runtime.id
              const call = (name: string) => (...args: any[]) => {
                const callback =
                  typeof args[args.length - 1] === 'function' ? args.pop() : undefined
                const raw =
                  typeof elx.invokeExtensionRaw === 'function'
                    ? elx.invokeExtensionRaw(id, `declarativeNetRequest.${name}`, {}, ...args)
                    : elx.invokeExtension(id, `declarativeNetRequest.${name}`, {}, ...args)
                const promise = Promise.resolve(raw)
                if (!callback) return promise
                promise.then(
                  (value: any) => callback(value),
                  (error: any) => {
                    const runtime = c.runtime
                    let previous: PropertyDescriptor | undefined
                    try {
                      previous = Object.getOwnPropertyDescriptor(runtime, 'lastError')
                      Object.defineProperty(runtime, 'lastError', {
                        value: { message: String(error?.message || error || 'Unknown error') },
                        configurable: true,
                      })
                    } catch {}
                    try {
                      callback(undefined)
                    } finally {
                      try {
                        if (previous) Object.defineProperty(runtime, 'lastError', previous)
                        else delete runtime.lastError
                      } catch {}
                    }
                  },
                )
                return undefined
              }
              const event = {
                addListener: (fn: any) =>
                  elx.addExtensionListener(id, 'declarativeNetRequest.onRuleMatchedDebug', fn),
                removeListener: (fn: any) =>
                  elx.removeExtensionListener(id, 'declarativeNetRequest.onRuleMatchedDebug', fn),
                hasListener: () => false,
              }
              const dnr: any = {
                __crxHosted: true,
                updateDynamicRules: call('updateDynamicRules'),
                getDynamicRules: call('getDynamicRules'),
                updateSessionRules: call('updateSessionRules'),
                getSessionRules: call('getSessionRules'),
                getEnabledRulesets: call('getEnabledRulesets'),
                updateEnabledRulesets: call('updateEnabledRulesets'),
                getAvailableStaticRuleCount: call('getAvailableStaticRuleCount'),
                getMatchedRules: call('getMatchedRules'),
                isRegexSupported: call('isRegexSupported'),
                setExtensionActionOptions: call('setExtensionActionOptions'),
                onRuleMatchedDebug: event,
                ResourceType: {
                  MAIN_FRAME: 'main_frame',
                  SUB_FRAME: 'sub_frame',
                  STYLESHEET: 'stylesheet',
                  SCRIPT: 'script',
                  IMAGE: 'image',
                  FONT: 'font',
                  OBJECT: 'object',
                  XMLHTTPREQUEST: 'xmlhttprequest',
                  PING: 'ping',
                  CSP_REPORT: 'csp_report',
                  MEDIA: 'media',
                  WEBSOCKET: 'websocket',
                  WEBTRANSPORT: 'webtransport',
                  WEBBUNDLE: 'webbundle',
                  OTHER: 'other',
                },
                RuleActionType: {
                  BLOCK: 'block',
                  REDIRECT: 'redirect',
                  ALLOW: 'allow',
                  UPGRADE_SCHEME: 'upgradeScheme',
                  MODIFY_HEADERS: 'modifyHeaders',
                  ALLOW_ALL_REQUESTS: 'allowAllRequests',
                },
                RequestMethod: {
                  CONNECT: 'connect',
                  DELETE: 'delete',
                  GET: 'get',
                  HEAD: 'head',
                  OPTIONS: 'options',
                  PATCH: 'patch',
                  POST: 'post',
                  PUT: 'put',
                },
                DomainType: { FIRST_PARTY: 'firstParty', THIRD_PARTY: 'thirdParty' },
                HeaderOperation: { APPEND: 'append', SET: 'set', REMOVE: 'remove' },
                UnsupportedRegexReason: {
                  SYNTAX_ERROR: 'syntaxError',
                  MEMORY_LIMIT_EXCEEDED: 'memoryLimitExceeded',
                },
                GUARANTEED_MINIMUM_STATIC_RULES: 30000,
                MAX_NUMBER_OF_DYNAMIC_RULES: 30000,
                MAX_NUMBER_OF_SESSION_RULES: 5000,
                MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES: 5000,
                MAX_NUMBER_OF_ENABLED_STATIC_RULESETS: 50,
                MAX_NUMBER_OF_STATIC_RULESETS: 100,
                MAX_NUMBER_OF_REGEX_RULES: 1000,
                MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES: 5000,
                MAX_NUMBER_OF_UNSAFE_SESSION_RULES: 5000,
                GETMATCHEDRULES_QUOTA_INTERVAL: 600,
                MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL: 20,
                DYNAMIC_RULESET_ID: '_dynamic',
                SESSION_RULESET_ID: '_session',
              }

              try {
                Object.defineProperty(c, 'declarativeNetRequest', {
                  value: dnr,
                  configurable: true,
                  enumerable: true,
                  writable: true,
                })
              } catch {}
              let target = c.declarativeNetRequest
              if (!target || !(target as any).__crxHosted) {
                target = c.declarativeNetRequest
                if (target && typeof target === 'object') {
                  for (const key of Object.keys(dnr)) {
                    try {
                      Object.defineProperty(target, key, {
                        value: dnr[key],
                        configurable: true,
                        enumerable: true,
                        writable: true,
                      })
                    } catch {
                      try {
                        target[key] = dnr[key]
                      } catch {}
                    }
                  }
                }
              }
              return !!(c.declarativeNetRequest && c.declarativeNetRequest.__crxHosted)
            },
          })
        } catch {
          return false
        }
      }
      installDnr()
      let dnrTries = 0
      const dnrPoll = () => {
        deferTask(() => {
          dnrTries++
          installDnr()
          if (dnrTries <= 480 /* ~12s @25ms */) dnrPoll()
        }, 25)
      }
      dnrPoll()
    } catch (e: any) {
      console.error(`[crx-preload] SW DNR patch error: ${e && e.message}`)
    }
    // Chromium can install its gated native userScripts binding after the
    // extension preload. Electron has no UI for enabling that backend, so a
    // late replacement leaves methods present but rejects every call. Keep the
    // hosted implementation authoritative throughout native bootstrap.
    try {
      const installUserScripts = (): boolean => {
        try {
          return !!cb.executeInMainWorld({
            func: () => {
              const c: any = (globalThis as any).chrome
              const elx: any = (globalThis as any).electron
              if (!c?.runtime || !elx) return false
              const manifest = c.runtime.getManifest?.() || {}
              const permissions = [
                ...(manifest.permissions || []),
                ...(manifest.optional_permissions || []),
              ]
              if (!permissions.includes('userScripts')) return true
              const id = c.runtime.id
              const call = (name: string) => (...args: any[]) => {
                const callback =
                  typeof args[args.length - 1] === 'function' ? args.pop() : undefined
                const raw =
                  typeof elx.invokeExtensionRaw === 'function'
                    ? elx.invokeExtensionRaw(id, `userScripts.${name}`, {}, ...args)
                    : elx.invokeExtension(id, `userScripts.${name}`, {}, ...args)
                const promise = Promise.resolve(raw)
                if (!callback) return promise
                promise.then(
                  (value: any) => callback(value),
                  (error: any) => {
                    const runtime = c.runtime
                    let previous: PropertyDescriptor | undefined
                    try {
                      previous = Object.getOwnPropertyDescriptor(runtime, 'lastError')
                      Object.defineProperty(runtime, 'lastError', {
                        value: { message: String(error?.message || error || 'Unknown error') },
                        configurable: true,
                      })
                    } catch {}
                    try {
                      callback(undefined)
                    } finally {
                      try {
                        if (previous) Object.defineProperty(runtime, 'lastError', previous)
                        else delete runtime.lastError
                      } catch {}
                    }
                  },
                )
                return undefined
              }
              const hosted: any = {
                __crxHosted: true,
                ExecutionWorld: { MAIN: 'MAIN', USER_SCRIPT: 'USER_SCRIPT' },
                register: call('register'),
                update: call('update'),
                unregister: call('unregister'),
                getScripts: call('getScripts'),
                configureWorld: call('configureWorld'),
                getWorldConfigurations: call('getWorldConfigurations'),
                resetWorldConfiguration: call('resetWorldConfiguration'),
              }
              try {
                Object.defineProperty(c, 'userScripts', {
                  value: hosted,
                  configurable: true,
                  enumerable: true,
                  writable: true,
                })
              } catch {}
              const target = c.userScripts
              if (target && target !== hosted && typeof target === 'object') {
                for (const key of Object.keys(hosted)) {
                  try {
                    Object.defineProperty(target, key, {
                      value: hosted[key],
                      configurable: true,
                      enumerable: true,
                      writable: true,
                    })
                  } catch {
                    try {
                      target[key] = hosted[key]
                    } catch {}
                  }
                }
              }
              return !!(
                c.userScripts?.__crxHosted &&
                typeof c.userScripts.register === 'function' &&
                typeof c.userScripts.getScripts === 'function'
              )
            },
          })
        } catch {
          return false
        }
      }
      const userScriptsPermissionState = (): boolean | null => {
        try {
          return cb.executeInMainWorld({
            func: () => {
              const runtime = (globalThis as any).chrome?.runtime
              if (!runtime?.id || typeof runtime.getManifest !== 'function') return null
              const manifest = runtime.getManifest() || {}
              const permissions = [
                ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
                ...(Array.isArray(manifest.optional_permissions)
                  ? manifest.optional_permissions
                  : []),
              ]
              return permissions.includes('userScripts')
            },
          }) as boolean | null
        } catch {
          return null
        }
      }
      let userScriptsPermissionTries = 0
      const startUserScriptsPatch = () => {
        const permissionState = userScriptsPermissionState()
        if (permissionState === null) {
          if (++userScriptsPermissionTries < 50) {
            deferTask(startUserScriptsPatch, 250)
          }
          return
        }
        if (!permissionState) return
        installUserScripts()
        let userScriptsTries = 0
        const userScriptsPoll = () => {
          deferTask(() => {
            userScriptsTries++
            installUserScripts()
            if (userScriptsTries < 50 /* ~12s @250ms */) userScriptsPoll()
          }, 250)
        }
        userScriptsPoll()
      }
      startUserScriptsPatch()
    } catch (e: any) {
      console.error(`[crx-preload] SW userScripts patch error: ${e && e.message}`)
    }
    // chrome.offscreen + chrome.runtime.getContexts: Chromium bootstraps the
    // native chrome.offscreen binding (which Electron 42 exposes — see
    // offscreen.createDocument/closeDocument/hasDocument in electron.exe — but
    // does NOT back with a real document loader) ASYNCHRONOUSLY after our early
    // executeInMainWorld. A one-shot install gets overwritten by native a few
    // hundred ms later, leaving Tampermonkey calling the broken native
    // createDocument (throws → TM catches → skips createDocument → "no
    // response"). So we poll: re-assert our IPC-backed override until it stays
    // stable across several ticks, i.e. until native bootstrap has stopped
    // overwriting it. Mirrors the mainWorldScript poll harness above.
    try {
      const installOffscreen = (): boolean => {
        try {
          return !!cb.executeInMainWorld({
            func: (runtimeContextType: RuntimeContextTypeMap) => {
              const c: any = (globalThis as any).chrome
              const elx: any = (globalThis as any).electron
              if (!c || !c.runtime || !elx) return false
              const id = c.runtime.id
              // Chrome semantics: promise form rejects on API errors (e.g.
              // "Only a single offscreen document may be created."), callback
              // form gets runtime.lastError. Legacy invokeExtension swallowed
              // both to undefined.
              const call = (name: string, args: any[]) => {
                const cb = typeof args[args.length - 1] === 'function' ? args.pop() : undefined
                const p: Promise<any> = Promise.resolve(
                  typeof elx.invokeExtensionRaw === 'function'
                    ? elx.invokeExtensionRaw(id, name, {}, ...args)
                    : elx.invokeExtension(id, name, {}, ...args),
                )
                if (!cb) return p
                p.then(
                  (r: any) => {
                    try {
                      cb(r)
                    } catch {}
                  },
                  (error: any) => {
                    try {
                      Object.defineProperty(c.runtime, 'lastError', {
                        value: { message: String((error && error.message) || error) },
                        configurable: true,
                      })
                    } catch {}
                    try {
                      cb(undefined)
                    } catch {
                    } finally {
                      try {
                        delete c.runtime.lastError
                      } catch {}
                    }
                  },
                )
                return undefined
              }
              const ourCreate = (...args: any[]) => call('offscreen.createDocument', args)
              const offscreen = {
                __crxHosted: true,
                supported: true,
                Reason: {
                  TESTING: 'TESTING',
                  AUDIO_PLAYBACK: 'AUDIO_PLAYBACK',
                  IFRAME_SCRIPTING: 'IFRAME_SCRIPTING',
                  DOM_SCRAPING: 'DOM_SCRAPING',
                  BLOBS: 'BLOBS',
                  DOM_PARSER: 'DOM_PARSER',
                  USER_MEDIA: 'USER_MEDIA',
                  DISPLAY_MEDIA: 'DISPLAY_MEDIA',
                  WEB_RTC: 'WEB_RTC',
                  CLIPBOARD: 'CLIPBOARD',
                  LOCAL_STORAGE: 'LOCAL_STORAGE',
                  WORKERS: 'WORKERS',
                  BATTERY_STATUS: 'BATTERY_STATUS',
                  MATCH_MEDIA: 'MATCH_MEDIA',
                  GEOLOCATION: 'GEOLOCATION',
                },
                createDocument: ourCreate,
                closeDocument: (...args: any[]) => call('offscreen.closeDocument', args),
                hasDocument: (...args: any[]) => call('offscreen.hasDocument', args),
                getContexts: (...args: any[]) => call('offscreen.getContexts', args),
              }
              // Replace the namespace; fall back to in-place patching if native
              // is non-configurable.
              try {
                Object.defineProperty(c, 'offscreen', {
                  value: offscreen,
                  configurable: true,
                  enumerable: true,
                  writable: true,
                })
              } catch {
                /* non-configurable — in-place patch below */
              }
              let mine = false
              try {
                mine = !!(c.offscreen && (c.offscreen as any).__crxHosted)
              } catch {}
              if (!mine) {
                try {
                  const target = c.offscreen
                  if (target && typeof target === 'object') {
                    for (const k of Object.keys(offscreen)) {
                      try {
                        Object.defineProperty(target, k, {
                          value: (offscreen as any)[k],
                          configurable: true,
                          enumerable: true,
                          writable: true,
                        })
                      } catch {
                        try {
                          ;(target as any)[k] = (offscreen as any)[k]
                        } catch {
                          /* prop locked */
                        }
                      }
                    }
                    mine = target.createDocument === ourCreate
                  }
                } catch {
                  /* in-place patch failed */
                }
              }
              // runtime.getContexts: route to the OffscreenAPI registry too.
              try {
                Object.defineProperty(c.runtime, 'getContexts', {
                  value: (...args: any[]) => call('runtime.getContexts', args),
                  configurable: true,
                  enumerable: true,
                  writable: true,
                })
              } catch {
                /* runtime locked */
              }
              // runtime.ContextType enum (see mainWorldScript runtime factory).
              // The SW main world only reaches this polled injector, so re-assert
              // it here alongside getContexts — the native binding omits it.
              try {
                Object.defineProperty(c.runtime, 'ContextType', {
                  value: runtimeContextType,
                  configurable: true,
                  enumerable: true,
                  writable: true,
                })
              } catch {
                /* runtime locked */
              }
              return mine
            },
            args: [RUNTIME_CONTEXT_TYPE],
          })
        } catch {
          return false
        }
      }
      // Fire once immediately, then keep re-asserting for the full native
      // bootstrap window. We do NOT early-stop on "stable": Chromium can attach
      // the native chrome.offscreen binding LATE (after our override looked
      // stable), overwriting it. Re-asserting every tick for ~12s guarantees
      // that whenever native lands, we overwrite it back within one tick.
      installOffscreen()
      let oTries = 0
      const oPoll = () => {
        deferTask(() => {
          oTries++
          installOffscreen()
          if (oTries < 50 /* ~12s @250ms */) oPoll()
        }, 250)
      }
      oPoll()
    } catch (e: any) {
      console.error(`[crx-preload] SW offscreen poll error: ${e && e.message}`)
    }
    // CRITICAL: install chrome.runtime.getPlatformInfo with a DEDICATED,
    // self-contained patch — same reasoning as the storage patch above.
    // mainWorldScript's runtime factory (which also defines getPlatformInfo)
    // empirically does NOT land in the SW main world, so extensions that call
    // getPlatformInfo() during init (e.g. dessant search-by-image's storage
    // migration) throw 'getPlatformInfo is not a function' and abort, leaving
    // storageVersion stranded. Electron's native runtime has no getPlatformInfo.
    // platformInfo is passed via args (no closures survive serialization); a
    // navigator-derived fallback covers the case where args aren't delivered.
    try {
      cb.executeInMainWorld({
        func: (info: any) => {
          try {
            const c: any = (globalThis as any).chrome
            if (!c || !c.runtime) return
            if (typeof c.runtime.getPlatformInfo === 'function') return
            if (!info || !info.os) {
              const ua =
                ((globalThis as any).navigator && (globalThis as any).navigator.userAgent) || ''
              const os = /Win/i.test(ua)
                ? 'win'
                : /Mac/i.test(ua)
                  ? 'mac'
                  : /Android/i.test(ua)
                    ? 'android'
                    : /CrOS/i.test(ua)
                      ? 'cros'
                      : 'linux'
              info = { os, arch: 'x86-64', nacl_arch: 'x86-64' }
            }
            const getPlatformInfo = (callback?: (i: any) => void) => {
              if (typeof callback === 'function') {
                callback(info)
                return undefined
              }
              return Promise.resolve(info)
            }
            try {
              Object.defineProperty(c.runtime, 'getPlatformInfo', {
                value: getPlatformInfo,
                configurable: true,
                enumerable: true,
                writable: true,
              })
            } catch {
              /* runtime not configurable — leave as-is */
            }
          } catch {
            /* never let the getPlatformInfo patch break SW startup */
          }
        },
        args: [platformInfo],
      })
    } catch (e: any) {
      console.error(`[crx-preload] SW getPlatformInfo injection error: ${e && e.message}`)
    }
    return
  }

  if (!process.contextIsolated) {
    // Non-isolated extension pages share one world with the preload, while the
    // prepended extension shim resolves IPC lazily from globalThis.electron at
    // CALL time. If we only keep electronContext in a preload-local variable,
    // later shimmed calls like tabs.query see no bridge and resolve undefined.
    try {
      ;(globalThis as any).electron = electronContext
    } catch (e: any) {
      console.error(`[crx-preload] non-isolated electron bridge install failed: ${e && e.message}`)
    }

    // Preload and page share one world here, so install the guarded fallback
    // before the extension bundle evaluates.
    installBrowserNamespaceFallback()

    // Robust storage patch for the non-isolated path (popup, and any extension
    // page with contextIsolation:false). Preload and page share one world here,
    // so patch the live native storage object directly when it already exists.
    try {
      const g: any = globalThis as any
      const st: any = g.chrome && g.chrome.storage
      let localRef: any
      try {
        localRef = st && st.local
      } catch {
        localRef = undefined
      }
      if (st && localRef) {
        for (const area of ['sync', 'managed']) {
          try {
            Object.defineProperty(st, area, {
              value: localRef,
              configurable: true,
              enumerable: true,
              writable: true,
            })
          } catch (e: any) {
            console.error(`[crx-preload] non-isolated storage.${area} patch failed: ${e && e.message}`)
          }
        }
      }
    } catch (e: any) {
      console.error(`[crx-preload] non-isolated storage patch error: ${e && e.message}`)
    }

    try {
      mainWorldScript(RUNTIME_CONTEXT_TYPE)
    } catch (e: any) {
      console.error(`[crx-preload] mainWorldScript (non-isolated) error: ${e && e.message}`)
    }

    return
  }

  try {
    // Expose extension IPC to main world
    contextBridge.exposeInMainWorld('electron', electronContext)

    // Mutate global 'chrome' object with additional APIs in the main world.
    if ('executeInMainWorld' in contextBridge) {
      ;(contextBridge as any).executeInMainWorld({ func: installBrowserNamespaceFallback })
      ;(contextBridge as any).executeInMainWorld({
        func: mainWorldScript,
        args: [RUNTIME_CONTEXT_TYPE],
      })
    } else {
      // TODO(mv3): remove webFrame usage
      webFrame.executeJavaScript(`(${installBrowserNamespaceFallback})();`)
      webFrame.executeJavaScript(
        `(${mainWorldScript})(${JSON.stringify(RUNTIME_CONTEXT_TYPE)});`,
      )
    }
  } catch (error) {
    console.error(`injectExtensionAPIs error (${location.href})`)
    console.error(error)
  }
}
