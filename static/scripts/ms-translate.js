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
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, IFRAME: 1, OBJECT: 1, SVG: 1,
    TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 1, TITLE: 1,
  };
  // 代码块标签:用 closest() 查祖先链(不止直接父),覆盖语法高亮嵌套
  // 如 <pre><code><span class="kw">function</span> <span>foo</span></code></pre>。
  var CODE_SELECTOR = 'pre,code,kbd,samp';
  // 上限:超大页只翻前 ~2000 个节点 / ~200k 字符,避免请求量与回读体积爆炸。
  var MAX_NODES = 2000;
  var MAX_SCAN_NODES = 12000;
  var MAX_CHARS = 200000;
  var MAX_TOTAL_NODES = 10000;
  var MAX_PENDING_NODES = 4000;

  var STYLE_ID = 'rainsee-translate-style';
  var MARK_CLASS = 'rainsee-translating';
  var CONTENT_SELECTOR = 'article,main,[role="main"],[role="article"],[role="document"]';
  var UI_SELECTOR = 'nav,header,footer,aside,button,[role="navigation"],[role="toolbar"],[role="menu"],[role="menubar"],[role="tablist"],[role="button"]';

  var reg = new Map(); // id -> {node, original, translated, parent}
  var registeredNodes = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
  // element -> 该元素上"尚未回填"的文本节点计数;归零时摘掉转圈 class。
  // 用计数而非布尔:一个元素可能含多个文本节点,逐个回填。
  var pending = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var seq = 0;
  // 动态内容:MutationObserver 累积新增文本节点和由属性变化变为可见的文本节点,
  // 主进程定期 collectNew() 取走翻译。
  var pendingNew = [];
  var pendingSeen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
  var selfClassMutations = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var observer = null;
  var diag = {
    observerCallbacks: 0,
    mutationRecords: 0,
    childListRecords: 0,
    attributeRecords: 0,
    addedNodes: 0,
    enqueueAttempts: 0,
    enqueued: 0,
    deduped: 0,
    dropped: 0,
    pendingPeak: 0,
    collectNewCalls: 0,
    collectedNew: 0,
    staleRemoved: 0,
    applied: 0,
    cleared: 0,
    initialCandidates: 0,
    initialSelected: 0,
    highPrioritySelected: 0,
    lowPrioritySelected: 0,
  };

  function resetPending() {
    pendingNew = [];
    pendingSeen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
  }

  function enqueuePending(out, node) {
    if (!node) return;
    diag.enqueueAttempts++;
    if (out.length >= MAX_PENDING_NODES) {
      diag.dropped++;
      return;
    }
    if (pendingSeen) {
      try {
        if (pendingSeen.has(node)) {
          diag.deduped++;
          return;
        }
        pendingSeen.add(node);
      } catch (e) {}
    }
    out.push(node);
    diag.enqueued++;
    if (out.length > diag.pendingPeak) diag.pendingPeak = out.length;
  }

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

  function noteSelfClassMutation(el) {
    if (!observer || !selfClassMutations || !el) return;
    try {
      selfClassMutations.set(el, (selfClassMutations.get(el) || 0) + 1);
    } catch (e) {}
  }

  function consumeSelfClassMutation(el) {
    if (!selfClassMutations || !el) return false;
    try {
      var count = selfClassMutations.get(el) || 0;
      if (!count) return false;
      if (count <= 1) selfClassMutations.delete(el);
      else selfClassMutations.set(el, count - 1);
      return true;
    } catch (e) {}
    return false;
  }

  function markEl(el) {
    if (!el || !pending) return;
    try {
      var n = pending.get(el) || 0;
      pending.set(el, n + 1);
      if (n === 0 && !el.classList.contains(MARK_CLASS)) {
        noteSelfClassMutation(el);
        el.classList.add(MARK_CLASS);
      }
    } catch (e) {}
  }

  function unmarkEl(el) {
    if (!el || !pending) return;
    try {
      var n = pending.get(el) || 0;
      if (n <= 1) {
        pending.delete(el);
        if (el.classList.contains(MARK_CLASS)) {
          noteSelfClassMutation(el);
          el.classList.remove(MARK_CLASS);
        }
      } else {
        pending.set(el, n - 1);
      }
    } catch (e) {}
  }

  function clearMarks() {
    try {
      var nodes = document.querySelectorAll('.' + MARK_CLASS);
      for (var i = 0; i < nodes.length; i++) {
        noteSelfClassMutation(nodes[i]);
        nodes[i].classList.remove(MARK_CLASS);
      }
    } catch (e) {}
    pending = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  }

  // 文本节点是否可译的判定(collect 与动态收集共用):跳过脚本/样式/输入/代码块
  // (含祖先链)/隐藏元素/纯数字符号。返回 true=可译。
  function acceptTextNode(node) {
    var p = node.parentElement;
    if (!p) return false;
    if (SKIP_TAGS[p.tagName]) return false;
    try { if (p.closest(CODE_SELECTOR)) return false; } catch (e) {}
    var t = node.nodeValue;
    if (!t || !t.trim()) return false;
    if (!/[\p{L}]/u.test(t.trim())) return false;
    try {
      var cs = window.getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    } catch (e) {}
    return true;
  }

  // Gmail 正文通常位于 .a3s/article 容器内。分数只影响处理顺序，不会丢弃低优先级文本。
  function textPriority(node) {
    var p = node && node.parentElement;
    if (!p) return -10000;
    var text = (node.nodeValue || '').trim();
    var score = Math.min(text.length, 240);
    try {
      if (p.closest('.a3s')) score += 2000;
      else if (p.closest('article,[role="article"],[role="document"]')) score += 900;
      else if (p.closest(CONTENT_SELECTOR)) score += 450;
      if (p.closest(UI_SELECTOR)) score -= 800;
      var rect = p.getBoundingClientRect();
      if (rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth) score += 240;
    } catch (e) {}
    if (text.length >= 80) score += 220;
    else if (text.length >= 30) score += 100;
    else if (text.length < 8) score -= 80;
    return score;
  }

  // 把 root(及其后代,若为元素)中所有可译文本节点收集进 out。
  // 用于 MutationObserver 的新增节点累积:只取新子树,不重扫整页。
  function gatherTextNodesUnder(root, out) {
    if (!root) return;
    if (root.nodeType === 3) { // TEXT_NODE
      if (acceptTextNode(root)) enqueuePending(out, root);
      return;
    }
    if (root.nodeType !== 1) return; // 只关心元素/文本
    try {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          return acceptTextNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      }, false);
      while (walker.nextNode()) enqueuePending(out, walker.currentNode);
    } catch (e) {}
  }

  // 监听 body 子树新增节点和可见性变化(用户点按钮展开/弹窗等动态 UI),累积到
  // pendingNew,主进程定期 collectNew() 取走翻译。部分页面(例如 php.net)会预先
  // 渲染移动端抽屉菜单,初始为隐藏状态,打开时只切换 class 而不新增节点;因此也要
  // 观察影响可见性的属性。apply 只改 nodeValue,不触发本观察器。
  function startObserver() {
    stopObserver();
    if (typeof MutationObserver === 'undefined') return;
    try {
      observer = new MutationObserver(function (mutations) {
        diag.observerCallbacks++;
        diag.mutationRecords += mutations.length;
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.type === 'childList') {
            diag.childListRecords++;
            var added = m.addedNodes;
            diag.addedNodes += added.length;
            for (var j = 0; j < added.length; j++) {
              gatherTextNodesUnder(added[j], pendingNew);
            }
          } else if (m.type === 'attributes') {
            diag.attributeRecords++;
            if (m.attributeName === 'class' && consumeSelfClassMutation(m.target)) continue;
            // 属性变更后再判断 computed style,只收集当前真正可见的节点。
            gatherTextNodesUnder(m.target, pendingNew);
          }
        }
      });
      observer.observe(document.body || document.documentElement, {
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open'],
        subtree: true,
      });
    } catch (e) {}
  }

  function stopObserver() {
    try { if (observer) observer.disconnect(); } catch (e) {}
    observer = null;
    selfClassMutations = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
    resetPending();
  }

  // 收集可翻译文本节点并给每个所在元素打转圈。每次调用重建 reg:源文本取"当前"
  // nodeValue,因此主进程重译前必须先 revert() 让文本回到原文,否则会把译文当原文。
  function collect() {
    ensureStyle();
    reg = new Map();
    registeredNodes = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    pending = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
    seq = 0;
    resetPending();
    var items = [];
    var totalChars = 0;
    var walker;
    try {
      walker = document.createTreeWalker(
        document.body || document.documentElement,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function (node) {
            return acceptTextNode(node)
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT;
          },
        },
        false,
      );
    } catch (e) {
      return JSON.stringify(items);
    }
    var candidates = [];
    var order = 0;
    while (walker.nextNode() && candidates.length < MAX_SCAN_NODES) {
      var candidateNode = walker.currentNode;
      candidates.push({node: candidateNode, score: textPriority(candidateNode), order: order++});
    }
    diag.initialCandidates = candidates.length;
    candidates.sort(function (a, b) { return b.score - a.score || a.order - b.order; });
    for (var c = 0; c < candidates.length; c++) {
      if (seq >= MAX_NODES || totalChars >= MAX_CHARS) break;
      var node = candidates[c].node;
      var parent = node.parentElement;
      var text = node.nodeValue;
      var id = seq++;
      reg.set(id, {node: node, original: text, translated: '', parent: parent});
      if (registeredNodes) registeredNodes.add(node);
      markEl(parent); // 翻译进行中:挂转圈
      items.push({id: id, text: text});
      totalChars += text.length;
      diag.initialSelected++;
      if (candidates[c].score >= 500) diag.highPrioritySelected++;
      else if (candidates[c].score < 0) diag.lowPrioritySelected++;
    }
    // 初始收集完即开启动态监听:后续新增节点由 collectNew 增量翻译。
    startObserver();
    return JSON.stringify(items);
  }

  // 增量收集:主进程定期调用。把 pendingNew 里的新文本节点分配 id、入 reg、挂转圈,
  // 返回 [{id,text}] 供主进程翻译+apply。空数组返回 []。
  function collectNew() {
    diag.collectNewCalls++;
    // 页面 SPA 会不断替换节点;不让 reg 永久持有已经脱离 DOM 的文本节点。
    try {
      var stale = [];
      reg.forEach(function (entry, key) {
        if (!entry || !entry.node || !entry.node.parentNode) stale.push(key);
      });
      for (var s = 0; s < stale.length; s++) {
        var staleEntry = reg.get(stale[s]);
        if (registeredNodes && staleEntry && staleEntry.node) registeredNodes.delete(staleEntry.node);
        reg.delete(stale[s]);
      }
      diag.staleRemoved += stale.length;
    } catch (e) {}
    if (!pendingNew || !pendingNew.length) return '[]';
    var out = [];
    var totalChars = 0;
    var sortedPending = pendingNew.map(function (node, index) {
      return {node: node, score: textPriority(node), order: index};
    });
    sortedPending.sort(function (a, b) { return b.score - a.score || a.order - b.order; });
    for (var i = 0; i < sortedPending.length; i++) {
      if (totalChars >= MAX_CHARS) break;
      if (seq >= MAX_TOTAL_NODES) break;
      var node = sortedPending[i].node;
      // 节点可能已被页面移除或父级不再可译,二次校验。
      if (!node || !node.parentElement || !acceptTextNode(node)) continue;
      if (regHasNode(node)) continue; // 已入册(防重复)
      var text = node.nodeValue;
      var id = seq++;
      var parent = node.parentElement;
      reg.set(id, {node: node, original: text, translated: '', parent: parent});
      if (registeredNodes) registeredNodes.add(node);
      markEl(parent);
      out.push({id: id, text: text});
      totalChars += text.length;
    }
    diag.collectedNew += out.length;
    resetPending();
    return JSON.stringify(out);
  }

  // reg 是否已含某节点(去重用)。线性扫一次足够:增量批次通常很小。
  function regHasNode(target) {
    if (registeredNodes) {
      try { return registeredNodes.has(target); } catch (e) {}
    }
    try {
      var vals = reg.values();
      var v;
      while (!(v = vals.next()).done) {
        if (v.value && v.value.node === target) return true;
      }
    } catch (e) {}
    return false;
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
          diag.applied++;
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
        if (entry) {
          diag.cleared++;
          unmarkEl(entry.parent);
        }
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
    registeredNodes = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    seq = 0;
    clearMarks();
    stopObserver(); // 还原即停止动态监听
  }

  function stats() {
    return {
      regSize: reg.size,
      pendingNew: pendingNew.length,
      seq: seq,
      observerActive: !!observer,
      observerCallbacks: diag.observerCallbacks,
      mutationRecords: diag.mutationRecords,
      childListRecords: diag.childListRecords,
      attributeRecords: diag.attributeRecords,
      addedNodes: diag.addedNodes,
      enqueueAttempts: diag.enqueueAttempts,
      enqueued: diag.enqueued,
      deduped: diag.deduped,
      dropped: diag.dropped,
      pendingPeak: diag.pendingPeak,
      collectNewCalls: diag.collectNewCalls,
      collectedNew: diag.collectedNew,
      staleRemoved: diag.staleRemoved,
      applied: diag.applied,
      cleared: diag.cleared,
      initialCandidates: diag.initialCandidates,
      initialSelected: diag.initialSelected,
      highPrioritySelected: diag.highPrioritySelected,
      lowPrioritySelected: diag.lowPrioritySelected,
    };
  }

  window.__rainseeTranslate = {
    version: 6,
    collect: collect,
    collectNew: collectNew,
    apply: apply,
    clear: clear,
    revert: revert,
    stats: stats,
  };
})();
