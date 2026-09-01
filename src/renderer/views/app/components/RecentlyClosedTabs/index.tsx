import { nativeImage } from 'electron';

import store from '../../store';
import { getIconByUrlNet } from '~/utils/url';
import { getShellTranslator } from '../../utils/i18n';

// 默认地球图标(与 SidebarTab/BookmarkBar 的 GlobeIcon 同源,#5F6368)。
// nativeImage 不支持 SVG,需经 <img>+canvas 栅格化(见 rasterizeUrl)。
const GLOBE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none">' +
  '<circle cx="12" cy="12" r="8.5" stroke="#5F6368" stroke-width="1.6"/>' +
  '<path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.4 3.5 8.5S14.3 18.1 12 20.5C9.7 18.1 8.5 15.1 8.5 12S9.7 5.9 12 3.5Z" stroke="#5F6368" stroke-width="1.6"/>' +
  '</svg>';
const GLOBE_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  GLOBE_SVG,
)}`;

// 把任意图片源(data URL / http URL / SVG)栅格化成 16x16 nativeImage。
// - data URL 且非 SVG:createFromDataURL 同步快路径(PNG/JPEG 瞬时)。
// - 其它(含 SVG):<img> 加载 → canvas 绘制 → createFromDataURL。SVG 经浏览器解析,
//   规避 nativeImage 不支持 SVG 的限制。带超时,超时/失败返空图标。
// 手法同 tab-context-menu 的 menuIcon。
const rasterizeUrl = (
  src: string,
  timeoutMs = 2000,
): Promise<Electron.NativeImage> => {
  if (!src) return Promise.resolve(nativeImage.createEmpty());

  if (src.startsWith('data:') && !src.includes('image/svg')) {
    try {
      const img = nativeImage.createFromDataURL(src);
      if (!img.isEmpty())
        return Promise.resolve(img.resize({ width: 16, height: 16 }));
    } catch {
      // 损坏的 data URL → 落到 <img> 栅格化兜底
    }
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = (img: Electron.NativeImage) => {
      if (done) return;
      done = true;
      resolve(img);
    };
    const img = new Image();
    const timer = setTimeout(
      () => finish(nativeImage.createEmpty()),
      timeoutMs,
    );
    img.onload = () => {
      clearTimeout(timer);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, 16, 16);
        finish(nativeImage.createFromDataURL(canvas.toDataURL()));
      } else {
        finish(nativeImage.createEmpty());
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      finish(nativeImage.createEmpty());
    };
    img.src = src;
  });
};

// 图标解析链(与 SidebarTab / BookmarkBar 的 <img> 链一致):
// 本地 favicon(data URL 或已缓存的 http)→ 在线图标服务 getIconByUrlNet → 灰地球兜底。
const resolveTabIcon = async (
  favicon: string,
  url: string,
): Promise<Electron.NativeImage> => {
  if (favicon) {
    const local = await rasterizeUrl(favicon);
    if (!local.isEmpty()) return local;
  }
  if (url) {
    const net = await rasterizeUrl(getIconByUrlNet(url));
    if (!net.isEmpty()) return net;
  }
  const globe = await rasterizeUrl(GLOBE_DATA_URL);
  return globe.isEmpty() ? nativeImage.createEmpty() : globe;
};

// 构建工具箱中的最近关闭子菜单，保留原按钮的图标、标题和恢复逻辑。
export const buildRecentlyClosedTabsMenu =
  async (): Promise<Electron.MenuItemConstructorOptions> => {
    const t = getShellTranslator();
    const items = store.tabs.recentlyClosedView;
    if (items.length === 0) {
      return {
        label: t('shellRecentTabsMenu'),
        submenu: [{ label: t('shellNoRecentTabs'), enabled: false }],
      };
    }

    // 预取图标(本地→网络→地球兜底,data URL 瞬时,并发栅格化)。
    const icons = await Promise.all(
      items.map((t) => resolveTabIcon(t.favicon, t.url)),
    );

    return {
      label: t('shellRecentTabsMenu'),
      submenu: items.map((t, i) => ({
        label: t.title,
        icon: icons[i] && !icons[i].isEmpty() ? icons[i] : undefined,
        click: () => store.tabs.restoreClosedTab(t),
      })),
    };
  };
