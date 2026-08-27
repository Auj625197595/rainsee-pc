// 翻译引擎抽象。把"微软专属"收敛到一个实现,网页翻译(runTranslate)与划词翻译
// (translateText)共用同一引擎设置(见 registry.getActiveEngine)。页面侧引导
// static/scripts/ms-translate.js 的 collect/apply/revert 是引擎无关的,只有本接口
// 的 translateBatch/mapLang 随引擎变化。
//
// 设计约定:
//  - translateBatch 返回与输入下标严格对齐的译文数组;逐条失败时该条回退原文,
//    不抛(整页 runTranslate 靠 apply 回填 + clear 摘圈,半数失败不应杀整批)。
//  - 仅引擎级错误(鉴权/网络/限额)抛 Error,文案为中文(划词卡片直接显示)。
//  - signal 用于切换引擎/语言时中止在途 fetch,省 token(view.ts translateAbort)。

export type EngineId = 'microsoft' | 'rainsee-llm' | 'custom-llm';

// 页面语境(可选):供 LLM 引擎消歧(如 "Apple" 在科技站 vs 水果站译法不同)。
// 微软引擎忽略;雨见/自定义 LLM 带入 prompt。title/描述来自页面 document.title +
// meta description,长度由调用方裁剪。
export interface TranslateContext {
  title?: string;
  description?: string;
}

export interface TranslateEngine {
  readonly id: EngineId;
  /** 用于区分页内缓存。配置变化而可能影响译文时必须变化，且不得包含密钥。 */
  cacheKey(): string;
  /** 批量翻译,返回与 batch 下标对齐的译文。signal 中止在途请求;context 供 LLM 消歧。 */
  translateBatch(
    batch: string[],
    toLang: string,
    signal?: AbortSignal,
    context?: TranslateContext,
  ): Promise<string[]>;
  /** 渲染层语言码 → 引擎后端码。微软:zh-CN→zh-Hans;LLM:透传(语言名进 prompt)。 */
  mapLang(code: string): string;
  /** 整页翻译的分批上限(条数 / 字符数)。 */
  chunkSize(): {items: number; chars: number};
  /** 单条文本最大字符数。 */
  maxSingleTextChars(): number;
  /** true=单条超 maxSingle 直接丢弃(微软原行为);false=截断(LLM,得前部分译文)。 */
  dropOversized(): boolean;
}

// 通用切块:按引擎的 items/chars 上限切;单条超 maxSingle 按引擎策略丢弃或截断。
export const chunkTexts = (
  texts: string[],
  engine: TranslateEngine,
): string[][] => {
  const {items: maxItems, chars: maxChars} = engine.chunkSize();
  const maxSingle = engine.maxSingleTextChars();
  const drop = engine.dropOversized();
  const chunks: string[][] = [];
  let cur: string[] = [];
  let curChars = 0;
  for (const raw of texts) {
    const t = raw.length > maxSingle ? (drop ? '' : raw.slice(0, maxSingle)) : raw;
    if (!t) continue; // drop 策略下超长条直接跳过(与微软原实现一致)
    if (cur.length >= maxItems || (cur.length > 0 && curChars + t.length > maxChars)) {
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
