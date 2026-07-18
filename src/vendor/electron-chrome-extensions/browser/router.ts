import { app, ipcMain, Session } from 'electron'
import debug from 'debug'

import { resolvePartition } from './partition'

// Shorten base64 encoded icons
const shortenValues = (k: string, v: any) =>
  typeof v === 'string' && v.length > 128 ? v.substr(0, 128) + '...' : v

debug.formatters.r = (value: any) => {
  return value ? JSON.stringify(value, shortenValues, '  ') : value
}

export type IpcEvent = Electron.IpcMainEvent | Electron.IpcMainServiceWorkerEvent
export type IpcInvokeEvent = Electron.IpcMainInvokeEvent | Electron.IpcMainServiceWorkerInvokeEvent
export type IpcAnyEvent = IpcEvent | IpcInvokeEvent

const getSessionFromEvent = (event: IpcAnyEvent): Electron.Session => {
  if (event.type === 'service-worker') {
    return event.session
  } else {
    return event.sender.session
  }
}

const getHostFromEvent = (event: IpcAnyEvent) => {
  if (event.type === 'service-worker') {
    return event.serviceWorker
  } else {
    return event.sender
  }
}

const d = debug('electron-chrome-extensions:router')

const DEFAULT_SESSION = '_self'

interface RoutingDelegateObserver {
  session: Electron.Session
  onExtensionMessage(
    event: Electron.IpcMainInvokeEvent,
    extensionId: string | undefined,
    handlerName: string,
    ...args: any[]
  ): Promise<void>
  addListener(listener: EventListener, extensionId: string, eventName: string): void
  removeListener(listener: EventListener, extensionId: string, eventName: string): void
}

let gRoutingDelegate: RoutingDelegate

/**
 * Handles event routing IPCs and delivers them to the observer with the
 * associated session.
 */
class RoutingDelegate {
  static get() {
    return gRoutingDelegate || (gRoutingDelegate = new RoutingDelegate())
  }

  private sessionMap: WeakMap<Session, RoutingDelegateObserver> = new WeakMap()
  private workers: WeakSet<any> = new WeakSet()

  private constructor() {
    ipcMain.handle('crx-msg', this.onRouterMessage)
    ipcMain.handle('crx-msg-remote', this.onRemoteMessage)
    ipcMain.on('crx-add-listener', this.onAddListener)
    ipcMain.on('crx-remove-listener', this.onRemoveListener)
  }

  addObserver(observer: RoutingDelegateObserver) {
    this.sessionMap.set(observer.session, observer)

    const maybeListenForWorkerEvents = ({
      runningStatus,
      versionId,
    }: Electron.Event<Electron.ServiceWorkersRunningStatusChangedEventParams>) => {
      if (runningStatus !== 'starting') return

      const serviceWorker = (observer.session as any).serviceWorkers.getWorkerFromVersionID(
        versionId,
      )
      if (
        serviceWorker?.scope?.startsWith('chrome-extension://') &&
        !this.workers.has(serviceWorker)
      ) {
        d(`listening to service worker [versionId:${versionId}, scope:${serviceWorker.scope}]`)
        this.workers.add(serviceWorker)
        serviceWorker.ipc.handle('crx-msg', this.onRouterMessage)
        serviceWorker.ipc.handle('crx-msg-remote', this.onRemoteMessage)
        serviceWorker.ipc.on('crx-add-listener', this.onAddListener)
        serviceWorker.ipc.on('crx-remove-listener', this.onRemoveListener)
      }
    }
    observer.session.serviceWorkers.on('running-status-changed', maybeListenForWorkerEvents)
  }

  private onRouterMessage = async (
    event: Electron.IpcMainInvokeEvent,
    extensionId: string,
    handlerName: string,
    ...args: any[]
  ) => {
    d(`received '${handlerName}'`, args)

    const observer = this.sessionMap.get(getSessionFromEvent(event))

    return observer?.onExtensionMessage(event, extensionId, handlerName, ...args)
  }

  private onRemoteMessage = async (
    event: Electron.IpcMainInvokeEvent,
    sessionPartition: string,
    handlerName: string,
    ...args: any[]
  ) => {
    d(`received remote '${handlerName}' for '${sessionPartition}'`, args)

    const ses =
      sessionPartition === DEFAULT_SESSION
        ? getSessionFromEvent(event)
        : resolvePartition(sessionPartition)

    const observer = this.sessionMap.get(ses)

    return observer?.onExtensionMessage(event, undefined, handlerName, ...args)
  }

  private onAddListener = (event: IpcAnyEvent, extensionId: string, eventName: string) => {
    const observer = this.sessionMap.get(getSessionFromEvent(event))
    const listener: EventListener =
      event.type === 'frame'
        ? {
            type: event.type,
            extensionId,
            host: event.sender,
          }
        : {
            type: event.type,
            extensionId,
          }
    return observer?.addListener(listener, extensionId, eventName)
  }

  private onRemoveListener = (
    event: Electron.IpcMainInvokeEvent,
    extensionId: string,
    eventName: string,
  ) => {
    const observer = this.sessionMap.get(getSessionFromEvent(event))
    const listener: EventListener =
      event.type === 'frame'
        ? {
            type: event.type,
            extensionId,
            host: event.sender,
          }
        : {
            type: event.type,
            extensionId,
          }
    return observer?.removeListener(listener, extensionId, eventName)
  }
}

export type ExtensionSender = Electron.WebContents | Electron.ServiceWorkerMain
// export interface ExtensionSender {
//   id?: number
//   ipc: Electron.IpcMain | Electron.IpcMainServiceWorker
//   send: Electron.WebFrameMain['send']
// }

type ExtendedExtension = Omit<Electron.Extension, 'manifest'> & {
  manifest: chrome.runtime.Manifest
}

export type ExtensionEvent =
  | { type: 'frame'; sender: Electron.WebContents; extension: ExtendedExtension }
  | { type: 'service-worker'; sender: Electron.ServiceWorkerMain; extension: ExtendedExtension }

export type HandlerCallback = (event: ExtensionEvent, ...args: any[]) => any

export interface HandlerOptions {
  /** Whether the handler can be invoked on behalf of a different session. */
  allowRemote?: boolean
  /** Whether an extension context is required to invoke the handler. */
  extensionContext: boolean
  /** Required extension permission to run the handler. */
  permission?: chrome.runtime.ManifestPermissions
}

interface Handler extends HandlerOptions {
  callback: HandlerCallback
}

/** e.g. 'tabs.query' */
type EventName = string

const pendingTargetEvents = new Set<EventName>([
  'runtime.onInstalled',
  'runtime.onStartup',
])

type HandlerMap = Map<EventName, Handler>

type FrameEventListener = { type: 'frame'; host: Electron.WebContents; extensionId: string }
type SWEventListener = { type: 'service-worker'; extensionId: string }
type EventListener = FrameEventListener | SWEventListener

const getHostId = (host: FrameEventListener['host']) => host.id
const getHostUrl = (host: FrameEventListener['host']) => host.getURL?.()

const eventListenerEquals = (a: EventListener) => (b: EventListener) => {
  if (a === b) return true
  if (a.extensionId !== b.extensionId) return false
  if (a.type !== b.type) return false
  if (a.type === 'frame' && b.type === 'frame') {
    return a.host === b.host
  }
  return true
}

export class ExtensionRouter {
  private handlers: HandlerMap = new Map()
  private listeners: Map<EventName, EventListener[]> = new Map()
  private pendingExtensionEvents: Map<
    string,
    Map<string, Array<{ args: any[]; expiresAt: number }>>
  > = new Map()

  /**
   * Optional resolver for runtime-granted permissions (declared as
   * `optional_permissions` and granted via `chrome.permissions.request`).
   * Populated by PermissionsAPI. The static manifest `permissions` list is
   * checked first; this covers permissions granted AFTER load so that a gated
   * handler (e.g. `history.search` after `permissions.request(['history'])`)
   * is no longer rejected.
   */
  private permissionResolver?: (extensionId: string, permission: string) => boolean

  /** Register a resolver for runtime-granted optional permissions. */
  setPermissionResolver(resolver: (extensionId: string, permission: string) => boolean) {
    this.permissionResolver = resolver
  }

  /**
   * Collection of all extension hosts in the session.
   *
   * Currently the router has no ability to wake up non-persistent background
   * scripts to deliver events. For now we just hold a reference to them to
   * prevent them from being terminated.
   */
  private extensionHosts: Set<Electron.WebContents> = new Set()

  private extensionWorkers: Set<any> = new Set()

  constructor(
    public session: Electron.Session,
    private delegate: RoutingDelegate = RoutingDelegate.get(),
  ) {
    this.delegate.addObserver(this)

    const sessionExtensions = session.extensions || session
    sessionExtensions.on('extension-unloaded', (event, extension) => {
      this.filterListeners((listener) => listener.extensionId !== extension.id)
    })

    app.on('web-contents-created', (event, webContents) => {
      if (webContents.session === this.session && webContents.getType() === 'backgroundPage') {
        d(`storing reference to background host [url:'${webContents.getURL()}']`)
        this.extensionHosts.add(webContents)
      }
    })

    session.serviceWorkers.on(
      'running-status-changed' as any,
      ({ runningStatus, versionId }: any) => {
        if (runningStatus !== 'starting') return

        const serviceWorker = (session as any).serviceWorkers.getWorkerFromVersionID(versionId)
        if (!serviceWorker) return

        const { scope } = serviceWorker
        if (!scope.startsWith('chrome-extension:')) return

        if (this.extensionHosts.has(serviceWorker)) {
          d('%s running status changed to %s', scope, runningStatus)
        } else {
          d(`storing reference to background service worker [url:'${scope}']`)
          this.extensionWorkers.add(serviceWorker)
        }
      },
    )
  }

  private filterListeners(predicate: (listener: EventListener) => boolean) {
    for (const [eventName, listeners] of this.listeners) {
      const filteredListeners = listeners.filter(predicate)
      const delta = listeners.length - filteredListeners.length

      if (filteredListeners.length > 0) {
        this.listeners.set(eventName, filteredListeners)
      } else {
        this.listeners.delete(eventName)
      }

      if (delta > 0) {
        d(`removed ${delta} listener(s) for '${eventName}'`)
      }
    }
  }

  private observeListenerHost(host: FrameEventListener['host']) {
    const hostId = getHostId(host)
    d(`observing listener [id:${hostId}, url:'${getHostUrl(host)}']`)
    host.once('destroyed', () => {
      d(`extension host destroyed [id:${hostId}]`)
      this.filterListeners((listener) => listener.type !== 'frame' || listener.host !== host)
    })
  }

  addListener(listener: EventListener, extensionId: string, eventName: string) {
    const { listeners, session } = this

    const sessionExtensions = session.extensions || session
    const extension = sessionExtensions.getExtension(extensionId)
    if (!extension) {
      throw new Error(`extension not registered in session [extensionId:${extensionId}]`)
    }

    if (!listeners.has(eventName)) {
      listeners.set(eventName, [])
    }

    const eventListeners = listeners.get(eventName)!
    const existingEventListener = eventListeners.find(eventListenerEquals(listener))

    if (existingEventListener) {
      d(`ignoring existing '${eventName}' event listener for ${extensionId}`)
    } else {
      d(`adding '${eventName}' event listener for ${extensionId}`)
      eventListeners.push(listener)
      if (listener.type === 'frame' && listener.host) {
        this.observeListenerHost(listener.host)
      }
      this.flushPendingEvent(extensionId, eventName)
    }
  }

  removeListener(listener: EventListener, extensionId: string, eventName: string) {
    const { listeners } = this

    const eventListeners = listeners.get(eventName)
    if (!eventListeners) {
      console.error(`event listener not registered for '${eventName}'`)
      return
    }

    const index = eventListeners.findIndex(eventListenerEquals(listener))

    if (index >= 0) {
      d(`removing '${eventName}' event listener for ${extensionId}`)
      eventListeners.splice(index, 1)
    }

    if (eventListeners.length === 0) {
      listeners.delete(eventName)
    }
  }

  private getHandler(handlerName: string) {
    const handler = this.handlers.get(handlerName)
    if (!handler) {
      throw new Error(`${handlerName} is not a registered handler`)
    }

    return handler
  }

  async onExtensionMessage(
    event: IpcInvokeEvent,
    extensionId: string | undefined,
    handlerName: string,
    ...args: any[]
  ) {
    const { session } = this
    const eventSession = getSessionFromEvent(event)
    const eventSessionExtensions = eventSession.extensions || eventSession
    const handler = this.getHandler(handlerName)

    if (eventSession !== session && !handler.allowRemote) {
      throw new Error(`${handlerName} does not support calling from a remote session`)
    }

    const extension = extensionId ? eventSessionExtensions.getExtension(extensionId) : undefined
    if (!extension && handler.extensionContext) {
      throw new Error(`${handlerName} was sent from an unknown extension context`)
    }

    if (handler.permission) {
      const manifest: chrome.runtime.Manifest = extension?.manifest
      const declared = !!manifest?.permissions?.includes(handler.permission)
      // Permissions declared as `optional_permissions` and granted at runtime
      // via chrome.permissions.request are not in the static manifest list, so
      // consult the runtime resolver (PermissionsAPI) as a fallback.
      const granted =
        !!extensionId && (this.permissionResolver?.(extensionId, handler.permission) ?? false)
      if (!extension || (!declared && !granted)) {
        throw new Error(
          `${handlerName} requires an extension with ${handler.permission} permissions`,
        )
      }
    }

    const extEvent: ExtensionEvent =
      event.type === 'frame'
        ? { type: event.type, sender: event.sender, extension: extension! }
        : { type: event.type, sender: event.serviceWorker, extension: extension! }

    const result = await handler.callback(extEvent, ...args)

    d(`${handlerName} result: %r`, result)

    return result
  }

  private handle(name: string, callback: HandlerCallback, opts?: Partial<HandlerOptions>): void {
    this.handlers.set(name, {
      callback,
      extensionContext: typeof opts?.extensionContext === 'boolean' ? opts.extensionContext : true,
      allowRemote: typeof opts?.allowRemote === 'boolean' ? opts.allowRemote : false,
      permission: typeof opts?.permission === 'string' ? opts.permission : undefined,
    })
  }

  /** Returns a callback to register API handlers for the given context. */
  apiHandler() {
    return (name: string, callback: HandlerCallback, opts?: Partial<HandlerOptions>) => {
      this.handle(name, callback, opts)
    }
  }

  /** True if at least one extension registered a listener for `eventName`.
   *  Used by WebRequestAPI to decide whether to await a blocking response
   *  (only worth the IPC round-trip when an extension is actually filtering). */
  hasListeners(eventName: EventName): boolean {
    return (this.listeners.get(eventName)?.length ?? 0) > 0
  }

  listenerExtensionIds(eventName: EventName): string[] {
    return Array.from(
      new Set((this.listeners.get(eventName) || []).map((listener) => listener.extensionId)),
    )
  }

  /**
   * Sends extension event to the host for the given extension ID if it
   * registered a listener for it.
   */
  sendEvent(targetExtensionId: string | undefined, eventName: string, ...args: any[]) {
    const { listeners } = this
    let eventListeners = listeners.get(eventName)
    const ipcName = `crx-${eventName}`

    // 热路径(webRequest 每请求都会进):不再逐请求 console.log,只走 debug(d()),
    // 否则主进程同步镜像日志会把 IPC 处理拖慢、让阻塞响应错过窗口。
    if (!eventListeners || eventListeners.length === 0) {
      // Ignore events with no listeners
      if (targetExtensionId && pendingTargetEvents.has(eventName)) {
        this.queuePendingEvent(targetExtensionId, eventName, args)
      }
      return
    }

    let sentCount = 0
    for (const listener of eventListeners) {
      const { type, extensionId } = listener

      if (targetExtensionId && targetExtensionId !== extensionId) {
        continue
      }

      if (type === 'service-worker') {
        const scope = `chrome-extension://${extensionId}/`
        this.session.serviceWorkers
          .startWorkerForScope(scope)
          .then((serviceWorker) => {
            serviceWorker.send(ipcName, ...args)
          })
          .catch((error) => {
            d('failed to send %s to %s', eventName, extensionId)
          })
      } else {
        if (listener.host.isDestroyed()) {
          d(`Unable to send '${eventName}' to extension host for ${extensionId}`)
          return
        }
        listener.host.send(ipcName, ...args)
      }

      sentCount++
    }

    if (
      sentCount === 0 &&
      targetExtensionId &&
      pendingTargetEvents.has(eventName)
    ) {
      this.queuePendingEvent(targetExtensionId, eventName, args)
    }

    d(`sent '${eventName}' event to ${sentCount} listeners`)
  }

  private queuePendingEvent(targetExtensionId: string, eventName: string, args: any[]) {
    const ttlMs = 15000
    const expiresAt = Date.now() + ttlMs
    let extEvents = this.pendingExtensionEvents.get(targetExtensionId)
    if (!extEvents) {
      extEvents = new Map()
      this.pendingExtensionEvents.set(targetExtensionId, extEvents)
    }
    const bucket = extEvents.get(eventName) || []
    bucket.push({ args, expiresAt })
    extEvents.set(
      eventName,
      bucket.filter((item) => item.expiresAt > Date.now()).slice(-4),
    )
    // Self-cleanup: most extensions never register an onInstalled/onStartup
    // listener, so flushPendingEvent (which only runs on addListener) never
    // fires for them and the bucket would otherwise sit until process exit.
    // Reap this ext+event once past TTL. Idempotent — if it was flushed or
    // re-armed in the meantime, the filter/delete are harmless no-ops.
    setTimeout(() => {
      const ext = this.pendingExtensionEvents.get(targetExtensionId)
      const b = ext?.get(eventName)
      if (!b) return
      const live = b.filter((it) => it.expiresAt > Date.now())
      if (live.length === 0) {
        ext?.delete(eventName)
        if (ext && ext.size === 0) this.pendingExtensionEvents.delete(targetExtensionId)
      } else {
        ext!.set(eventName, live)
      }
    }, ttlMs + 50)
    d(`queued pending '${eventName}' event for ${targetExtensionId}`)
  }

  private flushPendingEvent(extensionId: string, eventName: string) {
    const extEvents = this.pendingExtensionEvents.get(extensionId)
    const bucket = extEvents?.get(eventName)
    if (!bucket || bucket.length === 0) return

    const now = Date.now()
    const live = bucket.filter((item) => item.expiresAt > now)
    extEvents?.delete(eventName)
    if (extEvents && extEvents.size === 0) this.pendingExtensionEvents.delete(extensionId)
    for (const item of live) {
      this.sendEvent(extensionId, eventName, ...item.args)
    }
  }

  /** Broadcasts extension event to all extension hosts listening for it. */
  broadcastEvent(eventName: string, ...args: any[]) {
    this.sendEvent(undefined, eventName, ...args)
  }

  /**
   * Resolve an extension's persistent background page webContents (MV2), if any.
   * Used by the messaging hub to deliver content-script Port connections to an
   * MV2 background page, which has no service worker (MV3 goes through the SW
   * path instead and returns undefined here). Matches by URL prefix since the
   * background page URL is `chrome-extension://<id>/_generated_background_page.html`.
   */
  backgroundHostFor(extensionId: string): Electron.WebContents | undefined {
    for (const wc of this.extensionHosts) {
      if (wc.isDestroyed()) continue
      try {
        if (wc.getURL().startsWith(`chrome-extension://${extensionId}/`)) return wc
      } catch {
        /* getURL can throw during teardown — skip */
      }
    }
    return undefined
  }
}
