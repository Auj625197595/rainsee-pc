import {app, BrowserWindow, clipboard, ipcMain, session, shell, WebContents} from 'electron';
import {basename, extname, join} from 'path';
import {pathToFileURL} from 'url';
import {Application} from '../application';
import {setupMediaDownloader} from '../services/media-downloader';

// 智能播放器窗口：屏幕中央独立窗口(点外不消失)，承载本地静态播放器页面。
// 每个窗口使用独立的临时 session，避免多开时互相覆盖 Referer/Cookie 等播放请求头。

const WIDTH = 980;
const HEIGHT = 720;

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
};

const playerInstances = new Map<number, MediaPlayerInstance>();
let playerSequence = 0;
let registered = false;

const createPartition = () =>
  `media-player-${process.pid}-${Date.now()}-${++playerSequence}`;

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

const subscribeTab = (instance: MediaPlayerInstance, appWindow: any) => {
  const view = appWindow?.viewManager?.selected;
  instance.subscribedTabId = view ? view.id : -1;
};

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
        host: '本地文件',
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

  const items = view.getVideoItems();

  const rules: HeaderRule[] = [];
  for (const item of items) {
    const headers = view.getPlaybackHeaders(item.url);
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
    title: '智能播放器',
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
  };

  playerInstances.set(playerWindow.id, instance);
  ensureSessionHook(instance);
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

  playerWindow.on('closed', () => {
    playerInstances.delete(playerWindow.id);
    instance.headerRules = [];
    instance.subscribedTabId = -1;
    instance.localVideoPath = '';
  });

  playerWindow.loadFile(join(app.getAppPath(), 'static/pages/media-player.html'))
    .catch(() => undefined);
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
