// IPTV 播放列表解析(移植安卓 superplay/IptvParser.java)。
// 纯函数、不依赖 electron，供主进程加载订阅与 scripts/test-iptv-parser.js 共用。
// 支持三种格式，全部按内容判定(不看扩展名/Content-Type)：
//   TXT   ：「分组,#genre#」起分组，「名称,url」为频道，url 可用 # 连接多条线路、$ 后缀为线路名
//   M3U   ：#EXTINF 行带 group-title/tvg-logo/tvg-name，下一行为地址
//   TVBox ：JSON 配置(允许 // 注释、尾逗号；lives 之外的段落损坏时只解析 lives)，
//           只读 lives[]，每项 url 指向 TXT/M3U，可带 ua

export interface IptvChannel {
  name: string;
  logo?: string;
  urls: string[];
}

export interface IptvGroup {
  name: string;
  // TVBox lives[].ua：拉取列表与播放该分组频道时使用的 User-Agent。
  ua?: string;
  channels: IptvChannel[];
}

export type IptvFormat = 'txt' | 'm3u' | 'tvbox';

// TVBox lives[] 中的一项：新格式是 url 指向列表，旧格式直接内嵌 channels。
export interface TvboxLive {
  name: string;
  url?: string;
  ua?: string;
  groups?: IptvGroup[];
  // 旧格式 proxy://…&ext=<url|base64> 解出的列表地址。
  proxyUrls?: string[];
}

export const DEFAULT_GROUP = '默认分组';
const UNNAMED_CHANNEL = '未命名频道';
const M3U_ATTR = /([\w-]+)="([^"]*)"/g;

export const normalize = (content: string): string => {
  let text = String(content || '');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n?/g, '\n').trim();
};

const firstMeaningfulLine = (text: string): string => {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    return line;
  }
  return '';
};

const looksLikeTvbox = (text: string) => firstMeaningfulLine(text).startsWith('{');

const decodeBase64 = (value: string): string => {
  try {
    return Buffer.from(value.replace(/\s+/g, ''), 'base64').toString('utf8');
  } catch (e) {
    return '';
  }
};

// 「图片**base64(JSON)」式的伪装配置。
const unwrapTvbox = (text: string): string | null => {
  const index = text.indexOf('**');
  if (index < 0) return null;
  const decoded = normalize(decodeBase64(text.slice(index + 2)));
  return decoded && looksLikeTvbox(decoded) ? decoded : null;
};

// HLS 媒体/主播放列表也以 #EXTINF 开头，但它本身就是一路视频流，不是频道表。
const isHlsPlaylist = (text: string) => /^#EXT-X-/m.test(text);

export const detectFormat = (content: string): IptvFormat | null => {
  const text = normalize(content);
  if (!text) return null;
  if (looksLikeTvbox(text) || unwrapTvbox(text)) return 'tvbox';
  if (text.includes('#EXTINF')) return isHlsPlaylist(text) ? null : 'm3u';
  return 'txt';
};

// ---------- 分组/频道合并 ----------

const obtainGroup = (groups: Map<string, IptvGroup>, name: string) => {
  const key = name || DEFAULT_GROUP;
  let group = groups.get(key);
  if (!group) {
    group = {name: key, channels: []};
    groups.set(key, group);
  }
  return group;
};

// 同分组同名频道合并为多条线路(地址去重)。
const addChannel = (group: IptvGroup, name: string, urls: string[], logo?: string) => {
  if (!urls.length) return;
  const existing = group.channels.find((channel) => channel.name === name);
  if (existing) {
    for (const url of urls) if (!existing.urls.includes(url)) existing.urls.push(url);
    if (!existing.logo && logo) existing.logo = logo;
    return;
  }
  const channel: IptvChannel = {name, urls: [...urls]};
  if (logo) channel.logo = logo;
  group.channels.push(channel);
};

const finishGroups = (groups: Map<string, IptvGroup>) =>
  [...groups.values()].filter((group) => group.channels.length > 0);

const addUrl = (result: string[], raw: string) => {
  let url = raw.trim();
  const dollar = url.indexOf('$');
  if (dollar > 0) url = url.slice(0, dollar).trim();
  if (url.includes('://') && !result.includes(url)) result.push(url);
};

// url1#url2 拆成多条线路；不含 :// 的片段是上一条地址里的 #fragment，拼回去。
export const splitUrls = (value: string): string[] => {
  const result: string[] = [];
  let pending: string | null = null;
  for (const part of value.split('#')) {
    if (pending === null || part.includes('://')) {
      if (pending !== null) addUrl(result, pending);
      pending = part;
    } else {
      pending += '#' + part;
    }
  }
  if (pending !== null) addUrl(result, pending);
  return result;
};

// ---------- TXT ----------

export const parseTxt = (content: string): IptvGroup[] => {
  const groups = new Map<string, IptvGroup>();
  let current: IptvGroup | null = null;
  for (const raw of normalize(content).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    let comma = line.indexOf(',');
    if (comma < 0) comma = line.indexOf('，');
    if (comma <= 0) continue;
    const name = line.slice(0, comma).trim();
    const value = line.slice(comma + 1).trim();
    if (value.startsWith('#genre#')) {
      current = obtainGroup(groups, name);
      continue;
    }
    const urls = splitUrls(value);
    if (!urls.length) continue;
    addChannel(current || obtainGroup(groups, DEFAULT_GROUP), name || UNNAMED_CHANNEL, urls);
  }
  return finishGroups(groups);
};

// ---------- M3U ----------

const lastCommaOutsideQuotes = (line: string) => {
  let quoted = false;
  let index = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) index = i;
  }
  return index;
};

export const parseM3u = (content: string): IptvGroup[] => {
  const groups = new Map<string, IptvGroup>();
  // group-title 沿用到下一次出现为止(与安卓一致)。
  let group = '';
  let name = '';
  let logo = '';
  for (const raw of normalize(content).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const attrs: Record<string, string> = {};
      M3U_ATTR.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = M3U_ATTR.exec(line))) attrs[match[1].toLowerCase()] = match[2];
      const comma = lastCommaOutsideQuotes(line);
      name = comma >= 0 ? line.slice(comma + 1).trim() : '';
      if (!name) name = attrs['tvg-name'] || '';
      logo = attrs['tvg-logo'] || '';
      if (attrs['group-title']) group = attrs['group-title'];
      continue;
    }
    if (line.startsWith('#EXTGRP:')) {
      const value = line.slice('#EXTGRP:'.length).trim();
      if (value) group = value;
      continue;
    }
    if (line.startsWith('#') || !line.includes('://')) continue;
    const urls: string[] = [];
    addUrl(urls, line);
    addChannel(obtainGroup(groups, group), name || UNNAMED_CHANNEL, urls, /^https?:\/\//i.test(logo) ? logo : '');
    name = '';
    logo = '';
  }
  return finishGroups(groups);
};

// TXT/M3U 统一入口；ua 打到每个分组上。
export const parseList = (content: string, ua?: string): IptvGroup[] => {
  const text = normalize(content);
  const groups = text.includes('#EXTINF') ? parseM3u(text) : parseTxt(text);
  if (ua) for (const group of groups) group.ua = ua;
  return groups;
};

// ---------- TVBox ----------

// TVBox 配置常带 // 整行注释、/* */ 注释与尾逗号。只处理字符串之外的部分，地址里的 // 不受影响。
export const parseLenientJson = (text: string): any => {
  try {
    return JSON.parse(text);
  } catch (e) {
  }
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[i + 1] || '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else {
      out += ch;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
};

// 兜底：真实订阅里见过 lives 之外的段落语法损坏(如 sites 里少了属性名前引号)，
// 整体 JSON 解析必败，但我们只关心 lives。按括号配对把顶层 lives 数组抠出来单独解析。
const extractLives = (text: string): any[] | null => {
  const re = /"lives"\s*:\s*\[/g;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    const start = re.lastIndex - 1;
    let depth = 0, inString = false, end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === '\\') i++; else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth <= 0) { end = i + 1; break; } }
    }
    if (end < 0) continue;
    try {
      const lives = parseLenientJson(text.slice(start, end));
      if (Array.isArray(lives)) return lives;
    } catch (e) { /* 换下一处 "lives" 再试 */ }
  }
  return null;
};

const str = (value: any) => (typeof value === 'string' ? value.trim() : '');

// 旧格式 proxy://do=live&type=txt&ext=<url 或 base64(url)>
const proxyExt = (url: string): string => {
  const match = /[?&]ext=([^&]+)/.exec(url);
  if (!match) return '';
  let ext = match[1];
  try {
    ext = decodeURIComponent(ext);
  } catch (e) {
  }
  if (ext.includes('://')) return ext;
  const decoded = decodeBase64(ext).trim();
  return decoded.includes('://') ? decoded : '';
};

const parseLegacyLive = (live: any): TvboxLive => {
  const name = str(live.group) || str(live.name);
  const groups = new Map<string, IptvGroup>();
  const proxyUrls: string[] = [];
  for (const channel of Array.isArray(live.channels) ? live.channels : []) {
    const channelName = str(channel && channel.name) || UNNAMED_CHANNEL;
    const urls: string[] = [];
    for (const raw of Array.isArray(channel && channel.urls) ? channel.urls : []) {
      const url = str(raw);
      if (url.startsWith('proxy://')) {
        const target = proxyExt(url);
        if (target && !proxyUrls.includes(target)) proxyUrls.push(target);
      } else {
        addUrl(urls, url);
      }
    }
    addChannel(obtainGroup(groups, name), channelName, urls);
  }
  return {name, groups: finishGroups(groups), proxyUrls};
};

// 解析 TVBox 配置，返回 lives 列表(不发网络请求，由调用方逐项拉取)。
export const parseTvboxConfig = (content: string): TvboxLive[] => {
  let text = normalize(content);
  if (!looksLikeTvbox(text)) {
    const unwrapped = unwrapTvbox(text);
    if (!unwrapped) throw new Error('not a TVBox config');
    text = unwrapped;
  }
  // 跳过开头的注释行再解析(配置首行常是 // 说明)。
  let root: any = null;
  try {
    root = parseLenientJson(text.slice(text.indexOf('{')));
  } catch (error) {
    // 整体解析失败：lives 之外的段落语法损坏时退化为只解析 lives 数组。
    const extracted = extractLives(text);
    if (!extracted) throw error;
    root = {lives: extracted};
  }
  const lives = root && Array.isArray(root.lives) ? root.lives : [];
  const result: TvboxLive[] = [];
  for (const live of lives) {
    if (!live || typeof live !== 'object') continue;
    if (Array.isArray(live.channels)) {
      result.push(parseLegacyLive(live));
      continue;
    }
    const url = str(live.url);
    if (!url) continue;
    result.push({name: str(live.name), url, ua: str(live.ua) || undefined});
  }
  return result;
};

export const resolveUrl = (base: string, url: string): string => {
  try {
    return new URL(url, base).toString();
  } catch (e) {
    return url;
  }
};

export const countChannels = (groups: IptvGroup[]) =>
  groups.reduce((sum, group) => sum + group.channels.length, 0);
