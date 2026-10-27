import { app } from 'electron';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { lookup } from 'dns';
import { createHash } from 'crypto';
import { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { promisify } from 'util';

import {
  decideProxyRoute,
  generateProxyPac,
  IProxyRoutingSettings,
  parseGfwList,
  parseProxyRules,
  ProxyRouteData,
  ProxyRuleSet,
} from '~/common/proxy-routing';

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const UPDATE_INTERVAL = 24 * 60 * 60 * 1000;
const CACHE_DIR = join(app.getPath('userData'), 'proxy-rules');
const META_FILE = join(CACHE_DIR, 'metadata.json');
const GFWLIST_FILE = join(CACHE_DIR, 'gfwlist.txt');
const GENERATED_PAC_FILE = join(CACHE_DIR, 'generated.pac');

interface CacheMetadata {
  gfwUpdatedAt?: number;
  gfwListUrl?: string;
  gfwEtag?: string;
  gfwLastModified?: string;
}

export interface ProxyRuleServiceStatus {
  updating: boolean;
  gfwUpdatedAt?: number;
  gfwRules: number;
  gfwIgnored: number;
  lastError?: string;
}

type DataChangedListener = () => void;

const bundledPath = (name: string) =>
  join(app.getAppPath(), 'static', 'proxy-rules', name);

const readText = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};

const atomicWrite = (path: string, value: string) => {
  mkdirSync(CACHE_DIR, { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, value, 'utf8');
  try {
    renameSync(temp, path);
  } catch (error) {
    rmSync(path, { force: true });
    renameSync(temp, path);
  }
};

const ruleCount = (rules: ProxyRuleSet) =>
  rules.exactDomains.length +
  rules.suffixDomains.length +
  rules.wildcardDomains.length +
  rules.ipv4Ranges.length +
  rules.ipv6Ranges.length;

const loadMetadata = (): CacheMetadata => {
  try {
    return JSON.parse(readFileSync(META_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
};

let metadata = loadMetadata();
let gfwIgnored = 0;
let updating = false;
let lastError = '';
const listeners = new Set<DataChangedListener>();

const loadGfw = (): ProxyRuleSet => {
  const text = readText(GFWLIST_FILE) || readText(bundledPath('gfwlist.txt'));
  const parsed = parseGfwList(text);
  gfwIgnored = parsed.ignored;
  return parsed.rules;
};

let routeData: ProxyRouteData = {
  gfwlist: loadGfw(),
  gfwlistAvailable: false,
};
routeData.gfwlistAvailable = ruleCount(routeData.gfwlist) > 0;

const notifyChanged = () => {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error('[proxy-rules] change listener failed:', error);
    }
  }
};

const fetchText = async (
  source: string,
  etag?: string,
  lastModified?: string,
): Promise<{
  text?: string;
  etag?: string;
  lastModified?: string;
  unchanged?: boolean;
}> => {
  const parsed = new URL(source);
  if (parsed.protocol === 'file:') {
    const text = readFileSync(fileURLToPath(parsed), 'utf8');
    if (Buffer.byteLength(text, 'utf8') > MAX_DOWNLOAD_BYTES) throw new Error('规则文件超过 10 MiB');
    return { text };
  }
  if (parsed.protocol !== 'https:') throw new Error('规则订阅仅支持 HTTPS 或本地文件');
  let current = parsed;
  for (let redirect = 0; redirect <= 3; redirect++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(current.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          ...(etag ? { 'If-None-Match': etag } : {}),
          ...(lastModified ? { 'If-Modified-Since': lastModified } : {}),
        },
      });
      if (response.status === 304) {
        return { unchanged: true, etag, lastModified };
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirect === 3) throw new Error('规则订阅重定向过多');
        current = new URL(location, current);
        if (current.protocol !== 'https:') throw new Error('规则订阅重定向到非 HTTPS 地址');
        continue;
      }
      if (!response.ok) throw new Error(`规则订阅返回 HTTP ${response.status}`);
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > MAX_DOWNLOAD_BYTES) throw new Error('规则订阅超过 10 MiB');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error('规则订阅超过 10 MiB');
      return {
        text: bytes.toString('utf8'),
        etag: response.headers.get('etag') || undefined,
        lastModified: response.headers.get('last-modified') || undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('无法读取规则订阅');
};

const saveMetadata = () => atomicWrite(META_FILE, JSON.stringify(metadata, null, 2));

export const getProxyRouteData = () => routeData;

export const getProxyRuleStatus = (): ProxyRuleServiceStatus => ({
  updating,
  gfwUpdatedAt: metadata.gfwUpdatedAt,
  gfwRules: ruleCount(routeData.gfwlist),
  gfwIgnored,
  lastError: lastError || undefined,
});

export const onProxyRuleDataChanged = (listener: DataChangedListener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const updateProxyRuleData = async (
  gfwListUrl: string,
  force = false,
): Promise<ProxyRuleServiceStatus> => {
  if (updating) return getProxyRuleStatus();
  if (
    !force &&
    (metadata.gfwUpdatedAt || 0) > Date.now() - UPDATE_INTERVAL
  ) {
    return getProxyRuleStatus();
  }
  updating = true;
  lastError = '';
  try {
    const sameGfwSource = metadata.gfwListUrl === gfwListUrl;
    const gfw = await fetchText(
      gfwListUrl,
      sameGfwSource ? metadata.gfwEtag : undefined,
      sameGfwSource ? metadata.gfwLastModified : undefined,
    );
    const gfwText = gfw.text || (sameGfwSource ? readText(GFWLIST_FILE) : '');
    if (gfwText) {
      const parsed = parseGfwList(gfwText);
      if (ruleCount(parsed.rules) < 5) throw new Error('GFWList 规则内容无效');
      if (gfw.text) atomicWrite(GFWLIST_FILE, gfw.text);
      routeData = { ...routeData, gfwlist: parsed.rules, gfwlistAvailable: true };
      gfwIgnored = parsed.ignored;
      metadata.gfwUpdatedAt = Date.now();
      metadata.gfwListUrl = gfwListUrl;
      metadata.gfwEtag = gfw.etag || (sameGfwSource ? metadata.gfwEtag : undefined);
      metadata.gfwLastModified =
        gfw.lastModified ||
        (sameGfwSource ? metadata.gfwLastModified : undefined);
    }
    saveMetadata();
    notifyChanged();
  } catch (error) {
    lastError = (error as any)?.message || '规则更新失败';
    console.warn('[proxy-rules] update failed:', lastError);
  } finally {
    updating = false;
  }
  return getProxyRuleStatus();
};

const proxyDirective = (mode: 'http' | 'socks5', host: string, port: number) =>
  `${mode === 'socks5' ? 'SOCKS5' : 'PROXY'} ${host}:${port}`;

const generatedProxyPacSource = (
  mode: 'http' | 'socks5',
  host: string,
  port: number,
  routing: IProxyRoutingSettings,
): string => {
  const direct = parseProxyRules(routing.directRules).rules;
  const proxy = parseProxyRules(routing.proxyRules).rules;
  return generateProxyPac(
    routing,
    direct,
    proxy,
    routeData,
    proxyDirective(mode, host, port),
  );
};

export const buildGeneratedProxyPac = (
  mode: 'http' | 'socks5',
  host: string,
  port: number,
  routing: IProxyRoutingSettings,
): string => {
  const pac = generatedProxyPacSource(mode, host, port, routing);
  atomicWrite(GENERATED_PAC_FILE, pac);
  const hash = createHash('sha256').update(pac).digest('hex').slice(0, 16);
  const url = pathToFileURL(GENERATED_PAC_FILE);
  url.searchParams.set('v', hash);
  return url.href;
};

/**
 * Return the generated PAC inline as a data URL. Chromium's PAC loader is
 * stricter about file:// URLs (especially file URLs with a cache-busting
 * query), which can surface as ERR_MANDATORY_PROXY_CONFIGURATION_FAILED.
 * Keep writing the cache file for diagnostics/offline reuse, but use this
 * inline form when applying the profile proxy to Electron sessions.
 */
export const buildGeneratedProxyPacData = (
  mode: 'http' | 'socks5',
  host: string,
  port: number,
  routing: IProxyRoutingSettings,
): string => {
  const pac = generatedProxyPacSource(mode, host, port, routing);
  atomicWrite(GENERATED_PAC_FILE, pac);
  return `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(
    pac,
    'utf8',
  ).toString('base64')}`;
};

const lookupAll = promisify(lookup as any) as (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string }>>;

export const testProxyRoute = async (
  input: string,
  routing: IProxyRoutingSettings,
) => {
  let host = input.trim();
  try {
    host = new URL(/^[a-z]+:\/\//i.test(host) ? host : `https://${host}`).hostname;
  } catch {
    return { ok: false, message: '请输入有效的域名、IP 或 URL' };
  }
  let addresses: string[] = [];
  try {
    addresses = (await lookupAll(host, { all: true, verbatim: true })).map(
      (item) => item.address,
    );
  } catch {}
  const decision = decideProxyRoute(
    host,
    routing,
    parseProxyRules(routing.directRules).rules,
    parseProxyRules(routing.proxyRules).rules,
    routeData,
    addresses,
  );
  return { ok: true, host, addresses, ...decision };
};

export const startProxyRuleUpdater = (gfwListUrl: () => string) => {
  const update = () => void updateProxyRuleData(gfwListUrl()).catch(() => undefined);
  const initial = setTimeout(update, 30000);
  initial.unref?.();
  const interval = setInterval(update, UPDATE_INTERVAL);
  interval.unref?.();
};
