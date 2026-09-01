import { WebContents } from 'electron';

import { isDarkThemeActive } from './theme';

/**
 * 移除 Dark Reader 注入的 <style class="darkreader">。Dark Reader(随生效主题启用的
 * darknight.crx)在面板页可能叠加深色样式,先清掉再注入自有的夜间样式,避免双重变暗。
 */
const REMOVE_DARKREADER = `
try { document.querySelectorAll('style.darkreader').forEach(function (e) { e.remove(); }); } catch (e) {}
`;

// 秘塔(metaso.cn)深色:切 theme=dark 并加 medium/dark class。
const METASO_DARK = `
try {
  localStorage.setItem('theme', 'dark');
  var htmlyujianElement = document.documentElement;
  htmlyujianElement.classList.remove('light');
  htmlyujianElement.classList.add('medium', 'dark');
  htmlyujianElement.style.setProperty('color-scheme', 'dark');
} catch (e) {}
`;

// 秘塔(metaso.cn)亮色:切 theme=light 并加 medium/light class。
const METASO_LIGHT = `
try {
  localStorage.setItem('theme', 'light');
  var htmlyujianElement = document.documentElement;
  htmlyujianElement.classList.remove('dark');
  htmlyujianElement.classList.add('medium', 'light');
  htmlyujianElement.style.setProperty('color-scheme', 'light');
} catch (e) {}
`;

// 通用夜间样式:覆盖文字/背景/链接/图片/视频等配色(雨见浏览器夜间模式样式表)。
const GENERIC_DARK = `(function(){var fontcolor="white";var bgcolor="2121216b";var inner="img{filter: brightness(0.7) !important} iframe{filter: invert(1) brightness(0.7) !important} html, body , html * { color: #eeeeee !important; background-color: #"+bgcolor+" !important; } img, html video {z-index: 1}html * {border-color: #555555 !important} cite,  cite * {color: #029833 !important}html :link, html :link * {color: #8db2e5 !important} input,  textarea {background-color: #333333 !important} a,p {background-color: rgba(255, 255, 255, 0.01) !important}html :visited, html :visited * {color: rgb(211, 138, 138) !important}html, html::before, html body, html body::before,  input,  select, button {background-image: none !important}html video, code { background: transparent !important; }";var e=document.getElementById("yjbrowser_night_mode_style");e&&document.getElementsByTagName("head")[0].removeChild(e);if(document.getElementById("yjbrowser_night_mode_style")){return}css=document.createElement("link"),css.id="yjbrowser_night_mode_style",css.rel="stylesheet",css.href='data:text/css,  '+inner,document.getElementsByTagName("head").length!=0?document.getElementsByTagName("head")[0].appendChild(css):document.getElementsByTagName("body")[0].appendChild(css);var e=document.getElementById("yjbrowser_night_mode_style2");e&&document.getElementsByTagName("head")[0].removeChild(e);if(document.getElementById("yjbrowser_night_mode_style2")){return}css=document.createElement("style"),css.id="yjbrowser_night_mode_style2",css.innerHTML=inner,document.getElementsByTagName("head").length!=0?document.getElementsByTagName("head")[0].appendChild(css):document.getElementsByTagName("body")[0].appendChild(css);var ps=document.getElementsByTagName("font");for(var i=0;i<ps.length;i++){ps[i].style="color: #"+fontcolor+" !important;"};ps=document.getElementsByTagName("P");for(var i=0;i<ps.length;i++){ps[i].style="color: #"+fontcolor+" !important;"}document.querySelector("body").style.setProperty('background-color','transparent','important')})();`;

const hostMatches = (host: string, base: string) =>
  host === base || host.endsWith('.' + base);

/**
 * 面板主题模式注入(随生效主题)。在 dom-ready 与 did-finish-load 调用:
 *  夜间模式:统一移除 Dark Reader 的 <style class="darkreader">;
 *           metaso.cn → 注入秘塔深色;
 *           其他 → 注入通用夜间样式表。
 *  亮色模式:仅 metaso.cn → 注入秘塔亮色主题;其余不动。
 */
export const injectPanelThemeMode = (wc: WebContents) => {
  if (!wc || wc.isDestroyed()) return;

  let host = '';
  try {
    host = new URL(wc.getURL()).hostname;
  } catch {
    return;
  }

  const isMetaso = hostMatches(host, 'metaso.cn');

  if (isDarkThemeActive()) {
    // 夜间模式:统一先移除 darkreader,再按 host 注入。
    const script = REMOVE_DARKREADER + (isMetaso ? METASO_DARK : GENERIC_DARK);
    wc.executeJavaScript(script, true).catch(() => undefined);
    return;
  }

  // 亮色模式:仅 metaso 切到 light 主题。
  if (isMetaso) {
    wc.executeJavaScript(METASO_LIGHT, true).catch(() => undefined);
  }
};
