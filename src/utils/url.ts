import { TLD_LIST } from './tld-list';

// 已知协议前缀:命中即视为完整 URL,直接导航(对应安卓 UrlUtils.isUrl 的协议分支)。
// javascript: 列入:否则地址栏输入 javascript:alert(1) 会被 isSpecialChar(含 "()")
// 判为搜索词转走搜索引擎,导致用地址栏收藏 bookmarklet 时存成搜索 URL(中毒)。
const WELL_KNOWN_PROTOCOL_RE =
  /^(https?|file|ftp|view-source|chrome-extension|chrome|about|edge|blob|data|moz-extension|yj-extension|yjllq|javascript):/i;

const isWellKnownUrl = (thing: string): boolean =>
  WELL_KNOWN_PROTOCOL_RE.test(thing);

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
  const thing = (input || '').trim();
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
): { tld: string | null; isKeyword: boolean } => {
  let tld: string | null = null;
  let tldIndex = -1;

  for (const candidate of TLD_LIST) {
    if (thing.includes(candidate) && thing !== candidate) {
      const idx = thing.lastIndexOf(candidate);
      if (
        tld === null ||
        idx > tldIndex ||
        (idx === tldIndex && candidate.length > tld.length)
      ) {
        tld = candidate;
        tldIndex = idx;
      }
      if (thing.endsWith(tld)) break;
    }
  }

  if (!tld) return { tld: null, isKeyword: true };

  let isKeyword = false;
  if (!thing.endsWith(tld)) {
    if (
      thing.includes(tld + '/') ||
      thing.includes(tld + '#') ||
      thing.includes(tld + '?') ||
      thing.includes(tld + ':')
    ) {
      // TLD 后紧跟路径/锚点/查询/端口 → 仍是网址。
    } else {
      isKeyword = true;
    }
  }
  return { tld, isKeyword };
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
  const thing = input.trim();
  if (thing === '') return false;

  if (isWellKnownUrl(thing)) return true;

  // 外部协议(motrixnext://、thunder://、magnet:、mailto: 等)也算 URL:
  // 这样地址栏输入时不会被当搜索词,联想/补全也按网址呈现。
  if (getExternalProtocol(thing)) return true;

  if (isWindowsAbsolutePath(thing)) return true;

  if (isIPv4(thing.split(':')[0])) return true;

  if (isLocalhost(thing)) return true;

  if (isSpecialChar(thing)) return false;

  const { tld, isKeyword } = pickTld(thing);
  if (!tld || isKeyword) return false;

  // 按后缀在输入中的位置决定补 www 还是不补,再用 host 校验整体合法性。
  const temp = thing.split(tld).join('');
  let url: string;
  if (temp.includes('.') && !temp.startsWith('.')) {
    url = `http://${thing}`;
  } else if (temp.includes('.') && temp.startsWith('.')) {
    url = `http://www${thing}`;
  } else {
    url = `http://${thing}`;
  }
  return getHostOf(url) !== '';
};

// 把地址栏输入解析为最终要加载的 URL:是域名/IP/完整 URL 则补 http:// 直达,
// 否则送搜索引擎搜索。searchEngineUrl 为含 %s 的引擎模板。对齐安卓 RealurlUtils.realurl。
export const realurl = (
  input: string,
  searchEngineUrl: string,
): string => {
  const thing = (input || '').trim();
  if (thing === '') return searchEngineUrl || '';

  if (isWellKnownUrl(thing)) return thing;

  // 外部协议原样返回:交由调用方(openExternal)派发给系统应用,既不补 http:// 也不搜索。
  if (getExternalProtocol(thing)) return thing;

  if (isWindowsAbsolutePath(thing)) return toFileUrl(thing);

  if (isIPv4(thing.split(':')[0]) || isLocalhost(thing)) {
    return thing.indexOf('://') === -1 ? `http://${thing}` : thing;
  }

  if (isSpecialChar(thing)) {
    return getSearchUrl(thing, searchEngineUrl);
  }

  const { tld, isKeyword } = pickTld(thing);
  if (!tld || isKeyword) {
    return getSearchUrl(thing, searchEngineUrl);
  }

  const temp = thing.split(tld).join('');
  let url: string;
  if (temp.includes('.') && !temp.startsWith('.')) {
    url = `http://${thing}`;
  } else if (temp.includes('.') && temp.startsWith('.')) {
    url = `http://www${thing}`;
  } else {
    url = `http://${thing}`;
  }

  if (getHostOf(url) === '') {
    return getSearchUrl(thing, searchEngineUrl);
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

export const getDomain = (url: string): string => {
  let hostname = url;

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

// 取注册主域(去端口、去子域),对齐安卓 UrlUtils.getSingledianHost / 鸿蒙 UrlUtil。
// 仅用于密码填充的"同站"判断,不追求 PSL 精度。
export const getSingledHost = (raw: string): string => {
  try {
    let host = raw;
    // 允许传入完整 url 或纯 host
    if (host.includes('://')) host = new URL(host).hostname;
    else host = host.split('/')[0];
    host = host.split(':')[0].toLowerCase();
    if (!host) return '';
    // IP 直接返回
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
    // 去掉前导子域,保留主域(与安卓/鸿蒙逻辑逐字对应:最多去两级)
    if (host.indexOf('.') !== host.lastIndexOf('.')) {
      host = host.substring(host.indexOf('.') + 1);
    }
    if (host.indexOf('.') !== host.lastIndexOf('.')) {
      host = host.substring(host.indexOf('.') + 1);
    }
    return host;
  } catch (e) {
    return '';
  }
};

// 密码填充的"同站"匹配:精确 host 相等,或注册主域相同(passport.x.com ↔ x.com)。
// stored 是入库时存的 url(通常是 hostname),current 是当前页 hostname。
export const hostMatches = (stored: string, current: string): boolean => {
  if (!stored || !current) return false;
  const a = stored.split(':')[0].toLowerCase();
  const b = current.split(':')[0].toLowerCase();
  if (a === b) return true;
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

const toBase64 = (str: string): string => {
  return btoa(unescape(encodeURIComponent(str)));
};

export const getIconByUrlNet = (url: string): string => {
  try {
    let host = getHost(url);

    if (url.startsWith('chrome://')) {
      if (url.includes('://bookmarks')) {
        host = 'bookmarks2.yjllq.com';
      } else if (url.includes('://download')) {
        host = 'download.yjllq.com';
      } else if (url.includes('://history')) {
        host = 'history.yjllq.com';
      } else if (url.includes('://flags')) {
        host = 'flags.yjllq.com';
      }
    } else {
      if (url.includes('://bookmarks')) {
        host = 'bookmarks.yjllq.com';
      } else if (url.includes('://download')) {
        host = 'download.yjllq.com';
      } else if (url.includes('://history')) {
        host = 'history.yjllq.com';
      } else if (url.includes('://flags')) {
        host = 'flags.yjllq.com';
      }
    }

    let protocol: string = null;
    let name = host;

    try {
      const parsed = new URL(url);
      protocol = parsed.protocol.replace(':', '');

      if (parsed.port !== '') {
        name = `${name}:${parsed.port}`;
      }
    } catch (e) {
      name = host;
    }

    let iconTarget = `http://${name}`;

    if (protocol === 'https') {
      iconTarget = iconTarget.replace('http://', 'https://');
    }

    return `https://icon.rainsee.cn/iconv2.php?base=${toBase64(iconTarget)}`.trim();
  } catch (e) {
    return `http://icon.yjllq.com/get.php?url=${url}`;
  }
};
