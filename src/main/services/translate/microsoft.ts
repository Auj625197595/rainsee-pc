// 微软免费翻译引擎(Edge 内部 key-less 接口,沉浸式翻译同款)。
// 主进程本地缓存 JWT token(GET edge.microsoft.com/translate/auth,~10min 有效),
// 过期前 60s 刷新;401/403 作废重取一次。单请求硬上限 ≤100 条 / ≤50000 字符,
// 这里留余量按 ≤40k 切块;单条 >45000 字符在切块阶段直接丢弃(超微软单请求限制)。
//
// 从 services/translate.ts 原迁入,逻辑保持一致(仅从自由函数改为 TranslateEngine 实现)。

import {TranslateEngine, TranslateContext} from './engine';

const TOKEN_URL = 'https://edge.microsoft.com/translate/auth';
const TRANSLATE_URL = 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0';

// 渲染层语言列表用 zh-CN/zh-TW,微软 v3 接口要 zh-Hans/zh-Hant;其余码原样透传。
const LANG_MAP: Record<string, string> = {
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
};

const MAX_BATCH_ITEMS = 100;
const MAX_BATCH_CHARS = 40000;
const MAX_SINGLE_TEXT = 45000;

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

const getMsToken = async (signal?: AbortSignal): Promise<string> => {
  const now = (Date.now() / 1000) | 0;
  // 留 60s 安全余量,避免用到一半过期。
  if (tokenCache.token && tokenCache.exp - now > 60) return tokenCache.token;
  const res = await fetch(TOKEN_URL, {method: 'GET', signal});
  if (!res.ok) {
    throw new Error(`微软翻译 token 获取失败: ${res.status}`);
  }
  const token = (await res.text()).trim();
  if (!token) throw new Error('微软翻译 token 为空');
  const exp = decodeJwtExp(token) || now + 8 * 60;
  tokenCache = {token, exp};
  console.log(`[ms-translate] token refreshed, valid ${Math.max(0, exp - now)}s`);
  return token;
};

export class MicrosoftEngine implements TranslateEngine {
  readonly id = 'microsoft' as const;

  mapLang(code: string) {
    return LANG_MAP[code] || code;
  }

  cacheKey() {
    return this.id;
  }

  chunkSize() {
    return {items: MAX_BATCH_ITEMS, chars: MAX_BATCH_CHARS};
  }

  maxSingleTextChars() {
    return MAX_SINGLE_TEXT;
  }

  dropOversized() {
    return true; // 单条 >45k 在切块阶段丢弃(超微软单请求限制)
  }

  async translateBatch(
    batch: string[],
    toLang: string,
    signal?: AbortSignal,
    _context?: TranslateContext,
  ): Promise<string[]> {
    if (!batch.length) return [];
    const body = JSON.stringify(batch.map((t) => ({Text: t})));
    const doRequest = async (token: string) =>
      fetch(`${TRANSLATE_URL}&to=${encodeURIComponent(toLang)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body,
        signal, // 切引擎/语言、"显示原文"时中断在途请求
      });

    let token = await getMsToken(signal);
    let res = await doRequest(token);
    // 401/403:token 失效,作废缓存重取一次。
    if (res.status === 401 || res.status === 403) {
      console.log(`[ms-translate] token rejected (${res.status}), refreshing and retrying`);
      tokenCache = {token: '', exp: 0};
      token = await getMsToken(signal);
      res = await doRequest(token);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`微软翻译失败: ${res.status} ${detail.slice(0, 200)}`);
    }
    const data = (await res.json()) as Array<{
      translations?: Array<{text?: string}>;
    }>;
    return batch.map((_, i) => {
      const item = data[i];
      const t = item?.translations?.[0]?.text;
      return typeof t === 'string' ? t : batch[i];
    });
  }
}
