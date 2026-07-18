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
  hovered?: boolean;
  url?: string;
  // 建议来源分类,决定左侧分类图标与是否显示跳转按钮
  type?: SuggestionType;
  // type === 'tab' 时携带目标标签页 id
  tabId?: number;
}
