import {
  clipboard,
  Menu,
  nativeImage,
  NativeImage,
  MenuItemConstructorOptions,
  app,
} from 'electron';
import { join } from 'path';
import { BookmarkBarDisplay, IBookmark } from '~/interfaces';
import { getIconByUrlNet, parseBookmarklet } from '~/utils/url';
import { Application } from '../application';
import { AppWindow } from '../windows/app';
import { AddBookmarkDialog } from '../dialogs/add-bookmark';
import { getWebUIURL } from '~/common/webui-main';
import { normalizeBookmarkBarDisplay } from '~/common/bookmark-bar';

type BookmarkClipboard = {
  mode: 'cut' | 'copy';
  ids: string[];
  copies?: BookmarkSnapshot[];
};

type BookmarkSnapshot = {
  title?: string;
  url?: string;
  favicon?: string;
  isFolder?: boolean;
  children: BookmarkSnapshot[];
};

let bookmarkClipboard: BookmarkClipboard | null = null;

function getPath(file: string) {
  if (process.env.NODE_ENV === 'development') {
    return join(
      app.getAppPath(),
      'src',
      'renderer',
      'resources',
      'icons',
      `${file}.png`,
    );
  } else {
    const path = require(`~/renderer/resources/icons/${file}.png`);
    return join(app.getAppPath(), `build`, path);
  }
}

// 渲染进程栅格化后传入的默认图标 PNG data URL(黄文件夹/灰地球),
// 使 popup 默认图标与书签栏一致。未传入时回退到 themed PNG 兜底。
export type DefaultBookmarkIcons = { df?: string; dp?: string };

// 把 data URL 转 16x16 nativeImage。修复部分 favicon 损坏的 base64 前缀
// (data:png;base64, → data:image/png;base64,,见 electron#23369)。
// 解码失败/空图返回 null,以便上层逐级回退(避免菜单出现空图标占位)。
function toImg(dataURL: string | undefined): NativeImage | null {
  if (!dataURL) return null;
  let d = dataURL;
  if (!d.split(',')[0].includes('image')) {
    d = d.split(':').join(':image/');
  }
  try {
    const img = nativeImage
      .createFromDataURL(d)
      .resize({ width: 16, height: 16 });
    return img.isEmpty() ? null : img;
  } catch {
    return null;
  }
}

// 单个 favicon 网络预取的最长等待(ms)。仅"根层"(用户点击的那一级)允许网络——
// 缓存命中的 addFavicon 同步返回(Map.get)不受影响,未命中的超时后回退默认图标。
// 嵌套子层完全跳过网络(见 createDropdown 的 allowNetwork:false),避免递归预取
// 整棵书签树把首次打开卡到几十秒。1500ms:图标服务多数 <500ms,偶发慢链路不致明显延迟。
const ICON_FETCH_TIMEOUT_MS = 1000;

// 解析单个书签的菜单图标。优先级:本地 favicon(data URL) → 在线图标服务
// getIconByUrlNet(经 addFavicon fetch 并缓存) → 与书签栏一致的默认图标(黄文件夹/灰地球)
// → themed PNG 兜底。每一级都用 toImg 判空,确保最终一定有图标显示。
// opts.allowNetwork=false 时跳过第 2 步(嵌套子层用),只用同步可得的图标,
// 保证菜单构建不被网络阻塞、popup 即时。
async function resolveIcon(
  favicon: string | undefined,
  url: string | undefined,
  isFolder: boolean,
  defaults: DefaultBookmarkIcons = {},
  opts: { allowNetwork?: boolean } = {},
): Promise<NativeImage | string> {
  // 1. 本地 favicon(data URL 直用;http URL 查 favicons Map)
  if (favicon) {
    const stored = favicon.startsWith('data:')
      ? favicon
      : Application.instance.storage.favicons.get(favicon);
    const img = toImg(stored);
    if (img) return img;
  }

  // 2. 无本地 favicon:走在线图标服务(icon.rainsee.cn)按域名取图标。
  //    addFavicon fetch + 转 data URL 并缓存(后续命中直接返回)。加超时并用
  //    clearTimeout 清理,避免 race 中未中标的 timeout 产生 unhandled rejection。
  //    仅根层允许(opts.allowNetwork 默认 true);子层跳过以保证 popup 不被网络阻塞。
  if (opts.allowNetwork !== false && !isFolder && url) {
    let timer: NodeJS.Timeout | undefined;
    try {
      const fetchP = Application.instance.storage.addFavicon(
        getIconByUrlNet(url),
      );
      const timeoutP = new Promise<string>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('icon fetch timeout')),
          ICON_FETCH_TIMEOUT_MS,
        );
      });
      const dataURL = await Promise.race([fetchP, timeoutP]);
      const img = toImg(dataURL);
      if (img) return img;
    } catch {
      // 图标服务失败/超时则继续回退
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // 3. 默认图标:与书签栏一致的黄文件夹/灰地球(渲染进程栅格化传入)
  const def = isFolder ? defaults.df : defaults.dp;
  const defImg = toImg(def);
  if (defImg) return defImg;

  // 4. 兜底:渲染进程尚未传入时沿用旧的 themed PNG
  if (Application.instance.settings.object.theme === 'wexond-dark') {
    return getPath(isFolder ? 'folder_light' : 'page_light');
  }
  return getPath(isFolder ? 'folder_dark' : 'page_dark');
}

export async function createDropdown(
  appWindow: AppWindow,
  parentID: string,
  bookmarks: IBookmark[],
  defaults: DefaultBookmarkIcons = {},
  opts: { allowNetwork?: boolean } = {},
): Promise<Electron.Menu> {
  const folderBookmarks = bookmarks
    .filter(
      ({ static: staticName, parent }) => !staticName && parent === parentID,
    )
    .slice()
    .sort((left, right) => {
      const orderDifference = (left.order || 0) - (right.order || 0);
      if (orderDifference !== 0) return orderDifference;
      // 相同 order 时用持久化 _id 作为确定性 tie-breaker。
      return String(left._id).localeCompare(String(right._id));
    });

  // 关键性能策略:只有"根层"(用户实际点击的那一级,opts.allowNetwork 默认 true)
  // 允许走网络预取 favicon;嵌套子菜单一律 allowNetwork:false——只用本地缓存 +
  // 默认图标同步构建,不再递归 fetch 整棵书签树。这样首次打开不再被深层书签的
  // 图标请求卡住,菜单即时 popup;根层 fetch 成功的图标会写入 storage.favicons,
  // 下次打开(或在浏览器浏览过该站点后)即命中缓存、图标准确。
  const rootAllowsNetwork = opts.allowNetwork !== false;

  // 并行预取本层所有图标 + 子菜单。子菜单内的图标走同步路径(无网络),
  // 故 submenu 的构建耗时只取决于本地图标处理,与书签树规模解耦。
  const [icons, submenus] = await Promise.all([
    Promise.all(
      folderBookmarks.map(({ favicon, url, isFolder }) =>
        resolveIcon(favicon, url, isFolder, defaults, {
          allowNetwork: rootAllowsNetwork,
        }),
      ),
    ),
    Promise.all(
      folderBookmarks.map((b) =>
        b.isFolder
          ? createDropdown(appWindow, b._id, bookmarks, defaults, {
              allowNetwork: false,
            })
          : Promise.resolve(undefined),
      ),
    ),
  ]);

  const template = folderBookmarks.map<MenuItemConstructorOptions>(
    ({ title, url, _id }, i) => ({
      click: url
        ? () => {
            // bookmarklet:不开新标签,在当前网页执行。
            const bookmarklet = parseBookmarklet(url);
            if (bookmarklet !== null) {
              appWindow.viewManager.runBookmarklet(bookmarklet);
            } else {
              appWindow.viewManager.create({ url, active: true });
            }
            // 从溢出浮层的子菜单打开书签后,关掉一级浮层(若开着);幂等。
            Application.instance.dialogs
              .getExistingPersistent('bookmark-overflow')
              ?.hide();
          }
        : undefined,
      label: title,
      icon: icons[i],
      submenu: submenus[i],
      id: _id,
    }),
  );

  return template.length > 0
    ? Menu.buildFromTemplate(template)
    : Menu.buildFromTemplate([{ label: '(empty)', enabled: false }]);
}

function getSortedChildren(parentId: string): IBookmark[] {
  return Application.instance.storage.bookmarks
    .filter((bookmark) => bookmark.parent === parentId)
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function getBookmarkUrls(item: IBookmark): string[] {
  if (!item.isFolder) return item.url ? [item.url] : [];

  return getSortedChildren(item._id).reduce<string[]>(
    (urls, child) => urls.concat(getBookmarkUrls(child)),
    [],
  );
}

function openInTabs(
  appWindow: AppWindow,
  urls: string[],
  activateFirst = false,
) {
  urls.forEach((url, index) => {
    const bookmarklet = parseBookmarklet(url);
    if (bookmarklet !== null) {
      appWindow.viewManager.runBookmarklet(bookmarklet);
      return;
    }
    appWindow.viewManager.create({
      url,
      active: activateFirst && index === 0,
    });
  });
}

function openInWindow(urls: string[], incognito: boolean) {
  if (urls.length === 0) return;

  const normalUrls = urls.filter((url) => {
    const bookmarklet = parseBookmarklet(url);
    if (bookmarklet === null) return true;
    Application.instance.windows.current?.viewManager.runBookmarklet(
      bookmarklet,
    );
    return false;
  });
  if (normalUrls.length === 0) return;

  const existing = incognito
    ? Application.instance.windows.list.find(
        (window) => window.incognito && !window.win.isDestroyed(),
      )
    : undefined;
  if (existing) {
    normalUrls.forEach((url, index) => {
      existing.viewManager.create({ url, active: index === 0 });
    });
    existing.win.focus();
    return;
  }

  const [firstUrl, ...remainingUrls] = normalUrls;
  const targetWindow = Application.instance.windows.open(incognito, firstUrl);
  targetWindow.webContents.once('did-finish-load', () => {
    if (targetWindow.win.isDestroyed()) return;
    remainingUrls.forEach((url) => {
      targetWindow.viewManager.create({ url, active: false });
    });
  });
  targetWindow.win.focus();
}

function openEditor(appWindow: AppWindow, item: IBookmark) {
  const windowBounds = appWindow.win.getBounds();
  const dialog = Application.instance.dialogs.getPersistent(
    'add-bookmark',
  ) as AddBookmarkDialog;
  void dialog.open(appWindow.win, windowBounds.width - 20, 72, {
    url: item.url || '',
    title: item.title || '',
    bookmark: item,
    favicon: item.favicon,
  });
}

function replaceWithCurrentUrl(appWindow: AppWindow, item: IBookmark) {
  if (!item._id) return;
  const current = appWindow.viewManager.selected;
  const url = current?.url || current?.webContents.getURL();
  if (!url || url === item.url) return;

  void Application.instance.storage.updateBookmark(item._id, {
    url,
    favicon: current.favicon || '',
  });
}

function getMainFolder(): IBookmark | undefined {
  return Application.instance.storage.bookmarks.find(
    (bookmark) => bookmark.static === 'main',
  );
}

function getDestinationFolder(folderId?: string): IBookmark | undefined {
  const folder = folderId
    ? Application.instance.storage.bookmarks.find(
        (bookmark) => bookmark._id === folderId,
      )
    : undefined;
  return folder?.isFolder ? folder : getMainFolder();
}

async function addFolder(appWindow: AppWindow, folderId?: string) {
  const parent = getDestinationFolder(folderId);
  if (!parent?._id) return;

  const folder = await Application.instance.storage.addBookmark({
    title: '新建文件夹',
    isFolder: true,
    parent: parent._id,
  });
  openEditor(appWindow, folder);
}

function addPage(appWindow: AppWindow, folderId?: string) {
  const windowBounds = appWindow.win.getBounds();
  const dialog = Application.instance.dialogs.getPersistent(
    'add-bookmark',
  ) as AddBookmarkDialog;
  if (!folderId) {
    void dialog.open(appWindow.win, windowBounds.width - 20, 72);
    return;
  }

  const { url, title, bookmark, favicon } = appWindow.viewManager.selected;
  void dialog.open(appWindow.win, windowBounds.width - 20, 72, {
    url,
    title,
    bookmark,
    favicon,
    folderId,
  });
}

function openBookmarkManager(appWindow: AppWindow) {
  appWindow.viewManager.create({
    url: getWebUIURL('bookmarks'),
    active: true,
  });
}

function setClipboard(item: IBookmark, mode: 'cut' | 'copy') {
  if (!item._id) return;
  bookmarkClipboard = {
    mode,
    ids: [item._id],
    copies: mode === 'copy' ? [snapshotBookmark(item)] : undefined,
  };

  const urls = getBookmarkUrls(item);
  clipboard.clear();
  if (urls.length > 0) clipboard.writeText(urls.join('\n'));
}

function snapshotBookmark(item: IBookmark): BookmarkSnapshot {
  return {
    title: item.title,
    url: item.url,
    favicon: item.favicon,
    isFolder: item.isFolder,
    children: item.isFolder
      ? getSortedChildren(item._id).map(snapshotBookmark)
      : [],
  };
}

function isDescendant(folderId: string, possibleAncestorId: string): boolean {
  let current = Application.instance.storage.bookmarks.find(
    (bookmark) => bookmark._id === folderId,
  );
  const visited = new Set<string>();

  while (current?.parent && !visited.has(current._id)) {
    if (current.parent === possibleAncestorId) return true;
    visited.add(current._id);
    current = Application.instance.storage.bookmarks.find(
      (bookmark) => bookmark._id === current.parent,
    );
  }
  return false;
}

function canPasteInto(parentId: string | undefined): boolean {
  if (!bookmarkClipboard || !parentId) return false;
  const target = Application.instance.storage.bookmarks.find(
    (bookmark) => bookmark._id === parentId,
  );
  if (!target?.isFolder) return false;

  return bookmarkClipboard.ids.some((id) => {
    const source = Application.instance.storage.bookmarks.find(
      (bookmark) => bookmark._id === id,
    );
    if (!source || source.static) return false;
    if (bookmarkClipboard.mode === 'copy') return true;
    return (
      source.parent !== parentId &&
      source._id !== parentId &&
      (!source.isFolder || !isDescendant(parentId, source._id))
    );
  });
}

async function cloneBookmark(item: BookmarkSnapshot, parentId: string) {
  const clone = await Application.instance.storage.addBookmark({
    title: item.title,
    url: item.url,
    favicon: item.favicon,
    isFolder: item.isFolder,
    parent: parentId,
  });

  if (item.isFolder && clone._id) {
    for (const child of item.children) {
      await cloneBookmark(child, clone._id);
    }
  }
}

async function pasteBookmarks(parentId: string | undefined) {
  if (!canPasteInto(parentId) || !bookmarkClipboard) return;
  const currentClipboard = bookmarkClipboard;

  if (currentClipboard.mode === 'copy') {
    for (const copy of currentClipboard.copies || []) {
      await cloneBookmark(copy, parentId);
    }
    return;
  }

  for (const id of currentClipboard.ids) {
    const source = Application.instance.storage.bookmarks.find(
      (bookmark) => bookmark._id === id,
    );
    if (!source) continue;

    await Application.instance.storage.updateBookmark(id, {
      parent: parentId,
    });
  }

  bookmarkClipboard = null;
}

function commonMenuItems(appWindow: AppWindow): MenuItemConstructorOptions[] {
  const settings = Application.instance.settings.object;
  const bookmarkBarDisplay = normalizeBookmarkBarDisplay(
    settings.bookmarksBarDisplay,
    settings.bookmarksBar,
  );
  const setBookmarkBarDisplay = (display: BookmarkBarDisplay) => {
    Application.instance.settings.updateSettings({
      bookmarksBarDisplay: display,
    });
  };

  return [
    {
      label: '书签管理器',
      accelerator: 'CmdOrCtrl+Shift+O',
      click: () => openBookmarkManager(appWindow),
    },
    {
      label: '显示书签栏',
      submenu: [
        {
          label: '始终显示',
          type: 'radio',
          checked: bookmarkBarDisplay === 'always',
          click: () => setBookmarkBarDisplay('always'),
        },
        {
          label: '只在新标签页',
          type: 'radio',
          checked: bookmarkBarDisplay === 'newtab',
          click: () => setBookmarkBarDisplay('newtab'),
        },
        {
          label: '永不显示',
          type: 'radio',
          checked: bookmarkBarDisplay === 'never',
          click: () => setBookmarkBarDisplay('never'),
        },
      ],
    },
  ];
}

function createBarMenu(appWindow: AppWindow, folderId?: string) {
  const destinationFolder = getDestinationFolder(folderId);
  const template: MenuItemConstructorOptions[] = [
    {
      label: '添加网页…',
      accelerator: 'CmdOrCtrl+D',
      click: () => addPage(appWindow, destinationFolder?._id),
    },
    {
      label: '添加文件夹…',
      click: () => void addFolder(appWindow, destinationFolder?._id),
    },
    {
      label: '粘贴',
      enabled: canPasteInto(destinationFolder?._id),
      click: () => void pasteBookmarks(destinationFolder?._id),
    },
    { type: 'separator' },
    ...commonMenuItems(appWindow),
  ];

  return Menu.buildFromTemplate(template);
}

export function createMenu(
  appWindow: AppWindow,
  item?: IBookmark | null,
  source: 'bar' | 'manager' = 'bar',
  barFolderId?: string,
) {
  if (!item?._id) return createBarMenu(appWindow, barFolderId);

  const { isFolder } = item;
  const urls = getBookmarkUrls(item);
  const pasteTargetId = isFolder ? item._id : item.parent;
  const currentUrl = appWindow.viewManager.selected?.url;
  const openItems: MenuItemConstructorOptions[] = [
    {
      label: isFolder ? `全部打开（${urls.length} 项）` : '在新标签页中打开',
      enabled: urls.length > 0,
      click: () => {
        openInTabs(appWindow, urls, !isFolder);
      },
    },
    {
      label: isFolder ? '全部在新窗口中打开' : '在新窗口中打开',
      enabled: urls.length > 0,
      click: () => openInWindow(urls, false),
    },
    {
      label: isFolder ? '全部在无痕窗口中打开' : '在无痕窗口中打开',
      enabled: urls.length > 0,
      click: () => openInWindow(urls, true),
    },
    {
      type: 'separator',
    },
  ];

  const template: MenuItemConstructorOptions[] = [
    ...openItems,
    {
      label: isFolder ? '重命名' : '编辑',
      click: () => openEditor(appWindow, item),
    },
    ...(!isFolder && source === 'bar'
      ? [
          {
            label: '替换为当前网址',
            enabled: !!currentUrl && currentUrl !== item.url,
            click: () => replaceWithCurrentUrl(appWindow, item),
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: '剪切',
      accelerator: 'CmdOrCtrl+X',
      click: () => setClipboard(item, 'cut'),
    },
    {
      label: '复制',
      accelerator: 'CmdOrCtrl+C',
      click: () => setClipboard(item, 'copy'),
    },
    {
      label: '粘贴',
      accelerator: 'CmdOrCtrl+V',
      enabled: canPasteInto(pasteTargetId),
      click: () => void pasteBookmarks(pasteTargetId),
    },
    {
      label: '删除',
      click: () => {
        void Application.instance.storage.removeBookmark(item._id);
        // 删除后关闭书签溢出浮层(若开着)。reload-bookmarks 只广播到窗口
        // webContents,到不了浮层 BrowserView,浮层不会自动刷新——直接关掉,
        // 用户重开即看到更新。书签栏右键时浮层未开,hide 幂等无副作用。
        Application.instance.dialogs
          .getExistingPersistent('bookmark-overflow')
          ?.hide();
      },
    },
    { type: 'separator' },
    ...commonMenuItems(appWindow),
  ];

  return Menu.buildFromTemplate(template);
}
