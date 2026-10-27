// 鼠标手势动作注册表(纯数据,无 Electron import)。克隆 shortcut-actions.ts 的设计。
//
// 这里只登记「面向用户、可配置」的手势动作的元数据 + 预设手势形状 + 默认绑定。
// 动作的真实执行逻辑在 application.ts 的 runGestureAction 里;本注册表只服务于:
//   1. 设置页「鼠标手势」分区的列表展示;
//   2. buildGestureConfig 把默认绑定与用户覆盖合并后,经 IPC 下发给网页 preload;
//   3. application.ts 的 get-gesture-actions / set-gesture / reset-gesture IPC。
//
// 重要:DEFAULT_GESTURES 的 shape -> actionId 必须与 gesture-subframe.ts 识别器输出的 token 串
// 逐字一致。识别器只用 4 方向基向 L/R/U/D(无对角),形状 = 折叠后的单字符 token 串:
// 单段 "L"/"U",两段折角 "DR"=先下再右,反向 "UD"=先上再下,依此类推。

import type { MessageKey, Translator } from '~/common/i18n';

export type GestureCategory = 'navigation' | 'tabs' | 'view' | 'tools';

export interface GestureAction {
  // 稳定标识,持久化到 settings.mouseGestures 的 key(以 actionId 为键)
  id: string;
  // 设置页和手势浮层共享的翻译 key
  labelKey: MessageKey;
  category: GestureCategory;
}

// 设置页分组的展示顺序
export const GESTURE_CATEGORIES: { id: GestureCategory; labelKey: MessageKey }[] = [
  { id: 'navigation', labelKey: 'mgCategoryNavigation' },
  { id: 'tabs', labelKey: 'mgCategoryTabs' },
  { id: 'view', labelKey: 'mgCategoryView' },
  { id: 'tools', labelKey: 'mgCategoryTools' },
];

// 预设手势形状:下拉里可选。code 见识别器约定。
export interface PresetShape {
  code: string;
  labelKey: MessageKey;
}

export const PRESET_SHAPES: PresetShape[] = [
  { code: 'L', labelKey: 'mgShapeL' },
  { code: 'R', labelKey: 'mgShapeR' },
  { code: 'U', labelKey: 'mgShapeU' },
  { code: 'D', labelKey: 'mgShapeD' },
  { code: 'DR', labelKey: 'mgShapeDR' },
  { code: 'DL', labelKey: 'mgShapeDL' },
  { code: 'UR', labelKey: 'mgShapeUR' },
  { code: 'UL', labelKey: 'mgShapeUL' },
  { code: 'RU', labelKey: 'mgShapeRU' },
  { code: 'RD', labelKey: 'mgShapeRD' },
  { code: 'LU', labelKey: 'mgShapeLU' },
  { code: 'LD', labelKey: 'mgShapeLD' },
  { code: 'UD', labelKey: 'mgShapeUD' },
  { code: 'DU', labelKey: 'mgShapeDU' },
  { code: 'LR', labelKey: 'mgShapeLR' },
  { code: 'RL', labelKey: 'mgShapeRL' },
];

export const GESTURE_ACTIONS: GestureAction[] = [
  // —— 页面导航 ——
  { id: 'back', labelKey: 'shortcutBack', category: 'navigation' },
  { id: 'forward', labelKey: 'shortcutForward', category: 'navigation' },
  { id: 'reload', labelKey: 'mgActReload', category: 'navigation' },
  { id: 'stop', labelKey: 'mgActStopLoading', category: 'navigation' },
  { id: 'home', labelKey: 'mgActGoHome', category: 'navigation' },
  // —— 标签页 ——
  { id: 'new-tab', labelKey: 'mgActNewTab', category: 'tabs' },
  { id: 'close-tab', labelKey: 'mgActCloseCurrentTab', category: 'tabs' },
  { id: 'close-all-tabs', labelKey: 'mgActCloseAllTabs', category: 'tabs' },
  { id: 'reopen-closed-tab', labelKey: 'mgActRestoreClosedTab', category: 'tabs' },
  { id: 'next-tab', labelKey: 'shortcutNextTab', category: 'tabs' },
  { id: 'previous-tab', labelKey: 'shortcutPreviousTab', category: 'tabs' },
  // —— 视图与滚动 ——
  { id: 'scroll-to-top', labelKey: 'mgActScrollTop', category: 'view' },
  { id: 'scroll-to-bottom', labelKey: 'mgActScrollBottom', category: 'view' },
  { id: 'scroll-page-up', labelKey: 'mgActScrollPageUp', category: 'view' },
  { id: 'scroll-page-down', labelKey: 'mgActScrollPageDown', category: 'view' },
  { id: 'zoom-in', labelKey: 'shortcutZoomIn', category: 'view' },
  { id: 'zoom-out', labelKey: 'shortcutZoomOut', category: 'view' },
  { id: 'reset-zoom', labelKey: 'shortcutResetZoom', category: 'view' },
  // —— 工具 ——
  { id: 'find-in-page', labelKey: 'shortcutFindInPage', category: 'tools' },
];

// 默认绑定:shape -> actionId(左划后退 / 右划前进)。只用 4 方向基向组成的形状,
// RL 形状默认未绑定,用户可在设置页下拉里自行分配。
export const DEFAULT_GESTURES: { [shape: string]: string } = {
  L: 'back',
  R: 'forward',
  U: 'scroll-to-top',
  D: 'scroll-to-bottom',
  UD: 'reload',
  DU: 'new-tab',
  DR: 'close-tab',
  RD: 'close-all-tabs',
  UL: 'reopen-closed-tab',
  RU: 'next-tab',
  LU: 'previous-tab',
  DL: 'find-in-page',
  LR: 'reset-zoom',
  UR: 'scroll-page-up',
  LD: 'scroll-page-down',
};

// 反转默认:actionId -> 默认 shape(供设置页展示「默认」+ 计算「恢复默认」)。
const REVERSE_DEFAULTS: { [actionId: string]: string } = (() => {
  const m: { [actionId: string]: string } = {};
  for (const shape of Object.keys(DEFAULT_GESTURES)) {
    m[DEFAULT_GESTURES[shape]] = shape;
  }
  return m;
})();

// 计算某动作当前生效的 shape:用户覆盖优先(含 null=显式解绑),否则默认。
// overrides 以 actionId 为键(settings.mouseGestures 的持久化形态)。
export const effectiveShape = (
  actionId: string,
  overrides?: { [actionId: string]: string | null },
): string | null => {
  if (
    overrides &&
    Object.prototype.hasOwnProperty.call(overrides, actionId)
  ) {
    return overrides[actionId] ?? null;
  }
  const defaultShape = REVERSE_DEFAULTS[actionId] ?? null;
  // 新增默认绑定时,优先保留旧配置中已占用该形状的用户自定义动作。
  if (
    defaultShape &&
    GESTURE_ACTIONS.some(
      (action) => action.id !== actionId && overrides?.[action.id] === defaultShape,
    )
  ) {
    return null;
  }
  return defaultShape;
};

// 合并默认与用户覆盖,返回生效的 shape -> actionId 映射(供 preload 查表)。
export const resolveGestures = (
  overrides?: { [actionId: string]: string | null },
): { [shape: string]: string } => {
  const map: { [shape: string]: string } = {};
  for (const action of GESTURE_ACTIONS) {
    const shape = effectiveShape(action.id, overrides);
    if (shape) map[shape] = action.id;
  }
  return map;
};

// 动作 id -> 翻译后的标签(供 preload 在光标旁显示动作名)。不缓存:随语言即时生效。
export const getGestureLabels = (t: Translator): { [actionId: string]: string } => {
  const m: { [actionId: string]: string } = {};
  for (const a of GESTURE_ACTIONS) m[a.id] = t(a.labelKey);
  return m;
};

export interface LeftGestureAction {
  id: string;
  labelKey: MessageKey;
  // 左键拖拽提示浮层用的短标签(空间有限,与完整动作名区分)
  shortLabelKey: MessageKey;
}

export const LEFT_GESTURE_ACTIONS: LeftGestureAction[] = [
  {id: 'copy', labelKey: 'lgCopyToClipboard', shortLabelKey: 'lgHintCopy'},
  {id: 'download', labelKey: 'lgDownloadLink', shortLabelKey: 'lgHintDownload'},
  {id: 'open-left', labelKey: 'lgOpenLeftTab', shortLabelKey: 'lgHintOpenLeft'},
  {id: 'open-right', labelKey: 'lgOpenRightTab', shortLabelKey: 'lgHintOpenRight'},
  {id: 'open-left-background', labelKey: 'lgOpenLeftTabBg', shortLabelKey: 'lgHintOpenLeftBg'},
  {id: 'open-right-background', labelKey: 'lgOpenRightTabBg', shortLabelKey: 'lgHintOpenRightBg'},
];

const GESTURE_ACTION_IDS = new Set(GESTURE_ACTIONS.map((item) => item.id));

const LEFT_GESTURE_ACTION_IDS = new Set(LEFT_GESTURE_ACTIONS.map((item) => item.id));

export const resolveLeftGestures = (
  gestures?: { [direction: string]: string | null },
): { [direction: string]: string | null } => {
  const defaults: { [direction: string]: string } = {
    U: 'copy',
    D: 'download',
    L: 'open-left-background',
    R: 'open-right-background',
  };
  const map: { [direction: string]: string | null } = {};
  for (const direction of ['U', 'D', 'L', 'R']) {
    const value = Object.prototype.hasOwnProperty.call(gestures || {}, direction)
      ? gestures?.[direction]
      : defaults[direction];
    map[direction] = value && LEFT_GESTURE_ACTION_IDS.has(value) ? value : null;
  }
  return map;
};

export const resolveSideButtons = (
  buttons?: { [button: string]: string | null },
): { [button: string]: string | null } => {
  const defaults: { [button: string]: string } = {'3': 'back', '4': 'forward'};
  const map: { [button: string]: string | null } = {};
  for (const button of ['3', '4']) {
    const value = Object.prototype.hasOwnProperty.call(buttons || {}, button)
      ? buttons?.[button]
      : defaults[button];
    map[button] = value && GESTURE_ACTION_IDS.has(value) ? value : null;
  }
  return map;
};

// 下发给网页 preload 的配置快照。
export interface GestureConfig {
  enabled: boolean;
  leftEnabled: boolean;
  color: string;
  // shape -> actionId
  map: { [shape: string]: string };
  // actionId -> 翻译后的标签(注入脚本直接显示,不做 key 查询)
  labels: { [actionId: string]: string };
  leftThreshold: number;
  leftMap: { [direction: string]: string | null };
  leftLabels: { [actionId: string]: string };
  // 左键拖拽提示浮层的短标签(actionId -> 翻译文本)
  leftShortLabels: { [actionId: string]: string };
  sideButtons: { [button: string]: string | null };
}

export const buildGestureConfig = (s: {
  mouseGesturesEnabled?: boolean;
  mouseLeftGesturesEnabled?: boolean;
  mouseGestureColor?: string;
  mouseGestures?: { [actionId: string]: string | null };
  mouseLeftGestureThreshold?: number;
  mouseLeftGestures?: { [direction: string]: string | null };
  mouseSideButtons?: { [button: string]: string | null };
}, t: Translator): GestureConfig => ({
  enabled: s.mouseGesturesEnabled !== false,
  leftEnabled: s.mouseLeftGesturesEnabled !== false,
  color:
    typeof s.mouseGestureColor === 'string' && s.mouseGestureColor
      ? s.mouseGestureColor
      : '#3b82f6',
  map: resolveGestures(s.mouseGestures || {}),
  labels: getGestureLabels(t),
  leftThreshold:
    typeof s.mouseLeftGestureThreshold === 'number'
      ? Math.max(8, Math.min(200, Math.round(s.mouseLeftGestureThreshold)))
      : 24,
  leftMap: resolveLeftGestures(s.mouseLeftGestures),
  leftLabels: LEFT_GESTURE_ACTIONS.reduce((map, item) => {
    map[item.id] = t(item.labelKey);
    return map;
  }, {} as { [actionId: string]: string }),
  leftShortLabels: LEFT_GESTURE_ACTIONS.reduce((map, item) => {
    map[item.id] = t(item.shortLabelKey);
    return map;
  }, {} as { [actionId: string]: string }),
  sideButtons: resolveSideButtons(s.mouseSideButtons),
});

// —— IPC 边界的本地化 DTO(与 shortcut-actions 的 localize* 同构) ——

export const localizeGestureCategories = (t: Translator) =>
  GESTURE_CATEGORIES.map((c) => ({ id: c.id, label: t(c.labelKey) }));

export const localizeGestureActions = (t: Translator) =>
  GESTURE_ACTIONS.map((a) => ({ id: a.id, label: t(a.labelKey), category: a.category }));

export const localizePresetShapes = (t: Translator) =>
  PRESET_SHAPES.map((p) => ({ code: p.code, label: t(p.labelKey) }));

export const localizeLeftGestureActions = (t: Translator) =>
  LEFT_GESTURE_ACTIONS.map((a) => ({ id: a.id, label: t(a.labelKey) }));
