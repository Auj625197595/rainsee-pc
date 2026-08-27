import { ipcRenderer } from 'electron'

const formatIpcName = (name: string) => `crx-${name}`

// 一个事件名(name)对应一条注册记录。Chrome 语义下,同一个事件可有多个 listener,
// 每个 listener 可带自己的 URL filter(chrome.webRequest.onBeforeRequest.addListener 的第二参)。
// 之前每调一次 addExtensionListener 就绑一个 ipcRenderer.addListener,uBlock 给
// onBeforeRequest 注册了两个 listener(WAR guard + 主过滤),于是同一请求触发两次回调,
// 且各自的 URL filter 被丢弃 → guard 对所有 URL 返回 {cancel:true} → 全站被拦。
// 现在每事件名只绑一个 ipcRenderer 监听器(multiplex),按 filter 决定该 listener 是否被调用,
// 并对 webRequest 阻塞响应做合并(cancel 胜出),只回主进程一个决定。
interface Entry {
  cb: Function
  filter: any
  extraInfoSpec: string[]
}
interface Rec {
  count: number
  entries: Entry[]
  bound: boolean
}
const registry = new Map<string, Rec>()
let mediaEventLogCount = 0
const isMediaEvent = (name: string, args: any[]) =>
  name.startsWith('webRequest.') &&
  (args[0]?.type === 'media' ||
    args[0]?.type === 'object' ||
    /\.(?:m3u8|mpd|mp4|webm|ts)(?:$|[?#])/i.test(args[0]?.url || ''))
const mediaEventVerbose =
  typeof process !== 'undefined' &&
  (process?.env?.CRX_WEBREQUEST_DEBUG === '1' || process?.env?.CRX_VERBOSE === '1')
const CRX_PERF =
  typeof process !== 'undefined' &&
  (process?.env?.CRX_PERF === '1' || process?.env?.CRX_VERBOSE === '1')
const perfNow = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()

interface EventPerf {
  dispatches: number
  callbacks: number
  totalMs: number
  maxMs: number
  maxCallbackMs: number
}

let perfStartedAt = Date.now()
const perfByEvent = new Map<string, EventPerf>()

const recordEventPerf = (
  extensionId: string,
  name: string,
  callbacks: number,
  elapsedMs: number,
  maxCallbackMs: number,
) => {
  if (!CRX_PERF) return
  const value = perfByEvent.get(name) || {
    dispatches: 0,
    callbacks: 0,
    totalMs: 0,
    maxMs: 0,
    maxCallbackMs: 0,
  }
  value.dispatches++
  value.callbacks += callbacks
  value.totalMs += elapsedMs
  if (elapsedMs > value.maxMs) value.maxMs = elapsedMs
  if (maxCallbackMs > value.maxCallbackMs) value.maxCallbackMs = maxCallbackMs
  perfByEvent.set(name, value)

  const now = Date.now()
  if (now - perfStartedAt < 10000) return
  try {
    ipcRenderer.send('crx-perf-renderer', {
      extensionId,
      windowMs: now - perfStartedAt,
      events: Array.from(perfByEvent, ([eventName, stats]) => ({
        eventName,
        ...stats,
      })),
    })
  } catch {}
  perfByEvent.clear()
  perfStartedAt = now
}

const webRequestRegistrations = (rec: Rec) =>
  rec.entries.map((entry) => ({
    filter: entry.filter,
    extraInfoSpec: entry.extraInfoSpec,
  }))

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Chrome match-pattern 匹配 webRequest 的 URL filter {urls:[...]}。
// 支持 '<all_urls>'、'*://' scheme 通配、'*'/'*.domain' host 通配、路径 '*' glob。
// 这一层让 uBlock 的 WAR guard(仅 chrome-extension://<id>/web_accessible_resources/*)
// 只对 WAR 请求触发,而不是对页面上每个请求都返回 {cancel:true}。
function urlMatches(url: string, pattern: string): boolean {
  if (pattern === '<all_urls>') return true
  const cs = pattern.indexOf('://')
  if (cs < 0) return false
  const scheme = pattern.slice(0, cs)
  const rest = pattern.slice(cs + 3)
  const slash = rest.indexOf('/')
  const host = slash >= 0 ? rest.slice(0, slash) : rest
  const path = slash >= 0 ? rest.slice(slash) : '/*'

  const ucs = url.indexOf('://')
  if (ucs < 0) return false
  const uScheme = url.slice(0, ucs)
  const uRest = url.slice(ucs + 3)
  const uSlash = uRest.indexOf('/')
  const uHost = uSlash >= 0 ? uRest.slice(0, uSlash) : uRest
  const uPath = uSlash >= 0 ? uRest.slice(uSlash) : '/'

  if (scheme === '*') {
    if (!/^(https?|wss?|ftp)$/.test(uScheme)) return false
  } else if (scheme !== uScheme) {
    return false
  }

  if (host !== '*') {
    if (host.startsWith('*.')) {
      const base = host.slice(2)
      if (uHost !== base && !uHost.endsWith('.' + base)) return false
    } else if (uHost !== host) {
      return false
    }
  }

  const pathRe = new RegExp('^' + path.split('*').map(escapeRegex).join('.*') + '$')
  if (!pathRe.test(uPath)) return false
  return true
}

function filterMatches(details: any, filter: any): boolean {
  if (!filter) return true
  const url = details && details.url
  if (typeof url !== 'string') return false
  if (Array.isArray(filter.types) && filter.types.length > 0) {
    const t = details && details.type
    if (typeof t !== 'string' || !(filter.types as string[]).includes(t)) return false
  }
  if (!Array.isArray(filter.urls) || filter.urls.length === 0) return true
  for (const p of filter.urls as string[]) {
    try {
      if (urlMatches(url, p)) return true
    } catch {
      /* 单条 pattern 解析失败不影响其它 */
    }
  }
  return false
}

export const addExtensionListener = (
  extensionId: string,
  name: string,
  callback: Function,
  filter?: any,
  extraInfoSpec?: string[],
) => {
  let rec = registry.get(name)
  if (!rec) {
    rec = { count: 0, entries: [], bound: false }
    registry.set(name, rec)
  }
  // 记录该 listener 及其 URL filter,dispatch 时按 filter 决定是否调用。
  rec.entries.push({
    cb: callback,
    filter: filter || null,
    extraInfoSpec: extraInfoSpec || [],
  })

  if (rec.count === 0 || name.startsWith('webRequest.')) {
    ipcRenderer.send(
      'crx-add-listener',
      extensionId,
      name,
      name.startsWith('webRequest.') ? webRequestRegistrations(rec) : undefined,
    )
  }
  rec.count++

  // 每个事件名只绑一个 ipcRenderer 监听器(multiplex 所有 callback)。
  // 之前每次都新增一个 → N 个监听器对同一条 IPC 各触发一次 → 回调被调 N 次。
  if (rec.bound) return
  rec.bound = true

  ipcRenderer.addListener(formatIpcName(name), function (event, ...args: any[]) {
    const dispatchStartedAt = CRX_PERF ? perfNow() : 0
    let callbackCount = 0
    let maxCallbackMs = 0
    const isWr = name.startsWith('webRequest.')
    const isBlockingEvent = [
      'webRequest.onBeforeRequest',
      'webRequest.onBeforeSendHeaders',
      'webRequest.onHeadersReceived',
      'webRequest.onAuthRequired',
    ].includes(name)
    const mediaEvent = isMediaEvent(name, args)
    // webRequest 阻塞响应合并:任一匹配的 listener 返回 cancel 即 cancel(取消胜出);
    // 否则取第一个 redirectUrl;都没有则 undefined(放行)。
    let blockResult: any
    for (const ent of rec.entries) {
      if (isWr && !filterMatches(args[0], ent.filter)) continue
      let ret: any
      const callbackStartedAt = CRX_PERF ? perfNow() : 0
      callbackCount++
      try {
        ret = ent.cb(...args)
      } catch (error: any) {
        if (mediaEvent) {
          try {
            console.error(
              `[crx-evt] callback-error event=${name} ext=${extensionId} ` +
                `${error?.stack || error?.message || error}`,
            )
          } catch {}
        }
        continue
      } finally {
        if (CRX_PERF) {
          const callbackMs = perfNow() - callbackStartedAt
          if (callbackMs > maxCallbackMs) maxCallbackMs = callbackMs
        }
      }
      if (isBlockingEvent && ent.extraInfoSpec.some((item) => item === 'blocking' || item === 'asyncBlocking')) {
        if (ret && (ret as any).cancel === true) {
          blockResult = { cancel: true }
        } else if (name === 'webRequest.onBeforeSendHeaders' && ret?.requestHeaders) {
          blockResult = { requestHeaders: ret.requestHeaders }
        } else if (name === 'webRequest.onHeadersReceived' && ret?.responseHeaders) {
          blockResult = { responseHeaders: ret.responseHeaders }
        } else if (name === 'webRequest.onAuthRequired' && ret?.authCredentials) {
          blockResult = { authCredentials: ret.authCredentials }
        } else if (!blockResult && ret && typeof (ret as any).redirectUrl === 'string' && (ret as any).redirectUrl) {
          blockResult = { redirectUrl: (ret as any).redirectUrl }
        }
      }
      // async listener 的 reject 不能冒泡成 unhandledRejection(会把整个背景页拉崩)。
      if (ret && typeof ret.then === 'function') {
        try {
          ;(ret as Promise<any>).then(
            () => {},
            (err: any) => {
              try {
                console.warn(
                  `[crx-evt] async listener '${name}' rejected: ${(err && (err.stack || err.message)) || err}`,
                )
              } catch {}
            },
          )
        } catch {}
      }
    }
    if (CRX_PERF) {
      recordEventPerf(extensionId, name, callbackCount, perfNow() - dispatchStartedAt, maxCallbackMs)
    }
    if (mediaEventVerbose && mediaEvent && mediaEventLogCount < 200) {
      mediaEventLogCount++
      try {
        console.log(
            `[crx-evt] received event=${name} callbacks=${callbackCount} ` +
              `ext=${extensionId} ` +
            `tab=${args[0]?.tabId ?? -1} type=${args[0]?.type || ''} ` +
            `contentType=${(args[0]?.responseHeaders || []).find?.((h: any) => String(h?.name || '').toLowerCase() === 'content-type')?.value || ''} ` +
            `requestId=${args[0]?.requestId ?? ''} ` +
            `url=${String(args[0]?.url || '').slice(0, 180)}`,
        )
      } catch {}
    }
    // 当前主进程仅消费 onAuthRequired 的异步响应。其它 webRequest 回调由
    // Electron 的同步宿主拦截器处理，回传结果不会被应用；uBlock 会在每个请求的
    // onBeforeRequest/onHeadersReceived 各回一条无效 IPC，造成明显的主进程压力。
    if (name === 'webRequest.onAuthRequired') {
      try {
        const reqId = args[0] && (args[0] as any).requestId
        ipcRenderer.send('crx-webrequest-response', reqId, name, blockResult)
      } catch {}
    }
  })
}

export const removeExtensionListener = (extensionId: string, name: string, callback: any) => {
  const rec = registry.get(name)
  if (rec) {
    const idx = rec.entries.findIndex((e) => e.cb === callback)
    if (idx < 0) return
    rec.entries.splice(idx, 1)
    if (rec.count > 0) rec.count--
    if (rec.count === 0) {
      ipcRenderer.send('crx-remove-listener', extensionId, name)
    } else if (name.startsWith('webRequest.')) {
      // 同一事件还有 callback 时只更新主进程的 aggregate filter，保留 IPC 绑定。
      ipcRenderer.send('crx-add-listener', extensionId, name, webRequestRegistrations(rec))
    }
  }
}
