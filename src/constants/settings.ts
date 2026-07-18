import { ISettings, ISearchEngine } from '~/interfaces';
import { getIconByUrlNet } from '~/utils/url';

// NOTE: avoid a static `import { remote, app } from 'electron'`. webpack lowers
// that to a synchronous `require("electron")` (see the `externals` config), and
// this module is pulled into the shared `pre-entry` bundle that also runs in
// renderers with `nodeIntegration: false` (e.g. newtab), where `require` is not
// defined at module-eval time. Resolve lazily and guard instead.
const getDefaultDownloadsPath = (): string => {
  try {
    const electron =
      (globalThis as any).electron ??
      (globalThis as any).require?.('electron');

    const app = electron?.remote?.app ?? electron?.app;

    if (app && typeof app.getPath === 'function') {
      return app.getPath('downloads');
    }
  } catch {
    // electron / app not available in this context
  }

  return '';
};

// 本地内置搜索引擎（云端离线时的兜底）。云端为搜索 URL 的权威来源，
// search-engines 同步服务会用云端数据按 keyword 合并/覆盖此列表。
// 数组顺序即默认顺序，百度排首位（searchEngine 默认 0）。
// icon 不在此硬编码，统一交给 getIconByUrlNet 依据 url 生成。
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
  { name: '搜狗', url: 'https://www.sogou.com/web?query=%s', keyword: 'sogou.com' },
  { name: '360搜索', url: 'https://www.so.com/s?q=%s', keyword: 'so.com' },
  { name: '夸克', url: 'https://quark.sm.cn/s?q=%s', keyword: 'quark.sm.cn' },
  { name: '神马搜索', url: 'https://m.sm.cn/s?q=%s', keyword: 'sm.cn' },
  { name: '头条搜索', url: 'https://so.toutiao.com/search?keyword=%s', keyword: 'toutiao.com' },
  { name: '必应（国内）', url: 'https://cn.bing.com/search?q=%s', keyword: 'cn.bing.com' },
  { name: '知乎', url: 'https://www.zhihu.com/search?type=content&q=%s', keyword: 'zhihu.com' },
  { name: '哔哩哔哩', url: 'https://search.bilibili.com/all?keyword=%s', keyword: 'bilibili.com' },
  { name: '微博', url: 'https://s.weibo.com/weibo?q=%s', keyword: 'weibo.com' },
  { name: '淘宝', url: 'https://s.taobao.com/search?q=%s', keyword: 'taobao.com' },
  { name: '京东', url: 'https://search.jd.com/Search?keyword=%s', keyword: 'jd.com' },
  { name: 'GitHub', url: 'https://github.com/search?q=%s', keyword: 'github.com' },
  // —— 国外 ——
  {
    name: 'Google',
    url: 'https://www.google.com/search?q=%s',
    keyword: 'google.com',
    keywordsUrl: 'http://google.com/complete/search?client=chrome&q=%s',
  },
  { name: 'Bing', url: 'https://www.bing.com/search?q=%s', keyword: 'bing.com' },
  { name: 'Yahoo', url: 'https://search.yahoo.com/search?p=%s', keyword: 'yahoo.com' },
  { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', keyword: 'duckduckgo.com' },
  { name: 'Yandex', url: 'https://yandex.com/search/?text=%s', keyword: 'yandex.com' },
  { name: 'Brave', url: 'https://search.brave.com/search?q=%s', keyword: 'search.brave.com' },
  { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s', keyword: 'ecosia.org' },
  { name: 'Startpage', url: 'https://www.startpage.com/sp/search?query=%s', keyword: 'startpage.com' },
  { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=%s', keyword: 'wikipedia.org' },
  { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s', keyword: 'youtube.com' },
];

// 依据 url 生成 icon，补齐 keywordsUrl，组装为完整 ISearchEngine。
// 云端下载的引擎也走这里生成 icon，保持本地/云端一致。
export const buildSearchEngine = (raw: IRawSearchEngine): ISearchEngine => ({
  name: raw.name,
  url: raw.url,
  keyword: raw.keyword,
  keywordsUrl: raw.keywordsUrl || '',
  icon: getIconByUrlNet(raw.url),
});

export const DEFAULT_SEARCH_ENGINES: ISearchEngine[] = RAW_SEARCH_ENGINES.map(
  buildSearchEngine,
);

// 联想词兜底接口:默认搜索引擎没有 keywordsUrl 时,统一用百度联想。
// 返回 JSON 形如 { g: [{ q: '词' }, ...] }。
export const BAIDU_SUGGEST_URL =
  'https://www.baidu.com/sugrec?prod=pc&wd=%s';

export const DEFAULT_SETTINGS: ISettings = {
  theme: 'wexond-light',
  darkContents: false,
  shield: true,
  multrin: true,
  animations: true,
  // 显示书签栏:默认开启(仅影响全新安装/未持久化该字段的用户;存量用户
  // settings.json 中已保存的值优先,不会被覆盖)。
  bookmarksBar: true,
  bookmarksBarRows: 1,
  suggestions: true,
  suggestBookmarks: true,
  suggestHistory: true,
  suggestSearchHistory: true,
  suggestEngine: true,
  suggestTabs: true,
  suggestClipboard: true,
  searchAnnotator: true,
  // 双引擎搜索:默认开启,搜索时主面板走主引擎、右侧边栏走副引擎(移动端 UA)。
  dualEngineSearch: true,
  // 副引擎下标:默认 1 = 秘塔(见 RAW_SEARCH_ENGINES)。
  secondarySearchEngine: 1,
  themeAuto: true,
  searchEngines: DEFAULT_SEARCH_ENGINES,
  searchEngine: 0,
  startupBehavior: {
    type: 'continue',
  },
  warnOnQuit: false,
  closeTabOnDoubleClick: true,
  version: 3,
  downloadsDialog: false,
  downloadsPath: getDefaultDownloadsPath(),
  downloaderEnabled: false,
  downloaderType: 'idm',
  downloaderPath: '',
  downloaderArgs: '',
  downloaderAutoIntercept: false,
  doNotTrack: true,
  incognitoBlockThirdPartyCookies: true,
  immersiveBrowsing: false,
  topBarVariant: 'default',
  tabsLayout: 'top',
  // 自定义工具栏默认布局(见 CLUSTER_BUTTONS / SITE_BUTTONS 的 id):
  // 地址栏左侧仅「主页」;右侧依次 扩展→下载→订阅→雨见AI→历史→书签。
  // 历史/书签为常驻入口但默认隐藏(放入 hidden),用户可在「自定义工具栏」开启。
  // 菜单(3-dot)与后退/前进/刷新不在可定制列表内,始终固定渲染。
  toolbarLayout: {
    left: ['home'],
    right: [
      'extensions',
      'downloads',
      'subscribe',
      'ai',
      'history',
      'bookmarks',
    ],
    hidden: ['history', 'bookmarks'],
  },
  sidebarWidth: 240,
  sidebarPinned: true,
  autofill: true,
  newtab: "",
  disabledExtensions: [],
  incognitoAllowedExtensions: [],
  pinnedExtensions: [],
  extensionsAutoUpdate: true,
  flashSupport: true,
  cloudBookmarkSync: true,
  cloudHistorySync: true,
  cloudTabSync: true,
  cloudConnectivity: false,
  autoTranslateSites: [],
  shortcuts: {},
  extensionShortcuts: {},
  mouseGesturesEnabled: true,
  mouseGestureColor: '#3b82f6',
  mouseGestures: {},
  selectionTranslateEnabled: true,
  selectionTranslateTarget: 'zh-CN',
  memorySaver: true,
  flagsSelections: {},
  hardwareAcceleration: true,
};
