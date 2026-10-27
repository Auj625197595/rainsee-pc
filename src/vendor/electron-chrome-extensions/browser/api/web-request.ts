import { app, ipcMain } from 'electron'
import { ExtensionContext } from '../context'
import debug from 'debug'

const d = debug('electron-chrome-extensions:webRequest')
const webRequestVerbose =
  process.env.CRX_WEBREQUEST_DEBUG === '1' || process.env.CRX_VERBOSE === '1'
const shortUrl = (url: unknown) => {
  const value = typeof url === 'string' ? url : ''
  return value.length > 180 ? `${value.slice(0, 177)}...` : value
}
const isMediaRequest = (details: any) =>
  details?.type === 'media' ||
  details?.type === 'object' ||
  /\.(aac|flac|m3u8|m4a|m4s|mp3|mp4|mpd|ogg|opus|ts|webm)(?:$|[?#])/i.test(
    details?.url || '',
  )

// Electron's details object can contain values that are valid in the main
// process but cannot cross the ServiceWorker IPC structured-clone boundary.
// Keep only the Chrome webRequest contract and coerce header values to strings.
const cloneSafeWebRequestDetails = (details: any) => {
  if (!details || typeof details !== 'object') return details
  const out: any = {}
  const scalarKeys = [
    'requestId', 'url', 'method', 'frameId', 'parentFrameId', 'tabId', 'type',
    'timeStamp', 'statusCode', 'statusLine', 'fromCache', 'ip', 'fromOrigin',
    'error', 'redirectUrl', 'initiator', 'originUrl', 'windowId', 'incognito',
    'documentId', 'parentDocumentId', 'documentLifecycle', 'frameType', 'scheme',
    'requestBody', 'challenger', 'isProxy', 'realm',
  ]
  const cloneValue = (value: any, seen = new WeakSet<object>()): any => {
    if (value == null || typeof value !== 'object') return value
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value
    if (seen.has(value)) return null
    seen.add(value)
    if (Array.isArray(value)) {
      const out = value.map((item) => cloneValue(item, seen))
      seen.delete(value)
      return out
    }
    const out: any = {}
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || descriptor.get || descriptor.set) continue
      out[key] = cloneValue(descriptor.value, seen)
    }
    seen.delete(value)
    return out
  }
  for (const key of scalarKeys) {
    const value = details[key]
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      (value && typeof value === 'object')
    ) {
      out[key] = cloneValue(value)
    }
  }
  const copyHeaders = (headers: any) => {
    if (!headers) return undefined
    const rows: Array<{ name: string; value: string }> = []
    if (Array.isArray(headers)) {
      for (const item of headers) {
        if (!item || typeof item.name !== 'string') continue
        rows.push({name: item.name, value: item.value == null ? '' : String(item.value)})
      }
    } else if (typeof headers === 'object') {
      for (const [name, values] of Object.entries(headers)) {
        if (Array.isArray(values)) {
          for (const value of values) rows.push({name, value: value == null ? '' : String(value)})
        } else {
          rows.push({name, value: values == null ? '' : String(values)})
        }
      }
    }
    return rows
  }
  const requestHeaders = copyHeaders(details.requestHeaders)
  const responseHeaders = copyHeaders(details.responseHeaders)
  if (requestHeaders) out.requestHeaders = requestHeaders
  if (responseHeaders) out.responseHeaders = responseHeaders
  return out
}

let mediaDispatchLogCount = 0
const logMediaDispatch = (message: string) => {
  if (!webRequestVerbose) return
  if (mediaDispatchLogCount >= 200) return
  mediaDispatchLogCount++
  console.log(`[crx-webRequest] ${message}`)
}

// `app.on('login')` is registered once per session to fire onAuthRequired.
const authListeningSessions = new WeakSet<Electron.Session>()
const pendingAuth = new Map<
  string,
  { finish: (credentials?: { username: string; password: string }) => void; timer: NodeJS.Timeout }
>()
let responseListenerInstalled = false

const installResponseListener = () => {
  if (responseListenerInstalled) return
  responseListenerInstalled = true
  ipcMain.on('crx-webrequest-response', (_event, requestId, eventName, response) => {
    if (eventName !== 'webRequest.onAuthRequired') return
    const pending = pendingAuth.get(String(requestId))
    if (!pending) return
    if (response?.cancel === true) {
      pending.finish()
      return
    }
    const credentials = response?.authCredentials
    if (!credentials || typeof credentials.username !== 'string' || typeof credentials.password !== 'string') {
      return
    }
    pending.finish(credentials)
  })
}

// Electron 的 webRequest.resourceType 用 camelCase(mainFrame/xhr/subFrame),
// 而 Chrome 扩展 webRequest API 的 type 用 snake_case(main_frame/xmlhttprequest/sub_frame)。
function normalizeResourceType(t: string | undefined): string {
  if (!t) return 'other'
  const map: Record<string, string> = {
    mainFrame: 'main_frame',
    subFrame: 'sub_frame',
    xhr: 'xmlhttprequest',
    fetch: 'xmlhttprequest',
    cspReport: 'csp_report',
    webSocket: 'websocket',
    serviceWorker: 'service_worker',
    signedExchange: 'signed_exchange',
    webTransport: 'webtransport',
  }
  return map[t] || t
}

// Electron webRequest 的 headers 默认是 Record<string,string[]>,而 Chrome 扩展
// webRequest API 规范要求 Array<{name,value}>(可带 binaryValue)。Record 会让扩展
// 用 for..of 遍历 header 时抛 "not iterable"。统一转成数组格式。
function toChromeHeaders(h: any): any[] | undefined {
  if (!h) return undefined
  if (Array.isArray(h)) return h
  if (typeof h === 'object') {
    const out: any[] = []
    for (const [name, values] of Object.entries(h)) {
      if (Array.isArray(values)) {
        for (const v of values) out.push({name, value: String(v)})
      } else {
        out.push({name, value: String(values)})
      }
    }
    return out
  }
  return undefined
}

const isNetworkUrl = (url?: string) => !!url && /^(https?|wss?):\/\//i.test(url)

// Electron request headers are Record<string,string>; response headers are
// Record<string,string[]>. DNR's matchHeaders works on {name,value}[].
const reqRecordToArray = (rec: Record<string, string> | undefined) =>
  rec ? Object.keys(rec).map((name) => ({ name, value: rec[name] })) : []
const arrayToReqRecord = (arr: Array<{ name: string; value?: string }>) => {
  const out: Record<string, string> = {}
  for (const h of arr) out[h.name] = h.value ?? ''
  return out
}
const respRecordToArray = (rec: Record<string, string[]> | undefined) => {
  const arr: Array<{ name: string; value?: string }> = []
  if (rec) for (const name of Object.keys(rec)) for (const value of rec[name] || []) arr.push({ name, value })
  return arr
}
const arrayToRespRecord = (arr: Array<{ name: string; value?: string }>) => {
  const out: Record<string, string[]> = {}
  for (const h of arr) {
    if (!out[h.name]) out[h.name] = []
    out[h.name].push(h.value ?? '')
  }
  return out
}

/**
 * chrome.webRequest API 的扩展事件分发实现。
 *
 * 注意:Electron 的 session.webRequest 每个事件只允许一个监听器。当广告屏蔽开启时,
 * cliqz 的 enableBlockingInSession 会覆盖这里的监听器,扩展 webRequest 事件实际由
 * src/main/services/adblock.ts 的 hookEngine(onBeforeRequest/onHeadersReceived 包装层)
 * 经 webRequestEventDispatcher 分发。因此本类的 session 监听器在屏蔽开启时是"备胎"
 * ——仅在屏蔽关闭、且未被 settings.ts 覆盖时才生效。
 *
 * 阻塞式拦截(onBeforeRequest + ['blocking'])的扩展返回值({cancel}/{redirectUrl})
 * 由 adblock.ts 接回(event.ts 回传 crx-webrequest-response,cancel 胜出),不在这里处理。
 */
export class WebRequestAPI {
  private mediaWorkerExtensions: Electron.Extension[] | undefined
  private mediaWorkerExtensionsAt = 0

  constructor(private ctx: ExtensionContext) {
    try {
      this.ctx.webRequest = this
      installResponseListener()
      this.ctx.router.apiHandler()
      this.setupSessionListeners()
      this.setupAuthListener()
      const extensions: any = this.ctx.session.extensions || this.ctx.session
      const invalidate = () => {
        this.mediaWorkerExtensions = undefined
        this.mediaWorkerExtensionsAt = 0
      }
      extensions.addListener?.('extension-loaded', invalidate)
      extensions.addListener?.('extension-unloaded', invalidate)
    } catch (err) {
      console.error('[WebRequestAPI] Constructor error:', err)
    }
  }

  /**
   * Fire `webRequest.onAuthRequired` as an INFORMATIONAL event. Electron routes
   * HTTP basic/digest/proxy auth through the app `login` event (there is no
   * `session.webRequest.onAuthRequired`), so we bridge it here. This is
   * non-blocking and does NOT supply credentials — calling the login callback
   * asynchronously (after an extension's IPC round-trip) risks the Electron-42
   * webRequest-callback crash, so extensions can observe auth challenges but
   * can't answer them. Registered once per session (multi-session safe: each
   * instance only dispatches for its own session's webContents).
   */
  private setupAuthListener() {
    const session = this.ctx.session
    if (authListeningSessions.has(session)) return
    authListeningSessions.add(session)
    app.on('login', (event, webContents, request, authInfo, callback) => {
      if (!webContents || (webContents as any).session !== session) return
      try {
        const requestUrl = (request as any)?.url || ''
        const eligible = this.ctx.router
          .listenerExtensionIds('webRequest.onAuthRequired')
          .some(
            (extensionId) =>
              this.ctx.permissions?.hasPermission(extensionId, 'webRequest') === true &&
              this.ctx.permissions?.hasOrigin(extensionId, requestUrl) === true,
          )
        if (!eligible) return
        const requestId = String((request as any)?.id ?? `auth-${Date.now()}-${Math.random()}`)
        event.preventDefault()
        let finished = false
        const finish = (credentials?: { username: string; password: string }) => {
          if (finished) return
          finished = true
          const pending = pendingAuth.get(requestId)
          if (pending) clearTimeout(pending.timer)
          pendingAuth.delete(requestId)
          if (credentials) callback(credentials.username, credentials.password)
          else callback()
        }
        const timer = setTimeout(() => finish(), 10000)
        pendingAuth.set(requestId, { finish, timer })
        this.dispatchChromeEvent('onAuthRequired', {
          requestId,
          url: requestUrl,
          method: (request as any)?.method || 'GET',
          frameId: 0,
          parentFrameId: -1,
          tabId: webContents.id,
          type: 'xmlhttprequest',
          timeStamp: Date.now(),
          scheme: (authInfo as any)?.scheme || 'basic',
          realm: (authInfo as any)?.realm || '',
          isProxy: !!((authInfo as any)?.isProxy),
          challenger: {
            host: (authInfo as any)?.host || '',
            port: (authInfo as any)?.port || 0,
          },
          statusLine: '',
          statusCode: 0,
        })
      } catch (err) {
        d('onAuthRequired dispatch error: %O', err)
      }
    })
  }

  installBeforeRequestListener = () => {
    const session = this.ctx.session
    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      // The adblock hook replaces this listener when enabled. Keep the same
      // Chrome-owned resource fallback here for the non-adblock path.
      const specialRedirect = this.ctx.store.impl.resolveChromeExtensionResourceUrl?.(details.url)
      if (specialRedirect) {
        console.log(`[crx-resource] redirect ${details.url} -> ${specialRedirect.slice(0, 32)}...`)
        callback({ redirectURL: specialRedirect })
        return
      }
      try {
        this.dispatchEvent('onBeforeRequest', details)
      } catch (err) {
        d('onBeforeRequest dispatch error: %O', err)
      }
      // declarativeNetRequest block / redirect / upgradeScheme — SYNCHRONOUS
      // (Electron 42 crashes on async webRequest callbacks). Network URLs only;
      // skipped when the host ad blocker owns this slot (cliqz replaces the
      // listener), so DNR enforces when the built-in blocker is off.
      let response: any = {}
      try {
        const dnr = this.ctx.declarativeNetRequest
        // DNR block/allow/redirect rules are before-request rules and must be
        // evaluated independently of request-header modification rules.
        // Script managers commonly register only a redirect rule here.
        const hasBeforeRequestRules =
          typeof dnr?.hasRules === 'function'
            ? dnr.hasRules()
            : dnr?.hasHeaderRules('request')
        if (hasBeforeRequestRules && isNetworkUrl(details.url)) {
          const verdict = dnr.matchBeforeRequest(details as any)
          if (verdict?.cancel) {
            response = { cancel: true }
          } else if (verdict?.redirectUrl) {
            // The internal DNR result follows Chrome's `redirectUrl` spelling;
            // Electron's webRequest callback uses `redirectURL`.
            response = { redirectURL: verdict.redirectUrl }
          }
        }
      } catch (err) {
        d('DNR onBeforeRequest error: %O', err)
      }
      if (!response.cancel && !response.redirectURL) {
        try {
          const hostRedirect = this.ctx.store.impl.resolveHostRequestRedirect?.(details.url)
          if (hostRedirect && hostRedirect !== details.url) {
            response = { redirectURL: hostRedirect }
          }
        } catch (err) {
          d('host request redirect error: %O', err)
        }
      }
      callback(response)
    })
  }

  private getMediaWorkerExtensions(): Electron.Extension[] {
    const now = Date.now()
    if (this.mediaWorkerExtensions && now - this.mediaWorkerExtensionsAt < 5000) {
      return this.mediaWorkerExtensions
    }
    const extensions: any = this.ctx.session.extensions || this.ctx.session
    this.mediaWorkerExtensions = extensions.getAllExtensions?.() || []
    this.mediaWorkerExtensionsAt = now
    return this.mediaWorkerExtensions || []
  }

  private setupSessionListeners() {
    const session = this.ctx.session

    this.installBeforeRequestListener()

    session.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
      try {
        this.dispatchEvent('onBeforeSendHeaders', details)
      } catch (err) {
        d('onBeforeSendHeaders error: %O', err)
      }
      let requestHeaders = details.requestHeaders
      try {
        const dnr = this.ctx.declarativeNetRequest
        if (dnr && isNetworkUrl(details.url)) {
          const modified = dnr.matchHeaders(details as any, 'request', reqRecordToArray(requestHeaders))
          if (modified) requestHeaders = arrayToReqRecord(modified)
        }
      } catch (err) {
        d('DNR request-headers error: %O', err)
      }
      callback({ requestHeaders })
    })

    session.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
      try {
        this.dispatchEvent('onHeadersReceived', details)
      } catch (err) {
        d('onHeadersReceived error: %O', err)
      }
      let responseHeaders = details.responseHeaders as Record<string, string[]> | undefined
      try {
        const dnr = this.ctx.declarativeNetRequest
        if (dnr?.hasHeaderRules('response') && isNetworkUrl(details.url) && responseHeaders) {
          const modified = dnr.matchHeaders(details as any, 'response', respRecordToArray(responseHeaders))
          if (modified) responseHeaders = arrayToRespRecord(modified)
        }
      } catch (err) {
        d('DNR response-headers error: %O', err)
      }
      callback({ responseHeaders })
    })

    // onResponseStarted:非阻塞,响应头到达后、body 开始传输前触发。扩展(如视频下载
    // 类集成)可能依赖此事件读取响应头判定媒体类型。cliqz/adblock 不占用此事件槽,
    // 这里注册始终生效。dispatchEvent 内已跳过 chrome-extension://。
    session.webRequest.onResponseStarted({ urls: ['<all_urls>'] }, (details) => {
      try {
        this.dispatchEvent('onResponseStarted', details)
      } catch (err) {
        d('onResponseStarted error: %O', err)
      }
    })

    // onSendHeaders / onBeforeRedirect:非阻塞信息事件,cliqz/adblock 不占用这两个槽。
    // 之前完全没暴露,依赖它们的扩展(统计、重定向追踪、代理类)拿不到回调。
    session.webRequest.onSendHeaders({ urls: ['<all_urls>'] }, (details) => {
      try {
        this.dispatchEvent('onSendHeaders', details)
      } catch (err) {
        d('onSendHeaders error: %O', err)
      }
    })

    session.webRequest.onBeforeRedirect({ urls: ['<all_urls>'] }, (details) => {
      try {
        this.dispatchEvent('onBeforeRedirect', details)
      } catch (err) {
        d('onBeforeRedirect error: %O', err)
      }
    })

    session.webRequest.onCompleted({ urls: ['<all_urls>'] }, (details) => {
      try {
        this.dispatchEvent('onCompleted', details)
      } catch (err) {
        d('onCompleted error: %O', err)
      }
    })

    session.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, (details) => {
      try {
        this.dispatchEvent('onErrorOccurred', details)
      } catch (err) {
        d('onErrorOccurred error: %O', err)
      }
    })
  }

  private dispatchEvent(eventName: string, details: any) {
    if (details.url && details.url.startsWith('chrome-extension://')) {
      return
    }
    const lightweight = this.toChromeDetails(details, false)
    if (!this.shouldDispatchChromeEvent(eventName, lightweight)) return
    this.dispatchChromeEvent(eventName, this.toChromeDetails(details))
  }

  shouldDispatchChromeEvent(eventName: string, chromeDetails: any): boolean {
    const routedName = eventName.startsWith('webRequest.')
      ? eventName
      : `webRequest.${eventName}`
    return (
      isMediaRequest(chromeDetails) ||
      this.ctx.router.listenerExtensionIds(routedName, chromeDetails).length > 0
    )
  }

  dispatchChromeEvent(eventName: string, chromeDetails: any) {
    if (chromeDetails?.url?.startsWith('chrome-extension://')) return
    const routedName = eventName.startsWith('webRequest.')
      ? eventName
      : `webRequest.${eventName}`
    const candidates = this.ctx.router.listenerExtensionIds(routedName, chromeDetails)
    const verifiedCandidates = new Set<string>()
    // A cold MV3 worker may have started but not yet sent its listener
    // registration IPC. Chrome queues the first event during that startup
    // turn; mirror that behavior for media requests by targeting loaded MV3
    // workers which are explicitly granted webRequest + the request origin.
    // ExtensionRouter keeps this as a bounded 30s queue until addListener
    // arrives, so unrelated extensions never receive arbitrary traffic.
    const mediaRequest = isMediaRequest(chromeDetails)
    if (mediaRequest) {
      const knownCandidates = new Set(candidates)
      let coldAdded = 0
      for (const extension of this.getMediaWorkerExtensions()) {
        const manifest: any = extension?.manifest
        if (
          manifest?.manifest_version !== 3 ||
          typeof manifest?.background?.service_worker !== 'string' ||
          this.ctx.permissions?.hasPermission(extension.id, 'webRequest') !== true ||
          this.ctx.permissions?.hasOrigin(extension.id, chromeDetails.url) !== true
        ) {
          continue
        }
        if (!knownCandidates.has(extension.id)) {
          candidates.push(extension.id)
          knownCandidates.add(extension.id)
          verifiedCandidates.add(extension.id)
          coldAdded++
        }
      }
      if (webRequestVerbose && coldAdded > 0) {
        console.log(
          `[crx-webRequest] cold-worker candidates=${candidates.join(',')} ` +
            `event=${routedName} url=${shortUrl(chromeDetails.url)}`,
        )
      }
    }
    if (candidates.length === 0) return
    chromeDetails = cloneSafeWebRequestDetails(chromeDetails)
    const recipients: string[] = []
    for (const extensionId of candidates) {
      if (verifiedCandidates.has(extensionId)) {
        recipients.push(extensionId)
        this.ctx.router.sendEvent(extensionId, routedName, chromeDetails)
        continue
      }
      if (this.ctx.permissions?.hasPermission(extensionId, 'webRequest') !== true) {
        if (webRequestVerbose) {
          console.log(`[crx-webRequest] skip ${routedName} ext=${extensionId} reason=permission`)
        }
        continue
      }
      if (this.ctx.permissions?.hasOrigin(extensionId, chromeDetails.url) !== true) {
        if (webRequestVerbose) {
          console.log(
            `[crx-webRequest] skip ${routedName} ext=${extensionId} ` +
              `reason=origin url=${shortUrl(chromeDetails.url)}`,
          )
        }
        continue
      }
      verifiedCandidates.add(extensionId)
      recipients.push(extensionId)
      this.ctx.router.sendEvent(extensionId, routedName, chromeDetails)
    }
    if (mediaRequest && webRequestVerbose) {
      logMediaDispatch(
        `${routedName} requestId=${chromeDetails.requestId} tab=${chromeDetails.tabId ?? -1} ` +
          `candidates=${candidates.join(',') || '-'} recipients=${recipients.join(',') || '-'} ` +
          `headers=${chromeDetails.responseHeaders?.length || 0} url=${shortUrl(chromeDetails.url)}`,
      )
    }
    if (
      webRequestVerbose &&
      (mediaRequest || recipients.length > 0 || candidates.length === 0)
    ) {
      console.log(
        `[crx-webRequest] ${routedName} type=${chromeDetails?.type || 'other'} ` +
          `tab=${chromeDetails?.tabId ?? -1} frame=${chromeDetails?.frameId ?? 0} ` +
          `candidates=${candidates.join(',') || '-'} recipients=${recipients.join(',') || '-'} ` +
          `url=${shortUrl(chromeDetails?.url)}`,
      )
    }
  }

  private toChromeDetails(details: any, includeHeaders = true): any {
    const physicalTabId =
      typeof details.webContentsId === 'number'
        ? details.webContentsId
        : typeof details.tabId === 'number'
          ? details.tabId
          : undefined
    const tabId =
      typeof physicalTabId === 'number'
        ? this.ctx.store.impl.resolveTabId
          ? this.ctx.store.impl.resolveTabId(physicalTabId) ?? -1
          : physicalTabId
        : -1
    return {
      requestId: String(details.id ?? Math.random().toString(36).substr(2, 9)),
      url: details.url,
      method: details.method ?? 'GET',
      // Electron uses 0 for the top frame. Do not use `||` here: a valid
      // frame id of 0 must remain distinguishable from an absent field.
      frameId: typeof details.frameId === 'number' ? details.frameId : 0,
      parentFrameId: typeof details.parentFrameId === 'number' ? details.parentFrameId : -1,
      tabId,
      type: normalizeResourceType(details.resourceType),
      timeStamp: typeof details.timestamp === 'number' ? details.timestamp : Date.now(),
      ...(includeHeaders
        ? {
            requestHeaders: toChromeHeaders(details.requestHeaders),
            responseHeaders: toChromeHeaders(details.responseHeaders),
          }
        : {}),
      statusCode: details.statusCode,
      statusLine: details.statusLine,
      fromCache: details.fromCache,
      ip: details.ip,
      fromOrigin: details.fromOrigin,
      error: details.error,
      redirectUrl: details.redirectUrl,
      documentId: details.documentId,
      parentDocumentId: details.parentDocumentId,
      documentLifecycle: details.documentLifecycle,
      frameType: details.frameType,
      requestBody: details.requestBody,
      // Chrome leaves initiator undefined when the request has no initiator.
      // Do not coerce the missing value to an empty string: extensions such
      // as Cat Catch use `undefined` to distinguish a normal network request
      // from special pages and would otherwise drop every media response.
      initiator:
        typeof details.initiator === 'string' && details.initiator.length > 0
          ? details.initiator
          : undefined,
    }
  }
}
