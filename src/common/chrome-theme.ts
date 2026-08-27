import { IChromeTheme, ITheme, ChromeThemeTint } from '~/interfaces';

const THEME_ASSET_HOST = 'theme-assets';
const COLOR_KEY = /^[a-z][a-z0-9_]*$/;
const IMAGE_KEY = /^theme_[a-z0-9_]+$/;
const PROPERTY_KEY = /^[a-z][a-z0-9_]*$/;

const clampByte = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value)));

const normalizeColor = (value: unknown): string | null => {
  if (!Array.isArray(value) || (value.length !== 3 && value.length !== 4)) {
    return null;
  }
  const channels = value.map(Number);
  if (!channels.every(Number.isFinite)) return null;
  const [r, g, b] = channels.map(clampByte);
  if (channels.length === 3) return `rgb(${r}, ${g}, ${b})`;
  const rawAlpha = channels[3];
  const alpha = rawAlpha > 1 ? rawAlpha / 255 : rawAlpha;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
};

const normalizeImagePath = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value || value.length > 1024) return null;
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (
    normalized.startsWith('/') ||
    normalized.includes('\0') ||
    normalized
      .split('/')
      .some((part) => !part || part === '.' || part === '..') ||
    /^[a-z][a-z0-9+.-]*:/i.test(normalized)
  ) {
    return null;
  }
  return normalized;
};

export const buildChromeThemeAssetUrl = (id: string, resourcePath: string) =>
  `yjllq://${THEME_ASSET_HOST}/${encodeURIComponent(id)}/${resourcePath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

export const normalizeChromeTheme = (
  id: string,
  name: string,
  rawTheme: any,
): IChromeTheme | null => {
  if (!/^[a-p]{32}$/.test(id) || !rawTheme || typeof rawTheme !== 'object') {
    return null;
  }

  const colors: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(rawTheme.colors || {})) {
    if (!COLOR_KEY.test(key)) continue;
    const color = normalizeColor(value);
    if (color) colors[key] = color;
  }

  const images: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(rawTheme.images || {})) {
    if (!IMAGE_KEY.test(key)) continue;
    const resourcePath = normalizeImagePath(value);
    if (resourcePath) images[key] = buildChromeThemeAssetUrl(id, resourcePath);
  }

  const tints: { [key: string]: ChromeThemeTint } = {};
  for (const [key, value] of Object.entries(rawTheme.tints || {})) {
    if (!COLOR_KEY.test(key) || !Array.isArray(value) || value.length !== 3) {
      continue;
    }
    const tint = value.map(Number);
    if (!tint.every(Number.isFinite)) continue;
    tints[key] = tint.map((part) =>
      Math.max(-1, Math.min(1, part)),
    ) as ChromeThemeTint;
  }

  const properties: { [key: string]: string | number | boolean } = {};
  for (const [key, value] of Object.entries(rawTheme.properties || {})) {
    if (!PROPERTY_KEY.test(key)) continue;
    if (typeof value === 'boolean' || typeof value === 'number') {
      properties[key] = value;
    } else if (typeof value === 'string' && value.length <= 128) {
      properties[key] = value;
    }
  }

  return {
    id,
    name: typeof name === 'string' ? name.slice(0, 256) : id,
    colors,
    images,
    tints,
    properties,
  };
};

const parseCssColor = (
  value: string,
): [number, number, number, number] | null => {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value || '');
  if (hex) {
    const raw =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((part) => part + part)
            .join('')
        : hex[1];
    return [
      parseInt(raw.slice(0, 2), 16),
      parseInt(raw.slice(2, 4), 16),
      parseInt(raw.slice(4, 6), 16),
      1,
    ];
  }
  const match =
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
      value || '',
    );
  if (!match) return null;
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    match[4] == null ? 1 : Number(match[4]),
  ];
};

const tintColor = (
  value: string,
  tint: ChromeThemeTint | undefined,
): string => {
  const parsed = parseCssColor(value);
  if (!parsed || !tint) return value;
  let [r, g, b] = parsed.map((part) => part / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation =
      lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue /= 6;
  }
  hue = tint[0] < 0 ? hue : tint[0];
  saturation = tint[1] < 0 ? saturation : tint[1];
  const nextLightness = tint[2] < 0 ? lightness : tint[2];
  const hueToRgb = (p: number, q: number, t: number) => {
    let channel = t;
    if (channel < 0) channel += 1;
    if (channel > 1) channel -= 1;
    if (channel < 1 / 6) return p + (q - p) * 6 * channel;
    if (channel < 1 / 2) return q;
    if (channel < 2 / 3) return p + (q - p) * (2 / 3 - channel) * 6;
    return p;
  };
  if (saturation === 0) {
    r = g = b = nextLightness;
  } else {
    const q =
      nextLightness < 0.5
        ? nextLightness * (1 + saturation)
        : nextLightness + saturation - nextLightness * saturation;
    const p = 2 * nextLightness - q;
    r = hueToRgb(p, q, hue + 1 / 3);
    g = hueToRgb(p, q, hue);
    b = hueToRgb(p, q, hue - 1 / 3);
  }
  return `rgb(${clampByte(r * 255)}, ${clampByte(g * 255)}, ${clampByte(
    b * 255,
  )})`;
};

const luminance = (value: string): number => {
  const parsed = parseCssColor(value);
  if (!parsed) return 1;
  const channel = (part: number) => {
    const v = part / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(parsed[0]) +
    0.7152 * channel(parsed[1]) +
    0.0722 * channel(parsed[2])
  );
};

const contrastText = (background: string) =>
  luminance(background) < 0.38 ? 'rgb(255, 255, 255)' : 'rgb(32, 33, 36)';

const withAlpha = (value: string, alpha: number): string => {
  const parsed = parseCssColor(value);
  return parsed
    ? `rgba(${parsed[0]}, ${parsed[1]}, ${parsed[2]}, ${alpha})`
    : value;
};

const mix = (value: string, target: 0 | 255, amount: number): string => {
  const parsed = parseCssColor(value);
  if (!parsed) return value;
  return `rgb(${[parsed[0], parsed[1], parsed[2]]
    .map((part) => Math.round(part + (target - part) * amount))
    .join(', ')})`;
};

// 工作区色与 Chrome 主题色都可能是 #rgb/#rrggbb/rgb()/rgba()。统一从这里混色，
// 避免渲染层各自解析导致 rgba 主题下工作区色静默失效。
export const mixCssColors = (
  background: string,
  foreground: string,
  amount: number,
): string => {
  const base = parseCssColor(background);
  const accent = parseCssColor(foreground);
  if (!base || !accent) return background;
  const ratio = Math.max(0, Math.min(1, amount));
  return `rgb(${[0, 1, 2]
    .map((index) => Math.round(base[index] * (1 - ratio) + accent[index] * ratio))
    .join(', ')})`;
};

// Maps Chrome's public theme color names onto Rainsee's existing shell theme.
// The returned object is computed once per settings update and remains a plain
// styled-components theme, so component render paths do no manifest parsing.
export const mergeChromeTheme = (
  base: ITheme,
  chromeTheme: IChromeTheme | null | undefined,
): ITheme => {
  if (!chromeTheme) return base;
  const c = chromeTheme.colors;
  const frame =
    c.frame ||
    tintColor(base['titlebar.backgroundColor'], chromeTheme.tints.frame);
  const toolbar = c.toolbar || base['toolbar.backgroundColor'];
  const icon =
    c.toolbar_button_icon ||
    tintColor(contrastText(toolbar), chromeTheme.tints.buttons);
  const toolbarLightForeground = luminance(icon) > 0.55;
  const toolbarText = c.bookmark_text || contrastText(toolbar);
  const omniboxBackground =
    c.omnibox_background ||
    mix(toolbar, luminance(toolbar) < 0.38 ? 255 : 0, 0.12);
  const omniboxText = c.omnibox_text || toolbarText;
  const controlBackground = c.control_background || withAlpha(icon, 0.1);
  const controlText = c.control_text || icon;
  const selectedTabText = c.tab_text || toolbarText;
  const inactiveTabText = c.tab_background_text || contrastText(frame);
  // Chrome uses the toolbar color/image for the active tab. The optional
  // background_tab color belongs to inactive tabs; when it is omitted, keep
  // the tab strip on the toolbar color instead of falling back to frame.
  const selectedTabBackground = c.toolbar || toolbar;
  const inactiveTabBackground = c.background_tab || toolbar;

  return {
    ...base,
    'titlebar.backgroundColor': frame,
    'toolbar.backgroundColor': toolbar,
    'toolbar.bottomLine.backgroundColor': withAlpha(icon, 0.18),
    'toolbar.separator.color': withAlpha(icon, 0.2),
    'toolbar.lightForeground': toolbarLightForeground,
    'addressbar.backgroundColor': omniboxBackground,
    'addressbar.textColor': omniboxText,
    'bookmark.textColor': c.bookmark_text || toolbarText,
    'tab.textColor': inactiveTabText,
    'tab.selected.textColor': selectedTabText,
    'tab.backgroundColor': inactiveTabBackground,
    'tab.selected.backgroundColor': selectedTabBackground,
    'control.backgroundColor': controlBackground,
    'control.hover.backgroundColor':
      c.button_background || withAlpha(controlText, 0.16),
    'control.valueColor': controlText,
    'control.lightIcon': toolbarLightForeground,
    'switch.backgroundColor': withAlpha(icon, 0.24),
    'sidebar.backgroundColor': c.vertical_frame || frame,
    'sidebar.tab.backgroundColor': c.vertical_background_tab || 'transparent',
    'sidebar.tab.inactiveBackgroundColor':
      c.vertical_background_tab_inactive ||
      c.vertical_background_tab ||
      'transparent',
    'sidebar.tab.selectedBackgroundColor': c.vertical_active_tab || toolbar,
    'sidebar.tab.textColor': c.vertical_tab_background_text || inactiveTabText,
    'sidebar.tab.selectedTextColor': c.vertical_tab_text || selectedTabText,
    accentColor: c.button_background || base.accentColor,
  };
};

export const getChromeThemeNtpStyle = (
  chromeTheme: IChromeTheme | null | undefined,
) => {
  if (!chromeTheme) return null;
  const backgroundColor =
    chromeTheme.colors.ntp_background ||
    chromeTheme.colors.frame ||
    'rgb(255, 255, 255)';
  const backgroundImage = chromeTheme.images.theme_ntp_background || '';
  const alignment = String(
    chromeTheme.properties.ntp_background_alignment || 'center',
  );
  const repeat = String(
    chromeTheme.properties.ntp_background_repeat || 'no-repeat',
  );
  return {
    backgroundColor,
    backgroundImage,
    backgroundPosition:
      /^(?:(?:top|bottom|center)(?:\s+(?:left|right|center))?|(?:left|right)(?:\s+(?:top|bottom|center))?)$/i.test(
        alignment,
      )
        ? alignment
        : 'center',
    backgroundRepeat: /^(?:no-repeat|repeat|repeat-x|repeat-y)$/i.test(repeat)
      ? repeat
      : 'no-repeat',
    color: chromeTheme.colors.ntp_text || contrastText(backgroundColor),
    linkColor: chromeTheme.colors.ntp_link || '',
  };
};
