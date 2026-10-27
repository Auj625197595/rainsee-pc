export type BrowserActionChangeType =
  | 'setPopup'
  | 'setBadgeText'
  | 'setTitle'
  | 'setIcon'
  | 'setBadgeBackgroundColor'
  | 'setBadgeTextColor'
  | 'setEnabled';

export const BROWSER_ACTION_METHODS: BrowserActionChangeType[] = [
  'setPopup',
  'setBadgeText',
  'setTitle',
  'setIcon',
  'setBadgeBackgroundColor',
  'setBadgeTextColor',
  'setEnabled',
];

export type ExtInspectViewType = 'page' | 'service-worker';

// 扩展详情页中可单独打开开发者工具的运行上下文。
export interface IExtInspectView {
  id: string;
  type: ExtInspectViewType;
  label: string;
  url: string;
}

// 「拓展」管理页前后端共用的扩展信息(精简、可序列化)。
// 扩展通知策略:允许 / 禁止 / 允许但通知标题不显示扩展名。
export type ExtensionNotificationMode = 'allow' | 'block' | 'hide-name';

export interface IExtItem {
  id: string;
  name: string;
  version: string;
  description: string;
  path: string;
  manifestVersion: number;
  permissions: string[];
  hostPermissions: string[];
  optionalPermissions: string[];
  enabled: boolean;
  // Chrome 主题没有后台脚本或工具栏动作，管理页据此显示“主题”而非 MV 标签。
  type?: 'extension' | 'theme';
  // 是否允许在无痕模式运行(白名单 incognitoAllowedExtensions)。
  incognitoAllowed?: boolean;
  // manifest 声明了 notifications(含可选)权限。
  hasNotifications?: boolean;
  notificationMode?: ExtensionNotificationMode;
  // data url 或 chrome-extension://<id>/<相对路径>,前端可直接用作 <img src>
  icon: string;
  homepageUrl: string;
  // 是否声明了背景页 / Service Worker。
  hasBackground: boolean;
  // 浏览器动作 popup 的完整 chrome-extension:// URL(无则为空,代表无 popup)
  popup?: string;
  // 扩展选项页(options_ui.page / options_page)的完整 chrome-extension:// URL;
  // 无则为空字符串,代表该扩展没有选项页(地址栏扩展列表里不显示设置入口)。
  optionsUrl?: string;
}

// 管理页扩展分组。extensionIds 的顺序同时作为组内卡片顺序。
export interface IExtensionGroup {
  id: string;
  name: string;
  extensionIds: string[];
}

export type BrowserExtensionSourceType = 'chrome' | 'edge' | 'browser';

// 从本机 Chrome / Edge 配置目录中发现、可迁移的扩展。
export interface IBrowserExtensionImportItem {
  key: string;
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  browser: BrowserExtensionSourceType;
  browserName: string;
  profileName: string;
}

export interface IBrowserExtensionImportSource {
  browser: BrowserExtensionSourceType;
  browserName: string;
  profileName: string;
  path: string;
}

export interface IBrowserExtensionImportScan {
  canceled: boolean;
  detected: boolean;
  duplicateCount: number;
  items: IBrowserExtensionImportItem[];
  sources: IBrowserExtensionImportSource[];
}

export interface IBrowserExtensionImportResult {
  imported: Array<{ id: string; name: string }>;
  skipped: number;
  failed: Array<{ key: string; name: string; message: string }>;
}
