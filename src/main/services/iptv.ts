import {app, nativeImage, shell} from 'electron';
import {createHash, randomUUID} from 'crypto';
import {existsSync, mkdirSync, promises as fs, readFileSync, renameSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {fileURLToPath} from 'url';

import {buildIcoFromPng} from './pwa';
import {
  countChannels,
  detectFormat,
  IptvFormat,
  IptvGroup,
  parseList,
  parseTvboxConfig,
  resolveUrl,
  TvboxLive,
} from './iptv-parser';

// IPTV 订阅：拉取 + 解析 + 缓存 + 订阅列表持久化 + 桌面快捷方式 + 网页格式探测。
// 播放器窗口的 partition 不落盘且页面 origin 随网页变化，localStorage 存不住，订阅统一落 userData/iptv/。

export type IptvSource = {id: string; name: string; url: string};
export type IptvStore = {
  sources: IptvSource[];
  currentId: string;
  // 每个订阅最后播放的频道：分组名 + \u0001 + 频道名。
  lastChannel: Record<string, string>;
};
export type IptvLoadResult = {
  ok: boolean;
  groups?: IptvGroup[];
  format?: IptvFormat;
  fromCache?: boolean;
  message?: string;
};

// 与安卓一致：IPTV 源普遍按 okhttp UA 放行，桌面 Chrome UA 反而常被拒。
const DEFAULT_FETCH_UA = 'okhttp/3.15';
const FETCH_TIMEOUT_MS = 20000;
const MAX_PARALLEL_LIVES = 4;
export const IPTV_LAUNCH_SWITCH = 'iptv';
export const IPTV_APP_USER_MODEL_ID = 'com.rainsee.pcbrowser.iptv';

const iptvDir = () => join(app.getPath('userData'), 'iptv');
const cacheDir = () => join(iptvDir(), 'cache');
const storeFile = () => join(iptvDir(), 'sources.json');
export const iptvIconPath = () => join(iptvDir(), process.platform === 'win32' ? 'iptv.ico' : 'iptv.png');

const ensureDir = (dir: string) => {
  if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
};

const writeAtomic = (target: string, data: string | Buffer) => {
  ensureDir(join(target, '..'));
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temp, data);
    renameSync(temp, target);
  } finally {
    rmSync(temp, {force: true});
  }
};

// ---------- 订阅列表 ----------

const emptyStore = (): IptvStore => ({sources: [], currentId: '', lastChannel: {}});

const sanitizeStore = (value: any): IptvStore => {
  const store = emptyStore();
  if (!value || typeof value !== 'object') return store;
  const seen = new Set<string>();
  for (const item of Array.isArray(value.sources) ? value.sources : []) {
    const url = typeof item?.url === 'string' ? item.url.trim() : '';
    if (!/^(https?|file):\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    store.sources.push({
      id: typeof item.id === 'string' && item.id ? item.id : randomUUID(),
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 80) : url,
      url,
    });
  }
  store.currentId = store.sources.some((s) => s.id === value.currentId) ? value.currentId : (store.sources[0]?.id || '');
  if (value.lastChannel && typeof value.lastChannel === 'object') {
    for (const source of store.sources) {
      const key = value.lastChannel[source.id];
      if (typeof key === 'string') store.lastChannel[source.id] = key.slice(0, 400);
    }
  }
  return store;
};

let storeCache: IptvStore | null = null;

export const loadIptvStore = (): IptvStore => {
  if (storeCache) return storeCache;
  try {
    storeCache = existsSync(storeFile())
      ? sanitizeStore(JSON.parse(readFileSync(storeFile(), 'utf8') || '{}'))
      : emptyStore();
  } catch (e) {
    console.log('[iptv] read sources failed', e);
    storeCache = emptyStore();
  }
  return storeCache;
};

export const saveIptvStore = (value: any): IptvStore => {
  const next = sanitizeStore(value);
  // 被删除/改地址的订阅清掉旧缓存。
  const before = loadIptvStore();
  for (const old of before.sources) {
    if (!next.sources.some((s) => s.url === old.url)) rmSync(cachePath(old.url), {force: true});
  }
  writeAtomic(storeFile(), JSON.stringify(next, null, 2));
  storeCache = next;
  return next;
};

// ---------- 拉取 ----------

const cachePath = (url: string) =>
  join(cacheDir(), `${createHash('md5').update(url).digest('hex')}.json`);

const fetchOnce = async (url: string, ua?: string): Promise<string> => {
  if (/^file:\/\//i.test(url)) return fs.readFile(fileURLToPath(url), 'utf8');
  const response = await fetch(url, {
    headers: {'User-Agent': ua || DEFAULT_FETCH_UA, Accept: '*/*'},
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString('utf8');
};

// 网络抖动重试一次(HTTP 错误码不重试)。
const fetchText = async (url: string, ua?: string): Promise<string> => {
  try {
    return await fetchOnce(url, ua);
  } catch (e) {
    if (/^HTTP \d+/.test(String((e as any)?.message || ''))) throw e;
    return fetchOnce(url, ua);
  }
};

const mapLimit = async <T, R>(list: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const index = next++;
      results[index] = await fn(list[index]);
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, list.length)}, worker));
  return results;
};

const loadLive = async (configUrl: string, live: TvboxLive): Promise<IptvGroup[]> => {
  const groups: IptvGroup[] = [...(live.groups || [])];
  const urls = live.url ? [live.url] : live.proxyUrls || [];
  for (const url of urls) {
    const absolute = resolveUrl(configUrl, url);
    groups.push(...parseList(await fetchText(absolute, live.ua), live.ua));
  }
  return groups;
};

const parseTvbox = async (configUrl: string, text: string): Promise<IptvGroup[]> => {
  const lives = parseTvboxConfig(text);
  if (!lives.length) throw new Error('该配置没有直播源(lives)');
  const prefix = lives.length > 1;
  const errors: string[] = [];
  const results = await mapLimit(lives, MAX_PARALLEL_LIVES, async (live) => {
    try {
      const groups = await loadLive(configUrl, live);
      if (prefix && live.name) for (const group of groups) group.name = `${live.name} · ${group.name}`;
      return groups;
    } catch (e) {
      errors.push(`${live.name || live.url}: ${String((e as any)?.message || e)}`);
      return [] as IptvGroup[];
    }
  });
  const groups = results.flat();
  if (!groups.length && errors.length) throw new Error(errors.join('；'));
  return groups;
};

export const parseIptvContent = async (url: string, text: string) => {
  const format = detectFormat(text);
  if (!format) throw new Error('不是可识别的直播源格式');
  const groups = format === 'tvbox' ? await parseTvbox(url, text) : parseList(text);
  if (!countChannels(groups)) throw new Error('没有解析到频道');
  return {format, groups};
};

const readCache = async (url: string) => {
  try {
    const data = JSON.parse(await fs.readFile(cachePath(url), 'utf8'));
    if (data && Array.isArray(data.groups) && data.url === url) return data as {url: string; format: IptvFormat; groups: IptvGroup[]};
  } catch (e) {
  }
  return null;
};

// 默认先回缓存(秒开)，页面随后再以 force 静默刷新；force 直接走网络并更新缓存。
export const loadIptvSource = async (url: string, force = false): Promise<IptvLoadResult> => {
  if (!/^(https?|file):\/\//i.test(String(url || ''))) return {ok: false, message: '请输入 http(s) 订阅地址'};
  if (!force) {
    const cached = await readCache(url);
    if (cached) return {ok: true, groups: cached.groups, format: cached.format, fromCache: true};
  }
  try {
    const text = await fetchText(url);
    const {format, groups} = await parseIptvContent(url, text);
    try {
      writeAtomic(cachePath(url), JSON.stringify({url, format, groups, savedAt: Date.now()}));
    } catch (e) {
      console.log('[iptv] write cache failed', e);
    }
    console.log('[iptv] loaded', url.slice(0, 120), format, 'groups', groups.length, 'channels', countChannels(groups));
    return {ok: true, groups, format, fromCache: false};
  } catch (e) {
    const message = String((e as any)?.message || e);
    console.log('[iptv] load failed', url.slice(0, 120), message);
    if (force) {
      const cached = await readCache(url);
      if (cached) return {ok: true, groups: cached.groups, format: cached.format, fromCache: true, message};
    }
    return {ok: false, message};
  }
};

// ---------- 桌面快捷方式 ----------

export const getIptvLaunchArgs = () => [
  ...(app.isPackaged ? [] : [app.getAppPath()]),
  `--${IPTV_LAUNCH_SWITCH}`,
];

export const isIptvLaunchArgv = (argv: string[]) =>
  argv.some((arg) => arg === `--${IPTV_LAUNCH_SWITCH}`);

// 页面用 canvas 画好的 PNG(dataURL)落盘为图标；Windows .lnk 只认 .ico。
const writeIcon = (iconDataUrl?: string): string | undefined => {
  try {
    const image = iconDataUrl ? nativeImage.createFromDataURL(iconDataUrl) : null;
    if (!image || image.isEmpty()) return existsSync(iptvIconPath()) ? iptvIconPath() : undefined;
    const resized = image.resize({width: 256, height: 256});
    const png = resized.toPNG();
    const size = resized.getSize();
    writeAtomic(iptvIconPath(), process.platform === 'win32' ? buildIcoFromPng(png, size.width, size.height) : png);
    return iptvIconPath();
  } catch (e) {
    console.log('[iptv] write icon failed', e);
    return undefined;
  }
};

export const createIptvShortcut = (name: string, iconDataUrl?: string): {ok: boolean; path?: string; message?: string} => {
  if (process.platform !== 'win32') return {ok: false, message: '当前系统暂不支持创建桌面快捷方式'};
  const safeName = (name || 'IPTV').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  const target = join(app.getPath('desktop'), `${safeName}.lnk`);
  const icon = writeIcon(iconDataUrl);
  const args = getIptvLaunchArgs()
    .map((arg) => (/[\s"]/u.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg))
    .join(' ');
  try {
    const ok = shell.writeShortcutLink(target, existsSync(target) ? 'update' : 'create', {
      target: process.execPath,
      args,
      description: name,
      icon,
      iconIndex: 0,
      appUserModelId: IPTV_APP_USER_MODEL_ID,
    });
    if (!ok) return {ok: false, message: '写入快捷方式失败'};
    console.log('[iptv] shortcut written', target);
    return {ok: true, path: target};
  } catch (e) {
    return {ok: false, message: String((e as any)?.message || e)};
  }
};

// ---------- 网页格式探测 ----------

// 只在纯文本类文档(text/plain、json、m3u)上跑，普通网页第一行就返回；
// 正文只取前 64KB 用几个正则粗判，放进 requestIdleCallback，不占页面主线程关键时段。
const DETECT_IPTV_CODE = `new Promise(function(resolve){
  try {
    var ct = String(document.contentType || '').toLowerCase();
    if (!/^(text\\/plain|application\\/json|text\\/json|application\\/(vnd\\.apple\\.|x-)?mpegurl|audio\\/(x-)?mpegurl)/.test(ct)) return resolve(null);
    var run = function(){
      try {
        var body = document.body;
        if (!body || body.children.length > 3) return resolve(null);
        // textContent 不触发排版(innerText 会)。
        var full = String(body.textContent || '');
        var text = full.slice(0, 65536);
        var format = '', count = 0, m, i, names;
        // 同名频道在播放器里合并为多线路，计数按去重后的频道名。
        var unique = function(list, pick){
          names = {}; count = 0;
          for (i = 0; i < list.length; i++) {
            var key = pick(list[i]);
            if (key && !names[key]) { names[key] = 1; count++; }
          }
        };
        // JSON 先判：TVBox 配置里可能内嵌 #EXTINF 字样。
        if (/^\\s*(\\/\\/[^\\n]*\\n\\s*)*\\{/.test(text)) {
          // TVBox 配置的 lives 常在文件末尾，在全文(上限 2MB)里找，indexOf 很快。
          var at = full.length > 2097152 ? -1 : full.indexOf('"lives"');
          if (at >= 0 && /^"lives"\\s*:\\s*\\[/.test(full.slice(at, at + 40))) format = 'tvbox';
        } else if (/#EXTINF/.test(text)) {
          if (/^#EXT-X-/m.test(text)) return resolve(null);
          m = text.match(/#EXTINF[^\\n]*/g) || [];
          unique(m, function(line){ var c = line.lastIndexOf(','); return c >= 0 ? line.slice(c + 1).trim() : line; });
          if (count) format = 'm3u';
        } else {
          m = text.match(/^[^,\\n#]{1,60}[,，]\\s*[a-z][a-z0-9+.-]*:\\/\\/\\S+/gim) || [];
          unique(m, function(line){ return line.split(/[,，]/)[0].trim(); });
          if (m.length >= 3 || (m.length >= 1 && /[,，]\\s*#genre#/.test(text))) format = 'txt';
        }
        resolve(format ? {format: format, count: count, truncated: full.length > 65536} : null);
      } catch (e) { resolve(null); }
    };
    if (window.requestIdleCallback) requestIdleCallback(run, {timeout: 1500}); else setTimeout(run, 200);
  } catch (e) { resolve(null); }
})`;

export type IptvDetectResult = {format: IptvFormat; count: number; truncated?: boolean} | null;

export const detectIptvState = async (wc: Electron.WebContents): Promise<IptvDetectResult> => {
  if (!wc || wc.isDestroyed()) return null;
  const result = await wc.executeJavaScript(DETECT_IPTV_CODE, false).catch(() => null);
  if (!result || !['txt', 'm3u', 'tvbox'].includes(result.format)) return null;
  return {format: result.format, count: Number(result.count) || 0, truncated: Boolean(result.truncated)};
};
