(function () {
  var GLOBAL_KEY = '__RAINSEE_SEARCH_ANNOTATOR__';
  var INFLIGHT_KEY = '__RAINSEE_SEARCH_ANNOTATOR_INFLIGHT__';
  var ITEM_CLASS = 'rainsee-search-result-item';
  var BADGE_CLASS = 'rainsee-search-score-badge';
  var TOOLTIP_CLASS = 'rainsee-search-score-tooltip';
  var STYLE_ID = 'rainsee-search-annotator-style';
  var TITLE_CLASS = 'rainsee-search-title-host';
  var TOOLTIP_HIDE_DELAY = 180;
  var TOOLTIP_VIEWPORT_GAP = 12;
  var TOOLTIP_BADGE_GAP = 10;

  // ---- 诊断日志 ----
  // 排查「已显示强相关，过一会又变分析中」:该状态只能由 setLoading() 写入,
  // 即 refresh() 拿到与上次不同的 fingerprint 后重新发起分析。下面这些日志串起
  // 完整链路:注入 → 触发源(observer/reinject/start) → fingerprint 是否变化及
  // 具体哪个字段(query/title/url/introduction)变 → analyze 是否真正 settle。
  // 关闭排查时把 SA_DEBUG 置 false 即可静默。
  var SA_DEBUG = true;
  function saLog() {
    if (!SA_DEBUG) {
      return;
    }
    var args = Array.prototype.slice.call(arguments);
    args.unshift('%c[sa]', 'color:#6366f1;font-weight:bold');
    // eslint-disable-next-line no-console
    console.log.apply(console, args);
  }

  // 对比两次 fingerprint(都是 createFingerprint 产出的 JSON 串),逐字段报告差异。
  // 如果字符串不等但这里报"无字段级变化",说明 createFingerprint 本身有非确定性。
  function saLogFingerprintDiff(oldFp, newFp) {
    if (!oldFp) {
      saLog('fingerprint: 首次分析(无上次记录)');
      return;
    }
    try {
      var oldObj = JSON.parse(oldFp);
      var newObj = JSON.parse(newFp);
      var changes = [];
      if (oldObj.query !== newObj.query) {
        changes.push('query: "' + oldObj.query + '" -> "' + newObj.query + '"');
      }
      var maxLen = Math.max(
        (oldObj.items && oldObj.items.length) || 0,
        (newObj.items && newObj.items.length) || 0,
      );
      for (var i = 0; i < maxLen; i++) {
        var o = oldObj.items && oldObj.items[i];
        var n = newObj.items && newObj.items[i];
        if (!o) {
          changes.push('item[' + i + '] 新增');
          continue;
        }
        if (!n) {
          changes.push('item[' + i + '] 消失');
          continue;
        }
        if (o.title !== n.title) {
          changes.push('item[' + i + '].title: "' + o.title + '" -> "' + n.title + '"');
        }
        if (o.url !== n.url) {
          changes.push('item[' + i + '].url: "' + o.url + '" -> "' + n.url + '"');
        }
        if (o.introduction !== n.introduction) {
          changes.push(
            'item[' + i + '].introduction: "' +
              String(o.introduction).slice(0, 60) +
              '" -> "' +
              String(n.introduction).slice(0, 60) +
              '"',
          );
        }
      }
      if (!changes.length) {
        saLog('fingerprint: 字符串不等但未检出字段级变化(疑似 createFingerprint 非确定性)');
      } else {
        saLog('fingerprint 变化:', changes.join('  ||  '));
      }
    } catch (error) {
      saLog('fingerprint diff 解析失败', error);
    }
  }

  function cleanText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function getMetasoSearchUrl(query) {
    return (
      'https://metaso.cn?q=' +
      encodeURIComponent(cleanText(query || '')) +
      '&s=aujyjb&referrer_s=aujyjb'
    );
  }

  function detectEngine() {
    var host = String(location.hostname || '').toLowerCase();

    if (/(^|\.)baidu\.com$/i.test(host) && document.querySelector('#content_left')) {
      return 'baidu';
    }

    if (/(^|\.)bing\.com$/i.test(host) && document.querySelector('#b_results')) {
      return 'bing';
    }

    if (/(^|\.)google\./i.test(host) && document.querySelector('#search #rso')) {
      return 'google';
    }

    return '';
  }

  function isSupportedPage() {
    return !!detectEngine();
  }

  function getResultsContainer(engine) {
    if (engine === 'google') {
      return document.querySelector('#search #rso') || document.querySelector('#search');
    }

    if (engine === 'bing') {
      return document.querySelector('#b_results');
    }

    if (engine === 'baidu') {
      return document.querySelector('#content_left');
    }

    return null;
  }

  function getQuery(engine) {
    var input = null;

    if (engine === 'google') {
      input =
        document.querySelector('#APjFqb') ||
        document.querySelector('textarea[name="q"]') ||
        document.querySelector('input[name="q"]') ||
        document.querySelector('input[type="search"]');
    } else if (engine === 'bing') {
      input =
        document.querySelector('#sb_form_q') ||
        document.querySelector('input[name="q"]') ||
        document.querySelector('input[type="search"]');
    } else {
      input =
        document.querySelector('#kw') ||
        document.querySelector('input[name="wd"]') ||
        document.querySelector('input[type="search"]');
    }

    if (input && cleanText(input.value)) {
      return cleanText(input.value);
    }

    var title = cleanText(document.title || '');
    if (engine === 'baidu' && title.indexOf('_百度搜索') > -1) {
      return cleanText(title.replace('_百度搜索', ''));
    }

    if (engine === 'bing') {
      title = title
        .replace(/\s*-\s*搜索$/, '')
        .replace(/\s*-\s*必应$/, '')
        .replace(/\s*-\s*Bing$/, '');
      return cleanText(title);
    }

    if (engine === 'google') {
      title = title
        .replace(/\s*-\s*Google\s*搜索$/, '')
        .replace(/\s*-\s*Google Search$/, '')
        .replace(/\s*-\s*Google$/, '');
      return cleanText(title);
    }

    return '';
  }

  function resolveUrl(node, link, engine) {
    if (engine === 'baidu') {
      var mu = cleanText(node.getAttribute('mu') || '');
      if (mu && !/^http:\/\/nourl/i.test(mu)) {
        return mu;
      }
    }

    var href = cleanText((link && link.href) || '');
    return href;
  }

  function getSummarySelectors(engine) {
    if (engine === 'google') {
      return [
        '.VwiC3b',
        '.yXK7lf',
        '.aCOpRe',
        '.s3v9rd',
      ];
    }

    if (engine === 'bing') {
      return [
        '.b_caption p',
        '.b_snippet',
        '.b_caption',
        '.b_algoSlug',
      ];
    }

    return [
      '[data-module="abstract"]',
      '.c-abstract',
      '.summary-text_560AW',
      '.c-span-last',
      '[class*="summary"]',
      '[class*="content-gap"]',
      '[class*="paragraph"]',
      '.c-font-normal',
      '.content-right_8Zs40',
    ];
  }

  function getSummaryText(node, title, engine) {
    var selectors = getSummarySelectors(engine);

    for (var i = 0; i < selectors.length; i++) {
      var element = node.querySelector(selectors[i]);
      var text = cleanText(element && (element.innerText || element.textContent));
      if (text && text !== title) {
        return text;
      }
    }

    var fallback = cleanText(node.innerText || node.textContent || '');
    if (!fallback) {
      return '';
    }

    // node.innerText now includes our injected badge/tooltip text; subtract it
    // so the fingerprint stays stable across annotation passes.
    var badge = node.querySelector('.' + BADGE_CLASS);
    var badgeText = cleanText(badge && (badge.innerText || badge.textContent));
    if (badgeText) {
      fallback = cleanText(fallback.split(badgeText).join(' '));
    }

    if (title) {
      fallback = cleanText(fallback.replace(title, ''));
    }

    return fallback.slice(0, 220);
  }

  function getResultNodes(engine) {
    var container = getResultsContainer(engine);
    if (!container) {
      return [];
    }

    if (engine === 'google') {
      return Array.prototype.filter.call(
        container.querySelectorAll('.N54PNb'),
        function (node) {
          return !!(node && node.nodeType === 1 && getTitleLink(node, engine));
        },
      );
    }

    if (engine === 'bing') {
      return Array.prototype.filter.call(
        container.querySelectorAll(':scope > li.b_algo'),
        function (node) {
          return !!(node && node.nodeType === 1 && node.querySelector('h2 a'));
        },
      );
    }

    return Array.prototype.filter.call(container.children, function (node) {
      if (!node || node.nodeType !== 1) {
        return false;
      }

      return node.classList.contains('result') || node.classList.contains('result-op');
    });
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    var FONT = '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      // result row: subtle highlight so the worthwhile results pop during a scan
      '.' + ITEM_CLASS + '{position:relative;overflow:visible;}' +
        '.' + ITEM_CLASS + '[data-rainsee-tone="5"],.' + ITEM_CLASS + '[data-rainsee-tone="4"]{background:linear-gradient(90deg, rgba(34,197,94,.08), rgba(34,197,94,0) 380px);border-radius:12px;}' +
        '.' + ITEM_CLASS + '[data-rainsee-tone="3"]{background:linear-gradient(90deg, rgba(20,184,166,.07), rgba(20,184,166,0) 320px);border-radius:12px;}' +
        '.' + TITLE_CLASS + '{display:inline-flex !important;align-items:center;gap:9px;flex-wrap:nowrap;overflow:visible;max-width:100%;vertical-align:top;}' +
        '.' + TITLE_CLASS + ' > a{min-width:0;flex:1 1 auto;}' +
        // badge: solid color-filled chip, meaning is readable without hovering
        '.' + BADGE_CLASS + '{--bg:rgba(148,163,184,.14);--fg:#64748b;--ai:#94a3b8;--border:rgba(148,163,184,.32);--glow:transparent;' +
        'position:relative;display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;height:23px;padding:0 10px;border-radius:999px;' +
        'background:var(--bg);border:1px solid var(--border);box-shadow:0 2px 8px var(--glow);color:var(--fg);cursor:default;user-select:none;' +
        'overflow:visible;vertical-align:middle;white-space:nowrap;transition:transform .16s ease, box-shadow .16s ease;}' +
        '.' + BADGE_CLASS + ':hover,.' + BADGE_CLASS + '[data-open="true"]{transform:translateY(-1px);box-shadow:0 6px 16px var(--glow);}' +
        '.rainsee-search-score-ai{font:800 9px/1 ' + FONT + ';letter-spacing:.6px;color:var(--ai);text-transform:uppercase;}' +
        '.rainsee-search-score-num{font:800 13px/1 ' + FONT + ';letter-spacing:-.3px;}' +
        '.rainsee-search-score-level{font:700 11px/1 ' + FONT + ';letter-spacing:.2px;}' +
        // tone palette: 3/4/5 are filled (worth clicking → jump out), 0/1/2 recede
        '.' + BADGE_CLASS + '[data-tone="0"]{--bg:rgba(148,163,184,.13);--fg:#64748b;--ai:#94a3b8;--border:rgba(148,163,184,.3);--glow:transparent;}' +
        '.' + BADGE_CLASS + '[data-tone="1"]{--bg:rgba(148,163,184,.17);--fg:#475569;--ai:#94a3b8;--border:rgba(148,163,184,.36);--glow:transparent;}' +
        '.' + BADGE_CLASS + '[data-tone="2"]{--bg:rgba(245,158,11,.16);--fg:#b45309;--ai:#d97706;--border:rgba(245,158,11,.44);--glow:rgba(245,158,11,.16);}' +
        '.' + BADGE_CLASS + '[data-tone="3"]{--bg:linear-gradient(135deg,#14b8a6,#0d9488);--fg:#fff;--ai:rgba(255,255,255,.82);--border:transparent;--glow:rgba(13,148,136,.34);}' +
        '.' + BADGE_CLASS + '[data-tone="4"]{--bg:linear-gradient(135deg,#34d399,#16a34a);--fg:#fff;--ai:rgba(255,255,255,.86);--border:transparent;--glow:rgba(22,163,74,.36);}' +
        '.' + BADGE_CLASS + '[data-tone="5"]{--bg:linear-gradient(135deg,#22c55e,#15803d);--fg:#fff;--ai:rgba(255,255,255,.92);--border:transparent;--glow:rgba(21,128,61,.44);}' +
        // loading: muted + gentle pulse, overrides tone palette
        '.' + BADGE_CLASS + '[data-loading="true"]{--bg:rgba(148,163,184,.14);--fg:#94a3b8;--ai:#94a3b8;--border:rgba(148,163,184,.3);--glow:transparent;animation:rainsee-badge-pulse 1.1s ease-in-out infinite;}' +
        '@keyframes rainsee-badge-pulse{0%,100%{opacity:.62;}50%{opacity:1;}}' +
        // tooltip floats ABOVE the badge (into the inter-result gap) so it never covers the abstract.
        // pointer-events:auto + the ::before bridge below let the mouse travel from the badge
        // onto the tooltip (to click the gear) without the hover dropping in the 10px gap.
        '.' + TOOLTIP_CLASS + '{position:fixed;left:0;top:0;opacity:0;visibility:hidden;transform:translateY(4px);box-sizing:border-box;' +
        'pointer-events:none;width:230px;padding:12px 13px 11px;border-radius:14px;' +
        'background:linear-gradient(180deg, rgba(17,24,39,.98), rgba(23,31,50,.96));color:#fff;' +
        'font:500 12px/1.4 ' + FONT + ';' +
        'box-shadow:0 18px 42px rgba(15,23,42,.28), 0 2px 10px rgba(15,23,42,.14);transition:opacity .16s ease, transform .16s ease;z-index:2147483647;}' +
        '.' + TOOLTIP_CLASS + '[data-open="true"],.' + TOOLTIP_CLASS + ':hover{opacity:1;visibility:visible;transform:translateY(0);pointer-events:auto;}' +
        // invisible hover-bridge spanning the gap, so moving onto the tooltip keeps it open
        '.' + TOOLTIP_CLASS + '::before{content:"";position:absolute;left:0;right:0;bottom:-12px;height:14px;}' +
        '.' + TOOLTIP_CLASS + '::after{content:"";position:absolute;bottom:-5px;left:14px;width:11px;height:11px;background:rgba(23,31,50,.96);transform:rotate(45deg);border-radius:2px;}' +
        // flip-down variant when there is no room above
        '.' + TOOLTIP_CLASS + '[data-flip="down"]{transform:translateY(-4px);}' +
        '.' + TOOLTIP_CLASS + '[data-open="true"][data-flip="down"],.' + TOOLTIP_CLASS + '[data-flip="down"]:hover{transform:translateY(0);}' +
        '.' + TOOLTIP_CLASS + '[data-flip="down"]::before{bottom:auto;top:-12px;}' +
        '.' + TOOLTIP_CLASS + '[data-flip="down"]::after{bottom:auto;top:-5px;background:rgba(17,24,39,.98);}' +
        '.rainsee-search-tooltip-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px;padding-right:24px;}' +
        // settings gear: top-right corner, jumps to 设置-地址栏
        '.rainsee-search-tooltip-gear{position:absolute;top:9px;right:9px;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;background:rgba(255,255,255,.08);color:rgba(255,255,255,.66);cursor:pointer;transition:background .14s ease, color .14s ease;}' +
        '.rainsee-search-tooltip-gear:hover{background:rgba(255,255,255,.18);color:#fff;}' +
        '.rainsee-search-tooltip-gear svg{width:13px;height:13px;display:block;}' +
        '.rainsee-search-tooltip-title{font:700 12px/1 ' + FONT + ';color:rgba(255,255,255,.94);letter-spacing:.2px;}' +
        '.rainsee-search-tooltip-level{display:inline-flex;align-items:center;justify-content:center;min-width:48px;height:20px;padding:0 8px;border-radius:999px;background:rgba(255,255,255,.1);font:700 11px/1 ' + FONT + ';color:#fff;}' +
        '.rainsee-search-tooltip-score{display:flex;align-items:flex-end;gap:6px;margin-bottom:8px;}' +
        '.rainsee-search-tooltip-score-num{font:800 24px/1 ' + FONT + ';color:#fff;letter-spacing:-.8px;}' +
        '.rainsee-search-tooltip-score-den{font:600 11px/1.1 ' + FONT + ';color:rgba(255,255,255,.56);padding-bottom:3px;}' +
        '.rainsee-search-tooltip-bar{position:relative;height:6px;border-radius:999px;background:rgba(255,255,255,.1);overflow:hidden;margin-bottom:8px;}' +
        '.rainsee-search-tooltip-bar-fill{width:0;height:100%;border-radius:999px;background:linear-gradient(90deg, rgba(255,255,255,.34), rgba(255,255,255,.9));box-shadow:0 0 14px rgba(255,255,255,.16);transition:width .22s ease, background .22s ease;}' +
        '.rainsee-search-tooltip-desc{color:rgba(255,255,255,.78);line-height:1.5;word-break:break-word;overflow-wrap:anywhere;}' +
        '.rainsee-search-tooltip-meta{display:flex;align-items:center;gap:6px;margin-top:8px;color:rgba(255,255,255,.48);font-size:11px;line-height:1;}' +
        '.rainsee-search-tooltip-dot{width:4px;height:4px;border-radius:999px;background:currentColor;opacity:.85;}' +
        '.rainsee-search-tooltip-actions{margin-top:12px;}' +
        '.rainsee-search-tooltip-metaso{display:flex;align-items:center;justify-content:center;width:100%;height:34px;padding:0 12px;border:0;border-radius:10px;background:linear-gradient(135deg,#3b82f6,#2563eb);box-shadow:0 10px 22px rgba(37,99,235,.24);font:700 12px/1 ' + FONT + ';color:#fff;cursor:pointer;transition:transform .14s ease, box-shadow .14s ease, background .14s ease;}' +
        '.rainsee-search-tooltip-metaso:hover{transform:translateY(-1px);box-shadow:0 14px 26px rgba(37,99,235,.28);background:linear-gradient(135deg,#4f8ff8,#2b6df0);}' +
        '.rainsee-search-tooltip-metaso:active{transform:translateY(0);}' +
        // AI direct-answer block: only shown when the model returns one
        '.rainsee-search-tooltip-answer{margin-bottom:10px;padding:9px 10px;border-radius:10px;background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.28);}' +
        '.rainsee-search-tooltip-answer-label{display:inline-flex;align-items:center;gap:5px;margin-bottom:5px;font:800 9px/1 ' + FONT + ';letter-spacing:.8px;text-transform:uppercase;color:rgba(110,231,183,1);}' +
        '.rainsee-search-tooltip-answer-label::before{content:"";width:5px;height:5px;border-radius:999px;background:rgba(52,211,153,1);box-shadow:0 0 8px rgba(52,211,153,.7);}' +
        '.rainsee-search-tooltip-answer-text{font:600 12px/1.5 ' + FONT + ';color:rgba(236,253,245,.96);word-break:break-word;overflow-wrap:anywhere;white-space:normal;}';
    document.head.appendChild(style);
  }

  function getTone(score) {
    return String(Math.max(0, Math.min(5, Math.round(score))));
  }

  function getTooltipText(score, isLoading) {
    if (isLoading) {
      return 'AI正在判断相关性';
    }

    if (score >= 5) {
      return 'AI判断这条最可能就是你想要';
    }

    if (score >= 4) {
      return 'AI判断这条很可能有你想要';
    }

    if (score >= 3) {
      return 'AI判断这条比较值得优先看';
    }

    if (score >= 2) {
      return 'AI判断这条可能有部分帮助';
    }

    if (score >= 1) {
      return 'AI判断这条相关性偏弱';
    }

    return 'AI判断这条大概率不是目标答案';
  }

  function getLevelText(score, isLoading) {
    if (isLoading) {
      return '分析中';
    }

    if (score >= 5) {
      return '强相关';
    }

    if (score >= 4) {
      return '高相关';
    }

    if (score >= 3) {
      return '较相关';
    }

    if (score >= 2) {
      return '可参考';
    }

    if (score >= 1) {
      return '偏弱';
    }

    return '不推荐';
  }

  function getTitleHost(node, engine) {
    if (engine === 'google') {
      return node.querySelector('h3');
    }

    if (engine === 'bing') {
      return node.querySelector('h2') || node.querySelector('.b_title');
    }

    return (
      node.querySelector('h3') ||
      node.querySelector('.title-wrapper_6E6PV') ||
      node.querySelector('.t')
    );
  }

  function getTitleLink(node, engine) {
    if (engine === 'google') {
      var title = node.querySelector('h3');
      return title && title.closest ? title.closest('a') : null;
    }

    if (engine === 'bing') {
      return node.querySelector('h2 a');
    }

    return (
      node.querySelector('h3 a') ||
      node.querySelector('a[data-module="title"]') ||
      node.querySelector('.t a')
    );
  }

  function clearTooltipTimer(badge) {
    if (!badge || !badge.__rainseeTooltipTimer) {
      return;
    }

    clearTimeout(badge.__rainseeTooltipTimer);
    badge.__rainseeTooltipTimer = null;
  }

  function openTooltip(badge, tooltip) {
    if (!badge || !tooltip) {
      return;
    }

    clearTooltipTimer(badge);
    positionTooltip(badge, tooltip);
    badge.setAttribute('data-open', 'true');
    tooltip.setAttribute('data-open', 'true');
  }

  function closeTooltip(badge) {
    if (!badge) {
      return;
    }

    clearTooltipTimer(badge);
    var tooltip = badge.__rainseeTooltip;
    if (tooltip) {
      tooltip.removeAttribute('data-open');
    }
    badge.removeAttribute('data-open');
  }

  function scheduleTooltipClose(badge) {
    if (!badge) {
      return;
    }

    clearTooltipTimer(badge);
    badge.__rainseeTooltipTimer = setTimeout(function () {
      closeTooltip(badge);
    }, TOOLTIP_HIDE_DELAY);
  }

  function repositionOpenTooltip(badge) {
    if (!badge || badge.getAttribute('data-open') !== 'true') {
      return;
    }

    var tooltip = badge.__rainseeTooltip;
    if (!tooltip) {
      return;
    }

    positionTooltip(badge, tooltip);
  }

  function getTooltipMetrics(tooltip) {
    if (!tooltip) {
      return {width: 230, height: 120};
    }

    var rect = tooltip.getBoundingClientRect();
    return {
      width: rect.width || tooltip.offsetWidth || 230,
      height: rect.height || tooltip.offsetHeight || 120,
    };
  }

  function positionTooltip(badge, tooltip) {
    // float on document.body at viewport level so parent stacking contexts /
    // overflow clipping from search result containers can't cover the panel.
    if (!badge || !tooltip) {
      return;
    }

    var rect = badge.getBoundingClientRect();
    var metrics = getTooltipMetrics(tooltip);
    var viewWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    var viewHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    var left = rect.left;
    var top = rect.top - metrics.height - TOOLTIP_BADGE_GAP;
    var maxLeft = Math.max(TOOLTIP_VIEWPORT_GAP, viewWidth - metrics.width - TOOLTIP_VIEWPORT_GAP);

    if (left > maxLeft) {
      left = maxLeft;
    }
    if (left < TOOLTIP_VIEWPORT_GAP) {
      left = TOOLTIP_VIEWPORT_GAP;
    }

    if (top < TOOLTIP_VIEWPORT_GAP) {
      tooltip.setAttribute('data-flip', 'down');
      top = rect.bottom + TOOLTIP_BADGE_GAP;
    } else {
      tooltip.removeAttribute('data-flip');
    }

    if (top + metrics.height > viewHeight - TOOLTIP_VIEWPORT_GAP) {
      top = Math.max(TOOLTIP_VIEWPORT_GAP, viewHeight - metrics.height - TOOLTIP_VIEWPORT_GAP);
    }

    tooltip.style.left = Math.round(left) + 'px';
    tooltip.style.top = Math.round(top) + 'px';
  }

  function ensureBadge(node, engine) {
    var badge = node.querySelector('.' + BADGE_CLASS);
    if (badge) {
      return badge;
    }

    var titleHost = getTitleHost(node, engine);
    if (!titleHost) {
      return null;
    }

    titleHost.classList.add(TITLE_CLASS);
    badge = document.createElement('div');
      badge.className = BADGE_CLASS;
      badge.setAttribute('data-loading', 'true');
      badge.setAttribute('data-tone', '0');

      var levelLabel = document.createElement('span');
      levelLabel.className = 'rainsee-search-score-level';
      levelLabel.textContent = getLevelText(0, true);

      var tooltip = document.createElement('div');
      tooltip.className = TOOLTIP_CLASS;
      tooltip.innerHTML =
        '<div class="rainsee-search-tooltip-gear" title="搜索标注设置">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>' +
        '</div>' +
        '<div class="rainsee-search-tooltip-head">' +
        '<div class="rainsee-search-tooltip-title">AI相关性判断</div>' +
        '<div class="rainsee-search-tooltip-level">分析中</div>' +
        '</div>' +
        '<div class="rainsee-search-tooltip-answer" style="display:none;">' +
        '<div class="rainsee-search-tooltip-answer-label">AI 直答</div>' +
        '<div class="rainsee-search-tooltip-answer-text"></div>' +
        '</div>' +
        '<div class="rainsee-search-tooltip-score">' +
        '<div class="rainsee-search-tooltip-score-num">--</div>' +
        '<div class="rainsee-search-tooltip-score-den">/ 5</div>' +
        '</div>' +
        '<div class="rainsee-search-tooltip-bar">' +
        '<div class="rainsee-search-tooltip-bar-fill"></div>' +
        '</div>' +
        '<div class="rainsee-search-tooltip-desc">' + getTooltipText(0, true) + '</div>' +
        '<div class="rainsee-search-tooltip-meta">' +
        '<span class="rainsee-search-tooltip-dot"></span>' +
        '<span>仅供点击优先级参考</span>' +
        '</div>' +
        '<div class="rainsee-search-tooltip-actions">' +
        '<button type="button" class="rainsee-search-tooltip-metaso">问秘塔AI</button>' +
        '</div>';

      badge.appendChild(levelLabel);
      titleHost.insertBefore(badge, titleHost.firstChild);
      badge.__rainseeTooltip = tooltip;
      document.body.appendChild(tooltip);

      badge.addEventListener('mouseenter', function () {
        openTooltip(badge, tooltip);
      });

      badge.addEventListener('mouseleave', function () {
        scheduleTooltipClose(badge);
      });

      tooltip.addEventListener('mouseenter', function () {
        openTooltip(badge, tooltip);
      });

      tooltip.addEventListener('mouseleave', function () {
        scheduleTooltipClose(badge);
      });

      ['mousedown', 'mouseup', 'click', 'dblclick'].forEach(function (eventName) {
        tooltip.addEventListener(eventName, function (e) {
          e.stopPropagation();
        });
      });

      var gear = tooltip.querySelector('.rainsee-search-tooltip-gear');
      if (gear) {
        gear.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window.searchAnnotatorOpenSettings === 'function') {
            window.searchAnnotatorOpenSettings();
          }
        });
      }

      var metasoButton = tooltip.querySelector('.rainsee-search-tooltip-metaso');
      if (metasoButton) {
        metasoButton.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var engine = detectEngine();
          var query = getQuery(engine);
          var url = getMetasoSearchUrl(query);
          window.open(url, '_blank', 'noopener,noreferrer');
        });
      }

      return badge;
    }

  function updateBadge(node, score, answer) {
    var badge = ensureBadge(node, node.getAttribute('data-rainsee-engine') || detectEngine());
    if (!badge) {
      return;
    }
    var levelLabel = badge.querySelector('.rainsee-search-score-level');
    var tooltip = badge.__rainseeTooltip || null;
    var tooltipLevel = tooltip && tooltip.querySelector('.rainsee-search-tooltip-level');
    var tooltipScoreNum = tooltip && tooltip.querySelector('.rainsee-search-tooltip-score-num');
    var tooltipBar = tooltip && tooltip.querySelector('.rainsee-search-tooltip-bar-fill');
    var tooltipDesc = tooltip && tooltip.querySelector('.rainsee-search-tooltip-desc');
    var tooltipAnswer = tooltip && tooltip.querySelector('.rainsee-search-tooltip-answer');
    var tooltipAnswerText = tooltip && tooltip.querySelector('.rainsee-search-tooltip-answer-text');

    if (tooltipAnswer && tooltipAnswerText) {
      var answerText = cleanText(answer || '');
      if (answerText) {
        tooltipAnswerText.textContent = answerText;
        tooltipAnswer.style.display = '';
      } else {
        tooltipAnswer.style.display = 'none';
      }
    }

    var tone = getTone(score);
    badge.setAttribute('data-loading', 'false');
    badge.setAttribute('data-tone', tone);
    node.setAttribute('data-rainsee-tone', tone);
    if (levelLabel) {
      levelLabel.textContent = getLevelText(score, false);
    }
    if (tooltip) {
      tooltip.setAttribute('data-tone', getTone(score));
    }
    if (tooltipLevel) {
      tooltipLevel.textContent = getLevelText(score, false);
      tooltipLevel.style.background =
        score >= 4
          ? 'rgba(96,165,250,.18)'
          : score >= 3
          ? 'rgba(74,222,128,.16)'
          : score >= 2
          ? 'rgba(250,204,21,.16)'
          : 'rgba(148,163,184,.14)';
      tooltipLevel.style.color =
        score >= 4
          ? 'rgba(191,219,254,1)'
          : score >= 3
          ? 'rgba(187,247,208,1)'
          : score >= 2
          ? 'rgba(254,240,138,1)'
          : 'rgba(226,232,240,1)';
    }
    if (tooltipScoreNum) {
      tooltipScoreNum.textContent = String(score);
    }
    if (tooltipBar) {
      tooltipBar.style.width = String(Math.max(10, score * 20)) + '%';
      tooltipBar.style.background =
        score >= 4
          ? 'linear-gradient(90deg, rgba(96,165,250,.52), rgba(191,219,254,1))'
          : score >= 3
          ? 'linear-gradient(90deg, rgba(74,222,128,.5), rgba(187,247,208,1))'
          : score >= 2
          ? 'linear-gradient(90deg, rgba(250,204,21,.46), rgba(254,240,138,1))'
          : 'linear-gradient(90deg, rgba(148,163,184,.4), rgba(226,232,240,.9))';
    }
    if (tooltipDesc) {
      tooltipDesc.textContent = getTooltipText(score, false);
    }
  }

  function setLoading(node) {
    var badge = ensureBadge(node, node.getAttribute('data-rainsee-engine') || detectEngine());
    if (!badge) {
      return;
    }
    var levelLabel = badge.querySelector('.rainsee-search-score-level');
    var tooltip = badge.__rainseeTooltip || null;
    var tooltipLevel = tooltip && tooltip.querySelector('.rainsee-search-tooltip-level');
    var tooltipScoreNum = tooltip && tooltip.querySelector('.rainsee-search-tooltip-score-num');
    var tooltipBar = tooltip && tooltip.querySelector('.rainsee-search-tooltip-bar-fill');
    var tooltipDesc = tooltip && tooltip.querySelector('.rainsee-search-tooltip-desc');
    var tooltipAnswer = tooltip && tooltip.querySelector('.rainsee-search-tooltip-answer');

    badge.setAttribute('data-loading', 'true');
    badge.setAttribute('data-tone', '0');
    node.removeAttribute('data-rainsee-tone');
    if (tooltipAnswer) {
      tooltipAnswer.style.display = 'none';
    }
    if (levelLabel) {
      levelLabel.textContent = getLevelText(0, true);
    }
    if (tooltip) {
      tooltip.setAttribute('data-tone', '0');
    }
    if (tooltipLevel) {
      tooltipLevel.textContent = getLevelText(0, true);
      tooltipLevel.style.background = 'rgba(148,163,184,.14)';
      tooltipLevel.style.color = 'rgba(226,232,240,1)';
    }
    if (tooltipScoreNum) {
      tooltipScoreNum.textContent = '--';
    }
    if (tooltipBar) {
      tooltipBar.style.width = '24%';
      tooltipBar.style.background =
        'linear-gradient(90deg, rgba(148,163,184,.36), rgba(226,232,240,.86))';
    }
    if (tooltipDesc) {
      tooltipDesc.textContent = getTooltipText(0, true);
    }
  }

  function collectItems(engine) {
    var nodes = getResultNodes(engine);
    var items = [];

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var titleLink = getTitleLink(node, engine);

      if (!titleLink) {
        continue;
      }

      var title = cleanText(titleLink.innerText || titleLink.textContent || '');
      if (!title) {
        continue;
      }

      var item = {
        position: items.length + 1,
        title: title,
        url: resolveUrl(node, titleLink, engine),
        introduction: getSummaryText(node, title, engine),
        className: ITEM_CLASS,
        node: node,
      };

      node.classList.add(ITEM_CLASS);
      node.setAttribute('data-rainsee-engine', engine);
      node.setAttribute('data-rainsee-search-item', String(item.position));
      ensureBadge(node, engine);
      items.push(item);
    }

    return items;
  }

  function normalizeResponseItems(response) {
    if (!response) {
      return [];
    }

    if (Array.isArray(response.items)) {
      return response.items;
    }

    if (response.data && Array.isArray(response.data.items)) {
      return response.data.items;
    }

    if (response.result && Array.isArray(response.result.items)) {
      return response.result.items;
    }

    return [];
  }

  function normalizeResponseAnswer(response) {
    if (!response) {
      return '';
    }

    if (typeof response.answer === 'string') {
      return response.answer;
    }

    if (response.data && typeof response.data.answer === 'string') {
      return response.data.answer;
    }

    if (response.result && typeof response.result.answer === 'string') {
      return response.result.answer;
    }

    return '';
  }

  function createFingerprint(query, items) {
    return JSON.stringify({
      query: query,
      items: items.map(function (item) {
        return {
          title: item.title,
          url: item.url,
          introduction: item.introduction,
        };
      }),
    });
  }

  function applyScores(items, scoredItems, answer) {
    var scoreMap = {};

    scoredItems.forEach(function (item) {
      var position = Number(item.position || item.index);
      if (!position) {
        return;
      }

      scoreMap[position] = item;
    });

    items.forEach(function (item) {
      var result = scoreMap[item.position] || {};
      var score = Number(result.score);
      if (!isFinite(score)) {
        score = 0;
      }

      score = Math.max(0, Math.min(5, Math.round(score)));
      updateBadge(item.node, score, answer);
    });
  }

  function isOwnNode(node) {
    if (!node || node.nodeType !== 1) {
      return false;
    }
    if (node.id === STYLE_ID) {
      return true;
    }
    if (node.classList && node.classList.contains(BADGE_CLASS)) {
      return true;
    }
    return !!(node.closest && node.closest('.' + BADGE_CLASS));
  }

  // A mutation is "ours" (and must be ignored) when it only touches injected
  // badge/tooltip/style nodes — otherwise the observer loops forever.
  function isRelevantMutation(mutation) {
    var target = mutation.target;
    if (target && target.nodeType === 1 && target.closest && target.closest('.' + BADGE_CLASS)) {
      return false;
    }

    var added = mutation.addedNodes;
    if (added && added.length) {
      for (var i = 0; i < added.length; i++) {
        if (!isOwnNode(added[i])) {
          return true;
        }
      }
      return false;
    }

    return true;
  }

  // 该条目是否已出过真实分数(updateBadge 会把 data-loading 置 'false')。
  // 重分析时, 已出分的条目保留旧分, 不再被 setLoading 抹成「分析中」——
  // 这样即便后端偶尔卡住, 用户也能继续看到上一次的强相关, 不会回退成分析中。
  function hasScoredBadge(node) {
    var badge = node.querySelector('.' + BADGE_CLASS);
    return !!(badge && badge.getAttribute('data-loading') !== 'true');
  }

  // 给 analyze 调用套一个超时: 后端偶尔会接受连接但不响应(网络中间设备/AI 模型卡住),
  // 原生 fetch 没有默认超时会永远挂起 → promise 不 settle → isAnalyzing 永远不清 →
  // 标注卡死。超时后 reject, 走 .catch/.finally 正常清理状态。
  function analyzeWithTimeout(payload, ms) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error('analyze timeout ' + ms + 'ms'));
      }, ms);

      window.searchAnnotatorAnalyze(payload).then(
        function (value) {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        function (error) {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  // 主进程在 fetch 超时/异常时会返回 degraded:true(空 items)。此时不应调用
  // applyScores(它会把缺失分数补成 0, 把强相关覆写成「不推荐」), 而是保留现有 badge。
  function isDegradedResponse(response) {
    if (!response) {
      return true;
    }
    if (response.degraded === true) {
      return true;
    }
    if (response.data && response.data.degraded === true) {
      return true;
    }
    if (response.result && response.result.degraded === true) {
      return true;
    }
    return false;
  }

  function SearchAnnotator() {
    this.lastFingerprint = '';
    this.timer = null;
    this.observer = null;
    this.isAnalyzing = false;
    this.boundReposition = null;
  }

  SearchAnnotator.prototype.schedule = function () {
    var self = this;
    // 累计被合并的调度次数;真正 fire 时一次性报出,避免日志被高频 mutation 刷屏。
    this._pendingSchedules = (this._pendingSchedules || 0) + 1;

    clearTimeout(this.timer);
    this.timer = setTimeout(function () {
      var count = self._pendingSchedules || 0;
      self._pendingSchedules = 0;
      saLog('observer 触发 refresh(合并了 ' + count + ' 次 mutation)');
      self.refresh('observer');
    }, 700);
  };

  SearchAnnotator.prototype.refresh = function (source) {
    var self = this;
    var engine = detectEngine();

    saLog(
      'refresh 进入 source=' + (source || '?'),
      'engine=' + engine,
      'hasAnalyzeFn=' + (typeof window.searchAnnotatorAnalyze === 'function'),
      'isAnalyzing=' + this.isAnalyzing,
      'inflight=' + !!window[INFLIGHT_KEY],
      'lastFpLen=' + (this.lastFingerprint || '').length,
    );

    if (!engine || typeof window.searchAnnotatorAnalyze !== 'function') {
      saLog('refresh 跳过: 无 engine 或无 searchAnnotatorAnalyze');
      return;
    }

    ensureStyle();

    var query = getQuery(engine);
    var items = collectItems(engine).slice(0, 10);

    if (!query || !items.length) {
      saLog('refresh 跳过: query 为空或无结果项', {query: query, itemCount: items.length});
      return;
    }

    var fingerprint = createFingerprint(query, items);
    if (fingerprint === this.lastFingerprint) {
      saLog('refresh 跳过: fingerprint 未变(与上次相同)');
      return;
    }
    if (this.isAnalyzing) {
      saLog('refresh 跳过: isAnalyzing=true(上次分析仍未 settle)');
      return;
    }
    if (window[INFLIGHT_KEY]) {
      saLog('refresh 跳过: window[inflight] 已置位');
      return;
    }

    // 走到这里说明要重新分析了 —— 这是「强相关→分析中」回退的关键点。
    saLogFingerprintDiff(this.lastFingerprint, fingerprint);

    this.lastFingerprint = fingerprint;
    this.isAnalyzing = true;
    window[INFLIGHT_KEY] = true;

    // 只对「还没出过分的」条目显示分析中; 已出分的保留旧分, 避免重分析时闪烁/卡死。
    var loadingCount = 0;
    items.forEach(function (item) {
      if (hasScoredBadge(item.node)) {
        return;
      }
      setLoading(item.node);
      loadingCount++;
    });
    saLog('setLoading(仅未出分条目=' + loadingCount + '/' + items.length + '), 即将发起 analyze', {
      query: query,
      positions: items.map(function (i) { return i.position; }),
    });

    analyzeWithTimeout(
      {
        query: query,
        engine: engine,
        pageUrl: location.href,
        items: items.map(function (item) {
          return {
            position: item.position,
            title: item.title,
            url: item.url,
            introduction: item.introduction,
            className: item.className,
          };
        }),
      },
      25000,
    )
      .then(function (response) {
        if (isDegradedResponse(response) || !normalizeResponseItems(response).length) {
          // 后端没拿到结果(超时/异常): 不覆写, 保留已有分数。
          saLog('analyze 返回降级/空结果, 保留现有 badge 不覆写', response);
          return;
        }
        var scored = normalizeResponseItems(response);
        saLog('analyze 成功', {
          返回条数: scored.length,
          评分: scored.map(function (s) { return 'p' + s.position + '=' + s.score; }),
          answer: !!normalizeResponseAnswer(response),
        });
        applyScores(items, scored, normalizeResponseAnswer(response));
      })
      .catch(function (error) {
        saLog('analyze 拒绝/超时(promise reject), 保留现有 badge', error);
        // eslint-disable-next-line no-console
        console.warn('[search-annotator] analyze failed', error);
      })
      .finally(function () {
        self.isAnalyzing = false;
        window[INFLIGHT_KEY] = false;
        saLog('analyze settle 完成(isAnalyzing=false); 已出分条目保留旧分');
      });
  };

  SearchAnnotator.prototype.start = function () {
    var self = this;
    var engine = detectEngine();

    saLog('start() engine=' + engine + ' observer已存在=' + !!this.observer);

    if (!engine) {
      saLog('start 跳过: 无 engine');
      return;
    }

    ensureStyle();

    // Observer already wired → this is a re-entry; skip the duplicate refresh
    // (the re-injection guard schedules its own debounced refresh).
    if (this.observer) {
      saLog('start: observer 已存在 → 视为重入, 跳过重复 refresh');
      return;
    }

    if (!this.boundReposition) {
      this.boundReposition = function () {
        var openBadges = document.querySelectorAll('.' + BADGE_CLASS + '[data-open="true"]');
        Array.prototype.forEach.call(openBadges, function (badge) {
          repositionOpenTooltip(badge);
        });
      };
      window.addEventListener('scroll', this.boundReposition, true);
      window.addEventListener('resize', this.boundReposition);
    }

    this.refresh('start');

    var container = getResultsContainer(engine);
    if (!container) {
      return;
    }

    this.observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (isRelevantMutation(mutations[i])) {
          self.schedule();
          return;
        }
      }
    });

    this.observer.observe(container, {
      childList: true,
      subtree: true,
    });
    saLog('MutationObserver 已挂载到结果容器, 监听 childList+subtree');
  };

  // Re-injection guard: the host may inject this script many times. Reuse the
  // existing instance and collapse rapid re-injections into a single refresh
  // instead of re-running start()/refresh() on every injection.
  if (window[GLOBAL_KEY] && typeof window[GLOBAL_KEY].refresh === 'function') {
    var existing = window[GLOBAL_KEY];
    saLog('脚本被重复注入(did-navigate + did-finish-load 都会注入) → 复用现有实例 + 300ms 后再 refresh');
    existing.start();
    clearTimeout(existing.reinjectTimer);
    existing.reinjectTimer = setTimeout(function () {
      saLog('reinject 定时器 fire → refresh');
      existing.refresh('reinject');
    }, 300);
    return;
  }

  saLog('脚本首次注入 → 新建 SearchAnnotator + start()');
  window[GLOBAL_KEY] = new SearchAnnotator();
  window[GLOBAL_KEY].start();
})();
