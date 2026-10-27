// 快捷键动作注册表(纯数据,无 Electron import)。
//
// 这里只登记「面向用户、可配置」的内置快捷键动作的元数据(id / 文案 key /
// 分组 / 默认 accelerator)。动作的真实执行逻辑仍然留在 main.ts 的
// getMainMenu() 里 —— 本注册表只服务于:
//   1. 设置页「快捷键」分区的列表展示;
//   2. 判断某动作当前是否处于「已自定义」状态(当前值 !== defaults);
//   3. application.ts 的 get-shortcut-actions IPC 把 defaults 与用户覆盖合并后下发给设置页。
//
// 重要约束:每项的 defaults 必须与 main.ts 里对应 createMenuItem 调用的
// (非 Mac)accelerator 数组逐字一致,否则设置页展示的「默认」会与菜单实际生效
// 的绑定不符,「恢复默认」也会恢复到错误值。main.ts 只在「用户存在覆盖」时才
// 使用覆盖数组,未覆盖时仍用它自己硬编码的 shortcuts。

import type { MessageKey, Translator } from '~/common/i18n';

export type ShortcutCategory =
  | 'file'
  | 'view'
  | 'tabs'
  | 'history'
  | 'bookmarks'
  | 'tools';

export interface ShortcutAction {
  // 稳定标识,持久化到 settings.shortcuts 的 key
  id: string;
  // 设置页和应用菜单共享的翻译 key
  labelKey: MessageKey;
  labelParams?: Record<string, string | number>;
  category: ShortcutCategory;
  // 默认 accelerator 数组(可能含多个绑定,如关闭标签页 Ctrl+W / Ctrl+F4)
  defaults: string[];
}

// 设置页分组的展示顺序
export const SHORTCUT_CATEGORIES: {
  id: ShortcutCategory;
  labelKey: MessageKey;
}[] = [
  { id: 'file', labelKey: 'shortcutCategoryFile' },
  { id: 'view', labelKey: 'shortcutCategoryView' },
  { id: 'tabs', labelKey: 'shortcutCategoryTabs' },
  { id: 'history', labelKey: 'shortcutCategoryHistory' },
  { id: 'bookmarks', labelKey: 'shortcutCategoryBookmarks' },
  { id: 'tools', labelKey: 'shortcutCategoryTools' },
];

// Ctrl+1..8 切到第 N 个标签:8 个独立动作,defaults 与 main.ts 的
// `CmdOrCtrl+${i}` 逐字一致。
const selectTabActions: ShortcutAction[] = Array.from(
  { length: 8 },
  (_, k) => k + 1,
).map((i) => ({
  id: `select-tab-${i}`,
  labelKey: 'shortcutSelectTab',
  labelParams: { index: i },
  category: 'tabs' as ShortcutCategory,
  defaults: [`CmdOrCtrl+${i}`],
}));

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  // —— 文件与标签 ——
  {
    id: 'open-local-file',
    labelKey: 'shortcutOpenLocalFile',
    category: 'file',
    defaults: ['CmdOrCtrl+O'],
  },
  {
    id: 'new-window',
    labelKey: 'shortcutNewWindow',
    category: 'file',
    defaults: ['CmdOrCtrl+N'],
  },
  {
    id: 'new-private-window',
    labelKey: 'shortcutNewPrivateWindow',
    category: 'file',
    defaults: ['CmdOrCtrl+Shift+N'],
  },
  {
    id: 'new-tab',
    labelKey: 'shortcutNewTab',
    category: 'file',
    defaults: ['CmdOrCtrl+T'],
  },
  {
    id: 'reopen-closed-tab',
    labelKey: 'shortcutReopenClosedTab',
    category: 'file',
    defaults: ['CmdOrCtrl+Shift+T'],
  },
  {
    id: 'close-window',
    labelKey: 'shortcutCloseWindow',
    category: 'file',
    defaults: ['CmdOrCtrl+Shift+W'],
  },
  {
    id: 'close-tab',
    labelKey: 'shortcutCloseTab',
    category: 'file',
    defaults: ['CmdOrCtrl+W', 'CmdOrCtrl+F4'],
  },
  {
    id: 'save-page',
    labelKey: 'shortcutSavePage',
    category: 'file',
    defaults: ['CmdOrCtrl+S'],
  },
  {
    id: 'print',
    labelKey: 'shortcutPrint',
    category: 'file',
    defaults: ['CmdOrCtrl+P'],
  },
  {
    id: 'find-in-page',
    labelKey: 'shortcutFindInPage',
    category: 'file',
    defaults: ['CmdOrCtrl+F'],
  },
  {
    id: 'paste-and-go',
    labelKey: 'shortcutPasteAndGo',
    category: 'tools',
    defaults: ['CmdOrCtrl+Shift+L'],
  },
  // —— 视图与缩放 ——
  {
    id: 'reload',
    labelKey: 'shortcutReload',
    category: 'view',
    defaults: ['CmdOrCtrl+R', 'F5'],
  },
  {
    id: 'force-reload',
    labelKey: 'shortcutForceReload',
    category: 'view',
    defaults: ['CmdOrCtrl+Shift+R', 'Shift+F5'],
  },
  {
    id: 'zoom-in',
    labelKey: 'shortcutZoomIn',
    category: 'view',
    defaults: ['CmdOrCtrl+numadd', 'CmdOrCtrl+='],
  },
  {
    id: 'zoom-out',
    labelKey: 'shortcutZoomOut',
    category: 'view',
    defaults: ['CmdOrCtrl+numsub', 'CmdOrCtrl+-'],
  },
  {
    id: 'reset-zoom',
    labelKey: 'shortcutResetZoom',
    category: 'view',
    defaults: ['CmdOrCtrl+0', 'CmdOrCtrl+num0'],
  },
  // —— 标签页切换 ——
  {
    id: 'next-tab',
    labelKey: 'shortcutNextTab',
    category: 'tabs',
    defaults: ['Ctrl+Tab', 'Ctrl+PageDown'],
  },
  {
    id: 'previous-tab',
    labelKey: 'shortcutPreviousTab',
    category: 'tabs',
    defaults: ['Ctrl+Shift+Tab', 'Ctrl+PageUp'],
  },
  ...selectTabActions,
  {
    id: 'select-last-tab',
    labelKey: 'shortcutSelectLastTab',
    category: 'tabs',
    defaults: ['CmdOrCtrl+9'],
  },
  // —— 历史 ——
  {
    id: 'back',
    labelKey: 'shortcutBack',
    category: 'history',
    defaults: ['Alt+Left'],
  },
  {
    id: 'forward',
    labelKey: 'shortcutForward',
    category: 'history',
    defaults: ['Alt+Right'],
  },
  {
    id: 'show-history',
    labelKey: 'shortcutShowHistory',
    category: 'history',
    defaults: ['Ctrl+H'],
  },
  // —— 书签 ——
  {
    id: 'manage-bookmarks',
    labelKey: 'shortcutManageBookmarks',
    category: 'bookmarks',
    defaults: ['CmdOrCtrl+Shift+O'],
  },
  {
    id: 'toggle-bookmarks-bar',
    labelKey: 'shortcutToggleBookmarksBar',
    category: 'bookmarks',
    defaults: ['CmdOrCtrl+Shift+B'],
  },
  {
    id: 'add-bookmark',
    labelKey: 'shortcutAddBookmark',
    category: 'bookmarks',
    defaults: ['CmdOrCtrl+D'],
  },
  // —— 工具 ——
  {
    id: 'view-source',
    labelKey: 'shortcutViewSource',
    category: 'tools',
    defaults: ['CmdOrCtrl+U'],
  },
  {
    id: 'devtools',
    labelKey: 'shortcutDevTools',
    category: 'tools',
    defaults: ['CmdOrCtrl+Shift+I', 'CmdOrCtrl+Shift+J', 'F12'],
  },
  {
    id: 'screenshot',
    labelKey: 'shortcutScreenshot',
    category: 'tools',
    defaults: ['CmdOrCtrl+Shift+X'],
  },
  {
    id: 'boss-key',
    labelKey: 'shortcutBossKey',
    category: 'tools',
    defaults: ['Ctrl+`'],
  },
  // —— 标签栏整理(工具箱「整理标签栏」子菜单三项的快捷键)——
  // 动作执行在 renderer 的 LayoutSwitcher,主进程隐藏菜单项只经
  // organize-tabs IPC 把动作名转过去;defaults 与 main.ts 的 accelerator 逐字一致。
  {
    id: 'deduplicate-tabs',
    labelKey: 'shortcutDeduplicateTabs',
    category: 'tools',
    defaults: ['CmdOrCtrl+Shift+D'],
  },
  {
    id: 'group-tabs-by-domain',
    labelKey: 'shortcutGroupTabsByDomain',
    category: 'tools',
    defaults: ['CmdOrCtrl+Shift+G'],
  },
  {
    id: 'group-tabs-with-ai',
    labelKey: 'shortcutGroupTabsWithAi',
    category: 'tools',
    defaults: ['CmdOrCtrl+Shift+A'],
  },
];

export const getShortcutActionLabel = (
  id: string,
  translator: Translator,
): string => {
  const action = SHORTCUT_ACTIONS.find((item) => item.id === id);
  return action
    ? translator(action.labelKey, action.labelParams)
    : id;
};

export const localizeShortcutCategories = (translator: Translator) =>
  SHORTCUT_CATEGORIES.map((category) => ({
    id: category.id,
    label: translator(category.labelKey),
  }));

export const localizeShortcutActions = (translator: Translator) =>
  SHORTCUT_ACTIONS.map((action) => ({
    id: action.id,
    label: translator(action.labelKey, action.labelParams),
    category: action.category,
    defaults: action.defaults,
  }));

// 工具:把 settings.json 里持久化的覆盖映射合并到注册表默认值上,返回每个动作
// 「当前生效」的 accelerator 数组。供主进程 IPC 与菜单构建共用,避免两处分别
// 解析造成不一致。
export const resolveAccelerators = (
  id: string,
  overrides?: { [id: string]: string[] },
): string[] => {
  if (overrides && Array.isArray(overrides[id]) && overrides[id].length > 0) {
    return overrides[id];
  }
  const action = SHORTCUT_ACTIONS.find((a) => a.id === id);
  return action ? action.defaults : [];
};
