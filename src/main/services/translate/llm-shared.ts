// LLM 翻译共享件:雨见 LLM 与自定义 LLM 共用。
//  - prompt 构造(要求模型输出与输入等长同序的 JSON 字符串数组)
//  - 防御性解析(剥围栏/去前后噪声/对象转数组/长度校验/类型强制)
//  - chat completions 与 responses 两种 API 的请求 caller + 统一文本抽取
//  - AbortController 超时(沿用原生 fetch,见 memory cross-fetch-gunzip-premature-close)
//
// 关键:两种 API 最终都抽成一个字符串(JSON 数组字面量),再喂同一个 parseTranslationArray,
// 故解析逻辑只有一份。temperature:0 对齐下标确定性;部分网关拒收 temperature,400 时去重试。

export type ApiType = 'chat' | 'responses';

// 渲染层语言码 → 人类可读语言名(进 prompt)。未命中退化为码本身。
const LANG_NAMES: Record<string, string> = {
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  ru: 'Russian',
  it: 'Italian',
  pt: 'Portuguese',
  ar: 'Arabic',
  th: 'Thai',
  vi: 'Vietnamese',
};

export const langName = (code: string) => LANG_NAMES[code] || code || 'Simplified Chinese';

// 翻译 prompt(单条 user 消息)。要求模型输出 JSON 对象 {"translations":[...]}(配合
// json_object 模式,chat completions 强制合法 JSON)。context(可选)提供页面语境消歧。
export const buildTranslatePrompt = (
  batch: string[],
  targetCode: string,
  context?: {title?: string; description?: string},
): string => {
  const name = langName(targetCode);
  const title = (context?.title || '').trim();
  const desc = (context?.description || '').trim();
  const ctxBlock =
    title || desc
      ? `\nPage context (for disambiguation only, do not translate or output):` +
        (title ? `\nTitle: ${title}` : '') +
        (desc ? `\nDescription: ${desc}` : '')
      : '';
  return `You are a professional translation engine. Translate each input text into ${name} (${targetCode}).
Rules:
1. Output ONLY a JSON object of the form {"translations": ["...", "..."]} where the array has the SAME LENGTH and SAME ORDER as the input.
2. Translate each element independently. Never merge, split, or reorder elements.
3. Preserve placeholders like {0}, %s, <br>, &amp;, HTML entities, URLs, and code spans verbatim.
4. Do NOT translate numbers, dates, version strings, punctuation/symbol-only text, code snippets, URLs, or identifiers (variable/function names) — return them unchanged. Only translate natural-language text.
5. Use the page context (if provided) ONLY to disambiguate ambiguous terms. Do NOT translate or output the context.
6. Do NOT add explanations, headings, or markdown code fences.${ctxBlock}

Input (${batch.length} items):
${JSON.stringify(batch)}
`;
};

// 防御性解析模型输出为字符串数组。失败返回 null(调用方降级逐条)。
// 兼容三种形态(json_object 模式下应是 #1,网关/部分 responses 端点不强制则兜底 #2/#3):
//  #1 {"translations": ["a","b"]}  ← 期望形态(json_object 模式)
//  #2 ["a","b"]                     ← 裸数组
//  #3 {"0":"a","1":"b"}             ← 数字键对象
// 流程:剥 markdown 围栏 → 优先切 {...} 解析,退化切 [...] → 取 translations 键或数字键升序
//      → 长度校验 → 类型强制。
export const parseTranslationArray = (raw: string, expectedLen: number): string[] | null => {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();

  // 剥 markdown 围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // 优先解析对象形式(json_object 模式);退化到数组形式。
  let parsed: unknown = null;
  const objFirst = s.indexOf('{');
  const objLast = s.lastIndexOf('}');
  if (objFirst !== -1 && objLast !== -1 && objLast > objFirst) {
    try {
      const c = JSON.parse(s.slice(objFirst, objLast + 1));
      if (c && typeof c === 'object') parsed = c;
    } catch {
      // 落到数组形式
    }
  }
  if (parsed === null) {
    const arrFirst = s.indexOf('[');
    const arrLast = s.lastIndexOf(']');
    if (arrFirst === -1 || arrLast === -1 || arrLast <= arrFirst) return null;
    try {
      parsed = JSON.parse(s.slice(arrFirst, arrLast + 1));
    } catch {
      return null;
    }
  }

  let arr: unknown[];
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    // #1 translations 键
    if (Array.isArray(obj.translations)) {
      arr = obj.translations;
    } else {
      // #3 {"0":..,"1":..} 数字键升序
      const entries = Object.entries(obj)
        .map(([k, v]) => [Number(k), v] as [number, unknown])
        .filter(([k]) => Number.isFinite(k))
        .sort((a, b) => a[0] - b[0]);
      arr = entries.map(([, v]) => v);
    }
  } else {
    return null;
  }

  if (arr.length !== expectedLen) return null;
  return arr.map((v) => (typeof v === 'string' ? v : ''));
};

// 从两种 API 的响应里抽出模型输出的文本字符串(应是 JSON 数组字面量)。
export const extractLLMText = (json: any, apiType: ApiType): string => {
  if (!json || typeof json !== 'object') return '';
  try {
    if (apiType === 'responses') {
      // responses:优先 output_text 便捷字段,否则遍历 output[].content[]
      if (typeof json.output_text === 'string' && json.output_text) return json.output_text;
      const out = Array.isArray(json.output) ? json.output : [];
      const parts: string[] = [];
      for (const block of out) {
        const contents = block?.content;
        if (Array.isArray(contents)) {
          for (const c of contents) {
            if (typeof c?.text === 'string') parts.push(c.text);
          }
        }
      }
      return parts.join('');
    }
    // chat completions:content 可能是 string 或 [{type:'text',text}]
    const content = json.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
        .join('');
    }
    return '';
  } catch {
    return '';
  }
};

// 组合外部 signal(切换引擎/语言时取消在途)与本地超时,任一触发即 abort。
const withTimeout = (external: AbortSignal | undefined, ms: number) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  if (external) {
    if (external.aborted) ctrl.abort();
    else external.addEventListener('abort', () => ctrl.abort(), {once: true});
  }
  return {
    signal: ctrl.signal,
    clear: () => clearTimeout(timer),
  };
};

const LLM_TIMEOUT_MS = 30000; // LLM 比微软慢,batch≈15 条时给 30s

export interface ChatRequestOpts {
  url: string;
  headers: Record<string, string>;
  model: string;
  prompt: string;
  systemPrompt?: string;
  signal?: AbortSignal;
}

// chat completions caller。加 response_format: json_object + temperature:0 强制合法、
// 确定性 JSON。部分自配网关不认 response_format 或 temperature:0 会返回 400,故 400 时
// 退到最小 body(两者都去掉)重试一次,靠防御解析兜底(解析器兼容对象/裸数组/数字键)。
export const requestChatCompletions = async (
  opts: ChatRequestOpts,
): Promise<any> => {
  const messages = [
    ...(opts.systemPrompt ? [{role: 'system', content: opts.systemPrompt}] : []),
    {role: 'user', content: [{type: 'text', text: opts.prompt}]},
  ];
  // 最小 body:仅 OpenAI 必需字段,任何网关都应接受。
  const minimalBody: Record<string, unknown> = {
    model: opts.model,
    stream: false,
    messages,
  };
  // 完整 body:加 response_format(强制 JSON)+ temperature:0(对齐下标)。
  const fullBody: Record<string, unknown> = {
    ...minimalBody,
    response_format: {type: 'json_object'},
    temperature: 0,
  };

  const {signal, clear} = withTimeout(opts.signal, LLM_TIMEOUT_MS);
  try {
    let res = await fetch(opts.url, {
      method: 'POST',
      headers: opts.headers,
      body: JSON.stringify(fullBody),
      signal,
    });
    if (res.status === 400) {
      // 400 多为网关不认 response_format 或 temperature:0,退到最小 body 重试。
      const ctrl2 = new AbortController();
      const t2 = setTimeout(() => ctrl2.abort(), LLM_TIMEOUT_MS);
      if (opts.signal?.aborted) ctrl2.abort();
      else opts.signal?.addEventListener('abort', () => ctrl2.abort(), {once: true});
      try {
        res = await fetch(opts.url, {
          method: 'POST',
          headers: opts.headers,
          body: JSON.stringify(minimalBody),
          signal: ctrl2.signal,
        });
      } finally {
        clearTimeout(t2);
      }
    }
    return await parseResponse(res);
  } finally {
    clear();
  }
};

// responses caller(/v1/responses)。systemPrompt 走 instructions;content type=input_text。
export const requestResponses = async (opts: ChatRequestOpts): Promise<any> => {
  const baseBody: Record<string, unknown> = {
    model: opts.model,
    stream: false,
    input: [
      {role: 'user', content: [{type: 'input_text', text: opts.prompt}]},
    ],
    ...(opts.systemPrompt ? {instructions: opts.systemPrompt} : {}),
  };

  const {signal, clear} = withTimeout(opts.signal, LLM_TIMEOUT_MS);
  try {
    let res = await fetch(opts.url, {
      method: 'POST',
      headers: opts.headers,
      body: JSON.stringify({...baseBody, temperature: 0}),
      signal,
    });
    if (res.status === 400) {
      // 部分网关不认 temperature:0,去重试(无 temperature)
      const ctrl2 = new AbortController();
      const t2 = setTimeout(() => ctrl2.abort(), LLM_TIMEOUT_MS);
      if (opts.signal?.aborted) ctrl2.abort();
      else opts.signal?.addEventListener('abort', () => ctrl2.abort(), {once: true});
      try {
        res = await fetch(opts.url, {
          method: 'POST',
          headers: opts.headers,
          body: JSON.stringify(baseBody),
          signal: ctrl2.signal,
        });
      } finally {
        clearTimeout(t2);
      }
    }
    return await parseResponse(res);
  } finally {
    clear();
  }
};

// 统一响应解析:把 HTTP 状态翻译成中文错误(划词卡片直接显示),非 2xx 抛。
export const parseResponse = async (res: Response): Promise<any> => {
  if (res.status === 402) throw new Error('雨见翻译额度不足,请登录或升级会员');
  if (res.status === 401 || res.status === 403)
    throw new Error('翻译服务鉴权失败,请重新登录');
  if (res.status === 429) throw new Error('翻译请求过于频繁,请稍后再试');
  if (res.status === 408 || res.status === 580)
    throw new Error('翻译请求超时,请重试');
  if (res.status >= 500) throw new Error('翻译服务暂时不可用,请稍后再试');
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`翻译服务返回 ${res.status} ${detail.slice(0, 160)}`);
  }
  return await res.json();
};

// 把 AbortError(超时/外部取消)翻译成中文。fetch abort 抛 DOMException 'AbortError'。
export const isAbortError = (e: unknown): boolean => {
  const name = (e as {name?: string})?.name;
  return name === 'AbortError';
};

export interface LlmCallOpts {
  url: string;
  headers: Record<string, string>;
  model: string;
  apiType: ApiType;
  systemPrompt?: string;
}

// 单批 LLM 翻译一次(无回退),返回与 batch 对齐的译文,失败抛。
const translateLlmOnce = async (
  opts: LlmCallOpts,
  batch: string[],
  toLang: string,
  signal?: AbortSignal,
  context?: {title?: string; description?: string},
): Promise<string[]> => {
  const prompt = buildTranslatePrompt(batch, toLang, context);
  const callOpts = {...opts, prompt, signal};
  const json =
    opts.apiType === 'responses'
      ? await requestResponses(callOpts)
      : await requestChatCompletions(callOpts);
  const text = extractLLMText(json, opts.apiType);
  const arr = parseTranslationArray(text, batch.length);
  if (!arr) {
    throw new Error('翻译结果解析失败,请重试');
  }
  // empty/非 string 槽位回退原文(parseTranslationArray 已把非 string 置 '')
  return arr.map((t, i) => t || batch[i]);
};

// LLM 批量翻译主入口(自定义 LLM 用;雨见走网关、服务端二分)。
// 正常路径:整批一次成 → 1 次调用。
// 回退路径(整批解析失败/瞬时网络错):二分递归 → 对半拆各自重试 → 再失败再拆,直到单条。
//  - 接口次数大降:15 条整批失败,只要 8+7 各自能成则仅 2 次(逐条则 15 次"一个词一次")。
//  - 精度:更小批次模型聚焦更好,JSON 数组对齐漂移更少。
//  - 单条仍失败回原文(不杀整批);划词(batch.len===1)直接抛走 .rst-error。
//  - 取消(abort)、限额(402/429)、鉴权(401/403)等不二分,直接抛(子区间也是同样错)。
export const translateLlmBatch = async (
  opts: LlmCallOpts,
  batch: string[],
  toLang: string,
  signal?: AbortSignal,
  context?: {title?: string; description?: string},
): Promise<string[]> => {
  if (!batch.length) return [];

  // 划词(单条):失败直接抛,不吞错。
  if (batch.length === 1) {
    return await translateLlmOnce(opts, batch, toLang, signal, context);
  }

  // 整页:二分递归翻译 batch[start:end)。
  const translateRange = async (start: number, end: number): Promise<string[]> => {
    const items = batch.slice(start, end);
    try {
      return await translateLlmOnce(opts, items, toLang, signal, context);
    } catch (e) {
      if (isAbortError(e)) throw e;
      const msg = String((e as Error)?.message || e);
      if (/额度|会员|频繁|鉴权|超时/.test(msg)) throw e;
      if (end - start <= 1) {
        return items.slice(); // 单条失败回原文
      }
      const mid = start + Math.ceil((end - start) / 2);
      const [left, right] = await Promise.all([
        translateRange(start, mid),
        translateRange(mid, end),
      ]);
      return [...left, ...right];
    }
  };

  try {
    return await translateRange(0, batch.length);
  } catch (e) {
    // 限额/鉴权/取消类冒泡到此:整批抛给上层(整页 runTranslate clear 保原文,划词已在上面的单条路径处理)
    console.log('[llm-translate] batch gave up', String((e as Error)?.message || e));
    throw e;
  }
};

