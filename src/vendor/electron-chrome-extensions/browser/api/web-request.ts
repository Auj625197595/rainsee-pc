import { app, ipcMain } from 'electron'
import { ExtensionContext } from '../context'
import debug from 'debug'

const d = debug('electron-chrome-extensions:webRequest')

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
  constructor(private ctx: ExtensionContext) {
    try {
      this.ctx.webRequest = this
      installResponseListener()
      this.ctx.router.apiHandler()
      this.setupSessionListeners()
      this.setupAuthListener()
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

  private setupSessionListeners() {
    const session = this.ctx.session

    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
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
        if (dnr && isNetworkUrl(details.url)) {
          const verdict = dnr.matchBeforeRequest(details as any)
          if (verdict) response = verdict
        }
      } catch (err) {
        d('DNR onBeforeRequest error: %O', err)
      }
      callback(response)
    })

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
        if (dnr && isNetworkUrl(details.url) && responseHeaders) {
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
    this.dispatchChromeEvent(eventName, this.toChromeDetails(details))
  }

  dispatchChromeEvent(eventName: string, chromeDetails: any) {
    if (chromeDetails?.url?.startsWith('chrome-extension://')) return
    const routedName = eventName.startsWith('webRequest.')
      ? eventName
      : `webRequest.${eventName}`
    for (const extensionId of this.ctx.router.listenerExtensionIds(routedName)) {
      if (this.ctx.permissions?.hasPermission(extensionId, 'webRequest') !== true) continue
      if (this.ctx.permissions?.hasOrigin(extensionId, chromeDetails.url) !== true) continue
      this.ctx.router.sendEvent(extensionId, routedName, chromeDetails)
    }
  }

  private toChromeDetails(details: any): any {
    return {
      requestId: details.id || Math.random().toString(36).substr(2, 9),
      url: details.url,
      method: details.method || 'GET',
      frameId: details.frameId || 0,
      parentFrameId: details.parentFrameId || -1,
      tabId: details.webContentsId || -1,
      type: normalizeResourceType(details.resourceType),
      timeStamp: details.timestamp || Date.now(),
      requestHeaders: toChromeHeaders(details.requestHeaders),
      responseHeaders: toChromeHeaders(details.responseHeaders),
      statusCode: details.statusCode,
      statusLine: details.statusLine,
      fromCache: details.fromCache,
      ip: details.ip,
      fromOrigin: details.fromOrigin,
      error: details.error,
      redirectUrl: details.redirectUrl,
      initiator: details.initiator || '',
    }
  }
}
