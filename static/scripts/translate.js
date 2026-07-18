/* 网页翻译注入脚本 —— 忠实移植安卓 WaitConstants.TRANSLATEJS。
 * 关键:加载自包含的 v3 引擎 entry(47KB,含完整 widget 引擎),并单独定义
 * googleTranslateElementInit 回调。早期版本用本地 element_new.js 只拉到 6KB 的
 * i18n 字符串、没拉 245KB 的引擎,导致 widget 永不初始化。
 * 全程写 window.__rainseeTranslateDebug 供主进程回读排查。 */
(function () {
  var dbg = function (m) {
    try {
      (window.__rainseeTranslateDebug = window.__rainseeTranslateDebug || []).push(String(m));
      console.log('[rainsee-translate] ' + m);
    } catch (e) {}
  };
  dbg('inject start url=' + location.href);

  if (window.translateelemet) {
    dbg('already injected, abort');
    return 'already';
  }
  window.translateelemet = true;
  dbg('guard set');

  var ENGINE_URL = 'https://news.yujianpay.com/js/translatev3/element_new.js?t=67';

  function wait() {
    var head = document.querySelector('head');
    if (head && document.body) {
      run();
    } else {
      dbg('waiting head/body');
      setTimeout(wait, 300);
    }
  }

  function run() {
    try {
      // 关键:在引擎加载前写 googtrans cookie 设定目标语言,否则 widget 不自动翻译。
      // 该 widget 是改造版(translatenew.js 的 Mu 解析器),要求格式 googtrans=<时间戳>_/auto/<目标>,
      // 用 indexOf('_') 过滤:缺 "<ts>_" 前缀的 cookie 会被忽略。与安卓 ResideUtil 一致。
      // 目标 = App 语言(主进程替换占位符,默认 zh-CN)。
      var tgt = "__TRANSLATE_TARGET__";
      var exp = new Date(Date.now() + 365 * 24 * 3600 * 1000).toUTCString();
      var setGoogTrans = function (v) {
        document.cookie = 'googtrans=' + v + '; path=/; expires=' + exp;
        var parts = location.hostname.split('.');
        if (parts.length >= 2) {
          var dom = parts.slice(-2).join('.');
          document.cookie = 'googtrans=' + v + '; path=/; domain=.' + dom + '; expires=' + exp;
        }
      };
      var transCookieVal = Date.now() + '_/auto/' + tgt;
      setGoogTrans(transCookieVal);
      dbg('set googtrans=' + transCookieVal + '  cookieNow=' + document.cookie);

      dbg('head/body ready, appending v3 engine script: ' + ENGINE_URL);
      var s = document.createElement('script');
      s.type = 'text/javascript';
      s.charset = 'UTF-8';
      s.src = ENGINE_URL;
      s.onload = function () { dbg('engine script onload'); };
      s.onerror = function () { dbg('!! engine script onerror —— CSP 拦截或网络失败'); };
      document.querySelector('head').appendChild(s);

      var el = document.createElement('div');
      el.id = 'google_translate_element';
      el.style = 'font-size:16px;position:fixed;bottom:10px;right:10px;cursor:pointer;Z-INDEX:99999;';
      document.documentElement.appendChild(el);
      dbg('container #google_translate_element created');

      var init = document.createElement('script');
      init.innerHTML =
        "function googleTranslateElementInit(){" +
        "try{(window.__rainseeTranslateDebug=window.__rainseeTranslateDebug||[]).push('googleTranslateElementInit called');" +
        "new google.translate.TranslateElement({layout:google.translate.TranslateElement.InlineLayout.SIMPLE,multilanguagePage:true,pageLanguage:'auto',includedLanguages:'zh-CN,zh-TW,en,hr,cs,da,nl,fr,de,el,iw,hu,ga,it,ja,ko,pt,ro,ru,sr,es,th,vi,hmn,eo,my,mn,tl,ar,ms,no,la,lo'},'google_translate_element');" +
        "}catch(e){(window.__rainseeTranslateDebug=window.__rainseeTranslateDebug||[]).push('init ERROR: '+e);throw e;}}";
      document.getElementsByTagName('head')[0].appendChild(init);
      dbg('init callback googleTranslateElementInit installed');

      // 轮询 widget 是否真正起来
      var n = 0;
      var iv = setInterval(function () {
        n++;
        var gt = !!(window.google && window.google.translate && window.google.translate.TranslateElement);
        var bf = !!document.querySelector('.goog-te-banner-frame, .skiptranslate iframe, #google_translate_element select');
        if (gt || bf || n % 4 === 0) { dbg('poll#' + n + ' google.translate=' + gt + ' widgetDom=' + bf); }
        if (bf) { dbg('>> WIDGET ALIVE — 翻译组件已就绪'); clearInterval(iv); }
        if (n > 40) { dbg('poll timeout (20s) —— widget 未出现,检查 engine onload/onerror 与 CSP'); clearInterval(iv); }
      }, 500);
    } catch (e) {
      dbg('RUN ERROR: ' + e);
    }
  }

  wait();
  return 'kicked off';
})();
