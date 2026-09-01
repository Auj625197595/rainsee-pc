import { TLD_LIST } from './tld-list';

import { getDomain as getRegistrableDomain } from 'tldts';

// 已知协议前缀:命中即视为完整 URL,直接导航(对应安卓 UrlUtils.isUrl 的协议分支)。
// javascript: 列入:否则地址栏输入 javascript:alert(1) 会被 isSpecialChar(含 "()")
// 判为搜索词转走搜索引擎,导致用地址栏收藏 bookmarklet 时存成搜索 URL(中毒)。
const WELL_KNOWN_PROTOCOL_RE =
  /^(https?|file|ftp|view-source|chrome-extension|chrome|about|edge|blob|data|moz-extension|yj-extension|yjllq|javascript):/i;

const isWellKnownUrl = (thing: string): boolean =>
  WELL_KNOWN_PROTOCOL_RE.test(thing);

// 地址栏输入常来自中文输入法或复制粘贴。URL 的分隔符使用全角/日文形式时，
// URL 构造器不会把它们识别为协议、域名或端口分隔符。先只在 URL 解析路径中
// 做 NFKC 归一化，并补齐 NFKC 未覆盖的几类「点号」。搜索词仍保留用户原始输入。
const URL_DOT_VARIANTS_RE = /[\u3002\uff0e\uff61\ufe52\u2024]/g;

export const normalizeUrlInput = (input: string): string => {
  const normalized = (input || '')
    .trim()
    .normalize('NFKC')
    .replace(URL_DOT_VARIANTS_RE, '.');

  // 常见的粘贴/手输错误：https:\\example.com。仅修正 URL 协议，避免影响
  // Windows 路径（C:\\...）和普通搜索词。
  return normalized.replace(/^((?:https?|ftp|file):)\\+(?=[^\\])/i, '$1//');
};

// 浏览器自身可加载/处理的"内部协议":命中时在页内导航,不外发给系统默认应用。
// 除 WELL_KNOWN_PROTOCOL_RE 列举的之外,还包括 ktllq(伪协议,view.ts 内部动作)
// 与 yjllq-error(错误页协议)。
const INTERNAL_SCHEMES = new Set([
  'http', 'https', 'file', 'ftp', 'view-source', 'chrome-extension', 'chrome',
  'about', 'edge', 'blob', 'data', 'moz-extension', 'yj-extension', 'yjllq',
  'yjllq-error', 'javascript', 'ktllq',
]);

// 不带 "//" 但确属外部协议的常见 scheme(单冒号协议)。mailto:、tel:、magnet: 等
// 无 "//" 却应唤起系统应用;白名单收口,避免 host:port(localhost:3000)被误判为协议。
const EXTERNAL_SINGLE_COLON_SCHEMES = new Set([
  'mailto', 'tel', 'sms', 'mms', 'magnet', 'facetime', 'facetime-audio',
  'callto', 'skype', 'sip', 'bitcoin', 'ethereum', 'xmpp', 'irc', 'news',
  'nntp', 'feed', 'webcal', 'intent',
]);

// 判定输入是否为"外部协议"URL——应交给系统默认应用处理,而非页内加载或当搜索词。
// motrixnext://tasks、thunder://xxx、ed2k://|file|...、qq://...、steam://run/...
// 等带 "//" 的非内部协议一律视为外部;mailto:、magnet:、tel: 等已知单冒号协议亦然。
// 返回小写 scheme 名,内部协议或非协议输入返回 null。
// 关键:host:port 形式(localhost:3000、192.168.1.1:8080)无 "//" 且 scheme 不在
// 单冒号白名单 → 返回 null,交由 isLocalhost/isIPv4 处理,不会被误派给系统。
export const getExternalProtocol = (input: string): string | null => {
  const thing = normalizeUrlInput(input);
  if (!thing) return null;

  // 带 "//" 的协议 URL:scheme://...
  let m = /^([a-zA-Z][a-zA-Z0-9+.\-]*):\/\//i.exec(thing);
  if (m) {
    const scheme = m[1].toLowerCase();
    return INTERNAL_SCHEMES.has(scheme) ? null : scheme;
  }

  // 单冒号协议:scheme:...(仅认白名单)
  m = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/i.exec(thing);
  if (m) {
    const scheme = m[1].toLowerCase();
    if (EXTERNAL_SINGLE_COLON_SCHEMES.has(scheme)) return scheme;
  }
  return null;
};

// 会话恢复只接受浏览器可安全自行恢复的页面。此处故意不把所有内部协议都放行：
// 扩展、DevTools、about、data 等页面缺少稳定的恢复语义，统一走新标签页兜底。
const SESSION_RESTORABLE_SCHEMES = new Set(['http', 'https', 'file', 'yjllq']);

export const isSessionRestorableUrl = (input: string): boolean => {
  const value = normalizeUrlInput(input);
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  if (!match || !WELL_KNOWN_PROTOCOL_RE.test(value)) return false;
  const scheme = match[1].toLowerCase();
  return INTERNAL_SCHEMES.has(scheme) && SESSION_RESTORABLE_SCHEMES.has(scheme);
};

// Windows 本地绝对路径(盘符路径或 UNC 路径):地址栏输入这类内容应直开本地文件,
// 而不是走搜索。支持 C:\a\b、C:/a/b、\\server\share、//server/share。
const WINDOWS_DRIVE_PATH_RE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH_RE = /^(\\\\|\/\/)[^\\/]+[\\/][^\\/]+/;

const isWindowsAbsolutePath = (thing: string): boolean =>
  WINDOWS_DRIVE_PATH_RE.test(thing) || WINDOWS_UNC_PATH_RE.test(thing);

const encodeFileUrlPath = (path: string): string =>
  path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

const toFileUrl = (path: string): string => {
  const normalized = path.replace(/\\/g, '/');

  if (WINDOWS_UNC_PATH_RE.test(path)) {
    const unc = normalized.replace(/^\/+/, '');
    return `file://${encodeFileUrlPath(unc)}`;
  }

  return `file:///${encodeFileUrlPath(normalized)}`;
};

// IPv4 判定(可含端口,逐字移植自 UrlUtilBase.isIP)。
const IPv4_RE =
  /([1-9]|[1-9]\d|1\d{2}|2[0-4]\d|25[0-5])(\.(\d|[1-9]\d|1\d{2}|2[0-4]\d|25[0-5])){3}/;

const isIPv4 = (addr: string): boolean => {
  if (!addr || addr.length < 7 || addr.length > 15) return false;
  return IPv4_RE.test(addr);
};

// localhost(可带端口):无 TLD 但应作网址直达,显式判定以免被当成搜索词。
const isLocalhost = (thing: string): boolean =>
  /^localhost$/i.test(thing.split(':')[0]);

// 含空白或标点(空格、换行、中英文标点等)→ 不再按域名匹配(移植自 isSpecialChar)。
const SPECIAL_CHAR_RE =
  /[\s`~!@$^*()|{}[\];',<>~！@￥……*（）——+|{}【】‘；：”“’。，、？]/;

const isSpecialChar = (str: string): boolean => SPECIAL_CHAR_RE.test(str);

// 取 host:仅当 http(s):// 开头能解析出主机名时返回,否则空串(移植自 UrlUtils.getHost)。
const getHostOf = (url: string): string => {
  try {
    if (!/^https?:\/\//i.test(url)) return '';
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
};

// 在输入中查找其包含的已知 TLD 后缀,取"最后出现且最长"的那一个。
// 返回该后缀及"是否应按搜索词处理":后缀不在末尾、其后又无路径/锚点/查询/端口时视为搜索词。
const pickTld = (
  thing: string,
): { tld: string | null; tldIndex: number; isKeyword: boolean } => {
  let tld: string | null = null;
  let tldIndex = -1;
  const lowerThing = thing.toLowerCase();

  for (const candidate of TLD_LIST) {
    if (lowerThing.includes(candidate) && lowerThing !== candidate) {
      const idx = lowerThing.lastIndexOf(candidate);
      // A TLD must end at a URL label boundary. Without this check, a path
      // or query token such as "player" can make the ".play" TLD appear to
      // be the last domain suffix and turn an otherwise valid URL into a
      // search keyword.
      const candidateSuffix = lowerThing.slice(idx + candidate.length);
      const candidateIsKeyword =
        candidateSuffix !== '' &&
        candidateSuffix !== '.' &&
        !/^\.?(?:[/#?:])/.test(candidateSuffix);
      if (candidateIsKeyword) continue;

      if (
        tld === null ||
        idx > tldIndex ||
        (idx === tldIndex && candidate.length > tld.length)
      ) {
        tld = candidate;
        tldIndex = idx;
      }
      if (lowerThing.endsWith(tld)) break;
    }
  }

  if (!tld) return { tld: null, tldIndex: -1, isKeyword: true };

  // TLD 后可接根域点、端口、路径、查询或锚点。其余内容（如
  // "example.computer" 命中 .com）仍按搜索词处理，避免误跳转。
  const suffix = thing.slice(tldIndex + tld.length);
  const isKeyword =
    suffix !== '' && suffix !== '.' && !/^\.?(?:[/#?:])/.test(suffix);
  return { tld, tldIndex, isKeyword };
};

const toHttpUrl = (thing: string, tldIndex: number): string => {
  // 保持旧逻辑对 ".example.com" 的兼容：补齐 www 后再校验。
  const hostPrefix = thing.slice(0, tldIndex);
  return hostPrefix.startsWith('.') ? `http://www${thing}` : `http://${thing}`;
};

// "//example.com/path" 是常见的协议相对 URL；但 "//server/share" 同时也是
// Windows UNC 路径。仅在主机具备有效已知 TLD 时将前者转为网页地址，UNC 保持
// 原有的 file:// 打开逻辑。
const toProtocolRelativeUrl = (thing: string): string | null => {
  if (!thing.startsWith('//')) return null;

  const candidate = thing.slice(2);
  const { tld, tldIndex, isKeyword } = pickTld(candidate);
  if (!tld || isKeyword || getHostOf(toHttpUrl(candidate, tldIndex)) === '') {
    return null;
  }

  return `http:${thing}`;
};

// 用搜索引擎模板把搜索词拼成搜索 URL(对应安卓 getSearch)。
const getSearchUrl = (text: string, searchEngineUrl: string): string => {
  const template = searchEngineUrl || 'https://www.baidu.com/s?wd=%s';
  const q = text.includes(' ') ? text : encodeURIComponent(text);
  return template.includes('%s') ? template.replace('%s', q) : template + q;
};

// 判断输入是否应被当作"网址/域名"导航,而非搜索词。
// 逐字对齐安卓 RealurlUtils / UrlUtilBase.isUrl:输入须包含某个已知 TLD 后缀(且位置合理)
// 才视为域名,据此排除版本号(v1.2.3)、日期(2024.06.29)、中文(哈哈)等被误判为网址的普通文本。
export const isURL = (input: string): boolean => {
  if (!input) return false;
  const thing = normalizeUrlInput(input);
  if (thing === '') return false;

  if (isWellKnownUrl(thing)) return true;

  // 外部协议(motrixnext://、thunder://、magnet:、mailto: 等)也算 URL:
  // 这样地址栏输入时不会被当搜索词,联想/补全也按网址呈现。
  if (getExternalProtocol(thing)) return true;

  if (toProtocolRelativeUrl(thing)) return true;

  if (isWindowsAbsolutePath(thing)) return true;

  if (isIPv4(thing.split(':')[0])) return true;

  if (isLocalhost(thing)) return true;

  if (isSpecialChar(thing)) return false;

  const { tld, tldIndex, isKeyword } = pickTld(thing);
  if (!tld || isKeyword) return false;

  return getHostOf(toHttpUrl(thing, tldIndex)) !== '';
};

// 把地址栏输入解析为最终要加载的 URL:是域名/IP/完整 URL 则补 http:// 直达,
// 否则送搜索引擎搜索。searchEngineUrl 为含 %s 的引擎模板。对齐安卓 RealurlUtils.realurl。
export const realurl = (
  input: string,
  searchEngineUrl: string,
): string => {
  const raw = (input || '').trim();
  const thing = normalizeUrlInput(raw);
  if (thing === '') return searchEngineUrl || '';

  if (isWellKnownUrl(thing)) return thing;

  // 外部协议原样返回:交由调用方(openExternal)派发给系统应用,既不补 http:// 也不搜索。
  if (getExternalProtocol(thing)) return thing;

  const protocolRelativeUrl = toProtocolRelativeUrl(thing);
  if (protocolRelativeUrl) return protocolRelativeUrl;

  if (isWindowsAbsolutePath(thing)) return toFileUrl(thing);

  if (isIPv4(thing.split(':')[0]) || isLocalhost(thing)) {
    return thing.indexOf('://') === -1 ? `http://${thing}` : thing;
  }

  if (isSpecialChar(thing)) {
    return getSearchUrl(raw, searchEngineUrl);
  }

  const { tld, tldIndex, isKeyword } = pickTld(thing);
  if (!tld || isKeyword) {
    return getSearchUrl(raw, searchEngineUrl);
  }

  const url = toHttpUrl(thing, tldIndex);

  if (getHostOf(url) === '') {
    return getSearchUrl(raw, searchEngineUrl);
  }
  return url;
};

// 书签可以是「bookmarklet」:URL 形如 javascript:(...);... 的可执行脚本。
// 浏览器对 javascript: 体会做百分号解码后求值,这里抽出可执行脚本体。
// 非 javascript: URL 返回 null;含非法 % 序列时解码失败,回退原样(浏览器较宽容)。
export const parseBookmarklet = (url: string): string | null => {
  if (!url) return null;
  const match = /^javascript:([\s\S]*)$/i.exec(url.trim());
  if (!match) return null;
  let body = match[1];
  try {
    body = decodeURIComponent(body);
  } catch {
    // 含非法 % 序列(如未编码的裸 %),保持原样
  }
  return body;
};

export const matchesPattern = (pattern: string, url: string) => {
  if (pattern === '<all_urls>') {
    return true;
  }

  const regexp = new RegExp(
    `^${pattern.replace(/\*/g, '.*').replace('/', '\\/')}$`,
  );
  return url.match(regexp) != null;
};

export const getDomain = (url: string | null | undefined): string => {
  let hostname = typeof url === 'string' ? url : '';

  if (hostname.includes('http://') || hostname.includes('https://')) {
    hostname = hostname.split('://')[1];
  }

  if (hostname.includes('?')) {
    hostname = hostname.split('?')[0];
  }

  if (hostname.includes('://')) {
    hostname = `${hostname.split('://')[0]}://${hostname.split('/')[2]}`;
  } else {
    hostname = hostname.split('/')[0];
  }

  return hostname;
};

export const prefixHttp = (url: string): string => {
  url = url.trim();
  return url.includes('://') ? url : `http://${url}`;
};

// 从引擎模板 url(含 %s)中找出承载搜索词的 query 参数名,如 baidu 的 "wd"。
const getQueryParamName = (engineUrl: string): string | null => {
  try {
    const u = new URL(engineUrl.replace('%s', '__RAINSEE_Q__'));
    let found: string | null = null;
    u.searchParams.forEach((v, k) => {
      if (found === null && v.includes('__RAINSEE_Q__')) found = k;
    });
    return found;
  } catch {
    // 模板非法
  }
  return null;
};

// 判断 currentUrl 是否为某引擎的搜索结果页,是则返回其中的搜索词,否则 null。
// 用于切换搜索引擎时把当前搜索词带到新引擎重新搜索。
export const extractSearchQuery = (
  engineUrl: string,
  currentUrl: string,
): string | null => {
  if (!engineUrl || !currentUrl) return null;
  try {
    const param = getQueryParamName(engineUrl);
    if (!param) return null;

    const engHost = new URL(engineUrl.replace('%s', 'x')).hostname;
    const cur = new URL(currentUrl);
    // 仅当同主域且带该 query 参数时,才认为是该引擎的结果页
    if (!hostMatches(engHost, cur.hostname)) return null;

    const q = cur.searchParams.get(param);
    return q && q.trim() !== '' ? q : null;
  } catch {
    return null;
  }
};

// 规范化密码记录保存的站点。旧数据或导入数据可能保留完整 URL，
// 而新记录保存的是 hostname，因此两种格式都需要支持。
const normalizeHostname = (raw: string): string => {
  const value = (raw || '').trim();
  if (!value) return '';

  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    return url.hostname.toLowerCase();
  } catch {
    return '';
  }
};

// 取注册主域(去端口、去子域)。tldts 基于 Public Suffix List，
// 能正确区分 example.co.uk 等多级后缀。
export const getSingledHost = (raw: string): string => {
  const host = normalizeHostname(raw);
  if (!host) return '';

  // IP 和 localhost 没有注册主域，只能精确匹配。
  if (host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host;
  }

  return getRegistrableDomain(host, { allowPrivateDomains: true }) || host;
};

export const hasSameHostname = (stored: string, current: string): boolean => {
  const a = normalizeHostname(stored);
  const b = normalizeHostname(current);
  return !!a && a === b;
};

// 密码填充的"同站"匹配:精确 host 相等,或注册主域相同(passport.x.com ↔ x.com)。
// stored 是入库时存的 url(通常是 hostname),current 是当前页 hostname。
export const hostMatches = (stored: string, current: string): boolean => {
  if (hasSameHostname(stored, current)) return true;
  const a = normalizeHostname(stored);
  const b = normalizeHostname(current);
  if (!a || !b) return false;
  const da = getSingledHost(a);
  const db = getSingledHost(b);
  return !!da && da === db;
};

const getHost = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return getDomain(url).split(':')[0];
  }
};

export const getIconByUrlNet = (url: string): string => {
  // 扩展页不走网络图标服务:host 会被解析成扩展 ID 必败,
  // 还会在 <img onError> 触发灰地球闪烁。扩展页 favicon 由 view.ts 直接填充。
  if (url.startsWith('chrome-extension://')) return '';
  try {
    const host = getHost(url);
    if (!host) return '';
    // 公共图标服务:DuckDuckGo favicon 服务
    return `https://icons.duckduckgo.com/ip3/${host}.ico`;
  } catch (e) {
    return '';
  }
};
