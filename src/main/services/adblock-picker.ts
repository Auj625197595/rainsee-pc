// 此文件由 scripts/gen-adblock-picker.js 从 dom_picker.js 自动生成，请勿手改主体逻辑。
// 来源: browserv4/moduleMain/src/main/assets/adblock/dom_picker.js
// 改动: 1) i18n 占位符替换为中文常量; 2) 顶部注入 JSInterface -> Electron ipcRenderer 桥。
//
// 注入到标签页 webContents(contextIsolation:false, preload 暴露 window.electron.ipcRenderer)。
// picker 主体通过 window.JSInterface 回传, 由下方 shim 转成 ipc 消息发给所属窗口。
/* eslint-disable */

const PICKER_BODY = `(function() {
  if (window.__YJAdblockPicker) {
    return;
  }

  var PICKER_CLASS = "yujiantarget";
  var PICKER_ROOT_ID = "__yj_adblock_picker_root";
  var PICKER_BOX_ID = "__yj_adblock_picker_box";
  var PICKER_PANEL_ID = "__yj_adblock_picker_panel";
  var PICKER_TITLE_ID = "__yj_adblock_picker_title";
  var PICKER_DESC_ID = "__yj_adblock_picker_desc";
  var PICKER_RULE_ID = "__yj_adblock_picker_rule";
  var PICKER_RULE_MAX_LINES = 4;
  var RULE_MAX_LENGTH = 64 * 1024;
  var URL_SELECTOR_PATH_MAX_LENGTH = 160;
  var I18N = {
    dragHandle: "拖动面板",
    parent: "上一层",
    child: "下一层",
    back: "返回",
    previewHide: "预览隐藏",
    previewCancel: "取消预览",
    saveRule: "隐藏元素",
    blockResource: "拦截资源",
    cancel: "取消",
    matches: "匹配 %1$s 个",
    size: "尺寸 %1$s×%2$s",
    childHistory: "已展开 %1$s 层",
    unableBuildRule: "无法生成规则",
    element: "元素"
  };

  function formatI18n(template) {
    var values = [];
    for (var i = 1; i < arguments.length; i++) {
      values.push(arguments[i]);
    }
    return String(template || "").replace(/%(\\d+)\\$s/g, function(match, index) {
      var value = values[parseInt(index, 10) - 1];
      return value == null ? "" : String(value);
    });
  }

  function toArray(nodeList) {
    var result = [];
    if (!nodeList) {
      return result;
    }
    for (var i = 0; i < nodeList.length; i++) {
      result.push(nodeList[i]);
    }
    return result;
  }

  function safeLower(value) {
    return value ? String(value).toLowerCase() : "";
  }

  function safeTrim(value) {
    return value ? String(value).trim() : "";
  }

  function containsDataBase64(value) {
    value = safeLower(value);
    return value.indexOf("data:") !== -1 && value.indexOf(";base64,") !== -1;
  }

  function isRuleTextSafe(value) {
    value = String(value || "");
    return value.length <= RULE_MAX_LENGTH && !containsDataBase64(value);
  }

  function escapeAttr(value) {
    return String(value)
      .replace(/\\\\/g, "\\\\\\\\")
      .replace(/"/g, '\\\\"');
  }

  function fallbackCssEscape(value) {
    return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\\\\]^\`{|}~])/g, "\\\\$1");
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return fallbackCssEscape(value);
  }

  function isStableToken(token) {
    token = safeTrim(token);
    if (!token || token.length < 2 || token.length > 48) {
      return false;
    }
    if (/^[0-9]+$/.test(token)) {
      return false;
    }
    if (/[A-Fa-f0-9]{16,}/.test(token)) {
      return false;
    }
    if (/^[A-Za-z0-9_-]{24,}$/.test(token) && /\\d/.test(token)) {
      return false;
    }
    if (/(ember|react|vue|swiper|slick|splide|glide|random|nonce|token|uuid)/i.test(token)) {
      return false;
    }
    var digitCount = (token.match(/\\d/g) || []).length;
    if (digitCount > 0 && digitCount / token.length > 0.35) {
      return false;
    }
    return /^[A-Za-z0-9_-]+$/.test(token);
  }

  function stableClassList(element) {
    var className = element && element.className && typeof element.className === "string"
      ? element.className
      : "";
    var parts = className.split(/\\s+/);
    var result = [];
    var seen = {};
    for (var i = 0; i < parts.length; i++) {
      var item = safeTrim(parts[i]);
      if (!isStableToken(item) || seen[item]) {
        continue;
      }
      seen[item] = true;
      result.push(item);
      if (result.length >= 3) {
        break;
      }
    }
    return result;
  }

  function stableId(element) {
    if (!element || !element.id) {
      return "";
    }
    return isStableToken(element.id) ? element.id : "";
  }

  function getScopeRoot(element) {
    if (!element) {
      return document;
    }
    var root = element.getRootNode ? element.getRootNode() : element.ownerDocument;
    if (root && root.nodeType === 11) {
      return root;
    }
    return element.ownerDocument || document;
  }

  function safeQueryCount(root, selector) {
    try {
      if (!root || !root.querySelectorAll) {
        return 0;
      }
      return root.querySelectorAll(selector).length;
    } catch (error) {
      return 0;
    }
  }

  function extractPathValue(rawUrl) {
    if (!rawUrl) {
      return "";
    }
    if (containsDataBase64(rawUrl)) {
      return "";
    }
    try {
      var url = new URL(rawUrl, window.location.href);
      if (!/^https?:$/i.test(url.protocol)) {
        return "";
      }
      var path = url.pathname && url.pathname !== "/" ? url.pathname : "";
      if (!path || path.length > URL_SELECTOR_PATH_MAX_LENGTH || containsDataBase64(path)) {
        return "";
      }
      return path;
    } catch (error) {
      return "";
    }
  }

  function selectorEntry(selector, weight, scopeRoot) {
    var count = safeQueryCount(scopeRoot, selector);
    if (!count) {
      return null;
    }
    return {
      selector: selector,
      count: count,
      weight: weight
    };
  }

  function buildNthPath(element) {
    var segments = [];
    var current = element;
    var depth = 0;
    while (current && current.nodeType === 1 && depth < 4) {
      var tag = safeLower(current.tagName);
      if (!tag || tag === "html" || tag === "body") {
        break;
      }
      var index = 1;
      var sibling = current;
      while (sibling.previousElementSibling) {
        sibling = sibling.previousElementSibling;
        if (safeLower(sibling.tagName) === tag) {
          index++;
        }
      }
      segments.unshift(tag + ":nth-of-type(" + index + ")");
      current = current.parentElement;
      depth++;
    }
    return segments.join(" > ");
  }

  function getNodeIndex(element) {
    if (!element || !element.parentElement) {
      return 0;
    }
    var tag = safeLower(element.tagName);
    var index = 0;
    var siblings = element.parentElement.children;
    for (var i = 0; i < siblings.length; i++) {
      if (safeLower(siblings[i].tagName) === tag) {
        index++;
        if (siblings[i] === element) {
          return index;
        }
      }
    }
    return index;
  }

  function addCandidate(map, list, selector, weight, scopeRoot) {
    if (!selector || map[selector] || !isRuleTextSafe(selector)) {
      return;
    }
    map[selector] = true;
    var entry = selectorEntry(selector, weight, scopeRoot);
    if (entry) {
      list.push(entry);
    }
  }

  function buildSelectorCandidates(element) {
    var scopeRoot = getScopeRoot(element);
    var tag = safeLower(element.tagName);
    var id = stableId(element);
    var classes = stableClassList(element);
    var result = [];
    var seen = {};
    var attrs = ["data-testid", "data-test", "data-qa", "aria-label", "name", "role", "alt", "title", "type"];

    if (id) {
      addCandidate(seen, result, "#" + cssEscape(id), 0, scopeRoot);
      addCandidate(seen, result, tag + "#" + cssEscape(id), 1, scopeRoot);
    }

    if (classes.length) {
      addCandidate(seen, result, tag + "." + classes.map(cssEscape).join("."), 2, scopeRoot);
      addCandidate(seen, result, "." + classes.map(cssEscape).join("."), 3, scopeRoot);
    }

    for (var i = 0; i < attrs.length; i++) {
      var attrName = attrs[i];
      var attrValue = safeTrim(element.getAttribute ? element.getAttribute(attrName) : "");
      if (!attrValue || attrValue.length > 80 || /\\d{6,}/.test(attrValue)) {
        continue;
      }
      addCandidate(seen, result, tag + "[" + attrName + "=\\"" + escapeAttr(attrValue) + "\\"]", 4 + i, scopeRoot);
    }

    var hrefPath = extractPathValue(element.href);
    if (hrefPath) {
      addCandidate(seen, result, tag + "[href*=\\"" + escapeAttr(hrefPath) + "\\"]", 20, scopeRoot);
    }

    var srcPath = extractPathValue(element.src || element.getAttribute("src") || element.getAttribute("data-src") || element.getAttribute("poster"));
    if (srcPath) {
      addCandidate(seen, result, tag + "[src*=\\"" + escapeAttr(srcPath) + "\\"]", 21, scopeRoot);
      addCandidate(seen, result, tag + "[data-src*=\\"" + escapeAttr(srcPath) + "\\"]", 22, scopeRoot);
    }

    var parent = element.parentElement;
    if (parent) {
      var parentId = stableId(parent);
      var parentClasses = stableClassList(parent);
      if (parentId) {
        addCandidate(seen, result, "#" + cssEscape(parentId) + " > " + tag, 30, scopeRoot);
        if (classes.length) {
          addCandidate(
            seen,
            result,
            "#" + cssEscape(parentId) + " > " + tag + "." + classes.map(cssEscape).join("."),
            31,
            scopeRoot
          );
        }
      } else if (parentClasses.length) {
        addCandidate(
          seen,
          result,
          parent.tagName.toLowerCase() + "." + parentClasses.map(cssEscape).join(".") + " > " + tag,
          32,
          scopeRoot
        );
      }
    }

    var nthPath = buildNthPath(element);
    if (nthPath) {
      addCandidate(seen, result, nthPath, 40, scopeRoot);
    }

    result.sort(function(left, right) {
      if (left.count !== right.count) {
        return left.count - right.count;
      }
      if (left.weight !== right.weight) {
        return left.weight - right.weight;
      }
      return left.selector.length - right.selector.length;
    });
    return result;
  }

  function buildDomRule(element, currentHost) {
    var candidates = buildSelectorCandidates(element);
    if (!candidates.length) {
      return null;
    }
    return {
      selector: candidates[0].selector,
      count: candidates[0].count,
      ruleText: safeTrim(currentHost) + "##" + candidates[0].selector
    };
  }

  function inferResourceRule(element) {
    if (!element) {
      return null;
    }
    var tag = safeLower(element.tagName);
    var rawUrl = element.src || element.getAttribute("src") || element.getAttribute("data-src") || element.href || element.getAttribute("href") || element.getAttribute("poster");
    if (containsDataBase64(rawUrl)) {
      rawUrl = "";
    }
    if (!rawUrl) {
      var nested = element.querySelector ? element.querySelector("[src],[href],[data-src],[poster]") : null;
      if (nested) {
        rawUrl = nested.src || nested.getAttribute("src") || nested.getAttribute("data-src") || nested.href || nested.getAttribute("href") || nested.getAttribute("poster");
        tag = safeLower(nested.tagName);
        if (containsDataBase64(rawUrl)) {
          rawUrl = "";
        }
      }
    }
    if (!rawUrl) {
      return null;
    }
    try {
      var url = new URL(rawUrl, window.location.href);
      if (!/^https?:$/i.test(url.protocol)) {
        return null;
      }
      var rule = "||" + url.host + (url.pathname || "") + "^";
      if (tag === "img") {
        rule += "$image";
      } else if (tag === "iframe") {
        rule += "$subdocument";
      } else if (tag === "script") {
        rule += "$script";
      } else if (tag === "video" || tag === "audio" || tag === "source") {
        rule += "$media";
      } else if (tag === "link") {
        rule += "$stylesheet";
      }
      return rule;
    } catch (error) {
      return null;
    }
  }

  function getGlobalRect(element) {
    if (!element || !element.getBoundingClientRect) {
      return null;
    }
    var rect = element.getBoundingClientRect();
    var box = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.right,
      bottom: rect.bottom
    };
    var currentWindow = element.ownerDocument ? element.ownerDocument.defaultView : window;
    while (currentWindow && currentWindow !== window) {
      var frameElement = currentWindow.frameElement;
      if (!frameElement) {
        break;
      }
      var frameRect = frameElement.getBoundingClientRect();
      box.left += frameRect.left;
      box.top += frameRect.top;
      box.right += frameRect.left;
      box.bottom += frameRect.top;
      currentWindow = frameElement.ownerDocument ? frameElement.ownerDocument.defaultView : window;
    }
    return box;
  }

  function collectAccessibleRoots(root, result) {
    if (!root) {
      return;
    }
    for (var i = 0; i < result.length; i++) {
      if (result[i] === root) {
        return;
      }
    }
    result.push(root);
    if (!root.querySelectorAll) {
      return;
    }
    var nodes = toArray(root.querySelectorAll("*"));
    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      if (!node) {
        continue;
      }
      if (node.shadowRoot) {
        collectAccessibleRoots(node.shadowRoot, result);
      }
      if (node.tagName && safeLower(node.tagName) === "iframe") {
        try {
          if (node.contentDocument && node.contentDocument.documentElement) {
            collectAccessibleRoots(node.contentDocument, result);
          }
        } catch (error) {
        }
      }
    }
  }

  function getAccessibleRoots() {
    var roots = [];
    collectAccessibleRoots(document, roots);
    return roots;
  }

  function resolveParentElement(element) {
    if (!element) {
      return null;
    }
    if (element.parentElement) {
      return element.parentElement;
    }
    var root = element.getRootNode ? element.getRootNode() : null;
    if (root && root.host) {
      return root.host;
    }
    var ownerWindow = element.ownerDocument ? element.ownerDocument.defaultView : null;
    if (ownerWindow && ownerWindow !== window && ownerWindow.frameElement) {
      return ownerWindow.frameElement;
    }
    return null;
  }

  function resolveChildElement(element, historyStack) {
    if (historyStack.length) {
      return historyStack.pop();
    }
    if (element && element.tagName && safeLower(element.tagName) === "iframe") {
      try {
        var frameDoc = element.contentDocument;
        if (frameDoc && frameDoc.body && frameDoc.body.firstElementChild) {
          return frameDoc.body.firstElementChild;
        }
      } catch (error) {
      }
    }
    if (!element) {
      return null;
    }
    if (element.shadowRoot && element.shadowRoot.firstElementChild) {
      return element.shadowRoot.firstElementChild;
    }
    var child = element.firstElementChild;
    return child || null;
  }

  function sameElement(left, right) {
    return !!left && !!right && left === right;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getViewportWidth() {
    return Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  }

  function getViewportHeight() {
    return Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  }

  function getEventPoint(event) {
    if (!event) {
      return null;
    }
    if (event.touches && event.touches.length) {
      return event.touches[0];
    }
    if (event.changedTouches && event.changedTouches.length) {
      return event.changedTouches[0];
    }
    return event;
  }

  function clearPreview(previewState) {
    if (!previewState || !previewState.element) {
      return null;
    }
    if (previewState.originalStyle === null || typeof previewState.originalStyle === "undefined") {
      previewState.element.removeAttribute("style");
    } else {
      previewState.element.setAttribute("style", previewState.originalStyle);
    }
    return null;
  }

  function pickElementFromRoot(root, clientX, clientY) {
    if (!root || !root.elementFromPoint) {
      return null;
    }
    var element = root.elementFromPoint(clientX, clientY);
    if (!element) {
      return null;
    }
    while (element && element.shadowRoot && element.shadowRoot.elementFromPoint) {
      var shadowPicked = element.shadowRoot.elementFromPoint(clientX, clientY);
      if (!shadowPicked || shadowPicked === element) {
        break;
      }
      element = shadowPicked;
    }
    if (safeLower(element.tagName) === "iframe") {
      try {
        var frameRect = element.getBoundingClientRect();
        if (element.contentDocument && element.contentDocument.documentElement) {
          var nested = pickElementFromRoot(
            element.contentDocument,
            clientX - frameRect.left,
            clientY - frameRect.top
          );
          if (nested) {
            return nested;
          }
        }
      } catch (error) {
      }
    }
    return element;
  }

  function pickElementFromWindow(targetWindow, clientX, clientY) {
    if (!targetWindow || !targetWindow.document) {
      return null;
    }
    return pickElementFromRoot(targetWindow.document, clientX, clientY);
  }

  function createButton(label, action) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = PICKER_CLASS;
    button.setAttribute("data-action", action);
    button.textContent = label;
    button.style.flex = "1 1 30%";
    button.style.minWidth = "72px";
    button.style.padding = "10px 8px";
    button.style.borderRadius = "12px";
    button.style.border = "1px solid rgba(255,255,255,0.18)";
    button.style.background = "rgba(255,255,255,0.08)";
    button.style.color = "#ffffff";
    button.style.fontSize = "13px";
    button.style.lineHeight = "1.2";
    return button;
  }

  var picker = {
    root: null,
    box: null,
    panel: null,
    title: null,
    desc: null,
    rule: null,
    selected: null,
    history: [],
    preview: null,
    currentRule: null,
    currentResourceRule: null,
    options: {},
    isActive: false,
    panelUserMoved: false,
    defaultPanelPositioned: false,
    dragState: null,
    updatePanelSize: function() {
      if (!this.panel) {
        return;
      }
      var maxWidth = Math.max(160, getViewportWidth() - 24);
      var width = Math.min(420, maxWidth);
      this.panel.style.width = width + "px";
      this.panel.style.maxWidth = maxWidth + "px";
    },
    setPanelPosition: function(left, top) {
      if (!this.panel) {
        return;
      }
      this.updatePanelSize();
      var panelRect = this.panel.getBoundingClientRect();
      var panelWidth = panelRect.width || Math.min(getViewportWidth() - 24, 420);
      var panelHeight = panelRect.height || 220;
      var viewportWidth = getViewportWidth();
      var viewportHeight = getViewportHeight();
      var nextLeft = clamp(Math.round(left), 12, Math.max(12, viewportWidth - panelWidth - 12));
      var nextTop = clamp(Math.round(top), 12, Math.max(12, viewportHeight - panelHeight - 12));
      this.panel.style.left = nextLeft + "px";
      this.panel.style.top = nextTop + "px";
      this.panel.style.right = "auto";
      this.panel.style.bottom = "auto";
    },
    clampPanelPosition: function() {
      if (!this.panel) {
        return;
      }
      var rect = this.panel.getBoundingClientRect();
      this.setPanelPosition(rect.left, rect.top);
    },
    positionPanelNearRect: function(rect) {
      if (!this.panel || !rect) {
        return;
      }
      var panelRect = this.panel.getBoundingClientRect();
      var panelWidth = panelRect.width || Math.min(getViewportWidth() - 24, 420);
      var panelHeight = panelRect.height || 220;
      var preferredLeft = isFinite(rect.left) ? rect.left : 12;
      var left = clamp(preferredLeft, 12, Math.max(12, getViewportWidth() - panelWidth - 12));
      var top = rect.bottom + 12;
      if (top + panelHeight > getViewportHeight() - 12) {
        var fallbackTop = rect.top - panelHeight - 12;
        if (fallbackTop >= 12) {
          top = fallbackTop;
        } else {
          top = Math.max(12, getViewportHeight() - panelHeight - 12);
        }
      }
      this.setPanelPosition(left, top);
    },
    shouldStartPanelDrag: function(target) {
      if (!target || target === this.root) {
        return false;
      }
      if (target.getAttribute && target.getAttribute("data-action")) {
        return false;
      }
      return !!(this.panel && this.panel.contains(target));
    },
    beginPanelDrag: function(event) {
      if (!this.panel) {
        return;
      }
      var point = getEventPoint(event);
      if (!point) {
        return;
      }
      var rect = this.panel.getBoundingClientRect();
      this.dragState = {
        startX: point.clientX,
        startY: point.clientY,
        left: rect.left,
        top: rect.top,
        moved: false
      };
      if (event.preventDefault) {
        event.preventDefault();
      }
    },
    movePanelDrag: function(event) {
      if (!this.dragState) {
        return;
      }
      var point = getEventPoint(event);
      if (!point) {
        return;
      }
      var deltaX = point.clientX - this.dragState.startX;
      var deltaY = point.clientY - this.dragState.startY;
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        this.dragState.moved = true;
      }
      this.setPanelPosition(this.dragState.left + deltaX, this.dragState.top + deltaY);
      if (event.preventDefault) {
        event.preventDefault();
      }
    },
    endPanelDrag: function() {
      if (!this.dragState) {
        return;
      }
      if (this.dragState.moved) {
        this.panelUserMoved = true;
      }
      this.dragState = null;
    },
    ensureUI: function() {
      if (this.root) {
        return;
      }
      var root = document.createElement("div");
      root.id = PICKER_ROOT_ID;
      root.className = PICKER_CLASS;
      root.style.position = "fixed";
      root.style.inset = "0";
      root.style.zIndex = "2147483646";
      root.style.display = "none";
      root.style.background = "rgba(10,16,25,0.16)";
      root.style.backdropFilter = "blur(1px)";
      root.style.pointerEvents = "auto";

      var box = document.createElement("div");
      box.id = PICKER_BOX_ID;
      box.className = PICKER_CLASS;
      box.style.position = "fixed";
      box.style.border = "2px solid #55d18a";
      box.style.background = "rgba(85,209,138,0.14)";
      box.style.boxShadow = "0 0 0 99999px rgba(10,16,25,0.12)";
      box.style.borderRadius = "10px";
      box.style.pointerEvents = "none";
      box.style.display = "none";

      var panel = document.createElement("div");
      panel.id = PICKER_PANEL_ID;
      panel.className = PICKER_CLASS;
      panel.style.position = "fixed";
      panel.style.left = "12px";
      panel.style.top = "12px";
      panel.style.padding = "14px 40px 14px 14px";
      panel.style.borderRadius = "16px";
      panel.style.background = "rgba(18,25,36,0.95)";
      panel.style.color = "#ffffff";
      panel.style.boxShadow = "0 16px 42px rgba(0,0,0,0.38)";
      panel.style.fontFamily = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      panel.style.pointerEvents = "auto";
      panel.style.touchAction = "none";
      panel.style.cursor = "grab";
      panel.style.maxHeight = "calc(100vh - 24px)";
      panel.style.overflowY = "auto";

      var dragHint = document.createElement("div");
      dragHint.className = PICKER_CLASS;
      dragHint.style.position = "absolute";
      dragHint.style.top = "12px";
      dragHint.style.right = "12px";
      dragHint.style.width = "20px";
      dragHint.style.height = "20px";
      dragHint.style.display = "flex";
      dragHint.style.alignItems = "center";
      dragHint.style.justifyContent = "center";
      dragHint.style.borderRadius = "8px";
      dragHint.style.background = "rgba(255,255,255,0.08)";
      dragHint.style.cursor = "grab";
      dragHint.title = I18N.dragHandle;

      var dragIcon = document.createElement("div");
      dragIcon.className = PICKER_CLASS;
      dragIcon.style.width = "14px";
      dragIcon.style.height = "14px";
      dragIcon.style.borderRadius = "4px";
      dragIcon.style.backgroundImage = "radial-gradient(circle, rgba(255,255,255,0.78) 1.15px, transparent 1.3px)";
      dragIcon.style.backgroundSize = "6px 6px";
      dragIcon.style.backgroundPosition = "1px 1px";
      dragIcon.style.opacity = "0.92";
      dragIcon.style.flex = "0 0 auto";

      var title = document.createElement("div");
      title.id = PICKER_TITLE_ID;
      title.className = PICKER_CLASS;
      title.style.fontSize = "15px";
      title.style.fontWeight = "700";
      title.style.marginBottom = "6px";

      var desc = document.createElement("div");
      desc.id = PICKER_DESC_ID;
      desc.className = PICKER_CLASS;
      desc.style.fontSize = "12px";
      desc.style.lineHeight = "1.45";
      desc.style.color = "rgba(255,255,255,0.78)";
      desc.style.marginBottom = "8px";

      var rule = document.createElement("div");
      rule.id = PICKER_RULE_ID;
      rule.className = PICKER_CLASS;
      rule.style.fontSize = "12px";
      rule.style.lineHeight = "1.45";
      rule.style.color = "#9de0b8";
      rule.style.wordBreak = "break-all";
      rule.style.overflow = "hidden";
      rule.style.display = "-webkit-box";
      rule.style.webkitBoxOrient = "vertical";
      rule.style.webkitLineClamp = String(PICKER_RULE_MAX_LINES);
      rule.style.maxHeight = (12 * 1.45 * PICKER_RULE_MAX_LINES) + "px";
      rule.style.marginBottom = "10px";

      var topRow = document.createElement("div");
      topRow.className = PICKER_CLASS;
      topRow.style.display = "flex";
      topRow.style.gap = "8px";
      topRow.style.marginBottom = "8px";
      topRow.appendChild(createButton(I18N.parent, "parent"));
      topRow.appendChild(createButton(I18N.child, "child"));
      topRow.appendChild(createButton(I18N.previewHide, "preview"));

      var bottomRow = document.createElement("div");
      bottomRow.className = PICKER_CLASS;
      bottomRow.style.display = "flex";
      bottomRow.style.gap = "8px";
      bottomRow.appendChild(createButton(I18N.saveRule, "save"));
      bottomRow.appendChild(createButton(I18N.blockResource, "resource"));
      bottomRow.appendChild(createButton(I18N.cancel, "cancel"));

      dragHint.appendChild(dragIcon);
      panel.appendChild(dragHint);
      panel.appendChild(title);
      panel.appendChild(desc);
      panel.appendChild(rule);
      panel.appendChild(topRow);
      panel.appendChild(bottomRow);

      root.appendChild(box);
      root.appendChild(panel);
      document.documentElement.appendChild(root);

      var self = this;
      root.addEventListener("click", function(event) {
        var target = event.target;
        if (target && target.getAttribute) {
          var action = target.getAttribute("data-action");
          if (action) {
            self.handleAction(action);
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        }
        if (target === root) {
          self.pickAt(event.clientX, event.clientY);
        }
      }, true);

      window.addEventListener("resize", function() {
        self.refresh();
      });
      document.addEventListener("scroll", function() {
        self.refresh();
      }, true);
      panel.addEventListener("mousedown", function(event) {
        if (!self.shouldStartPanelDrag(event.target)) {
          return;
        }
        self.beginPanelDrag(event);
      });
      panel.addEventListener("touchstart", function(event) {
        if (!self.shouldStartPanelDrag(event.target)) {
          return;
        }
        self.beginPanelDrag(event);
      }, { passive: false });
      window.addEventListener("mousemove", function(event) {
        self.movePanelDrag(event);
      });
      window.addEventListener("touchmove", function(event) {
        self.movePanelDrag(event);
      }, { passive: false });
      window.addEventListener("mouseup", function() {
        self.endPanelDrag();
      });
      window.addEventListener("touchend", function() {
        self.endPanelDrag();
      });
      window.addEventListener("touchcancel", function() {
        self.endPanelDrag();
      });

      this.root = root;
      this.box = box;
      this.panel = panel;
      this.title = title;
      this.desc = desc;
      this.rule = rule;
    },
    notifyEnter: function() {
      try {
        if (window.JSInterface && typeof JSInterface.onAdblockPickerEnter === "function") {
          JSInterface.onAdblockPickerEnter();
        }
      } catch (error) {
      }
    },
    notifyCancel: function() {
      try {
        if (window.JSInterface && typeof JSInterface.onAdblockPickerCancel === "function") {
          JSInterface.onAdblockPickerCancel();
        }
      } catch (error) {
      }
    },
    notifySubmit: function(ruleText) {
      try {
        if (window.JSInterface && typeof JSInterface.onAdblockPickerSubmit === "function") {
          JSInterface.onAdblockPickerSubmit(ruleText || "");
        }
      } catch (error) {
      }
    },
    activate: function(options) {
      this.ensureUI();
      this.options = options || {};
      this.history = [];
      this.preview = clearPreview(this.preview);
      this.currentRule = null;
      this.currentResourceRule = null;
      this.dragState = null;
      this.panelUserMoved = false;
      this.defaultPanelPositioned = false;
      this.root.style.display = "block";
      this.box.style.display = "none";
      this.isActive = true;
      this.notifyEnter();

      var initial = window.intouDom && window.intouDom.nodeType === 1 ? window.intouDom : null;
      if (!initial) {
        initial = this.findByHint(this.options.seed);
      }
      if (!initial) {
        initial = document.body;
      }
      this.setSelected(initial, true);
    },
    close: function(submitted) {
      this.preview = clearPreview(this.preview);
      this.selected = null;
      this.currentRule = null;
      this.currentResourceRule = null;
      this.history = [];
      this.dragState = null;
      this.isActive = false;
      if (this.root) {
        this.root.style.display = "none";
      }
      if (submitted) {
        return;
      }
      this.notifyCancel();
    },
    findByHint: function(seed) {
      if (!seed) {
        return null;
      }
      var roots = getAccessibleRoots();
      try {
        var stableSeedId = seed.clean_id || seed.id;
        if (stableSeedId && isStableToken(stableSeedId)) {
          for (var i = 0; i < roots.length; i++) {
            var root = roots[i];
            var byId = root.getElementById
              ? root.getElementById(stableSeedId)
              : root.querySelector("#" + cssEscape(stableSeedId));
            if (byId) {
              return byId;
            }
          }
        }
        for (var j = 0; j < roots.length; j++) {
          var currentRoot = roots[j];
          if (seed.href && isRuleTextSafe(seed.href)) {
            var link = currentRoot.querySelector("[href=\\"" + escapeAttr(seed.href) + "\\"]");
            if (link) {
              return link;
            }
          }
          if (seed.src && isRuleTextSafe(seed.src)) {
            var source = currentRoot.querySelector("[src=\\"" + escapeAttr(seed.src) + "\\"]");
            if (source) {
              return source;
            }
          }
        }
        if (seed.tag_name) {
          var best = null;
          var bestScore = -1;
          for (var k = 0; k < roots.length; k++) {
            var nodes = roots[k].querySelectorAll(seed.tag_name);
            for (var n = 0; n < nodes.length; n++) {
              var item = nodes[n];
              var score = 0;
              if (seed.class_name && item.className === seed.class_name) {
                score += 4;
              }
              if (seed.clean_class_name && safeTrim(item.className) === safeTrim(seed.clean_class_name)) {
                score += 2;
              }
              if (seed.text_fingerprint) {
                var textValue = safeTrim((item.innerText || item.textContent || "")).replace(/\\s+/g, " ");
                if (textValue.indexOf(seed.text_fingerprint) !== -1) {
                  score += 1;
                }
              }
              if (seed.sibling_index && getNodeIndex(item) === seed.sibling_index) {
                score += 1;
              }
              if (score > bestScore) {
                bestScore = score;
                best = item;
              }
            }
          }
          if (best) {
            return best;
          }
        }
      } catch (error) {
      }
      return null;
    },
    setSelected: function(element, resetHistory) {
      if (!element || element.nodeType !== 1) {
        return;
      }
      if (resetHistory) {
        this.history = [];
      }
      if (this.preview && !sameElement(this.preview.element, element)) {
        this.preview = clearPreview(this.preview);
      }
      this.selected = element;
      window.intouDom = element;
      this.refresh();
    },
    refresh: function() {
      if (!this.isActive || !this.selected) {
        return;
      }
      var rect = getGlobalRect(this.selected);
      if (!rect || !isFinite(rect.left) || !isFinite(rect.top)) {
        return;
      }

      this.box.style.display = "block";
      this.box.style.left = Math.max(0, rect.left - 2) + "px";
      this.box.style.top = Math.max(0, rect.top - 2) + "px";
      this.box.style.width = Math.max(0, rect.width) + "px";
      this.box.style.height = Math.max(0, rect.height) + "px";

      var tag = safeLower(this.selected.tagName) || I18N.element;
      var id = stableId(this.selected) ? "#" + stableId(this.selected) : "";
      var classes = stableClassList(this.selected);
      this.title.textContent = tag + id + (classes.length ? "." + classes.join(".") : "");

      var ruleInfo = buildDomRule(this.selected, this.options.currentHost || window.location.host);
      this.currentRule = ruleInfo;
      this.currentResourceRule = inferResourceRule(this.selected);

      var descParts = [];
      descParts.push(formatI18n(I18N.matches, ruleInfo ? ruleInfo.count : 0));
      descParts.push(formatI18n(I18N.size, Math.round(rect.width), Math.round(rect.height)));
      if (this.history.length) {
        descParts.push(formatI18n(I18N.childHistory, this.history.length));
      }
      this.desc.textContent = descParts.join(" | ");
      var ruleText = ruleInfo ? ruleInfo.ruleText : I18N.unableBuildRule;
      this.rule.textContent = ruleText;
      this.rule.title = ruleText;
      if (!this.panelUserMoved) {
        this.positionPanelNearRect(rect);
        this.defaultPanelPositioned = true;
      } else {
        this.clampPanelPosition();
      }

      var childButton = this.root.querySelector("[data-action='child']");
      if (childButton) {
        childButton.textContent = this.history.length ? I18N.back : I18N.child;
      }
      var previewButton = this.root.querySelector("[data-action='preview']");
      if (previewButton) {
        previewButton.textContent = this.preview ? I18N.previewCancel : I18N.previewHide;
      }
    },
    pickAt: function(clientX, clientY) {
      if (!this.root) {
        return;
      }
      this.root.style.pointerEvents = "none";
      var picked = pickElementFromWindow(window, clientX, clientY);
      this.root.style.pointerEvents = "auto";
      if (picked && picked.nodeType === 1) {
        this.setSelected(picked, true);
      }
    },
    togglePreview: function() {
      if (!this.selected) {
        return;
      }
      if (this.preview && sameElement(this.preview.element, this.selected)) {
        this.preview = clearPreview(this.preview);
        this.refresh();
        return;
      }
      this.preview = clearPreview(this.preview);
      this.preview = {
        element: this.selected,
        originalStyle: this.selected.getAttribute("style")
      };
      this.selected.style.setProperty("display", "none", "important");
      this.refresh();
    },
    handleAction: function(action) {
      if (action === "cancel") {
        this.close(false);
        return;
      }
      if (!this.selected) {
        return;
      }
      if (action === "parent") {
        var parent = resolveParentElement(this.selected);
        if (parent) {
          this.history.push(this.selected);
          this.setSelected(parent, false);
        }
        return;
      }
      if (action === "child") {
        var child = resolveChildElement(this.selected, this.history);
        if (child) {
          this.setSelected(child, false);
        }
        return;
      }
      if (action === "preview") {
        this.togglePreview();
        return;
      }
      if (action === "save") {
        if (
          this.currentRule &&
          isRuleTextSafe(this.currentRule.ruleText) &&
          window.JSInterface &&
          typeof JSInterface.saveGeneratedAdblockRule === "function"
        ) {
          JSInterface.saveGeneratedAdblockRule(this.currentRule.ruleText);
          this.notifySubmit(this.currentRule.ruleText);
          this.close(true);
        }
        return;
      }
      if (action === "resource") {
        if (
          this.currentResourceRule &&
          isRuleTextSafe(this.currentResourceRule) &&
          window.JSInterface &&
          typeof JSInterface.saveGeneratedAdblockRule === "function"
        ) {
          JSInterface.saveGeneratedAdblockRule(this.currentResourceRule);
          this.notifySubmit(this.currentResourceRule);
          this.close(true);
        }
      }
    },
    start: function(options) {
      this.activate(options || {});
    }
  };

  window.__YJAdblockPicker = picker;
})();
`;

/**
 * 生成可注入网页的元素拾取器代码。
 * @param windowId 所属浏览器窗口 id, 回传 ipc 时拼到频道名
 */
export const getAdblockPickerCode = (windowId: number): string => {
  const WINDOW_ID = JSON.stringify(windowId);
  const shim = `
    (function () {
      try {
        var ipc = window.electron && window.electron.ipcRenderer;
        window.JSInterface = window.JSInterface || {};
        window.JSInterface.onAdblockPickerEnter = function () {
          try { ipc && ipc.send("adblock-picker-state-" + ${WINDOW_ID}, "enter"); } catch (e) {}
        };
        window.JSInterface.onAdblockPickerCancel = function () {
          try { ipc && ipc.send("adblock-picker-state-" + ${WINDOW_ID}, "cancel"); } catch (e) {}
        };
        window.JSInterface.onAdblockPickerSubmit = function (ruleText) {
          try { ipc && ipc.send("adblock-picker-state-" + ${WINDOW_ID}, "submit", ruleText || ""); } catch (e) {}
        };
        window.JSInterface.saveGeneratedAdblockRule = function (ruleText) {
          try { ipc && ipc.send("save-adblock-rule-" + ${WINDOW_ID}, ruleText || ""); } catch (e) {}
        };
      } catch (e) {}
    })();
  `;
  const starter = `
    (function () {
      try {
        if (window.__YJAdblockPicker && typeof window.__YJAdblockPicker.start === "function") {
          window.__YJAdblockPicker.start({ currentHost: window.location.host });
        }
      } catch (e) {}
    })();
  `;
  return shim + PICKER_BODY + starter;
};
