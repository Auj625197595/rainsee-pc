// 引擎注册表。按当前设置返回活动的翻译引擎(网页翻译 + 划词翻译共用同一引擎设置)。
// 微软为无状态单例;自定义引擎按当前 customLlmConfig 构造(config 可运行时变)。

import {Application} from '../../application';
import {TranslateEngine} from './engine';
import {MicrosoftEngine} from './microsoft';
import {CustomLlmEngine, CustomLlmConfig} from './custom-llm';

const msEngine = new MicrosoftEngine();

export const getActiveEngine = (): TranslateEngine => {
  const s = Application.instance?.settings?.object;
  if (!s) {
    console.log('[translate] registry | settings 未就绪,回退微软');
    return msEngine;
  }
  let engine: TranslateEngine;
  switch (s.translateEngine) {
    case 'custom-llm':
      engine = new CustomLlmEngine(
        (s.customLlmConfig as CustomLlmConfig) || {
          baseUrl: '',
          apiKey: '',
          model: 'gpt-4o-mini',
          apiType: 'chat',
        },
      );
      break;
    default:
      engine = msEngine;
  }
  console.log(`[translate] registry | setting=${s.translateEngine} → engine=${engine.id}`);
  return engine;
};
