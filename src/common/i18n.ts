/**
 * Application UI language primitives.
 *
 * Keep this module free of Electron/React imports so it can be shared by the
 * main process, preload scripts and every WebUI bundle. Message catalogs live
 * in ./locales/<locale>.json so adding a language never grows this file:
 * register the locale in APP_LANGUAGES, import its JSON in MESSAGES below and
 * translate a copy of zh-CN.json (keep it key-complete — the Record type
 * enforces it at compile time).
 */
// 这两个 import 仅作类型标注(emit 时被省略)。tsconfig 未开 esModuleInterop,
// default import 会被编成 require('./x.json').default,而 webpack 的 json module
// 只有 module.exports(无 .default),CJS 产物里取到 undefined。运行时值统一用
// require 拿整个 exports 对象;主进程 esnext 产物下 webpack 对 harmony default
// 本就归一到整个对象,两条路径一致。
import zhCNTypes from './locales/zh-CN.json';
import enUSTypes from './locales/en-US.json';

const zhCN: typeof zhCNTypes = require('./locales/zh-CN.json');
const enUS: typeof enUSTypes = require('./locales/en-US.json');

export type AppLanguage = 'auto' | 'zh-CN' | 'en-US';
export type ResolvedAppLanguage = Exclude<AppLanguage, 'auto'>;

export interface AppLanguageOption {
  value: AppLanguage;
  label: string;
  nativeLabel: string;
}

export const APP_LANGUAGES: readonly AppLanguageOption[] = [
  { value: 'auto', label: '跟随系统', nativeLabel: 'System default' },
  { value: 'zh-CN', label: '简体中文', nativeLabel: 'Simplified Chinese' },
  { value: 'en-US', label: 'English', nativeLabel: 'English' },
];

export const normalizeAppLanguage = (value: unknown): AppLanguage => {
  if (typeof value !== 'string') return 'auto';
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'auto' || normalized === 'system') return 'auto';
  if (normalized === 'zh' || normalized === 'zh-cn') return 'zh-CN';
  if (normalized === 'en' || normalized === 'en-us') return 'en-US';
  return 'auto';
};

/** Normalize browser/OS locale to one of the currently shipped catalogs. */
export const resolveAppLanguage = (
  preference: unknown,
  systemLocale?: string,
): ResolvedAppLanguage => {
  const selected = normalizeAppLanguage(preference);
  if (selected !== 'auto') return selected;
  const locale = String(systemLocale || '').toLowerCase();
  return locale === 'zh' || locale.startsWith('zh-') || locale.startsWith('zh_')
    ? 'zh-CN'
    : 'en-US';
};

// 消息 key 由 zh-CN 目录(回退基准)推导,调用点 t('key') 仍有类型约束。
export type MessageKey = keyof typeof zhCN & string;

const MESSAGES: Record<ResolvedAppLanguage, Record<MessageKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

// 动态文本用 {token} 占位符参数化(见 docs/internationalization.md;
// 后续可接入 ICU MessageFormat)。缺失 key 回退简体中文,再回退 key 本身。
export const createTranslator =
  (language: ResolvedAppLanguage) =>
  (key: MessageKey, params?: Record<string, string | number>): string => {
    let text = MESSAGES[language][key] || MESSAGES['zh-CN'][key] || key;
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.split(`{${name}}`).join(String(value));
      }
    }
    return text;
  };

export type Translator = ReturnType<typeof createTranslator>;

// 便捷入口:传入语言偏好(auto/zh-CN/en-US)即得该语言的翻译器。auto 时以
// navigator.language 兜底系统语言(主进程创建渲染器前已设 --lang,两者一致;
// 主进程无 navigator,已守卫)。各 WebUI/页面组件用它替代散落的语言判断。
export const createLocaleTranslator = (preference: unknown): Translator =>
  createTranslator(
    resolveAppLanguage(
      preference,
      typeof navigator === 'undefined' ? undefined : navigator.language,
    ),
  );
