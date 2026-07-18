import {app, net, ipcMain} from 'electron';
import {existsSync, promises as fsp} from 'fs';
import {dirname, join, resolve, parse as parsePath} from 'path';
import {fileURLToPath, pathToFileURL} from 'url';
import {Application} from '../application';
import {getWebUIURL} from '~/common/webui-main';
import {showPageToast} from '../menus/common-actions';
import {IMAGE_FILE_EXTS} from '~/constants/files';
import type {AppWindow} from '../windows';
import {
  registerLocalImage,
  resolveLocalImageUrl,
} from './local-image-registry';

// 看图模式:右键收集当前网页所有图片 → 新标签页展示 → 多选下载。
// 复用 yjllq:// 内置页机制 + 通用 ipcInvoke 桥接。下载复用 MediaDownloadManager(逐张)
// 与主进程 jszip 打包(zip),防盗链靠收集时一并保存的原网页 Referer/Cookie/UA。

// jszip 用 export = 导出;主进程经 webpack electron-main 外置为 node 依赖,直接 require 最稳。
const JSZip: any = require('jszip');

export interface ImageItem {
  url: string;
  width: number;
  height: number;
  alt: string;
  type: string; // img | picture | link | poster | background
}

interface CollectedData {
  images: ImageItem[];
  initialPreviewUrl?: string;
  pageUrl: string;
  referrer: string;
  // 绕防盗链用:下载时作为请求头带上(逐张 + zip 共用)。
  referer: string;
  cookies: string;
  userAgent: string;
}

// sessionId -> 收集结果。页面加载后用 image-viewer-get 主动拉取。
const imageViewerCache = new Map<string, CollectedData>();
let registered = false;

const openImageViewerSession = (
  data: CollectedData,
  targetWindow?: AppWindow,
) => {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  imageViewerCache.set(id, data);
  setTimeout(() => imageViewerCache.delete(id), 60000);

  const appWindow = targetWindow || Application.instance.windows.current;
  if (!appWindow) throw new Error('no active application window');
  const url = getWebUIURL('image-viewer') + `?id=${id}`;
  appWindow.viewManager.create({url, active: true} as any, true);
};

// ──────────────────────────────────────────────────────────────────────────
// 注入到原网页执行:收集所有可见图片,按 DOM 顺序去重返回。
// ⚠️ 此函数会被 .toString() 序列化注入页面,内部禁止引用任何外部作用域变量。
// ──────────────────────────────────────────────────────────────────────────
const collectImages = function () {
  const base = document.baseURI;

  const abs = (href: string): string => {
    if (!href) return '';
    try {
      return new URL(href, base).href;
    } catch {
      return href || '';
    }
  };

  // 遍历父链查隐藏(display:none / visibility:hidden / opacity:0)。
  const isHidden = (el: Element): boolean => {
    let cur: Element | null = el;
    while (cur) {
      const s = window.getComputedStyle(cur as HTMLElement);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  };

  const IMG_EXT = /\.(jpe?g|png|gif|webp|bmp|svg|avif|ico|tiff?)([?#]|$)/i;
  const isImageUrl = (u: string): boolean => !!u && IMG_EXT.test(u);

  // 从 srcset "a 1x, b 2x" / "a 100w, b 200w" 取最大候选 url。
  const pickFromSrcset = (srcset: string): string => {
    if (!srcset) return '';
    const parts = srcset.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return '';
    let best = '';
    let bestW = -1;
    for (const p of parts) {
      const seg = p.split(/\s+/);
      const u = seg[0];
      const w = seg[1] ? parseFloat(seg[1]) : 0;
      if (w > bestW) {
        bestW = w;
        best = u;
      }
    }
    return best || parts[parts.length - 1].split(/\s+/)[0];
  };

  const seen = new Set<string>();
  const out: any[] = [];

  const push = (url: string, w: number, h: number, alt: string, type: string) => {
    const a = abs(url);
    if (!a || seen.has(a)) return;
    if (a.startsWith('data:') && a.length > 50000) return; // 过滤超大 base64
    if (w > 0 && h > 0 && w < 2 && h < 2) return; // 1x1 追踪像素
    seen.add(a);
    out.push({url: a, width: w || 0, height: h || 0, alt: alt || '', type});
  };

  // 1) <img> —— currentSrc 优先,回退懒加载 data-*, 再回退 srcset 最大候选
  const imgs = Array.from(document.getElementsByTagName('img'));
  for (const img of imgs) {
    if (isHidden(img)) continue;
    let url: string = (img as any).currentSrc || img.getAttribute('src') || '';
    if (!url || url === 'data:') {
      url =
        img.getAttribute('data-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-lazy-src') ||
        img.getAttribute('data-actualsrc') ||
        '';
    }
    if (!url) {
      url = pickFromSrcset(img.getAttribute('srcset') || (img as any).srcset || '');
    }
    if (!url) continue;
    const w = (img as any).naturalWidth || img.clientWidth || 0;
    const h = (img as any).naturalHeight || img.clientHeight || 0;
    // 占位小图过滤(保留 0:懒加载未触发时 naturalWidth 可能为 0)。
    if (w > 0 && h > 0 && w * h < 100) continue;
    push(url, w, h, img.getAttribute('alt') || img.getAttribute('title') || '', 'img');
  }

  // 2) <picture><source srcset>
  const pics = Array.from(document.getElementsByTagName('picture'));
  for (const pic of pics) {
    if (isHidden(pic)) continue;
    const sources = pic.getElementsByTagName('source');
    for (let i = 0; i < sources.length; i++) {
      const url = pickFromSrcset(sources[i].getAttribute('srcset') || '');
      if (url) push(url, 0, 0, '', 'picture');
    }
  }

  // 3) <a href> 指向图片
  const anchors = Array.from(document.getElementsByTagName('a'));
  for (const a of anchors) {
    if (isHidden(a)) continue;
    const href = a.getAttribute('href') || '';
    if (isImageUrl(href)) push(href, 0, 0, a.getAttribute('title') || '', 'link');
  }

  // 4) <video poster>
  const vids = Array.from(document.getElementsByTagName('video'));
  for (const v of vids) {
    if (isHidden(v)) continue;
    const poster = v.getAttribute('poster');
    if (poster) push(poster, 0, 0, '', 'poster');
  }

  // 5) CSS background-image(仅元素 ≥ 64px,过滤装饰小图)
  const all = document.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i] as HTMLElement;
    if (isHidden(el)) continue;
    const bg = window.getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none') continue;
    const m = bg.match(/url\((['"]?)([^'")]+)\1\)/);
    if (m && m[2]) {
      const rect = el.getBoundingClientRect();
      if (rect.width >= 64 && rect.height >= 64) {
        push(m[2], Math.round(rect.width), Math.round(rect.height), '', 'background');
      }
    }
  }

  return {
    images: out,
    pageUrl: location.href,
    referrer: document.referrer,
  };
};

// 下载目录:优先设置的 downloadsPath,兜底系统下载目录。
const getDownloadDir = (): string => {
  try {
    const configured = (Application.instance?.settings?.object as any)?.downloadsPath;
    if (configured) return configured;
  } catch {
    // 忽略
  }
  return app.getPath('downloads');
};

// 去重保存路径(name (1).ext 规则,与原生下载一致)。
const uniqueSavePath = (fileName: string): string => {
  const dir = getDownloadDir();
  let savePath = resolve(dir, fileName);
  let i = 1;
  while (existsSync(savePath)) {
    const {name, ext} = parsePath(fileName);
    savePath = resolve(dir, `${name} (${i})${ext}`);
    i++;
  }
  return savePath;
};

// 用 net.request 拉取一张图为 Buffer(手动带 Referer/Cookie/UA 绕防盗链)。失败返回 null。
const fetchToBuffer = (
  url: string,
  headers: {referer?: string; cookie?: string; userAgent?: string},
): Promise<Buffer | null> => {
  const registeredLocalPath = resolveLocalImageUrl(url);
  if (registeredLocalPath) {
    return fsp.readFile(registeredLocalPath).catch(() => null);
  }
  if (url.startsWith('file:')) {
    try {
      return fsp.readFile(fileURLToPath(url)).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  }

  return new Promise((r) => {
    let req: any;
    try {
      req = net.request(url);
    } catch {
      r(null);
      return;
    }
    if (headers.referer) {
      try {
        req.setHeader('Referer', headers.referer);
      } catch {
        // 忽略
      }
    }
    if (headers.cookie) {
      try {
        req.setHeader('Cookie', headers.cookie);
      } catch {
        // 忽略
      }
    }
    if (headers.userAgent) {
      try {
        req.setHeader('User-Agent', headers.userAgent);
      } catch {
        // 忽略
      }
    }
    const chunks: Buffer[] = [];
    req.on('response', (response: any) => {
      if (response.statusCode >= 400) {
        r(null);
        return;
      }
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => r(Buffer.concat(chunks)));
    });
    req.on('error', () => r(null));
    req.end();
  });
};

// 右键「看图模式」入口:在原网页收集图片 + 取防盗链头 → 暂存 → 开新标签页。
export const enterImageViewer = async (webContents: Electron.WebContents) => {
  let raw: {images: ImageItem[]; pageUrl: string; referrer: string} | null = null;
  try {
    raw = await webContents.executeJavaScript(`(${collectImages.toString()})()`, true);
  } catch (e) {
    console.error('[image-viewer] collect failed:', e);
    showPageToast(webContents, '收集图片失败');
    return;
  }
  if (!raw || !Array.isArray(raw.images) || raw.images.length === 0) {
    showPageToast(webContents, '未找到图片');
    return;
  }

  // 取原网页 session 的 cookie(HttpOnly 也包含)+ UA,供下载绕防盗链。
  let cookies = '';
  try {
    const list = await webContents.session.cookies.get({url: raw.pageUrl});
    cookies = list.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {
    // 忽略:多数防盗链只查 Referer
  }
  let userAgent = '';
  try {
    userAgent = webContents.userAgent || '';
  } catch {
    // 忽略
  }

  const data: CollectedData = {
    images: raw.images,
    pageUrl: raw.pageUrl,
    referrer: raw.referrer,
    referer: raw.pageUrl,
    cookies,
    userAgent,
  };

  try {
    openImageViewerSession(data);
  } catch (e) {
    console.error('[image-viewer] create tab failed:', e);
    showPageToast(webContents, '打开失败');
    return;
  }
  showPageToast(webContents, `已收集 ${raw.images.length} 张图片`);
};

// 地址栏拖入本地图片：读取该图片所在目录的同类文件，并复用看图模式列表页。
export const enterLocalImageViewer = async (
  filePath: string,
  targetWindow?: AppWindow,
) => {
  const sourcePath = resolve(filePath);
  const sourceDirectory = dirname(sourcePath);
  const entries = await fsp.readdir(sourceDirectory, {withFileTypes: true});
  const fileNames = entries
    .filter((entry) => {
      if (!entry.isFile()) return false;
      const ext = parsePath(entry.name).ext.slice(1).toLowerCase();
      return IMAGE_FILE_EXTS.includes(ext);
    })
    .map((entry) => entry.name)
    .sort((left, right) =>
      left.localeCompare(right, 'zh-CN', {numeric: true, sensitivity: 'base'}),
    );

  let initialPreviewUrl = '';
  const normalizedSourcePath = sourcePath.toLowerCase();
  const images: ImageItem[] = fileNames.map((fileName) => {
    const localPath = join(sourceDirectory, fileName);
    const url = registerLocalImage(localPath);
    if (resolve(localPath).toLowerCase() === normalizedSourcePath) {
      initialPreviewUrl = url;
    }
    return {
      url,
      width: 0,
      height: 0,
      alt: fileName,
      type: 'local',
    };
  });
  if (!images.length) throw new Error('no images found in source directory');

  openImageViewerSession(
    {
      images,
      initialPreviewUrl,
      pageUrl: pathToFileURL(sourcePath).toString(),
      referrer: '',
      referer: '',
      cookies: '',
      userAgent: '',
    },
    targetWindow,
  );
};

// 主进程 IPC 注册。在 application 启动时调用一次。
export const setupImageViewerIPC = () => {
  if (registered) return;
  registered = true;

  // 页面主动拉取本会话收集到的图片(URL ?id= 携带 sessionId)。
  // 首次返回后留 30s 再清理,便于页面刷新重拉。
  ipcMain.handle('image-viewer-get', (_e, id: string): CollectedData | null => {
    const data = imageViewerCache.get(id);
    if (data) setTimeout(() => imageViewerCache.delete(id), 30000);
    return data || null;
  });

  // 把选中图片在主进程打包成 zip 下载(逐张 net.request 带 Referer/Cookie → jszip → 落盘)。
  ipcMain.handle(
    'image-viewer-pack-zip',
    async (e, payload: {images: ImageItem[]; referer?: string; cookie?: string; userAgent?: string}) => {
      const images = Array.isArray(payload?.images) ? payload.images : [];
      if (!images.length) return {ok: false, error: 'no-images'};

      const headers = {
        referer: payload?.referer,
        cookie: payload?.cookie,
        userAgent: payload?.userAgent,
      };

      const zip = new JSZip();
      const used = new Set<string>();
      let added = 0;

      for (let i = 0; i < images.length; i++) {
        const buf = await fetchToBuffer(images[i].url, headers);
        try {
          e.sender.send('image-viewer-zip-progress', {
            done: i + 1,
            total: images.length,
          });
        } catch {
          // sender 可能已销毁
        }
        if (!buf) continue;

        let host = 'image';
        try {
          host = new URL(images[i].url).hostname || 'image';
        } catch {
          // 忽略
        }
        const m = images[i].url
          .split('?')[0]
          .split('#')[0]
          .match(/\.([a-z0-9]{2,4})$/i);
        const ext = m ? m[1].toLowerCase() : 'jpg';
        let name = `${String(i + 1).padStart(3, '0')}-${host}.${ext}`;
        let n = 1;
        while (used.has(name)) {
          name = `${String(i + 1).padStart(3, '0')}-${host} (${n}).${ext}`;
          n++;
        }
        used.add(name);
        zip.file(name, buf);
        added++;
      }

      if (added === 0) return {ok: false, error: 'all-failed'};

      try {
        const buf = await zip.generateAsync({type: 'nodebuffer'});
        const ts = Date.now();
        const savePath = uniqueSavePath(`images-${ts}.zip`);
        await fsp.writeFile(savePath, buf);
        return {ok: true, path: savePath, count: added};
      } catch (err) {
        console.error('[image-viewer] zip generate/write failed:', err);
        return {ok: false, error: String(err)};
      }
    },
  );
};
