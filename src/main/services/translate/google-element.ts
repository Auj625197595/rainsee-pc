import {execInPagePreferMainFrame} from '../../utils/execute-in-top-page';

// 谷歌网页翻译组件(Google Translate Element)模式。
// 与 runTranslate 的"collect → 主进程翻译 → apply"不同,本模式直接在页面主世界注入
// translate.google.com/translate_a/element.js,由谷歌组件自行翻译整页(含动态内容)。
//  - 开始翻译:首次写 googtrans=/auto/<target> cookie → 注入 element.js → 回调里 new TranslateElement;
//    之后(取消后再翻译/切语言)驱动组件自带的语言下拉框。
//  - 取消翻译:模拟点击谷歌横幅的关闭链接(<a id=":N.close">),找不到且页面已译则清 cookie 后 reload。
// 局限:页面 CSP 禁止远程脚本时 element.js 加载失败;谷歌服务不可达时同样失败(日志可见)。
// 划词翻译不走本模式(见 registry.getActiveEngine 回退微软)。

// 谷歌组件 includedLanguages:参考代码的列表 + 本应用 LANGUAGES 里的目标语言。
const INCLUDED_LANGUAGES =
  'zh-CN,zh-TW,en,hr,cs,da,nl,fr,de,el,iw,hu,ga,it,ja,ko,pt,ro,ru,sr,es,th,vi,hmn,eo,my,mn,tl,ar,ms,no,la,lo';

// 应用语言码 → 谷歌组件语言码。目前的 LANGUAGES 与谷歌一致,保留映射点便于扩展。
const mapGoogleLang = (code: string) => code || 'zh-CN';

// 页面侧共用:清除各作用域(host / .host / .可注册域名)下的 googtrans cookie。
// 谷歌组件自身会在 domain cookie 上写值,只清 host cookie 会被旧值覆盖。
const CLEAR_COOKIE_FN = `function __rsClearGoogtrans(){var h=location.hostname;var exp='; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';document.cookie='googtrans='+exp;if(h&&h.indexOf('.')>0){document.cookie='googtrans='+exp+'; domain='+h;document.cookie='googtrans='+exp+'; domain=.'+h;var p=h.split('.');if(p.length>2){document.cookie='googtrans='+exp+'; domain=.'+p.slice(-2).join('.');}}}`;

// 页面侧共用:在文档及同源子帧(旧版横幅是 .goog-te-banner-frame)里找关闭链接。
const FIND_CLOSE_FN = `function __rsFindGoogleClose(){var sel='a[id$=".close"]';var a=document.querySelector(sel);if(a)return a;var fs=document.querySelectorAll('iframe');for(var i=0;i<fs.length;i++){try{var d=fs[i].contentDocument;if(d){a=d.querySelector(sel);if(a)return a;}}catch(e){}}return null;}`;

// 驱动方式:整页只建一个 TranslateElement 实例(默认下拉布局,挂载点隐藏),每次开始翻译都
// 写 cookie 后设置组件自带的 select.goog-te-combo 并派发 change。
// 不能"取消后再 new 一个实例":组件只在 element.js 首次加载时读 googtrans cookie,
// 重建实例不会触发翻译,表现为"取消翻译后再点翻译无效"。
const buildInjectCode = (target: string) => `(function(target){
  ${CLEAR_COOKIE_FN}
  var html = document.documentElement;
  var translated = html.classList.contains('translated-ltr') || html.classList.contains('translated-rtl');
  var st = window.__rainseeGoogleTranslate;
  if (st && st.target === target && translated) return Promise.resolve('same');
  __rsClearGoogtrans();
  document.cookie = 'googtrans=/auto/' + target + '; path=/';
  window.__rainseeGoogleTranslate = {target: target};
  var findCombo = function() { return document.querySelector('#google_translate_element select.goog-te-combo'); };
  var selectLang = function(combo) {
    if (combo.value === target && translated) return;
    combo.value = target;
    combo.dispatchEvent(new Event('change'));
  };
  window.googleTranslateElementInit = function() {
    try {
      new google.translate.TranslateElement({
        multilanguagePage: true,
        pageLanguage: 'auto',
        includedLanguages: ${JSON.stringify(INCLUDED_LANGUAGES)}
      }, 'google_translate_element');
    } catch (e) { console.log('[rainsee-google-translate] init failed', e); }
  };
  return new Promise(function(resolve) {
    var done = false;
    var finish = function(r) { if (!done) { done = true; resolve(r); } };
    setTimeout(function() { finish('timeout'); }, 15000);
    // 组件实例已在(取消后再翻译 / 切换语言):直接驱动下拉框。
    var combo = findCombo();
    if (combo) { selectLang(combo); return finish('combo'); }
    var tries = 0;
    (function waitHead() {
      var head = document.head || document.querySelector('head');
      if (!(head && document.body && (document.readyState === 'complete' || document.readyState === 'interactive'))) {
        if (++tries > 100) return finish('no-head');
        return setTimeout(waitHead, 300);
      }
      if (!document.getElementById('google_translate_element')) {
        var mount = document.createElement('div');
        mount.id = 'google_translate_element';
        // 语言选择由浏览器自己的翻译弹窗负责,组件下拉框只作驱动用,隐藏。
        mount.style.cssText = 'display:none;';
        html.appendChild(mount);
      }
      // element.js 已加载但实例丢失(挂载点被页面移除):重建实例后等下拉框出现再驱动。
      if (window.google && google.translate && google.translate.TranslateElement) {
        window.googleTranslateElementInit();
        var n = 0;
        (function waitCombo() {
          var c = findCombo();
          if (c) { selectLang(c); return finish('reinit'); }
          if (++n > 50) return finish('no-combo');
          setTimeout(waitCombo, 100);
        })();
        return;
      }
      // 首次加载:组件读 cookie 自动翻译。
      var script = document.createElement('script');
      script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
      script.onload = function() { finish('loaded'); };
      script.onerror = function() { finish('script-error'); };
      head.appendChild(script);
    })();
  });
})(${JSON.stringify(target)})`;

const REVERT_CODE = `(function(){
  ${CLEAR_COOKIE_FN}
  ${FIND_CLOSE_FN}
  if (!window.__rainseeGoogleTranslate) return 'none';
  delete window.__rainseeGoogleTranslate;
  __rsClearGoogtrans();
  // 保留挂载点与组件实例,下次开始翻译直接驱动下拉框。
  var close = __rsFindGoogleClose();
  if (close) {
    try { close.click(); } catch (e) {}
    return 'closed';
  }
  // 横幅不存在(组件未完成翻译或谷歌改版):清 cookie 后刷新回原文。
  if (document.documentElement.classList.contains('translated-ltr') ||
      document.documentElement.classList.contains('translated-rtl')) {
    location.reload();
    return 'reload';
  }
  return 'not-translated';
})()`;

export const runGoogleElementTranslate = async (
  wc: Electron.WebContents,
  target: string,
): Promise<{ok: boolean; result: string}> => {
  if (!wc || wc.isDestroyed()) return {ok: false, result: 'destroyed'};
  const lang = mapGoogleLang(target);
  try {
    const result = String(
      (await execInPagePreferMainFrame(wc, buildInjectCode(lang), true)) || '',
    );
    console.log(`[translate] google-element inject | target=${lang} result=${result}`);
    return {ok: ['loaded', 'combo', 'reinit', 'same'].includes(result), result};
  } catch (e) {
    console.log('[translate] google-element inject failed', e);
    return {ok: false, result: 'exec-error'};
  }
};

// 无谷歌注入标记时是空操作,因此可与微软 revert 一并调用(切引擎时两边都还原)。
export const revertGoogleElementTranslate = async (
  wc: Electron.WebContents,
): Promise<void> => {
  if (!wc || wc.isDestroyed()) return;
  try {
    const result = await execInPagePreferMainFrame(wc, REVERT_CODE, true);
    if (result !== 'none') console.log(`[translate] google-element revert | result=${result}`);
  } catch (e) {
    console.log('[translate] google-element revert failed', e);
  }
};
