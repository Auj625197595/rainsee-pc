// 浏览器框架「可视化调控面板」的共享 schema 与 CSS 生成器。
// 面板值存放在 settings.chromeStylePanel(扁平键值对象),由 buildChromePanelCss
// 编译为一段 CSS,复用 customChromeCss 的 @scope 注入管道(topbar/sidebar),
// 并渲染在 data-rainsee-user-css 之前 —— 手写 CSS 的规则靠源顺序覆盖面板产物。
// 字段文案只存 i18n 消息 key(labelKey),由渲染端 ChromeStylePanel 翻译;
// 本模块同时被主进程引用,仅引入 i18n 的类型(emit 后省略,零运行时依赖)。

import type {MessageKey} from './i18n';

export interface IChromePanelField {
  key: string;
  labelKey: MessageKey;
  type: 'slider' | 'color' | 'toggle' | 'select';
  options?: { value: string; labelKey: MessageKey }[];
  /** slider:数值范围与单位(px 等)。 */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export interface IChromePanelSection {
  id: string;
  labelKey: MessageKey;
  fields: IChromePanelField[];
}

export type IChromePanelValues = Record<string, string | number | boolean>;

// 面板允许调节的分组/字段全集。字段 key 即 chromeStylePanel 的存储键。
export const CHROME_PANEL_SECTIONS: IChromePanelSection[] = [
  {
    id: 'topbar',
    labelKey: 'chromePanelSectionTopbar',
    fields: [
      { key: 'topbarBackground', labelKey: 'chromePanelTopbarBackground', type: 'color' },
      {
        key: 'topbarHeight',
        labelKey: 'chromePanelTopbarHeight',
        type: 'slider',
        min: 44,
        max: 68,
        step: 1,
        unit: 'px',
      },
      {
        key: 'titlebarHeight',
        labelKey: 'chromePanelTitlebarHeight',
        type: 'slider',
        min: 36,
        max: 80,
        step: 1,
        unit: 'px',
      },
      { key: 'topbarText', labelKey: 'chromePanelTopbarText', type: 'color' },
      { key: 'topbarBorder', labelKey: 'chromePanelTopbarBorder', type: 'color' },
    ],
  },
  {
    id: 'brand',
    labelKey: 'chromePanelSectionBrand',
    fields: [
      {
        key: 'logoSize',
        labelKey: 'chromePanelLogoSize',
        type: 'slider',
        min: 20,
        max: 44,
        step: 1,
        unit: 'px',
      },
      {
        key: 'logoRadius',
        labelKey: 'chromePanelLogoRadius',
        type: 'slider',
        min: 0,
        max: 16,
        step: 1,
        unit: 'px',
      },
      { key: 'logoBackground', labelKey: 'chromePanelLogoBackground', type: 'color' },
      {
        key: 'brandFont',
        labelKey: 'chromePanelBrandFont',
        type: 'slider',
        min: 11,
        max: 20,
        step: 0.5,
        unit: 'px',
      },
      { key: 'brandText', labelKey: 'chromePanelBrandText', type: 'color' },
      { key: 'brandSubText', labelKey: 'chromePanelBrandSubText', type: 'color' },
      { key: 'showBrandText', labelKey: 'chromePanelShowBrandText', type: 'toggle' },
      {
        key: 'aiButtonStyle',
        labelKey: 'chromePanelAiButtonStyle',
        type: 'select',
        options: [
          { value: 'button', labelKey: 'chromePanelAiButtonStyleButton' },
          { value: 'icon', labelKey: 'chromePanelAiButtonStyleIcon' },
        ],
      },
    ],
  },
  {
    id: 'address',
    labelKey: 'chromePanelSectionAddress',
    fields: [
      { key: 'addressBackground', labelKey: 'chromePanelAddressBackground', type: 'color' },
      { key: 'addressText', labelKey: 'chromePanelAddressText', type: 'color' },
      {
        key: 'addressRadius',
        labelKey: 'chromePanelAddressRadius',
        type: 'slider',
        min: 0,
        max: 22,
        step: 1,
        unit: 'px',
      },
      {
        key: 'addressHeight',
        labelKey: 'chromePanelAddressHeight',
        type: 'slider',
        min: 28,
        max: 46,
        step: 1,
        unit: 'px',
      },
      {
        key: 'addressFont',
        labelKey: 'chromePanelAddressFont',
        type: 'slider',
        min: 11,
        max: 18,
        step: 0.5,
        unit: 'px',
      },
      { key: 'addressBorder', labelKey: 'chromePanelAddressBorder', type: 'color' },
      { key: 'addressFocusBorder', labelKey: 'chromePanelAddressFocusBorder', type: 'color' },
      { key: 'addressFocusGlow', labelKey: 'chromePanelAddressFocusGlow', type: 'color' },
    ],
  },
  {
    id: 'buttons',
    labelKey: 'chromePanelSectionButtons',
    fields: [
      {
        key: 'buttonSize',
        labelKey: 'chromePanelButtonSize',
        type: 'slider',
        min: 13,
        max: 44,
        step: 1,
        unit: 'px',
      },
      {
        key: 'buttonRadius',
        labelKey: 'chromePanelButtonRadius',
        type: 'slider',
        min: 0,
        max: 18,
        step: 1,
        unit: 'px',
      },
      { key: 'buttonColor', labelKey: 'chromePanelButtonColor', type: 'color' },
      { key: 'buttonHover', labelKey: 'chromePanelButtonHover', type: 'color' },
      { key: 'buttonActive', labelKey: 'chromePanelButtonActive', type: 'color' },
    ],
  },
  {
    id: 'tabs',
    labelKey: 'chromePanelSectionTabs',
    fields: [
      { key: 'tabBackground', labelKey: 'chromePanelTabBackground', type: 'color' },
      { key: 'tabSelectedBackground', labelKey: 'chromePanelTabSelectedBackground', type: 'color' },
      { key: 'tabText', labelKey: 'chromePanelTabText', type: 'color' },
      { key: 'tabSelectedText', labelKey: 'chromePanelTabSelectedText', type: 'color' },
      { key: 'tabHoverBackground', labelKey: 'chromePanelTabHoverBackground', type: 'color' },
      {
        key: 'tabRadius',
        labelKey: 'chromePanelTabRadius',
        type: 'slider',
        min: 0,
        max: 20,
        step: 1,
        unit: 'px',
      },
      {
        key: 'tabHeight',
        labelKey: 'chromePanelTabHeight',
        type: 'slider',
        min: 24,
        max: 44,
        step: 1,
        unit: 'px',
      },
      {
        key: 'tabFont',
        labelKey: 'chromePanelTabFont',
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
    labelKey: 'chromePanelSectionBookmarks',
    fields: [
      { key: 'bookmarkBackground', labelKey: 'chromePanelBookmarkBackground', type: 'color' },
      { key: 'bookmarkText', labelKey: 'chromePanelBookmarkText', type: 'color' },
      {
        key: 'bookmarkFont',
        labelKey: 'chromePanelBookmarkFont',
        type: 'slider',
        min: 10,
        max: 15,
        step: 0.5,
        unit: 'px',
      },
      { key: 'bookmarkItemHover', labelKey: 'chromePanelBookmarkItemHover', type: 'color' },
    ],
  },
  {
    id: 'sidebar',
    labelKey: 'chromePanelSectionSidebar',
    fields: [
      { key: 'sidebarBackground', labelKey: 'chromePanelSidebarBackground', type: 'color' },
      { key: 'sidebarText', labelKey: 'chromePanelSidebarText', type: 'color' },
      { key: 'sidebarNewTabBackground', labelKey: 'chromePanelSidebarNewTabBackground', type: 'color' },
      { key: 'sidebarNewTabText', labelKey: 'chromePanelSidebarNewTabText', type: 'color' },
      {
        key: 'sidebarNewTabRadius',
        labelKey: 'chromePanelSidebarNewTabRadius',
        type: 'slider',
        min: 0,
        max: 16,
        step: 1,
        unit: 'px',
      },
      { key: 'sidebarTabBackground', labelKey: 'chromePanelSidebarTabBackground', type: 'color' },
      { key: 'sidebarTabSelected', labelKey: 'chromePanelSidebarTabSelected', type: 'color' },
      {
        key: 'sidebarTabRadius',
        labelKey: 'chromePanelSidebarTabRadius',
        type: 'slider',
        min: 0,
        max: 16,
        step: 1,
        unit: 'px',
      },
      {
        key: 'sidebarTabFont',
        labelKey: 'chromePanelSidebarTabFont',
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
export const isChromePanelFieldKey = (key: unknown): key is string =>
  typeof key === 'string' && FIELD_BY_KEY.has(key);

// slider 的默认值(应用原生样式值)。键缺省/等于默认 → 不输出 CSS。
export const CHROME_PANEL_DEFAULTS: Record<string, number> = {
  topbarHeight: 54,
  titlebarHeight: 54,
  logoSize: 32,
  logoRadius: 11,
  brandFont: 14,
  addressRadius: 14,
  addressHeight: 38,
  addressFont: 15,
  buttonSize: 36,
  buttonRadius: 99999,
  tabRadius: 9999,
  tabHeight: 34,
  tabFont: 12,
  bookmarkFont: 12,
  sidebarNewTabRadius: 10,
  sidebarTabRadius: 7,
  sidebarTabFont: 12.5,
};

// toggle 的默认态恒为 true(原生显示);返回 NaN/true 之外的值仅对 slider 有意义。
export const getChromePanelFieldDefault = (key: string): number | boolean | string => {
  const field = FIELD_BY_KEY.get(key);
  if (field?.type === 'toggle') return true;
  if (field?.type === 'select') return field.options?.[0]?.value || '';
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
    } else if (field.type === 'toggle') {
      if (typeof v === 'boolean') out[field.key] = v;
    } else if (field.type === 'select') {
      if (typeof v === 'string' && field.options?.some((option) => option.value === v)) {
        out[field.key] = v;
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

// 供布局读取的 slider 值(已 sanitize 夹取);未调整时返回 null。
// 标题栏高度/标签高度参与多行标签布局计算,不能只靠 CSS 覆盖,
// 由渲染进程读取后注入 theme 与 TabsStore。
export const getChromePanelNumber = (
  values: unknown,
  key: string,
): number | null => num(sanitizeChromePanelValues(values), key);

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
  // titlebarHeight / tabHeight 不输出 CSS:二者参与多行标签布局(行高/行距/居中),
  // 由渲染进程经 getChromePanelNumber 注入 store.titlebarBaseHeight / tabSurfaceHeight。
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

  // ===== LOGO 区域(顶部品牌区与侧边栏品牌行共用同一 Logo 组件)=====
  const logoSize = num(values, 'logoSize');
  const logoRadius = num(values, 'logoRadius');
  const logoBg = color(values, 'logoBackground');
  const brandFont = num(values, 'brandFont');
  const brandTextColor = color(values, 'brandText');
  const brandSubText = color(values, 'brandSubText');
  const hideBrandText = values.showBrandText === false;

  for (const rs of [topbar, sidebar]) {
    rs.add('[data-rainsee-part="brand-logo"]', [
      logoSize !== null && imp('width', px(logoSize)),
      logoSize !== null && imp('height', px(logoSize)),
      logoRadius !== null && imp('border-radius', px(logoRadius)),
      logoBg && imp('background-color', logoBg),
    ]);
  }
  if (logoSize !== null) {
    // 默认应用图标是 22/32 比例的内联尺寸,随框架等比缩放,
    // 须 !important 压过内联样式;小号图(100% 填充)随框架自然缩放。
    const iconSize = Math.round((logoSize * 22) / 32);
    for (const rs of [topbar, sidebar]) {
      rs.add('[data-rainsee-part="brand-logo-icon"]', [
        imp('width', px(iconSize)),
        imp('height', px(iconSize)),
      ]);
    }
  }
  topbar.add('[data-rainsee-part="brand-title"]', [
    brandTextColor && imp('color', brandTextColor),
    brandFont !== null && imp('font-size', px(brandFont)),
  ]);
  sidebar.add('[data-rainsee-part="sidebar-brand-title"]', [
    brandTextColor && imp('color', brandTextColor),
    brandFont !== null && imp('font-size', px(brandFont)),
  ]);
  topbar.add('[data-rainsee-part="brand-sub"]', [
    brandSubText && imp('color', brandSubText),
  ]);
  if (hideBrandText) {
    topbar.add('[data-rainsee-part="brand-text"]', [imp('display', 'none')]);
    sidebar.add('[data-rainsee-part="sidebar-brand-title"]', [
      imp('display', 'none'),
    ]);
  }

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

// 设置页字段悬停时的临时定位提示。只用于 live preview，不写入配置。
export const buildChromePanelHoverCss = (key: string | null | undefined): string => {
  if (!key) return '';
  const topbarTargets: Record<string, string> = {
    topbarBackground: '[data-rainsee-part="titlebar"], [data-rainsee-part="toolbar"]',
    topbarHeight: '[data-rainsee-part="toolbar"]', titlebarHeight: '[data-rainsee-part="titlebar"]', topbarText: '[data-rainsee-part="toolbar"]', topbarBorder: '[data-rainsee-part="toolbar"]',
    logoSize: '[data-rainsee-part="brand-logo"]', logoRadius: '[data-rainsee-part="brand-logo"]', logoBackground: '[data-rainsee-part="brand-logo"]',
    brandFont: '[data-rainsee-part="brand-title"]', brandText: '[data-rainsee-part="brand-title"]', brandSubText: '[data-rainsee-part="brand-sub"]', showBrandText: '[data-rainsee-part="brand-text"]', aiButtonStyle: '[data-rainsee-part="brand-action"][data-rainsee-action="ai"]',
    addressBackground: '[data-rainsee-part="address-bar"]', addressText: '[data-rainsee-part="address-bar"]', addressRadius: '[data-rainsee-part="address-bar"]', addressHeight: '[data-rainsee-part="address-bar"]', addressFont: '[data-rainsee-part="address-input"]', addressBorder: '[data-rainsee-part="address-bar"]', addressFocusBorder: '[data-rainsee-part="address-bar"]', addressFocusGlow: '[data-rainsee-part="address-bar"]',
    buttonSize: PLAIN_BUTTON, buttonRadius: PLAIN_BUTTON, buttonColor: PLAIN_BUTTON, buttonHover: PLAIN_BUTTON, buttonActive: PLAIN_BUTTON,
    tabBackground: '[data-rainsee-part="tab-surface"]', tabSelectedBackground: '[data-rainsee-part="tab"][data-rainsee-selected="true"] > [data-rainsee-part="tab-surface"]', tabText: '[data-rainsee-part="tab-title"]', tabSelectedText: '[data-rainsee-part="tab"][data-rainsee-selected="true"] [data-rainsee-part="tab-title"]', tabHoverBackground: '[data-rainsee-part="tab-surface"]', tabRadius: '[data-rainsee-part="tab-surface"]', tabHeight: '[data-rainsee-part="tab-surface"]', tabFont: '[data-rainsee-part="tab-title"]',
    bookmarkBackground: '[data-rainsee-part="bookmark-bar"]', bookmarkText: '[data-rainsee-part="bookmark-title"]', bookmarkFont: '[data-rainsee-part="bookmark-title"]', bookmarkItemHover: '[data-rainsee-part="bookmark-item"]',
  };
  const sidebarTargets: Record<string, string> = {
    sidebarBackground: '[data-rainsee-area="sidebar"]', sidebarText: '[data-rainsee-area="sidebar"]', sidebarNewTabBackground: '[data-rainsee-part="sidebar-new-tab"]', sidebarNewTabText: '[data-rainsee-part="sidebar-new-tab"]', sidebarNewTabRadius: '[data-rainsee-part="sidebar-new-tab"]', sidebarTabBackground: '[data-rainsee-part="sidebar-tab"]', sidebarTabSelected: '[data-rainsee-part="sidebar-tab"][data-rainsee-selected="true"]', sidebarTabRadius: '[data-rainsee-part="sidebar-tab"]', sidebarTabFont: '[data-rainsee-part="sidebar-tab-title"]',
  };
  const target = topbarTargets[key] || sidebarTargets[key];
  if (!target) return '';
  // 外框提示目标所在的区域：标签栏(含品牌/标签)、书签栏，其余顶部项归工具栏。
  const shellPart = !topbarTargets[key]
    ? ''
    : key === 'topbarBackground'
      ? ''
      : /^(titlebar|logo|brand|showBrand|aiButton|tab)/.test(key)
        ? 'titlebar'
        : /^bookmark/.test(key)
          ? 'bookmark-bar'
          : 'toolbar';
  const shell = shellPart ? `[data-rainsee-part="${shellPart}"] { box-shadow: inset 0 0 0 2px #ff3b3066, 0 0 0 2px #ff3b302b !important; }\n` : '';
  // 整条栏贴着窗口边缘，外扩的 outline 会被裁掉，改为内收。
  const isBar = /^\[data-rainsee-(part="(titlebar|toolbar|bookmark-bar)"|area="sidebar")\]$/.test(target);
  return `${shell}${target} { outline: 2px solid #ff3b30 !important; outline-offset: ${isBar ? -2 : 2}px; box-shadow: 0 0 0 4px #ff3b303d, 0 0 18px #ff3b3066 !important; }`;
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
    if (field.type === 'toggle') return v === false;
    if (field.type === 'select') return v !== getChromePanelFieldDefault(field.key);
    return num(values, field.key) !== null;
  }).length;
