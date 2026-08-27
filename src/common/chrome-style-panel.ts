// 浏览器框架「可视化调控面板」的共享 schema 与 CSS 生成器。
// 面板值存放在 settings.chromeStylePanel(扁平键值对象),由 buildChromePanelCss
// 编译为一段 CSS,复用 customChromeCss 的 @scope 注入管道(topbar/sidebar),
// 并渲染在 data-rainsee-user-css 之前 —— 手写 CSS 的规则靠源顺序覆盖面板产物。

export interface IChromePanelField {
  key: string;
  label: string;
  type: 'slider' | 'color';
  /** slider:数值范围与单位(px 等)。 */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export interface IChromePanelSection {
  id: string;
  label: string;
  fields: IChromePanelField[];
}

export type IChromePanelValues = Record<string, string | number | boolean>;

// 面板允许调节的分组/字段全集。字段 key 即 chromeStylePanel 的存储键。
export const CHROME_PANEL_SECTIONS: IChromePanelSection[] = [
  {
    id: 'topbar',
    label: '顶部栏',
    fields: [
      { key: 'topbarBackground', label: '背景颜色', type: 'color' },
      {
        key: 'topbarHeight',
        label: '工具栏高度',
        type: 'slider',
        min: 44,
        max: 68,
        step: 1,
        unit: 'px',
      },
      { key: 'topbarText', label: '文字颜色', type: 'color' },
      { key: 'topbarBorder', label: '底部分隔线', type: 'color' },
    ],
  },
  {
    id: 'address',
    label: '地址栏',
    fields: [
      { key: 'addressBackground', label: '背景颜色', type: 'color' },
      { key: 'addressText', label: '文字颜色', type: 'color' },
      {
        key: 'addressRadius',
        label: '圆角',
        type: 'slider',
        min: 0,
        max: 22,
        step: 1,
        unit: 'px',
      },
      {
        key: 'addressHeight',
        label: '高度',
        type: 'slider',
        min: 28,
        max: 46,
        step: 1,
        unit: 'px',
      },
      {
        key: 'addressFont',
        label: '字体大小',
        type: 'slider',
        min: 11,
        max: 18,
        step: 0.5,
        unit: 'px',
      },
      { key: 'addressBorder', label: '边框颜色', type: 'color' },
      { key: 'addressFocusBorder', label: '聚焦边框颜色', type: 'color' },
      { key: 'addressFocusGlow', label: '聚焦光晕颜色', type: 'color' },
    ],
  },
  {
    id: 'buttons',
    label: '工具栏按钮',
    fields: [
      {
        key: 'buttonSize',
        label: '按钮大小',
        type: 'slider',
        min: 13,
        max: 44,
        step: 1,
        unit: 'px',
      },
      {
        key: 'buttonRadius',
        label: '按钮圆角',
        type: 'slider',
        min: 0,
        max: 18,
        step: 1,
        unit: 'px',
      },
      { key: 'buttonColor', label: '图标颜色', type: 'color' },
      { key: 'buttonHover', label: '悬停背景色', type: 'color' },
      { key: 'buttonActive', label: '按下背景色', type: 'color' },
    ],
  },
  {
    id: 'tabs',
    label: '标签页',
    fields: [
      { key: 'tabBackground', label: '标签背景颜色', type: 'color' },
      { key: 'tabSelectedBackground', label: '选中标签背景', type: 'color' },
      { key: 'tabText', label: '标签文字颜色', type: 'color' },
      { key: 'tabSelectedText', label: '选中标签文字', type: 'color' },
      { key: 'tabHoverBackground', label: '悬停标签背景', type: 'color' },
      {
        key: 'tabRadius',
        label: '标签圆角',
        type: 'slider',
        min: 0,
        max: 20,
        step: 1,
        unit: 'px',
      },
      {
        key: 'tabFont',
        label: '标签字体大小',
        type: 'slider',
        min: 10,
        max: 15,
        step: 0.5,
        unit: 'px',
      },
    ],
  },
  {
    id: 'bookmarks',
    label: '书签栏',
    fields: [
      { key: 'bookmarkBackground', label: '背景颜色', type: 'color' },
      { key: 'bookmarkText', label: '书签文字颜色', type: 'color' },
      {
        key: 'bookmarkFont',
        label: '字体大小',
        type: 'slider',
        min: 10,
        max: 15,
        step: 0.5,
        unit: 'px',
      },
      { key: 'bookmarkItemHover', label: '悬停背景色', type: 'color' },
    ],
  },
  {
    id: 'sidebar',
    label: '侧边栏',
    fields: [
      { key: 'sidebarBackground', label: '背景颜色', type: 'color' },
      { key: 'sidebarText', label: '文字颜色', type: 'color' },
      { key: 'sidebarNewTabBackground', label: '新建标签按钮背景', type: 'color' },
      { key: 'sidebarNewTabText', label: '新建标签按钮文字', type: 'color' },
      {
        key: 'sidebarNewTabRadius',
        label: '新建标签按钮圆角',
        type: 'slider',
        min: 0,
        max: 16,
        step: 1,
        unit: 'px',
      },
      { key: 'sidebarTabBackground', label: '侧栏标签背景', type: 'color' },
      { key: 'sidebarTabSelected', label: '侧栏选中标签背景', type: 'color' },
      {
        key: 'sidebarTabRadius',
        label: '侧栏标签圆角',
        type: 'slider',
        min: 0,
        max: 16,
        step: 1,
        unit: 'px',
      },
      {
        key: 'sidebarTabFont',
        label: '侧栏标签字体',
        type: 'slider',
        min: 10,
        max: 15,
        step: 0.5,
        unit: 'px',
      },
    ],
  },
];

export const CHROME_PANEL_FIELDS: IChromePanelField[] =
  CHROME_PANEL_SECTIONS.flatMap((section) => section.fields);

const FIELD_BY_KEY = new Map(CHROME_PANEL_FIELDS.map((f) => [f.key, f]));

// slider 的默认值(应用原生样式值)。键缺省/等于默认 → 不输出 CSS。
export const CHROME_PANEL_DEFAULTS: Record<string, number> = {
  topbarHeight: 54,
  addressRadius: 14,
  addressHeight: 38,
  addressFont: 15,
  buttonSize: 36,
  buttonRadius: 99999,
  tabRadius: 9999,
  tabFont: 12,
  bookmarkFont: 12,
  sidebarNewTabRadius: 10,
  sidebarTabRadius: 7,
  sidebarTabFont: 12.5,
};

export const getChromePanelFieldDefault = (key: string): number => {
  const field = FIELD_BY_KEY.get(key);
  if (field?.type === 'slider') {
    const def = CHROME_PANEL_DEFAULTS[key];
    if (typeof def === 'number') return def;
  }
  return NaN;
};

// sanitize:仅保留合法键,按控件类型夹取数值/颜色,输出安全子集。
export const sanitizeChromePanelValues = (
  value: unknown,
): IChromePanelValues => {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const out: IChromePanelValues = {};

  for (const field of CHROME_PANEL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, field.key)) continue;
    const v = raw[field.key];
    if (field.type === 'slider') {
      const num = typeof v === 'number' ? v : parseFloat(String(v));
      if (!Number.isFinite(num)) continue;
      const min = field.min ?? 0;
      const max = field.max ?? num;
      const step = field.step ?? 1;
      const clamped = Math.min(max, Math.max(min, num));
      // 对齐 step,消除浮点噪声(0.5 步进时 14.5000000001 之类)。
      out[field.key] = Number((Math.round(clamped / step) * step).toFixed(2));
    } else if (field.type === 'color') {
      if (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim())) {
        out[field.key] = v.trim().toLowerCase();
      }
    }
  }
  return out;
};

// ---- CSS 生成 --------------------------------------------------------------
//
// 选择器全部来自公开的 data-rainsee-* 契约(与设置页 CUSTOM_CSS_EXAMPLE 一致)。
// 顶部栏与侧边栏是两个独立的 @scope 根(:scope[data-rainsee-area=…]),topbar 组
// 的规则只写进 topbar 根;跨区共用的(标签/按钮)在两个根里都输出。
// 颜色覆盖必须 !important(组件 styled/内联优先级高);键未设置或等于默认值时
// 不输出,保持零配置零 CSS。

interface Decl {
  prop: string;
  value: string;
  important?: boolean;
}

interface Rule {
  selector: string;
  decls: Decl[];
}

class RuleSet {
  private rules: Rule[] = [];

  add(selector: string, decls: (Decl | null | false | undefined)[]) {
    const body = decls.filter(Boolean) as Decl[];
    if (!body.length) return;
    this.rules.push({ selector, decls: body });
  }

  toString() {
    return this.rules
      .map(({ selector, decls }) => {
        const body = decls
          .map(
            ({ prop, value, important }) =>
              `  ${prop}: ${value}${important ? ' !important' : ''};`,
          )
          .join('\n');
        return `${selector} {\n${body}\n}`;
      })
      .join('\n\n');
  }

  get empty() {
    return this.rules.length === 0;
  }
}

type Vals = IChromePanelValues;

const color = (values: Vals, key: string): string | null => {
  const v = values[key];
  return typeof v === 'string' && v ? v : null;
};

// 取 slider 值;返回 null 表示「未调整」(缺省或等于默认)。
const num = (values: Vals, key: string): number | null => {
  const def = CHROME_PANEL_DEFAULTS[key];
  const v = values[key];
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n) || n === def) return null;
  return n;
};

const px = (n: number) => `${n}px`;
const imp = (prop: string, value: string): Decl => ({
  prop,
  value,
  important: true,
});

// 品牌胶囊按钮(新标签搜索/AI/更新)有固定产品配色,统一排除,不随普通按钮改。
const PLAIN_BUTTON =
  '[data-rainsee-part="toolbar-button"]:not([data-rainsee-action="new-tab-search"]):not([data-rainsee-action="ai"]):not([data-rainsee-action="update"])';

// 面板值 → CSS 文本。全部为默认时返回 ''(调用方不渲染 <style>)。
export const buildChromePanelCss = (values: Vals): string => {
  const topbar = new RuleSet();
  const sidebar = new RuleSet();

  // ===== 顶部栏(topbar 组)=====
  const topbarBg = color(values, 'topbarBackground');
  const topbarText = color(values, 'topbarText');
  const topbarBorder = color(values, 'topbarBorder');
  const topbarHeight = num(values, 'topbarHeight');

  topbar.add('[data-rainsee-part="titlebar"]', [
    topbarBg && imp('background-color', topbarBg),
  ]);
  topbar.add('[data-rainsee-part="toolbar"]', [
    topbarBg && imp('background-color', topbarBg),
    topbarBorder && imp('border-bottom-color', topbarBorder),
    topbarHeight && { prop: 'height', value: px(topbarHeight) },
  ]);
  if (topbarText) {
    topbar.add(
      '[data-rainsee-part="address-input"][data-rainsee-input-visible="true"]',
      [imp('color', topbarText)],
    );
    topbar.add('[data-rainsee-part="tab-title"]', [imp('color', topbarText)]);
    topbar.add('[data-rainsee-part="bookmark-title"]', [
      imp('color', topbarText),
    ]);
  }

  // ===== 地址栏(topbar 组)=====
  const addressBg = color(values, 'addressBackground');
  const addressText = color(values, 'addressText');
  const addressBorder = color(values, 'addressBorder');
  const addressFocusBorder = color(values, 'addressFocusBorder');
  const addressFocusGlow = color(values, 'addressFocusGlow');
  const addressRadius = num(values, 'addressRadius');
  const addressHeight = num(values, 'addressHeight');
  const addressFont = num(values, 'addressFont');

  topbar.add('[data-rainsee-part="address-bar"]', [
    addressBg && imp('background-color', addressBg),
    addressRadius !== null && imp('border-radius', px(addressRadius)),
    addressHeight !== null && imp('height', px(addressHeight)),
    addressBorder && imp('border', `1px solid ${addressBorder}`),
  ]);
  topbar.add('[data-rainsee-part="address-bar"]:focus-within', [
    addressFocusBorder && imp('border-color', addressFocusBorder),
    addressFocusGlow && imp('box-shadow', `0 0 0 3px ${addressFocusGlow}33`),
  ]);
  topbar.add(
    '[data-rainsee-part="address-input"][data-rainsee-input-visible="true"]',
    [addressText && imp('color', addressText)],
  );
  topbar.add('[data-rainsee-part="address-input"]', [
    addressFont !== null && { prop: 'font-size', value: px(addressFont) },
  ]);

  // ===== 工具栏按钮(两个区域都有按钮)=====
  const buttonSize = num(values, 'buttonSize');
  const buttonRadius = num(values, 'buttonRadius');
  const buttonColor = color(values, 'buttonColor');
  const buttonHover = color(values, 'buttonHover');
  const buttonActive = color(values, 'buttonActive');

  for (const rs of [topbar, sidebar]) {
    rs.add(PLAIN_BUTTON, [
      buttonSize !== null && imp('width', px(buttonSize)),
      buttonSize !== null && imp('min-width', px(buttonSize)),
      buttonSize !== null && imp('height', px(buttonSize)),
      buttonRadius !== null && imp('border-radius', px(buttonRadius)),
      buttonColor && imp('color', buttonColor),
    ]);
    rs.add(`${PLAIN_BUTTON}:hover`, [
      buttonHover && imp('background-color', buttonHover),
    ]);
    rs.add(`${PLAIN_BUTTON}:active`, [
      buttonActive && imp('background-color', buttonActive),
    ]);
  }

  // ===== 标签页(顶部标签在 topbar,侧栏标签在 sidebar)=====
  const tabBg = color(values, 'tabBackground');
  const tabSelBg = color(values, 'tabSelectedBackground');
  const tabText = color(values, 'tabText');
  const tabSelText = color(values, 'tabSelectedText');
  const tabHoverBg = color(values, 'tabHoverBackground');
  const tabRadius = num(values, 'tabRadius');
  const tabFont = num(values, 'tabFont');

  // 顶部标签:背景画在 tab-surface 上(外壳负责定位与宽度动画)。
  topbar.add(
    '[data-rainsee-part="tab"][data-rainsee-selected="false"] > [data-rainsee-part="tab-surface"]',
    [tabBg && imp('background-color', tabBg)],
  );
  topbar.add(
    '[data-rainsee-part="tab"][data-rainsee-selected="true"] > [data-rainsee-part="tab-surface"]',
    [tabSelBg && imp('background-color', tabSelBg)],
  );
  topbar.add(
    '[data-rainsee-part="tab"]:hover > [data-rainsee-part="tab-surface"]',
    [tabHoverBg && imp('background-color', tabHoverBg)],
  );
  topbar.add('[data-rainsee-part="tab-surface"]', [
    tabRadius !== null && imp('border-radius', px(tabRadius)),
  ]);
  topbar.add('[data-rainsee-part="tab-title"]', [
    tabText && imp('color', tabText),
    tabFont !== null && imp('font-size', px(tabFont)),
  ]);
  topbar.add(
    '[data-rainsee-part="tab"][data-rainsee-selected="true"] [data-rainsee-part="tab-title"]',
    [tabSelText && imp('color', tabSelText)],
  );

  // 侧栏标签同步同一组标签配色(与顶部标签观感一致)。
  sidebar.add('[data-rainsee-part="sidebar-tab"]', [
    tabBg && imp('background-color', tabBg),
    tabRadius !== null && imp('border-radius', px(tabRadius)),
  ]);
  sidebar.add(
    '[data-rainsee-part="sidebar-tab"][data-rainsee-selected="true"]',
    [tabSelBg && imp('background-color', tabSelBg)],
  );
  sidebar.add('[data-rainsee-part="sidebar-tab"]:hover', [
    tabHoverBg && imp('background-color', tabHoverBg),
  ]);
  sidebar.add('[data-rainsee-part="sidebar-tab-title"]', [
    tabText && imp('color', tabText),
    tabFont !== null && imp('font-size', px(tabFont)),
  ]);

  // ===== 书签栏(topbar 组)=====
  const bookmarkBg = color(values, 'bookmarkBackground');
  const bookmarkText = color(values, 'bookmarkText');
  const bookmarkFont = num(values, 'bookmarkFont');
  const bookmarkHover = color(values, 'bookmarkItemHover');

  topbar.add('[data-rainsee-part="bookmark-bar"]', [
    bookmarkBg && imp('background-color', bookmarkBg),
  ]);
  topbar.add('[data-rainsee-part="bookmark-title"]', [
    bookmarkText && imp('color', bookmarkText),
    bookmarkFont !== null && imp('font-size', px(bookmarkFont)),
  ]);
  topbar.add('[data-rainsee-part="bookmark-item"]:hover', [
    bookmarkHover && imp('background-color', bookmarkHover),
  ]);

  // ===== 侧边栏(sidebar 组)=====
  const sidebarBg = color(values, 'sidebarBackground');
  const sidebarText = color(values, 'sidebarText');
  const sidebarTabBg = color(values, 'sidebarTabBackground');
  const sidebarTabSel = color(values, 'sidebarTabSelected');
  const sidebarTabRadius = num(values, 'sidebarTabRadius');
  const sidebarTabFont = num(values, 'sidebarTabFont');
  const sntBg = color(values, 'sidebarNewTabBackground');
  const sntText = color(values, 'sidebarNewTabText');
  const sntRadius = num(values, 'sidebarNewTabRadius');

  sidebar.add(':scope', [sidebarBg && imp('background-color', sidebarBg)]);
  if (sidebarText) {
    sidebar.add(':scope', [imp('color', sidebarText)]);
    sidebar.add('[data-rainsee-part="sidebar-brand-title"]', [
      imp('color', sidebarText),
    ]);
    sidebar.add('[data-rainsee-part="sidebar-tab-title"]', [
      imp('color', sidebarText),
    ]);
    sidebar.add('[data-rainsee-part="sidebar-group-title"]', [
      imp('color', sidebarText),
    ]);
    sidebar.add('[data-rainsee-part="sidebar-group-count"]', [
      imp('color', sidebarText),
    ]);
  }
  sidebar.add('[data-rainsee-part="sidebar-tab"]', [
    sidebarTabBg && imp('background-color', sidebarTabBg),
    sidebarTabRadius !== null && imp('border-radius', px(sidebarTabRadius)),
  ]);
  sidebar.add(
    '[data-rainsee-part="sidebar-tab"][data-rainsee-selected="true"]',
    [sidebarTabSel && imp('background-color', sidebarTabSel)],
  );
  sidebar.add('[data-rainsee-part="sidebar-tab-title"]', [
    sidebarTabFont !== null && imp('font-size', px(sidebarTabFont)),
  ]);
  sidebar.add('[data-rainsee-part="sidebar-new-tab"]', [
    sntBg && imp('background-color', sntBg),
    sntText && imp('color', sntText),
    sntRadius !== null && imp('border-radius', px(sntRadius)),
  ]);

  const chunks: string[] = [];
  if (!topbar.empty) {
    chunks.push(
      `:scope[data-rainsee-area="topbar"] {\n/* 顶部栏 */\n${indent(
        topbar.toString(),
      )}\n}`,
    );
  }
  if (!sidebar.empty) {
    chunks.push(
      `:scope[data-rainsee-area="sidebar"] {\n/* 侧边栏 */\n${indent(
        sidebar.toString(),
      )}\n}`,
    );
  }
  return chunks.join('\n\n');
};

const indent = (css: string) =>
  css
    .split('\n')
    .map((line) => (line ? `  ${line}` : line))
    .join('\n');

// 是否有任何非默认调整(用于面板「已自定义 n 项」提示与恢复默认按钮态)。
export const countChromePanelCustomized = (values: Vals) =>
  CHROME_PANEL_FIELDS.filter((field) => {
    const v = values[field.key];
    if (field.type === 'color') return typeof v === 'string' && !!v;
    return num(values, field.key) !== null;
  }).length;
