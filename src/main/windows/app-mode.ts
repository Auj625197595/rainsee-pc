import {
  app,
  BrowserView,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  shell,
} from 'electron';
import {WEBUI_BASE_URL, WEBUI_URL_SUFFIX} from '~/constants/files';
import {PopupView} from '~/main/dialogs/popup';

// PWA「安装」后运行的独立应用窗口,以及从快捷方式 / --app 命令行冷启动的入口。
// Electron 主窗口只承载应用头部，网站运行在下方独立 BrowserView 中。

const APP_PARTITION = 'persist:view';
const PWA_AUMID_PREFIX = 'com.rainsee.pcbrowser.pwa.';
const APP_HEADER_HEIGHT = 36;
const WINDOW_CONTROLS_WIDTH = 138;
const APP_MENU_WIDTH = 280;
const appModeWebContents = new WeakSet<Electron.WebContents>();
interface AppModeShellContext {
  win: BrowserWindow;
  page: Electron.WebContents;
  name: string;
  themeColor: string;
  foregroundColor: string;
  iconDataUrl: string;
  extensionTabRegistered?: boolean;
  extensionPopup?: PopupView;
  popupWorkerRelease?: () => void;
  popupLaunchToken: number;
}
const appModeShells = new WeakMap<
  Electron.WebContents,
  AppModeShellContext
>();

const normalizeThemeColor = (value?: string): string => {
  const color = (value || '').trim();
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#202124';
};

const foregroundFor = (color: string): string => {
  let hex = color.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .slice(0, 3)
      .split('')
      .map((part) => part + part)
      .join('');
  } else {
    hex = hex.slice(0, 6);
  }
  const channels = [0, 2, 4].map((offset) =>
    parseInt(hex.slice(offset, offset + 2), 16),
  );
  const luminance =
    (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 255000;
  return luminance > 0.55 ? '#202124' : '#f1f3f4';
};

const iconDataUrl = (
  icon: Electron.NativeImage | string | undefined,
): string => {
  try {
    const image = typeof icon === 'string' ? nativeImage.createFromPath(icon) : icon;
    if (!image || image.isEmpty()) return '';
    return image.resize({width: 16, height: 16, quality: 'best'}).toDataURL();
  } catch {
    return '';
  }
};

const extensionMenuIcon = (dataUrl: string): Electron.NativeImage | undefined => {
  if (!dataUrl) return undefined;
  try {
    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) return undefined;
    return image.resize({width: 16, height: 16, quality: 'best'});
  } catch {
    return undefined;
  }
};

interface AppExtensionMenuItem {
  id: string;
  name: string;
  icon: string;
  popup: string;
}

const releasePopupWorker = (context: AppModeShellContext) => {
  if (!context.popupWorkerRelease) return;
  try {
    context.popupWorkerRelease();
  } catch {}
  context.popupWorkerRelease = undefined;
};

const prewarmPopupServiceWorker = async (
  session: Electron.Session,
  extensionId: string,
): Promise<(() => void) | undefined> => {
  try {
    const extension: any =
      typeof (session as any).getExtension === 'function'
        ? (session as any).getExtension(extensionId)
        : undefined;
    const manifest = extension?.manifest;
    if (
      !manifest ||
      manifest.manifest_version !== 3 ||
      !manifest.background?.service_worker
    ) {
      return undefined;
    }

    const {Application} = require('../application');
    return await Application.instance.sessions.prewarmExtensionPopupWorker(
      session,
      extensionId,
      8_000,
    );
  } catch (error) {
    console.warn('[pwa] extension popup worker prewarm failed', extensionId, error);
    return undefined;
  }
};

const showExtensionPopup = async (
  context: AppModeShellContext,
  extension: AppExtensionMenuItem,
) => {
  const launchToken = ++context.popupLaunchToken;
  releasePopupWorker(context);

  if (context.extensionPopup) {
    const toggleExtension =
      !context.extensionPopup.isDestroyed() &&
      context.extensionPopup.extensionId === extension.id;
    const stalled = toggleExtension && context.extensionPopup.isStalled;
    if (toggleExtension && context.extensionPopup.isHidden && !stalled) return;

    context.extensionPopup.destroy();
    context.extensionPopup = undefined;
    if (toggleExtension && !stalled) return;
  }

  const {Application} = require('../application');
  const session = Application.instance.sessions.view as Electron.Session;
  const release = await prewarmPopupServiceWorker(session, extension.id);
  if (
    launchToken !== context.popupLaunchToken ||
    context.win.isDestroyed() ||
    context.page.isDestroyed()
  ) {
    release?.();
    return;
  }
  context.popupWorkerRelease = release;

  const [contentWidth] = context.win.getContentSize();
  const tabId = context.page.id;
  const popup = new PopupView({
    extensionId: extension.id,
    session,
    parent: context.win,
    url: extension.popup,
    tabs: [
      {
        id: tabId,
        index: 0,
        windowId: context.win.id,
        active: true,
        selected: true,
        highlighted: true,
        url: context.page.getURL(),
        title: context.page.getTitle(),
        incognito: false,
        pinned: false,
        groupId: Application.instance.sessions.getTabGroupId(tabId, false),
        status: context.page.isLoading() ? 'loading' : 'complete',
      },
    ],
    anchorRect: {
      x: contentWidth - WINDOW_CONTROLS_WIDTH - 38,
      y: APP_HEADER_HEIGHT,
      width: 38,
      height: 0,
    },
  });
  context.extensionPopup = popup;

  const popupWindow = popup.browserWindow;
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.once('closed', () => releasePopupWorker(context));
  } else {
    releasePopupWorker(context);
  }
};

const activateExtension = async (
  context: AppModeShellContext,
  extension: AppExtensionMenuItem,
) => {
  if (context.win.isDestroyed() || context.page.isDestroyed()) {
    return;
  }

  try {
    const {Application} = require('../application');
    const [contentWidth] = context.win.getContentSize();
    const extensions = Application.instance.sessions.chromeExtensions;
    if (!context.extensionTabRegistered) {
      extensions.addTab(context.page, context.win);
      context.extensionTabRegistered = true;
    }

    if (extension.popup) {
      await showExtensionPopup(context, extension);
      return;
    }

    extensions.activateExtensionAction(extension.id, context.page.id, {
      x: contentWidth - WINDOW_CONTROLS_WIDTH - 38,
      y: APP_HEADER_HEIGHT,
      width: 38,
      height: 0,
    });
  } catch (error) {
    console.error('[pwa] extension action failed', extension.id, error);
  }
};

const openExtensionsManager = () => {
  try {
    const {Application} = require('../application');
    const browserWindows = Application.instance.windows;
    const extensionsUrl = `${WEBUI_BASE_URL}extensions${WEBUI_URL_SUFFIX}`;
    let browser = [
      browserWindows.current,
      browserWindows.lastFocused,
      ...browserWindows.list,
    ].find((item: any) => item && !item.win.isDestroyed());
    if (!browser) {
      browser = browserWindows.open(false, extensionsUrl);
    } else {
      browser.viewManager.create({url: extensionsUrl, active: true}, true);
    }
    browser.showAndFocus();
  } catch (error) {
    console.error('[pwa] open extensions manager failed', error);
  }
};

const getExtensionMenuItems = async (): Promise<AppExtensionMenuItem[]> => {
  if (!process.env.ENABLE_EXTENSIONS) return [];
  try {
    const {Application} = require('../application');
    await Application.instance.sessions.loadExtensions();
    const details = await Application.instance.sessions.getDetailedExtensions();
    return details
      .filter((item: any) => item.enabled && item.type === 'extension')
      .map((item: any) => ({
        id: String(item.id || ''),
        name: String(item.name || item.id || '扩展'),
        icon: String(item.icon || ''),
        popup: String(item.popup || ''),
      }))
      .filter((item: AppExtensionMenuItem) => item.id);
  } catch (error) {
    console.error('[pwa] load extensions for app menu failed', error);
    return [];
  }
};

const showAppMenu = (
  context: AppModeShellContext,
  extensions: AppExtensionMenuItem[],
) => {
  const {win, page, name} = context;
  if (win.isDestroyed() || page.isDestroyed()) return;

  const adjustZoom = (multiplier: number) => {
    page.setZoomFactor(
      Math.min(5, Math.max(0.25, page.getZoomFactor() * multiplier)),
    );
  };
  const extensionItems: Electron.MenuItemConstructorOptions[] = extensions.map(
    (extension) => ({
      label: extension.name,
      icon: extensionMenuIcon(extension.icon),
      click: () => void activateExtension(context, extension),
    }),
  );
  if (extensionItems.length === 0) {
    extensionItems.push({label: '没有已安装的扩展', enabled: false});
  }
  extensionItems.push({type: 'separator'});
  extensionItems.push({label: '管理扩展', click: openExtensionsManager});

  const menu = Menu.buildFromTemplate([
    {
      label: name || '应用',
      icon: context.iconDataUrl
        ? nativeImage.createFromDataURL(context.iconDataUrl)
        : undefined,
      enabled: false,
    },
    {type: 'separator'},
    {label: '固定到任务栏', enabled: false},
    {label: '固定到开始菜单', enabled: false},
    {label: '应用设置', enabled: false},
    {type: 'separator'},
    {
      label: '缩放',
      submenu: [
        {label: '放大', click: () => adjustZoom(1.1)},
        {label: '缩小', click: () => adjustZoom(1 / 1.1)},
        {label: '重置缩放', click: () => page.setZoomFactor(1)},
      ],
    },
    {
      label: '扩展',
      submenu: extensionItems,
    },
    {
      label: '更多工具',
      submenu: [
        {label: '复制页面链接', click: () => clipboard.writeText(page.getURL())},
        {
          label: '在浏览器中打开',
          click: () => {
            const url = page.getURL();
            if (/^https?:/i.test(url))
              shell.openExternal(url).catch(() => undefined);
          },
        },
        {label: '重新加载应用', click: () => page.reload()},
      ],
    },
    {type: 'separator'},
    {label: '退出应用', click: () => win.close()},
  ]);
  const [contentWidth] = win.getContentSize();
  menu.popup({
    window: win,
    x: Math.max(0, contentWidth - WINDOW_CONTROLS_WIDTH - APP_MENU_WIDTH),
    y: APP_HEADER_HEIGHT,
  });
};

ipcMain.handle('pwa-app-menu-open', async (event): Promise<boolean> => {
  const context = appModeShells.get(event.sender);
  if (!context) return false;
  showAppMenu(context, await getExtensionMenuItems());
  return true;
});

ipcMain.handle('pwa-app-shell-info', (event) => {
  const context = appModeShells.get(event.sender);
  if (!context) return null;
  return {
    title: context.name,
    themeColor: context.themeColor,
    foregroundColor: context.foregroundColor,
    iconDataUrl: context.iconDataUrl,
  };
});

// persist:view 的权限处理器同时服务普通标签和独立 PWA。显式登记 PWA
// BrowserView 的 webContents，避免把 Electron 壳层或普通页面误判为 PWA。
export const isAppModeWebContents = (contents: Electron.WebContents): boolean =>
  appModeWebContents.has(contents);

// Windows 按 AppUserModelID 聚合任务栏按钮。每个 PWA 从 origin 派生稳定 ID,
// 使它与浏览器主体及其他 PWA 分开分组,同时与对应 .lnk 的身份保持一致。
export const getPwaAppUserModelId = (url: string): string => {
  let identity = url;
  try {
    identity = new URL(url).origin;
  } catch {
    // 无法解析时仍基于原字符串生成稳定身份。
  }
  const suffix = (identity || 'app')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 72) || 'app';
  return `${PWA_AUMID_PREFIX}${suffix}`;
};

export interface AppModeOptions {
  url: string;
  name?: string;
  // nativeImage 或磁盘 PNG 路径;仅用于窗口/任务栏图标。
  icon?: Electron.NativeImage | string;
  themeColor?: string;
  bounds?: {width?: number; height?: number};
}

const shellHtml = (title: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')}</title></head><body></body></html>`;

// 打开一个独立 PWA 窗口。窗口自身的 webContents 是 Electron 头部壳层，
// 网站放在 BrowserView 中并从头部下方开始布局，二者互不覆盖。
export const openAppModeWindow = (opts: AppModeOptions): BrowserWindow => {
  const width = opts.bounds?.width || 1024;
  const height = opts.bounds?.height || 768;
  const appName = opts.name || '应用';
  const themeColor = normalizeThemeColor(opts.themeColor);
  const foregroundColor = foregroundFor(themeColor);
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 320,
    minHeight: 240,
    title: appName,
    backgroundColor: themeColor,
    icon: opts.icon as any,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            color: themeColor,
            symbolColor: foregroundColor,
            height: APP_HEADER_HEIGHT,
          },
        }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: `${app.getAppPath()}/build/app-mode-preload.bundle.js`,
    },
  });

  const pageView = new BrowserView({
    webPreferences: {
      partition: APP_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      nativeWindowOpen: true,
    },
  });
  const page = pageView.webContents;
  const context: AppModeShellContext = {
    win,
    page,
    name: appName,
    themeColor,
    foregroundColor,
    iconDataUrl: iconDataUrl(opts.icon),
    popupLaunchToken: 0,
  };
  appModeWebContents.add(page);
  appModeShells.set(win.webContents, context);
  win.setBrowserView(pageView);

  const updatePageBounds = () => {
    if (win.isDestroyed() || page.isDestroyed()) return;
    const [contentWidth, contentHeight] = win.getContentSize();
    pageView.setBounds({
      x: 0,
      y: APP_HEADER_HEIGHT,
      width: Math.max(1, contentWidth),
      height: Math.max(1, contentHeight - APP_HEADER_HEIGHT),
    });
  };
  updatePageBounds();
  win.on('resize', updatePageBounds);

  if (process.platform === 'win32') {
    try {
      const iconPath = typeof opts.icon === 'string' ? opts.icon : undefined;
      win.setAppDetails({
        appId: getPwaAppUserModelId(opts.url),
        appIconPath: iconPath,
        appIconIndex: iconPath ? 0 : undefined,
      });
    } catch (e) {
      console.error('[pwa] setAppDetails failed', e);
    }
  }

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });

  page.setWindowOpenHandler(({url: u}) => {
    if (u && /^https?:/i.test(u)) {
      shell.openExternal(u).catch(() => undefined);
    }
    return {action: 'deny'};
  });
  page.on('will-navigate', (event, url) => {
    if (!/^https?:/i.test(url)) event.preventDefault();
  });
  page.on('page-title-updated', (_event, title) => {
    const nextTitle = title.trim() || appName;
    win.setTitle(nextTitle);
    win.webContents.send('pwa-app-title', nextTitle);
  });

  win.on('closed', () => {
    context.extensionPopup?.destroy();
    context.extensionPopup = undefined;
    releasePopupWorker(context);
    if (!page.isDestroyed()) page.destroy();
  });

  win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(shellHtml(appName))}`,
  ).catch(() => undefined);
  page.loadURL(opts.url).catch(() => undefined);
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
