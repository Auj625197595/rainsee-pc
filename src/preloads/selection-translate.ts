// 划词翻译 —— 在网页世界运行(由 view-preload.ts 导入)。
//
// view-preload 在每个网页的页面世界执行(contextIsolation:false / sandbox:false),
// 可直接用 ipcRenderer / tabId。本模块负责:
//   1. 监听 mouseup / keyup / selectionchange(capture 阶段,防页面脚本 stopPropagation);
//   2. 去抖判定选中文本是否需翻译(不含中文、且非纯数字/符号);
//   3. 经 IPC 让主进程调用微软翻译(复用网页翻译引擎);
//   4. 在选区下方注入 Shadow DOM 毛玻璃卡片回显译文(样式与 add-bookmark 对话框一致);
//   5. 取消选中 / Esc / 滚动 / 点卡片外 → 卡片消失。
//
// 配置新鲜度:preload 每次导航都会重新执行,顶层 sendSync 拉取一次最新配置;
// 页内再监听 selection-translate-config-changed 做热更新(用户在设置页改开关/目标语言)。
// 不复用 update-settings,因为后者只广播到 WebUI 视图,到不了普通网页。

import {ipcRenderer} from 'electron';

const tabId = ipcRenderer.sendSync('get-webcontents-id');
const windowId = ipcRenderer.sendSync('get-window-id');

// ---------------------------------------------------------------------------
// 配置缓存
// ---------------------------------------------------------------------------

interface SelCfg {
  enabled: boolean;
  target: string;
}

let config: SelCfg = ipcRenderer.sendSync('get-selection-translate-config-sync');

ipcRenderer.on('selection-translate-config-changed', (_e, cfg: SelCfg) => {
  const wasEnabled = config.enabled;
  if (cfg && typeof cfg === 'object') config = cfg;
  if (wasEnabled && !config.enabled) hideCard();
});

// ---------------------------------------------------------------------------
// 阈值 / 正则
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 300; // mouseup/keyup 后等选中稳定再判定
const GAP = 8; // 卡片与选区的间距
const CARD_WIDTH = 360;
const CARD_MAX_HEIGHT = 320;

// 含汉字 → 已是中文,不译(与 translate.ts:257 同 idiom)。
const RE_CHINESE = /[一-鿿㐀-䶿]/;
// 至少一个 Unicode 字母 → 排除纯数字 / 标点 / 符号 / emoji。
const RE_LETTER = /\p{L}/u;

const shouldTranslate = (t: string): boolean => {
  const s = (t || '').trim();
  if (s.length < 2) return false; // 单字符噪声
  if (s.length > 45000) return false; // 超 MS 单条上限
  if (RE_CHINESE.test(s)) return false; // 已含中文
  return RE_LETTER.test(s); // 必须有字母
};

// 密码 / 敏感字段不翻译(防密钥外泄到翻译 API)。
const isSensitiveField = (el: Element | null): boolean => {
  if (!el) return false;
  const tag = el.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false;
  const input = el as HTMLInputElement;
  if (input.type === 'password') return true;
  const ac = (input.getAttribute('autocomplete') || '').toLowerCase();
  return ac.includes('off') || ac.includes('new-password');
};

// 取当前选中文本 + 选区视口 rect。input/textarea 走 selectionStart/End 兜底。
const getSelectionInfo = (): {text: string; rect: DOMRect} | null => {
  const sel = window.getSelection && window.getSelection();
  let text = sel ? sel.toString() : '';
  let rect: DOMRect | null = null;

  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    rect = sel.getRangeAt(0).getBoundingClientRect();
  }

  // input/textarea 的选择 window.getSelection() 可能取不到,用属性兜底。
  if (!text) {
    const a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) {
      const input = a as HTMLInputElement & {selectionStart: number | null; selectionEnd: number | null};
      const st = input.selectionStart;
      const ed = input.selectionEnd;
      if (st != null && ed != null && ed > st) {
        text = (input.value || '').substring(st, ed);
      }
    }
    if (text && a && !rect) {
      rect = (a as HTMLElement).getBoundingClientRect();
    }
  }

  if (!text || !rect) return null;
  if (rect.width === 0 && rect.height === 0) return null;
  return {text, rect};
};

// ---------------------------------------------------------------------------
// Shadow DOM 卡片
// ---------------------------------------------------------------------------

const SHADOW_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "Microsoft YaHei", "Segoe UI", system-ui, sans-serif; }

.rst-card {
  position: fixed;
  width: ${CARD_WIDTH}px;
  max-width: calc(100vw - 16px);
  max-height: ${CARD_MAX_HEIGHT}px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  background-color: rgba(255, 255, 255, 0.78);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  backdrop-filter: blur(28px) saturate(180%);
  box-shadow:
    0 1px 4px rgba(20, 32, 72, 0.05),
    0 8px 24px rgba(20, 32, 72, 0.10),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
  color: #161b2d;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: auto;
  opacity: 1;
  transform: translateY(0);
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.rst-card.rst-hidden {
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
}

.rst-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #3452ff;
}
.rst-eyebrow::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #3195f7;
}

.rst-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  padding-right: 4px;
  white-space: pre-wrap;
  word-break: break-word;
}
.rst-body::-webkit-scrollbar { width: 8px; }
.rst-body::-webkit-scrollbar-thumb {
  background: rgba(149, 163, 184, 0.38);
  border-radius: 999px;
}
.rst-loading { color: #75809a; font-style: italic; }
.rst-error { color: #e14b57; }

.rst-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.rst-btn {
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  background: rgba(52, 82, 255, 0.08);
  color: #3452ff;
  transition: background-color 0.16s ease;
}
.rst-btn:hover { background: rgba(52, 82, 255, 0.16); }
.rst-btn-primary {
  background: #3195f7;
  color: #fff;
  box-shadow: 0 6px 16px rgba(49, 149, 247, 0.24);
}
.rst-btn-primary:hover { background: #1f86e8; }
.rst-icon-btn {
  height: 30px;
  width: 30px;
  border: 0;
  border-radius: 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: #75809a;
}
.rst-icon-btn:hover {
  background: rgba(20, 32, 72, 0.06);
  color: #161b2d;
}
.rst-spacer { margin-left: auto; }

@media (prefers-color-scheme: dark) {
  .rst-card {
    background-color: rgba(40, 42, 48, 0.78);
    border-color: rgba(255, 255, 255, 0.10);
    box-shadow:
      0 1px 4px rgba(0, 0, 0, 0.30),
      0 8px 24px rgba(0, 0, 0, 0.40),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
    color: #e8ebf2;
  }
  .rst-body { color: #e8ebf2; }
  .rst-loading { color: #9aa3b8; }
  .rst-icon-btn { color: #9aa3b8; }
  .rst-icon-btn:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
  .rst-btn { background: rgba(52, 82, 255, 0.20); color: #9db0ff; }
}
`;

const SETTINGS_ICON_SVG = `
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3"></circle>
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
</svg>`;

let host: HTMLDivElement | null = null;
let card: HTMLDivElement | null = null;
let bodyEl: HTMLDivElement | null = null;
let copyBtn: HTMLButtonElement | null = null;
let lastTranslation = '';
let currentReqId = 0;
let hideTimer: number | null = null;

// 惰性建卡(host 点击穿透,卡片自身可点)。复用同一实例,只切显隐。
const ensureCard = (): {card: HTMLDivElement; body: HTMLDivElement; copy: HTMLButtonElement} => {
  if (host && card && bodyEl && copyBtn) return {card, body: bodyEl, copy: copyBtn};

  host = document.createElement('div');
  host.id = '__rainsee_seltranslate_host';
  host.style.cssText =
    'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;';

  const root = host.attachShadow({mode: 'closed'});

  const styleEl = document.createElement('style');
  styleEl.textContent = SHADOW_CSS;
  root.appendChild(styleEl);

  card = document.createElement('div');
  card.className = 'rst-card rst-hidden';
  card.innerHTML = `
    <div class="rst-eyebrow">划词翻译</div>
    <div class="rst-body rst-loading">翻译中…</div>
    <div class="rst-actions">
      <button class="rst-btn" data-act="copy" disabled>复制</button>
      <button class="rst-btn rst-btn-primary" data-act="fullpage">翻译全文</button>
      <span class="rst-spacer"></span>
      <button class="rst-icon-btn" data-act="settings" title="划词翻译设置">${SETTINGS_ICON_SVG}</button>
    </div>`;

  root.appendChild(card);

  bodyEl = card.querySelector('.rst-body');
  copyBtn = card.querySelector('[data-act="copy"]');

  // 按钮事件(在 shadow 内直接绑,document 侧因 retarget 看到的 target 都是 host)。
  card.querySelector('[data-act="copy"]')!.addEventListener('click', onCopy);
  card.querySelector('[data-act="fullpage"]')!.addEventListener('click', onTranslateFull);
  card.querySelector('[data-act="settings"]')!.addEventListener('click', onOpenSettings);

  (document.body || document.documentElement).appendChild(host);
  return {card, body: bodyEl!, copy: copyBtn!};
};

const positionCard = (rect: DOMRect) => {
  const {card} = ensureCard();
  const cardH = CARD_MAX_HEIGHT;
  const cardW = Math.min(CARD_WIDTH, window.innerWidth - 16);

  let left = rect.left;
  let top = rect.bottom + GAP;
  // 下方放不下 → 翻到选区上方。
  if (top + cardH > window.innerHeight - 8) {
    const above = rect.top - GAP - cardH;
    if (above > 8) top = above;
    else top = Math.max(8, window.innerHeight - 8 - cardH);
  }
  // 左右 clamp 进视口。
  left = Math.max(8, Math.min(left, window.innerWidth - cardW - 8));

  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
};

const showCardLoading = (rect: DOMRect) => {
  const {card, body, copy} = ensureCard();
  if (hideTimer != null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  positionCard(rect);
  body.className = 'rst-body rst-loading';
  body.textContent = '翻译中…';
  lastTranslation = '';
  copy.disabled = true;
  card.classList.remove('rst-hidden');
};

const showCardResult = (reqId: number, ok: boolean, text?: string, error?: string) => {
  if (reqId !== currentReqId) return; // 已被新选区取代,丢弃
  const {card, body, copy} = ensureCard();
  if (ok && text) {
    body.className = 'rst-body';
    body.textContent = text;
    lastTranslation = text;
    copy.disabled = false;
  } else {
    body.className = 'rst-body rst-error';
    body.textContent = error ? `翻译失败:${error}` : '翻译服务暂不可用';
    lastTranslation = '';
    copy.disabled = true;
  }
  card.classList.remove('rst-hidden');
};

const hideCard = () => {
  if (!host || !card) return;
  card.classList.add('rst-hidden');
  currentReqId++; // 作废在途响应
  if (hideTimer != null) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    card = null;
    bodyEl = null;
    copyBtn = null;
    hideTimer = null;
  }, 220);
};

// ---------------------------------------------------------------------------
// 翻译请求
// ---------------------------------------------------------------------------

const requestTranslate = (text: string, rect: DOMRect) => {
  currentReqId++;
  const reqId = currentReqId;
  showCardLoading(rect);
  ipcRenderer.send('selection-translate-request', {
    id: reqId,
    text,
    target: config.target || 'zh-CN',
    webContentsId: tabId,
  });
};

// 主进程翻译结果路由回本 tab。
ipcRenderer.on(`selection-translate-result-${tabId}`, (_e, p: {id: number; ok: boolean; text?: string; error?: string}) => {
  if (!p) return;
  showCardResult(p.id, !!p.ok, p.text, p.error);
});

// ---------------------------------------------------------------------------
// 按钮处理
// ---------------------------------------------------------------------------

const onCopy = async () => {
  if (!lastTranslation) return;
  try {
    await navigator.clipboard.writeText(lastTranslation);
  } catch {
    // 页面可能禁用 clipboard API,兜底用隐藏 textarea + execCommand。
    try {
      const ta = document.createElement('textarea');
      ta.value = lastTranslation;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch {
      /* 忽略 */
    }
  }
};

const onTranslateFull = () => {
  // 复用现有整页翻译(地址栏翻译图标会点亮)。
  ipcRenderer.send(`translate-start-${windowId}`);
  hideCard();
};

const onOpenSettings = () => {
  ipcRenderer.invoke('selection-translate-open-settings');
  hideCard();
};

// ---------------------------------------------------------------------------
// 去抖判定
// ---------------------------------------------------------------------------

let debounceTimer: number | null = null;

const scheduleCheck = () => {
  if (debounceTimer != null) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(checkSelection, DEBOUNCE_MS);
};

const checkSelection = () => {
  debounceTimer = null;
  if (!config.enabled) return;
  if (isSensitiveField(document.activeElement)) {
    hideCard();
    return;
  }
  const info = getSelectionInfo();
  if (!info) {
    hideCard();
    return;
  }
  if (!shouldTranslate(info.text)) {
    hideCard();
    return;
  }
  requestTranslate(info.text, info.rect);
};

// ---------------------------------------------------------------------------
// 事件接线(capture 阶段)
// ---------------------------------------------------------------------------

const onMouseDown = (e: MouseEvent) => {
  // 点卡片自身不隐藏(retarget:shadow 内点击在 document 看到的 target 是 host)。
  if (host && host.contains(e.target as Node)) return;
  if (!config.enabled) return;
  // 点页面其它处 → 隐藏(随后 mouseup 若有新选区会重新触发)。
  hideCard();
};

const onMouseUp = (e: MouseEvent) => {
  if (!config.enabled) return;
  if (host && host.contains(e.target as Node)) return;
  // 忽略右键(交给手势 / 上下文菜单)。
  if (e.button !== 0) return;
  scheduleCheck();
};

const onKeyUp = (e: KeyboardEvent) => {
  if (!config.enabled) return;
  // Shift + 方向键扩选 / Ctrl+A 全选后触发判定;Esc 直接隐藏。
  if (e.key === 'Escape') {
    hideCard();
    return;
  }
  if (e.shiftKey || e.ctrlKey || e.metaKey) scheduleCheck();
};

const onSelectionChange = () => {
  // 选中变空/折叠 → 立即隐藏(不等去抖)。
  if (!config.enabled) return;
  const sel = window.getSelection && window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString()) {
    hideCard();
  }
};

const onScroll = () => hideCard();
const onKeyDownEsc = (e: KeyboardEvent) => {
  if (e.key === 'Escape') hideCard();
};

document.addEventListener('mousedown', onMouseDown, true);
document.addEventListener('mouseup', onMouseUp, true);
document.addEventListener('keyup', onKeyUp, true);
document.addEventListener('selectionchange', onSelectionChange, true);
window.addEventListener('scroll', onScroll, true);
document.addEventListener('keydown', onKeyDownEsc, true);

// 页面卸载时清掉 host 与计时器,避免残留。
window.addEventListener('pagehide', () => {
  if (debounceTimer != null) window.clearTimeout(debounceTimer);
  if (hideTimer != null) window.clearTimeout(hideTimer);
  if (host && host.parentNode) host.parentNode.removeChild(host);
  host = null;
  card = null;
  bodyEl = null;
  copyBtn = null;
});
