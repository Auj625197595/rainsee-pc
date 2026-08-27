import { ipcRenderer } from 'electron';

interface SelCfg {
  panelEnabled: boolean;
  wordCountEnabled: boolean;
  translateEnabled: boolean;
  target: string;
}

const tabId = ipcRenderer.sendSync('get-webcontents-id');
let config: SelCfg = ipcRenderer.sendSync(
  'get-selection-translate-config-sync',
) || {
  panelEnabled: true,
  wordCountEnabled: true,
  translateEnabled: true,
  target: 'zh-CN',
};
let siteHidden = false;
let siteStateReady = false;

const GAP = 16;
const MENU_HEIGHT = 42;
const CARD_MAX_WIDTH = 360;
const CARD_MAX_HEIGHT = 320;
const RE_CHINESE = /[一-鿿㐀-䶿]/;
const RE_LETTER = /\p{L}/u;

const shouldTranslate = (text: string) => {
  const s = (text || '').trim();
  return (
    s.length >= 2 &&
    s.length <= 45000 &&
    !RE_CHINESE.test(s) &&
    RE_LETTER.test(s)
  );
};

const isSensitiveField = (el: Element | null) => {
  if (!el || !['INPUT', 'TEXTAREA'].includes(el.tagName)) return false;
  const input = el as HTMLInputElement;
  const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
  return (
    input.type === 'password' ||
    autocomplete.includes('off') ||
    autocomplete.includes('new-password')
  );
};

const getSelectionInfo = (): { text: string; rect: DOMRect } | null => {
  const sel = window.getSelection && window.getSelection();
  let text = sel ? sel.toString() : '';
  let rect: DOMRect | null =
    sel && sel.rangeCount > 0 && !sel.isCollapsed
      ? sel.getRangeAt(0).getBoundingClientRect()
      : null;
  if (!text) {
    const active = document.activeElement as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null;
    if (
      active &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
    ) {
      const start = active.selectionStart;
      const end = active.selectionEnd;
      if (start != null && end != null && end > start)
        text = active.value.substring(start, end);
      if (text && !rect) rect = active.getBoundingClientRect();
    }
  }
  if (!text || !rect || (!rect.width && !rect.height)) return null;
  return { text, rect };
};

const SHADOW_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "Microsoft YaHei", "Segoe UI", system-ui, sans-serif; }
.rst-card { position: fixed; width: max-content; max-width: min(${CARD_MAX_WIDTH}px, calc(100vw - 16px)); max-height: ${CARD_MAX_HEIGHT}px; border-radius: 14px; border: 1px solid rgba(255,255,255,.55); background: rgba(255,255,255,.82); backdrop-filter: blur(28px) saturate(180%); box-shadow: 0 8px 24px rgba(20,32,72,.14), inset 0 1px 0 rgba(255,255,255,.7); color: #161b2d; padding: 10px; display: flex; flex-direction: column; gap: 8px; pointer-events: auto; -webkit-user-select: none; user-select: none; transition: opacity .16s ease, transform .16s ease; }
.rst-card.rst-hidden { opacity: 0; transform: translateY(4px); pointer-events: none; }
.rst-body { max-height: 220px; overflow-y: auto; padding: 3px 4px; font-size: 14px; font-weight: 600; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.rst-loading { color: #75809a; font-style: italic; }.rst-error { color: #d45757; }
.rst-actions { display: flex; align-items: center; gap: 2px; flex-wrap: nowrap;  }
.rst-card.has-translation .rst-actions { border-top: 1px solid rgba(20,32,72,.08); }
.rst-btn { height: 30px; min-width: 48px; padding: 0 9px; border: 0; border-radius: 9px; font-size: 12px; font-weight: 800; cursor: pointer; background: transparent; color: #334155; white-space: nowrap; }
.rst-btn:hover { background: rgba(52,82,255,.10); color: #3452ff; }
.rst-count { height: 30px; padding: 0 6px; border: 0; border-radius: 8px; background: transparent; color: #75809a; font-size: 11px; font-weight: 700; white-space: nowrap; cursor: pointer; }
.rst-count:hover { background: rgba(52,82,255,.10); color: #3452ff; }
.rst-more-item { display: block; width: 100%; border: 0; background: transparent; border-radius: 7px; padding: 7px 9px; text-align: left; font-size: 12px; cursor: pointer; color: #334155; }.rst-more-item:hover { background: rgba(52,82,255,.1); }
.rst-spacer { flex: 1; }.rst-hide-menu { position: absolute; bottom: 34px; right: 0; display: none; min-width: 132px; padding: 5px; border: 1px solid rgba(20,32,72,.1); border-radius: 10px; background: rgba(255,255,255,.96); box-shadow: 0 8px 24px rgba(20,32,72,.16); }.rst-hide.open .rst-hide-menu { display: block; }
@media (prefers-color-scheme: dark) { .rst-card { background: rgba(40,42,48,.9); border-color: rgba(255,255,255,.1); color: #e8ebf2; } .rst-card.has-translation .rst-actions { border-color: rgba(255,255,255,.1); } .rst-btn,.rst-more-item { color: #d6dbea; } .rst-count { color: #9aa3b8; } .rst-hide-menu { background: rgba(42,44,52,.98); border-color: rgba(255,255,255,.12); } }
`;

let host: HTMLDivElement | null = null;
let card: HTMLDivElement | null = null;
let bodyEl: HTMLDivElement | null = null;
let copyBtn: HTMLButtonElement | null = null;
let selectedText = '';
let currentRect: DOMRect | null = null;
let currentReqId = 0;
let hideTimer: number | null = null;
let copyInFlight = false;

const ensureCard = () => {
  if (host && card && bodyEl && copyBtn)
    return { card, body: bodyEl, copy: copyBtn };
  host = document.createElement('div');
  host.id = '__rainsee_selection_panel_host';
  host.style.cssText =
    'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;-webkit-user-select:none;user-select:none;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;
  root.appendChild(style);
  card = document.createElement('div');
  card.className = 'rst-card rst-hidden';
  card.innerHTML = `<div class="rst-body rst-loading">翻译中…</div><div class="rst-actions">
    <button class="rst-btn" data-act="copy">复制</button><button class="rst-btn" data-act="search">搜索</button>
    <span class="rst-more"><button class="rst-btn" data-act="more">更多</button></span>
    <span class="rst-hide"><button class="rst-btn" data-act="hide">隐藏</button><span class="rst-hide-menu"><button class="rst-more-item" data-act="site-hide">仅此网站隐藏</button><button class="rst-more-item" data-act="global-hide">全局隐藏</button></span></span><span class="rst-spacer"></span><button class="rst-count" data-act="word-count-settings" aria-label="选中文字数设置" title="字数显示设置"></button></div>`;
  root.appendChild(card);
  bodyEl = card.querySelector('.rst-body');
  copyBtn = card.querySelector('[data-act="copy"]');
  const copy = card.querySelector('[data-act="copy"]') as HTMLButtonElement;
  const showCopyFailure = () => {
    copy.textContent = '复制失败';
    window.setTimeout(() => {
      if (copyBtn === copy) {
        copy.textContent = '复制';
        copy.disabled = false;
      }
    }, 1200);
  };
  const copySelection = async (event?: Event) => {
    // Prevent the button from taking focus and collapsing the page selection.
    event?.preventDefault();
    event?.stopPropagation();
    if (copyInFlight || !selectedText) return;
    copyInFlight = true;
    copy.disabled = true;
    const text = selectedText;
    try {
      const copied = await ipcRenderer.invoke('selection-panel-copy', text);
      if (copied) {
        hideCard();
      } else {
        showCopyFailure();
      }
    } catch {
      showCopyFailure();
    } finally {
      copyInFlight = false;
    }
  };
  copy.addEventListener('pointerdown', copySelection);
  copy.addEventListener('click', copySelection);
  card.querySelector('[data-act="search"]')!.addEventListener('click', () => {
    ipcRenderer.send('selection-panel-search', selectedText);
    hideCard();
  });
  card.querySelector('[data-act="more"]')!.addEventListener('click', () => {
    ipcRenderer.send('selection-panel-more', selectedText);
    hideCard();
  });
  card
    .querySelector('[data-act="word-count-settings"]')!
    .addEventListener('click', () => {
      ipcRenderer.invoke(
        'selection-translate-open-settings',
        'selectionWordCount',
      );
      hideCard();
    });
  card
    .querySelector('[data-act="hide"]')!
    .addEventListener('click', () =>
      card!.querySelector('.rst-hide')!.classList.toggle('open'),
    );
  card
    .querySelector('[data-act="site-hide"]')!
    .addEventListener('click', () => {
      ipcRenderer.invoke('selection-panel-hide-site');
      hideCard();
    });
  card
    .querySelector('[data-act="global-hide"]')!
    .addEventListener('click', () => {
      ipcRenderer.invoke('selection-panel-hide-global');
      hideCard();
    });
  (document.body || document.documentElement).appendChild(host);
  return { card, body: bodyEl!, copy: copyBtn! };
};

const positionCard = (rect: DOMRect, withTranslation: boolean) => {
  const { card: el } = ensureCard();
  const cardW = Math.min(
    el.getBoundingClientRect().width || CARD_MAX_WIDTH,
    window.innerWidth - 16,
  );
  const cardH = withTranslation ? CARD_MAX_HEIGHT : MENU_HEIGHT + 20;
  let left = Math.max(8, Math.min(rect.left, window.innerWidth - cardW - 8));
  let top = withTranslation ? rect.bottom + GAP : rect.top - GAP - cardH;
  if (!withTranslation && top < 8) top = rect.bottom + GAP;
  if (withTranslation && top + cardH > window.innerHeight - 8)
    top = Math.max(8, rect.top - GAP - cardH);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
};

const showPanel = (rect: DOMRect, text: string, translating: boolean) => {
  const { card: el, body, copy } = ensureCard();
  if (hideTimer != null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  selectedText = text;
  currentRect = rect;
  const actions = el.querySelector('.rst-actions') as HTMLDivElement;
  const count = el.querySelector('.rst-count') as HTMLButtonElement | null;
  if (count) {
    count.textContent = `字数 ${Array.from(text).length}`;
    count.style.display = config.wordCountEnabled ? '' : 'none';
  }
  actions.style.display = config.panelEnabled ? 'flex' : 'none';
  el.classList.toggle('has-translation', translating);
  body.style.display = translating ? 'block' : 'none';
  positionCard(rect, translating);
  el.classList.remove('rst-hidden');
  copy.disabled = !text;
};

const hideCard = () => {
  if (!host || !card) return;
  card.classList.add('rst-hidden');
  currentRect = null;
  currentReqId++;
  if (hideTimer != null) clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    host?.remove();
    host = null;
    card = null;
    bodyEl = null;
    copyBtn = null;
    copyInFlight = false;
    hideTimer = null;
  }, 220);
};

// 取页面语境(title/描述)供 LLM 消歧。沙箱内 document 可访问,直接读。
const getPageContext = (): {title: string; description: string} => {
  try {
    const title = (document.title || '').slice(0, 200);
    let description = '';
    const m =
      document.querySelector('meta[name="description" i]') ||
      document.querySelector('meta[property="og:description" i]');
    if (m) description = (m.getAttribute('content') || '').slice(0, 500);
    return {title, description};
  } catch {
    return {title: '', description: ''};
  }
};

const requestTranslate = (text: string, rect: DOMRect) => {
  currentReqId++;
  const id = currentReqId;
  showPanel(rect, text, true);
  const { body } = ensureCard();
  body.className = 'rst-body rst-loading';
  body.textContent = '翻译中…';
  ipcRenderer.send('selection-translate-request', {
    id,
    text,
    target: config.target || 'zh-CN',
    webContentsId: tabId,
    ...getPageContext(),
  });
};

ipcRenderer.on(
  `selection-translate-result-${tabId}`,
  (_e, p: { id: number; ok: boolean; text?: string; error?: string }) => {
    if (!p || p.id !== currentReqId) return;
    const { body } = ensureCard();
    if (p.ok && p.text) {
      body.className = 'rst-body';
      body.textContent = p.text;
    } else {
      body.className = 'rst-body rst-error';
      body.textContent = p.error ? `翻译失败:${p.error}` : '翻译服务暂不可用';
    }
    if (currentRect) positionCard(currentRect, true);
  },
);

ipcRenderer.on('selection-translate-config-changed', (_e, cfg: SelCfg) => {
  if (cfg && typeof cfg === 'object') config = cfg;
  if (!config.panelEnabled && !config.translateEnabled) hideCard();
  else if (siteStateReady) checkSelection();
});

ipcRenderer.on(
  'selection-panel-site-rule-changed',
  (_e, hostName: string, hidden: boolean) => {
    if (hostName === '*' || hostName === location.hostname) {
      siteHidden = !!hidden;
      if (siteHidden) hideCard();
      else checkSelection();
    }
  },
);

const checkSelection = () => {
  if (
    !siteStateReady ||
    (!config.panelEnabled && !config.translateEnabled) ||
    siteHidden ||
    isSensitiveField(document.activeElement)
  )
    return hideCard();
  const info = getSelectionInfo();
  if (!info) return hideCard();
  if (config.translateEnabled && shouldTranslate(info.text))
    requestTranslate(info.text, info.rect);
  else if (config.panelEnabled) {
    currentReqId++;
    showPanel(info.rect, info.text, false);
    const { body } = ensureCard();
    body.textContent = '';
  } else hideCard();
};

let debounceTimer: number | null = null;
const scheduleCheck = () => {
  if (debounceTimer != null) clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    checkSelection();
  }, 180);
};
const onMouseDown = (e: MouseEvent) => {
  if (host && host.contains(e.target as Node)) return;
  hideCard();
};
const onMouseUp = (e: MouseEvent) => {
  if (host && host.contains(e.target as Node)) return;
  if (e.button === 0) scheduleCheck();
};
const onKeyUp = (e: KeyboardEvent) => {
  if (e.key === 'Escape') hideCard();
  else if (e.shiftKey || e.ctrlKey || e.metaKey) scheduleCheck();
};
const onSelectionChange = () => {
  if (copyInFlight) return;
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed || !sel.toString()) hideCard();
};

document.addEventListener('mousedown', onMouseDown, true);
document.addEventListener('mouseup', onMouseUp, true);
document.addEventListener('keyup', onKeyUp, true);
document.addEventListener('selectionchange', onSelectionChange, true);
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape') hideCard();
  },
  true,
);
window.addEventListener('scroll', hideCard, true);
window.addEventListener('pagehide', hideCard);

ipcRenderer
  .invoke('selection-panel-site-state')
  .then((hidden) => {
    siteHidden = !!hidden;
    siteStateReady = true;
    checkSelection();
  })
  .catch(() => {
    siteStateReady = true;
  });
