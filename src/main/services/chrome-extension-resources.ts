import {Application} from '../application';
import {getIconByUrlNet} from '~/utils/url';
import {resolve, extname} from 'path';
import {readFile} from 'fs/promises';

const FAVICON_PATHS = new Set(['/_favicon', '/_favicon/']);
const MAX_PLACEHOLDER_SIZE = 128;

const normalizeLookupUrl = (rawUrl: string) => {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return rawUrl;
  }
};

const getLookupHost = (rawUrl: string) => {
  try {
    return new URL(rawUrl).host.toLowerCase();
  } catch {
    return '';
  }
};

const sameLookupUrl = (a: string, b: string) =>
  !!a && !!b && normalizeLookupUrl(a) === normalizeLookupUrl(b);

const normalizeDataUrl = (value: string) => {
  if (!value.startsWith('data:')) return value;
  const commaIndex = value.indexOf(',');
  if (commaIndex < 0) return value;
  const header = value.slice(0, commaIndex);
  if (header.includes('image/')) return value;
  return value.replace(/^data:/, 'data:image/');
};

const faviconValueToDataUrl = (value?: string) => {
  if (!value) return '';
  if (value.startsWith('data:')) return normalizeDataUrl(value);
  const stored = Application.instance?.storage?.favicons?.get(value) || '';
  return stored ? normalizeDataUrl(stored) : '';
};

const findOpenViewFavicon = (pageUrl: string, host: string) => {
  let hostFallback = '';
  for (const win of Application.instance?.windows?.list || []) {
    const views: Map<any, any> | undefined = win?.viewManager?.views;
    if (!views || typeof views.values !== 'function') continue;
    for (const view of views.values()) {
      if (!view || typeof view.url !== 'string') continue;
      const dataUrl = faviconValueToDataUrl(view.favicon);
      if (!dataUrl) continue;
      if (sameLookupUrl(view.url, pageUrl)) return dataUrl;
      if (!hostFallback && host && getLookupHost(view.url) === host) {
        hostFallback = dataUrl;
      }
    }
  }
  return hostFallback;
};

const findStoredFavicon = (
  items: Array<{url?: string; favicon?: string}> | undefined,
  pageUrl: string,
  host: string,
) => {
  if (!Array.isArray(items)) return '';
  let hostFallback = '';
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!item || typeof item.url !== 'string') continue;
    const dataUrl = faviconValueToDataUrl(item.favicon);
    if (!dataUrl) continue;
    if (sameLookupUrl(item.url, pageUrl)) return dataUrl;
    if (!hostFallback && host && getLookupHost(item.url) === host) {
      hostFallback = dataUrl;
    }
  }
  return hostFallback;
};

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const buildPlaceholderDataUrl = (pageUrl: string, size: number) => {
  const safeSize = Math.max(16, Math.min(MAX_PLACEHOLDER_SIZE, size || 32));
  let host = '';
  let protocol = '';
  try {
    const parsed = new URL(pageUrl);
    host = parsed.hostname || parsed.host || '';
    protocol = parsed.protocol.replace(/:$/, '');
  } catch {
    host = '';
    protocol = '';
  }
  const basis = host || protocol || pageUrl || 'site';
  const letterMatch = basis.match(/[A-Za-z0-9]/);
  const label = (letterMatch ? letterMatch[0] : '?').toUpperCase();

  let hue = 0;
  for (let i = 0; i < basis.length; i++) {
    hue = (hue * 33 + basis.charCodeAt(i)) % 360;
  }

  const radius = Math.round(safeSize * 0.22);
  const fontSize = Math.max(10, Math.round(safeSize * 0.48));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${safeSize}" height="${safeSize}" viewBox="0 0 ${safeSize} ${safeSize}">` +
    `<rect width="${safeSize}" height="${safeSize}" rx="${radius}" fill="hsl(${hue} 52% 46%)"/>` +
    `<text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" ` +
    `font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">` +
    `${escapeXml(label)}` +
    `</text></svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
};

const resolveCachedFavicon = (pageUrl: string) => {
  const onlineIconUrl = getIconByUrlNet(pageUrl);
  return Application.instance?.storage?.favicons?.get(onlineIconUrl) || '';
};

const resolveExtensionFallbackIcon = (extensionId: string, requestedSize: number) => {
  const sessions = [
    Application.instance?.sessions?.view,
    Application.instance?.sessions?.viewIncognito,
  ];
  for (const targetSession of sessions) {
    try {
      const extensions = targetSession?.extensions || targetSession;
      const extension = extensions?.getExtension?.(extensionId);
      const icons = extension?.manifest?.icons as Record<string, string> | undefined;
      if (!extension || !icons || typeof icons !== 'object') continue;
      const sizes = Object.keys(icons)
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b);
      if (!sizes.length) continue;
      const selected = sizes.find((size) => size >= requestedSize) || sizes[sizes.length - 1];
      const iconPath = icons[String(selected)];
      if (!iconPath) continue;
      return new URL(iconPath.replace(/^\/+/, ''), extension.url).href;
    } catch {
      // Try the next extension session.
    }
  }
  return '';
};

// 读取扩展 manifest 声明的最佳图标并转为 base64 data URL,用于扩展页
// (chrome-extension://) 的 favicon。chrome-extension:// URL 在扩展停用 / CSP
// 限制下无法被 <img> 直接加载,data URL 是稳妥形式。
// 图标选择优先级与 sessions-service.pickIcon 一致:
//   manifest.icons > browser_action.default_icon > action.default_icon
//   尺寸优先级 ['128','96','64','48','32','19','16'](倾向高清,渲染层缩放到 16px)
// 任一扩展都无图标 / 扩展未加载时返回空串(调用方维持默认兜底)。
export const resolveExtensionIconDataUrl = async (
  extensionId: string,
): Promise<string> => {
  if (!extensionId) return '';
  const sessions = [
    Application.instance?.sessions?.view,
    Application.instance?.sessions?.viewIncognito,
  ];
  for (const targetSession of sessions) {
    try {
      const extensions = targetSession?.extensions || targetSession;
      const extension = extensions?.getExtension?.(extensionId);
      if (!extension || !extension.path || !extension.manifest) continue;

      const manifest = extension.manifest;
      const icons =
        manifest.icons ||
        manifest.browser_action?.default_icon ||
        manifest.action?.default_icon;
      if (!icons) continue;

      let relPath = '';
      if (typeof icons === 'string') {
        relPath = icons;
      } else {
        const preferredSizes = ['128', '96', '64', '48', '32', '19', '16'];
        for (const size of preferredSizes) {
          if (icons[size]) {
            relPath = icons[size];
            break;
          }
        }
        if (!relPath) {
          const values = Object.values(icons as Record<string, string>);
          relPath = values[values.length - 1] || '';
        }
      }
      if (!relPath) continue;
      if (relPath.startsWith('data:')) return relPath;

      const file = resolve(extension.path, relPath.replace(/^\/+/, ''));
      const buf = await readFile(file);
      const ext = extname(file).slice(1).toLowerCase();
      const mime =
        ext === 'svg'
          ? 'image/svg+xml'
          : ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : ext === 'webp'
          ? 'image/webp'
          : 'image/png';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      // Try the next extension session.
    }
  }
  return '';
};

export const resolveChromeExtensionResourceUrl = (rawUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== 'chrome-extension:') return undefined;
  const pathname = (parsed.pathname || '').toLowerCase();
  if (!FAVICON_PATHS.has(pathname)) return undefined;

  // The webRequest callback must remain synchronous and must never let an
  // early-startup storage race escape into Electron's network stack. The
  // caller extension's "favicon" permission is not available at this host
  // layer, so this resource is intentionally resolved for all extensions.
  try {
    const pageUrl = parsed.searchParams.get('pageUrl') || '';
    const size = Number.parseInt(parsed.searchParams.get('size') || '32', 10);
    const safePageUrl = normalizeLookupUrl(pageUrl);
    const safeSize = Number.isFinite(size) ? size : 32;
    const host = getLookupHost(safePageUrl);

    const fromOpenView = findOpenViewFavicon(safePageUrl, host);
    if (fromOpenView) return fromOpenView;

    const fromHistory = findStoredFavicon(
      Application.instance?.storage?.history,
      safePageUrl,
      host,
    );
    if (fromHistory) return fromHistory;

    const fromBookmarks = findStoredFavicon(
      Application.instance?.storage?.bookmarks,
      safePageUrl,
      host,
    );
    if (fromBookmarks) return fromBookmarks;

    const fromCache = resolveCachedFavicon(safePageUrl);
    if (fromCache) return fromCache;

    // Keep the fallback on the extension origin. Chromium rejects a
    // chrome-extension: -> data: redirect under extension-page CSP, which turns
    // Image.onload into onerror. A manifest icon remains a valid image response
    // and is only used when no real page favicon exists.
    const extensionIcon = resolveExtensionFallbackIcon(parsed.hostname, safeSize);
    if (extensionIcon) return extensionIcon;

    // Extensions without icons still receive a finite response rather than the
    // permanently pending Electron-owned /_favicon/ request.
    return buildPlaceholderDataUrl(safePageUrl, safeSize);
  } catch {
    try {
      return buildPlaceholderDataUrl('', 32);
    } catch {
      return undefined;
    }
  }
};
