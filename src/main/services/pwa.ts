import { app, nativeImage, shell } from 'electron';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

import { getPwaAppUserModelId, openAppModeWindow } from '../windows/app-mode';
import { Application } from '../application';
import { getMainTranslator } from '../i18n';

// 应用名兜底值("应用"/"App")按当前语言即时翻译,避免模块级缓存。
const appFallbackName = () =>
  getMainTranslator(Application.instance?.settings?.object?.language)(
    'iaAppFallback',
  );

// PWA 安装性检测 + 安装执行。
// 检测仿 translate.ts:detectTranslateState,在 did-finish-load 注入 IIFE,读取页面
// <link rel=manifest> + navigator.serviceWorker,判定是否满足 Chrome 式安装条件。
// 安装 = 打开独立应用窗口(openAppModeWindow)+ 写快捷方式 + 持久化已安装清单。

export interface PwaIcon {
  src: string; // 已解析为绝对 URL(相对 manifest 地址)
  type: string;
  size: number;
  raster: boolean; // false=SVG(nativeImage 不支持,需栅格化)
}

export interface PwaManifest {
  name: string;
  shortName: string;
  startUrl: string; // 绝对 URL
  scope: string;
  display: string;
  themeColor: string;
  backgroundColor: string;
  icon: PwaIcon | null;
}

interface InstalledPwa {
  id: string;
  name: string;
  startUrl: string;
  origin: string;
  scope: string;
  iconPath?: string;
  themeColor?: string;
  installedAt: number;
}

// 注入页面的探测脚本(主世界上下文,可访问 fetch(manifest) 与 navigator.serviceWorker)。
// - 解析 <link rel=manifest>,fetch + 校验 manifest(display/name)。
// - Service Worker 时序坑:did-finish-load 时页面常尚未注册 SW,故轮询最长 4s。
// - 返回 JSON 字符串({canInstall,...} | {canInstall:false})。
const DETECT_CODE = `(function(){
  var out = function(o){ return JSON.stringify(o); };
  var link = document.querySelector('link[rel="manifest" i]');
  if (!link || !link.href) return out({canInstall:false, reason:'no-manifest-link'});
  var manifestUrl = link.href;
  var pageUrl = location.href;
  var resolveUrl = function(u){ try { return new URL(u, manifestUrl).href; } catch(e){ return u; } };
  var checkDisplay = function(d){ d=(d||'').toLowerCase(); return d==='standalone'||d==='fullscreen'||d==='minimal-ui'||d==='override-types'; };
  var pickIcon = function(manifest){
    var icons = manifest.icons || [];
    var best=null, bestScore=-1;
    for (var i=0;i<icons.length;i++){
      var ic = icons[i]||{};
      var src = ic.src; if(!src) continue;
      var mime=(ic.type||'').toLowerCase();
      var isSvg = mime.indexOf('svg')>=0 || String(src).toLowerCase().indexOf('.svg')>=0;
      var sizes=(ic.sizes||'').toLowerCase();
      var sz=0;
      if(sizes==='any') sz=512; else { var m=sizes.match(/(\\d+)x\\d+/); if(m) sz=parseInt(m[1],10); }
      // 优先栅格(PNG/WebP,nativeImage 可直接用);SVG 标记为非栅格,主进程需另作处理。
      var score = sz + (isSvg?0:1000);
      if(score>bestScore){ bestScore=score; best={src:resolveUrl(src), type:ic.type||'', size:sz, raster:!isSvg}; }
    }
    return best;
  };
  return fetch(manifestUrl, {credentials:'include'})
    .then(function(r){ if(!r.ok) return null; return r.json(); })
    .then(function(manifest){
      if(!manifest) return out({canInstall:false, reason:'fetch-failed', manifestUrl:manifestUrl});
      var name = manifest.name || manifest.short_name || '';
      if(!name) return out({canInstall:false, reason:'no-name', manifestUrl:manifestUrl});
      var displayOk = checkDisplay(manifest.display);
      var displayUsed = manifest.display || '';
      if(!displayOk){
        var ov = manifest.display_override || [];
        for (var i=0;i<ov.length;i++){ if(checkDisplay(ov[i])){ displayOk=true; displayUsed=ov[i]||''; break; } }
      }
      if(!displayOk) return out({canInstall:false, reason:'display-not-installable', display: manifest.display||'', manifestUrl:manifestUrl});
      var result = {
        canInstall: false,
        reason: 'pending',
        name: name,
        shortName: manifest.short_name || '',
        startUrl: manifest.start_url ? resolveUrl(manifest.start_url) : pageUrl,
        scope: manifest.scope ? resolveUrl(manifest.scope) : '',
        display: displayUsed,
        themeColor: manifest.theme_color || '',
        backgroundColor: manifest.background_color || '',
        icon: pickIcon(manifest),
        hasIcons: !!(manifest.icons && manifest.icons.length),
        iconCount: (manifest.icons || []).length,
        swSupported: !!(navigator.serviceWorker),
        hasSW: false
      };
      var deadline = Date.now() + 4000;
      var pollSW = function(){
        if (!navigator.serviceWorker) return Promise.resolve(false);
        return navigator.serviceWorker.getRegistrations()
          .then(function(regs){ if (regs && regs.length>0) return true; if (Date.now() >= deadline) return false; return new Promise(function(res){ setTimeout(function(){ res(pollSW()); }, 500); }); })
          .catch(function(){ return false; });
      };
      return pollSW().then(function(hasSW){
        result.hasSW = !!hasSW;
        result.canInstall = !!hasSW;
        result.reason = hasSW ? 'ok' : 'no-sw';
        return out(result);
      });
    })
    .catch(function(e){ return out({canInstall:false, reason:'fetch-error', error: String((e&&e.message)||e), manifestUrl:manifestUrl}); });
})()`;

// QuickMenu「安装为 PWA」:让任意 http(s) 页面可安装为独立应用。
// 设计:页面只做纯同步信息收集(微秒级,不受 SPA 导航/重定向影响——高活跃站点如 4399.com
// 在页面主世界返回 Promise 时会让 executeJavaScript 的等待结果丢失为 undefined),manifest 的
// fetch 与合成全部在主进程完成(原生 fetch 不受页面 CSP/CORS 影响)。合成后再注入一个同步脚本
// 把 manifest 写进页面(实现"注入 JS 使不支持页面获得 manifest")。
// 注:本应用的安装(performInstall)是 Electron 开 --app 窗口 + 快捷方式,不依赖 Service Worker
// (Chromium 亦不允许 blob/data URL 注册 SW),故不强行注入 SW。等同 Chrome「将此站点安装为应用」。

// 同步收集页面信息(无 Promise/fetch/Blob,必然返回 JSON 字符串)。
export const COLLECT_PAGE_INFO_CODE = `(function(){
  var abs = function(u){ try { return new URL(u, location.href).href; } catch(e){ return u; } };
  var favs = [];
  var sels = ['link[rel="apple-touch-icon"]','link[rel="apple-touch-icon-precomposed"]','link[rel="icon"]','link[rel="shortcut icon"]','link[rel="mask-icon"]'];
  for (var s=0;s<sels.length;s++){
    var ns = document.querySelectorAll(sels[s]);
    for (var i=0;i<ns.length;i++){
      var n=ns[i]; var h=n.getAttribute('href'); if(!h) continue;
      var sz=(n.getAttribute('sizes')||'').toLowerCase(); var v=0;
      if(sz==='any') v=512; else { var m=sz.match(/(\\d+)x\\d+/); if(m) v=parseInt(m[1],10); }
      favs.push({href:abs(h), type:n.getAttribute('type')||'', size:v, prio:(4-s)});
    }
  }
  var ml=document.querySelector('link[rel="manifest" i]');
  var tc='';
  var tm=document.querySelector('meta[name="theme-color" i]'); if(tm) tc=tm.getAttribute('content')||'';
  return JSON.stringify({
    title:(document.title||'').trim(),
    host:(location.hostname||'').replace(/^www\\./,''),
    origin:location.origin,
    pageUrl:location.href.split('#')[0],
    themeColor:tc,
    manifestHref:(ml&&ml.href)?ml.href:'',
    favicons:favs
  });
})()`;

export interface CollectedPageInfo {
  title: string;
  host: string;
  origin: string;
  pageUrl: string;
  themeColor: string;
  manifestHref: string;
  favicons: { href: string; type: string; size: number; prio: number }[];
}

const DISPLAY_OK = ['standalone', 'fullscreen', 'minimal-ui'];
const isDisplayOk = (d: string) => DISPLAY_OK.includes((d || '').toLowerCase());

// 从收集到的 favicon 选最佳(apple-touch 优先,其次大尺寸栅格)。
const pickFaviconFromInfo = (info: CollectedPageInfo): PwaIcon => {
  let best: CollectedPageInfo['favicons'][0] | null = null;
  let bestScore = -1;
  for (const f of info.favicons || []) {
    const score = f.size + f.prio * 1000;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  const href = best?.href || info.origin + '/favicon.ico';
  const type = best?.type || '';
  const size = best?.size || 0;
  const isSvg =
    type.toLowerCase().includes('svg') || href.toLowerCase().includes('.svg');
  return { src: href, type, size, raster: !isSvg };
};

// 主进程原生 fetch + 解析 web manifest,归一化为 PwaManifest。失败返回 null。
const manifestFromWeb = async (
  info: CollectedPageInfo,
): Promise<PwaManifest | null> => {
  if (!info.manifestHref) return null;
  try {
    const resp = await fetch(info.manifestHref, { credentials: 'include' });
    if (!resp.ok) return null;
    const m = await resp.json();
    if (!m) return null;
    const name = m.name || m.short_name || info.title || info.host;
    if (!name) return null;
    let disp = m.display || '';
    if (!isDisplayOk(disp)) {
      for (const d of m.display_override || []) {
        if (isDisplayOk(d)) {
          disp = d;
          break;
        }
      }
    }
    if (!isDisplayOk(disp)) disp = 'standalone';
    const absUrl = (u: string) => {
      try {
        return new URL(u, info.manifestHref).href;
      } catch {
        return u;
      }
    };
    let icon: PwaIcon | null = null;
    let bestScore = -1;
    for (const ic of m.icons || []) {
      if (!ic.src) continue;
      const mime = (ic.type || '').toLowerCase();
      const isSvg =
        mime.includes('svg') || String(ic.src).toLowerCase().includes('.svg');
      const sizes = (ic.sizes || '').toLowerCase();
      let sz = 0;
      if (sizes === 'any') sz = 512;
      else {
        const mm = sizes.match(/(\d+)x\d+/);
        if (mm) sz = parseInt(mm[1], 10);
      }
      const score = sz + (isSvg ? 0 : 1000);
      if (score > bestScore) {
        bestScore = score;
        icon = {
          src: absUrl(ic.src),
          type: ic.type || '',
          size: sz,
          raster: !isSvg,
        };
      }
    }
    return {
      name,
      shortName: m.short_name || '',
      startUrl: m.start_url ? absUrl(m.start_url) : info.pageUrl,
      scope: m.scope ? absUrl(m.scope) : '',
      display: disp,
      themeColor: m.theme_color || '',
      backgroundColor: m.background_color || '',
      icon,
    };
  } catch (e) {
    console.log('[pwa] manifest fetch failed', info.manifestHref, e);
    return null;
  }
};

// 合成 manifest(title/favicon/theme-color),用于无原生 manifest 的页面。
const synthesizeManifest = (
  info: CollectedPageInfo,
  fallbackUrl: string,
): PwaManifest => {
  const name = info.title || info.host || appFallbackName();
  return {
    name,
    shortName: name.slice(0, 12),
    startUrl: info.pageUrl || fallbackUrl,
    scope: (info.origin || '') + '/',
    display: 'standalone',
    themeColor: info.themeColor || '#3b6fe8',
    backgroundColor: '#ffffff',
    icon: pickFaviconFromInfo(info),
  };
};

// 构造可安装 manifest:优先原生 manifest(主进程 fetch),否则合成。synthetic 标记是否为合成。
export const buildInstallableManifest = async (
  info: CollectedPageInfo,
  fallbackUrl: string,
): Promise<{ manifest: PwaManifest; synthetic: boolean }> => {
  const real = await manifestFromWeb(info);
  if (real) return { manifest: real, synthetic: false };
  return { manifest: synthesizeManifest(info, fallbackUrl), synthetic: true };
};

// 合成 manifest 的 web 形态 JSON(注入页面用)。
export const manifestToWebJson = (m: PwaManifest): string =>
  JSON.stringify({
    name: m.name,
    short_name: m.shortName,
    start_url: m.startUrl,
    scope: m.scope,
    display: m.display,
    theme_color: m.themeColor,
    background_color: m.backgroundColor,
    icons: m.icon
      ? [
          {
            src: m.icon.src,
            sizes: m.icon.size ? `${m.icon.size}x${m.icon.size}` : '192x192',
            type: m.icon.type,
            purpose: 'any',
          },
        ]
      : [],
  });

// 注入脚本:把合成 manifest 写进页面(Blob URL + <link rel=manifest>),fire-and-forget。
// base64 承载 JSON 避免转义问题。实现"注入 JS 使不支持页面获得 manifest"。
export const injectManifestCode = (manifestWebJson: string): string => {
  const b64 = Buffer.from(manifestWebJson).toString('base64');
  return `(function(){
  try {
    var json = atob("${b64}");
    var blob = new Blob([json], {type:'application/manifest+json'});
    var url = URL.createObjectURL(blob);
    var old = document.querySelector('link[rel="manifest" i]');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var link = document.createElement('link');
    link.setAttribute('rel','manifest'); link.setAttribute('href', url);
    document.head.appendChild(link);
  } catch(e) {}
})()`;
};

export const detectPwaState = async (
  webContents: Electron.WebContents,
): Promise<{ canInstall: boolean; manifest: PwaManifest | null }> => {
  if (!webContents || webContents.isDestroyed()) {
    return { canInstall: false, manifest: null };
  }
  const pageUrl = webContents.getURL();
  try {
    const raw = await webContents.executeJavaScript(DETECT_CODE, true);
    // 诊断日志:打出原始返回,便于排查"为什么图标没出现"。主进程 console → data/logs/main-*.log
    console.log('[pwa] detect raw', pageUrl, raw);
    if (!raw) return { canInstall: false, manifest: null };
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.canInstall) {
      console.log(
        '[pwa] not installable',
        pageUrl,
        'reason=' + (parsed && parsed.reason),
        'display=' + (parsed && parsed.display),
        'swSupported=' + (parsed && parsed.swSupported),
        'hasIcons=' + (parsed && parsed.hasIcons),
        'iconCount=' + (parsed && parsed.iconCount),
        'manifestUrl=' + (parsed && parsed.manifestUrl),
        'error=' + (parsed && parsed.error),
      );
      return { canInstall: false, manifest: null };
    }
    console.log(
      '[pwa] installable',
      pageUrl,
      parsed.name,
      'icon=' + (parsed.icon && parsed.icon.src),
    );
    return { canInstall: true, manifest: parsed as PwaManifest };
  } catch (e) {
    console.log('[pwa] detect error', pageUrl, e);
    return { canInstall: false, manifest: null };
  }
};

// ===== 已安装清单(userData/installed-pwas.json,origin 键) =====

const installedFile = () =>
  join(app.getPath('userData'), 'installed-pwas.json');
const installedDir = () => join(app.getPath('userData'), 'installed-pwas');

export const originOf = (url: string): string => {
  try {
    return new URL(url).origin || '';
  } catch {
    return '';
  }
};

const safeId = (origin: string): string => {
  return (
    (origin || 'app')
      .replace(/[^a-z0-9]+/gi, '_')
      .toLowerCase()
      .slice(0, 64) || 'app'
  );
};

let installedCache: InstalledPwa[] | null = null;

const loadInstalled = (): InstalledPwa[] => {
  if (installedCache) return installedCache;
  try {
    const f = installedFile();
    if (existsSync(f)) {
      const data = JSON.parse(readFileSync(f, 'utf8') || '[]');
      installedCache = Array.isArray(data) ? data : [];
    } else {
      installedCache = [];
    }
  } catch {
    installedCache = [];
  }
  return installedCache!;
};

const saveInstalled = (list: InstalledPwa[]) => {
  const target = installedFile();
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(list, null, 2), 'utf8');
    renameSync(temp, target);
    installedCache = list;
  } finally {
    rmSync(temp, { force: true });
  }
};

export const isOriginInstalled = (origin: string): boolean => {
  if (!origin) return false;
  return loadInstalled().some((p) => p.origin === origin);
};

export const isUrlInstalled = (url: string): boolean =>
  isOriginInstalled(originOf(url));

// 从已安装清单按 url 的 origin 查询名称/图标/主题色。
// --app=<url> 冷启动/二次启动时,快捷方式只存 url,名称与图标由此派生,
// 避免把含空格的 Windows 路径塞进命令行参数被空格切断。
export const getInstalledMeta = (
  url: string,
): { name?: string; iconPath?: string; themeColor?: string } | null => {
  const origin = originOf(url);
  if (!origin) return null;
  const rec = loadInstalled().find((p) => p.origin === origin);
  if (!rec) return null;
  return { name: rec.name, iconPath: rec.iconPath, themeColor: rec.themeColor };
};

// ===== 图标下载 + 落盘(供独立窗口与 .lnk 共用) =====

const downloadIcon = async (url: string): Promise<Buffer | null> => {
  if (!url) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const ab = await resp.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
};

// 把单个 PNG buffer 包成 PNG-in-ICO(Windows Vista+ 原生支持 PNG 编码的 ICO 条目)。
// Windows 快捷方式 .lnk 的图标字段只认 .ico/.exe/.dll,直接给 .png 会显示空白图标。
export const buildIcoFromPng = (
  png: Buffer,
  width: number,
  height: number,
): Buffer => {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type = 1 (ICO)
  dir.writeUInt16LE(1, 4); // 条目数 = 1
  const entry = Buffer.alloc(16);
  entry.writeUInt8(width >= 256 ? 0 : width, 0); // 宽(0 表示 256)
  entry.writeUInt8(height >= 256 ? 0 : height, 1); // 高
  entry.writeUInt8(0, 2); // color count
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bit count
  entry.writeUInt32LE(png.length, 8); // 图像字节数
  entry.writeUInt32LE(22, 12); // 偏移 = 6(dir) + 16(entry)
  return Buffer.concat([dir, entry, png]);
};

// 读取用户本地图标,否则依次下载 manifest 图标与 favicon 回退 → nativeImage → 落盘。
// 所有候选均不可解析时返回 null(不阻塞安装,窗口/快捷方式回退系统默认图标)。
// Windows 下落盘为 .ico(快捷方式必需);其它平台落盘 .png(供独立窗口图标用)。
const prepareIcon = async (
  manifest: PwaManifest,
  localIconPath?: string,
  fallbackIconUrl?: string,
): Promise<{ path?: string; image?: Electron.NativeImage } | null> => {
  let img: Electron.NativeImage | null = null;

  if (localIconPath) {
    try {
      const local = nativeImage.createFromPath(localIconPath);
      if (!local.isEmpty()) img = local;
    } catch {
      img = null;
    }
  }

  if (!img) {
    const urls = [manifest.icon?.src, fallbackIconUrl].filter(
      (url, index, all): url is string => !!url && all.indexOf(url) === index,
    );
    for (const url of urls) {
      const buf = await downloadIcon(url);
      if (!buf) continue;
      try {
        const downloaded = nativeImage.createFromBuffer(buf);
        if (!downloaded.isEmpty()) {
          img = downloaded;
          break;
        }
      } catch {
        // 继续尝试下一个 favicon 候选。
      }
    }
  }

  if (!img || img.isEmpty()) return null;
  // 统一缩到 256:兼顾清晰度与文件体积,且 256 是 ICO 大图标的常规上限。
  const resized = img.resize({ width: 256, height: 256 });
  const size = resized.getSize();
  try {
    if (!existsSync(installedDir()))
      mkdirSync(installedDir(), { recursive: true });
    const id = safeId(originOf(manifest.startUrl));
    const isWin = process.platform === 'win32';
    const ext = isWin ? 'ico' : 'png';
    const p = join(installedDir(), `${id}.${ext}`);
    const png = resized.toPNG();
    writeFileSync(
      p,
      isWin ? buildIcoFromPng(png, size.width, size.height) : png,
    );
    return { path: p, image: resized };
  } catch {
    return { image: resized };
  }
};

// ===== 安装执行 =====

export interface InstallOptions {
  createDesktopShortcut: boolean;
  createStartMenu: boolean;
  localIconPath?: string;
  fallbackIconUrl?: string;
}

const sanitizeFileName = (name: string): string => {
  return (name || appFallbackName())
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 80) || appFallbackName();
};

// Windows 快捷方式(.lnk)。shell.writeShortcutLink 仅 Windows 可用,其它平台跳过。
const createShortcuts = (
  name: string,
  startUrl: string,
  args: string[],
  iconPath: string | undefined,
  opts: InstallOptions,
): (() => void) => {
  if (process.platform !== 'win32') return () => {};
  const commandLineArgs = args
    .map((arg) => (/[\s"]/u.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg))
    .join(' ');
  const details: Electron.ShortcutDetails = {
    target: process.execPath,
    args: commandLineArgs,
    description: name,
    icon: iconPath,
    iconIndex: 0,
    appUserModelId: getPwaAppUserModelId(startUrl),
  };
  const safeName = sanitizeFileName(name);
  const targets = [
    opts.createDesktopShortcut
      ? join(app.getPath('desktop'), `${safeName}.lnk`)
      : null,
    opts.createStartMenu
      ? join(
          app.getPath('appData'),
          'Microsoft',
          'Windows',
          'Start Menu',
          'Programs',
          `${safeName}.lnk`,
        )
      : null,
  ].filter((target): target is string => !!target);

  if (opts.createStartMenu) {
    const programs = join(
      app.getPath('appData'),
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
    );
    if (!existsSync(programs)) mkdirSync(programs, { recursive: true });
  }

  const snapshots = targets.map((path) => ({
    path,
    contents: existsSync(path) ? readFileSync(path) : null,
  }));
  const rollback = () => {
    for (const snapshot of snapshots) {
      if (snapshot.contents) writeFileSync(snapshot.path, snapshot.contents);
      else rmSync(snapshot.path, { force: true });
    }
  };

  try {
    for (const target of targets) {
      const operation: 'create' | 'update' = existsSync(target)
        ? 'update'
        : 'create';
      if (!shell.writeShortcutLink(target, operation, details)) {
        throw new Error(`Failed to write shortcut: ${target}`);
      }
    }
  } catch (error) {
    try {
      rollback();
    } catch (rollbackError) {
      console.log('[pwa] shortcut rollback failed', rollbackError);
    }
    throw error;
  }

  return rollback;
};

// 旧开发版本创建的 .lnk 只传了 --app，目标 electron.exe 会进入默认应用而非
// 当前项目。启动主浏览器时仅更新已经存在的快捷方式，既修复旧入口，也不会
// 改变用户安装时选择的桌面/开始菜单位置。
export const repairDevelopmentPwaShortcuts = () => {
  if (process.platform !== 'win32' || app.isPackaged) return;

  for (const item of loadInstalled()) {
    const safeName = sanitizeFileName(item.name);
    const desktopShortcut = join(app.getPath('desktop'), `${safeName}.lnk`);
    const startMenuShortcut = join(
      app.getPath('appData'),
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      `${safeName}.lnk`,
    );
    const createDesktopShortcut = existsSync(desktopShortcut);
    const createStartMenu = existsSync(startMenuShortcut);
    if (!createDesktopShortcut && !createStartMenu) continue;

    try {
      createShortcuts(
        item.name,
        item.startUrl,
        [app.getAppPath(), `--app=${item.startUrl}`],
        item.iconPath,
        { createDesktopShortcut, createStartMenu },
      );
    } catch (error) {
      console.log('[pwa] development shortcut repair failed', item.name, error);
    }
  }
};

// 执行安装:下载图标 → 写快捷方式 → 持久化 → 打开独立窗口。
// 返回 {installed} 供调用方决定后续(如标记 tab 已安装)。
export const performInstall = async (
  manifest: PwaManifest,
  pageUrl: string,
  opts: InstallOptions,
): Promise<{ installed: boolean }> => {
  const origin = originOf(manifest.startUrl || pageUrl);
  const name = manifest.name || manifest.shortName || appFallbackName();
  const startUrl = manifest.startUrl || pageUrl;

  const icon = await prepareIcon(
    manifest,
    opts.localIconPath,
    opts.fallbackIconUrl,
  );
  const iconPath = icon?.path;
  const iconImage = icon?.image;

  // 1) 快捷方式:仅带 --app=<url>。名称/图标在冷启动时由 getInstalledMeta(url)
  //    从本清单派生,避免 Windows 路径中的空格被命令行参数切断。先验证快捷方式
  //    可写,失败时不持久化安装记录、也不打开一个实际未完成安装的窗口。
  // 开发环境 process.execPath 指向 electron.exe。快捷方式若只传 --app，
  // Electron 会启动自身的 default_app.asar，跳过本项目的 app-mode 窗口与
  // PWA 顶栏；因此必须把当前项目入口作为第一个位置参数。正式安装包的
  // process.execPath 已是雨见可执行文件，不需要也不能附带 appPath。
  const args = [
    ...(app.isPackaged ? [] : [app.getAppPath()]),
    `--app=${startUrl}`,
  ];
  const rollbackShortcuts = createShortcuts(
    name,
    startUrl,
    args,
    iconPath,
    opts,
  );

  // 2) 持久化已安装清单(origin 键去重)
  const list = loadInstalled().filter((p) => p.origin !== origin);
  list.push({
    id: safeId(origin),
    name,
    startUrl,
    origin,
    scope: manifest.scope || '',
    iconPath,
    themeColor: manifest.themeColor || '',
    installedAt: Date.now(),
  });
  try {
    saveInstalled(list);
  } catch (error) {
    try {
      rollbackShortcuts();
    } catch (rollbackError) {
      console.log('[pwa] shortcut rollback failed', rollbackError);
    }
    throw error;
  }

  // 3) 安装成功后打开独立应用窗口
  try {
    openAppModeWindow({
      url: startUrl,
      name,
      icon:
        process.platform === 'win32'
          ? iconPath || iconImage
          : iconImage || iconPath,
      themeColor: manifest.themeColor || manifest.backgroundColor || undefined,
    });
  } catch (error) {
    console.log('[pwa] installed but failed to open app window', error);
  }

  return { installed: true };
};
