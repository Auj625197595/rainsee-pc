import {app, BrowserWindow, clipboard, ipcMain, screen, session, shell, WebContents} from 'electron';
import {randomUUID} from 'crypto';
import {createReadStream, existsSync, promises as fs} from 'fs';
import {hostname} from 'os';
import {basename, extname, join} from 'path';
import {Readable} from 'stream';
import {pathToFileURL} from 'url';
import {Application} from '../application';
import {getMainTranslator} from '../i18n';
import {setupMediaDownloader} from '../services/media-downloader';
import {DlnaCommand, DlnaPlaybackReport, dlnaRenderer} from '../services/dlna-renderer';
import {
  createIptvShortcut,
  IPTV_APP_USER_MODEL_ID,
  iptvIconPath,
  loadIptvSource,
  loadIptvStore,
  saveIptvStore,
} from '../services/iptv';

// 智能播放器窗口：屏幕中央独立窗口(点外不消失)，承载本地静态播放器页面。
// 单例：地址栏、超级投屏、本地文件入口都唤起同一个窗口；窗口使用独立的临时 session，
// 避免与浏览器主 session 互相覆盖 Referer/Cookie 等播放请求头。

const WIDTH = 1200;
const HEIGHT = 720;
const PLAYER_PROXY_ROOT = '/.rainsee-media-player/';
const PLAYER_ENTRY_PATH = `${PLAYER_PROXY_ROOT}pages/media-player.html`;
const PLAYER_LOCAL_PREFIX = `${PLAYER_PROXY_ROOT}local/`;

const PLAYER_ASSETS: Record<string, {path: string; contentType: string}> = {
  [PLAYER_ENTRY_PATH]: {
    path: 'pages/media-player.html',
    contentType: 'text/html; charset=utf-8',
  },
  [`${PLAYER_PROXY_ROOT}vendor/hls.min.js`]: {
    path: 'vendor/hls.min.js',
    contentType: 'text/javascript; charset=utf-8',
  },
  [`${PLAYER_PROXY_ROOT}vendor/dplayer.min.js`]: {
    path: 'vendor/dplayer.min.js',
    contentType: 'text/javascript; charset=utf-8',
  },
};

type HeaderRule = {
  host: string;
  headers: Record<string, string>;
};

type MediaPlayerInstance = {
  win: BrowserWindow;
  partition: string;
  headerRules: HeaderRule[];
  subscribedTabId: number;
  // 从文件入口打开过的本地视频，与网页嗅探资源同列。
  localFiles: LocalFile[];
  ownerWindowId: number | null;
  sourceOrigin: string;
  playerPageUrl: string;
  failedSourceOrigin: string;
  handledSchemes: string[];
  // 超级投屏：该窗口是否为 DLNA 接收窗口，以及控制端投来的当前视频。
  castMode: boolean;
  castItem: Record<string, any> | null;
  // 页面当前正在播放的是否为投屏视频(切到网页嗅探资源后恢复原请求头策略)。
  castActive: boolean;
  // 每次投屏只记录前几条改写后的请求，便于在日志里核对请求头。
  castLogCount: number;
  originalUserAgent: string;
  // 页面回报：当前是否正在播放(或投屏会话进行中)及其地址。正在播放时不跟随标签页切换 origin 重载页面，
  // 订阅切到别的标签页后也保留该视频的请求头规则。
  playing: boolean;
  playingUrl: string;
  // 页面加载中不推数据(send 会丢且会吃掉 pendingIntent)，did-finish-load 后统一推。
  loading: boolean;
  pendingIntent: PlayerIntent | null;
  // IPTV 模式：直播不能被页面跟随标签页 origin 重载打断；iptvUserAgent 为当前频道所属订阅要求的 UA。
  iptvMode: boolean;
  iptvUserAgent: string;
};

export type IptvSourceHint = {url: string; name?: string};

// 入口意图，随下一次 media-player-data 下发给页面后清空：
// focus=立即播放该资源(本地文件入口/用户点选别站资源)；autoplay=地址栏主动打开，空闲时播放网页资源；
// cast=超级投屏入口，空闲时显示等待投屏；follow=允许重载页面切到资源所在 origin(会打断当前播放)；
// iptv=切到 IPTV 模式；iptvSource=网页检测到的直播源，带入 IPTV 播放器(可保存)。
type PlayerIntent = {
  focus?: string;
  autoplay?: boolean;
  cast?: boolean;
  follow?: boolean;
  iptv?: boolean;
  iptvSource?: IptvSourceHint;
};

type LocalFile = {id: string; path: string; addedAt: number};

// 播放器单例；castMode 为 true 时即为 DLNA 接收窗口，DLNA 服务生命周期跟随它。
let player: MediaPlayerInstance | null = null;
let castError = '';
let playerSequence = 0;
let registered = false;
// 桌面快捷方式 --iptv 冷启动：进程里只有播放器窗口，关掉即退出。
let iptvStandalone = false;

const createPartition = () =>
  `media-player-${process.pid}-${Date.now()}-${++playerSequence}`;

const getLocalPlayerPath = () =>
  join(app.getAppPath(), 'static/pages/media-player.html');

const getHttpOrigin = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.origin
      : '';
  } catch (e) {
    return '';
  }
};

const buildProxiedPlayerUrl = (origin: string) =>
  new URL(PLAYER_ENTRY_PATH, `${origin}/`).toString();

const getLivePlayer = () =>
  player && !player.win.isDestroyed() ? player : null;

const getCastInstance = () => {
  const instance = getLivePlayer();
  return instance && instance.castMode ? instance : null;
};

const getInstanceBySender = (sender: WebContents) => {
  const instance = getLivePlayer();
  const win = BrowserWindow.fromWebContents(sender);
  return instance && win && win.id === instance.win.id ? instance : null;
};

const revealWindow = (win: BrowserWindow) => {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
};

const resolveOwnerAppWindow = (instance: MediaPlayerInstance) => {
  if (instance.ownerWindowId) {
    const ownerBrowserWindow = BrowserWindow.fromId(instance.ownerWindowId);
    if (ownerBrowserWindow) {
      const owner = Application.instance.windows.fromBrowserWindow(ownerBrowserWindow);
      if (owner) return owner;
    }
  }
  return Application.instance.windows.current || Application.instance.windows.lastFocused;
};

// 投屏地址是控制端按「电视端」场景下发的，CDN 往往按电视/盒子的请求特征放行：
// 带上播放器页面的代理 origin 作 Referer 或桌面 Chrome UA 反而会触发防盗链
// (如 B 站 CDN 拒绝外站 Referer)。因此投屏视频的请求去掉 Referer/Origin，
// UA 换成常见投屏接收端(ijkplayer/ExoPlayer 等基于 FFmpeg 的电视播放器)的 Lavf 标识。
const CAST_RENDERER_USER_AGENT = 'Lavf/58.29.100';
// 与伪装 UA 自相矛盾的 Chromium 特征头一并去掉。
const CAST_STRIPPED_HEADERS = ['referer', 'origin'];
const CAST_STRIPPED_HEADER_PREFIXES = ['sec-ch-ua'];
// m3u8 的切片/密钥常在别的 CDN 域名上，播放投屏视频期间媒体类请求都按投屏处理。
const CAST_RESOURCE_TYPES = ['media', 'xhr', 'other'];

const isCastRequest = (instance: MediaPlayerInstance, host: string, resourceType: string) => {
  if (!instance.castActive || !instance.castItem || !host) return false;
  return instance.castItem.host === host || CAST_RESOURCE_TYPES.includes(resourceType);
};

const toCastRequestHeaders = (headers: Record<string, string>) => {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'user-agent') continue;
    if (CAST_STRIPPED_HEADERS.includes(lower)) continue;
    if (CAST_STRIPPED_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix))) continue;
    cleaned[key] = value;
  }
  cleaned['User-Agent'] = CAST_RENDERER_USER_AGENT;
  return cleaned;
};

// 播放投屏视频期间把播放器窗口自身的 UA 也换成投屏端 UA：页面发出的请求(及 DevTools
// 里看到的请求头)与主进程实际转发的保持一致；切回网页资源时恢复原 UA。
const setCastActive = (instance: MediaPlayerInstance, active: boolean) => {
  if (instance.castActive === active) return;
  instance.castActive = active;
  if (instance.win.isDestroyed()) return;
  const contents = instance.win.webContents;
  if (active) {
    instance.originalUserAgent = instance.originalUserAgent || contents.getUserAgent();
    contents.setUserAgent(CAST_RENDERER_USER_AGENT);
  } else if (instance.originalUserAgent) {
    contents.setUserAgent(instance.originalUserAgent);
  }
};

// 重建 Request：清理请求头并显式 no-referrer，否则 Chromium 会按原 referrer 重新补上 Referer。
const toCastRequest = (instance: MediaPlayerInstance, request: Request) => {
  const original: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    original[key] = value;
  });
  const headers = toCastRequestHeaders(original);
  if (instance.castLogCount < 3) {
    instance.castLogCount += 1;
    console.log('[dlna] cast request', request.url.slice(0, 160), JSON.stringify({
      userAgent: headers['User-Agent'],
      referer: false,
      range: original.range || '',
    }));
  }
  return new Request(request.url, {
    method: request.method,
    headers,
    referrer: '',
    referrerPolicy: 'no-referrer',
    redirect: request.redirect,
    signal: request.signal,
  });
};

// IPTV 订阅(TVBox lives[].ua)要求的播放 UA：只改媒体类请求，页面自身资源不动。
const IPTV_RESOURCE_TYPES = ['media', 'xhr', 'other'];
const isIptvRequest = (instance: MediaPlayerInstance, resourceType: string) =>
  Boolean(instance.iptvMode && instance.iptvUserAgent && IPTV_RESOURCE_TYPES.includes(resourceType));

const withUserAgent = (headers: Record<string, string>, userAgent: string) => {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== 'user-agent') next[key] = value;
  }
  next['User-Agent'] = userAgent;
  return next;
};

const toIptvRequest = (instance: MediaPlayerInstance, request: Request) => {
  const original: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    original[key] = value;
  });
  return new Request(request.url, {
    method: request.method,
    headers: withUserAgent(original, instance.iptvUserAgent),
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    redirect: request.redirect,
    signal: request.signal,
  });
};

// 在播放器 session 上挂请求头注入。对命中 host 的请求合并清理后的嗅探头。
const ensureSessionHook = (instance: MediaPlayerInstance) => {
  const ses = session.fromPartition(instance.partition);
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    try {
      let host = '';
      try {
        host = new URL(details.url).hostname;
      } catch (e) {
      }
      if (isCastRequest(instance, host, details.resourceType)) {
        callback({requestHeaders: toCastRequestHeaders(details.requestHeaders)});
        return;
      }
      if (isIptvRequest(instance, details.resourceType)) {
        callback({requestHeaders: withUserAgent(details.requestHeaders, instance.iptvUserAgent)});
        return;
      }
      const rule = instance.headerRules.find((r) => r.host && host && r.host === host);
      if (rule) {
        const merged = {...details.requestHeaders};
        for (const key of Object.keys(rule.headers)) {
          merged[key] = rule.headers[key];
        }
        callback({requestHeaders: merged});
        return;
      }
    } catch (e) {
    }
    callback({requestHeaders: details.requestHeaders});
  });
};

// 部分视频 CDN(如 v-1.ozone.ru)会间歇性在握手/首包阶段断开连接。Chromium 原生
// 媒体请求失败后由页面自行重试，但经 protocol.handle 转发的 ses.fetch 一旦抛错，
// <video> 只会收到 MEDIA_ERR_SRC_NOT_SUPPORTED("Format error") 并停在黑屏。
// 对无请求体的幂等请求在瞬时网络错误上重试几次。
const RETRYABLE_NET_ERRORS = [
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_ABORTED',
  'ERR_CONNECTION_FAILED',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_TIMED_OUT',
  'ERR_EMPTY_RESPONSE',
  'ERR_SOCKET_NOT_CONNECTED',
  'ERR_NETWORK_CHANGED',
  'ERR_SSL_PROTOCOL_ERROR',
  'ERR_HTTP2_PROTOCOL_ERROR',
  'ERR_HTTP2_PING_FAILED',
  'ERR_QUIC_PROTOCOL_ERROR',
];
const FETCH_RETRY_DELAYS_MS = [300, 1000];

const isRetryableNetError = (e: any) => {
  const message = String((e && e.message) || e || '');
  return RETRYABLE_NET_ERRORS.some((code) => message.includes(code));
};

const fetchWithRetry = async (ses: Electron.Session, request: Request): Promise<Response> => {
  const idempotent = request.method === 'GET' || request.method === 'HEAD';
  for (let attempt = 0; ; attempt++) {
    const canRetry = idempotent && attempt < FETCH_RETRY_DELAYS_MS.length;
    try {
      // clone 保留一份未消费的 Request 供下次重试使用。
      return await ses.fetch(canRetry ? request.clone() : request, {bypassCustomProtocolHandlers: true});
    } catch (e) {
      if (!canRetry || request.signal?.aborted || !isRetryableNetError(e)) throw e;
      console.log('[media-player] fetch retry', attempt + 1, request.url.slice(0, 120), String((e as any)?.message || e));
      await new Promise((resolve) => setTimeout(resolve, FETCH_RETRY_DELAYS_MS[attempt]));
      if (request.signal?.aborted) throw e;
    }
  }
};

// 把播放器静态页面挂到当前网页的 HTTP(S) origin 下。专用路径返回本地文件，
// 其余请求绕过自定义处理器后继续走 Chromium 网络栈。
const installSourceOriginProxy = (instance: MediaPlayerInstance) => {
  const ses = session.fromPartition(instance.partition);
  const handler = async (request: Request): Promise<Response> => {
    let requestUrl: URL | null = null;
    try {
      requestUrl = new URL(request.url);
    } catch (e) {
    }

    const asset = requestUrl && requestUrl.origin === instance.sourceOrigin
      ? PLAYER_ASSETS[requestUrl.pathname]
      : undefined;
    // 单例窗口通常停在网页 origin 下(file:// 子资源会被拦)，本地文件经专用路径读盘返回。
    // 只认已登记的随机 id，不接受任意路径。
    if (requestUrl && requestUrl.origin === instance.sourceOrigin
      && requestUrl.pathname.startsWith(PLAYER_LOCAL_PREFIX)) {
      const id = requestUrl.pathname.slice(PLAYER_LOCAL_PREFIX.length).split('/')[0];
      const file = instance.localFiles.find((f) => f.id === id);
      if (!file) return new Response('Not Found', {status: 404});
      return serveLocalFile(file, request);
    }

    if (asset) {
      try {
        const data = await fs.readFile(join(app.getAppPath(), 'static', asset.path));
        return new Response(data as any, {
          status: 200,
          headers: {
            'Content-Type': asset.contentType,
            'Cache-Control': 'no-store',
          },
        });
      } catch (e) {
        console.log('[media-player] failed to read proxied asset', asset.path, e);
        return new Response('Not Found', {status: 404});
      }
    }

    // 投屏视频的请求在这里改写：经 protocol.handle 转发的 ses.fetch 会把原 Request 的
    // referrer 与 User-Agent 原样带出，webRequest 层改不到真正发出的请求头。
    if (instance.castActive && instance.castItem && (request.method === 'GET' || request.method === 'HEAD')) {
      return fetchWithRetry(ses, toCastRequest(instance, request));
    }

    if (instance.iptvMode && instance.iptvUserAgent && (request.method === 'GET' || request.method === 'HEAD')) {
      return fetchWithRetry(ses, toIptvRequest(instance, request));
    }

    return fetchWithRetry(ses, request);
  };

  for (const scheme of ['http', 'https']) {
    ses.protocol.handle(scheme, handler);
    instance.handledSchemes.push(scheme);
  }
};

const uninstallSourceOriginProxy = (instance: MediaPlayerInstance) => {
  const ses = session.fromPartition(instance.partition);
  for (const scheme of instance.handledSchemes) {
    try {
      ses.protocol.unhandle(scheme);
    } catch (e) {
    }
  }
  instance.handledSchemes = [];
};

// 页面重载会丢掉页面内的播放状态。
const markPageLoading = (instance: MediaPlayerInstance) => {
  instance.loading = true;
  instance.playing = false;
  instance.playingUrl = '';
  // 页面加载完成后会按自身模式重新回报。
  instance.iptvMode = false;
  instance.iptvUserAgent = '';
};

const loadLocalPlayerPage = (
  instance: MediaPlayerInstance,
  failedSourceOrigin: string = '',
) => {
  const localPath = getLocalPlayerPath();
  markPageLoading(instance);
  instance.sourceOrigin = '';
  instance.failedSourceOrigin = failedSourceOrigin;
  instance.playerPageUrl = pathToFileURL(localPath).toString();
  return instance.win.loadFile(localPath);
};

// 返回 true 表示已触发一次页面加载，调用方应等待 did-finish-load 后再推数据。
const ensurePlayerPage = (instance: MediaPlayerInstance, pageUrl: string): boolean => {
  const sourceOrigin = getHttpOrigin(pageUrl);
  if (sourceOrigin && sourceOrigin !== instance.failedSourceOrigin) {
    const playerPageUrl = buildProxiedPlayerUrl(sourceOrigin);
    if (instance.playerPageUrl === playerPageUrl) return false;

    markPageLoading(instance);
    instance.sourceOrigin = sourceOrigin;
    instance.failedSourceOrigin = '';
    instance.playerPageUrl = playerPageUrl;
    instance.win.loadURL(playerPageUrl).catch((e) => {
      if (instance.win.isDestroyed() || instance.playerPageUrl !== playerPageUrl) return;
      console.log('[media-player] source-origin page failed, falling back to file', e);
      loadLocalPlayerPage(instance, sourceOrigin).catch(() => undefined);
    });
    return true;
  }

  const localPageUrl = pathToFileURL(getLocalPlayerPath()).toString();
  if (instance.playerPageUrl === localPageUrl) return false;
  loadLocalPlayerPage(instance).catch(() => undefined);
  return true;
};

const isAllowedPlayerNavigation = (instance: MediaPlayerInstance, url: string) => {
  try {
    const expected = new URL(instance.playerPageUrl);
    const candidate = new URL(url);
    return candidate.protocol === expected.protocol
      && candidate.host === expected.host
      && candidate.pathname === expected.pathname
      && candidate.search === expected.search;
  } catch (e) {
    return false;
  }
};

const subscribeTab = (instance: MediaPlayerInstance, appWindow: any) => {
  const view = appWindow?.viewManager?.selected;
  instance.subscribedTabId = view ? view.id : -1;
};

const hasHeader = (headers: Record<string, string>, name: string) =>
  Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());

// 解析播放器当前订阅的 view(优先按 subscribedTabId 跨窗口查找，回退到所属窗口当前选中)。
const resolveView = (instance: MediaPlayerInstance) => {
  const wins = Application.instance.windows;
  if (instance.subscribedTabId !== -1) {
    for (const w of wins.list) {
      const v = w?.viewManager?.views?.get(instance.subscribedTabId);
      if (v) return v;
    }
  }
  const appWindow = resolveOwnerAppWindow(instance);
  return appWindow?.viewManager?.selected;
};

const LOCAL_CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  ts: 'video/mp2t',
};
const MAX_LOCAL_FILES = 20;

const localExt = (path: string) => extname(path).slice(1).toLowerCase();

// 本地文件按 Range 分段返回，<video> 才能拖动进度。
const serveLocalFile = async (file: LocalFile, request: Request): Promise<Response> => {
  let size = 0;
  try {
    size = (await fs.stat(file.path)).size;
  } catch (e) {
    return new Response('Not Found', {status: 404});
  }
  let start = 0;
  let end = size - 1;
  let status = 200;
  const match = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get('range') || '').trim());
  if (match && (match[1] || match[2])) {
    if (match[1]) {
      start = Number(match[1]);
      if (match[2]) end = Math.min(Number(match[2]), size - 1);
    } else {
      start = Math.max(0, size - Number(match[2]));
    }
    if (start >= size || start > end) {
      return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${size}`}});
    }
    status = 206;
  }
  const headers: Record<string, string> = {
    'Content-Type': LOCAL_CONTENT_TYPES[localExt(file.path)] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(Math.max(0, end - start + 1)),
    'Cache-Control': 'no-store',
  };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  if (request.method === 'HEAD' || size === 0) return new Response(null, {status, headers});
  const stream = createReadStream(file.path, {start, end});
  request.signal?.addEventListener('abort', () => stream.destroy());
  // 项目的 @types/node 早于 Readable.toWeb，运行时(Electron 内置 Node)可用。
  return new Response((Readable as any).toWeb(stream), {status, headers});
};

const addLocalFile = (instance: MediaPlayerInstance, path: string) => {
  const existing = instance.localFiles.find((f) => f.path === path);
  if (existing) return existing;
  const file: LocalFile = {id: randomUUID(), path, addedAt: Date.now()};
  instance.localFiles.push(file);
  while (instance.localFiles.length > MAX_LOCAL_FILES) instance.localFiles.shift();
  return file;
};

const localItemKey = (file: LocalFile) => `local:${file.id}`;

// 页面停在网页 origin 下时走代理路径(file:// 会被拦)，停在本地页面时直接用 file URL。
const buildLocalItems = (instance: MediaPlayerInstance) => {
  const label = getMainTranslator(Application.instance.settings?.object?.language)('mpLocalFile');
  return instance.localFiles.map((file) => {
    const ext = localExt(file.path);
    const name = basename(file.path);
    return {
      id: localItemKey(file),
      url: instance.sourceOrigin
        ? `${instance.sourceOrigin}${PLAYER_LOCAL_PREFIX}${file.id}/${encodeURIComponent(name)}`
        : pathToFileURL(file.path).toString(),
      host: label,
      contentType: LOCAL_CONTENT_TYPES[ext] || 'video/*',
      mediaType: ext || 'video',
      addedAt: file.addedAt,
      local: true,
      name,
    };
  });
};

// 某个网页 URL 对应的播放器页面 origin(与 ensurePlayerPage 的选择一致；'' 表示本地页面)。
const targetPlayerOrigin = (instance: MediaPlayerInstance, pageUrl: string) => {
  const origin = getHttpOrigin(pageUrl);
  return origin && origin !== instance.failedSourceOrigin ? origin : '';
};

// 把当前 tab 的资源列表与各自的请求头同步给播放器页面 + 注入规则。
const pushVideoData = (instance: MediaPlayerInstance, appWindow?: any) => {
  if (!instance.win || instance.win.isDestroyed()) return;
  if (instance.loading) return;

  const intent = instance.pendingIntent;
  const send = (payload: Record<string, any>) => {
    instance.pendingIntent = null;
    instance.win.webContents.send('media-player-data', {
      ...payload,
      castMode: instance.castMode,
      playerOrigin: instance.sourceOrigin,
      intent,
    });
  };

  const castItems = instance.castItem ? [instance.castItem] : [];
  const view = resolveView(instance) || appWindow?.viewManager?.selected;
  if (!view) {
    send({items: [...castItems, ...buildLocalItems(instance)], pageUrl: '', title: ''});
    return;
  }

  // 同一 tab 导航到另一站后，播放器也切换到新页面的 origin(防盗链 Referer 才对得上)。
  // 正在播放时不跟随，否则标签页一跳转正在播的视频就被重载打断；用户显式要求时(地址栏换了标签页、
  // 点了别站资源)才强制切换。重载后 pendingIntent 保留到 did-finish-load 再下发。
  // IPTV 模式下页面不跟随标签页 origin 重载(会掐断直播)。
  const busy = instance.playing || instance.castActive || instance.iptvMode;
  if ((intent?.follow || !busy) && ensurePlayerPage(instance, view.url)) return;

  const playerOrigin = targetPlayerOrigin(instance, view.url);
  const sniffed = view.getVideoItems().map((item: any) => ({...item, playerOrigin}));
  const items: any[] = [...castItems, ...buildLocalItems(instance), ...sniffed];

  const rules: HeaderRule[] = [];
  for (const item of items) {
    if (item.cast || item.local) continue;
    const headers = view.getPlaybackHeaders(item.url);
    // The response metadata always carries the page referrer, while the
    // request-header cache can be empty when a request was observed before
    // the session hook was installed. Preserve that anti-hotlink signal as a
    // fallback for both player playback and main-process downloads.
    if (!hasHeader(headers, 'Referer') && item.referrer) {
      headers.Referer = item.referrer;
    }
    if (!hasHeader(headers, 'Origin') && item.referrer) {
      try {
        headers.Origin = new URL(item.referrer).origin;
      } catch (e) {
      }
    }
    let host = '';
    try {
      host = new URL(item.url).hostname;
    } catch (e) {
    }
    if (host && Object.keys(headers).length) {
      rules.push({host, headers});
    }
    // @ts-ignore 把清理后的头一并交给页面(下载时回传)
    item.playbackHeaders = headers;
  }
  // 正在播放时标签页可能已跳走(嗅探列表被清空)，保留正在播的视频所在 host 的旧规则，
  // 否则 m3u8 后续切片会丢 Referer 被防盗链拒绝。
  if (instance.playing && instance.playingUrl) {
    let playingHost = '';
    try {
      playingHost = new URL(instance.playingUrl).hostname;
    } catch (e) {
    }
    const previous = instance.headerRules.find((r) => r.host === playingHost);
    if (previous && !rules.some((r) => r.host === playingHost)) rules.push(previous);
  }
  instance.headerRules = rules;

  send({
    items,
    pageUrl: view.url,
    title: view.webContents.getTitle?.() || '',
  });
};

// ---------- 超级投屏(DLNA 接收) ----------

const getCastFriendlyName = () => {
  let host = 'PC';
  try {
    host = hostname() || host;
  } catch (e) {
  }
  return getMainTranslator(Application.instance.settings?.object?.language)('dlnaFriendlyName', {host});
};

const sendCastStatus = (instance: MediaPlayerInstance | null = getLivePlayer()) => {
  if (!instance || instance.win.isDestroyed()) return;
  const info = dlnaRenderer.getInfo();
  instance.win.webContents.send('media-player-cast-status', {
    enabled: info.running && instance.castMode,
    name: info.name || getCastFriendlyName(),
    addresses: info.addresses,
    error: castError,
  });
};

const startCast = async (instance: MediaPlayerInstance) => {
  castError = '';
  try {
    await dlnaRenderer.start(getCastFriendlyName());
  } catch (e) {
    castError = String((e as any)?.message || e);
    console.log('[dlna] start failed', castError);
  }
  sendCastStatus(instance);
  return dlnaRenderer.isRunning();
};

const stopCast = async (instance: MediaPlayerInstance | null) => {
  castError = '';
  await dlnaRenderer.stop().catch((e) => console.log('[dlna] stop failed', e));
  sendCastStatus(instance);
};

// 进入投屏模式：DLNA 接收跟随单例窗口开启。
const enterCastMode = (instance: MediaPlayerInstance) => {
  instance.castMode = true;
  if (!dlnaRenderer.isRunning()) return startCast(instance);
  sendCastStatus(instance);
  return Promise.resolve(true);
};

// 退出投屏模式：停 DLNA，窗口退回普通播放器(已收到的投屏视频仍留在列表里)。
const exitCastMode = (instance: MediaPlayerInstance) => {
  instance.castMode = false;
  return stopCast(instance);
};

const castMediaType = (url: string, mimeType: string) => {
  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('mpegurl')) return 'hls';
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.m3u8')) return 'hls';
  const ext = path.match(/\.([a-z0-9]{2,5})$/);
  if (ext) return ext[1];
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return mime.split('/')[1].replace(/^x-/, '');
  return 'video';
};

const handleCastCommand = (command: DlnaCommand) => {
  const instance = getCastInstance();
  if (!instance) return;
  if (command.type === 'load') {
    let host = '';
    try {
      host = new URL(command.url).hostname;
    } catch (e) {
    }
    instance.castItem = {
      url: command.url,
      host,
      name: command.title || '',
      mediaType: castMediaType(command.url, command.mimeType),
      contentType: command.mimeType || '',
      addedAt: Date.now(),
      cast: true,
      // 下载投屏视频时沿用同一套请求头(无 Referer + 投屏端 UA)。
      playbackHeaders: {'User-Agent': CAST_RENDERER_USER_AGENT},
    };
    // 先置位再通知页面，保证首个媒体请求就走投屏请求头。
    setCastActive(instance, true);
    instance.castLogCount = 0;
    revealWindow(instance.win);
    instance.win.webContents.send('media-player-cast-command', {...command, item: instance.castItem});
    return;
  }
  instance.win.webContents.send('media-player-cast-command', command);
};

// 新建单例窗口(只在没有存活实例时调用)。parent 为空(IPTV 快捷方式冷启动，无浏览器窗口)时居中于主屏。
const createPlayer = (parent: BrowserWindow | null, appWindow: any): MediaPlayerInstance => {
  const partition = createPartition();
  const playerWindow = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    // 不设 parent：让播放器在任务栏中作为独立项目，可单独最小化/切换。
    show: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    skipTaskbar: false,
    title: getMainTranslator(Application.instance.settings?.object?.language)('mpWindowTitle'),
    backgroundColor: '#0B1020',
    webPreferences: {
      partition,
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });

  const instance: MediaPlayerInstance = {
    win: playerWindow,
    partition,
    headerRules: [],
    subscribedTabId: -1,
    localFiles: [],
    ownerWindowId: parent?.id || null,
    sourceOrigin: '',
    playerPageUrl: '',
    failedSourceOrigin: '',
    handledSchemes: [],
    castMode: false,
    castItem: null,
    castActive: false,
    castLogCount: 0,
    originalUserAgent: '',
    playing: false,
    playingUrl: '',
    loading: false,
    pendingIntent: null,
    iptvMode: false,
    iptvUserAgent: '',
  };

  player = instance;
  ensureSessionHook(instance);
  installSourceOriginProxy(instance);
  require('@electron/remote/main').enable(playerWindow.webContents);

  // 居中于父窗口(没有父窗口时居中于主屏工作区)
  const pb = parent && !parent.isDestroyed() ? parent.getBounds() : screen.getPrimaryDisplay().workArea;
  playerWindow.setBounds({
    x: Math.floor(pb.x + (pb.width - WIDTH) / 2),
    y: Math.floor(pb.y + (pb.height - HEIGHT) / 2),
    width: WIDTH,
    height: HEIGHT,
  });

  // 外链交给系统浏览器
  playerWindow.webContents.setWindowOpenHandler((details) => {
    if (details.url && details.url.startsWith('http')) {
      shell.openExternal(details.url).catch(() => undefined);
    }
    return {action: 'deny'};
  });

  // 此窗口启用了 Node，只允许主框架停留在本地播放器对应的虚拟 URL。
  playerWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedPlayerNavigation(instance, url)) event.preventDefault();
  });
  playerWindow.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedPlayerNavigation(instance, url)) event.preventDefault();
  });

  // 快捷方式启动的 IPTV 窗口与 .lnk 共用 AUMID，任务栏按钮归到快捷方式名下。
  if (iptvStandalone && process.platform === 'win32') {
    try {
      const icon = iptvIconPath();
      playerWindow.setAppDetails({
        appId: IPTV_APP_USER_MODEL_ID,
        appIconPath: existsSync(icon) ? icon : undefined,
        appIconIndex: existsSync(icon) ? 0 : undefined,
      });
    } catch (e) {
      console.log('[iptv] setAppDetails failed', e);
    }
  }

  playerWindow.once('ready-to-show', () => {
    playerWindow.show();
  });

  playerWindow.webContents.on('did-finish-load', () => {
    instance.loading = false;
    pushVideoData(instance, appWindow);
    sendCastStatus(instance);
  });
  // 加载失败(非被新加载顶替的 ERR_ABORTED)时解除加载门控，避免之后的数据全被吞掉。
  playerWindow.webContents.on('did-fail-load', (_e, errorCode, _desc, _url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) instance.loading = false;
  });

  // 窗口级全屏状态同步到页面，支持按钮、Esc 和系统快捷键退出。
  playerWindow.on('enter-full-screen', () => {
    if (!playerWindow.isDestroyed()) playerWindow.webContents.send('media-player-fullscreen-state', true);
  });
  playerWindow.on('leave-full-screen', () => {
    if (!playerWindow.isDestroyed()) playerWindow.webContents.send('media-player-fullscreen-state', false);
  });

  playerWindow.on('closed', () => {
    if (player === instance) player = null;
    // 快捷方式冷启动的独立 IPTV 进程：没有浏览器窗口时随播放器退出。
    if (iptvStandalone && !Application.instance.windows.list.some((w) => w && !w.win.isDestroyed())) {
      setImmediate(() => app.quit());
    }
    if (instance.castMode) stopCast(null).catch(() => undefined);
    instance.castMode = false;
    instance.castItem = null;
    instance.castActive = false;
    instance.originalUserAgent = '';
    uninstallSourceOriginProxy(instance);
    instance.headerRules = [];
    instance.subscribedTabId = -1;
    instance.localFiles = [];
    instance.sourceOrigin = '';
    instance.playerPageUrl = '';
    instance.failedSourceOrigin = '';
    instance.pendingIntent = null;
  });

  return instance;
};

type OpenOptions = {
  // 本地文件入口：把文件加入列表并立即播放。
  filePath?: string;
  // 超级投屏入口：进入投屏模式。
  cast?: boolean;
  // IPTV 入口(快捷菜单/桌面快捷方式/地址栏检测)：切到 IPTV 模式，可带入检测到的直播源。
  iptv?: boolean;
  iptvSource?: IptvSourceHint;
};

// 所有入口的统一实现：有实例则唤起并按入口更新状态，没有才新建。
const openPlayer = (parent: BrowserWindow | null, options: OpenOptions) => {
  setupMediaDownloader();

  const appWindow = (parent && Application.instance.windows.fromBrowserWindow(parent))
    || Application.instance.windows.current;
  const owner = parent || appWindow?.win || null;
  const existing = getLivePlayer();
  const instance = existing || createPlayer(owner, appWindow);
  const selected = appWindow?.viewManager?.selected;

  if (options.iptv) {
    // 先置位：随后的 pushVideoData 不会因跟随标签页 origin 重载页面而延后切换。
    if (existing && !existing.loading) instance.iptvMode = true;
    instance.pendingIntent = {iptv: true, iptvSource: options.iptvSource};
    if (!existing && appWindow) subscribeTab(instance, appWindow);
  } else if (options.filePath) {
    const file = addLocalFile(instance, options.filePath);
    instance.pendingIntent = {focus: localItemKey(file)};
    if (!existing) subscribeTab(instance, appWindow);
    try {
      selected?.pausePageVideos();
    } catch (e) {
    }
  } else if (options.cast) {
    instance.pendingIntent = {cast: true};
    if (!existing) subscribeTab(instance, appWindow);
    enterCastMode(instance).catch(() => undefined);
  } else {
    // 地址栏入口：用户点的是当前标签页的播放器图标，订阅它。换了标签页属于显式选择，
    // 允许打断正在播放的视频；同一标签页再点只唤起窗口，不打断播放。
    const tabChanged = Boolean(existing && selected && selected.id !== instance.subscribedTabId);
    subscribeTab(instance, appWindow);
    instance.ownerWindowId = parent?.id || instance.ownerWindowId;
    instance.pendingIntent = {autoplay: true, follow: tabChanged};
    // 打开播放器即暂停原网页里正在播放的视频，避免双重发声(投屏/本地文件入口不接管网页视频)
    try {
      selected?.pausePageVideos();
    } catch (e) {
    }
  }

  if (!existing) {
    const initialView = resolveView(instance) || selected;
    ensurePlayerPage(instance, initialView?.url || '');
    return;
  }

  revealWindow(instance.win);
  pushVideoData(instance, appWindow);
};

// 快捷菜单「超级投屏」入口：唤起单例并进入投屏模式。
export const showCastReceiver = (parent: BrowserWindow) => {
  openPlayer(parent, {cast: true});
};

// 地址栏图标 / 本地文件「用播放器打开」入口。
export const showMediaPlayer = (parent: BrowserWindow, filePath?: string) => {
  openPlayer(parent, {filePath});
};

// IPTV 播放器入口：快捷菜单、地址栏「检测到可播放链接」、桌面快捷方式(--iptv)。
// 返回播放器窗口，冷启动时调用方据其 dom-ready 推进延迟启动流程。
export const showIptvPlayer = (parent?: BrowserWindow | null, source?: IptvSourceHint) => {
  openPlayer(parent || null, {iptv: true, iptvSource: source});
  return getLivePlayer()?.win || null;
};

// 桌面快捷方式冷启动：进程内没有浏览器窗口，关闭播放器即退出。
export const markIptvStandalone = () => {
  iptvStandalone = true;
};

// 应用启动时注册一次：播放器页面的 IPC(关闭/外部播放/复制/请求最新数据)。
export const setupMediaPlayer = () => {
  if (registered) return;
  registered = true;
  setupMediaDownloader();

  // 页面主动请求刷新数据
  ipcMain.on('media-player-request-data', (e) => {
    const instance = getInstanceBySender(e.sender);
    if (!instance) return;
    pushVideoData(instance);
  });

  // 页面回报播放状态：决定嗅探刷新时能否重载页面、是否保留正在播视频的请求头规则。
  ipcMain.on('media-player-playing', (e, state: {playing?: boolean; url?: string}) => {
    const instance = getInstanceBySender(e.sender);
    if (!instance) return;
    instance.playing = Boolean(state && state.playing);
    instance.playingUrl = instance.playing ? String(state.url || '') : '';
  });

  // 用户点选的资源属于另一个 origin(页面因正在播放没跟随标签页切换)：重载到该 origin 后再播放。
  ipcMain.on('media-player-play-request', (e, url: string) => {
    const instance = getInstanceBySender(e.sender);
    if (!instance || !url) return;
    instance.pendingIntent = {focus: String(url), follow: true};
    pushVideoData(instance);
  });

  // 关闭当前播放器窗口
  ipcMain.on('media-player-close', (e) => {
    const instance = getInstanceBySender(e.sender);
    if (instance && !instance.win.isDestroyed()) instance.win.close();
  });

  // 最小化当前播放器窗口(独立任务栏项)
  ipcMain.on('media-player-minimize', (e) => {
    const instance = getInstanceBySender(e.sender);
    if (instance && !instance.win.isDestroyed()) instance.win.minimize();
  });

  // 切换最大化状态，供无边框标题栏使用。
  ipcMain.on('media-player-toggle-maximize', (e) => {
    const instance = getInstanceBySender(e.sender);
    if (!instance || instance.win.isDestroyed()) return;
    if (instance.win.isMaximized()) instance.win.unmaximize();
    else instance.win.maximize();
  });

  // “网页全屏”同时切换视频和播放器窗口，视频、资源栏和标题栏同步进入全屏。
  ipcMain.on('media-player-toggle-fullscreen', (e) => {
    const instance = getInstanceBySender(e.sender);
    if (!instance || instance.win.isDestroyed()) return;
    instance.win.setFullScreen(!instance.win.isFullScreen());
  });

  // 超级投屏：控制端命令转给投屏窗口
  dlnaRenderer.on('command', handleCastCommand);

  // 播放器页面手动开关投屏模式(DLNA 接收)。
  ipcMain.handle('media-player-cast-toggle', async (e, enabled: boolean) => {
    const instance = getInstanceBySender(e.sender);
    if (!instance) return {enabled: false, error: ''};
    if (enabled) await enterCastMode(instance);
    else await exitCastMode(instance);
    return {enabled: dlnaRenderer.isRunning() && instance.castMode, error: castError};
  });

  // 页面切换播放项时告知当前是否在播投屏视频，决定媒体请求用哪套请求头
  ipcMain.on('media-player-cast-active', (e, active: boolean) => {
    const instance = getInstanceBySender(e.sender);
    if (instance) setCastActive(instance, Boolean(active) && Boolean(instance.castItem));
    e.returnValue = Boolean(instance?.castActive);
  });

  // 页面回报播放状态(进度/时长/音量/状态)，供控制端查询与事件推送
  ipcMain.on('media-player-cast-state', (e, report: DlnaPlaybackReport) => {
    const instance = getInstanceBySender(e.sender);
    if (!instance || !instance.castMode) return;
    dlnaRenderer.updatePlayback(report);
  });

  ipcMain.on('media-player-cast-request-status', (e) => {
    const instance = getInstanceBySender(e.sender);
    if (instance) sendCastStatus(instance);
  });

  // 退出时发 ssdp:byebye，让控制端及时移除设备
  app.on('will-quit', () => {
    if (dlnaRenderer.isRunning()) dlnaRenderer.stop().catch(() => undefined);
  });

  // ---------- IPTV ----------
  // 页面切换智能播放器/IPTV 模式。
  ipcMain.on('media-player-mode', (e, state: {iptv?: boolean}) => {
    const instance = getInstanceBySender(e.sender);
    if (!instance) return;
    instance.iptvMode = Boolean(state && state.iptv);
    if (!instance.iptvMode) instance.iptvUserAgent = '';
  });

  // 播放频道前同步设置该订阅要求的 UA(sendSync：首个媒体请求即生效)。
  ipcMain.on('media-player-iptv-ua', (e, ua: string) => {
    const instance = getInstanceBySender(e.sender);
    if (instance) instance.iptvUserAgent = typeof ua === 'string' ? ua.slice(0, 300) : '';
    e.returnValue = true;
  });

  ipcMain.handle('iptv-load', async (e, payload: {url?: string; force?: boolean}) => {
    if (!getInstanceBySender(e.sender)) return {ok: false, message: 'forbidden'};
    return loadIptvSource(String(payload?.url || ''), Boolean(payload?.force));
  });

  ipcMain.handle('iptv-sources-get', (e) => {
    if (!getInstanceBySender(e.sender)) return null;
    return loadIptvStore();
  });

  ipcMain.handle('iptv-sources-save', (e, store: any) => {
    if (!getInstanceBySender(e.sender)) return null;
    try {
      return saveIptvStore(store);
    } catch (error) {
      console.log('[iptv] save sources failed', error);
      return null;
    }
  });

  ipcMain.handle('iptv-create-shortcut', (e, payload: {icon?: string}) => {
    if (!getInstanceBySender(e.sender)) return {ok: false, message: 'forbidden'};
    const name = getMainTranslator(Application.instance.settings?.object?.language)('mpIptvShortcutName');
    return createIptvShortcut(name, typeof payload?.icon === 'string' ? payload.icon : undefined);
  });

  // 复制到剪贴板
  ipcMain.on('media-player-copy', (_e, text: string) => {
    clipboard.writeText(text || '');
  });

  // 外部播放器(PotPlayer)：复用 view 已注册的 show-other-video-dialog 流程。
  // 该频道回调不读取事件参数，靠闭包里的 view，因此可用 ipcMain.emit 直接触发。
  ipcMain.on('media-player-external', (e) => {
    const instance = getInstanceBySender(e.sender);
    if (!instance) return;
    const view = resolveView(instance);
    if (view) {
      ipcMain.emit(`show-other-video-dialog-${view.id}`, {sender: view.webContents});
    }
  });
};

// 供 view 在嗅探到新资源时调用，实时刷新播放器列表(订阅的是该 tab 时)。
// 是否替换正在播放的视频由页面按播放状态决定。
export const refreshMediaPlayer = (tabId: number) => {
  const instance = getLivePlayer();
  if (!instance) return;
  if (instance.subscribedTabId !== -1 && instance.subscribedTabId !== tabId) return;
  pushVideoData(instance);
};
