import {app} from 'electron';
import {readFileSync} from 'fs';
import {join} from 'path';

// 网页翻译:微软免费翻译(Edge 内部 key-less 接口,沉浸式翻译同款)。
// 主进程为唯一可信源:
//  1) 本地缓存 JWT token(GET edge.microsoft.com/translate/auth,~10min 有效),过期前刷新;
//  2) 页面侧引导(static/scripts/ms-translate.js)只暴露 collect/apply/revert,由主进程经
//     webContents.executeJavaScript 驱动。网页无 ipcRenderer,不向任意网页暴露 IPC(安全);
//     且 executeJavaScript + 改写文本节点 nodeValue 完全不受页面 CSP 约束(原云端 Google
//     组件因远程 <script> 被 CSP 拦截 / 请求挂起而废弃)。
// 流程:注入引导 → collect() 取 [{id,text}] → 主进程 fetch 微软翻译(分批) → apply() 逐批回填。

const TOKEN_URL = 'https://edge.microsoft.com/translate/auth';
const TRANSLATE_URL = 'https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0';

// 渲染层语言列表用 zh-CN/zh-TW,微软 v3 接口要 zh-Hans/zh-Hant;其余码原样透传。
const LANG_MAP: Record<string, string> = {
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
};
const mapLang = (code: string) => LANG_MAP[code] || code;

// 微软单请求硬上限:≤100 条、≤50000 字符。这里留余量按 ≤40k 切块。
const MAX_BATCH_ITEMS = 100;
const MAX_BATCH_CHARS = 40000;
const MAX_SINGLE_TEXT = 45000; // 单条超此长度直接丢弃

let cachedBootstrap = '';

export const getMsTranslateBootstrap = () => {
  if (cachedBootstrap) return cachedBootstrap;
  const scriptPath = join(app.getAppPath(), 'static', 'scripts', 'ms-translate.js');
  try {
    cachedBootstrap = readFileSync(scriptPath, 'utf8');
  } catch (error) {
    console.log('[ms-translate] !! failed to read bootstrap', scriptPath, error);
    return '';
  }
  return cachedBootstrap;
};

type ExecuteTarget = Pick<Electron.WebContents, 'isDestroyed' | 'getURL' | 'executeJavaScript'> & {
  mainFrame?: {
    executeJavaScript?: (code: string, userGesture?: boolean) => Promise<any>;
  };
};

// chrome-extension:// 顶层页在部分 Electron 沙箱路径下,webContents 级 executeJavaScript
// 会卡死/失败;此时改走 mainFrame.executeJavaScript。普通网页仍优先沿用原路径。
const executeInTopPage = async (
  target: ExecuteTarget,
  code: string,
  userGesture = true,
): Promise<any> => {
  if (!target || target.isDestroyed()) return undefined;

  const url = (() => {
    try {
      return target.getURL() || '';
    } catch {
      return '';
    }
  })();

  const useMainFrame = /^chrome-extension:\/\//i.test(url);
  const mainFrameExec = target.mainFrame?.executeJavaScript;

  if (useMainFrame && typeof mainFrameExec === 'function') {
    return mainFrameExec.call(target.mainFrame, code, userGesture);
  }

  try {
    return await target.executeJavaScript(code, userGesture);
  } catch (error) {
    if (typeof mainFrameExec === 'function') {
      return mainFrameExec.call(target.mainFrame, code, userGesture);
    }
    throw error;
  }
};

// ---- token 缓存(本地维护有效期)----
interface TokenCache {
  token: string;
  exp: number; // unix 秒
}
let tokenCache: TokenCache = {token: '', exp: 0};

// 解析 JWT payload 的 exp(unix 秒);失败返回 0(由调用方兜底 now+8min)。
const decodeJwtExp = (jwt: string): number => {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return 0;
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as {exp?: number};
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch (e) {
    return 0;
  }
};

const getMsToken = async (): Promise<string> => {
  const now = (Date.now() / 1000) | 0;
  // 留 60s 安全余量,避免用到一半过期。
  if (tokenCache.token && tokenCache.exp - now > 60) return tokenCache.token;
  const res = await fetch(TOKEN_URL, {method: 'GET'});
  if (!res.ok) {
    throw new Error(`[ms-translate] token fetch failed: ${res.status}`);
  }
  const token = (await res.text()).trim();
  if (!token) throw new Error('[ms-translate] empty token');
  const exp = decodeJwtExp(token) || now + 8 * 60;
  tokenCache = {token, exp};
  console.log(`[ms-translate] token refreshed, valid ${Math.max(0, exp - now)}s`);
  return token;
};

// 按"≤100 条 / ≤40k 字符"切块;单条 >45k 字符丢弃(超微软单请求限制)。
const chunkTexts = (texts: string[]): string[][] => {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let curChars = 0;
  for (const t of texts) {
    if (t.length > MAX_SINGLE_TEXT) continue;
    if (cur.length >= MAX_BATCH_ITEMS || (cur.length > 0 && curChars + t.length > MAX_BATCH_CHARS)) {
      chunks.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(t);
    curChars += t.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
};

// 单批翻译:返回与 batch 对齐的译文;某条无译文则回退该条原文。
const translateBatch = async (batch: string[], toLang: string): Promise<string[]> => {
  const body = JSON.stringify(batch.map((t) => ({Text: t})));
  const doRequest = async (token: string) =>
    fetch(`${TRANSLATE_URL}&to=${encodeURIComponent(toLang)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body,
    });

  let token = await getMsToken();
  let res = await doRequest(token);
  // 401/403:token 失效,作废缓存重取一次。
  if (res.status === 401 || res.status === 403) {
    console.log(`[ms-translate] token rejected (${res.status}), refreshing and retrying`);
    tokenCache = {token: '', exp: 0};
    token = await getMsToken();
    res = await doRequest(token);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`[ms-translate] translate failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as Array<{
    translations?: Array<{text?: string}>;
  }>;
  return batch.map((_, i) => {
    const item = data[i];
    const t = item?.translations?.[0]?.text;
    return typeof t === 'string' ? t : batch[i];
  });
};

// ---- 主进程驱动 ----
export const runMsTranslate = async (
  wc: Electron.WebContents,
  target: string,
  isCancelled: () => boolean,
): Promise<{ok: boolean; count: number}> => {
  if (!wc || wc.isDestroyed()) return {ok: false, count: 0};
  const bootstrap = getMsTranslateBootstrap();
  if (!bootstrap) return {ok: false, count: 0};

  const exec = async (code: string): Promise<any> => {
    if (wc.isDestroyed() || isCancelled()) return undefined;
    try {
      return await executeInTopPage(wc, code, true);
    } catch (e) {
      console.log('[ms-translate] exec failed', e);
      return undefined;
    }
  };

  // 1) 注入引导(重置 window.__rainseeTranslate,清空 reg)
  await exec(bootstrap);
  if (isCancelled()) return {ok: false, count: 0};

  // 2) 收集文本节点
  const json = await exec('window.__rainseeTranslate && window.__rainseeTranslate.collect()');
  if (!json) return {ok: false, count: 0};
  let items: Array<{id: number; text: string}> = [];
  try {
    items = JSON.parse(json) || [];
  } catch (e) {
    console.log('[ms-translate] collect parse failed', e);
    return {ok: false, count: 0};
  }
  if (!items.length) return {ok: true, count: 0};

  // 3) 分批翻译并逐批回填(渐进式显示,大页体感更快)。
  //    collect 已给每个待译元素挂上转圈;apply 回填时摘圈,失败用 clear 摘圈。
  const toLang = mapLang(target);
  const chunks = chunkTexts(items.map((it) => it.text));
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (isCancelled()) return {ok: false, count: offset};
    const batch = chunks[i];
    const batchItems = items.slice(offset, offset + batch.length);
    let translated: string[];
    try {
      translated = await translateBatch(batch, toLang);
      console.log(`[ms-translate] batch ${i + 1}/${chunks.length}: ${batch.length} ok`);
    } catch (e) {
      console.log(`[ms-translate] batch ${i + 1}/${chunks.length} failed, skipping`, e);
      // 失败:保持原文,摘掉这批元素的转圈,避免永久转圈。
      await exec(
        `window.__rainseeTranslate && window.__rainseeTranslate.clear(${JSON.stringify(batchItems.map((it) => it.id))})`,
      );
      offset += batch.length;
      continue;
    }
    if (isCancelled()) return {ok: false, count: offset};
    const map: Record<number, string> = {};
    batchItems.forEach((it, j) => {
      map[it.id] = translated[j] ?? it.text;
    });
    await exec(`window.__rainseeTranslate && window.__rainseeTranslate.apply(${JSON.stringify(map)})`);
    offset += batch.length;
  }

  return {ok: true, count: offset};
};

// 单句翻译(划词):直接复用 translateBatch,内部已处理 token 刷新/重试。
// 输入为渲染层语言码(zh-CN/zh-TW/...),由 mapLang 映射为微软接口码。
// 超长文本按 MAX_SINGLE_TEXT(45000) 截断,避免整条被 chunkTexts 丢弃。
export const translateText = async (text: string, toLang: string): Promise<string> => {
  const trimmed = (text || '').slice(0, MAX_SINGLE_TEXT);
  if (!trimmed) return '';
  const out = await translateBatch([trimmed], mapLang(toLang));
  return out[0] ?? trimmed;
};

// 原地还原:把文本节点改回原文并移除状态条(不 reload)。
export const revertMsTranslate = async (wc: Electron.WebContents): Promise<void> => {
  if (!wc || wc.isDestroyed()) return;
  try {
    await executeInTopPage(
      wc,
      'window.__rainseeTranslate && window.__rainseeTranslate.revert()',
      true,
    );
  } catch (e) {
    console.log('[ms-translate] revert failed', e);
  }
};

// 取语言主语种子,如 'zh-CN' → 'zh','en-US' → 'en'。
const primarySubtag = (tag: string) => {
  const t = (tag || '').trim().toLowerCase();
  if (!t) {
    return '';
  }

  return t.split('-')[0] || '';
};

const DETECT_CODE = `(function(){var r='';var h=document.documentElement;if(h){r=(h.getAttribute('lang')||'').trim();}if(!r){var m=document.querySelector('meta[http-equiv="content-language" i]')||document.querySelector('meta[name="language" i]');if(m){r=(m.getAttribute('content')||'').trim().split(',')[0];}}var s='';try{if(document.body){s=(document.body.innerText||'').slice(0,1500);}}catch(e){}return JSON.stringify({lang:r,sample:s});})()`;

// 检测页面语言,判断是否需要翻译(页面语言主语种子 ≠ App 语言主语种子)。
// App 通过 --lang=zh-CN 强制 UI 语言(application.ts),app.getLocale() 取之。
export const detectTranslateState = async (
  webContents: Electron.WebContents,
): Promise<{canTranslate: boolean; lang: string}> => {
  if (!webContents || webContents.isDestroyed()) {
    return {canTranslate: false, lang: ''};
  }

  const targetPrimary = primarySubtag(app.getLocale()) || 'zh';

  let pageLang = '';
  let sample = '';
  try {
    const raw = await executeInTopPage(webContents, DETECT_CODE, true);
    const parsed = JSON.parse(raw || '{}') as {lang?: string; sample?: string};
    pageLang = parsed.lang || '';
    sample = parsed.sample || '';
  } catch (error) {
    return {canTranslate: false, lang: ''};
  }

  let primary = primarySubtag(pageLang);

  // 无显式 lang 时,按正文文本嗅探:含汉字 → 中文;含拉丁字母 → 视为外语;
  // 都没有(纯符号/空) → 未知,不提示翻译。
  if (!primary) {
    if (/[一-鿿㐀-䶿]/.test(sample)) {
      primary = 'zh';
    } else if (/[A-Za-z]/.test(sample)) {
      primary = 'en';
    }
  }

  if (!primary) {
    return {canTranslate: false, lang: ''};
  }

  return {
    canTranslate: primary !== targetPrimary,
    lang: primary,
  };
};
