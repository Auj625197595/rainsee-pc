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

export type GestureCategory = 'navigation' | 'tabs' | 'view' | 'tools';

export interface GestureAction {
  // 稳定标识,持久化到 settings.mouseGestures 的 key(以 actionId 为键)
  id: string;
  // 设置页展示的中文名称
  label: string;
  category: GestureCategory;
}

// 设置页分组的展示顺序
export const GESTURE_CATEGORIES: { id: GestureCategory; label: string }[] = [
  { id: 'navigation', label: '页面导航' },
  { id: 'tabs', label: '标签页' },
  { id: 'view', label: '视图与滚动' },
  { id: 'tools', label: '工具' },
];

// 预设手势形状:下拉里可选。code 见识别器约定。
export interface PresetShape {
  code: string;
  label: string;
}

export const PRESET_SHAPES: PresetShape[] = [
  { code: 'L', label: '← 向左' },
  { code: 'R', label: '→ 向右' },
  { code: 'U', label: '↑ 向上' },
  { code: 'D', label: '↓ 向下' },
  { code: 'DR', label: '↓→ 先向下再向右' },
  { code: 'DL', label: '↓← 向下然后向左' },
  { code: 'UR', label: '↑→ 先向上再向右' },
  { code: 'UL', label: '↑← 先向上再向左' },
  { code: 'RU', label: '→↑ 先向右再向上' },
  { code: 'RD', label: '→↓ 向右然后向下' },
  { code: 'LU', label: '←↑ 先向左再向上' },
  { code: 'LD', label: '←↓ 向左然后向下' },
  { code: 'UD', label: '↑↓ 先向上再向下' },
  { code: 'DU', label: '↓↑ 先向下再向上' },
  { code: 'LR', label: '←→ 先向左再向右' },
  { code: 'RL', label: '→← 先向右再向左' },
];

export const GESTURE_ACTIONS: GestureAction[] = [
  // —— 页面导航 ——
  { id: 'back', label: '后退', category: 'navigation' },
  { id: 'forward', label: '前进', category: 'navigation' },
  { id: 'reload', label: '刷新', category: 'navigation' },
  { id: 'stop', label: '停止加载', category: 'navigation' },
  { id: 'home', label: '回到主页', category: 'navigation' },
  // —— 标签页 ——
  { id: 'new-tab', label: '新建标签页', category: 'tabs' },
  { id: 'close-tab', label: '关闭当前标签', category: 'tabs' },
  { id: 'reopen-closed-tab', label: '恢复关闭的标签', category: 'tabs' },
  { id: 'next-tab', label: '下一个标签', category: 'tabs' },
  { id: 'previous-tab', label: '上一个标签', category: 'tabs' },
  // —— 视图与滚动 ——
  { id: 'scroll-to-top', label: '滚到顶部', category: 'view' },
  { id: 'scroll-to-bottom', label: '滚到底部', category: 'view' },
  { id: 'zoom-in', label: '放大', category: 'view' },
  { id: 'zoom-out', label: '缩小', category: 'view' },
  { id: 'reset-zoom', label: '重置缩放', category: 'view' },
  // —— 工具 ——
  { id: 'find-in-page', label: '页内查找', category: 'tools' },
];

// 默认绑定:shape -> actionId(左划后退 / 右划前进)。只用 4 方向基向组成的形状,
// 其余形状(RD/UR/LD/RL 等)默认未绑定,用户可在设置页下拉里自行分配。
export const DEFAULT_GESTURES: { [shape: string]: string } = {
  L: 'back',
  R: 'forward',
  U: 'scroll-to-top',
  D: 'scroll-to-bottom',
  UD: 'reload',
  DU: 'new-tab',
  DR: 'close-tab',
  UL: 'reopen-closed-tab',
  RU: 'next-tab',
  LU: 'previous-tab',
  DL: 'find-in-page',
  LR: 'reset-zoom',
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
  return REVERSE_DEFAULTS[actionId] ?? null;
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

// 动作 id -> 中文标签(供 preload 在光标旁显示动作名)。
export const GESTURE_LABELS: { [actionId: string]: string } = (() => {
  const m: { [actionId: string]: string } = {};
  for (const a of GESTURE_ACTIONS) m[a.id] = a.label;
  return m;
})();

// 下发给网页 preload 的配置快照。
export interface GestureConfig {
  enabled: boolean;
  color: string;
  // shape -> actionId
  map: { [shape: string]: string };
  // actionId -> 中文标签
  labels: { [actionId: string]: string };
}

export const buildGestureConfig = (s: {
  mouseGesturesEnabled?: boolean;
  mouseGestureColor?: string;
  mouseGestures?: { [actionId: string]: string | null };
}): GestureConfig => ({
  enabled: s.mouseGesturesEnabled !== false,
  color:
    typeof s.mouseGestureColor === 'string' && s.mouseGestureColor
      ? s.mouseGestureColor
      : '#3b82f6',
  map: resolveGestures(s.mouseGestures || {}),
  labels: GESTURE_LABELS,
});
