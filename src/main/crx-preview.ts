import { loadAsync } from 'jszip';
import { app } from 'electron';
import { extname } from 'path';
import { parseCrx } from '~/utils/crx';
import { IExtensionInstallPreview } from '~/interfaces';

type ZipLike = import('jszip');

const ICON_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
};

// 图标/manifest 体积上限:防止畸形包把整块数据塞进 IPC。
const MAX_ICON_BYTES = 512 * 1024;

const normalizeZipPath = (p: string) =>
  String(p || '').replace(/\\/g, '/').replace(/^\.?\//, '');

const findEntry = (zip: ZipLike, p: string) => {
  const target = normalizeZipPath(p);
  if (!target) return null;
  return (
    zip.file(target) ||
    // 部分打包工具大小写不一致,退回大小写不敏感匹配。
    zip.file(new RegExp(`^${target.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}$`, 'i'))[0] ||
    null
  );
};

const readJson = async (zip: ZipLike, p: string) => {
  const entry = findEntry(zip, p);
  if (!entry) return null;
  try {
    const text = (await entry.async('string')).replace(/^﻿/, '');
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// 预览阶段扩展尚未解压,resolveExtMessage 依赖磁盘 _locales,这里直接从 zip 解析
// __MSG_key__。locale 优先级:界面语言 → 语言主码 → default_locale。
const buildMessageResolver = async (zip: ZipLike, manifest: any) => {
  const defaultLocale = String(manifest?.default_locale || '').trim();
  if (!defaultLocale) return (text: string) => text;

  let uiLocale = 'en-US';
  try {
    uiLocale = app.getLocale() || uiLocale;
  } catch {}
  const candidates = Array.from(
    new Set([
      uiLocale.replace('-', '_'),
      uiLocale.split(/[-_]/)[0],
      defaultLocale,
    ]),
  );
  const catalogs: Record<string, any>[] = [];
  for (const locale of candidates) {
    const messages = await readJson(zip, `_locales/${locale}/messages.json`);
    if (messages && typeof messages === 'object') catalogs.push(messages);
  }

  return (text: string) => {
    const match = /^__MSG_(.+)__$/i.exec(String(text || ''));
    if (!match) return text;
    const key = match[1].toLowerCase();
    for (const catalog of catalogs) {
      for (const [k, v] of Object.entries(catalog)) {
        if (k.toLowerCase() === key && (v as any)?.message) {
          return String((v as any).message);
        }
      }
    }
    return text;
  };
};

const pickIconPath = (manifest: any): string => {
  const sized = (icons: any): string => {
    if (!icons) return '';
    if (typeof icons === 'string') return icons;
    if (typeof icons !== 'object') return '';
    const sizes = Object.keys(icons)
      .map((size) => Number(size))
      .filter((size) => Number.isFinite(size))
      .sort((a, b) => a - b);
    if (!sizes.length) return '';
    // 弹窗以 32~48px 显示,取 >=48 的最小尺寸;都偏小则取最大。
    const best = sizes.find((size) => size >= 48) ?? sizes[sizes.length - 1];
    return String(icons[best] || '');
  };
  return (
    sized(manifest?.icons) ||
    sized(manifest?.action?.default_icon) ||
    sized(manifest?.browser_action?.default_icon) ||
    sized(manifest?.page_action?.default_icon)
  );
};

const readIconDataUrl = async (zip: ZipLike, iconPath: string) => {
  const entry = iconPath ? findEntry(zip, iconPath) : null;
  if (!entry) return '';
  const mime = ICON_MIME[extname(iconPath).toLowerCase()];
  if (!mime) return '';
  try {
    const data = await entry.async('nodebuffer');
    if (!data.length || data.length > MAX_ICON_BYTES) return '';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch {
    return '';
  }
};

const isHostPattern = (value: string) =>
  value === '<all_urls>' || /^(\*|https?|wss?|ftp|file|urn):\/\//i.test(value);

/**
 * 解析 CRX/ZIP 包,生成安装确认弹窗需要的展示信息(不落盘、不安装)。
 * 权限文案在渲染层按 Chrome 规则翻译,这里只给出原始 permission / host 列表。
 */
export const buildCrxPreview = async (
  crxBuf: Buffer,
): Promise<{ preview: IExtensionInstallPreview; crxInfo: any }> => {
  const crxInfo = parseCrx(crxBuf);
  if (!crxInfo?.id || !crxInfo.zip) {
    throw new Error('invalid crx package');
  }
  const zip = await loadAsync(crxInfo.zip);
  const manifest = await readJson(zip, 'manifest.json');
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('manifest.json missing');
  }

  const resolve = await buildMessageResolver(zip, manifest);
  const resolvedName = resolve(manifest.name);
  // 名称解析失败(仍是 __MSG_x__)时退回 short_name,再退回扩展 ID。
  const name =
    (resolvedName && !/^__MSG_/i.test(resolvedName) && resolvedName) ||
    resolve(manifest.short_name) ||
    crxInfo.id;

  const permissions = new Set<string>();
  const hosts = new Set<string>();
  const rawPermissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  for (const item of rawPermissions) {
    if (typeof item !== 'string') continue;
    // MV2 把 host 模式混在 permissions 里。
    if (isHostPattern(item)) hosts.add(item);
    else permissions.add(item);
  }
  for (const item of Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []) {
    if (typeof item === 'string') hosts.add(item);
  }
  // Chrome 把 content_scripts.matches 也计入「读取和更改网站数据」警告。
  for (const script of Array.isArray(manifest.content_scripts) ? manifest.content_scripts : []) {
    for (const match of Array.isArray(script?.matches) ? script.matches : []) {
      if (typeof match === 'string') hosts.add(match);
    }
  }

  const preview: IExtensionInstallPreview = {
    id: crxInfo.id,
    name: String(name || crxInfo.id),
    version: String(manifest.version || ''),
    description: String(resolve(manifest.description) || ''),
    iconUrl: await readIconDataUrl(zip, pickIconPath(manifest)),
    permissions: Array.from(permissions),
    hosts: Array.from(hosts),
    isTheme: !!manifest.theme && typeof manifest.theme === 'object',
    installedVersion: '',
  };
  return { preview, crxInfo };
};
