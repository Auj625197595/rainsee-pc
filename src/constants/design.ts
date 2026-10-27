export const DEFAULT_TAB_MARGIN_TOP = 9;
export const COMPACT_TAB_MARGIN_TOP = 8;

export const DEFAULT_TAB_HEIGHT = 36;
export const COMPACT_TAB_HEIGHT = 28;

// Toolbar
export const TOOLBAR_HEIGHT = 42;

export const TOOLBAR_BUTTON_WIDTH = 36;
export const TOOLBAR_BUTTON_HEIGHT = 32;

export const ADD_TAB_BUTTON_WIDTH = 28;
export const ADD_TAB_BUTTON_HEIGHT = 28;

export const DEFAULT_TITLEBAR_HEIGHT =
  DEFAULT_TAB_MARGIN_TOP * 2 + DEFAULT_TAB_HEIGHT;
export const COMPACT_TITLEBAR_HEIGHT =
  2 * COMPACT_TAB_MARGIN_TOP + COMPACT_TAB_HEIGHT;

// 单行布局的历史行距。多行布局会在运行时改用标签表面高度,只保留首尾留白。
export const DEFAULT_TAB_ROW_PITCH = DEFAULT_TAB_HEIGHT + 8;
export const COMPACT_TAB_ROW_PITCH = COMPACT_TAB_HEIGHT + 8;

// 顶部标签表面(胶囊)高度与多行标签的行间距。
// 标签不再靠 margin-top 下沉:整块标签区在标题栏内垂直居中,行与行之间靠 TAB_ROW_GAP 隔开。
export const DEFAULT_TAB_SURFACE_HEIGHT = 34;
export const TAB_ROW_GAP = 6;

export const VIEW_Y_OFFSET = TOOLBAR_HEIGHT + DEFAULT_TITLEBAR_HEIGHT;

// Widths
export const WINDOWS_BUTTON_WIDTH = 45;
export const MENU_WIDTH = 330;

// 标签页侧边栏缩放模式(sidebarPinned=false,收起)下的窄轨宽度:
// 恰好容纳 favicon + 截取的两字标题。renderer 与 main(权限弹窗定位等)共用此值。
export const SIDEBAR_RAIL_WIDTH = 62;

// Dialogs
export const DIALOG_MIN_HEIGHT = 130;
export const DIALOG_MARGIN = 16;
export const DIALOG_TOP = 34;
export const DIALOG_MARGIN_TOP = 3;
