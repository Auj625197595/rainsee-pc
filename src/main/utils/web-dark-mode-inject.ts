import {WebContents, app} from 'electron';
import {readFileSync} from 'fs';
import {join} from 'path';

import {execInPagePreferMainFrame} from './execute-in-top-page';

// 网页暗色模式(浏览器实现):经 webContents.executeJavaScript 注入 Dark Reader 4.9.58 引擎。
// executeJavaScript 不受页面 CSP 约束(同 translate)。DR 源码读自 static/scripts/darkreader.min.js。
//
// 关键①(UMD 模块系统误判):DR UMD 头部按 exports/module/define 决定挂载方式——
//   `typeof exports=='object' && typeof module!='undefined' ? t(exports) :        // CommonJS
//    typeof define=='function' && define.amd ? define(['exports'], t) :           // AMD
//    t((globalThis).DarkReader={})`                                               // 全局
// 普通网页主世界可能已有 exports/module/define(页面框架/RequireJS/某些注入),使 UMD 走
// CommonJS/AMD 分支,把 DarkReader 挂到 exports 而非 window.DarkReader(实测百度页
// typeof DarkReader==='undefined')。故用受控闭包提供干净的 exports/module/define 遮蔽全局,
// 强制走 CommonJS,执行后从 module.exports 取出 DarkReader 显式挂到 globalThis.DarkReader。
// 关键②(暗站门控):Dark Reader npm API 不自带暗色检测——enable() 会把暗色背景反转为亮色,
// 复现"黑变白"。故 enable 前读根/body 背景亮度,已是暗色则跳过(保持原样),只对亮色站点
// 应用 DR。宁可漏判(亮站不変暗)也不误判(暗站黑变白)。

let cachedBootstrap = '';

const getDarkReaderBootstrap = (): string => {
  if (cachedBootstrap) return cachedBootstrap;
  const scriptPath = join(app.getAppPath(), 'static', 'scripts', 'darkreader.min.js');
  try {
    cachedBootstrap = readFileSync(scriptPath, 'utf8');
  } catch (error) {
    console.log('[web-dark-mode] !! failed to read darkreader.min.js', scriptPath, error);
    return '';
  }
  return cachedBootstrap;
};

const DARK_BG_THRESHOLD = 118;

// 受控闭包加载器:用内层函数参数 exports/module/define 遮蔽全局同名变量,强制 DR UMD 走
// CommonJS 分支(factory 挂到我们的 exports=module.exports),再把结果显式挂到 globalThis.
// DarkReader。bootstrap 用字符串拼接(不插值),其内容(反引号/${)不影响外层模板。
// 任何加载异常写入 window.__drLoadErr 供驱动代码读取诊断。
const buildLoader = (bootstrap: string): string =>
  `;
(function () {
  var module = {exports: {}};
  var exports = module.exports;
  try {
    (function (exports, module, define) {
` + bootstrap + `
    })(exports, module, undefined);
  } catch (e) {
    window.__drLoadErr = String((e && e.message) || e);
  }
  var DR = null;
  if (module.exports && typeof module.exports.enable === 'function') DR = module.exports;
  else if (module.exports && module.exports.DarkReader && typeof module.exports.DarkReader.enable === 'function') DR = module.exports.DarkReader;
  else if (typeof globalThis.DarkReader === 'object' && globalThis.DarkReader && typeof globalThis.DarkReader.enable === 'function') DR = globalThis.DarkReader;
  if (DR) globalThis.DarkReader = DR;
  else window.__drLoadErr = window.__drLoadErr || 'DR-not-found-after-load';
})();
`;

// 驱动代码:拼在 loader 之后执行。始终返回诊断对象 diag,供主进程定位。
// 暗站判断不能只看 html/body:很多站点根节点是暗色,真正占满视口的内容容器却是白色。
// 这里对视口做网格采样,沿命中元素祖先向上寻找第一个不透明背景;只有绝大多数采样点
// 都是暗色时才跳过 Dark Reader。透明画布按亮色处理,避免默认黑字直接落在深色 BrowserView 上。
const DRIVER = `(function () {
  var diag = {samples: 0, darkSamples: 0, lightSamples: 0};
  diag.envExports = typeof exports;
  diag.envModule = typeof module;
  diag.envDefine = typeof define;
  diag.loadErr = window.__drLoadErr || null;
  try {
    if (window.__rainseeDarkReaderEnabled && document.querySelector('style.darkreader--fallback, style.darkreader--variables, style.darkreader--invert, style.darkreader--root-vars')) {
      diag.ready = true;
      diag.reused = true;
      return diag;
    }
    // —— 暗站门控:视口有充分暗色证据时保持原样,避免把原生暗站反相变亮 ——
    var parseLuma = function (css) {
      if (!css) return null;
      var m = css.match(/rgba?\\(([^)]+)\\)/i);
      if (!m) return null;
      var parts = m[1].split(',').map(function (s) { return parseFloat(s); });
      if (parts.length < 3) return null;
      for (var i = 0; i < 3; i++) { if (isNaN(parts[i])) return null; }
      var a = parts.length > 3 ? parts[3] : 1;
      if (a < 0.85) return null;
      return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
    };
    var sampleAt = function (x, y) {
      var el = document.elementFromPoint(x, y);
      while (el) {
        var style = getComputedStyle(el);
        // preload 在文档首帧给 html 放了临时深色画布;它不是网站自身配色,
        // 不能参与暗站判定,否则无背景的普通白页会被误判后跳过。
        if (el === document.documentElement && style.getPropertyValue('--rainsee-web-dark-loading').trim() === '1') {
          return null;
        }
        var luma = parseLuma(style.backgroundColor);
        if (luma !== null) return luma;
        el = el.parentElement;
      }
      return null;
    };
    var xs = [0.1, 0.3, 0.5, 0.7, 0.9];
    var ys = [0.12, 0.32, 0.52, 0.72, 0.9];
    var width = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    var height = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
    for (var yi = 0; yi < ys.length; yi++) {
      for (var xi = 0; xi < xs.length; xi++) {
        var luma = sampleAt(Math.max(0, Math.min(width - 1, width * xs[xi])), Math.max(0, Math.min(height - 1, height * ys[yi])));
        if (luma === null) continue;
        diag.samples++;
        if (luma < ${DARK_BG_THRESHOLD}) diag.darkSamples++;
        else diag.lightSamples++;
      }
    }
    diag.darkRatio = diag.samples ? diag.darkSamples / diag.samples : 0;
    diag.drDefined = (typeof DarkReader !== 'undefined');
    if (diag.samples >= 8 && diag.darkRatio >= 0.88 && diag.lightSamples <= 2) {
      diag.skipped = true;
      return diag; // 已暗色,保持原样
    }
    if (!diag.drDefined) {
      diag.noDR = true;
      return diag; // loader 未能挂上 DarkReader
    }
    // 跨域样式表需原生 fetch 拉取(DR 默认 fetcher 是 throwCORSError,不设则覆盖不全)
    try { DarkReader.setFetchMethod(window.fetch); } catch (e) { diag.fetchErr = String((e && e.message) || e); }
    try {
      DarkReader.enable({
        mode: 1, // 1=dark, 0=dimmed(无 'dark' 字符串)
        brightness: 100,
        contrast: 100,
        sepia: 0,
        immediateModify: true, // 跳过 document.hidden 延迟,利于消 FOUC
      });
      window.__rainseeDarkReaderEnabled = true;
      diag.enabled = true;
    } catch (e) {
      diag.enableErr = String((e && e.message) || e);
      return diag;
    }

    // —— FOUC 收尾:等 DR 首批动态样式落盘再 resolve ——
    // BrowserView 加载时会暂时从窗口分离,此时 requestAnimationFrame 可能停摆。
    // MutationObserver + 定时器不依赖可见帧,避免注入 Promise 永远挂住。
    return new Promise(function (resolve) {
      var done = false;
      var observer = null;
      var finish = function () {
        if (done) return;
        var ready = !!document.querySelector('style.darkreader--fallback, style.darkreader--variables, style.darkreader--invert, style.darkreader--root-vars');
        if (!ready) return;
        done = true;
        if (observer) observer.disconnect();
        clearInterval(interval);
        clearTimeout(timeout);
        diag.ready = true;
        resolve(diag);
      };
      observer = new MutationObserver(finish);
      observer.observe(document.documentElement, {childList: true, subtree: true});
      var interval = setInterval(finish, 25);
      var timeout = setTimeout(function () {
        if (done) return;
        done = true;
        observer.disconnect();
        clearInterval(interval);
        diag.ready = false;
        diag.readyTimeout = true;
        resolve(diag);
      }, 1500);
      finish();
    });
  } catch (e) {
    diag.outerErr = String((e && e.message) || e);
    return diag;
  }
})();
`;

// 重试子框架注入时先在最外层检查成功标记,避免再次解析约 90KB 的 Dark Reader 源码。
const buildInjectionScript = (bootstrap: string): string => `
(function () {
  if (window.__rainseeDarkReaderEnabled && document.querySelector('style.darkreader--fallback, style.darkreader--variables, style.darkreader--invert, style.darkreader--root-vars')) {
    return {ready: true, reused: true};
  }
${buildLoader(bootstrap)}
  return ${DRIVER}
})();
`;

// 注入 Dark Reader 暗色。返回 Promise:resolve = 暗化已生效(或判定为暗站跳过)。
// 供 view.ts injectWebDarkMode 调用,由 dom-ready 触发并作为页面恢复显示的门控。
export const injectDarkReader = async (wc: WebContents): Promise<void> => {
  const bootstrap = getDarkReaderBootstrap();
  if (!bootstrap) {
    console.log('[web-dark-mode] bootstrap empty (darkreader.min.js unreadable)');
    return;
  }
  let url = '';
  try { url = wc.getURL(); } catch {}
  console.log('[web-dark-mode] injecting loader+' + bootstrap.length + ' url=' + url);
  try {
    // 普通网页的 webContents.executeJavaScript 在少数 SPA/沙箱页面会挂住且不抛错;
    // WebFrameMain 是更可靠的主框架通道,失败时工具函数仍会回退到 webContents。
    const diag = await Promise.race([
      execInPagePreferMainFrame(wc, buildInjectionScript(bootstrap), true),
      new Promise((resolve) => setTimeout(() => resolve({executeTimeout: true}), 2500)),
    ]);
    console.log('[web-dark-mode] diag=' + JSON.stringify(diag));
    // preload 的首帧防闪 CSS 只负责遮住 Dark Reader 生效前的白色画布。确认已暗化
    // (或可靠判定原生暗站)后立即移除,避免长期覆盖站点自己的根背景。
    let currentUrl = '';
    try { currentUrl = wc.getURL(); } catch {}
    if (
      currentUrl === url &&
      ((diag as any)?.ready || (diag as any)?.skipped)
    ) {
      try { wc.send('web-dark-mode-ready'); } catch {}
    }
  } catch (e) {
    console.log('[web-dark-mode] executeJavaScript THREW: ' + String((e && (e.message || e)) || e));
  }
};

/**
 * 子框架不会执行 view-preload,跨域 iframe 也不受顶层 Dark Reader 实例控制。
 * 直接在对应 WebFrameMain 的主世界运行同一引擎;调用方无需等待它,避免慢 iframe
 * 阻塞顶层页面显示。frame-created 的早期注入若失败,did-frame-finish-load 会再补一次。
 */
export const injectDarkReaderIntoFrame = async (
  frame: Pick<Electron.WebFrameMain, 'executeJavaScript' | 'url'>,
): Promise<void> => {
  const bootstrap = getDarkReaderBootstrap();
  if (!bootstrap) return;
  try {
    const diag = await Promise.race([
      frame.executeJavaScript(buildInjectionScript(bootstrap), true),
      new Promise((resolve) => setTimeout(() => resolve({executeTimeout: true}), 2500)),
    ]);
    console.log('[web-dark-mode] frame diag=' + JSON.stringify(diag) + ' url=' + (frame.url || ''));
  } catch (e) {
    console.log('[web-dark-mode] frame injection failed: ' + String((e && (e.message || e)) || e));
  }
};
