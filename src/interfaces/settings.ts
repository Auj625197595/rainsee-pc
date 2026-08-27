export interface ISearchEngine {
  name?: string;
  url?: string;
  keywordsUrl?: string;
  keyword?: string;
  icon?: string;
}

export interface IStartupBehavior {
  type: 'continue' | 'urls' | 'empty';
  // type === 'urls' 时打开的单一页面（启动时 + 每次新建标签页都打开）
  url?: string;
}

export type TopBarVariant = 'default' | 'compact';

export type TabsLayout = 'top' | 'left' | 'right';

export type EfficiencySearchMode = 'normal' | 'dual' | 'multi-tab';

export type TabCloseButtonDisplay = 'always' | 'hover' | 'never';

export type TabOverflowBehavior = 'shrink' | 'scroll';

export type TabWheelBehavior = 'auto' | 'always-switch';

export type TabCloseSelectionBehavior = 'left' | 'right' | 'recent';

// 鼠标悬停在被回收标签上的行为。
export type TabHoverActivationBehavior =
  | 'off'
  | 'activate'
  | 'activate-and-switch';

export type BookmarkBarDisplay = 'always' | 'newtab' | 'never';

export interface ISettings {
  theme: string;
  themeAuto: boolean;
  // 网页暗色模式实现方式(仅在暗色生效主题下作用于普通网页内容):
  // 'extension' = Darknight(Dark Reader)拓展;'browser' = 浏览器预注入脚本(默认);
  // 'off' = 不变色(网页内容保持原样,浏览器外壳仍跟随主题)。主题/外壳配色不受此项影响。
  webDarkMode: 'extension' | 'browser' | 'off';
  shield: boolean;
  multrin: boolean;
  animations: boolean;
  // 书签栏显示方式。bookmarksBar 保留用于兼容旧版配置。
  bookmarksBarDisplay: BookmarkBarDisplay;
  bookmarksBar: boolean;
  // 书签栏仅显示图标，标题通过原生悬停提示保留。
  bookmarksBarIconsOnly: boolean;
  // 书签栏最大显示行数(1/2/3),超出部分收入溢出箭头 popup。默认 1 行(改动前行为)。
  bookmarksBarRows: number;
  // 书签栏展示的目录。空值表示内置的「书签栏」根目录，保持旧版行为。
  bookmarksBarFolderId: string;
  suggestions: boolean;
  // 地址栏联想词来源开关(总开关 suggestions 关闭时全部不生效)
  suggestBookmarks: boolean;
  suggestHistory: boolean;
  suggestSearchHistory: boolean;
  suggestEngine: boolean;
  suggestTabs: boolean;
  suggestClipboard: boolean;
  // 搜索引擎 AI 建议面板:在百度搜索结果上标注相关性角标与气泡。默认开启。
  searchAnnotator: boolean;
  // 效率搜索模式:正常搜索、双列搜索或用多个独立引擎同时打开标签页。
  efficiencySearchMode: EfficiencySearchMode;
  // 多开标签使用的搜索引擎 keyword 列表,与默认搜索引擎选择相互独立。
  efficiencySearchEngineKeywords: string[];
  // 副引擎在 searchEngines 数组中的下标。默认 1(秘塔)。
  secondarySearchEngine: number;
  searchEngine: number;
  searchEngines: ISearchEngine[];
  startupBehavior: IStartupBehavior;
  warnOnQuit: boolean;
  // 双击标签页关闭(快捷手势),默认开启。关闭后双击不再关闭标签。
  closeTabOnDoubleClick: boolean;
  // 右键直接关闭标签页/标签组。开启后按住 Shift 右键仍显示原生菜单。
  closeTabOnRightClick: boolean;
  // 没有有效来源页时关闭当前标签，切换到左/上、右/下或最近浏览的标签页。
  tabCloseSelectionBehavior: TabCloseSelectionBehavior;
  // 标签栏关闭按钮的显示方式。
  tabCloseButtonDisplay: TabCloseButtonDisplay;
  // 顶部标签过多时的处理方式:持续缩小(Chrome 风格)或保持最小宽度并滚动。
  tabOverflowBehavior: TabOverflowBehavior;
  // 标签栏滚轮行为:按容器溢出状态自动滚动/切换，或始终切换相邻标签。
  tabWheelBehavior: TabWheelBehavior;
  // 鼠标在标签上停留指定时间后，对被回收标签执行的操作。
  tabHoverActivationBehavior: TabHoverActivationBehavior;
  tabHoverActivationDelay: number;
  version: number;
  darkContents: boolean;
  downloadsDialog: boolean;
  downloadsPath: string;
  // m3u8 分片同时下载数量。
  m3u8DownloadThreads: number;
  // 外部下载器总开关。关闭时不显示右键"使用 XX 下载"菜单项、不自动接管下载。
  downloaderEnabled: boolean;
  // 预置类型:'idm' | 'thunder' | 'aria2' | 'custom'。
  downloaderType: string;
  // 可执行文件路径。预置类型自动从注册表发现(迅雷除外,走 thunder:// 协议),用户可手动覆盖。
  downloaderPath: string;
  // 仅 custom 用:参数模板,占位符 {url} {path} {filename},按空白拆成 argv。
  downloaderArgs: string;
  // 自动接管所有下载(will-download 时 preventDefault 转交外部下载器)。默认关。
  downloaderAutoIntercept: boolean;
  doNotTrack: boolean;
  // 无痕模式默认阻止第三方 cookie(剥除 SameSite=None 的 Set-Cookie,阻跨站追踪)。
  incognitoBlockThirdPartyCookies: boolean;
  // 沉浸浏览:顶部标签布局下默认隐藏头部,鼠标贴近窗口顶边时再显示。
  immersiveBrowsing: boolean;
  // 沉浸浏览时在网页顶部显示的小白条提示。
  immersivePageIndicator: boolean;
  topBarVariant: TopBarVariant;
  tabsLayout: TabsLayout;
  // 自定义工具栏:left/right 为地址栏左/右两侧按钮 id 的有序列表(可在所属区域内
  // 拖拽排序,不跨区);hidden 为用户隐藏的普通按钮 id(集群按钮 + 地址栏内图标通用)。
  // 下载按钮单独使用三态配置:始终显示、触发下载时显示、隐藏。
  // 归一化由 resolveToolbarLayout 处理(丢弃未知 id、补齐默认按钮)。
  toolbarLayout: {
    left: string[];
    right: string[];
    hidden: string[];
    downloadVisibility: 'always' | 'on-download' | 'hidden';
  };
  sidebarWidth: number;
  // 侧边栏固定/缩放模式(仅左右侧边栏布局生效)。
  // true = 固定模式(始终展开,默认,与改动前行为一致);
  // false = 缩放模式(常态收窄为图标+两字的窄轨,鼠标移入才展开)。
  sidebarPinned: boolean;
  // 浏览器壳层自定义样式。仅注入主窗口 renderer，不会进入标签页 WebContents。
  customChromeCss: string;
  // 「浏览器框架 CSS」可视化调控面板的取值(扁平键值,见 common/chrome-style-panel)。
  // 生成物渲染在 customChromeCss 之前,手写 CSS 优先级更高;空对象 = 未调整。
  chromeStylePanel: import('./chrome-style-panel').IChromePanelValues;
  // 当前启用的 Chrome 主题扩展。主题清单已由主进程规范化，不包含本地文件路径
  // 或图片内容；null 表示使用雨见内置明暗主题。
  activeChromeTheme: import('./chrome-theme').IChromeTheme | null;
  autofill: boolean;
  newtab: string;
  disabledExtensions: string[];
  // 允许在无痕模式运行的扩展 id 白名单(与 disabledExtensions 同构)。
  incognitoAllowedExtensions: string[];
  // 固定到地址栏扩展区左侧的扩展 id 列表(钉住)。
  pinnedExtensions: string[];
  // 扩展管理页的用户分组与组内顺序。
  extensionGroups: import('./extensions').IExtensionGroup[];
  // 扩展自动更新开关(与 Chrome 一致,默认开启):为真时后台定时检查并升级扩展。
  extensionsAutoUpdate: boolean;
  // Flash 兼容支持总开关。开启时允许探测 Flash 页面并确保 Ruffle 扩展已安装；
  // 关闭时卸载 Ruffle，且网页加载完成后不再执行 Flash 探测。
  flashSupport: boolean;
  // 用户手动开启过翻译的站点(可注册域名,如 php.net)。这些站点地址栏始终显示翻译图标。
  autoTranslateSites: string[];
  // 快捷键自定义覆盖:key = 动作 id(见 src/main/menus/shortcut-actions.ts),
  // value = 用户绑定的 accelerator 数组(自定义后为单元素)。未出现的动作沿用注册表默认值。
  shortcuts: { [id: string]: string[] };
  // 扩展命令(chrome.commands)快捷键覆盖:extId → (commandName → accelerator)。
  // '' = 用户清除了该命令快捷键;未出现的命令沿用 manifest suggested_key。
  // 由 vendored CommandsAPI 在加载扩展时读取(applyOverrides 注入)。
  extensionShortcuts: {
    [extensionId: string]: { [commandName: string]: string };
  };
  // 鼠标右键手势总开关,默认开启。
  mouseGesturesEnabled: boolean;
  // 手势滑动轨迹颜色(默认 #3b82f6)。
  mouseGestureColor: string;
  // 手势覆盖:actionId → shapeCode(null = 显式解绑该动作的默认手势)。
  // 未出现的动作沿用 gesture-actions.ts 的 DEFAULT_GESTURES。
  mouseGestures: { [actionId: string]: string | null };
  // 左键长按网页链接/图片后的滑动阈值(像素)与四方向动作。
  mouseLeftGesturesEnabled: boolean;
  mouseLeftGestureThreshold: number;
  mouseLeftGestures: { [direction: string]: string | null };
  mouseLeftGestureOpenInBackground: boolean;
  // 鼠标侧边键(button 3/4)点击动作,null = 不响应。
  mouseSideButtons: { [button: string]: string | null };
  // 文本选择面板总开关。关闭后网页选中文本不再显示操作菜单。
  selectionPanelEnabled: boolean;
  // 文本选择菜单中的字数显示开关。
  selectionWordCountEnabled: boolean;
  // 网页请求创建独立弹窗时，默认改为在浏览器标签页中打开。网站级权限规则可覆盖。
  openPopupsInNewTab: boolean;
  // 划词翻译开关。关闭后仍显示复制/搜索等文本选择菜单。
  selectionTranslateEnabled: boolean;
  // 划词翻译目标语言码(同 LANGUAGES,如 zh-CN/en/ja)。默认中文。
  selectionTranslateTarget: string;
  // 翻译引擎:网页翻译与划词翻译共用同一选择。
  //  - 'microsoft':免费 Edge 接口(默认)
  //  - 'custom-llm':用户自配 OpenAI 兼容端点(见 customLlmConfig)
  translateEngine: 'microsoft' | 'custom-llm';
  // 自定义 LLM 配置(translateEngine === 'custom-llm' 时生效)。
  // apiKey 明文落 settings.json(与 customChromeCss/downloaderArgs 一致)。
  customLlmConfig: {
    baseUrl: string; // 如 'https://api.openai.com/',末尾斜杠会被规范化
    apiKey: string;
    model: string; // 如 'gpt-4o-mini'
    apiType: 'chat' | 'responses';
    systemPrompt?: string; // 可选,作为额外 system 指令
  };
  // 内存节省(标签页延迟加载):恢复/后台标签不立即创建 BrowserView 进程,
  // 仅在标签栏显示标题与图标,切换到该标签时才 loadURL。默认开启。
  memorySaver: boolean;
  // 内置 flags 页的用户覆盖:flag 内部名 → 选择值。未出现的项沿用 flasg.md 中的基线状态。
  flagsSelections: {
    [internalName: string]: 'default' | 'enabled' | 'disabled';
  };
  // 硬件加速开关,默认开启。关闭后调用 app.disableHardwareAcceleration(),
  // 该调用必须在 app.ready 之前执行,故仅在下次启动生效(运行时切换需重启)。
  hardwareAcceleration: boolean;
  // 会话 Cookie 持久化:开启后 Chromium 的 session cookie(无 Expires 的登录态)也
  // 落盘,重启浏览器后保持登录。仅对 persistSessionCookieHosts 中用户明确添加的
  // 主域名生效,无痕窗口不受影响。
  persistSessionCookies: boolean;
  // 「重启后保持登录」的主域名白名单。只接受 host,例如 example.com。
  persistSessionCookieHosts: string[];
  // 手动清理浏览数据时使用的勾选项。设置页与工具栏清理入口共用。
  clearBrowsingData: {
    cache: boolean;
    cookies: boolean;
    history: boolean;
    searchHistory: boolean;
  };
  // 退出时自动清理:关闭最后一个浏览器窗口时,在进度覆盖层下清理勾选项。
  // 至少一项为 true 即视为启用;全为 false 即停用(与多选框产品形态一致)。
  clearOnExit: {
    cache: boolean; // 网页缓存 → sessions.view.clearCache()
    cookies: boolean; // Cookie → sessions.view.clearStorageData({storages:['cookies']})
    history: boolean; // 历史记录(全清)
    searchHistory: boolean; // 搜索历史(从 history 中按搜索引擎规则删除)
  };
}
