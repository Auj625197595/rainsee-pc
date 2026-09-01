import {app, BrowserWindow, clipboard, ipcMain, session, shell, WebContents} from 'electron';
import {promises as fs} from 'fs';
import {basename, extname, join} from 'path';
import {pathToFileURL} from 'url';
import {Application} from '../application';
import {getMainTranslator} from '../i18n';
import {setupMediaDownloader} from '../services/media-downloader';

// 智能播放器窗口：屏幕中央独立窗口(点外不消失)，承载本地静态播放器页面。
// 每个窗口使用独立的临时 session，避免多开时互相覆盖 Referer/Cookie 等播放请求头。

const WIDTH = 1200;
const HEIGHT = 720;
const PLAYER_PROXY_ROOT = '/.rainsee-media-player/';
const PLAYER_ENTRY_PATH = `${PLAYER_PROXY_ROOT}pages/media-player.html`;

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
  localVideoPath: string;
  ownerWindowId: number | null;
  sourceOrigin: string;
  playerPageUrl: string;
  failedSourceOrigin: string;
  handledSchemes: string[];
};

const playerInstances = new Map<number, MediaPlayerInstance>();
let playerSequence = 0;
let registered = false;

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

const getInstanceByWindow = (win: BrowserWindow | null) => {
  if (!win) return null;
  return playerInstances.get(win.id) || null;
};

const getInstanceBySender = (sender: WebContents) =>
  getInstanceByWindow(BrowserWindow.fromWebContents(sender));

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

    return ses.fetch(request, {bypassCustomProtocolHandlers: true});
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

const loadLocalPlayerPage = (
  instance: MediaPlayerInstance,
  failedSourceOrigin: string = '',
) => {
  const localPath = getLocalPlayerPath();
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

// 把当前 tab 的资源列表与各自的请求头同步给播放器页面 + 注入规则。
const pushVideoData = (instance: MediaPlayerInstance, appWindow?: any) => {
  if (!instance.win || instance.win.isDestroyed()) return;

  if (instance.localVideoPath) {
    const ext = extname(instance.localVideoPath).slice(1).toLowerCase();
    const contentTypes: Record<string, string> = {
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
    instance.win.webContents.send('media-player-data', {
      items: [{
        url: pathToFileURL(instance.localVideoPath).toString(),
        host: getMainTranslator(Application.instance.settings?.object?.language)('mpLocalFile'),
        contentType: contentTypes[ext] || 'video/*',
        mediaType: ext || 'video',
        addedAt: Date.now(),
        local: true,
        name: basename(instance.localVideoPath),
      }],
      pageUrl: pathToFileURL(instance.localVideoPath).toString(),
      title: basename(instance.localVideoPath),
      local: true,
    });
    return;
  }

  const view = resolveView(instance) || appWindow?.viewManager?.selected;
  if (!view) return;

  // 同一 tab 导航到另一站后，播放器也切换到新页面的 origin。
  if (ensurePlayerPage(instance, view.url)) return;

  const items = view.getVideoItems();

  const rules: HeaderRule[] = [];
  for (const item of items) {
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
  instance.headerRules = rules;

  instance.win.webContents.send('media-player-data', {
    items,
    pageUrl: view.url,
    title: view.webContents.getTitle?.() || '',
  });
};

export const showMediaPlayer = (parent: BrowserWindow, filePath?: string) => {
  setupMediaDownloader();

  const appWindow = Application.instance.windows.fromBrowserWindow(parent)
    || Application.instance.windows.current;
  const partition = createPartition();

  // 打开播放器即暂停原网页里正在播放的视频，避免双重发声
  try {
    appWindow?.viewManager?.selected?.pausePageVideos();
  } catch (e) {
  }

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
    localVideoPath: filePath || '',
    ownerWindowId: parent?.id || null,
    sourceOrigin: '',
    playerPageUrl: '',
    failedSourceOrigin: '',
    handledSchemes: [],
  };

  playerInstances.set(playerWindow.id, instance);
  ensureSessionHook(instance);
  installSourceOriginProxy(instance);
  require('@electron/remote/main').enable(playerWindow.webContents);

  // 居中于父窗口
  const pb = parent.getBounds();
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

  if (instance.localVideoPath) {
    instance.subscribedTabId = -1;
  } else {
    subscribeTab(instance, appWindow);
  }

  playerWindow.once('ready-to-show', () => {
    playerWindow.show();
  });

  playerWindow.webContents.on('did-finish-load', () => {
    pushVideoData(instance, appWindow);
  });

  // 窗口级全屏状态同步到页面，支持按钮、Esc 和系统快捷键退出。
  playerWindow.on('enter-full-screen', () => {
    if (!playerWindow.isDestroyed()) playerWindow.webContents.send('media-player-fullscreen-state', true);
  });
  playerWindow.on('leave-full-screen', () => {
    if (!playerWindow.isDestroyed()) playerWindow.webContents.send('media-player-fullscreen-state', false);
  });

  playerWindow.on('closed', () => {
    playerInstances.delete(playerWindow.id);
    uninstallSourceOriginProxy(instance);
    instance.headerRules = [];
    instance.subscribedTabId = -1;
    instance.localVideoPath = '';
    instance.sourceOrigin = '';
    instance.playerPageUrl = '';
    instance.failedSourceOrigin = '';
  });

  const initialView = instance.localVideoPath
    ? null
    : resolveView(instance) || appWindow?.viewManager?.selected;
  ensurePlayerPage(instance, initialView?.url || '');
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

  // 复制到剪贴板
  ipcMain.on('media-player-copy', (_e, text: string) => {
    clipboard.writeText(text || '');
  });

  // 外部播放器(PotPlayer)：复用 view 已注册的 show-other-video-dialog 流程。
  // 该频道回调不读取事件参数，靠闭包里的 view，因此可用 ipcMain.emit 直接触发。
  ipcMain.on('media-player-external', (e) => {
    const instance = getInstanceBySender(e.sender);
    if (!instance || instance.localVideoPath) return;
    const view = resolveView(instance);
    if (view) {
      ipcMain.emit(`show-other-video-dialog-${view.id}`, {sender: view.webContents});
    }
  });
};

// 供 view 在嗅探到新资源时调用，实时刷新播放器列表(若窗口开着且订阅的是当前 tab)。
export const refreshMediaPlayer = (tabId: number) => {
  for (const instance of playerInstances.values()) {
    if (!instance.win || instance.win.isDestroyed()) continue;
    if (instance.localVideoPath) continue;
    if (instance.subscribedTabId !== -1 && instance.subscribedTabId !== tabId) continue;
    pushVideoData(instance);
  }
};
