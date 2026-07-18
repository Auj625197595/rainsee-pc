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
  // 是否允许在无痕模式运行(白名单 incognitoAllowedExtensions)。
  incognitoAllowed?: boolean;
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
