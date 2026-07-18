import {app, BrowserWindow, shell} from 'electron';

// PWA「安装」后运行的独立应用窗口,以及从快捷方式 / --app 命令行冷启动的入口。
// 复用浏览器网页的 persist:view 分区,与浏览器共用 cookie / 登录态。
// 不进 WindowsService.list(非浏览器窗口),不挂载浏览器外壳/preload,作为干净的应用页运行。

const APP_PARTITION = 'persist:view';

export interface AppModeOptions {
  url: string;
  name?: string;
  // nativeImage 或磁盘 PNG 路径;仅用于窗口/任务栏图标。
  icon?: Electron.NativeImage | string;
  themeColor?: string;
  bounds?: {width?: number; height?: number};
}

// 打开一个独立应用窗口并加载 url。每次调用新建一个窗口(允许同一 PWA 多开)。
export const openAppModeWindow = (opts: AppModeOptions): BrowserWindow => {
  const width = opts.bounds?.width || 1024;
  const height = opts.bounds?.height || 768;

  const win = new BrowserWindow({
    width,
    height,
    minWidth: 320,
    minHeight: 240,
    title: opts.name || '应用',
    backgroundColor: opts.themeColor || '#ffffff',
    icon: opts.icon as any,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      partition: APP_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      nativeWindowOpen: true,
    },
  });

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });

  // window.open / target=_blank 交给系统浏览器,避免应用窗口被导航走。
  win.webContents.setWindowOpenHandler(({url: u}) => {
    if (u && /^https?:/i.test(u)) {
      shell.openExternal(u).catch(() => undefined);
    }
    return {action: 'deny'};
  });

  // 应用内的导航仍允许(单页应用路由跳转),但不允许跳到外部协议。
  win.webContents.on('will-navigate', (e, u) => {
    if (!/^https?:/i.test(u)) e.preventDefault();
  });

  win.loadURL(opts.url).catch(() => undefined);
  return win;
};

// 从命令行 argv(第二实例,或自行解析的命令行)解析 --app / --app-name / --app-icon。
export const parseAppModeFromArgv = (
  argv: string[],
): {url: string; name?: string; icon?: string} | null => {
  let url = '';
  let name = '';
  let icon = '';
  for (const a of argv || []) {
    if (typeof a !== 'string') continue;
    if (a.startsWith('--app=')) url = a.slice('--app='.length).trim();
    else if (a.startsWith('--app-name=')) name = decodeURIComponent(a.slice('--app-name='.length).trim());
    else if (a.startsWith('--app-icon=')) icon = a.slice('--app-icon='.length).trim();
  }
  if (!url) return null;
  return {url, name: name || undefined, icon: icon || undefined};
};

// 冷启动时从当前进程 app.commandLine 读取 --app 模式(Electron 自动解析进程 argv)。
export const getAppModeFromCommandLine = (): {
  url: string;
  name?: string;
  icon?: string;
} | null => {
  try {
    if (!app.commandLine.hasSwitch('app')) return null;
    const url = app.commandLine.getSwitchValue('app');
    if (!url) return null;
    return {
      url,
      name: app.commandLine.getSwitchValue('app-name') || undefined,
      icon: app.commandLine.getSwitchValue('app-icon') || undefined,
    };
  } catch {
    return null;
  }
};
