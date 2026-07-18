/* 网页翻译页面侧引导 —— 由主进程经 webContents.executeJavaScript 注入并驱动。
 * 设计要点:
 *  - 不加载任何远程脚本、不写内联 <script>,仅改写文本节点 nodeValue。故完全不受
 *    页面 CSP 约束(原云端 Google 组件因远程 <script> 被 CSP 拦截 / 请求挂起而废弃)。
 *  - 页面无 ipcRenderer,不向网页暴露 IPC:collect/apply/revert/clear 全由主进程调用并读返回值。
 *  - 翻译过程中:给每个待译文本节点所在元素的 ::after 加一个小转圈(.rainsee-translating),
 *    译完(apply)或失败(clear)即摘掉;全部还原(revert)时清空。不弹任何全局"已翻译"文案。
 *  - 重复注入会整体覆盖 window.__rainseeTranslate(清空 reg),所以切语言/重译前
 *    主进程必须先调 revert() 把文本还原成原文,再重新注入并 collect。
 * 主进程流程:注入本引导 → collect() 取 [{id,text}] 并给各元素打转圈
 *            → 主进程 fetch 微软翻译(分批) → apply({id:译文}) 逐批回填+摘圈
 *            → revert() 还原 + 清圈。
 */
(function () {
  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, IFRAME: 1, OBJECT: 1, SVG: 1, CODE: 1,
    TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 1, KBD: 1, PRE: 1, TITLE: 1,
  };
  // 上限:超大页只翻前 ~2000 个节点 / ~200k 字符,避免请求量与回读体积爆炸。
  var MAX_NODES = 2000;
  var MAX_CHARS = 200000;

  var STYLE_ID = 'rainsee-translate-style';
  var MARK_CLASS = 'rainsee-translating';

  var reg = new Map(); // id -> {node, original, translated, parent}
  // element -> 该元素上"尚未回填"的文本节点计数;归零时摘掉转圈 class。
  // 用计数而非布尔:一个元素可能含多个文本节点,逐个回填。
  var pending = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var seq = 0;

  function ensureStyle() {
    try {
      if (document.getElementById(STYLE_ID)) return;
      var s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent =
        '@keyframes rainsee-spin{to{transform:rotate(360deg)}}' +
        '.' + MARK_CLASS + '::after{content:"";display:inline-block;width:.7em;height:.7em;' +
        'margin-left:.3em;vertical-align:middle;border:1.5px solid currentColor;' +
        'border-top-color:transparent;border-radius:50%;animation:rainsee-spin .7s linear infinite;' +
        'opacity:.5;pointer-events:none}';
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  }

  function markEl(el) {
    if (!el || !pending) return;
    try {
      var n = pending.get(el) || 0;
      pending.set(el, n + 1);
      if (n === 0) el.classList.add(MARK_CLASS);
    } catch (e) {}
  }

  function unmarkEl(el) {
    if (!el || !pending) return;
    try {
      var n = pending.get(el) || 0;
      if (n <= 1) {
        pending.delete(el);
        el.classList.remove(MARK_CLASS);
      } else {
        pending.set(el, n - 1);
      }
    } catch (e) {}
  }

  function clearMarks() {
    try {
      var nodes = document.querySelectorAll('.' + MARK_CLASS);
      for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove(MARK_CLASS);
    } catch (e) {}
    pending = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  }

  // 收集可翻译文本节点并给每个所在元素打转圈。每次调用重建 reg:源文本取"当前"
  // nodeValue,因此主进程重译前必须先 revert() 让文本回到原文,否则会把译文当原文。
  function collect() {
    ensureStyle();
    reg = new Map();
    pending = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
    seq = 0;
    var items = [];
    var totalChars = 0;
    var walker;
    try {
      walker = document.createTreeWalker(
        document.body || document.documentElement,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function (node) {
            var p = node.parentElement;
            if (!p) return NodeFilter.FILTER_REJECT;
            if (SKIP_TAGS[p.tagName]) return NodeFilter.FILTER_REJECT;
            var t = node.nodeValue;
            if (!t || !t.trim()) return NodeFilter.FILTER_REJECT;
            try {
              var cs = window.getComputedStyle(p);
              if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') {
                return NodeFilter.FILTER_REJECT;
              }
            } catch (e) {}
            return NodeFilter.FILTER_ACCEPT;
          },
        },
        false,
      );
    } catch (e) {
      return JSON.stringify(items);
    }
    while (walker.nextNode()) {
      if (seq >= MAX_NODES || totalChars >= MAX_CHARS) break;
      var node = walker.currentNode;
      var parent = node.parentElement;
      var text = node.nodeValue;
      var id = seq++;
      reg.set(id, {node: node, original: text, translated: '', parent: parent});
      markEl(parent); // 翻译进行中:挂转圈
      items.push({id: id, text: text});
      totalChars += text.length;
    }
    return JSON.stringify(items);
  }

  // 按 {id:译文} 回填并摘掉对应元素的转圈。被页面移除的节点跳过(但仍摘圈)。
  function apply(map) {
    if (!map || typeof map !== 'object') return;
    try {
      for (var id in map) {
        if (!Object.prototype.hasOwnProperty.call(map, id)) continue;
        var entry = reg.get(Number(id));
        if (!entry || !entry.node) continue;
        if (entry.node.parentNode) {
          entry.translated = String(map[id]);
          entry.node.nodeValue = entry.translated;
        }
        unmarkEl(entry.parent);
      }
    } catch (e) {}
  }

  // 批次失败时调用:不改动文本(保持原文),只摘掉这批元素的转圈。
  function clear(ids) {
    try {
      for (var i = 0; ids && i < ids.length; i++) {
        var entry = reg.get(Number(ids[i]));
        if (entry) unmarkEl(entry.parent);
      }
    } catch (e) {}
  }

  // 还原全部文本节点为原文,清空 reg 与所有转圈(不显示任何完成文案)。
  function revert() {
    try {
      reg.forEach(function (entry) {
        try {
          if (entry && entry.node) entry.node.nodeValue = entry.original;
        } catch (e) {}
      });
    } catch (e) {}
    reg = new Map();
    seq = 0;
    clearMarks();
  }

  window.__rainseeTranslate = {
    version: 3,
    collect: collect,
    apply: apply,
    clear: clear,
    revert: revert,
  };
})();
