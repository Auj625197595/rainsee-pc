import {
  Menu,
  nativeImage,
  NativeImage,
  MenuItemConstructorOptions,
  app,
} from 'electron';
import { join } from 'path';
import { IBookmark } from '~/interfaces';
import { getIconByUrlNet, parseBookmarklet } from '~/utils/url';
import { Application } from '../application';
import { AppWindow } from '../windows/app';
import { AddBookmarkDialog } from '../dialogs/add-bookmark';

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
    const img = nativeImage.createFromDataURL(d).resize({ width: 16, height: 16 });
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
  const folderBookmarks = bookmarks.filter(
    ({ static: staticName, parent }) => !staticName && parent === parentID,
  );

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
              .getPersistent('bookmark-overflow')
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

export function createMenu(appWindow: AppWindow, item: IBookmark) {
  const { isFolder, url } = item;
  const folderItems: MenuItemConstructorOptions[] = [
    {
      label: '在新标签页打开',
      click: () => {
        // bookmarklet:不开新标签,在当前网页执行。
        const bookmarklet = parseBookmarklet(url);
        if (bookmarklet !== null) {
          appWindow.viewManager.runBookmarklet(bookmarklet);
        } else {
          appWindow.viewManager.create({ url, active: true });
        }
      },
    },
    {
      type: 'separator',
    },
  ];

  const template: MenuItemConstructorOptions[] = [
    ...(!isFolder ? folderItems : []),
    {
      label: '编辑',
      click: () => {
        const windowBounds = appWindow.win.getBounds();
        const dialog = Application.instance.dialogs.getPersistent(
          'add-bookmark',
        ) as AddBookmarkDialog;
        dialog.open(appWindow.win, windowBounds.width - 20, 72, {
          url: item.url,
          title: item.title,
          bookmark: item,
          favicon: item.favicon,
        });
      },
    },
    {
      label: '删除',
      click: () => {
        Application.instance.storage.removeBookmark(item._id);
        // 删除后关闭书签溢出浮层(若开着)。reload-bookmarks 只广播到窗口
        // webContents,到不了浮层 BrowserView,浮层不会自动刷新——直接关掉,
        // 用户重开即看到更新。书签栏右键时浮层未开,hide 幂等无副作用。
        Application.instance.dialogs
          .getPersistent('bookmark-overflow')
          ?.hide();
      },
    },
  ];

  return Menu.buildFromTemplate(template);
}
