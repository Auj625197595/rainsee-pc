export interface ITheme {
  'titlebar.backgroundColor': string;

  'addressbar.backgroundColor': string;
  'addressbar.textColor': string;

  'toolbar.backgroundColor': string;
  'toolbar.bottomLine.backgroundColor': string;
  'toolbar.lightForeground': boolean;
  'toolbar.separator.color': string;

  'tab.textColor': string;
  'tab.selected.textColor': string;
  'tab.backgroundColor'?: string;
  'tab.selected.backgroundColor'?: string;

  'bookmark.textColor'?: string;

  'sidebar.backgroundColor'?: string;
  'sidebar.tab.backgroundColor'?: string;
  'sidebar.tab.inactiveBackgroundColor'?: string;
  'sidebar.tab.selectedBackgroundColor'?: string;
  'sidebar.tab.textColor'?: string;
  'sidebar.tab.selectedTextColor'?: string;

  'control.backgroundColor': string;
  'control.hover.backgroundColor': string;
  'control.valueColor': string;
  'control.lightIcon': boolean;
  'switch.backgroundColor': string;

  'dialog.separator.color': string;
  'dialog.backgroundColor': string;
  'dialog.textColor': string;
  'dialog.lightForeground': boolean;

  'searchBox.backgroundColor': string;
  'searchBox.lightForeground': boolean;

  'pages.backgroundColor': string;
  'pages.lightForeground': boolean;
  'pages.textColor': string;
  'pages.navigationDrawer1.backgroundColor': string;
  'pages.navigationDrawer2.backgroundColor': string;

  'dropdown.backgroundColor': string;
  'dropdown.backgroundColor.translucent': string;
  'dropdown.separator.color': string;

  backgroundColor: string;
  accentColor: string;

  animations?: boolean;

  titlebarHeight?: number;
  tabHeight?: number;
  tabMarginTop?: number;
  isCompact?: boolean;
  sidebarWidth?: number;

  dark?: boolean;
}
