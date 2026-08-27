import { app } from 'electron';
import { createHash } from 'crypto';
import { existsSync, promises } from 'fs';
import { basename, dirname, extname, join, relative, resolve } from 'path';

import {
  BrowserExtensionSourceType,
  IBrowserExtensionImportItem,
  IBrowserExtensionImportScan,
  IBrowserExtensionImportSource,
} from '~/interfaces';
import { getCrxIdByKey } from '~/utils/crx';

const EXTENSION_ID_RE = /^[a-p]{32}$/i;
const MAX_ICON_BYTES = 1024 * 1024;

interface BrowserRoot {
  browser: BrowserExtensionSourceType;
  browserName: string;
  path: string;
}

interface ExtensionRoot extends BrowserRoot {
  profileName: string;
  profilePath: string;
  extensionsPath: string;
  excludedExtensionIds: Set<string>;
}

export interface BrowserExtensionImportCandidate
  extends IBrowserExtensionImportItem {
  sourcePath: string;
  sourceSeed: string;
}

export interface BrowserExtensionScanResult {
  scan: IBrowserExtensionImportScan;
  candidates: Map<string, BrowserExtensionImportCandidate>;
}

const isDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await promises.stat(path)).isDirectory();
  } catch {
    return false;
  }
};

const readJson = async (path: string): Promise<any | null> => {
  try {
    return JSON.parse(await promises.readFile(path, 'utf8'));
  } catch {
    return null;
  }
};

const compareVersions = (a: string, b: string): number => {
  const aa = a.split(/[^0-9]+/).map((part) => Number(part) || 0);
  const bb = b.split(/[^0-9]+/).map((part) => Number(part) || 0);
  const length = Math.max(aa.length, bb.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (aa[i] || 0) - (bb[i] || 0);
    if (diff) return diff;
  }
  return a.localeCompare(b);
};

const inferBrowser = (path: string): BrowserRoot => {
  const normalized = path.toLowerCase();
  if (normalized.includes('edge') || normalized.includes('microsoft')) {
    return { browser: 'edge', browserName: 'Microsoft Edge', path };
  }
  if (normalized.includes('chrome') || normalized.includes('google')) {
    return { browser: 'chrome', browserName: 'Google Chrome', path };
  }
  return { browser: 'browser', browserName: '本地浏览器', path };
};

const getDefaultBrowserRoots = (): BrowserRoot[] => {
  const home = app.getPath('home');
  if (process.platform === 'win32') {
    const localAppData =
      process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return [
      {
        browser: 'chrome',
        browserName: 'Google Chrome',
        path: join(localAppData, 'Google', 'Chrome', 'User Data'),
      },
      {
        browser: 'edge',
        browserName: 'Microsoft Edge',
        path: join(localAppData, 'Microsoft', 'Edge', 'User Data'),
      },
    ];
  }
  if (process.platform === 'darwin') {
    return [
      {
        browser: 'chrome',
        browserName: 'Google Chrome',
        path: join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
      },
      {
        browser: 'edge',
        browserName: 'Microsoft Edge',
        path: join(home, 'Library', 'Application Support', 'Microsoft Edge'),
      },
    ];
  }
  return [
    {
      browser: 'chrome',
      browserName: 'Google Chrome',
      path: join(home, '.config', 'google-chrome'),
    },
    {
      browser: 'edge',
      browserName: 'Microsoft Edge',
      path: join(home, '.config', 'microsoft-edge'),
    },
  ];
};

const readProfileNames = async (userDataPath: string) => {
  const localState = await readJson(join(userDataPath, 'Local State'));
  const cache = localState?.profile?.info_cache;
  if (!cache || typeof cache !== 'object') return {} as Record<string, string>;
  const names: Record<string, string> = {};
  Object.keys(cache).forEach((profileDir) => {
    const profileName = cache[profileDir]?.name;
    if (typeof profileName === 'string' && profileName.trim()) {
      names[profileDir] = profileName.trim();
    }
  });
  return names;
};

const readExcludedExtensionIds = async (profilePath: string) => {
  const preferences = await readJson(join(profilePath, 'Secure Preferences'));
  const settings = preferences?.extensions?.settings;
  const excluded = new Set<string>();
  if (!settings || typeof settings !== 'object') return excluded;
  Object.keys(settings).forEach((id) => {
    const item = settings[id];
    // location=1 是浏览器配置内由用户安装的扩展；Edge 自带组件通常为 5/10。
    if (
      item?.was_installed_by_default === true ||
      (typeof item?.location === 'number' && item.location !== 1)
    ) {
      excluded.add(id.toLowerCase());
    }
  });
  return excluded;
};

const findDefaultExtensionRoots = async (
  root: BrowserRoot,
): Promise<ExtensionRoot[]> => {
  if (!(await isDirectory(root.path))) return [];
  const profileNames = await readProfileNames(root.path);
  let entries: any[] = [];
  try {
    entries = await promises.readdir(root.path, { withFileTypes: true });
  } catch {
    return [];
  }
  const profiles = entries.filter(
    (entry) =>
      entry.isDirectory() &&
      (entry.name === 'Default' || /^Profile \d+$/i.test(entry.name)),
  );
  const roots: ExtensionRoot[] = [];
  for (const profile of profiles) {
    const profilePath = join(root.path, profile.name);
    const extensionsPath = join(profilePath, 'Extensions');
    if (!(await isDirectory(extensionsPath))) continue;
    roots.push({
      ...root,
      profileName:
        profileNames[profile.name] ||
        (profile.name === 'Default' ? '默认配置' : profile.name),
      profilePath,
      extensionsPath,
      excludedExtensionIds: await readExcludedExtensionIds(profilePath),
    });
  }
  return roots;
};

const looksLikeExtensionRoot = async (path: string): Promise<boolean> => {
  let entries: any[] = [];
  try {
    entries = await promises.readdir(path, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some(
    (entry) => entry.isDirectory() && EXTENSION_ID_RE.test(entry.name),
  );
};

// 用户可能选择 User Data、某个 Profile、Extensions，甚至浏览器的上级目录。
// 在有限深度与数量内寻找 Extensions，避免对任意大目录做无界递归。
const findCustomExtensionRoots = async (
  selectedPath: string,
): Promise<ExtensionRoot[]> => {
  const browser = inferBrowser(selectedPath);
  const queue = [{ path: resolve(selectedPath), depth: 0 }];
  const visited = new Set<string>();
  const found: ExtensionRoot[] = [];

  while (queue.length > 0 && visited.size < 200) {
    const current = queue.shift();
    if (!current || visited.has(current.path)) continue;
    visited.add(current.path);
    if (!(await isDirectory(current.path))) continue;

    const isNamedExtensions =
      basename(current.path).toLowerCase() === 'extensions';
    if (isNamedExtensions || (await looksLikeExtensionRoot(current.path))) {
      const profilePath = isNamedExtensions
        ? dirname(current.path)
        : current.path;
      found.push({
        ...browser,
        profileName: basename(profilePath) || '所选配置',
        profilePath,
        extensionsPath: current.path,
        excludedExtensionIds: await readExcludedExtensionIds(profilePath),
      });
      continue;
    }

    if (current.depth >= 4) continue;
    let entries: any[] = [];
    try {
      entries = await promises.readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      queue.push({
        path: join(current.path, entry.name),
        depth: current.depth + 1,
      });
    }
  }

  return found;
};

const resolveLocalizedText = async (
  value: unknown,
  manifest: any,
  extensionPath: string,
): Promise<string> => {
  if (typeof value !== 'string') return '';
  const match = /^__MSG_(.+)__$/.exec(value);
  if (!match) return value;

  const localeRoot = join(extensionPath, '_locales');
  const appLocale = app.getLocale().replace('-', '_');
  const locales = [
    appLocale,
    manifest?.default_locale,
    'zh_CN',
    'zh_TW',
    'en',
    'en_US',
  ]
    .filter(Boolean)
    .filter((locale, index, all) => all.indexOf(locale) === index);

  try {
    const available = await promises.readdir(localeRoot);
    available.forEach((locale) => {
      if (!locales.includes(locale)) locales.push(locale);
    });
  } catch {}

  for (const locale of locales) {
    const messages = await readJson(join(localeRoot, locale, 'messages.json'));
    const messageKey =
      messages &&
      Object.keys(messages).find(
        (key) => key.toLowerCase() === match[1].toLowerCase(),
      );
    const message = messageKey ? messages[messageKey]?.message : undefined;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return value;
};

const readIcon = async (
  manifest: any,
  extensionPath: string,
): Promise<string> => {
  const icons = manifest?.icons;
  if (!icons || typeof icons !== 'object') return '';
  const paths = Object.keys(icons)
    .sort((a, b) => (Number(b) || 0) - (Number(a) || 0))
    .map((size) => icons[size])
    .filter((path) => typeof path === 'string');

  for (const iconPath of paths) {
    const fullPath = resolve(extensionPath, iconPath.replace(/^[/\\]+/, ''));
    const rel = relative(extensionPath, fullPath);
    if (rel.startsWith('..') || resolve(fullPath) === resolve(extensionPath))
      continue;
    try {
      const stat = await promises.stat(fullPath);
      if (!stat.isFile() || stat.size > MAX_ICON_BYTES) continue;
      const content = await promises.readFile(fullPath);
      const extension = extname(fullPath).toLowerCase();
      const mime =
        extension === '.svg'
          ? 'image/svg+xml'
          : extension === '.jpg' || extension === '.jpeg'
          ? 'image/jpeg'
          : extension === '.webp'
          ? 'image/webp'
          : 'image/png';
      return `data:${mime};base64,${content.toString('base64')}`;
    } catch {}
  }
  return '';
};

const findLatestManifest = async (extensionIdPath: string) => {
  let versions: any[] = [];
  try {
    versions = await promises.readdir(extensionIdPath, { withFileTypes: true });
  } catch {
    return null;
  }
  versions.sort((a, b) => compareVersions(b.name, a.name));
  for (const version of versions) {
    if (!version.isDirectory()) continue;
    const extensionPath = join(extensionIdPath, version.name);
    const manifest = await readJson(join(extensionPath, 'manifest.json'));
    if (manifest?.name && manifest?.version) return { extensionPath, manifest };
  }
  return null;
};

const scanExtensionRoot = async (
  root: ExtensionRoot,
): Promise<BrowserExtensionImportCandidate[]> => {
  let extensionIds: any[] = [];
  try {
    extensionIds = await promises.readdir(root.extensionsPath, {
      withFileTypes: true,
    });
  } catch {
    return [];
  }
  const candidates: BrowserExtensionImportCandidate[] = [];
  for (const entry of extensionIds) {
    if (!entry.isDirectory() || !EXTENSION_ID_RE.test(entry.name)) continue;
    if (root.excludedExtensionIds.has(entry.name.toLowerCase())) continue;
    const latest = await findLatestManifest(
      join(root.extensionsPath, entry.name),
    );
    if (!latest) continue;
    const { extensionPath, manifest } = latest;
    let id = entry.name.toLowerCase();
    try {
      if (manifest.key) id = getCrxIdByKey(manifest.key);
    } catch {}
    if (!EXTENSION_ID_RE.test(id)) continue;
    const sourceSeed = `browser-import:${root.browser}:${root.profilePath}:${entry.name}`;
    const key = createHash('sha256').update(sourceSeed).digest('hex');
    candidates.push({
      key,
      id,
      name: await resolveLocalizedText(manifest.name, manifest, extensionPath),
      version: String(manifest.version || ''),
      description: await resolveLocalizedText(
        manifest.description,
        manifest,
        extensionPath,
      ),
      icon: await readIcon(manifest, extensionPath),
      browser: root.browser,
      browserName: root.browserName,
      profileName: root.profileName,
      sourcePath: extensionPath,
      sourceSeed,
    });
  }
  return candidates;
};

export const scanBrowserExtensions = async (
  installedIds: Set<string>,
  customRoot?: string,
): Promise<BrowserExtensionScanResult> => {
  let roots: ExtensionRoot[] = [];
  let detected = false;

  if (customRoot) {
    detected = await isDirectory(customRoot);
    roots = detected ? await findCustomExtensionRoots(customRoot) : [];
  } else {
    const browserRoots = getDefaultBrowserRoots();
    detected = browserRoots.some((root) => existsSync(root.path));
    for (const root of browserRoots) {
      roots.push(...(await findDefaultExtensionRoots(root)));
    }
  }

  const sourceMap = new Map<string, IBrowserExtensionImportSource>();
  const bestById = new Map<string, BrowserExtensionImportCandidate>();
  let duplicateCount = 0;
  for (const root of roots) {
    sourceMap.set(root.extensionsPath, {
      browser: root.browser,
      browserName: root.browserName,
      profileName: root.profileName,
      path: root.extensionsPath,
    });
    for (const candidate of await scanExtensionRoot(root)) {
      if (installedIds.has(candidate.id)) {
        duplicateCount += 1;
        continue;
      }
      const existing = bestById.get(candidate.id);
      if (existing) {
        duplicateCount += 1;
        if (compareVersions(candidate.version, existing.version) <= 0) continue;
      }
      bestById.set(candidate.id, candidate);
    }
  }

  const candidates = new Map<string, BrowserExtensionImportCandidate>();
  const items = [...bestById.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .map((candidate) => {
      candidates.set(candidate.key, candidate);
      return {
        key: candidate.key,
        id: candidate.id,
        name: candidate.name,
        version: candidate.version,
        description: candidate.description,
        icon: candidate.icon,
        browser: candidate.browser,
        browserName: candidate.browserName,
        profileName: candidate.profileName,
      };
    });

  return {
    scan: {
      canceled: false,
      detected,
      duplicateCount,
      items,
      sources: [...sourceMap.values()],
    },
    candidates,
  };
};
