import {existsSync, promises as fs, createWriteStream} from 'fs';
import {resolve, join} from 'path';

import {BlockingResponse, ElectronBlocker, Request} from '@cliqz/adblocker-electron';
import {getPath} from '~/utils';
import {Application} from '../application';
import {ipcMain, webContents} from 'electron';
import {getDomain} from 'tldts';
import {deletePath, isExpire, readFileAsText, writeFileText} from "~/utils/files";
import {filterVideo, stripEdgeCspHeaders} from '~/main/services/supervideo-video';

export let engine: ElectronBlocker;

// Electron webRequest.resourceType(camelCase) → Chrome 扩展 webRequest type(snake_case)。
// AdGuard 等扩展按 Chrome 标准 type 匹配,未映射会导致匹配异常(全盘 redirect + per-tab badge 不计数)。
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

// webRequest 事件分发回调：用于向扩展分发 webRequest.onBeforeRequest 等事件
// 由于 Electron 的 webRequest API 只支持一个监听器，我们需要在 adblock 的
// onBeforeRequest 包装器中手动分发事件到扩展。
// 每个 Session 只能向同一 Session 的扩展分发网络事件。跨 session 广播会把无痕
// 请求泄漏给普通扩展，或让未获授权的扩展观察无痕流量。
const webRequestEventDispatchers = new Map<
  Electron.Session,
  (eventName: string, details: any) => void
>();

export function setWebRequestDispatcher(
  session: Electron.Session,
  dispatcher: (eventName: string, details: any) => void,
) {
  webRequestEventDispatchers.set(session, dispatcher);
}

// 独立的 DNR (declarativeNetRequest) 执行路径。屏蔽开启时 cliqz 占据 session 唯一
// onBeforeRequest / onHeadersReceived 监听器, vendor WebRequestAPI 的回调(及其内
// 置的 DNR 咨询)不会运行。这里把 DNR 实例注入 hookEngine, 让扩展的 DNR 规则在
// 屏蔽开启/关闭两种状态下都能同步执行。所有方法必须同步(Electron 42 异步调
// webRequest callback 会触发 Chromium CHECK 硬崩主进程)。
interface DnrEnforcer {
  decideBeforeRequest(details: {
    url: string
    resourceType?: string
    method?: string
    referrer?: string
    initiator?: string
  }): { action: 'block' | 'redirect' | 'upgradeScheme' | 'allow' | 'none'; redirectUrl?: string }
  matchHeaders(
    details: {
      url: string
      resourceType?: string
      method?: string
      referrer?: string
      initiator?: string
    },
    kind: 'request' | 'response',
    headers: Array<{ name: string; value?: string }>,
  ): Array<{ name: string; value?: string }> | undefined
}
const dnrEnforcers = new Map<Electron.Session, DnrEnforcer>();

export function setDnrEnforcer(session: Electron.Session, enforcer: DnrEnforcer) {
  dnrEnforcers.set(session, enforcer);
}

const requestSession = (details: any): Electron.Session | undefined => {
  if (!details?.webContentsId) return undefined;
  try {
    return webContents.fromId(details.webContentsId)?.session;
  } catch {
    return undefined;
  }
};

const isNetworkUrl = (url?: string) => !!url && /^(https?|wss?):\/\//i.test(url);

const cookieSite = (hostname: string) =>
  getDomain(hostname, {allowPrivateDomains: true}) || hostname.toLowerCase();

// Electron 没有直接暴露 Chromium 的 third-party-cookie 开关。用当前
// BrowserView 的顶层站点与响应站点比较，只在真实跨站响应中移除 Set-Cookie。
export function stripThirdPartySetCookies(
  details: any,
  responseHeaders: Record<string, string[]> | undefined,
  targetSession: Electron.Session,
): boolean {
  if (!responseHeaders || !details?.url) return false;
  if (/^(mainFrame|main_frame)$/i.test(details.resourceType || '')) return false;

  const contents = details.webContentsId
    ? webContents.fromId(details.webContentsId)
    : undefined;
  if (!contents || contents.session !== targetSession) return false;

  try {
    const requestUrl = new URL(details.url);
    const topUrl = new URL(contents.getURL());
    if (!requestUrl.hostname || !topUrl.hostname) return false;
    if (
      requestUrl.protocol === topUrl.protocol &&
      cookieSite(requestUrl.hostname) === cookieSite(topUrl.hostname)
    ) {
      return false;
    }
  } catch {
    return false;
  }

  const key = Object.keys(responseHeaders).find(
    (name) => name.toLowerCase() === 'set-cookie',
  );
  if (!key) return false;
  const cookies = responseHeaders[key] || [];
  // Chrome 在阻止第三方 Cookie 时仍允许 CHIPS 的 Partitioned Cookie。
  const partitioned = cookies.filter((cookie) =>
    /(?:^|;)\s*Partitioned\s*(?:;|$)/i.test(cookie),
  );
  if (partitioned.length === cookies.length) return false;
  if (partitioned.length > 0) responseHeaders[key] = partitioned;
  else delete responseHeaders[key];
  return true;
}

// Electron webRequest 头: 请求是 Record<string,string>, 响应是 Record<string,string[]>。
// DNR 的 matchHeaders 工作在 {name,value}[] 上, 这里双向转换(与 vendor web-request.ts
// 的实现一致, 但本文件不能 import 那些局部 helper, 故就地复制)。
const recordReqToArray = (rec: Record<string, string> | undefined) =>
  rec ? Object.keys(rec).map((name) => ({ name, value: rec[name] })) : []
const arrayToReqRecord = (arr: Array<{ name: string; value?: string }>) => {
  const out: Record<string, string> = {};
  for (const h of arr) out[h.name] = h.value ?? '';
  return out;
}
const recordRespToArray = (rec: Record<string, string[]> | undefined) => {
  const arr: Array<{ name: string; value?: string }> = [];
  if (rec) for (const name of Object.keys(rec)) for (const value of rec[name] || []) arr.push({ name, value });
  return arr;
}
const arrayToRespRecord = (arr: Array<{ name: string; value?: string }>) => {
  const out: Record<string, string[]> = {};
  for (const h of arr) {
    if (!out[h.name]) out[h.name] = [];
    out[h.name].push(h.value ?? '');
  }
  return out;
}

// Electron webRequest 的 responseHeaders/requestHeaders 默认是 Record<string,string[]>,
// 而 Chrome 扩展 webRequest API 期望 Array<{name,value}>。IDM 的 Z()(遍历 headers 找
// Content-Type/Content-Length)用 for..of,若收到 Record 会抛 "not iterable",导致 n.Jb
// 在调 yc() 前就异常退出,视频媒体检测不到。这里统一转成 Chrome 数组格式。
function toChromeHeaders(h: any): any[] | undefined {
  if (!h) return undefined;
  if (Array.isArray(h)) return h;
  if (typeof h === 'object') {
    const out: any[] = [];
    for (const [name, values] of Object.entries(h)) {
      if (Array.isArray(values)) {
        for (const v of values) out.push({name, value: String(v)});
      } else {
        out.push({name, value: String(values)});
      }
    }
    return out;
  }
  return undefined;
}

// 任意 webRequest 监听器(如 settings.ts 的 onHeadersReceived,它在屏蔽关闭/引擎
// 未初始化时会成为 session 上唯一的 onHeadersReceived 监听 —— Electron 单监听器,
// 后注册者覆盖前者)都可调用本函数,把事件转发给扩展。否则扩展(如 IDM Integration
// Module 的 n.Jb,依赖 onHeadersReceived 检测视频媒体并发 case13 给桌面)永远收不到
// 该事件,视频下载浮层无法出现。details 为 Electron 原生 webRequest details。
export function dispatchWebReqToExtensions(
  eventName: string,
  details: any,
  session?: Electron.Session,
) {
  if (webRequestEventDispatchers.size === 0) return;
  if (!details || typeof details.url !== 'string' || details.url.startsWith('chrome-extension://')) {
    return;
  }
  const chromeDetails = {
    requestId: String(details.id),
    url: details.url,
    method: details.method || 'GET',
    frameId: details.frameId || 0,
    parentFrameId: details.parentFrameId || -1,
    tabId: details.webContentsId || -1,
    type: normalizeResourceType(details.resourceType),
    timeStamp: details.timestamp || Date.now(),
    statusCode: details.statusCode,
    statusLine: details.statusLine,
    responseHeaders: toChromeHeaders(details.responseHeaders),
    requestHeaders: toChromeHeaders(details.requestHeaders),
    initiator: details.initiator || '',
  };
  const dispatcher = webRequestEventDispatchers.get(session || requestSession(details));
  if (!dispatcher) return;
  try {
    dispatcher(eventName, chromeDetails);
  } catch (err) {
    console.error('[adblock] dispatchWebReqToExtensions error:', err);
  }
}

//const PRELOAD_PATH = join(__dirname, './preload.js');

// [adblock] 调试计数器：用于排查"拦截数永远为0"
let dbgRequestCount = 0;      // 进入覆盖层 onBeforeRequest 的请求总数
let dbgWhitelistSkip = 0;     // 命中白名单被放行的数量
let dbgBlockedCount = 0;      // request-blocked/redirected 触发次数
let dbgEmitFailNoWin = 0;     // emit 时找不到窗口/视图导致事件丢失的次数
let dbgAllowed = 0;           // request-allowed 次数
let dbgWhitelisted = 0;       // request-whitelisted(被例外规则解封)次数
let dbgFilterMatched = 0;     // filter-matched 次数
let dbgRedirected = 0;        // request-redirected 次数
let engineHooked = false;     // 当前 engine 实例是否已挂钩(防止重复包装/套娃)

const emitBlockedEvent = (request: Request, result: BlockingResponse) => {
  dbgBlockedCount++;
  const win = Application.instance.windows.findByBrowserView(request.tabId);
  if (!win) {
    dbgEmitFailNoWin++;
    console.log(
      `[adblock] BLOCKED but NO WINDOW: tabId=${request.tabId} url=${request.url} ` +
      `(blocked=${dbgBlockedCount}, lostNoWin=${dbgEmitFailNoWin})`,
    );
    return;
  }
  const view = win.viewManager.views.get(request.tabId);
  if (!view) {
    dbgEmitFailNoWin++;
    console.log(
      `[adblock] BLOCKED but NO VIEW: tabId=${request.tabId} url=${request.url} ` +
      `(blocked=${dbgBlockedCount}, lostNoView=${dbgEmitFailNoWin})`,
    );
    return;
  }
  const filterStr = result.filter
    ? (result.filter.filter || result.filter.toString())
    : '(no-filter)';
  console.log(
    `[adblock] BLOCKED #${dbgBlockedCount} tabId=${request.tabId} ` +
    `filter=${filterStr} url=${request.url}`,
  );
  view.emitEvent('blocked-ad', request.url, filterStr, filterCount);
};

let adblockRunning = false;
let adblockInitialized = false;

interface IAdblockInfo {
  headersReceivedId?: number;
  beforeRequestId?: number;
}

// const adsLists = [
//   "https://filters.adtidy.org/extension/chromium/filters/224.txt",
//   "https://adrules.top/adblock_lite.txt",
//   "https://hub.gitmirror.com/https://raw.githubusercontent.com/xun404/adblock/main/ad.txt"
// ];
const adsLists: string[] = [
];
export let filterCount = 0;

// 原生 fetch + 超时。替代 cross-fetch: cross-fetch 在 Node 下走 node-fetch, 对 api.yjllq.com 的
// gzip 响应做 Gunzip 解压时会抛 ERR_STREAM_PREMATURE_CLOSE, 导致订阅永远拉不到(规则归零)。
const fetchWithTimeout = (url: string, timeout = 15000, options: RequestInit = {}): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, {...options, signal: controller.signal}).finally(() => clearTimeout(timer));
};

// ===== 订阅原文本地缓存 =====
// 每次成功拉取就落盘; 断网或接口失败时用上次缓存兜底, 绝不让规则归零。内存里维护一份,
// loadFilters 结束后一次性写盘(避免 fromLists 并发拉取多份订阅时的写竞态); 仅在有更新时落盘。
const getListCachePath = () => resolve(getPath('adblock/lists-cache.json'));
const listTextCache = new Map<string, string>();
let listCacheLoaded = false;
let listCacheDirty = false;

const ensureListCacheLoaded = () => {
  if (listCacheLoaded) return;
  listCacheLoaded = true;
  const raw = readFileAsText(getListCachePath());
  if (raw && raw !== 'empty') {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
          if (typeof obj[key] === 'string') listTextCache.set(key, obj[key]);
        }
      }
    } catch (e) {
      console.error('[adblock] lists-cache.json 解析失败', e);
    }
  }
};

const flushListCache = () => {
  if (!listCacheDirty) return;
  listCacheDirty = false;
  const obj: Record<string, string> = {};
  listTextCache.forEach((value, key) => { obj[key] = value; });
  writeFileText(getListCachePath(), JSON.stringify(obj));
};

// ElectronBlocker.fromLists 的 fetcher。
// 成功 -> 缓存原文并返回; 失败 -> 用本地缓存兜底; 都没有 -> 返回空。
// 关键: 不抛错(resources.txt 之类拉不到也不会让整次 fromLists 失败), 也不再用"空 200 假成功"
// 覆盖已有好数据——旧 customFetch 正是这么把 0 规则引擎写进了 cache.bin。
const subscriptionFetch = async (url: string): Promise<Response> => {
  const headers = {'Content-Type': 'text/plain'};
  try {
    const resp = await fetchWithTimeout(url, 20000);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    if (text && text.trim()) {
      ensureListCacheLoaded();
      listTextCache.set(url, text);
      listCacheDirty = true;
      return new Response(text, {status: 200, headers});
    }
    throw new Error('空响应');
  } catch (e) {
    ensureListCacheLoaded();
    const cached = listTextCache.get(url);
    if (cached && cached.trim()) {
      console.warn(`[adblock] 拉取 ${url} 失败, 使用本地缓存兜底`);
      return new Response(cached, {status: 200, headers});
    }
    console.warn(`[adblock] 拉取 ${url} 失败且无本地缓存, 该订阅本次为空`, e);
    return new Response('', {status: 200, headers});
  }
};

// 内置白名单: 默认放行这些站点, 但不在"设置"的白名单列表里展示(用户不可删)。
const BUILTIN_WHITELIST = [
  "qq.com",
  "iqiyi.com",
  "youku.com",
  "mgtv.com",
  "v.qq.com"
];
let whiteList = [...BUILTIN_WHITELIST];

// ===== 订阅规则管理 =====
// 旧实现把所有订阅地址塞进 lists.txt, 引擎合并成一个, 无法区分单条订阅的名字/条数。
// 新实现用 adblock/subscriptions.json 单独保存每条订阅的元数据(名字、条数、启用、更新时间),
// lists.txt 仍作为"已启用地址"的镜像保留, 兼容旧的 getAdLists/updateAdLists。
const BUILTIN_ADBLOCK_URL = 'https://api.yjllq.com/api/White/adblock';
const DEFAULT_AUTO_UPDATE_HOURS = 168; // 默认每周自动更新

interface ISubItem {
  url: string;
  name: string;
  count: number;       // 该订阅内的规则条数
  enabled: boolean;
  builtin: boolean;    // 是否为内置订阅(仅用于展示标记, 仍可删除/禁用)
  updatedAt: number;   // 最近一次成功拉取的时间戳(ms), 0 表示从未
}

interface ISubStore {
  seeded: boolean;             // 是否已做过首次种子化(避免删除后又被重新塞回)
  autoUpdateHours: number;     // 自动更新间隔(小时), 0 表示关闭
  items: ISubItem[];
}

const getSubStorePath = () => resolve(getPath('adblock/subscriptions.json'));

const normalizeUrl = (url: string) => (url || '').trim();

// 解析订阅文本: 取 ! Title 作为名字, 统计规则条数(非空、非注释、非头部标记)。
const parseListMeta = (text: string, url: string): {name: string; count: number} => {
  let name = '';
  let count = 0;
  for (let line of (text || '').split('\n')) {
    line = line.trim();
    if (!line) continue;
    if (line.startsWith('!')) {
      if (!name) {
        const m = line.match(/^!\s*Title:\s*(.+)$/i);
        if (m) name = m[1].trim();
      }
      continue;
    }
    if (line.startsWith('[')) continue; // [Adblock Plus 2.0] 之类的头部
    count++;
  }
  if (!name) {
    try {
      name = new URL(url).hostname;
    } catch {
      name = url;
    }
  }
  return {name, count};
};

// 从远端拉取订阅并解析元数据。失败返回 null。
const fetchListMeta = async (url: string): Promise<{name: string; count: number} | null> => {
  try {
    const resp = await fetchWithTimeout(url, 15000);
    if (!resp || !resp.ok) return null;
    const text = await resp.text();
    if (!text || !text.trim()) return null;
    return parseListMeta(text, url);
  } catch (e) {
    console.error(`[adblock] fetchListMeta 失败 ${url}:`, e);
    return null;
  }
};

const readListsTxtUrls = (): string[] => {
  const listPath = resolve(getPath('adblock/lists.txt'));
  const list = readFileAsText(listPath);
  if (!list || list === 'empty') return [];
  return list.split('\n').map((l) => l.trim()).filter((l) => l !== '');
};

const readSubStore = (): ISubStore => {
  const p = getSubStorePath();
  const raw = readFileAsText(p);
  if (raw && raw !== 'empty') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.items)) {
        return {
          seeded: parsed.seeded !== false,
          autoUpdateHours:
            typeof parsed.autoUpdateHours === 'number'
              ? parsed.autoUpdateHours
              : DEFAULT_AUTO_UPDATE_HOURS,
          items: parsed.items.map((it: any) => ({
            url: normalizeUrl(it.url),
            name: it.name || '',
            count: typeof it.count === 'number' ? it.count : 0,
            enabled: it.enabled !== false,
            builtin: !!it.builtin,
            updatedAt: typeof it.updatedAt === 'number' ? it.updatedAt : 0,
          })).filter((it: ISubItem) => it.url),
        };
      }
    } catch (e) {
      console.error('[adblock] subscriptions.json 解析失败, 将重新种子化:', e);
    }
  }
  // 首次: 种子化内置订阅 + 迁移已有 lists.txt 地址
  const items: ISubItem[] = [
    {
      url: BUILTIN_ADBLOCK_URL,
      name: 'EasyList China（内置）',
      count: 0,
      enabled: true,
      builtin: true,
      updatedAt: 0,
    },
  ];
  for (const url of readListsTxtUrls()) {
    if (url === BUILTIN_ADBLOCK_URL) continue;
    items.push({url, name: '', count: 0, enabled: true, builtin: false, updatedAt: 0});
  }
  const store: ISubStore = {seeded: true, autoUpdateHours: DEFAULT_AUTO_UPDATE_HOURS, items};
  writeSubStore(store);
  return store;
};

const writeSubStore = (store: ISubStore) => {
  writeFileText(getSubStorePath(), JSON.stringify(store, null, 2));
  // 镜像已启用地址到 lists.txt, 兼容旧的 getAdLists 路径
  const enabled = store.items.filter((i) => i.enabled).map((i) => i.url);
  const listPath = resolve(getPath('adblock/lists.txt'));
  writeFileText(listPath, enabled.length ? enabled.join('\n') : 'empty');
};

const getEnabledSubUrls = (): string[] =>
  readSubStore().items.filter((i) => i.enabled).map((i) => i.url);

// 删缓存并对所有会话重启拦截服务, 使订阅集合/规则变更立即生效。
const reloadAllSessions = async (ses: Electron.Session[]) => {
  const path = resolve(getPath('adblock/cache.bin'));
  await deletePath(path);
  for (let i = 0; i < ses.length; i++) {
    stopAdblockService(ses[i]);
    await runAdblockService(ses[i]);
  }
};

// 仅刷新元数据(名字/条数/更新时间), 不重启引擎。用于首屏补全条数展示。
const refreshSubMeta = async (urls: string[]): Promise<boolean> => {
  const store = readSubStore();
  let changed = false;
  for (const url of urls) {
    const item = store.items.find((i) => i.url === url);
    if (!item) continue;
    const meta = await fetchListMeta(url);
    if (!meta) continue;
    item.name = meta.name;
    item.count = meta.count;
    item.updatedAt = Date.now();
    changed = true;
  }
  if (changed) writeSubStore(store);
  return changed;
};

export const getSubscriptions = (): ISubStore => readSubStore();

export const addSubscription = async (
  url: string,
  ses: Electron.Session[],
): Promise<ISubStore & {error?: string}> => {
  url = normalizeUrl(url);
  const store = readSubStore();
  if (!url) return {...store, error: '地址不能为空'};
  if (!/^https?:\/\//i.test(url)) return {...store, error: '地址需以 http(s):// 开头'};
  if (store.items.some((i) => i.url === url)) return {...store, error: '该订阅已存在'};
  const meta = await fetchListMeta(url);
  if (!meta) return {...store, error: '无法拉取该订阅地址'};
  store.items.push({
    url,
    name: meta.name,
    count: meta.count,
    enabled: true,
    builtin: false,
    updatedAt: Date.now(),
  });
  writeSubStore(store);
  await reloadAllSessions(ses);
  return readSubStore();
};

export const removeSubscription = async (
  url: string,
  ses: Electron.Session[],
): Promise<ISubStore> => {
  url = normalizeUrl(url);
  const store = readSubStore();
  const next = store.items.filter((i) => i.url !== url);
  if (next.length === store.items.length) return store;
  store.items = next;
  writeSubStore(store);
  await reloadAllSessions(ses);
  return readSubStore();
};

export const toggleSubscription = async (
  url: string,
  enabled: boolean,
  ses: Electron.Session[],
): Promise<ISubStore> => {
  url = normalizeUrl(url);
  const store = readSubStore();
  const item = store.items.find((i) => i.url === url);
  if (!item || item.enabled === enabled) return store;
  item.enabled = enabled;
  writeSubStore(store);
  await reloadAllSessions(ses);
  return readSubStore();
};

export const updateSubscription = async (
  url: string,
  ses: Electron.Session[],
): Promise<ISubStore> => {
  url = normalizeUrl(url);
  await refreshSubMeta([url]);
  await reloadAllSessions(ses);
  return readSubStore();
};

export const updateAllSubscriptions = async (
  ses: Electron.Session[],
): Promise<ISubStore> => {
  const store = readSubStore();
  await refreshSubMeta(store.items.filter((i) => i.enabled).map((i) => i.url));
  await reloadAllSessions(ses);
  return readSubStore();
};

export const setAutoUpdateHours = (hours: number): ISubStore => {
  const store = readSubStore();
  store.autoUpdateHours = Number.isFinite(hours) && hours > 0 ? hours : 0;
  writeSubStore(store);
  startAutoUpdateTimer();
  return store;
};

// ===== 自动更新计时器 =====
let autoUpdateTimer: NodeJS.Timeout | null = null;
let autoUpdateChecking = false;

const getAllViewSessions = (): Electron.Session[] => {
  try {
    return [
      Application.instance.sessions.view,
      Application.instance.sessions.viewIncognito,
    ].filter(Boolean) as Electron.Session[];
  } catch {
    return [];
  }
};

const maybeAutoUpdate = async () => {
  if (autoUpdateChecking) return;
  autoUpdateChecking = true;
  try {
    const store = readSubStore();
    if (!store.autoUpdateHours) return;
    const now = Date.now();
    const dueMs = store.autoUpdateHours * 3600 * 1000;
    const due = store.items.filter(
      (i) => i.enabled && now - (i.updatedAt || 0) >= dueMs,
    );
    if (!due.length) return;
    const ses = getAllViewSessions();
    if (!ses.length) return;
    console.log(`[adblock] 自动更新 ${due.length} 条订阅`);
    await refreshSubMeta(due.map((i) => i.url));
    await reloadAllSessions(ses);
  } catch (e) {
    console.error('[adblock] 自动更新失败', e);
  } finally {
    autoUpdateChecking = false;
  }
};

const startAutoUpdateTimer = () => {
  if (autoUpdateTimer) {
    clearInterval(autoUpdateTimer);
    autoUpdateTimer = null;
  }
  const store = readSubStore();
  if (!store.autoUpdateHours) return;
  // 启动后稍等再做一次到期检查, 之后每小时检查一次
  setTimeout(() => { maybeAutoUpdate(); }, 60 * 1000);
  autoUpdateTimer = setInterval(() => { maybeAutoUpdate(); }, 60 * 60 * 1000);
};

// ===== 用户自定义规则(元素拾取器"标记广告"生成) =====
// 与订阅 lists.txt 分离, 单独持久化到 adblock/userRules.txt。
// cosmetic 规则(host##selector)走 CSS 注入(引擎 loadCosmeticFilters:false);
// 网络规则(||host/path^)走 engine.updateFromDiff 动态生效。
const userRulesSet = new Set<string>();
// key 为域名('' 表示全局通用), value 为该域名下的隐藏选择器集合
const cosmeticMap = new Map<string, Set<string>>();

const getUserRulesPath = () => resolve(getPath('adblock/userRules.txt'));

// 解析 cosmetic 规则。返回 {host, selector} 或 null(非 cosmetic)。
const parseCosmeticRule = (rule: string): {host: string; selector: string} | null => {
  const idx = rule.indexOf('##');
  if (idx === -1) return null;
  const host = rule.slice(0, idx).trim().toLowerCase();
  const selector = rule.slice(idx + 2).trim();
  if (!selector) return null;
  return {host, selector};
};

const addCosmeticToMap = (host: string, selector: string) => {
  const key = host || '';
  if (!cosmeticMap.has(key)) cosmeticMap.set(key, new Set());
  cosmeticMap.get(key).add(selector);
};

// 页面域名是否匹配规则域名(规则域名为空=全局通用; 否则同域或子域)
const cosmeticHostMatches = (pageHost: string, ruleHost: string) => {
  if (!ruleHost) return true;
  pageHost = (pageHost || "").toLowerCase();
  ruleHost = ruleHost.toLowerCase();
  return pageHost === ruleHost || pageHost.endsWith('.' + ruleHost);
};

// 读取 userRules.txt: 重建 cosmeticMap/userRulesSet, 返回其中的网络规则供引擎加载。
const loadUserRules = (): string[] => {
  const p = getUserRulesPath();
  const content = readFileAsText(p);
  cosmeticMap.clear();
  userRulesSet.clear();
  const networkRules: string[] = [];
  if (content && content !== 'empty') {
    for (let line of content.split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('!')) continue;
      userRulesSet.add(line);
      const cosmetic = parseCosmeticRule(line);
      if (cosmetic) {
        addCosmeticToMap(cosmetic.host, cosmetic.selector);
      } else {
        networkRules.push(line);
      }
    }
  }
  console.log(`[adblock] loadUserRules: ${userRulesSet.size} 条 (cosmetic ${userRulesSet.size - networkRules.length}, network ${networkRules.length})`);
  return networkRules;
};

const appendUserRule = (rule: string) => {
  const p = getUserRulesPath();
  const existing = readFileAsText(p);
  const lines = (existing && existing !== 'empty')
    ? existing.split('\n').map((l) => l.trim()).filter((l) => l)
    : [];
  lines.push(rule);
  writeFileText(p, lines.join('\n'));
};

// 对指定 webContents 注入匹配其域名的全部 cosmetic 隐藏规则。
// 页面加载完成(view.ts did-finish-load)及保存新规则时调用。
export const injectCosmeticForHost = (webContents: any, host: string) => {
  if (!webContents || webContents.isDestroyed()) return;
  const selectors: string[] = [];
  cosmeticMap.forEach((set, ruleHost) => {
    if (cosmeticHostMatches(host, ruleHost)) {
      set.forEach((s) => selectors.push(s));
    }
  });
  if (!selectors.length) return;
  const css = selectors.join(',\n') + ' { display: none !important; }';
  try {
    webContents.insertCSS(css, {cssOrigin: 'user'});
  } catch (e) {
    console.error('[adblock] insertCSS failed', e);
  }
};

// 保存元素拾取器生成的单条规则: 去重持久化 + 即时生效。
export const saveAdblockRule = async (rule: string, view?: any) => {
  rule = (rule || '').trim();
  if (!rule) return;
  const isNew = !userRulesSet.has(rule);
  if (isNew) {
    userRulesSet.add(rule);
    appendUserRule(rule);
  }
  const cosmetic = parseCosmeticRule(rule);
  if (cosmetic) {
    addCosmeticToMap(cosmetic.host, cosmetic.selector);
    // 立即对当前页注入(仅注入这一条, 避免重复注入既有规则)
    if (view && view.webContents && !view.webContents.isDestroyed()) {
      try {
        view.webContents.insertCSS(
          cosmetic.selector + ' { display: none !important; }',
          {cssOrigin: 'user'},
        );
      } catch (e) {
        console.error('[adblock] insertCSS(immediate) failed', e);
      }
    }
  } else {
    // 网络规则: 动态加入引擎; 已加载的请求需刷新页面才会被拦截
    try {
      if (engine) (engine as any).updateFromDiff({added: [rule]});
    } catch (e) {
      console.error('[adblock] updateFromDiff failed', e);
    }
    if (view && view.webContents && !view.webContents.isDestroyed()) {
      try {
        view.webContents.reload();
      } catch (e) {
      }
    }
  }
  console.log(`[adblock] saveAdblockRule rule=${rule} new=${isNew} cosmetic=${!!cosmetic}`);
};

const loadFilters = async () => {
  console.log("loadFilters");
  //订阅地址: 以 subscriptions.json 中"已启用"的为准(首次读取会种子化内置订阅+迁移 lists.txt)
  const ads = getEnabledSubUrls();
  console.log(`[adblock] 启用订阅 -> ${ads.length} 条:`, ads);
  if (ads.length === 0) {
    console.warn('[adblock] 订阅列表为空 -> 引擎不会加载任何网络规则 -> 拦截数将永远为 0。请在 设置>隐私>广告拦截订阅 添加规则地址。');
  }
  //白名单
  const whitePath = resolve(getPath('adblock/whiteList.txt'));
  const white = readFileAsText(whitePath);
  if (white) {
    whiteList = white.split("\n").filter(it => it && it.trim() != "");
  } else {
    writeFileText(whitePath, whiteList.join("\n"));
  }
  //缓存
  const path = resolve(getPath('adblock/cache.bin'));
  const shouldDelete = await isExpire(path, process.env.NODE_ENV === 'development' ? 1 : 24);
  if (shouldDelete) {
    //过期了，重新下载
    await deletePath(path);
  }
  // 载入订阅原文本地缓存, 供 subscriptionFetch 在断网/拉取失败时兜底。
  ensureListCacheLoaded();
  engine = await ElectronBlocker.fromLists(subscriptionFetch, ads, {
    loadCosmeticFilters: false,
    enableHtmlFiltering: false
  }, {
    path: path,
    read: fs.readFile,
    write: fs.writeFile,
  });
  // 加载用户自定义规则: 建 cosmetic 表, 网络规则并入引擎
  const userNetworkRules = loadUserRules();
  if (userNetworkRules.length) {
    try {
      (engine as any).updateFromDiff({added: userNetworkRules});
      console.log(`[adblock] 已并入 ${userNetworkRules.length} 条用户网络规则`);
    } catch (e) {
      console.error('[adblock] 并入用户网络规则失败', e);
    }
  }
  try {
    filterCount = engine.filters.getFilters().length;
    console.log("loadFilters end, filterCount = ", filterCount);
    if (filterCount === 0) {
      console.warn('[adblock] filterCount=0 -> 引擎没有任何网络过滤规则,任何请求都不会被拦截。');
    }
  } catch (e) {
    console.error(e);
  }
  // 落盘本次成功拉取的订阅原文(下次断网兜底)。
  flushListCache();
  // 兜底: 若最终一条网络规则都没有, 删掉引擎缓存, 避免把"0 规则"持久化(下次启动会重新拉取)。
  if (filterCount === 0) {
    await deletePath(path).catch(() => {});
  }
  // 引擎新建后只挂钩一次：包装 onBeforeRequest + 注册事件监听
  hookEngine();
  // 首屏补全订阅元数据(名字/条数), 并启动自动更新计时器。
  // 后台异步进行, 不阻塞引擎启用。
  setTimeout(() => {
    const need = readSubStore().items.filter((i) => !i.count).map((i) => i.url);
    if (need.length) refreshSubMeta(need).catch(() => {});
    startAutoUpdateTimer();
  }, 3000);
};

// 对当前 engine 实例做一次性挂钩：白名单包装 + 全事件诊断监听。
// 关键修复：原代码每次导航 runAdblockService 都重新包装 onBeforeRequest,
// 导致 wrapper 套娃十几层、计数虚高。现在每个 engine 实例只挂钩一次。
const hookEngine = () => {
  if (!engine || engineHooked) return;
  engineHooked = true;

  const onBeforeRequest = engine.onBeforeRequest.bind(engine);
  (engine as any).onBeforeRequest = (details: Electron.OnBeforeRequestListenerDetails, callback: any) => {
    dbgRequestCount++;
    if (dbgRequestCount % 200 === 1) {
      console.log(
        `[adblock] 请求=${dbgRequestCount} 白名单放行=${dbgWhitelistSkip} ` +
        `filter命中=${dbgFilterMatched} 拦截=${dbgBlockedCount} 重定向=${dbgRedirected} ` +
        `例外放行=${dbgWhitelisted} 正常放行=${dbgAllowed}`,
      );
    }

    // 分发 webRequest.onBeforeRequest 事件到扩展(仅用于统计/cosmetic;网络阻塞见下方说明)。
    if (!details.url.startsWith('chrome-extension://')) {
      dispatchWebReqToExtensions('onBeforeRequest', details);
    }

    if (details.url.startsWith('chrome-extension://')) {
      callback({});
      return;
    }
    // 注意:这里必须同步调用 callback。曾尝试为接回 uBlock 的 {cancel} 把 callback 延迟到
    // 扩展 IPC 响应到达/setTimeout 再调,结果启动即崩(Chromium CHECK:在已被取消/销毁的
    // 请求上异步调 webRequest callback)。Electron 单 session 单监听器 + cliqz 占位,使扩展的
    // 网络级阻塞在当前架构下难以安全接回;uBlock 的统计/cosmetic 过滤仍经上面的分发生效。
    let called = false;
    const safeCallback = (resp: any) => {
      called = true;
      callback(resp);
    };
    try {
      if (details.referrer) {
        for (let s of whiteList) {
          if (s && details.referrer.includes(s)) {
            dbgWhitelistSkip++;
            safeCallback({});
            return;
          }
        }
      }
      // DNR 独立执行路径: 屏蔽开启时 cliqz 占据唯一监听器, vendor 回调不跑,
      // 这里在委托给 cliqz 之前同步咨询 DNR。block/redirect/upgradeScheme
      // 直接执行；allow 只解决扩展 DNR 规则之间的冲突，不能关闭用户启用的宿主拦截器。
      const dnr = dnrEnforcers.get(requestSession(details));
      if (dnr && isNetworkUrl(details.url)) {
        try {
          const verdict = dnr.decideBeforeRequest(details);
          if (verdict.action === 'block') {
            dbgBlockedCount++;
            safeCallback({cancel: true});
            return;
          }
          if (verdict.redirectUrl) {
            dbgRedirected++;
            safeCallback({redirectUrl: verdict.redirectUrl});
            return;
          }
        } catch (err) {
          console.error('[adblock] DNR decideBeforeRequest error', err);
        }
      }
      onBeforeRequest(details, safeCallback);
    } catch (err) {
      console.error('[adblock] onBeforeRequest error', err);
      if (!called) callback({});
    }
  };

  // 包装 onHeadersReceived。Electron webRequest 每个事件只允许一个监听器,广告屏蔽开启时
  // cliqz 的 BlockingContext.enable() 会注册 onHeadersReceived 并覆盖 settings.ts 的监听者
  // (实测 settings 的 callback 一次都不触发 → stripEdgeCspHeaders / filterVideo 全部失效,
  // Edge 商城 CSP 不被去除)。cliqz 注册的 this.onHeadersReceived 最终调用 blocker
  // .onHeadersReceived(= engine.onHeadersReceived),这里把后者替换成包装版:先分发事件
  // + filterVideo + 去 CSP,再委托给 cliqz 原始逻辑($csp / $removeheader 等)。这样屏蔽
  // 开启时 CSP 仍被去除;屏蔽关闭时则由 settings.ts 的 onHeadersReceived 兜底。
  const origOnHeadersReceived = engine.onHeadersReceived.bind(engine);
  (engine as any).onHeadersReceived = (details: any, callback: any) => {
    // 诊断 chrome-extension 页面(popup)加载卡顿:onHeadersReceived 是否进入、callback 是否被
    // 调用。卡顿表现为 did-start-loading 后无 did-finish-load,怀疑 origOnHeadersReceived 对
    // chrome-extension:// 不调 callback。
    const isChromeExt = details.url && details.url.startsWith('chrome-extension://');
    if (isChromeExt) {
      console.log(`[adblock] onHeadersReceived ENTER chrome-ext ${details.resourceType} ${String(details.url).slice(0, 80)}`);
    }
    // 分发 webRequest.onHeadersReceived 到扩展(屏蔽开启时 cliqz 占据 session 唯一监听器,
    // 原由 vendor web-request.ts 的分发被覆盖)。复用 dispatchWebReqToExtensions,统一完成
    // Electron→Chrome 字段映射 + responseHeaders 的 Record<string,string[]>→Array<{name,value}>
    // 格式转换(Chrome 扩展 webRequest API 规范要求数组格式;Record 会让扩展的 header 遍历
    // 抛 "not iterable")。屏蔽关闭时由 settings.ts 的 onHeadersReceived 调同一函数,行为一致。
    if (!isChromeExt) {
      try {
        dispatchWebReqToExtensions('onHeadersReceived', details);
      } catch (err) {
        console.error('[adblock] webRequest onHeadersReceived dispatch error:', err);
      }
    }
    // 视频嗅探(原 settings.ts onHeadersReceived 内的职责,屏蔽开启时已不触发,挪到此处)
    try {
      filterVideo(details);
    } catch (err) {
      console.log('[adblock] filterVideo error:', err);
    }
    // 委托给 cliqz 原始 onHeadersReceived,无论它是否改头,最后统一去掉 microsoftedge 的 CSP
    let applied = false;
    const applyHeaders = (response: any) => {
      if (applied) return;
      applied = true;
      if (isChromeExt) {
       // console.log(`[adblock] onHeadersReceived CALLBACK chrome-ext ${String(details.url).slice(0, 80)}`);
      }
      const baseHeaders = (response && response.responseHeaders) || details.responseHeaders;
      let headers = baseHeaders;
      let dnrTouched = false;
      let cookieTouched = false;
      const dnr = dnrEnforcers.get(requestSession(details));
      if (dnr && !isChromeExt && isNetworkUrl(details.url) && headers) {
        try {
          const modified = dnr.matchHeaders(
            details,
            'response',
            recordRespToArray(headers),
          );
          if (modified) {
            headers = arrayToRespRecord(modified);
            dnrTouched = true;
          }
        } catch (err) {
          console.error('[adblock] DNR response-headers error', err);
        }
      }
      // 屏蔽开启时本包装器是无痕 session 唯一的 onHeadersReceived，在这里补上
      // 第三方 Cookie 拦截；屏蔽关闭时 settings.ts 调用同一 helper。
      if (!isChromeExt && headers) {
        try {
          const sessions = Application.instance.sessions;
          if (
            sessions &&
            Application.instance.settings?.object
              .incognitoBlockThirdPartyCookies !== false
          ) {
            cookieTouched = stripThirdPartySetCookies(
              details,
              headers as Record<string, string[]>,
              sessions.viewIncognito,
            );
          }
        } catch {
          /* cookie 剥除失败不影响请求 */
        }
      }
      const stripped = stripEdgeCspHeaders(details.url, headers);
      if (stripped || dnrTouched || cookieTouched) {
        callback({...(response || {}), responseHeaders: stripped || headers});
      } else {
        callback(response || {});
      }
    };
    try {
      origOnHeadersReceived(details, applyHeaders);
    } catch (err) {
      console.error('[adblock] onHeadersReceived error', err);
      applyHeaders({});
    }
    // 注意:不要在此为 chrome-extension 请求加 setTimeout 强制 callback。异步调用 webRequest
    // callback(在可能已被取消/销毁的请求上)会触发 Chromium CHECK 导致主进程崩溃(已在
    // onBeforeRequest 上验证过同类崩溃)。popup 卡顿改由 popup.ts 的 loadURL 12s 超时 +
    // isStalled 兜底;此处只保留 ENTER/CALLBACK 诊断日志以定位 cliqz 是否漏调 callback。
  };

  // DNR modifyHeaders (request) — 独立路径。仅当 cliqz 引擎暴露 onBeforeSendHeaders
  // 且屏蔽开启时 session 监听器会路由到这里时生效;屏蔽关闭时由 vendor WebRequestAPI
  // 的 onBeforeSendHeaders 兜底。在 cliqz 的结果之上再叠加 DNR 改写, 全程同步。
  if (typeof (engine as any).onBeforeSendHeaders === 'function') {
    const origOnBeforeSendHeaders = (engine as any).onBeforeSendHeaders.bind(engine);
    (engine as any).onBeforeSendHeaders = (details: any, callback: any) => {
      const next = (resp: any) => {
        let requestHeaders = (resp && resp.requestHeaders) || details.requestHeaders;
        if (
          details.url &&
          !details.url.startsWith('chrome-extension://') &&
          isNetworkUrl(details.url) &&
          requestHeaders &&
          dnrEnforcers.has(requestSession(details))
        ) {
          const dnr = dnrEnforcers.get(requestSession(details));
          try {
            const modified = dnr?.matchHeaders(
              details,
              'request',
              recordReqToArray(requestHeaders),
            );
            if (modified) requestHeaders = arrayToReqRecord(modified);
          } catch (err) {
            console.error('[adblock] DNR request-headers error', err);
          }
        }
        if (requestHeaders !== ((resp && resp.requestHeaders) || details.requestHeaders)) {
          callback({...(resp || {}), requestHeaders});
        } else {
          callback(resp || {});
        }
      };
      try {
        origOnBeforeSendHeaders(details, next);
      } catch (err) {
        console.error('[adblock] onBeforeSendHeaders error', err);
        next({});
      }
    };
  }

  // 全事件诊断：一次定位匹配结局
  engine.on('request-allowed', () => { dbgAllowed++; });
  engine.on('request-whitelisted', (request: Request) => {
    dbgWhitelisted++;
    if (dbgWhitelisted <= 20) console.log(`[adblock] WHITELISTED(例外规则解封) url=${request.url}`);
  });
  engine.on('filter-matched', () => { dbgFilterMatched++; });
  engine.on('request-redirected', (request: Request, result: BlockingResponse) => {
    dbgRedirected++;
    emitBlockedEvent(request, result);
  });
  engine.on('request-blocked', emitBlockedEvent);
  console.log('[adblock] hookEngine 完成：已包装 onBeforeRequest 并注册全部事件监听。');
};

export const runAdblockService = async (ses: any) => {
  console.log("runAdblockService");
  if (!adblockInitialized) {
    adblockInitialized = true;
    await loadFilters();
  }
  if (adblockInitialized && !engine) {
    console.warn('[adblock] runAdblockService: engine 未初始化, 跳过启用。');
    return;
  }
  // 确保已挂钩(loadFilters 末尾已调用,这里兜底)
  hookEngine();
  console.log(`[adblock] enableBlockingInSession (filterCount=${filterCount})`);
  engine.enableBlockingInSession(ses);
  adblockRunning = true;
};

export const stopAdblockService = (ses: any) => {
  if (!adblockRunning) return;
  adblockRunning = false;
  adblockInitialized = false;
  engineHooked = false; // 下次 loadFilters 会新建 engine,需重新挂钩
  try {
    engine.disableBlockingInSession(ses);
    //ses.setPreloads(ses.getPreloads().filter((p: string) => p !== PRELOAD_PATH));
  } catch (e) {
    console.error(e);
  }
};
const persistWhiteList = () => {
  const whitePath = resolve(getPath('adblock/whiteList.txt'));
  writeFileText(whitePath, whiteList.join("\n"));
};

const normalizeDomain = (domain: string) => {
  if (!domain) return "";
  return domain.trim().replace(/^www\./, "").toLowerCase();
};

export const isSiteWhitelisted = (domain: string) => {
  const d = normalizeDomain(domain);
  if (!d) return false;
  return whiteList.some((s) => s && d.includes(s.trim()));
};

export const toggleSiteWhitelist = async (domain: string, ses: Electron.Session[]) => {
  const d = normalizeDomain(domain);
  if (!d) return false;
  const idx = whiteList.findIndex((s) => s && s.trim() === d);
  let enabled: boolean;
  if (idx >= 0) {
    // 已在白名单 -> 移除 -> 恢复拦截
    whiteList.splice(idx, 1);
    enabled = true;
  } else {
    // 不在白名单 -> 加入 -> 暂停拦截
    whiteList.push(d);
    enabled = false;
  }
  persistWhiteList();
  for (let i = 0; i < ses.length; i++) {
    stopAdblockService(ses[i]);
    await runAdblockService(ses[i]);
  }
  return enabled;
};

// ===== 白名单列表管理(设置页) =====
// 仅返回/操作用户自定义白名单, 内置白名单(BUILTIN_WHITELIST)对用户隐藏且不可删。
const isBuiltinWhite = (d: string) =>
  BUILTIN_WHITELIST.some((b) => b.toLowerCase() === d.toLowerCase());

export const getUserWhitelist = (): string[] =>
  whiteList.filter((d) => d && !isBuiltinWhite(d.trim()));

export const addWhitelistDomain = async (
  domain: string,
  ses: Electron.Session[],
): Promise<{list: string[]; error?: string}> => {
  const d = normalizeDomain(domain);
  if (!d) return {list: getUserWhitelist(), error: '域名不能为空'};
  if (whiteList.some((s) => s && s.trim().toLowerCase() === d)) {
    return {list: getUserWhitelist(), error: '该域名已在白名单'};
  }
  whiteList.push(d);
  persistWhiteList();
  for (let i = 0; i < ses.length; i++) {
    stopAdblockService(ses[i]);
    await runAdblockService(ses[i]);
  }
  return {list: getUserWhitelist()};
};

export const removeWhitelistDomain = async (
  domain: string,
  ses: Electron.Session[],
): Promise<string[]> => {
  const d = normalizeDomain(domain);
  if (!d || isBuiltinWhite(d)) return getUserWhitelist();
  const idx = whiteList.findIndex((s) => s && s.trim().toLowerCase() === d);
  if (idx < 0) return getUserWhitelist();
  whiteList.splice(idx, 1);
  persistWhiteList();
  for (let i = 0; i < ses.length; i++) {
    stopAdblockService(ses[i]);
    await runAdblockService(ses[i]);
  }
  return getUserWhitelist();
};

// ===== 广告标识规则(userRules.txt)文本编辑 =====
// 元素拾取器"标记广告"写入的规则就保存在这里, 这里把整份文本暴露给设置页直接编辑。
export const getUserRulesText = (): string => {
  const content = readFileAsText(getUserRulesPath());
  if (!content || content === 'empty') return '';
  return content;
};

export const saveUserRulesText = async (
  text: string,
  ses: Electron.Session[],
): Promise<string> => {
  const normalized = (text || '')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();
  writeFileText(getUserRulesPath(), normalized || 'empty');
  // 重新加载用户规则(重建 cosmetic 表)并重启引擎使网络规则生效
  await reloadAllSessions(ses);
  return getUserRulesText();
};

export const getAdLists = () => {
  console.log("getAdLists1");
  const listPath = resolve(getPath('adblock/lists.txt'));
  const list = readFileAsText(listPath);
  let ads = adsLists;
  if (list == "empty") {
    ads = [];
  } else if (list) {
    ads = list.split("\n").filter(it => it && it.trim() != "");
  }
  console.log("getAdLists2", ads);
  return ads;
}
export const updateAdLists = async (lists: string, ses: Electron.Session[]) => {
  const listPath = resolve(getPath('adblock/lists.txt'));
  let ads = adsLists;
  if (lists) {
    ads = lists.split("\n").filter(it => it && it.trim() != "");
  } else {
    ads = [];
  }
  console.log("updateAdLists2", ads);
  let str = ads.join("\n");
  if ("" == str.trim()) {
    str = "empty";
  }
  const exist = readFileAsText(listPath);
  if (str == exist) {
    return false;
  }
  writeFileText(listPath, str);
  const path = resolve(getPath('adblock/cache.bin'));
  //重新下载
  await deletePath(path);
  for (let i = 0; i < ses.length; i++) {
    stopAdblockService(ses[i]);
    await runAdblockService(ses[i]);
  }
  return true;
}
