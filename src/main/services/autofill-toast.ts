// 钥匙图标点击后,在「当前网页」注入的轻量 toast("已尝试自动填充...")。
//
// 为什么注入到网页而不是 renderer DOM:
// 本应用把网页放在独立的 BrowserView 里,叠在 renderer UI 之上。renderer 的 DOM
// 物理上无法盖住页面 BrowserView,所以 toast 不能用普通 DOM 浮层。
// 把 toast 注入到当前页里,它天然位于页面层之上,且:
//   - 用 attachShadow({mode:'closed'}) 隔离宿主页样式,避免被网页 CSS 污染;
//   - pointer-events:none,点击穿透,不挡用户操作网页;
//   - position:fixed + z-index 顶到视口底部居中;
// webContents.executeJavaScript 由 embedder 注入,绕过页面 CSP,故无脚本策略风险。
const DEFAULT_MESSAGE = '已尝试自动填充（如果没有反应，请确定是否是登录页）';
const DURATION = 2600;

/**
 * 生成可注入当前网页的 toast 代码。
 * @param message toast 文案,默认为"已尝试自动填充..."
 */
export const getAutofillToastCode = (message: string = DEFAULT_MESSAGE): string => {
  const MSG = JSON.stringify(message);
  const DUR = String(DURATION);

  return `
    (function () {
      try {
        var ID = '__rs_autofill_toast__';
        // 重复点击:先清掉旧 toast 的定时器并移除,再建新的
        var old = document.getElementById(ID);
        if (old) { if (old.__rsT) clearTimeout(old.__rsT); old.remove(); }

        var host = document.createElement('div');
        host.id = ID;
        host.style.cssText = 'all:initial;position:fixed;left:0;bottom:28px;width:100%;display:flex;justify-content:center;pointer-events:none;z-index:2147483647;';

        var root = host.attachShadow({ mode: 'closed' });
        root.innerHTML =
          '<style>@keyframes __rs_toast_in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}.t{pointer-events:none;max-width:80vw;padding:10px 16px;border-radius:10px;font:13px/1.5 -apple-system,"Microsoft YaHei",Arial,sans-serif;color:#fff;background:rgba(28,30,34,0.92);box-shadow:0 8px 24px rgba(0,0,0,0.28);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);text-align:center;word-break:break-word;animation:__rs_toast_in 0.18s ease}</style>' +
          '<div class="t"></div>';
        var el = root.querySelector('.t');
        el.textContent = ${MSG};

        (document.body || document.documentElement).appendChild(host);
        host.__rsT = setTimeout(function () { try { host.remove(); } catch (e) {} }, ${DUR});
      } catch (e) {}
    })();
  `;
};
