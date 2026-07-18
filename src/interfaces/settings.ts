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

export interface ISettings {
  theme: string;
  themeAuto: boolean;
  shield: boolean;
  multrin: boolean;
  animations: boolean;
  bookmarksBar: boolean;
  // 书签栏最大显示行数(1/2/3),超出部分收入溢出箭头 popup。默认 1 行(改动前行为)。
  bookmarksBarRows: number;
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
  // 双引擎搜索:开启后,搜索时主面板走主引擎,右侧边栏加载副引擎(移动端 UA)。默认开启。
  dualEngineSearch: boolean;
  // 副引擎在 searchEngines 数组中的下标。默认 1(秘塔)。
  secondarySearchEngine: number;
  searchEngine: number;
  searchEngines: ISearchEngine[];
  startupBehavior: IStartupBehavior;
  warnOnQuit: boolean;
  // 双击标签页关闭(快捷手势),默认开启。关闭后双击不再关闭标签。
  closeTabOnDoubleClick: boolean;
  version: number;
  darkContents: boolean;
  downloadsDialog: boolean;
  downloadsPath: string;
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
  topBarVariant: TopBarVariant;
  tabsLayout: TabsLayout;
  // 自定义工具栏:left/right 为地址栏左/右两侧按钮 id 的有序列表(可在所属区域内
  // 拖拽排序,不跨区);hidden 为用户隐藏的按钮 id(集群按钮 + 地址栏内图标通用)。
  // 归一化由 resolveToolbarLayout 处理(丢弃未知 id、补齐默认按钮)。
  toolbarLayout: {
    left: string[];
    right: string[];
    hidden: string[];
  };
  sidebarWidth: number;
  // 侧边栏固定/缩放模式(仅左右侧边栏布局生效)。
  // true = 固定模式(始终展开,默认,与改动前行为一致);
  // false = 缩放模式(常态收窄为图标+两字的窄轨,鼠标移入才展开)。
  sidebarPinned: boolean;
  autofill: boolean;
  newtab: string;
  disabledExtensions: string[];
  // 允许在无痕模式运行的扩展 id 白名单(与 disabledExtensions 同构)。
  incognitoAllowedExtensions: string[];
  // 固定到地址栏扩展区左侧的扩展 id 列表(钉住)。
  pinnedExtensions: string[];
  // 扩展自动更新开关(与 Chrome 一致,默认开启):为真时后台定时检查并升级扩展。
  extensionsAutoUpdate: boolean;
  // Flash 兼容支持总开关。开启时允许探测 Flash 页面并确保 Ruffle 扩展已安装；
  // 关闭时卸载 Ruffle，且网页加载完成后不再执行 Flash 探测。
  flashSupport: boolean;
  // 云服务(互联)同步开关,默认开启
  cloudBookmarkSync: boolean;
  cloudHistorySync: boolean;
  cloudTabSync: boolean;
  // 手机互联服务开关:默认关闭,需用户扫码授权后开启。为真时才启动在线心跳。
  cloudConnectivity: boolean;
  // 用户手动开启过翻译的站点(可注册域名,如 php.net)。这些站点地址栏始终显示翻译图标。
  autoTranslateSites: string[];
  // 快捷键自定义覆盖:key = 动作 id(见 src/main/menus/shortcut-actions.ts),
  // value = 用户绑定的 accelerator 数组(自定义后为单元素)。未出现的动作沿用注册表默认值。
  shortcuts: { [id: string]: string[] };
  // 扩展命令(chrome.commands)快捷键覆盖:extId → (commandName → accelerator)。
  // '' = 用户清除了该命令快捷键;未出现的命令沿用 manifest suggested_key。
  // 由 vendored CommandsAPI 在加载扩展时读取(applyOverrides 注入)。
  extensionShortcuts: { [extensionId: string]: { [commandName: string]: string } };
  // 鼠标右键手势总开关,默认开启。
  mouseGesturesEnabled: boolean;
  // 手势滑动轨迹颜色(默认 #3b82f6)。
  mouseGestureColor: string;
  // 手势覆盖:actionId → shapeCode(null = 显式解绑该动作的默认手势)。
  // 未出现的动作沿用 gesture-actions.ts 的 DEFAULT_GESTURES。
  mouseGestures: { [actionId: string]: string | null };
  // 划词翻译总开关,默认开启。网页选中文本后悬浮卡片显示译文。
  selectionTranslateEnabled: boolean;
  // 划词翻译目标语言码(同 LANGUAGES,如 zh-CN/en/ja)。默认中文。
  selectionTranslateTarget: string;
  // 内存节省(标签页延迟加载):恢复/后台标签不立即创建 BrowserView 进程,
  // 仅在标签栏显示标题与图标,切换到该标签时才 loadURL。默认开启。
  memorySaver: boolean;
  // 内置 flags 页的用户覆盖:flag 内部名 → 选择值。未出现的项沿用 flasg.md 中的基线状态。
  flagsSelections: { [internalName: string]: 'default' | 'enabled' | 'disabled' };
  // 硬件加速开关,默认开启。关闭后调用 app.disableHardwareAcceleration(),
  // 该调用必须在 app.ready 之前执行,故仅在下次启动生效(运行时切换需重启)。
  hardwareAcceleration: boolean;
}
