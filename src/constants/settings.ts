import {
  ISettings,
  ISearchEngine,
  TabHoverActivationBehavior,
} from '~/interfaces';
import { getLightweightIconUrl } from '~/utils/favicon';

export const MIN_M3U8_DOWNLOAD_THREADS = 1;
export const MAX_M3U8_DOWNLOAD_THREADS = 32;
export const MIN_TAB_HOVER_ACTIVATION_DELAY = 0;
export const MAX_TAB_HOVER_ACTIVATION_DELAY = 5000;

export const normalizeTabHoverActivationDelay = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 500;
  return Math.max(
    MIN_TAB_HOVER_ACTIVATION_DELAY,
    Math.min(MAX_TAB_HOVER_ACTIVATION_DELAY, Math.round(parsed)),
  );
};

export const normalizeTabHoverActivationBehavior = (
  value: unknown,
): TabHoverActivationBehavior => {
  if (
    value === 'off' ||
    value === 'activate' ||
    value === 'activate-and-switch'
  ) {
    return value;
  }
  return 'activate-and-switch';
};

// NOTE: avoid a static `import { remote, app } from 'electron'`. webpack lowers
// that to a synchronous `require("electron")` (see the `externals` config), and
// this module is pulled into the shared `pre-entry` bundle that also runs in
// renderers with `nodeIntegration: false` (e.g. newtab), where `require` is not
// defined at module-eval time. Resolve lazily and guard instead.
const getDefaultDownloadsPath = (): string => {
  try {
    const electron =
      (globalThis as any).electron ?? (globalThis as any).require?.('electron');

    const app = electron?.remote?.app ?? electron?.app;

    if (app && typeof app.getPath === 'function') {
      return app.getPath('downloads');
    }
  } catch {
    // electron / app not available in this context
  }

  return '';
};

// 本地内置搜索引擎：开源版以本地内置为准。
// 数组顺序即默认顺序，百度排首位（searchEngine 默认 0）。
// icon 不在此硬编码，统一依据 url 生成轻量 favicon 地址。
export interface IRawSearchEngine {
  name: string;
  url: string;
  keyword: string;
  keywordsUrl?: string;
}

const RAW_SEARCH_ENGINES: IRawSearchEngine[] = [
  // —— 国内 ——
  { name: '百度', url: 'https://www.baidu.com/s?wd=%s', keyword: 'baidu.com' },
  // 秘塔:双引擎搜索默认副引擎(index 1)。移动端 UA 下呈现移动版结果页。
  { name: '秘塔', url: 'https://metaso.cn/?q=%s', keyword: 'metaso.cn' },
  {
    name: '搜狗',
    url: 'https://www.sogou.com/web?query=%s',
    keyword: 'sogou.com',
  },
  { name: '360搜索', url: 'https://www.so.com/s?q=%s', keyword: 'so.com' },
  { name: '夸克', url: 'https://quark.sm.cn/s?q=%s', keyword: 'quark.sm.cn' },
  { name: '神马搜索', url: 'https://m.sm.cn/s?q=%s', keyword: 'sm.cn' },
  {
    name: '头条搜索',
    url: 'https://so.toutiao.com/search?keyword=%s',
    keyword: 'toutiao.com',
  },
  {
    name: '必应（国内）',
    url: 'https://cn.bing.com/search?q=%s',
    keyword: 'cn.bing.com',
  },
  {
    name: '知乎',
    url: 'https://www.zhihu.com/search?type=content&q=%s',
    keyword: 'zhihu.com',
  },
  {
    name: '哔哩哔哩',
    url: 'https://search.bilibili.com/all?keyword=%s',
    keyword: 'bilibili.com',
  },
  { name: '微博', url: 'https://s.weibo.com/weibo?q=%s', keyword: 'weibo.com' },
  {
    name: '淘宝',
    url: 'https://s.taobao.com/search?q=%s',
    keyword: 'taobao.com',
  },
  {
    name: '京东',
    url: 'https://search.jd.com/Search?keyword=%s',
    keyword: 'jd.com',
  },
  {
    name: 'GitHub',
    url: 'https://github.com/search?q=%s',
    keyword: 'github.com',
  },
  // —— 国外 ——
  {
    name: 'Google',
    url: 'https://www.google.com/search?q=%s',
    keyword: 'google.com',
    keywordsUrl: 'http://google.com/complete/search?client=chrome&q=%s',
  },
  {
    name: 'Bing',
    url: 'https://www.bing.com/search?q=%s',
    keyword: 'bing.com',
  },
  {
    name: 'Yahoo',
    url: 'https://search.yahoo.com/search?p=%s',
    keyword: 'yahoo.com',
  },
  {
    name: 'DuckDuckGo',
    url: 'https://duckduckgo.com/?q=%s',
    keyword: 'duckduckgo.com',
  },
  {
    name: 'Yandex',
    url: 'https://yandex.com/search/?text=%s',
    keyword: 'yandex.com',
  },
  {
    name: 'Brave',
    url: 'https://search.brave.com/search?q=%s',
    keyword: 'search.brave.com',
  },
  {
    name: 'Ecosia',
    url: 'https://www.ecosia.org/search?q=%s',
    keyword: 'ecosia.org',
  },
  {
    name: 'Startpage',
    url: 'https://www.startpage.com/sp/search?query=%s',
    keyword: 'startpage.com',
  },
  {
    name: 'Wikipedia',
    url: 'https://en.wikipedia.org/w/index.php?search=%s',
    keyword: 'wikipedia.org',
  },
  {
    name: 'YouTube',
    url: 'https://www.youtube.com/results?search_query=%s',
    keyword: 'youtube.com',
  },
];

// 依据 url 生成 icon，补齐 keywordsUrl，组装为完整 ISearchEngine。
// 云端下载的引擎也走这里生成 icon，保持本地/云端一致。
export const buildSearchEngine = (raw: IRawSearchEngine): ISearchEngine => ({
  name: raw.name,
  url: raw.url,
  keyword: raw.keyword,
  keywordsUrl: raw.keywordsUrl || '',
  icon: getLightweightIconUrl(raw.url),
});

export const DEFAULT_SEARCH_ENGINES: ISearchEngine[] =
  RAW_SEARCH_ENGINES.map(buildSearchEngine);

// 联想词兜底接口:默认搜索引擎没有 keywordsUrl 时,统一用百度联想。
// 返回 JSON 形如 { g: [{ q: '词' }, ...] }。
export const BAIDU_SUGGEST_URL = 'https://www.baidu.com/sugrec?prod=pc&wd=%s';

// 用户壳层 CSS 的字符上限。该值同时用于设置页输入和主进程持久化校验，
// 避免超大字符串放大 CSS 解析、IPC 广播和 settings.json 序列化成本。
export const MAX_CUSTOM_CHROME_CSS_LENGTH = 64 * 1024;

export const DEFAULT_SETTINGS: ISettings = {
  language: 'auto',
  theme: 'wexond-light',
  darkContents: false,
  shield: true,
  multrin: true,
  animations: true,
  // 书签栏默认始终显示。bookmarksBar 保留用于兼容旧版布尔配置。
  bookmarksBarDisplay: 'always',
  bookmarksBar: true,
  bookmarksBarIconsOnly: false,
  bookmarksBarRows: 1,
  bookmarksBarFolderId: '',
  suggestions: true,
  suggestBookmarks: true,
  suggestHistory: true,
  suggestSearchHistory: true,
  suggestEngine: true,
  suggestTabs: true,
  suggestClipboard: true,
  // 开源版无搜索结果标注能力,默认关闭
  searchAnnotator: false,
  // 效率搜索默认使用双列模式,保持原有主面板 + 右侧副引擎行为。
  efficiencySearchMode: 'dual',
  // 多开标签引擎独立于默认搜索引擎,默认选择百度与秘塔。
  efficiencySearchEngineKeywords: ['baidu.com', 'metaso.cn'],
  // 副引擎下标:默认 1 = 秘塔(见 RAW_SEARCH_ENGINES)。
  secondarySearchEngine: 1,
  themeAuto: true,
  // 网页暗色模式实现:默认「浏览器实现」(Electron 预注入 SVG 滤镜脚本)。
  // 'extension' = Darknight(Dark Reader)拓展;'off' = 不变色。
  webDarkMode: 'browser',
  searchEngines: DEFAULT_SEARCH_ENGINES,
  searchEngine: 0,
  startupBehavior: {
    type: 'continue',
  },
  warnOnQuit: false,
  closeTabOnDoubleClick: true,
  closeTabOnRightClick: false,
  // 没有来源页时保持 Chrome 风格：优先右侧，再回退左侧。
  tabCloseSelectionBehavior: 'right',
  tabCloseButtonDisplay: 'always',
  // 默认采用 Chrome 风格的持续缩小；用户可在外观设置中切换为滚动标签栏。
  tabOverflowBehavior: 'shrink',
  // 默认在标签栏溢出时优先滚动，到边界后再切换标签。
  tabWheelBehavior: 'auto',
  tabHoverActivationBehavior: 'activate-and-switch',
  tabHoverActivationDelay: 500,
  version: 3,
  downloadsDialog: false,
  downloadsPath: getDefaultDownloadsPath(),
  m3u8DownloadThreads: 8,
  downloaderEnabled: false,
  downloaderType: 'idm',
  downloaderPath: '',
  downloaderArgs: '',
  downloaderAutoIntercept: false,
  doNotTrack: true,
  incognitoBlockThirdPartyCookies: true,
  immersiveBrowsing: false,
  immersivePageIndicator: true,
  topBarVariant: 'default',
  tabsLayout: 'top',
  // 自定义工具栏默认布局(见 CLUSTER_BUTTONS / SITE_BUTTONS 的 id):
  // 地址栏左侧仅「主页」;右侧依次 扩展→下载→历史→书签→
  // 清理浏览数据→截图→翻译。后五项为常驻入口但默认隐藏(放入 hidden),
  // 用户可在「自定义工具栏」开启。
  // 菜单(3-dot)与后退/前进/刷新不在可定制列表内,始终固定渲染。
  toolbarLayout: {
    left: ['home'],
    right: [
      'extensions',
      'downloads',
      'history',
      'bookmarks',
      'clear-browsing-data',
      'screenshot',
      'translate-page',
    ],
    hidden: [
      'history',
      'bookmarks',
      'clear-browsing-data',
      'screenshot',
      'translate-page',
    ],
    downloadVisibility: 'on-download',
  },
  sidebarWidth: 240,
  sidebarPinned: true,
  customChromeCss: '',
  chromeStylePanel: {},
  activeChromeTheme: null,
  autofill: true,
  newtab: '',
  disabledExtensions: [],
  incognitoAllowedExtensions: [],
  pinnedExtensions: [],
  extensionGroups: [],
  extensionsAutoUpdate: true,
  flashSupport: true,
  autoTranslateSites: [],
  shortcuts: {},
  extensionShortcuts: {},
  mouseGesturesEnabled: true,
  mouseGestureColor: '#3b82f6',
  mouseGestures: {},
  mouseLeftGesturesEnabled: true,
  mouseLeftGestureThreshold: 24,
  mouseLeftGestureOpenInBackground: true,
  mouseLeftGestures: {
    U: 'copy',
    D: 'download',
    L: 'open-left-background',
    R: 'open-right-background',
  },
  mouseSideButtons: {
    '3': 'back',
    '4': 'forward',
  },
  selectionPanelEnabled: true,
  selectionWordCountEnabled: true,
  openPopupsInNewTab: false,
  selectionTranslateEnabled: true,
  selectionTranslateTarget: 'zh-CN',
  translateEngine: 'microsoft',
  customLlmConfig: {
    baseUrl: 'https://api.openai.com/',
    apiKey: '',
    model: 'gpt-4o-mini',
    apiType: 'chat',
    systemPrompt: '',
  },
  memorySaver: true,
  flagsSelections: {},
  hardwareAcceleration: true,
  // 会话 Cookie 持久化:默认关闭。仅持久化用户在白名单中手动添加的主域名的
  // 会话 cookie;无痕窗口不受影响——其分区在启动/关窗/退出时被整清+删目录。
  persistSessionCookies: false,
  persistSessionCookieHosts: [],
  clearBrowsingData: {
    cache: true,
    cookies: false,
    history: true,
    searchHistory: false,
    downloads: false,
    passwords: false,
    autofill: false,
    siteSettings: false,
  },
  clearOnExit: {
    cache: false,
    cookies: false,
    history: false,
    searchHistory: false,
    downloads: false,
    passwords: false,
    autofill: false,
    siteSettings: false,
  },
};
