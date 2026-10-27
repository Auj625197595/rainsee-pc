import { ipcMain, nativeImage, shell } from 'electron';
import { existsSync, rmSync } from 'fs';

import { Application } from '../application';
import { getMainTranslator } from '../i18n';
import {
  findAppModeWindows,
  getPwaAppUserModelId,
  openAppModeWindow,
} from '../windows/app-mode';
import { getTrustedWebUIHost } from '~/common/webui-bridge-policy';
import {
  InstalledPwa,
  createShortcuts,
  getPwaLaunchArgs,
  getPwaShortcutPaths,
  loadInstalled,
  originOf,
  saveInstalled,
} from './pwa';

// 设置页「应用」管理(yjllq://settings#apps)。数据源是 pwa.ts 的
// installed-pwas.json;本模块只做管理动作与链接接管(「允许此应用程序打开支持的链接」)。

const t = () =>
  getMainTranslator(Application.instance?.settings?.object?.language);

export interface PwaAppInfo {
  id: string;
  name: string;
  origin: string;
  host: string;
  startUrl: string;
  description: string;
  iconDataUrl: string;
  themeColor: string;
  installedAt: number;
  handleLinks: boolean;
  supportedLinks: string[];
  hasDesktopShortcut: boolean;
  hasStartMenuShortcut: boolean;
  running: boolean;
}

export interface PwaActionResult {
  ok: boolean;
  message?: string;
}

// 应用作用域:manifest scope 与 origin 同源时用 scope,否则退回 origin 根。
const scopeOf = (item: InstalledPwa): string => {
  const fallback = `${item.origin}/`;
  if (!item.scope) return fallback;
  try {
    const scope = new URL(item.scope);
    if (scope.origin !== item.origin) return fallback;
    return scope.href;
  } catch {
    return fallback;
  }
};

const isInScope = (item: InstalledPwa, url: string) => {
  if (!/^https?:\/\//i.test(url)) return false;
  if (originOf(url) !== item.origin) return false;
  const scope = scopeOf(item);
  // 作用域本身(不带末尾 /)也算命中,与 Chromium 的 scope 前缀匹配一致。
  return url.startsWith(scope) || `${url}/` === scope;
};

const hostOf = (origin: string) => {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
};

const iconToDataUrl = (iconPath?: string) => {
  if (!iconPath || !existsSync(iconPath)) return '';
  try {
    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) return '';
    return image.resize({ width: 64, height: 64, quality: 'best' }).toDataURL();
  } catch {
    return '';
  }
};

const findById = (id: unknown): InstalledPwa | undefined =>
  typeof id === 'string'
    ? loadInstalled().find((item) => item.id === id)
    : undefined;

const toInfo = (item: InstalledPwa): PwaAppInfo => {
  const shortcuts = getPwaShortcutPaths(item.name);
  return {
    id: item.id,
    name: item.name,
    origin: item.origin,
    host: hostOf(item.origin),
    startUrl: item.startUrl,
    description: item.description || '',
    iconDataUrl: iconToDataUrl(item.iconPath),
    themeColor: item.themeColor || '',
    installedAt: item.installedAt,
    handleLinks: !!item.handleLinks,
    supportedLinks: [scopeOf(item)],
    hasDesktopShortcut:
      process.platform === 'win32' && existsSync(shortcuts.desktop),
    hasStartMenuShortcut:
      process.platform === 'win32' && existsSync(shortcuts.startMenu),
    running: findAppModeWindows((url) => originOf(url) === item.origin).length > 0,
  };
};

export const listPwaApps = (): PwaAppInfo[] =>
  [...loadInstalled()]
    .sort((a, b) => (b.installedAt || 0) - (a.installedAt || 0))
    .map(toInfo);

// 打开应用:已有窗口则聚焦(带 url 时在该窗口内导航),否则新开独立窗口。
export const openPwaApp = (item: InstalledPwa, url?: string) => {
  const existing = findAppModeWindows((pageUrl) => originOf(pageUrl) === item.origin);
  if (existing.length > 0) {
    const { win, page } = existing[0];
    if (url && url !== page.getURL()) page.loadURL(url).catch(() => undefined);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return win;
  }
  return openAppModeWindow({
    url: url || item.startUrl,
    name: item.name,
    icon: item.iconPath,
    themeColor: item.themeColor || undefined,
  });
};

// 链接接管:url 落在某个开启了「打开支持的链接」的已安装应用作用域内时返回该应用。
export const findLinkCapturingApp = (url: string): InstalledPwa | null => {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return (
    loadInstalled().find((item) => item.handleLinks && isInScope(item, url)) ||
    null
  );
};

// 冷启动外部链接 → 等价于 --app 启动(不开浏览器主窗口)。
export const getLinkCaptureAppMode = (
  url: string | undefined,
  incognito: boolean,
): { url: string; name?: string; icon?: string } | null => {
  if (!url || incognito) return null;
  return findLinkCapturingApp(url) ? { url } : null;
};

const ensureShortcut = (
  item: InstalledPwa,
  target: 'desktop' | 'startMenu',
) => {
  createShortcuts(
    item.name,
    item.startUrl,
    getPwaLaunchArgs(item.startUrl),
    item.iconPath,
    {
      createDesktopShortcut: target === 'desktop',
      createStartMenu: target === 'startMenu',
    },
  );
  return getPwaShortcutPaths(item.name)[target];
};

// 只删指向本应用的 .lnk(同名的用户自有快捷方式不动)。
const removeOwnShortcut = (item: InstalledPwa, path: string) => {
  if (!existsSync(path)) return;
  try {
    const link = shell.readShortcutLink(path);
    const ownsLink =
      link.appUserModelId === getPwaAppUserModelId(item.startUrl) ||
      (link.target === process.execPath &&
        (link.args || '').includes(`--app=${item.origin}`));
    if (ownsLink) rmSync(path, { force: true });
  } catch (error) {
    console.log('[pwa-apps] read shortcut failed', path, error);
  }
};

// 已打开标签的地址栏「已安装」图标随卸载回退为可安装态。
const markTabsUninstalled = (origin: string) => {
  for (const window of Application.instance.windows.list) {
    for (const view of window.viewManager.views.values()) {
      if (!view.pwaInstalled || originOf(view.url) !== origin) continue;
      view.pwaInstalled = false;
      view.emitEvent('pwa-installed', false);
    }
  }
};

export const uninstallPwaApp = (item: InstalledPwa): PwaActionResult => {
  saveInstalled(loadInstalled().filter((entry) => entry.id !== item.id));
  if (process.platform === 'win32') {
    const shortcuts = getPwaShortcutPaths(item.name);
    removeOwnShortcut(item, shortcuts.desktop);
    removeOwnShortcut(item, shortcuts.startMenu);
  }
  if (item.iconPath) rmSync(item.iconPath, { force: true });
  markTabsUninstalled(item.origin);
  return { ok: true };
};

const updateRecord = (id: string, patch: Partial<InstalledPwa>) => {
  const list = loadInstalled().map((entry) =>
    entry.id === id ? { ...entry, ...patch } : entry,
  );
  saveInstalled(list);
};

const requireWindows = (): PwaActionResult | null =>
  process.platform === 'win32'
    ? null
    : { ok: false, message: t()('pwaAppsWindowsOnly') };

// Windows 不开放程序化固定(taskbarpin / pintostartscreen 动词在 Win10 1809+
// 静默无效,DoIt 返回 E_ACCESSDENIED)。这里只准备好系统固定所需的 .lnk,
// 再把用户带到可以一步完成固定的位置。
const pinToStart = (item: InstalledPwa): PwaActionResult => {
  const blocked = requireWindows();
  if (blocked) return blocked;
  const lnk = ensureShortcut(item, 'startMenu');
  shell.showItemInFolder(lnk);
  return { ok: true, message: t()('pwaAppsPinStartHint') };
};

// 任务栏固定按 AUMID 找开始菜单里同 AUMID 的 .lnk 作为重启入口,
// 故先保证开始菜单快捷方式存在,再打开应用窗口让用户右键任务栏按钮固定。
const pinToTaskbar = (item: InstalledPwa): PwaActionResult => {
  const blocked = requireWindows();
  if (blocked) return blocked;
  ensureShortcut(item, 'startMenu');
  openPwaApp(item);
  return { ok: true, message: t()('pwaAppsPinTaskbarHint') };
};

const createDesktopShortcut = (item: InstalledPwa): PwaActionResult => {
  const blocked = requireWindows();
  if (blocked) return blocked;
  ensureShortcut(item, 'desktop');
  return { ok: true, message: t()('pwaAppsDesktopShortcutCreated') };
};

const clearCookies = async (item: InstalledPwa): Promise<PwaActionResult> => {
  await Application.instance.sessions.view.clearStorageData({
    origin: item.origin,
    storages: ['cookies'],
  });
  return { ok: true, message: t()('pwaAppsCookiesCleared') };
};

const isSettingsSender = (event: Electron.IpcMainInvokeEvent) =>
  getTrustedWebUIHost(event.sender.getURL()) === 'settings';

type AppAction = (
  item: InstalledPwa,
  ...args: unknown[]
) => PwaActionResult | Promise<PwaActionResult>;

const handleAppAction = (channel: string, action: AppAction) => {
  ipcMain.handle(channel, async (event, id: unknown, ...args: unknown[]) => {
    if (!isSettingsSender(event)) return { ok: false };
    const item = findById(id);
    if (!item) return { ok: false, message: t()('pwaAppsNotFound') };
    try {
      return await action(item, ...args);
    } catch (error) {
      console.log(`[pwa-apps] ${channel} failed`, item.origin, error);
      return { ok: false, message: t()('pwaAppsActionFailed') };
    }
  });
};

export const registerPwaManagementIpc = () => {
  ipcMain.handle('pwa-apps-list', (event) =>
    isSettingsSender(event) ? listPwaApps() : [],
  );
  handleAppAction('pwa-app-open', (item) => {
    openPwaApp(item);
    return { ok: true };
  });
  handleAppAction('pwa-app-uninstall', uninstallPwaApp);
  handleAppAction('pwa-app-create-desktop-shortcut', createDesktopShortcut);
  handleAppAction('pwa-app-pin-taskbar', pinToTaskbar);
  handleAppAction('pwa-app-pin-start', pinToStart);
  handleAppAction('pwa-app-clear-cookies', clearCookies);
  handleAppAction('pwa-app-set-handle-links', (item, enabled) => {
    updateRecord(item.id, { handleLinks: enabled === true });
    return { ok: true };
  });
};
