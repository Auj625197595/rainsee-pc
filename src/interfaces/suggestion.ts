export type SuggestionType =
  | 'search'
  | 'url'
  | 'history'
  | 'searchTerm'
  | 'bookmark'
  | 'tab'
  | 'suggestion'
  | 'clipboard';

export interface ISuggestion {
  primaryText?: string;
  secondaryText?: string;
  id?: number;
  favicon?: string;
  canSuggest?: boolean;
  isSearch?: boolean;
  // 剪贴板内容是 JSON 对象/数组时,提供 bejson 快速格式化入口。
  isJsonClipboard?: boolean;
  rawClipboard?: string;
  hovered?: boolean;
  // 地址栏可省略协议进行展示，但导航始终使用未经改写的 url。
  displayUrl?: string;
  url?: string;
  // 建议来源分类,决定左侧分类图标与是否显示跳转按钮
  type?: SuggestionType;
  // type === 'tab' 时携带目标标签页 id
  tabId?: number;
}
