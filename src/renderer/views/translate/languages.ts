// 翻译目标语言(与安卓 includedLanguages 对齐,取常用若干)。
//
// 独立叶子模块:故意没有任何 import。设置页等"不能拉入 translate/store"
// 的入口从这里取值即可——translate/store 经 dialog-store 引入 @electron/remote,
// 而 settings 在 nodeIntegration:false 的 BrowserView 里运行,加载它会导致
// `process is not defined`(@electron/remote/renderer 顶部访问 process.type)。
export const LANGUAGES: {code: string; label: string}[] = [
  {code: 'zh-CN', label: '简体中文'},
  {code: 'zh-TW', label: '繁體中文'},
  {code: 'en', label: 'English'},
  {code: 'ja', label: '日本語'},
  {code: 'ko', label: '한국어'},
  {code: 'fr', label: 'Français'},
  {code: 'de', label: 'Deutsch'},
  {code: 'es', label: 'Español'},
  {code: 'ru', label: 'Русский'},
  {code: 'it', label: 'Italiano'},
  {code: 'pt', label: 'Português'},
  {code: 'ar', label: 'العربية'},
  {code: 'th', label: 'ไทย'},
  {code: 'vi', label: 'Tiếng Việt'},
];
