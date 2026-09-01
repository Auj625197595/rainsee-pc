import {
  getRendererTranslator,
} from '~/renderer/components/I18n';
import type { Translator } from '~/common/i18n';

// 类组件、菜单回调等非 Hook 调用的兼容入口。实际语言和翻译器由根节点的
// I18nProvider 统一维护,函数组件应直接使用 useI18n。
export const getShellTranslator = (): Translator =>
  getRendererTranslator();
