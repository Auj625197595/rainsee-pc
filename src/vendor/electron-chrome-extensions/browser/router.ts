import { app, ipcMain, Session } from 'electron'
import debug from 'debug'

import { resolvePartition } from './partition'
import { sendToLiveMainFrame } from './safe-send'
import { matchesPattern } from './api/common'

// Shorten base64 encoded icons
const shortenValues = (k: string, v: any) => (typeof v === 'string' && v.length > 128 ? v.substr(0, 128) + '...' : v)

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
const routerVerbose =
  process.env.CRX_WEBREQUEST_DEBUG === '1' || process.env.CRX_VERBOSE === '1'
const isWebRequestEvent = (eventName: string) => eventName.startsWith('webRequest.')
const isMediaWebRequest = (eventName: string, args: any[]) =>
  isWebRequestEvent(eventName) &&
  (args[0]?.type === 'media' ||
    args[0]?.type === 'object' ||
    /\.(?:m3u8|mpd|mp4|webm|ts)(?:$|[?#])/i.test(args[0]?.url || ''))
const shortRouterUrl = (url: unknown) => {
  const value = typeof url === 'string' ? url : ''
  return value.length > 180 ? `${value.slice(0, 177)}...` : value
}
let mediaRouterLogCount = 0
const logMediaRouter = (message: string) => {
  if (!routerVerbose) return
  if (mediaRouterLogCount >= 200) return
  mediaRouterLogCount++
  console.log(`[crx-router] ${message}`)
}

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
    ipcMain.on('crx-perf-renderer', this.onRendererPerf)
  }

  addObserver(observer: RoutingDelegateObserver) {
    this.sessionMap.set(observer.session, observer)

    const maybeListenForWorkerEvents = ({
      runningStatus,
      versionId,
    }: Electron.Event<Electron.ServiceWorkersRunningStatusChangedEventParams>) => {
      if (runningStatus !== 'starting') return

      const serviceWorker = (observer.session as any).serviceWorkers.getWorkerFromVersionID(versionId)
      if (serviceWorker?.scope?.startsWith('chrome-extension://') && !this.workers.has(serviceWorker)) {
        d(`listening to service worker [versionId:${versionId}, scope:${serviceWorker.scope}]`)
        this.workers.add(serviceWorker)
        serviceWorker.ipc.handle('crx-msg', this.onRouterMessage)
        serviceWorker.ipc.handle('crx-msg-remote', this.onRemoteMessage)
        serviceWorker.ipc.on('crx-add-listener', this.onAddListener)
        serviceWorker.ipc.on('crx-remove-listener', this.onRemoveListener)
        serviceWorker.ipc.on('crx-perf-renderer', this.onRendererPerf)
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

    const ses = sessionPartition === DEFAULT_SESSION ? getSessionFromEvent(event) : resolvePartition(sessionPartition)

    const observer = this.sessionMap.get(ses)

    return observer?.onExtensionMessage(event, undefined, handlerName, ...args)
  }

  private onAddListener = (
    event: IpcAnyEvent,
    extensionId: string,
    eventName: string,
    registrations?: WebRequestRegistration[],
  ) => {
    const observer = this.sessionMap.get(getSessionFromEvent(event))
    const listener: EventListener =
      event.type === 'frame'
        ? {
            type: event.type,
            extensionId,
            host: event.sender,
            registrations,
          }
        : {
            type: event.type,
            extensionId,
            registrations,
          }
    return observer?.addListener(listener, extensionId, eventName)
  }

  private onRemoveListener = (event: Electron.IpcMainInvokeEvent, extensionId: string, eventName: string) => {
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

  private onRendererPerf = (_event: IpcAnyEvent, payload: any) => {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.events)) return
    const extensionId = typeof payload.extensionId === 'string' ? payload.extensionId.slice(0, 64) : 'unknown'
    const windowMs = Math.max(0, Number(payload.windowMs) || 0)
    const summaries = payload.events.slice(0, 50).map((item: any) => {
      const eventName = typeof item?.eventName === 'string' ? item.eventName.slice(0, 80) : 'unknown'
      return (
        `${eventName} dispatches=${Math.max(0, Number(item?.dispatches) || 0)} ` +
        `callbacks=${Math.max(0, Number(item?.callbacks) || 0)} ` +
        `totalMs=${Math.max(0, Number(item?.totalMs) || 0).toFixed(1)} ` +
        `maxMs=${Math.max(0, Number(item?.maxMs) || 0).toFixed(1)} ` +
        `maxCallbackMs=${Math.max(0, Number(item?.maxCallbackMs) || 0).toFixed(1)}`
      )
    })
    if (summaries.length > 0) {
      console.log(`[crx-perf][callbacks] ext=${extensionId} windowMs=${windowMs} ${summaries.join(' | ')}`)
    }
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
  | {
      type: 'frame'
      sender: Electron.WebContents
      extension: ExtendedExtension
    }
  | {
      type: 'service-worker'
      sender: Electron.ServiceWorkerMain
      extension: ExtendedExtension
    }

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

const pendingTargetEvents = new Set<EventName>(['runtime.onInstalled', 'runtime.onStartup'])
// Chrome starts an MV3 worker before dispatching its first event, but Electron
// can expose the worker a few milliseconds before the script has registered
// its listeners. Keep only media webRequest events for that narrow cold-start
// window; this avoids dropping the first video request without retaining a
// general network-event backlog or waking unrelated extensions indefinitely.
const pendingColdWorkerWebRequestTtlMs = 30000

interface PendingTargetEvent {
  args: any[]
  expiresAt: number
  resolve: (delivered: boolean) => void
  timer?: ReturnType<typeof setTimeout>
}

type HandlerMap = Map<EventName, Handler>

interface WebRequestRegistration {
  filter?: {
    urls?: string[]
    types?: string[]
    tabId?: number
    windowId?: number
  }
  extraInfoSpec?: string[]
}

type FrameEventListener = {
  type: 'frame'
  host: Electron.WebContents
  extensionId: string
  registrations?: WebRequestRegistration[]
}
type SWEventListener = {
  type: 'service-worker'
  extensionId: string
  registrations?: WebRequestRegistration[]
}
type EventListener = FrameEventListener | SWEventListener

const webRequestFilterMatches = (details: any, registration: WebRequestRegistration) => {
  const filter = registration?.filter
  if (!filter) return true
  if (typeof filter.tabId === 'number' && filter.tabId !== details?.tabId) return false
  if (
    typeof filter.windowId === 'number' &&
    typeof details?.windowId === 'number' &&
    filter.windowId !== details.windowId
  ) {
    return false
  }
  if (Array.isArray(filter.types) && filter.types.length > 0) {
    if (!filter.types.includes(details?.type)) return false
  }
  if (!Array.isArray(filter.urls) || filter.urls.length === 0) return true
  if (typeof details?.url !== 'string') return false
  return filter.urls.some((pattern) => {
    try {
      return matchesPattern(pattern, details.url)
    } catch {
      return false
    }
  })
}

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
  private pendingExtensionEvents: Map<string, Map<string, PendingTargetEvent[]>> = new Map()

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

  private serviceWorkerResolver?: (extensionId: string) => Promise<any>

  /** Optional host transport for worker-originated pull IPC. */
  private serviceWorkerSender?: (
    extensionId: string,
    serviceWorker: any,
    channel: string,
    ...args: any[]
  ) => void

  private observedListenerHosts: WeakSet<Electron.WebContents> = new WeakSet()

  constructor(public session: Electron.Session, private delegate: RoutingDelegate = RoutingDelegate.get()) {
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

    session.serviceWorkers.on('running-status-changed' as any, ({ runningStatus, versionId }: any) => {
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
    })
  }

  /** Queue event delivery behind the hosted worker bridge readiness barrier. */
  setServiceWorkerResolver(resolver: (extensionId: string) => Promise<any>) {
    this.serviceWorkerResolver = resolver
  }

  setServiceWorkerSender(
    sender: (
      extensionId: string,
      serviceWorker: any,
      channel: string,
      ...args: any[]
    ) => void,
  ) {
    this.serviceWorkerSender = sender
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
    if (this.observedListenerHosts.has(host)) return
    this.observedListenerHosts.add(host)
    const hostId = getHostId(host)
    d(`observing listener [id:${hostId}, url:'${getHostUrl(host)}']`)
    host.once('destroyed', () => {
      d(`extension host destroyed [id:${hostId}]`)
      this.filterListeners((listener) => listener.type !== 'frame' || listener.host !== host)
    })
  }

  private hasBackgroundServiceWorker(extensionId: string): boolean {
    const sessionExtensions = this.session.extensions || this.session
    const extension = sessionExtensions.getExtension(extensionId)
    return typeof (extension?.manifest as any)?.background?.service_worker === 'string'
  }

  private shouldQueueColdWorkerWebRequest(
    targetExtensionId: string | undefined,
    eventName: string,
    args: any[],
  ) {
    return !!targetExtensionId &&
      isMediaWebRequest(eventName, args) &&
      this.hasBackgroundServiceWorker(targetExtensionId)
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
      if (listener.registrations) {
        existingEventListener.registrations = listener.registrations
      }
      d(`ignoring existing '${eventName}' event listener for ${extensionId}`)
    } else {
      d(`adding '${eventName}' event listener for ${extensionId}`)
      if (routerVerbose && isWebRequestEvent(eventName)) {
        console.log(
          `[crx-router] listener-add event=${eventName} ext=${extensionId} ` +
            `host=${listener.type}`,
        )
      }
      eventListeners.push(listener)
      if (listener.type === 'frame' && listener.host) {
        this.observeListenerHost(listener.host)
      }
      const waitsForWorker =
        pendingTargetEvents.has(eventName) &&
        listener.type !== 'service-worker' &&
        this.hasBackgroundServiceWorker(extensionId)
      if (!waitsForWorker) this.flushPendingEvent(extensionId, eventName)
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
      const granted = !!extensionId && (this.permissionResolver?.(extensionId, handler.permission) ?? false)
      if (!extension || (!declared && !granted)) {
        throw new Error(`${handlerName} requires an extension with ${handler.permission} permissions`)
      }
    }

    const extEvent: ExtensionEvent =
      event.type === 'frame'
        ? { type: event.type, sender: event.sender, extension: extension! }
        : {
            type: event.type,
            sender: event.serviceWorker,
            extension: extension!,
          }

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

  listenerExtensionIds(eventName: EventName, details?: any): string[] {
    return Array.from(
      new Set(
        (this.listeners.get(eventName) || [])
          .filter(
            (listener) =>
              !details ||
              !listener.registrations ||
              listener.registrations.some((registration) => webRequestFilterMatches(details, registration)),
          )
          .map((listener) => listener.extensionId),
      ),
    )
  }

  /**
   * Sends extension event to the host for the given extension ID if it
   * registered a listener for it.
   */
  sendEvent(
    targetExtensionId: string | undefined,
    eventName: string,
    ...args: any[]
  ): Promise<boolean> | undefined {
    const { listeners } = this
    let eventListeners = listeners.get(eventName)
    const ipcName = `crx-${eventName}`
    const trackDelivery = !!targetExtensionId && pendingTargetEvents.has(eventName)
    const waitsForWorker =
      trackDelivery &&
      !!targetExtensionId &&
      this.hasBackgroundServiceWorker(targetExtensionId) &&
      !eventListeners?.some(
        (listener) =>
          listener.extensionId === targetExtensionId &&
          listener.type === 'service-worker',
      )

    // 热路径(webRequest 每请求都会进):不再逐请求 console.log,只走 debug(d()),
    // 否则主进程同步镜像日志会把 IPC 处理拖慢、让阻塞响应错过窗口。
    if (!eventListeners || eventListeners.length === 0 || waitsForWorker) {
      // Ignore events with no listeners
      if (
        routerVerbose &&
        (isMediaWebRequest(eventName, args) || isWebRequestEvent(eventName))
      ) {
        console.log(
          `[crx-router] event-drop event=${eventName} ext=${targetExtensionId || '-'} ` +
            `reason=${waitsForWorker ? 'worker-listener-pending' : 'no-listener'}`,
        )
      }
      if (isMediaWebRequest(eventName, args)) {
        if (routerVerbose) {
          logMediaRouter(
            `event-drop event=${eventName} ext=${targetExtensionId || '-'} ` +
            `reason=${waitsForWorker ? 'worker-listener-pending' : 'no-listener'} ` +
            `url=${shortRouterUrl(args[0]?.url)}`,
          )
        }
      }
      if (trackDelivery || this.shouldQueueColdWorkerWebRequest(targetExtensionId, eventName, args)) {
        return this.queuePendingEvent(targetExtensionId, eventName, args)
      }
      return undefined
    }

    let sentCount = 0
    const serviceDeliveries: Array<Promise<boolean>> | undefined = trackDelivery ? [] : undefined
    const frameDeliveries: Array<Promise<boolean>> | undefined = trackDelivery ? [] : undefined
    for (const listener of eventListeners) {
      const { extensionId } = listener

      if (targetExtensionId && targetExtensionId !== extensionId) {
        continue
      }

      if (listener.type === 'service-worker') {
        const scope = `chrome-extension://${extensionId}/`
        const workerPromise = this.serviceWorkerResolver
          ? this.serviceWorkerResolver(extensionId)
          : this.session.serviceWorkers.startWorkerForScope(scope)
        const delivery = workerPromise
          .then((serviceWorker) => {
            if (this.serviceWorkerSender) {
              this.serviceWorkerSender(extensionId, serviceWorker, ipcName, ...args)
            } else {
              serviceWorker.send(ipcName, ...args)
            }
            return true
          })
          .catch(() => {
            d('failed to send %s to %s', eventName, extensionId)
            if (routerVerbose) {
              console.log(
                `[crx-router] worker-delivery-failed event=${eventName} ext=${extensionId}`,
              )
            }
            if (routerVerbose && isMediaWebRequest(eventName, args)) {
              logMediaRouter(`worker-delivery-failed event=${eventName} ext=${extensionId}`)
            }
            return false
          })
        if (serviceDeliveries) serviceDeliveries.push(delivery)
      } else {
        if (!sendToLiveMainFrame(listener.host, ipcName, ...args)) {
          d(`Unable to send '${eventName}' to extension host for ${extensionId}`)
          if (frameDeliveries) frameDeliveries.push(Promise.resolve(false))
          continue
        }
        if (frameDeliveries) frameDeliveries.push(Promise.resolve(true))
      }

      sentCount++
    }

    if (
      sentCount === 0 &&
      (trackDelivery || this.shouldQueueColdWorkerWebRequest(targetExtensionId, eventName, args))
    ) {
      return this.queuePendingEvent(targetExtensionId, eventName, args)
    }

    d(`sent '${eventName}' event to ${sentCount} listeners`)
    if (
      routerVerbose &&
      (isMediaWebRequest(eventName, args) || isWebRequestEvent(eventName))
    ) {
      console.log(
        `[crx-router] event-send event=${eventName} target=${targetExtensionId || '-'} ` +
          `listeners=${sentCount}`,
      )
    }
    if (routerVerbose && isMediaWebRequest(eventName, args)) {
      logMediaRouter(
        `event-send event=${eventName} target=${targetExtensionId || '-'} ` +
        `listeners=${sentCount} url=${shortRouterUrl(args[0]?.url)}`,
      )
    }
    const deliveries = serviceDeliveries?.length
      ? serviceDeliveries
      : frameDeliveries?.length
        ? frameDeliveries
        : undefined
    return deliveries
      ? Promise.all(deliveries).then((results) => results.some(Boolean))
      : undefined
  }

  private queuePendingEvent(
    targetExtensionId: string,
    eventName: string,
    args: any[],
  ): Promise<boolean> {
    // A cold MV3 worker can approach the host's 20 second startup budget.
    // Install events have a bounded retry window. Startup events remain in
    // memory until this session's worker registers; the per-event cap still
    // bounds memory without a timer that can drop a slow cold-start event.
    const hasDeadline =
      eventName === 'runtime.onInstalled' ||
      this.shouldQueueColdWorkerWebRequest(targetExtensionId, eventName, args)
    return new Promise<boolean>((resolve) => {
      const expiresAt = hasDeadline ? Date.now() + pendingColdWorkerWebRequestTtlMs : Infinity
      let extEvents = this.pendingExtensionEvents.get(targetExtensionId)
      if (!extEvents) {
        extEvents = new Map()
        this.pendingExtensionEvents.set(targetExtensionId, extEvents)
      }
      const bucket = extEvents.get(eventName) || []
      const item = {} as PendingTargetEvent
      item.args = args
      item.expiresAt = expiresAt
      item.resolve = resolve
      if (hasDeadline) {
        item.timer = setTimeout(() => {
          const currentExtEvents = this.pendingExtensionEvents.get(targetExtensionId)
          const currentBucket = currentExtEvents?.get(eventName)
          if (!currentBucket) return
          const index = currentBucket.indexOf(item)
          if (index < 0) return
          currentBucket.splice(index, 1)
          if (currentBucket.length === 0) currentExtEvents?.delete(eventName)
          if (currentExtEvents?.size === 0) this.pendingExtensionEvents.delete(targetExtensionId)
          resolve(false)
        }, pendingColdWorkerWebRequestTtlMs)
        item.timer.unref?.()
      }
      bucket.push(item)
      while (bucket.length > 4) {
        const dropped = bucket.shift()!
        if (dropped.timer) clearTimeout(dropped.timer)
        dropped.resolve(false)
      }
      extEvents.set(eventName, bucket)
      d(`queued pending '${eventName}' event for ${targetExtensionId}`)
    })
  }

  private flushPendingEvent(extensionId: string, eventName: string) {
    const extEvents = this.pendingExtensionEvents.get(extensionId)
    const bucket = extEvents?.get(eventName)
    if (!bucket || bucket.length === 0) return

    const now = Date.now()
    const live = bucket.filter((item) => item.expiresAt > now)
    const expired = bucket.filter((item) => item.expiresAt <= now)
    extEvents?.delete(eventName)
    if (extEvents && extEvents.size === 0) this.pendingExtensionEvents.delete(extensionId)
    for (const item of expired) {
      if (item.timer) clearTimeout(item.timer)
      item.resolve(false)
    }
    for (const item of live) {
      if (item.timer) clearTimeout(item.timer)
      const delivery = this.sendEvent(extensionId, eventName, ...item.args)
      if (delivery) void delivery.then(item.resolve)
      else item.resolve(false)
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
