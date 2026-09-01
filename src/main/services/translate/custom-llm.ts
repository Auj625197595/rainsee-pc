// 自定义大模型翻译引擎。用户自配 OpenAI 兼容端点。
// 支持两种 API:chat(/v1/chat/completions) 与 responses(/v1/responses)。
// baseUrl 规范化后拼路径;apiKey 明文落 settings.json(与 customChromeCss/downloaderArgs 一致)。

import {TranslateEngine, TranslateContext} from './engine';
import {ApiType, LlmCallOpts, translateLlmBatch} from './llm-shared';
import {Application} from '../../application';
import {getMainTranslator} from '../../i18n';

export interface CustomLlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiType: 'chat' | 'responses';
  systemPrompt?: string;
}

// baseUrl 规范化:去尾斜杠;末尾无 /v\d 则补 /v1。返回不带尾斜杠的 base。
export const normalizeBaseUrl = (b: string): string => {
  let s = (b || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/\/v\d+$/.test(s)) s += '/v1';
  return s;
};

const buildEndpoint = (base: string, apiType: ApiType): string =>
  `${base}/${apiType === 'responses' ? 'responses' : 'chat/completions'}`;

export class CustomLlmEngine implements TranslateEngine {
  readonly id = 'custom-llm' as const;

  constructor(private readonly config: CustomLlmConfig) {}

  mapLang(code: string) {
    return code;
  }

  cacheKey() {
    // API key 不参与缓存键，避免将密钥写入内存缓存键或日志。
    return JSON.stringify([
      this.id,
      normalizeBaseUrl(this.config.baseUrl),
      this.config.apiType === 'responses' ? 'responses' : 'chat',
      this.config.model || 'gpt-4o-mini',
      this.config.systemPrompt || '',
    ]);
  }

  chunkSize() {
    return {items: 15, chars: 6000};
  }

  maxSingleTextChars() {
    return 8000;
  }

  dropOversized() {
    return false;
  }

  private callOpts(): LlmCallOpts {
    const base = normalizeBaseUrl(this.config.baseUrl);
    const apiType = (this.config.apiType === 'responses' ? 'responses' : 'chat') as ApiType;
    return {
      url: buildEndpoint(base, apiType),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey || ''}`,
      },
      model: this.config.model || 'gpt-4o-mini',
      apiType,
      systemPrompt: this.config.systemPrompt || undefined,
    };
  }

  async translateBatch(
    batch: string[],
    toLang: string,
    signal?: AbortSignal,
    context?: TranslateContext,
  ): Promise<string[]> {
    if (!this.config.baseUrl || !this.config.apiKey) {
      throw new Error(
        getMainTranslator(Application.instance?.settings?.object?.language)(
          'trCustomLlmMissingConfig',
        ),
      );
    }
    return translateLlmBatch(this.callOpts(), batch, toLang, signal, context);
  }
}
