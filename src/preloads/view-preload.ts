import {clipboard, contextBridge, ipcRenderer, nativeImage, shell, webFrame, webUtils} from 'electron';
import * as fs from 'fs';
import * as path from 'path';

import AutoComplete from './models/auto-complete';
import {getTheme} from '~/utils/themes';
import {ERROR_PROTOCOL, WEBUI_BASE_URL} from '~/constants/files';
import './selection-translate';
import './profile-fingerprint';

// 本 preload 自身使用的 Node process 引用。contextIsolation:false 下页面与
// preload 共享同一个全局对象,下方清理会把 window.process 删除;裸标识符
// `process` 在运行期将解析失败。因此本文件所有运行期 `process` 引用统一改走
// __nodeProcess(webpack 的编译期 process.env.* 替换不受影响)。
const __nodeProcess = process;

// ===== 对齐 Chrome 语义:普通网页上下文不得存在 Node 全局 =====================
// Electron 在 sandbox:false + nodeIntegration:false 的渲染器里仍会给页面世界
// 注入完整 Node `process`(含 process.versions.node),但不会注入 require/
// module/exports。真实 Chrome 里这些全局全部不存在。后果:UMD 库(如
// js-md5@0.7.3,Node 检测条件仅 `typeof process==='object' &&
// process.versions.node`,无 process.type 防线)被误判为 Node 环境,进
// nodeWrap 执行 eval("require('crypto')") → ReferenceError: require is not
// defined → 脚本 bundle 顶层炸掉(Tampermonkey 用户脚本 LinkSwift 全挂)。
// js-sha256 等带 `process.type != 'renderer'` 防线的库不受影响,恰说明泄漏
// 面 = window.process。
//
// 范围:仅普通网页(http/https/file 等远程内容)。例外:
//   - 内部页(WEBUI/yjllq-error/about:blank)——打包产物自身可能探测环境;
//   - koodoreader(yjllq://web.koodoreader.com)——它依赖 window.process 判定
//     isElectron 读本地文件(见下方 koodo-preload 段,会重设回来)。
// 本 preload 自身一律改用顶部捕获的 __nodeProcess,不依赖页面全局。
try {
  const href = window.location.href;
  const isChromeSemanticExempt =
    window.location.protocol === 'yjllq:' ||
    href.startsWith(WEBUI_BASE_URL) ||
    window.location.protocol === `${ERROR_PROTOCOL}:` ||
    href === 'about:blank';
  if (!isChromeSemanticExempt) {
    // window 上逐个 delete(configurable 属性可直接删;不可配置则 defineProperty
    // 覆写为 undefined,两种情况下 `typeof process` 均回到 'undefined')。
    const globalsToHide = ['process', 'Buffer', 'setImmediate', 'clearImmediate', 'global'] as const;
    for (const name of globalsToHide) {
      if (!(name in window)) continue;
      try {
        delete (window as any)[name];
      } catch (_) {
        // best-effort
      }
      if ((window as any)[name] !== undefined) {
        try {
          Object.defineProperty(window, name, {
            configurable: true,
            writable: true,
            enumerable: false,
            value: undefined,
          });
        } catch (_) {
          // best-effort
        }
      }
    }
  }
} catch (_) {
  // 清理失败不影响页面加载
}

// Chromium's view-source checkbox tries to persist its state through
// PersistentRendererPrefsService. Electron does not provide that Chrome-only
// binder, so the resulting bad Mojo message terminates the renderer. Handle
// the change before Blink's native listener and apply the same table class
// locally; mouse and keyboard toggles keep working without crashing the tab.
document.addEventListener(
  'change',
  (event) => {
    const checkbox = event.target;
    if (
      !(checkbox instanceof HTMLInputElement) ||
      checkbox.type !== 'checkbox' ||
      !checkbox.closest('label.line-wrap-control')
    ) {
      return;
    }

    // A view-source document exposes the underlying page URL to renderer JS,
    // so identify it by Blink's fixed DOM structure instead of location.href.
    const form = checkbox.closest('form[autocomplete="off"]');
    const gutter = form?.previousElementSibling;
    const table = form?.nextElementSibling;
    if (
      !(form instanceof HTMLFormElement) ||
      !(table instanceof HTMLTableElement) ||
      !gutter?.classList.contains('line-gutter-backdrop')
    ) {
      return;
    }

    event.stopImmediatePropagation();
    table.classList.toggle('line-wrap', checkbox.checked);
  },
  true,
);

// 必须在页面 HTML 解析前同步取得设置并放入深色首帧防闪层。仅等主进程 dom-ready
// 再注入 Dark Reader 会让 Chromium 先绘制网页默认白色画布,形成明显 FOUC。
// 该 CSS 只覆盖根画布;主进程确认 Dark Reader 就绪或页面本身已是暗色后会通知移除。
const settings = ipcRenderer.sendSync('get-settings-sync');
let earlyWebDarkCssKey = '';
let earlyWebDarkReady = false;

const removeEarlyWebDarkCSS = () => {
  earlyWebDarkReady = true;
  if (!earlyWebDarkCssKey) return;
  const key = earlyWebDarkCssKey;
  earlyWebDarkCssKey = '';
  Promise.resolve(webFrame.removeInsertedCSS(key)).catch(() => undefined);
};

const installEarlyWebDarkCSS = () => {
  const url = window.location.href;
  const isOrdinaryPage =
    /^(https?|file):/i.test(url) && !url.startsWith(WEBUI_BASE_URL);
  const followsDarkSystem =
    settings?.themeAuto !== false &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const usesDarkTheme =
    settings?.themeAuto === false
      ? settings?.theme === 'wexond-dark'
      : followsDarkSystem;
  if (
    !isOrdinaryPage ||
    settings?.webDarkMode !== 'browser' ||
    !usesDarkTheme
  ) {
    return;
  }

  Promise.resolve(
    webFrame.insertCSS(
      `html {
        --rainsee-web-dark-loading: 1;
        background-color: #1c1c1c !important;
        color-scheme: dark !important;
      }`,
    ),
  )
    .then((key) => {
      earlyWebDarkCssKey = key;
      if (earlyWebDarkReady) removeEarlyWebDarkCSS();
    })
    .catch(() => undefined);
};

ipcRenderer.on('web-dark-mode-ready', removeEarlyWebDarkCSS);
installEarlyWebDarkCSS();

// 当前 webContents 对应的标签 id(主进程 get-webcontents-id 反查)。
// 注意:这是模块级常量,被多处模块级函数引用(clearChromeTabHover / 证书错误页 /
// supervideo 等的 webContentsId 字段)。2e4d0bb 重构删 opener 桥时曾误删此行 →
// ReferenceError: tabId is not defined(任意网页移动鼠标即触发)。勿删。
const tabId = ipcRenderer.sendSync('get-webcontents-id');

export const windowId: number = ipcRenderer.sendSync('get-window-id');

// 云端密码同步完成后刷新当前页面的候选列表，避免已打开标签继续闭包持有旧记录。
ipcRenderer.on('credentials-reload-page', () => {
  AutoComplete.loadForms();
});

const nativeBlankPopupId = Number(
  __nodeProcess.argv
    .find((argument) => argument.startsWith('--rainsee-native-blank-popup='))
    ?.slice('--rainsee-native-blank-popup='.length),
);

const isNativeBlankPopupOverlay = Number.isInteger(nativeBlankPopupId);
const isNativeBlankPopupBase = __nodeProcess.argv.includes(
  '--rainsee-native-blank-popup-base',
);

// A crashed renderer cannot write its own final log entry. Keep a compact
// lifecycle trail in the main process so render-process-gone includes the last
// renderer-side state even for native crashes.
const reportRendererDiagnostic = (phase: string, detail = '') => {
  try {
    ipcRenderer.send('renderer-diagnostic', {
      phase,
      detail: String(detail || '').slice(0, 400),
      url: window.location.href,
      readyState: document.readyState,
      visibility: document.visibilityState,
    });
  } catch {
    // Diagnostics must never affect page execution.
  }
};

reportRendererDiagnostic('preload-start');
window.addEventListener('DOMContentLoaded', () => reportRendererDiagnostic('dom-content-loaded'), {
  once: true,
});
window.addEventListener('load', () => reportRendererDiagnostic('load'), {once: true});
window.addEventListener('pagehide', () => reportRendererDiagnostic('pagehide'));
window.addEventListener('beforeunload', () => reportRendererDiagnostic('beforeunload'));
window.addEventListener(
  'error',
  (event) =>
    reportRendererDiagnostic(
      'window-error',
      `${event.message || 'unknown'} @ ${event.filename || ''}:${event.lineno || 0}:${event.colno || 0}`,
    ),
  true,
);

// 网页里的 window.close() 应关闭当前标签，而不是关闭承载 BrowserView 的
// 主 BrowserWindow。必须在页面脚本执行前改写；main 端会按 e.sender.id
// 反查真实标签，网页无法伪造其它标签 id。
const nativeWindowClose = window.close.bind(window);
window.close = () => {
  if (isNativeBlankPopupOverlay) {
    ipcRenderer.send('native-blank-popup-close', nativeBlankPopupId);
  } else if (isNativeBlankPopupBase) {
    nativeWindowClose();
  } else {
    ipcRenderer.send('web-page-window-close');
  }
};

if (isNativeBlankPopupOverlay) {
  const opener = {
    get closed() {
      return ipcRenderer.sendSync(
        'native-blank-popup-is-opener-closed',
        nativeBlankPopupId,
      ) === true;
    },
    postMessage(message: unknown, targetOrigin = '*') {
      ipcRenderer.send(
        'native-blank-popup-message-to-opener',
        nativeBlankPopupId,
        message,
        String(targetOrigin),
      );
    },
  };
  try {
    Object.defineProperty(window, 'opener', {
      configurable: false,
      enumerable: true,
      value: opener,
    });
  } catch {
    try {
      (window as any).opener = opener;
    } catch {}
  }
}

ipcRenderer.on(
  'native-blank-popup-relay-to-opener',
  (_event, message: unknown, targetOrigin: string) => {
    if (window.opener && window.opener !== window) {
      window.opener.postMessage(message, targetOrigin || '*');
    }
  },
);

// Electron 会把 window.open() 返回对象的 close 强制替换为内部
// BROWSER_WINDOW_CLOSE IPC。包装器必须安装在页面主世界；若直接从 preload
// 返回 facade，跨 V8 世界时 Electron 会把它重新还原成真实 WindowProxy。
const POPUP_TOKEN_ATTR = 'data-rainsee-popup-close-token';
const POPUP_RESULT_ATTR = 'data-rainsee-popup-close-result';

const handlePopupBridge = (channel: string) => {
  const root = document.documentElement;
  const token = root?.getAttribute(POPUP_TOKEN_ATTR) || '';
  let handled = false;
  if (token) {
    try {
      handled = ipcRenderer.sendSync(channel, token) === true;
    } catch {}
  }
  root?.setAttribute(POPUP_RESULT_ATTR, handled ? '1' : '0');
};

window.addEventListener(
  '__rainsee_popup_register__',
  () => handlePopupBridge('web-page-popup-register'),
  true,
);
window.addEventListener(
  '__rainsee_popup_close__',
  () => handlePopupBridge('web-page-popup-close'),
  true,
);

void webFrame.executeJavaScript(
  `(() => {
    if (window.__rainseeWindowOpenWrapped) return;
    window.__rainseeWindowOpenWrapped = true;
    const nativeWindowOpen = window.open.bind(window);
    let sequence = 0;
    const openerTabId = ${JSON.stringify(tabId)};
    const tokenAttr = ${JSON.stringify(POPUP_TOKEN_ATTR)};
    const resultAttr = ${JSON.stringify(POPUP_RESULT_ATTR)};

    const request = (eventName, token) => {
      const root = document.documentElement;
      if (!root) return false;
      root.setAttribute(tokenAttr, token);
      root.removeAttribute(resultAttr);
      window.dispatchEvent(new Event(eventName));
      const handled = root.getAttribute(resultAttr) === '1';
      root.removeAttribute(tokenAttr);
      root.removeAttribute(resultAttr);
      return handled;
    };

    window.open = function(url, target, features) {
      const popup = nativeWindowOpen(url, target, features);
      if (!popup || popup === window) return popup;

      const requestedUrl = url == null || url === '' ? 'about:blank' : String(url);
      const managedBlankTab =
        /^about:blank(?:[?#]|$)/i.test(requestedUrl) && !features;
      if (!managedBlankTab) return popup;

      const token = openerTabId + ':' + Date.now() + ':' + (++sequence);
      request('__rainsee_popup_register__', token);

      const closePopupTab = () => {
        request('__rainsee_popup_close__', token);
      };
      const facade = {close: closePopupTab};
      return new Proxy(facade, {
        get(_facade, property) {
          if (property === 'close') return closePopupTab;
          const value = Reflect.get(popup, property, popup);
          return typeof value === 'function' ? value.bind(popup) : value;
        },
        set(_facade, property, value) {
          return Reflect.set(popup, property, value, popup);
        },
      });
    };
  })()`,
  true,
);

const electronRenderer = {
  clipboard,
  ipcRenderer,
  nativeImage,
  shell,
  webFrame,
  webUtils,
};

const searchAnnotatorAnalyze = (payload: any) =>
  ipcRenderer.invoke('search-annotator-analyze', payload);

// 搜索标注气泡右上角齿轮 → 打开 设置-地址栏。
const searchAnnotatorOpenSettings = () =>
  ipcRenderer.invoke('search-annotator-open-settings');

const canExposeNodeModules = (url: string) =>
  url.startsWith('yjllq://web.koodoreader.com/');

const canExposeRequire = (url: string) =>
  canExposeNodeModules(url) ||
  url.startsWith(WEBUI_BASE_URL) ||
  url === 'about:blank' ||
  url.startsWith(`${ERROR_PROTOCOL}:`);

// 内置页打包后仍会通过 require('electron') 取用桥接能力；
// koodoreader 额外需要 window.require('fs'/'path') 读取外部 PDF。
// 为避免影响普通站点的环境探测,仅对受信任页面挂载 window.require。
const requireShim = (id: string) => {
  if (id === 'electron') {
    return electronRenderer;
  }

  const currentUrl = window.location.href;
  if (canExposeNodeModules(currentUrl)) {
    if (id === 'fs') return fs;
    if (id === 'path') return path;
  }

  return undefined;
};

if (canExposeRequire(window.location.href)) {
  try {
    contextBridge.exposeInMainWorld('require', requireShim);
  } catch (_) {
    (window as any).require = requireShim;
  }
}
(window as any).electron = electronRenderer;
(window as any).getPathForFile = (file: File) => webUtils.getPathForFile(file);
(window as any).searchAnnotatorAnalyze = searchAnnotatorAnalyze;
(window as any).searchAnnotatorOpenSettings = searchAnnotatorOpenSettings;

// Electron 42 + persist:view 扩展会话会把 file:// 页面引用的 SVG 子资源按
// text/html 解码（直接打开 SVG 主文档则正常），导致 <img> naturalWidth=0。
// 根因已在 protocol.ts 按扩展名直给 image/svg+xml，本逻辑是 belt-and-
// suspenders：把页面目录内的本地 SVG 引用就地换成等价 data URL。PNG/JPEG 等
// 不受影响；目录外/跨盘/符号链接逃逸一律放行原引用。
const MAX_INLINED_SVG_BYTES = 2 * 1024 * 1024; // 超 2MB 不内联，避免主线程长读 + DOM 常驻大串
const MEDIA_SELECTOR = 'img,source,embed,object';

const installLocalSvgImageFallback = () => {
  if (window.location.protocol !== 'file:') return;

  // file:// URL → 本地路径（处理 UNC 主机名、Windows 盘符前导斜杠、正斜杠→sep）。
  // decodeURIComponent 对含非法 % 序列的路径会抛 URIError，故调用方都包在 try 里。
  const toLocalPath = (url: URL) => {
    let pathname = decodeURIComponent(url.pathname);
    if (url.hostname) {
      return `\\\\${url.hostname}${pathname.replace(/\//g, '\\')}`;
    }
    if (/^\/[a-zA-Z]:\//.test(pathname)) pathname = pathname.slice(1);
    return pathname.replace(/\//g, path.sep);
  };

  // realpath 页面目录：既解析符号链接，又作为后续路径围栏的基准。
  let pageDirectory: string;
  try {
    pageDirectory = fs.realpathSync(
      path.dirname(toLocalPath(new URL(window.location.href))),
    );
  } catch (_) {
    return; // 页面 URL 解析失败（路径含非法 % 序列等）→ 不装 fallback
  }

  // realPath → data URL 的成功缓存：同一 SVG 多处引用 / observer 重入只读一次盘。
  const dataUrlCache = new Map<string, string>();

  const toDataUrl = (resourceUrl: URL): string | null => {
    if (resourceUrl.protocol !== 'file:') return null;
    if (!resourceUrl.pathname.toLowerCase().endsWith('.svg')) return null;
    resourceUrl.hash = '';
    resourceUrl.search = '';
    let real: string;
    try {
      // realpathSync 顺带解析符号链接：用真实路径做围栏，防止目录内符号链接指向树外。
      real = fs.realpathSync(path.resolve(toLocalPath(resourceUrl)));
    } catch (_) {
      return null;
    }
    // 路径围栏：真实路径必须在页面目录内（拒绝 ../、跨盘、目录本身）。
    const rel = path.relative(pageDirectory, real);
    if (
      rel === '' ||
      rel === '..' ||
      rel.startsWith(`..${path.sep}`) ||
      path.isAbsolute(rel)
    ) {
      return null;
    }
    const cached = dataUrlCache.get(real);
    if (cached) return cached;
    try {
      const stat = fs.statSync(real);
      if (stat.size > MAX_INLINED_SVG_BYTES) return null;
      const dataUrl = `data:image/svg+xml;base64,${fs.readFileSync(real).toString('base64')}`;
      dataUrlCache.set(real, dataUrl);
      return dataUrl;
    } catch (_) {
      return null; // 文件不存在/无权限 → 保留原 URL，交还页面 error 处理
    }
  };

  // 廉价预过滤：raw 显然不含 .svg 就直接跳过，避免每次 src/srcset 变更都构造 URL。
  const resolveRaw = (raw: string): string | null => {
    if (!raw || raw.startsWith('data:') || !raw.toLowerCase().includes('.svg')) {
      return null;
    }
    try {
      return toDataUrl(new URL(raw, window.location.href));
    } catch (_) {
      return null;
    }
  };

  // srcset: "a.svg 1x, b.svg 2x"；逐候选 URL 替换其中的本地 SVG，保留描述符与空白。
  const rewriteSrcset = (raw: string): string | null => {
    let changed = false;
    const out = raw.split(',').map((candidate) => {
      const match = candidate.match(/^(\s*)(\S+)(\s.*)?$/);
      if (!match) return candidate;
      const dataUrl = resolveRaw(match[2]);
      if (!dataUrl) return candidate;
      changed = true;
      return `${match[1]}${dataUrl}${match[3] || ''}`;
    });
    return changed ? out.join(',') : null;
  };

  const replaceSvgReference = (element: Element) => {
    const tag = element.tagName.toLowerCase();
    const attrs = tag === 'object' ? ['data', 'srcset', 'src'] : ['src', 'srcset'];
    for (const attr of attrs) {
      const raw = element.getAttribute(attr);
      if (!raw) continue;
      if (attr === 'srcset') {
        const next = rewriteSrcset(raw);
        if (next) element.setAttribute('srcset', next);
      } else {
        const dataUrl = resolveRaw(raw);
        if (dataUrl) element.setAttribute(attr, dataUrl);
      }
    }
  };

  const scan = (root: ParentNode) => {
    if (root instanceof Element && root.matches(MEDIA_SELECTOR)) {
      replaceSvgReference(root);
    }
    root.querySelectorAll(MEDIA_SELECTOR).forEach(replaceSvgReference);
  };

  const start = () => {
    scan(document);
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          // tagName 门控：只处理媒体元素，忽略 script/iframe/video 等的 src 变更。
          if (target instanceof Element && target.matches(MEDIA_SELECTOR)) {
            replaceSvgReference(target);
          }
        } else {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element) scan(node);
          });
        }
      }
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'data', 'srcset'],
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, {once: true});
  } else {
    start();
  }
};

installLocalSvgImageFallback();
// 内置页(webui)需按窗口发 IPC(如书签管理器跑 bookmarklet 时的 add-tab-${windowId});
// 仅对受信任内部页暴露,外部站点不暴露。
if (canExposeRequire(window.location.href)) {
  (window as any).windowId = windowId;
}

let lastChromeHoverClear = 0;
const clearChromeTabHover = () => {
  const now = Date.now();
  if (now - lastChromeHoverClear < 120) return;
  lastChromeHoverClear = now;
  ipcRenderer.send('view-clear-tab-hover', tabId);
};

window.addEventListener('mouseenter', clearChromeTabHover, true);
window.addEventListener('mousemove', clearChromeTabHover, true);
window.addEventListener('pointermove', clearChromeTabHover, true);

// Chrome-like link target preview. Browser tabs are native BrowserViews, so
// the app renderer cannot paint a status bar above the page. Keep the small
// indicator in the page itself and make it completely transparent to input.
const LINK_STATUS_ID = 'rainsee-link-status-preview';
const LINK_STATUS_STYLE_ID = 'rainsee-link-status-preview-style';

const installLinkStatusPreview = () => {
  if (!document.documentElement) return;

  if (!document.getElementById(LINK_STATUS_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = LINK_STATUS_STYLE_ID;
    style.textContent = `
      #${LINK_STATUS_ID} {
        position: fixed !important;
        left: 0 !important;
        bottom: 0 !important;
        z-index: 2147483647 !important;
        display: none;
        max-width: min(70vw, 720px);
        box-sizing: border-box;
        overflow: hidden;
        padding: 2px 7px 3px;
        border: 1px solid rgba(0, 0, 0, .16);
        border-bottom: 0;
        border-left: 0;
        border-radius: 0 4px 0 0;
        background: rgba(248, 249, 250, .96);
        color: #202124;
        font: 13px/18px Arial, sans-serif;
        white-space: nowrap;
        text-overflow: ellipsis;
        pointer-events: none !important;
        user-select: none !important;
      }
      @media (prefers-color-scheme: dark) {
        #${LINK_STATUS_ID} {
          border-color: rgba(255, 255, 255, .2);
          background: rgba(48, 49, 52, .96);
          color: #e8eaed;
        }
      }
    `;
    document.documentElement.appendChild(style);
  }

  let status = document.getElementById(LINK_STATUS_ID) as HTMLDivElement | null;
  let activeAnchor: HTMLAnchorElement | null = null;

  const hide = () => {
    activeAnchor = null;
    if (status) status.style.display = 'none';
  };

  const show = (anchor: HTMLAnchorElement) => {
    let href = '';
    try {
      href = anchor.href || anchor.getAttribute('href') || '';
    } catch {
      href = anchor.getAttribute('href') || '';
    }
    if (!href || href === '#') {
      hide();
      return;
    }
    try {
      href = decodeURI(href);
    } catch {
      // Keep the serialized URL when it contains malformed escape sequences.
    }
    if (!status) {
      status = document.createElement('div');
      status.id = LINK_STATUS_ID;
      status.setAttribute('aria-hidden', 'true');
      document.documentElement.appendChild(status);
    }
    activeAnchor = anchor;
    status.textContent = href;
    status.style.display = 'block';
  };

  const anchorFromTarget = (
    target: EventTarget | null,
  ): HTMLAnchorElement | null => {
    if (!(target instanceof Element)) return null;
    return target.closest('a[href]') as HTMLAnchorElement | null;
  };

  window.addEventListener(
    'mouseover',
    (event) => {
      const anchor = anchorFromTarget(event.target);
      if (anchor) show(anchor);
    },
    true,
  );
  window.addEventListener(
    'mouseout',
    (event) => {
      if (!activeAnchor) return;
      const related = anchorFromTarget(event.relatedTarget);
      if (related === activeAnchor) return;
      if (
        event.relatedTarget instanceof Node &&
        activeAnchor.contains(event.relatedTarget)
      )
        return;
      hide();
    },
    true,
  );
  window.addEventListener('blur', hide, true);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installLinkStatusPreview, {
    once: true,
  });
} else {
  installLinkStatusPreview();
}

const crxStripUncloneable = (val: any, seen?: WeakSet<any>): any => {
  const t = typeof val;
  if (val == null) return val;
  if (t === 'function' || t === 'symbol') return undefined;
  if (t !== 'object') return val;
  try {
    if (typeof Blob !== 'undefined' && val instanceof Blob) {
      const out: any = {__crxBlob: true, type: val.type || '', size: val.size || 0};
      for (const key of Object.keys(val)) {
        try {
          const desc = Object.getOwnPropertyDescriptor(val, key);
          if (!desc || typeof desc.get === 'function' || typeof desc.set === 'function') continue;
          out[key] = crxStripUncloneable(desc.value, seen);
        } catch (_) {
          // best-effort
        }
      }
      return out;
    }
    if (typeof File !== 'undefined' && val instanceof File) {
      const out: any = {
        __crxFile: true,
        type: val.type || '',
        size: val.size || 0,
        name: val.name || '',
      };
      for (const key of Object.keys(val)) {
        try {
          const desc = Object.getOwnPropertyDescriptor(val, key);
          if (!desc || typeof desc.get === 'function' || typeof desc.set === 'function') continue;
          out[key] = crxStripUncloneable(desc.value, seen);
        } catch (_) {
          // best-effort
        }
      }
      return out;
    }
  } catch (_) {
    // best-effort
  }
  if (!seen) seen = new WeakSet<any>();
  if (seen.has(val)) return null;
  try {
    seen.add(val);
  } catch (_) {
    // best-effort
  }
  if (Array.isArray(val)) {
    return val.map((item) => crxStripUncloneable(item, seen));
  }
  const out: any = {};
  for (const key of Object.keys(val)) {
    try {
      const desc = Object.getOwnPropertyDescriptor(val, key);
      if (!desc || typeof desc.get === 'function' || typeof desc.set === 'function') continue;
      out[key] = crxStripUncloneable(desc.value, seen);
    } catch (_) {
      // best-effort
    }
  }
  return out;
};

const crxBlobToDataUrl = (blob: Blob): Promise<string | undefined> =>
  new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.onabort = () => resolve(undefined);
      reader.readAsDataURL(blob);
    } catch (_) {
      resolve(undefined);
    }
  });

const crxStripPortMessage = async (val: any, seen?: WeakSet<any>): Promise<any> => {
  const t = typeof val;
  if (val == null) return val;
  if (t === 'function' || t === 'symbol') return undefined;
  if (t !== 'object') return val;
  try {
    if (typeof Blob !== 'undefined' && val instanceof Blob) {
      const out: any = {__crxBlob: true, type: val.type || '', size: val.size || 0};
      if (typeof File !== 'undefined' && val instanceof File) {
        out.__crxFile = true;
        out.name = val.name || '';
      }
      const dataUrl = await crxBlobToDataUrl(val);
      if (dataUrl) {
        out.imageDataUrl = dataUrl;
        out.dataUrl = dataUrl;
      }
      for (const key of Object.keys(val)) {
        try {
          const desc = Object.getOwnPropertyDescriptor(val, key);
          if (!desc || typeof desc.get === 'function' || typeof desc.set === 'function') continue;
          const stripped = await crxStripPortMessage(desc.value, seen);
          if (stripped !== undefined || !(key in out)) out[key] = stripped;
        } catch (_) {
          // best-effort
        }
      }
      return out;
    }
  } catch (_) {
    // best-effort
  }
  if (!seen) seen = new WeakSet<any>();
  if (seen.has(val)) return null;
  try {
    seen.add(val);
  } catch (_) {
    // best-effort
  }
  if (Array.isArray(val)) {
    const arr: any[] = [];
    for (const item of val) arr.push(await crxStripPortMessage(item, seen));
    return arr;
  }
  const out: any = {};
  for (const key of Object.keys(val)) {
    try {
      const desc = Object.getOwnPropertyDescriptor(val, key);
      if (!desc || typeof desc.get === 'function' || typeof desc.set === 'function') continue;
      const stripped = await crxStripPortMessage(desc.value, seen);
      if (stripped !== undefined) out[key] = stripped;
    } catch (_) {
      // best-effort
    }
  }
  return out;
};

const serializeChromeExtensionMessage = (value: any): any => {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? undefined : JSON.parse(serialized);
};

const crxSendPortMessage = (
  channel: 'crx-port-post' | 'crx-port-post-from-owner',
  portId: string,
  message: any,
  framePath?: number[],
) => {
  // Chrome Port messages use JSON serialization. Keep the existing async Blob
  // conversion only for the explicit transferResponse protocol used by image
  // extensions; ordinary messages must never cross IPC as host objects.
  const transfer = message && typeof message === 'object' ? message.transfer : undefined;
  if (!transfer || !transfer.transferResponse) {
    let wire: any;
    try {
      wire = serializeChromeExtensionMessage(message);
    } catch {
      wire = crxStripUncloneable(message);
    }
    try {
      if (framePath && framePath.length) {
        ipcRenderer.send('crx-port-post-from-frame', framePath, portId, wire);
      } else {
        ipcRenderer.send(channel, portId, wire);
      }
    } catch {
      // best-effort
    }
    return;
  }
  const send = (wire: any) => {
    if (framePath && framePath.length) {
      ipcRenderer.send('crx-port-post-from-frame', framePath, portId, wire);
    } else {
      ipcRenderer.send(channel, portId, wire);
    }
  };
  crxStripPortMessage(message)
    .then(send)
    .catch((err) => {
      try {
        // eslint-disable-next-line no-console
        console.warn(`[crx-view] ${channel} strip failed`, err);
      } catch (_) {
        // best-effort
      }
      try {
        send(crxStripUncloneable(message));
      } catch (_) {
        // best-effort
      }
    });
};

const crxSendCloneSafe = (channel: string, ...args: any[]) => {
  Promise.all(args.map((arg) => crxStripPortMessage(arg)))
    .then((stripped) => ipcRenderer.send(channel, ...stripped))
    .catch((err) => {
      try {
        // eslint-disable-next-line no-console
        console.warn(`[crx-view] ${channel} strip failed`, err);
      } catch (_) {
        // best-effort
      }
      try {
        ipcRenderer.send(channel, ...args.map((arg) => crxStripUncloneable(arg)));
      } catch (_) {
        // best-effort
      }
    });
};

const crxMsgBrief = (message: any): string => {
  try {
    if (message == null || typeof message !== 'object') return String(message);
    const parts: string[] = [];
    for (const key of ['id', 'type', 'method', 'name', 'target', 'command']) {
      const val = message[key];
      if (val != null && typeof val !== 'object') parts.push(`${key}=${String(val)}`);
    }
    const inner = message.message;
    if (inner && typeof inner === 'object') {
      for (const key of ['id', 'type', 'method', 'name', 'target', 'command']) {
        const val = inner[key];
        if (val != null && typeof val !== 'object') parts.push(`message.${key}=${String(val)}`);
      }
    }
    return parts.length ? parts.join(' ') : `keys=${Object.keys(message).slice(0, 8).join(',')}`;
  } catch (_) {
    return typeof message;
  }
};

const crxVerbose =
  typeof __nodeProcess !== 'undefined' && __nodeProcess?.env?.CRX_VERBOSE === '1';

const crxIsAutofillMessage = (message: any): boolean =>
  !!(
    typeof __nodeProcess !== 'undefined' && __nodeProcess?.env?.CRX_VERBOSE === '1' &&
    message &&
    typeof message === 'object' &&
    typeof message.command === 'string' &&
    /^(fillForm|triggerAutoSubmitLogin|collectPageDetails|collectPageDetailsResponse|bgCollectPageDetails|triggerAutofillScriptInjection|ignoreFieldFocus)$/.test(
      message.command,
    )
  )

const crxSafeAutofillUrl = (value: any): string => {
  const raw = typeof value === 'string' ? value : ''
  if (!raw) return ''
  try {
    const url = new URL(raw, location.href)
    return `${url.origin}${url.pathname}`
  } catch {
    return raw.split(/[?#]/, 1)[0]
  }
}

const crxRespBrief = (response: any): string => {
  try {
    if (response === undefined) return 'undefined';
    if (response === null) return 'null';
    if (typeof response !== 'object') return `${typeof response}:${String(response).slice(0, 80)}`;
    if (Array.isArray(response)) return `array(${response.length})`;
    return `object keys=${Object.keys(response).slice(0, 8).join(',')}`;
  } catch (_) {
    return typeof response;
  }
};

type CrxPendingTransfer = {
  resolve: (response: any) => void;
  timer: ReturnType<typeof setTimeout>;
};

const crxPendingTransferResponses = new Map<string, CrxPendingTransfer>();

const crxMaybeTransferResponse = (message: any) => {
  try {
    const transfer = message && typeof message === 'object' ? message.transfer : null;
    if (!transfer || transfer.type !== 'response' || !transfer.id) return false;
    const pending = crxPendingTransferResponses.get(String(transfer.id));
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[crx-view] transfer response id=${transfer.id} pending=${!!pending} ` +
          `dataKeys=${
            transfer.data && typeof transfer.data === 'object'
              ? Object.keys(transfer.data).slice(0, 8).join(',')
              : ''
          } imageLen=${
            transfer.data && typeof transfer.data.imageDataUrl === 'string'
              ? transfer.data.imageDataUrl.length
              : ''
          }`,
      );
    } catch (_) {
      // best-effort
    }
    if (!pending) return false;
    crxPendingTransferResponses.delete(String(transfer.id));
    clearTimeout(pending.timer);
    setTimeout(() => pending.resolve(undefined), 0);
    return true;
  } catch (_) {
    return false;
  }
};

const crxWaitForTransferResponse = (transfer: any): Promise<any> =>
  new Promise((resolve) => {
    const key = String(transfer.id);
    const old = crxPendingTransferResponses.get(key);
    if (old) {
      clearTimeout(old.timer);
      crxPendingTransferResponses.delete(key);
    }
    const timer = setTimeout(() => {
      crxPendingTransferResponses.delete(key);
      try {
        // eslint-disable-next-line no-console
        console.warn(`[crx-view] transfer wait timeout id=${key}`);
      } catch (_) {
        // best-effort
      }
      resolve(undefined);
    }, 30000);
    try {
      // eslint-disable-next-line no-console
      console.warn(`[crx-view] transfer wait add id=${key}`);
    } catch (_) {
      // best-effort
    }
    crxPendingTransferResponses.set(key, {resolve, timer});
  });

// koodoreader 外部文件直开:让阅读器认为运行在 Electron 桌面环境,
// 从而 fetchBook 走 window.require('fs') 分支按 book.path 读本地文件。
// book 对象的构造(含 format/path)已在 koodo-reader 源码的
// reader/component.tsx 里按 ?filePath 完成,这里只负责环境标记。
try {
  const currentUrl = window.location.href;
  if (currentUrl.startsWith('yjllq://web.koodoreader.com/')) {
    // react-device-detect 的 isElectron 三条路径全设,确保判定为 true:
    //   1) window.process.type === 'renderer'
    //   2) process.versions.electron
    //   3) navigator.userAgent 含 "Electron"
    // 注:该页在上方 Chrome 语义清理的豁免名单里(yjllq: 协议),
    // window.process 仍在;即使未来豁免规则变化,fallback 也会重建 stub。
    try {
      const wProc = (window as any).process;
      if (wProc && typeof wProc === 'object') {
        wProc.type = 'renderer';
        wProc.versions = wProc.versions || {};
        wProc.versions.electron = '42.0.0';
      } else {
        (window as any).process = {type: 'renderer', versions: {electron: '42.0.0'}};
      }
    } catch (_) {
      // best-effort
    }

    try {
      const originalUA = navigator.userAgent;
      const electronUA = originalUA.includes('Electron')
        ? originalUA
        : `${originalUA} Electron/42.0.0`;
      Object.defineProperty(navigator, 'userAgent', {
        value: electronUA,
        configurable: true,
      });
    } catch (_) {
      // 某些情况下 userAgent 不可覆盖,忽略(已有 process.type 兜底)
    }
  }
} catch (e) {
  console.warn('[koodo-preload] failed:', e);
}

// Surface any unhandled promise/IPC rejections (e.g. "An object could not be
// cloned") with their reason + stack, so a failing dessant image-transfer call
// can be pinpointed instead of disappearing silently.
try {
  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const r: any = (ev && (ev as any).reason) || {};
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[crx-view] UNHANDLED REJECTION: ${(r && r.message) || r} :: ${(r && r.stack) || ''}`,
      );
    } catch (_) {
      // best-effort
    }
  });
} catch (_) {
  // best-effort
}

// Content->view delivery for embedded extension view iframes (e.g. dessant
// search-by-image select/confirm view, a chrome-extension:// frame in the page).
// The view normally receives openView/closeView over a tabs.connect Port, but
// that Port only reaches dynamic (main-world) content scripts; this extension's
// content script is declarative (isolated world), so the Port never fires and
// the view's overlay (gated on openView) never shows. The view's shim announces
// itself here (__crxViewAnnounce) and installs a fake Port fed by
// __crxViewOpenView. We capture the iframe's contentWindow via event.source and
// re-broadcast openView/closeView/messageView to it. Queue until announced
// (openView can arrive before the view finishes loading).
let __crxViewWin: any = null;
let __crxViewQ: any[] = [];
window.addEventListener('message', (ev: MessageEvent) => {
  const d = (ev && (ev as any).data) || null;
  if (d && d.__crxViewAnnounce) {
    __crxViewWin = (ev as any).source;
    const q = __crxViewQ;
    __crxViewQ = [];
    for (const m of q) {
      try {
        __crxViewWin.postMessage({__crxViewOpenView: true, msg: m}, '*');
      } catch (_) {
        // best-effort
      }
    }
  }
});

// Re-broadcast SW/popup-originated tabs.sendMessage (main-world IPC
// 'crx-cs-message', sent by messaging.ts sendMessageToTab) onto the page window
// so the ISOLATED-world declarative content script can receive it. Electron's
// native SW->content-script dispatch does NOT deliver to BrowserView tabs in
// this build, and 'crx-cs-message' itself is delivered to the page MAIN world
// only; the content-script shim (extension-storage-patch.ts SHIM_BODY) listens
// for this re-broadcast and fires chrome.runtime.onMessage. window.postMessage
// is shared across the content-script isolated world and the page main world.

// The view's onMessage switches on the INNER message id (e.g.
// `imageSelectionSubmit`), but the background delivers view-bound payloads
// wrapped in a `messageView` envelope (`{id:"messageView", message:{...},
// flattenMessage:true}`). The content module normally unwraps that envelope in
// its route handler before forwarding the inner message to the view over the
// tabs.connect Port. Here that Port is dead (the shim installs a fake Port fed
// by __crxViewOpenView), so this bridge is the ONLY content->view path — we must
// unwrap the envelope ourselves so the view receives the inner id it expects.
const unwrapMessageView = (message: any): any => {
  if (!message || message.id !== 'messageView') return message;
  const inner: any = {...(message.message || {})};
  if (message.flattenMessage) {
    const env: any = {...message};
    delete env.id;
    delete env.message;
    delete env.flattenMessage;
    Object.assign(inner, env);
  }
  return inner;
};

const crxFramePathForWindow = (target: any): number[] | null => {
  if (!target) return null;
  if (target === window) return [];
  const seen = new Set<any>();
  const visit = (current: any, path: number[], depth: number): number[] | null => {
    if (!current || depth > 64 || seen.has(current)) return null;
    seen.add(current);
    let count = 0;
    try {
      count = current.frames.length;
    } catch {
      return null;
    }
    for (let index = 0; index < count; index++) {
      let child: any;
      try {
        child = current.frames[index];
      } catch {
        continue;
      }
      const childPath = path.concat(index);
      if (child === target) return childPath;
      const nested = visit(child, childPath, depth + 1);
      if (nested) return nested;
    }
    return null;
  };
  return visit(window, [], 0);
};

const crxWindowForFramePath = (path: unknown): any => {
  if (!Array.isArray(path) || path.length === 0 || path.length > 64) return null;
  let target: any = window;
  try {
    for (const index of path) {
      if (!Number.isInteger(index) || index < 0) return null;
      target = target.frames[index];
      if (!target) return null;
    }
    return target;
  } catch {
    return null;
  }
};

const crxFrameRouteKey = (path: number[], id: string) => `${path.join('.')}:${id}`;
const csConnMap = new Map<string, { connId: string; portId: string; buf: any[]; source: any; framePath: number[] }>();
type CrxCsSendEntry = {
  complete: boolean;
  response: any;
  source: any;
  cleanupTimer?: ReturnType<typeof setTimeout>;
};
const csSendMap = new Map<string, CrxCsSendEntry>();

ipcRenderer.on('crx-subframe-dispatch', (_e, path: unknown, channel: string, args: any[]) => {
  const target = crxWindowForFramePath(path);
  if (!target || !Array.isArray(args)) return;
  let payload: any = null;
  if (channel === 'crx-cs-message') {
    const [messageId, message, sender] = args;
    payload = {
      __crxCsFwd: true,
      messageId,
      extensionId: sender && sender.id,
      message,
      sender: sender || {},
    };
  } else if (channel === 'crx-runtime.onConnect') {
    const connection = args[0] || {};
    payload = {
      __crxSwConnect: true,
      portId: connection.portId,
      name: connection.name || '',
      sender: connection.sender || {},
    };
  } else if (channel.startsWith('crx-port-post:') || channel.startsWith('crx-port-post-to-frame:')) {
    const portId = channel.slice(channel.lastIndexOf(':') + 1);
    const csEntry =
      channel.startsWith('crx-port-post:') &&
      typeof csConnMap !== 'undefined' &&
      Array.from(csConnMap.values()).find(
        (entry) => entry.portId === portId && entry.framePath.join('.') === (path as number[]).join('.'),
      );
    payload = csEntry
      ? {__crxCSPortIn: true, connId: csEntry.connId, message: args[0]}
      : {__crxSwPortPost: true, portId, message: args[0]};
  } else if (channel.startsWith('crx-port-disconnect:')) {
    const portId = channel.slice(channel.lastIndexOf(':') + 1);
    const csEntry =
      typeof csConnMap !== 'undefined' &&
      Array.from(csConnMap.values()).find(
        (entry) => entry.portId === portId && entry.framePath.join('.') === (path as number[]).join('.'),
      );
    payload = csEntry
      ? {__crxCSPortDisIn: true, connId: csEntry.connId}
      : {__crxSwPortDisconnect: true, portId};
  }
  if (!payload) return;
  try {
    target.postMessage(payload, '*');
  } catch {
    // Frame navigated or detached between path resolution and delivery.
  }
});

ipcRenderer.on('crx-cs-message', (_e, messageId, message, sender) => {
  if (crxVerbose) {
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[crx-view] cs-message recv id=${messageId} ext=${
          sender && sender.id
        } url=${location.href} msg=${crxMsgBrief(message)}`,
      );
    } catch (_) {
      // best-effort
    }
  }
  try {
    window.postMessage(
      {
        __crxCsFwd: true,
        messageId,
        extensionId: sender && sender.id,
        message,
        sender: sender || {},
      },
      '*',
    );
  } catch (_) {
    // best-effort; never break the page on a forward failure
  }
  if (
    message &&
    (message.id === 'openView' ||
      message.id === 'closeView' ||
      message.id === 'messageView')
  ) {
    const viewMsg = unwrapMessageView(message);
    if (__crxViewWin) {
      try {
        __crxViewWin.postMessage({__crxViewOpenView: true, msg: viewMsg}, '*');
      } catch (_) {
        // best-effort
      }
    } else {
      __crxViewQ.push(viewMsg);
    }
  }
});

// SW->content Port bridge for DECLARATIVE content scripts (dessant engine in
// the isolated world). dessant's image storageRequest uses transferResponse:
// true, so the SW opens a transfer Port via tabs.connect(name=transferId) and
// posts the image over it. connectToTab delivers 'crx-runtime.onConnect' +
// 'crx-port-post:<portId>' to this webContents, but crx-preload (renderer/
// index.ts) only catches them in the MAIN world — this extension's content
// script runs in the ISOLATED world whose chrome.runtime.onConnect never fires,
// so NI() resolves with the empty-array fallback and h() crashes on
// imageDataUrl.split. Relay the onConnect event + each port message to the
// isolated world via window.postMessage (shared across worlds); the SHIM
// (extension-storage-patch.ts) synthesizes a fake runtime.onConnect + fake
// Port. Reverse direction (engine port.postMessage) returns as
// __crxSwPortPostBack and is forwarded over the real 'crx-port-post' IPC.
// No accept-handshake needed: connectToTab sets swReady=true, and the main
// process never buffers SW->frame port messages.
ipcRenderer.on('crx-runtime.onConnect', (_e, payload: any) => {
  const portId = payload && payload.portId;
  const name = (payload && payload.name) || '';
  const sender = (payload && payload.sender) || {};
  if (!portId) return;
  const chan = `crx-port-post-to-frame:${portId}`;
  const legacyChan = `crx-port-post:${portId}`;
  const disChan = `crx-port-disconnect:${portId}`;
  const onMsg = (_ee: any, message: any) => {
    if (crxVerbose) {
      try {
        // eslint-disable-next-line no-console
        console.warn(
          `[crx-view] sw-port forward portId=${portId} msg=${crxMsgBrief(message)}`,
        );
      } catch (_) {
        // best-effort
      }
    }
    try {
      window.postMessage({__crxSwPortPost: true, portId, message}, '*');
    } catch (_) {
      // best-effort
    }
    crxMaybeTransferResponse(message);
  };
  const onDis = () => {
    try {
      ipcRenderer.off(chan, onMsg);
    } catch (_) {
      // best-effort
    }
    try {
      ipcRenderer.off(legacyChan, onMsg);
    } catch (_) {
      // best-effort
    }
    try {
      ipcRenderer.off(disChan, onDis);
    } catch (_) {
      // best-effort
    }
    try {
      window.postMessage({__crxSwPortDisconnect: true, portId}, '*');
    } catch (_) {
      // best-effort
    }
  };
  ipcRenderer.on(chan, onMsg);
  ipcRenderer.on(legacyChan, onMsg);
  ipcRenderer.once(disChan, onDis);
  if (crxVerbose) {
    try {
      // eslint-disable-next-line no-console
      console.warn(`[crx-view] sw-port connect portId=${portId} name=${name}`);
    } catch (_) {
      // best-effort
    }
  }
  try {
    window.postMessage({__crxSwConnect: true, portId, name, sender}, '*');
  } catch (_) {
    // best-effort
  }
});
window.addEventListener('message', (ev: MessageEvent) => {
  const d = (ev && (ev as any).data) || null;
  if (!d) return;
  if (d.__crxCsFwdResp && d.messageId) {
    if (crxVerbose) {
      try {
        // eslint-disable-next-line no-console
        console.warn(
          `[crx-view] cs-message response id=${d.messageId} response=${crxRespBrief(d.response)}`,
        );
      } catch (_) {
        // best-effort
      }
    }
    crxSendCloneSafe('crx-cs-message-response', d.messageId, d.response);
    return;
  }
  if (d.__crxSwPortPostBack && d.portId) {
    // isolated-world engine port.postMessage -> SW (frame->SW direction).
    const framePath = crxFramePathForWindow((ev as any).source || window);
    if (framePath) crxSendPortMessage('crx-port-post', d.portId, d.message, framePath);
  } else if (d.__crxSwPortDisconnectBack && d.portId) {
    try {
      const framePath = crxFramePathForWindow((ev as any).source || window);
      if (!framePath) return;
      if (framePath.length) {
        ipcRenderer.send('crx-port-disconnect-from-frame', framePath, d.portId);
      } else {
        ipcRenderer.send('crx-port-disconnect', d.portId);
      }
    } catch (_) {
      // best-effort
    }
  }
});

// Content->background runtime.sendMessage bridge — the REVERSE of the CS receive
// bridge above. Declarative content scripts (isolated world) call
// chrome.runtime.sendMessage to reach the SW, but native content->SW delivery is
// unreliable for BrowserView tabs (dessant's image-select pointerup
// routeMessage never arrives). The content-script shim overrides
// chrome.runtime.sendMessage to post __crxCsSend here; we invoke the vendor's
// 'crx-runtime-message' handler (messaging.ts onRuntimeMessage — the same path
// dynamic content scripts use) and relay the response back by mid. window.postMessage
// is shared across the content-script isolated world and this main/preload world.
window.addEventListener('message', async (ev: MessageEvent) => {
  const d = (ev && (ev as any).data) || null;
  if (!d || !d.__crxCsSend || !d.mid) return;
  const source: any = (ev as any).source || window;
  const framePath = crxFramePathForWindow(source);
  if (!framePath) return;
  const requestKey = crxFrameRouteKey(
    framePath,
    `${String(d.extId || '')}:message:${String(d.mid)}`,
  );
  const previous = csSendMap.get(requestKey);
  if (previous) {
    if (previous.complete) {
      try {
        source.postMessage(
          {__crxCsSendResp: true, mid: d.mid, response: previous.response},
          '*',
        );
      } catch (_) {
        // best-effort
      }
    }
    return;
  }
  const request: CrxCsSendEntry = {complete: false, response: undefined, source};
  csSendMap.set(requestKey, request);
  const transfer = d.message && typeof d.message === 'object' ? d.message.transfer : null;
  const transferWait =
    transfer && transfer.transferResponse && transfer.id
      ? crxWaitForTransferResponse(transfer)
      : null;
  if (crxIsAutofillMessage(d.message)) {
    try {
      const details = d.message && d.message.details
      const fillScript = d.message && d.message.fillScript
      const meta =
        d.message.command === 'collectPageDetailsResponse'
          ? ` fields=${Array.isArray(details?.fields) ? details.fields.length : -1} url=${crxSafeAutofillUrl(details?.url)}`
          : d.message.command === 'fillForm' || d.message.command === 'triggerAutoSubmitLogin'
            ? ` scriptOps=${Array.isArray(fillScript?.script) ? fillScript.script.length : -1} pageUrl=${crxSafeAutofillUrl(d.message.pageDetailsUrl)}`
            : ''
      console.warn(
        `[crx-autofill] view.send mid=${d.mid} ext=${d.extId || ''} ` +
          `command=${d.message.command}${meta} url=${crxSafeAutofillUrl(location.href)}`,
      );
    } catch (_) {
      // best-effort
    }
  }
  try {
    if (transferWait) {
      // eslint-disable-next-line no-console
      console.warn(
        `[crx-view] cs-send transfer wait mid=${d.mid} id=${transfer.id} ` +
          `msgKeys=${Object.keys(d.message || {}).slice(0, 8).join(',')}`,
      );
    }
  } catch (_) {
    // best-effort
  }
  let response: any;
  try {
    response = framePath.length
      ? await ipcRenderer.invoke('crx-runtime-message-from-frame', framePath, d.extId, d.message)
      : await ipcRenderer.invoke('crx-runtime-message', d.extId, d.message);
    if (transferWait && (response === undefined || response === null)) response = await transferWait;
    try {
      if (transferWait) {
        // eslint-disable-next-line no-console
        console.warn(
          `[crx-view] cs-send transfer result mid=${d.mid} id=${transfer.id} ` +
            `response=${crxRespBrief(response)}`,
        );
      }
    } catch (_) {
      // best-effort
    }
  } catch (err) {
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[crx-view] invoke FAIL id=${d.message && d.message.id} err=${err && (err as any).message}`,
      );
    } catch (_) {
      // best-effort
    }
    response = undefined;
  }
  try {
    const serialized =
      response === undefined ? undefined : serializeChromeExtensionMessage(response);
    request.response = serialized;
    request.complete = true;
    request.cleanupTimer = setTimeout(() => {
      if (csSendMap.get(requestKey) === request) csSendMap.delete(requestKey);
    }, 30000);
    if (crxIsAutofillMessage(d.message)) {
      try {
        console.warn(
          `[crx-autofill] view.response mid=${d.mid} command=${d.message.command} ` +
            `response=${response === undefined ? 'undefined' : response === null ? 'null' : typeof response}`,
        );
      } catch (_) {
        // best-effort
      }
    }
    source.postMessage({__crxCsSendResp: true, mid: d.mid, response: serialized}, '*');
  } catch (err) {
    // The response payload (e.g. an image with a Blob/non-cloneable member)
    // may fail structured clone across the world boundary.
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[crx-view] resp postMessage FAIL id=${d.message && d.message.id} err=${err && (err as any).message}`,
      );
    } catch (_) {
      // best-effort
    }
  }
});

// Content->background runtime.connect Port bridge — the Port analogue of the
// __crxCsSend sendMessage bridge above. A content script's chrome.runtime.connect
// (overridden by the SHIM in the isolated world) posts __crxCSConnect here; we
// open a real Port via the vendor 'crx-port-connect' handler (messaging.ts
// onPortConnect -> SW 'crx-runtime.onConnect') and relay both directions by
// connId. Without this, an MV3 extension that registers its runtime.onMessage
// API dispatcher inside an onConnect handler (BewlyBewly: handleConnect ->
// onMessage.addListener(handleMessage)) never gets that dispatcher registered,
// because native content->SW connect never reaches the SW -> every content->SW
// sendMessage then resolves undefined. Outgoing posts are buffered until the
// (async) portId lands so connect()-then-postMessage() isn't lost.
window.addEventListener('message', async (ev: MessageEvent) => {
  const d = (ev && (ev as any).data) || null;
  if (!d || !d.__crxCSConnect || !d.connId) return;
  const source: any = (ev as any).source || window;
  const framePath = crxFramePathForWindow(source);
  if (!framePath) return;
  const connId = d.connId;
  const extId = d.extId;
  const name = d.name || '';
  const routeKey = crxFrameRouteKey(framePath, connId);
  const previous = csConnMap.get(routeKey);
  if (previous) {
    try {
      source.postMessage({__crxCSPortAck: true, connId, extId}, '*');
    } catch {
      // best-effort
    }
    return;
  }
  const entry = {connId, portId: '', buf: [] as any[], source, framePath};
  csConnMap.set(routeKey, entry);
  // USER_SCRIPT code can execute before this preload reaches its message
  // listeners. Acknowledge receipt so its retry loop stops; duplicate retries
  // above reuse this route instead of opening a second background Port.
  try {
    source.postMessage({__crxCSPortAck: true, connId, extId}, '*');
  } catch {
    // best-effort
  }
  let portId = '';
  try {
    portId = framePath.length
      ? await ipcRenderer.invoke('crx-port-connect-from-frame', framePath, extId, {name})
      : await ipcRenderer.invoke('crx-port-connect', extId, {name});
  } catch {
    portId = '';
  }
  if (!portId) {
    csConnMap.delete(routeKey);
    try {
      source.postMessage({ __crxCSPortDisIn: true, connId }, '*');
    } catch {
      // best-effort
    }
    return;
  }
  entry.portId = portId;
  for (const m of entry.buf) {
    crxSendPortMessage('crx-port-post', portId, m, entry.framePath);
  }
  entry.buf.length = 0;
  const chan = `crx-port-post:${portId}`;
  const disChan = `crx-port-disconnect:${portId}`;
  const onMsg = (_e: any, message: any) => {
    try {
      source.postMessage({ __crxCSPortIn: true, connId, message }, '*');
    } catch {
      // best-effort
    }
  };
  const onDis = () => {
    try {
      ipcRenderer.off(chan, onMsg);
    } catch {
      // best-effort
    }
    try {
      ipcRenderer.off(disChan, onDis);
    } catch {
      // best-effort
    }
    try {
      source.postMessage({ __crxCSPortDisIn: true, connId }, '*');
    } catch {
      // best-effort
    }
    csConnMap.delete(routeKey);
  };
  ipcRenderer.on(chan, onMsg);
  ipcRenderer.once(disChan, onDis);
  if (crxVerbose) {
    try {
      // eslint-disable-next-line no-console
      console.warn(`[crx-view] cs-port connect connId=${connId} portId=${portId} name=${name}`);
    } catch {
      // best-effort
    }
  }
});
// Outgoing: content Port.postMessage / disconnect -> SW (buffered until portId).
window.addEventListener('message', (ev: MessageEvent) => {
  const d = (ev && (ev as any).data) || null;
  if (!d) return;
  if (d.__crxCSPortOut && d.connId) {
    const source: any = (ev as any).source || window;
    const framePath = crxFramePathForWindow(source);
    if (!framePath) return;
    const entry = csConnMap.get(crxFrameRouteKey(framePath, d.connId));
    if (!entry) return;
    if (entry.portId) {
      crxSendPortMessage('crx-port-post', entry.portId, d.message, entry.framePath);
    } else {
      try {
        entry.buf.push(d.message);
      } catch {
        // best-effort
      }
    }
  } else if (d.__crxCSPortDisOut && d.connId) {
    const source: any = (ev as any).source || window;
    const framePath = crxFramePathForWindow(source);
    if (!framePath) return;
    const routeKey = crxFrameRouteKey(framePath, d.connId);
    const entry = csConnMap.get(routeKey);
    if (!entry) return;
    if (entry.portId) {
      try {
        if (entry.framePath.length) {
          ipcRenderer.send('crx-port-disconnect-from-frame', entry.framePath, entry.portId);
        } else {
          ipcRenderer.send('crx-port-disconnect', entry.portId);
        }
      } catch {
        // best-effort
      }
    }
    csConnMap.delete(routeKey);
  }
});

// Externally-connectable surface for web pages. Chrome injects a minimal
// chrome.runtime (sendMessage + connect, id undefined) into every page; a page
// on an origin listed in some extension's manifest `externally_connectable.
// matches` can then talk to that extension. Electron injects no such object,
// so bank / DRM / native-bridge pages (e.g. CFCA SecEditCtl.BCM) that call
// chrome.runtime.sendMessage(extensionId, ...) read "undefined" and their
// secure-edit control silently fails. We provide the Chrome-standard surface;
// the main process (messaging.ts isExternallyConnectable) validates the origin
// and routes to the SW's onMessageExternal / onConnectExternal.
(function installExternallyConnectable() {
  let href = '';
  try {
    href = window.location.href;
  } catch {
    href = '';
  }
  const protocol = ((href && href.split(':')[0]) || '').toLowerCase();
  // Only real web pages. Skip chrome-extension:// (extension pages get their
  // own chrome.runtime via crx-preload), yjllq:// webui, devtools, about:.
  if (protocol !== 'http' && protocol !== 'https' && protocol !== 'file') return;

  const w = window as any;
  // Merge, never clobber: a page (or another preload) may set `chrome` for
  // unrelated reasons. Only fill in missing pieces.
  if (typeof w.chrome !== 'object' || w.chrome === null) {
    try {
      w.chrome = {};
    } catch {
      return;
    }
  }
  const chrome = w.chrome;
  if (typeof chrome.runtime !== 'object' || chrome.runtime === null) {
    if (chrome.runtime === undefined) {
      try {
        chrome.runtime = {};
      } catch {
        return;
      }
    } else {
      // Exotic existing runtime (function/accessor) — leave it alone.
      return;
    }
  }
  const runtime = chrome.runtime;
  const installRuntimeMethod = (name: 'sendMessage' | 'connect', fn: any) => {
    try {
      Object.defineProperty(fn, '__rainseeExternal', {
        value: true,
        configurable: true,
      });
    } catch {
      // best-effort
    }
    try {
      Object.defineProperty(runtime, name, {
        value: fn,
        configurable: true,
        enumerable: true,
        writable: true,
      });
    } catch {
      try {
        runtime[name] = fn;
      } catch {
        // best-effort
      }
    }
    return runtime[name] === fn;
  };
  // A web page has no extension id (Chrome: runtime.id is undefined on pages).
  if (runtime.id === undefined) {
    try {
      Object.defineProperty(runtime, 'id', {value: undefined, configurable: true});
    } catch {
      // best-effort
    }
  }

  // sendMessage(extensionId, message [, options] [, callback])
  // Returns a Promise when no callback is given (MV3-style). Chrome resolves
  // undefined when delivery fails / nobody responds; we match that.
  {
    const externalSendMessage = function (...args: any[]) {
      const last = args[args.length - 1];
      const callback = typeof last === 'function' ? args.pop() : undefined;
      // A page must address a specific extension id.
      if (args.length < 2 || typeof args[0] !== 'string') {
        const err = new Error(
          'Could not establish connection. Receiving end does not exist.',
        );
        if (callback) {
          try {
            callback(undefined);
          } catch {
            // best-effort
          }
          return undefined;
        }
        return Promise.reject(err);
      }
      const extensionId = args[0];
      const message = args[1];
      // Chrome serializes runtime messages instead of passing page-world
      // objects by identity. Page frameworks frequently hand us Proxies,
      // cross-world wrappers, DOM-backed values, or objects containing
      // functions; Electron's structured clone rejects those before the main
      // handler runs. Sanitize first, then JSON-round-trip and retry once for
      // exotic objects that still escape the property walker.
      let stripped: any;
      try {
        stripped = crxStripUncloneable(message);
      } catch {
        stripped = undefined;
      }
      try {
        // eslint-disable-next-line no-console
        console.warn(
          `[crx-external] send ext=${extensionId} message=${crxMsgBrief(message)}`,
        );
      } catch (_) {
        // best-effort
      }
      const p: Promise<any> = Promise.resolve()
        .then(() =>
          ipcRenderer.invoke('crx-runtime-message-external', extensionId, stripped),
        )
        .catch((firstError: any) => {
          try {
            // eslint-disable-next-line no-console
            console.warn(
              `[crx-external] clone retry ext=${extensionId} error=${
                (firstError && firstError.message) || firstError
              }`,
            );
          } catch (_) {
            // best-effort
          }
          try {
            const jsonSafe = JSON.parse(JSON.stringify(message));
            return ipcRenderer.invoke(
              'crx-runtime-message-external',
              extensionId,
              jsonSafe,
            );
          } catch {
            return undefined;
          }
        })
        .catch(() => undefined)
        .then((response: any) => {
          try {
            // eslint-disable-next-line no-console
            console.warn(
              `[crx-external] response ext=${extensionId} response=${crxRespBrief(
                response,
              )}`,
            );
          } catch (_) {
            // best-effort
          }
          return response;
        });
      if (callback) {
        p.then((response: any) => {
          try {
            callback(response);
          } catch {
            // best-effort
          }
        });
        return undefined;
      }
      return p;
    };
    installRuntimeMethod('sendMessage', externalSendMessage);
  }

  // connect(extensionId [, connectInfo]) -> Port
  {
    const makePortListeners = () => {
      const fns: Array<(...args: any[]) => void> = [];
      return {
        addListener: (fn: any) => {
          if (typeof fn === 'function' && fns.indexOf(fn) < 0) fns.push(fn);
        },
        removeListener: (fn: any) => {
          const i = fns.indexOf(fn);
          if (i >= 0) fns.splice(i, 1);
        },
        hasListener: (fn: any) => fns.indexOf(fn) >= 0,
        hasListeners: () => fns.length > 0,
        _emit: (...args: any[]) => {
          for (const fn of fns.slice()) {
            try {
              fn(...args);
            } catch {
              // best-effort
            }
          }
        },
      };
    };
    const externalConnect = function (extensionId: string, connectInfo?: any) {
      let name = '';
      if (typeof connectInfo === 'string') name = connectInfo;
      else if (connectInfo && typeof connectInfo.name === 'string')
        name = connectInfo.name;
      const onMessage = makePortListeners();
      const onDisconnect = makePortListeners();
      let portId = '';
      let closed = false;
      let cleanupTransport: (() => void) | undefined;
      const buf: any[] = [];
      const port: any = {
        name,
        // Initiator side: pages get no sender (Chrome semantics).
        sender: undefined,
        onMessage,
        onDisconnect,
        postMessage: (m: any) => {
          if (closed) {
            throw new Error('Attempting to use a disconnected port object');
          }
          if (portId) {
            crxSendPortMessage('crx-port-post', portId, m);
          } else {
            buf.push(m);
          }
        },
        disconnect: () => {
          if (closed) return;
          closed = true;
          buf.length = 0;
          cleanupTransport?.();
          cleanupTransport = undefined;
          if (!portId) return;
          const id = portId;
          portId = '';
          try {
            ipcRenderer.send('crx-port-disconnect', id);
          } catch {
            // best-effort
          }
          // Chrome fires onDisconnect at the other end when disconnect() is
          // called; it does not echo the event back to the caller.
        },
      };
      ipcRenderer
        .invoke('crx-port-connect-external', extensionId, {name})
        .then((id: string) => {
          if (!id) {
            // Not externally_connectable, or no receiver — fire onDisconnect.
            if (closed) return;
            closed = true;
            try {
              onDisconnect._emit(port);
            } catch {
              // best-effort
            }
            return;
          }
          if (closed) {
            // disconnect() may have been called while the main process was
            // resolving the target worker. Tear down the newly-created main
            // port instead of resurrecting it and flushing queued messages.
            try {
              ipcRenderer.send('crx-port-disconnect', id);
            } catch {
              // best-effort
            }
            return;
          }
          portId = id;
          const chan = `crx-port-post:${id}`;
          const disChan = `crx-port-disconnect:${id}`;
          const onMsg = (_e: any, message: any) => {
            if (closed) return;
            try {
              onMessage._emit(message, port);
            } catch {
              // best-effort
            }
          };
          const cleanup = () => {
            try {
              ipcRenderer.off(chan, onMsg);
            } catch {
              // best-effort
            }
            try {
              ipcRenderer.off(disChan, onDis);
            } catch {
              // best-effort
            }
          };
          const onDis = () => {
            if (closed) return;
            closed = true;
            portId = '';
            cleanup();
            cleanupTransport = undefined;
            try {
              onDisconnect._emit(port);
            } catch {
              // best-effort
            }
          };
          cleanupTransport = cleanup;
          ipcRenderer.on(chan, onMsg);
          ipcRenderer.once(disChan, onDis);
          for (const m of buf) {
            crxSendPortMessage('crx-port-post', id, m);
          }
          buf.length = 0;
        })
        .catch(() => {
          if (closed) return;
          closed = true;
          try {
            onDisconnect._emit(port);
          } catch {
            // best-effort
          }
        });
      return port;
    };
    installRuntimeMethod('connect', externalConnect);
  }
  try {
    // eslint-disable-next-line no-console
    console.warn(
      `[crx-external] installed href=${href.slice(0, 120)} send=${
        !!(runtime.sendMessage && runtime.sendMessage.__rainseeExternal)
      } connect=${!!(runtime.connect && runtime.connect.__rainseeExternal)}`,
    );
  } catch (_) {
    // best-effort
  }
})();

// Extension iframe -> content-script tabs.connect bridge. Some extensions open
// chrome-extension:// UI frames inside the web page and then call
// chrome.tabs.connect(activeTab.id, {name, frameId:0}) from that iframe. Electron
// may give that iframe a native/partial chrome.tabs where connect never reaches
// our vendor messaging hub. The frame-level bridge in view.ts posts
// __crxTabsConnect here; we invoke the same 'crx-msg' tabs.connect handler used
// by crx-preload and relay the resulting Port both ways.
const iframeTabConnMap = new Map<string, { portId: string; buf: any[] }>();
window.addEventListener('message', async (ev: MessageEvent) => {
  const d = (ev && (ev as any).data) || null;
  if (!d || !d.__crxTabsConnect) return;
  const source: any = (ev as any).source || window;
  const connId = d.connId;
  const extId = d.extId;
  const tabIdArg = typeof d.tabId === 'number' ? d.tabId : undefined;
  const info = {...(d.info || {}), __crxOwnerFrameBridge: true};
  const entry = { portId: '', buf: [] as any[] };
  iframeTabConnMap.set(connId, entry);
  let portId = '';
  try {
    portId = await ipcRenderer.invoke('crx-msg', extId, 'tabs.connect', tabIdArg, info);
  } catch (err) {
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[crx-view] iframe tabs.connect FAIL connId=${connId} ext=${extId} err=${
          err && (err as any).message
        }`,
      );
    } catch {
      // best-effort
    }
    portId = '';
  }
  if (!portId) {
    iframeTabConnMap.delete(connId);
    try {
      source.postMessage({__crxTabsPortDisIn: true, connId}, '*');
    } catch {
      // best-effort
    }
    return;
  }
  entry.portId = portId;
  for (const m of entry.buf) {
    crxSendPortMessage('crx-port-post-from-owner', portId, m);
  }
  entry.buf.length = 0;
  const chan = `crx-port-post-to-owner:${portId}`;
  const legacyChan = `crx-port-post:${portId}`;
  const disChan = `crx-port-disconnect:${portId}`;
  const onMsg = (_e: any, message: any) => {
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[crx-view] iframe tabs.port recv connId=${connId} portId=${portId} msg=${crxMsgBrief(
          message,
        )}`,
      );
    } catch {
      // best-effort
    }
    try {
      source.postMessage({__crxTabsPortIn: true, connId, message}, '*');
    } catch {
      // best-effort
    }
  };
  const onDis = () => {
    try {
      ipcRenderer.off(chan, onMsg);
    } catch {
      // best-effort
    }
    try {
      ipcRenderer.off(legacyChan, onMsg);
    } catch {
      // best-effort
    }
    try {
      ipcRenderer.off(disChan, onDis);
    } catch {
      // best-effort
    }
    iframeTabConnMap.delete(connId);
    try {
      source.postMessage({__crxTabsPortDisIn: true, connId}, '*');
    } catch {
      // best-effort
    }
  };
  ipcRenderer.on(chan, onMsg);
  ipcRenderer.on(legacyChan, onMsg);
  ipcRenderer.once(disChan, onDis);
  try {
    // eslint-disable-next-line no-console
    console.warn(
      `[crx-view] iframe tabs.connect connId=${connId} portId=${portId} ext=${extId} ` +
        `tab=${tabIdArg ?? 'current'} name=${info && info.name}`,
    );
  } catch {
    // best-effort
  }
});
window.addEventListener('message', (ev: MessageEvent) => {
  const d = (ev && (ev as any).data) || null;
  if (!d) return;
  if (d.__crxTabsPortOut && d.connId) {
    const entry = iframeTabConnMap.get(d.connId);
    if (!entry) return;
    if (entry.portId) {
      crxSendPortMessage('crx-port-post-from-owner', entry.portId, d.message);
    } else {
      try {
        entry.buf.push(d.message);
      } catch {
        // best-effort
      }
    }
  } else if (d.__crxTabsPortDisOut && d.connId) {
    const entry = iframeTabConnMap.get(d.connId);
    if (!entry) return;
    if (entry.portId) {
      try {
        ipcRenderer.send('crx-port-disconnect-from-owner', entry.portId);
      } catch {
        // best-effort
      }
    }
    iframeTabConnMap.delete(d.connId);
  }
});

const goBack = () => {
  ipcRenderer.invoke(`web-contents-call`, {
    webContentsId: tabId,
    method: 'goBack',
  });
};

const goForward = () => {
  ipcRenderer.invoke(`web-contents-call`, {
    webContentsId: tabId,
    method: 'goForward',
  });
};

window.addEventListener('mouseup', (e) => {
  if (e.button === 3) {
    e.preventDefault();
    goBack();
  } else if (e.button === 4) {
    e.preventDefault();
    goForward();
  }
});

let beginningScrollLeft: number = null;
let beginningScrollRight: number = null;
let horizontalMouseMove = 0;
let verticalMouseMove = 0;

const resetCounters = () => {
  beginningScrollLeft = null;
  beginningScrollRight = null;
  horizontalMouseMove = 0;
  verticalMouseMove = 0;
};

function getScrollStartPoint(x: number, y: number) {
  let left = 0;
  let right = 0;

  let n = document.elementFromPoint(x, y);

  while (n) {
    if (n.scrollLeft !== undefined) {
      left = Math.max(left, n.scrollLeft);
      right = Math.max(right, n.scrollWidth - n.clientWidth - n.scrollLeft);
    }
    n = n.parentElement;
  }
  return {left, right};
}

document.addEventListener('wheel', (e) => {
  verticalMouseMove += e.deltaY;
  horizontalMouseMove += e.deltaX;

  if (beginningScrollLeft === null || beginningScrollRight === null) {
    const result = getScrollStartPoint(e.deltaX, e.deltaY);
    beginningScrollLeft = result.left;
    beginningScrollRight = result.right;
  }
});

ipcRenderer.on('scroll-touch-end', () => {
  if (
    horizontalMouseMove - beginningScrollRight > 150 &&
    Math.abs(horizontalMouseMove / verticalMouseMove) > 2.5
  ) {
    if (beginningScrollRight < 10) {
      goForward();
    }
  }

  if (
    horizontalMouseMove + beginningScrollLeft < -150 &&
    Math.abs(horizontalMouseMove / verticalMouseMove) > 2.5
  ) {
    if (beginningScrollLeft < 10) {
      goBack();
    }
  }

  resetCounters();
});

// [内存节省] 后台标签闲置超时后,主进程(tab-throttle 服务)发来此信号,让本帧释放
// 内存缓存(解码图片/字体/内存态资源)。不重载页面、不丢 DOM/滚动位/表单,仅清缓存,
// 是「轻量节流」下唯一能实际回收部分渲染进程内存的手段。webFrame.clearCache 只清内存
// 缓存,磁盘缓存保留,重新激活时开销极小。
ipcRenderer.on('tab-release-memory', () => {
  try {
    webFrame.clearCache();
  } catch {
    // best-effort;清缓存失败无副作用
  }
});

if (__nodeProcess.env.ENABLE_AUTOFILL) {
  // 不单点依赖 window 'load':若本 preload 注入晚于 load 事件(渲染进程复用
  // process-per-site / 冷启动常见),监听器永不触发 → 预填充失效,且 startObserver
  // 也在 loadForms 内、一并失效。按 readyState 决定立即执行还是等 DOM 就绪。
  // 传统登录表单 DOMContentLoaded 时已在 DOM,不必等图片等资源。
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', AutoComplete.loadForms, { once: true });
    // SPA 晚渲染兜底:即便 DOMContentLoaded 早跑,资源全部到位后再补一次
    window.addEventListener('load', AutoComplete.loadForms, { once: true });
  } else {
    AutoComplete.loadForms();
  }
  window.addEventListener('mousedown', AutoComplete.onWindowMouseDown);
}

const postMsg = (data: any, res: any) => {
  window.postMessage(
    {
      id: data.id,
      result: res,
      type: 'result',
    },
    '*',
  );
};

let hostname = window.location.href.substr(WEBUI_BASE_URL.length);
window.addEventListener('DOMContentLoaded', () => {
  // 开源版：Edge 商店「下载到本浏览器」引导脚本已移除。

  if (
    __nodeProcess.env.ENABLE_EXTENSIONS &&
    window.location.href.startsWith('https://chromewebstore.google.com')
  ) {
    const activatedButtons = new WeakSet<HTMLButtonElement>();
    const extensionIdPattern = /\/detail\/[^/]+\/([a-p]{32})(?:[/?#]|$)/i;
    const installButtonText = /^(添加至 Chrome|Add to Chrome)$/i;

    const activateInstallButton = () => {
      const extensionId = window.location.href.match(extensionIdPattern)?.[1];
      if (!extensionId) return;

      for (const button of Array.from(document.querySelectorAll('button'))) {
        const label = button.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (!installButtonText.test(label)) continue;

        button.disabled = false;
        button.removeAttribute('disabled');
        button.removeAttribute('aria-disabled');
        button.removeAttribute('aria-describedby');

        if (activatedButtons.has(button)) continue;
        activatedButtons.add(button);
        button.addEventListener(
          'click',
          (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();

            const currentExtensionId = window.location.href.match(
              extensionIdPattern,
            )?.[1];
            if (!currentExtensionId) return;

            const prodVersion = __nodeProcess.versions.chrome || '133.0.0.0';
            const updateValue = encodeURIComponent(
              `id=${currentExtensionId}&installsource=ondemand&uc`,
            );
            window.location.href =
              'https://clients2.google.com/service/update2/crx' +
              `?response=redirect&prodversion=${encodeURIComponent(
                prodVersion,
              )}` +
              `&acceptformat=crx2,crx3&x=${updateValue}`;
          },
          true,
        );
      }
    };

    activateInstallButton();
    new MutationObserver(activateInstallButton).observe(
      document.documentElement,
      {
        childList: true,
        subtree: true,
      },
    );
  }
});

//console.log("preload", window.location.href, hostname);
if (window.location.href == "about:blank") {
  hostname = "newtab";
}
if (
  window.location.href.startsWith(WEBUI_BASE_URL) ||
  window.location.protocol === `${ERROR_PROTOCOL}:` ||
  window.location.href == "about:blank"
) {
  (async function () {
    const w = await webFrame.executeJavaScript('window');
    w.settings = settings;
    if (canExposeRequire(window.location.href)) {
      w.require = requireShim;
    }
    w.electron = electronRenderer;
    // With `sandbox: true` the nested `electron` object above does not expose
    // its methods across the world boundary, so pages can't call
    // `window.electron.ipcRenderer.invoke/send`. Plain functions do transfer
    // (same mechanism as `getHistory`/`getTopSites` below), so bridge the two
    // IPC primitives the webui pages actually need.
    w.ipcInvoke = (channel: string, ...args: any[]) =>
      ipcRenderer.invoke(channel, ...args);
    w.ipcSend = (channel: string, ...args: any[]) =>
      ipcRenderer.send(channel, ...args);
    w.getPathForFile = (file: File) => webUtils.getPathForFile(file);
    w['supervideo-app-version'] = __nodeProcess.env.VERSION_CODE;

    if (window.location.protocol === `${ERROR_PROTOCOL}:`) {
      w.theme = getTheme(w.settings.theme);
      w.errorURL = await ipcRenderer.invoke(`get-error-url-${tabId}`);
      // Wired to the error page's buttons. Exposed as top-level functions (not a
      // nested object) because, with `sandbox: true`, only plain functions
      // transfer to the page world — methods on a nested object are lost (same
      // reason ipcInvoke/ipcSend are bridged above).
      w.errorReload = () => {
        ipcRenderer
          .invoke(`reload-error-url-${tabId}`)
          .catch(() => undefined);
      };
      w.errorGoHome = () => {
        ipcRenderer.invoke(`web-contents-call`, {
          webContentsId: tabId,
          method: 'home',
        });
      };
      w.errorCheckNetwork = () => {
        ipcRenderer.invoke('check-network').catch(() => undefined);
      };
      w.errorCopyDiagnostics = (text: string) => {
        clipboard.writeText(typeof text === 'string' ? text : '');
      };
      w.errorIgnoreCertificateError = async () => {
        const res = await ipcRenderer.invoke(`ignore-certificate-error-${tabId}`);
        if (!res?.error) {
          if (typeof res?.retryUrl === 'string' && res.retryUrl) {
            window.location.replace(res.retryUrl);
          } else if (w.errorURL) window.location.replace(w.errorURL);
          else window.location.reload();
        }
        return res;
      };
      w.errorAddAdblockWhitelist = async (domain?: string) => {
        let targetDomain = typeof domain === 'string' ? domain.trim() : '';
        if (!targetDomain && w.errorURL) {
          try {
            targetDomain = new URL(w.errorURL).hostname || '';
          } catch (e) {}
        }
        const res = await ipcRenderer.invoke('adblock-add-whitelist', targetDomain);
        if (!res?.error || res.error === '该域名已在白名单') {
          if (w.errorURL) window.location.replace(w.errorURL);
          else window.location.reload();
        }
        return res;
      };
    } else {
      w.getHistory = async () => {
        return await ipcRenderer.invoke(`history-get`);
      };
      w.cloudDownloadHistory = async () => {
        try {
          await ipcRenderer.invoke('cloud-download-history');
        } catch (e) {
          // 云服务可选,失败不影响本地历史展示
        }
      };
      w.removeHistory = (ids: string[]) => {
        // ids 可能是 MobX observable 数组(Proxy),无法被 IPC 的 structuredClone 序列化,
        // 展开成普通数组再发送。
        ipcRenderer.send(`history-remove`, ids == null ? ids : [...ids]);
      };
      // 立即清除浏览数据(设置页 Privacy「清除」按钮)。webui 页面 nodeIntegration:false,
      // 不能直接 import ipcRenderer(require 未定义),故由 preload 注入全局函数桥接。
      w.clearBrowsingDataNow = async (items: {
        cache: boolean;
        cookies: boolean;
        history: boolean;
        searchHistory: boolean;
      }) => {
        return await ipcRenderer.invoke('clear-browsing-data-now', {items});
      };
      w.getTopSites = async (count: number) => {
        return await ipcRenderer.invoke(`topsites-get`, count);
      };

      // 看图模式:ZIP 打包进度(主进程逐张拉取时上报,仅 image-viewer 页消费)。
      ipcRenderer.on('image-viewer-zip-progress', async (_e, data) => {
        const wp = await webFrame.executeJavaScript('window');
        if (wp.imageViewerZipProgress) wp.imageViewerZipProgress(data);
      });
    }
    if (window.location.href == "about:blank" && settings.doNotTrack) {
      const w = await webFrame.executeJavaScript('window');
      Object.defineProperty(w.navigator, 'doNotTrack', {value: 1});
    }
  })();
} else {
  (async function () {
    if (settings.doNotTrack) {
      const w = await webFrame.executeJavaScript('window');
      Object.defineProperty(w.navigator, 'doNotTrack', {value: 1});
    }
  })();
}

if (window.location.href.startsWith(WEBUI_BASE_URL) ||
  window.location.href == "about:blank") {
  window.addEventListener('DOMContentLoaded', () => {
    hostname = window.location.href.substr(WEBUI_BASE_URL.length);
    if (hostname.startsWith('settings')) document.title = '设置';
    else if (hostname.startsWith('history')) document.title = '历史记录';
    else if (hostname.startsWith('bookmarks')) document.title = '书签';
    else if (hostname.startsWith('downloads')) document.title = '下载管理';
    else if (hostname.startsWith('extensions')) document.title = '扩展程序';
    else if (hostname.startsWith('newtab')) {
      document.title = '新标签页';
    }
    else if (hostname.startsWith('image-viewer')) {
      document.title = '看图模式';
    }
  });

  window.addEventListener('message', async ({data}) => {
    if (data.type === 'storage') {
      const res = await ipcRenderer.invoke(`storage-${data.operation}`, {
        scope: data.scope,
        ...data.data,
      });

      postMsg(data, res);
    } else if (data.type === 'credentials-get-password') {
      const res = await ipcRenderer.invoke(
        'credentials-get-password',
        data.data,
      );
      postMsg(data, res);
    } else if (data.type === 'save-settings') {
      ipcRenderer.send('save-settings', {settings: data.data});
    } else if (data.type === 'save-web-browsing-settings') {
      ipcRenderer.send('save-web-browsing-settings', data.data);
    } else if (data.type === 'show-adblock-rule') {
      ipcRenderer.send(`show-adblock-rule-${windowId}`);
    }
  });

  ipcRenderer.on('update-settings', async (e, data) => {
    const w = await webFrame.executeJavaScript('window');
    if (w.updateSettings) {
      w.updateSettings(data);
    }
  });

  ipcRenderer.on('credentials-insert', (e, data) => {
    window.postMessage(
      {
        type: 'credentials-insert',
        data,
      },
      '*',
    );
  });

  ipcRenderer.on('credentials-update', (e, data) => {
    window.postMessage(
      {
        type: 'credentials-update',
        data,
      },
      '*',
    );
  });

  ipcRenderer.on('credentials-remove', (e, data) => {
    window.postMessage(
      {
        type: 'credentials-remove',
        data,
      },
      '*',
    );
  });

  ipcRenderer.on('credentials-reload', () => {
    window.postMessage({ type: 'credentials-reload' }, '*');
  });
  if(window.location.href == "about:blank") {
    window.addEventListener('message', async ({data}) => {
      if (data.type === 'supervideo-video-created') {
        //console.log("supervideo-video-created message", data);
        const tabId = ipcRenderer.sendSync('get-webcontents-id');
        ipcRenderer.send(`supervideo-video-created-${tabId}`, {
          url: data.src,
        });
      }
    });
  }
} else {
  window.addEventListener('message', async ({data}) => {
    if (data.type === 'supervideo-video-created') {
      //console.log("supervideo-video-created message", data);
      const tabId = ipcRenderer.sendSync('get-webcontents-id');
      ipcRenderer.send(`supervideo-video-created-${tabId}`, {
        url: data.src,
      });
    }
  });
}
