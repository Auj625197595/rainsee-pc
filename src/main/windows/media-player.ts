import {app, BrowserWindow, ipcMain, session, shell, clipboard} from 'electron';
import {basename, extname, join} from 'path';
import {pathToFileURL} from 'url';
import {Application} from '../application';
import {setupMediaDownloader} from '../services/media-downloader';

// 智能播放器窗口：屏幕中央独立窗口(点外不消失)，承载本地静态播放器页面。
// 用独立 session 分区 persist:mediaplayer，关闭 webSecurity 对页面开放所有跨域，
// 并在该 session 注入嗅探到的请求头(Referer/Origin/Cookie/UA)绕过防盗链。

const WIDTH = 980;
const HEIGHT = 720;
const PARTITION = 'persist:mediaplayer';

let playerWindow: BrowserWindow | null = null;
let headerRules: {host: string; headers: Record<string, string>}[] = [];
let sessionHooked = false;
let subscribedTabId = -1;
let localVideoPath = '';

// 在播放器 session 上挂请求头注入。对命中 host 的请求合并清理后的嗅探头。
const ensureSessionHook = () => {
  if (sessionHooked) return;
  sessionHooked = true;
  const ses = session.fromPartition(PARTITION);
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    try {
      let host = '';
      try {
        host = new URL(details.url).hostname;
      } catch (e) {
      }
      const rule = headerRules.find((r) => r.host && host && r.host === host);
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

// 把当前 tab 的资源列表与各自的请求头同步给播放器页面 + 注入规则。
const pushVideoData = (appWindow: any) => {
  if (!playerWindow || playerWindow.isDestroyed()) return;

  if (localVideoPath) {
    const ext = extname(localVideoPath).slice(1).toLowerCase();
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
    playerWindow.webContents.send('media-player-data', {
      items: [{
        url: pathToFileURL(localVideoPath).toString(),
        host: '本地文件',
        contentType: contentTypes[ext] || 'video/*',
        mediaType: ext || 'video',
        addedAt: Date.now(),
        local: true,
        name: basename(localVideoPath),
      }],
      pageUrl: pathToFileURL(localVideoPath).toString(),
      title: basename(localVideoPath),
      local: true,
    });
    return;
  }

  const view = appWindow?.viewManager?.selected;
  if (!view) return;

  const items = view.getVideoItems();

  // 重建 host → headers 注入规则
  const rules: {host: string; headers: Record<string, string>}[] = [];
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
  headerRules = rules;

  playerWindow.webContents.send('media-player-data', {
    items,
    pageUrl: view.url,
    title: view.webContents.getTitle?.() || '',
  });
};

const subscribeTab = (appWindow: any) => {
  const view = appWindow?.viewManager?.selected;
  if (!view) return;
  subscribedTabId = view.id;
};

// 解析播放器当前订阅的 view(优先按 subscribedTabId 跨窗口查找，回退到当前选中)。
const resolveView = () => {
  const wins = Application.instance.windows;
  if (subscribedTabId !== -1) {
    for (const w of wins.list) {
      const v = w?.viewManager?.views?.get(subscribedTabId);
      if (v) return v;
    }
  }
  const appWindow = wins.current || wins.lastFocused;
  return appWindow?.viewManager?.selected;
};

export const showMediaPlayer = (parent: BrowserWindow, filePath?: string) => {
  setupMediaDownloader();
  ensureSessionHook();

  localVideoPath = filePath || '';

  const appWindow = Application.instance.windows.fromBrowserWindow(parent)
    || Application.instance.windows.current;

  // 打开播放器即暂停原网页里正在播放的视频，避免双重发声
  try {
    appWindow?.viewManager?.selected?.pausePageVideos();
  } catch (e) {
  }

  if (playerWindow && !playerWindow.isDestroyed()) {
    playerWindow.focus();
    if (localVideoPath) subscribedTabId = -1;
    else subscribeTab(appWindow);
    pushVideoData(appWindow);
    return;
  }

  playerWindow = new BrowserWindow({
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
      partition: PARTITION,
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });
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

  if (localVideoPath) subscribedTabId = -1;
  else subscribeTab(appWindow);

  playerWindow.once('ready-to-show', () => {
    playerWindow?.show();
  });

  playerWindow.webContents.on('did-finish-load', () => {
    pushVideoData(appWindow);
  });

  playerWindow.on('closed', () => {
    playerWindow = null;
    headerRules = [];
    subscribedTabId = -1;
    localVideoPath = '';
  });

  playerWindow.loadFile(join(app.getAppPath(), 'static/pages/media-player.html'))
    .catch(() => undefined);
};

// 应用启动时注册一次：播放器页面的 IPC(关闭/外部播放/复制/请求最新数据)。
let registered = false;
export const setupMediaPlayer = () => {
  if (registered) return;
  registered = true;
  setupMediaDownloader();

  // 页面主动请求刷新数据
  ipcMain.on('media-player-request-data', () => {
    const appWindow = Application.instance.windows.current
      || Application.instance.windows.lastFocused;
    pushVideoData(appWindow);
  });

  // 关闭窗口
  ipcMain.on('media-player-close', () => {
    if (playerWindow && !playerWindow.isDestroyed()) playerWindow.close();
  });

  // 最小化窗口(独立任务栏项)
  ipcMain.on('media-player-minimize', () => {
    if (playerWindow && !playerWindow.isDestroyed()) playerWindow.minimize();
  });

  // 复制到剪贴板
  ipcMain.on('media-player-copy', (e, text: string) => {
    clipboard.writeText(text || '');
  });

  // 外部播放器(PotPlayer)：复用 view 已注册的 show-other-video-dialog 流程。
  // 该频道回调不读取事件参数，靠闭包里的 view，因此可用 ipcMain.emit 直接触发。
  ipcMain.on('media-player-external', () => {
    const view = resolveView();
    if (view) {
      ipcMain.emit(`show-other-video-dialog-${view.id}`, {sender: view.webContents});
    }
  });
};

// 供 view 在嗅探到新资源时调用，实时刷新播放器列表(若窗口开着且是当前 tab)。
export const refreshMediaPlayer = (tabId: number) => {
  if (!playerWindow || playerWindow.isDestroyed()) return;
  if (localVideoPath) return;
  if (subscribedTabId !== -1 && subscribedTabId !== tabId) return;
  const appWindow = Application.instance.windows.current
    || Application.instance.windows.lastFocused;
  pushVideoData(appWindow);
};
