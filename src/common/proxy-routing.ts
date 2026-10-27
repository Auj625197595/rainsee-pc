export type ProxyRoutingMode =
  | 'global'
  | 'proxy_list'
  | 'direct_list'
  | 'bypass_mainland'
  | 'proxy_mainland';

export interface IProxyRoutingSettings {
  mode: ProxyRoutingMode;
  proxyRules: string;
  directRules: string;
  bypassLocal: boolean;
  gfwListUrl: string;
}

export interface ProxyIpRange {
  start: string;
  end: string;
}

export interface ProxyRuleSet {
  exactDomains: string[];
  suffixDomains: string[];
  wildcardDomains: string[];
  ipv4Ranges: ProxyIpRange[];
  ipv6Ranges: ProxyIpRange[];
}

export interface ProxyRouteData {
  gfwlist: ProxyRuleSet;
  gfwlistAvailable: boolean;
}

export interface ProxyRouteDecision {
  action: 'proxy' | 'direct';
  source:
    | 'local'
    | 'direct_rule'
    | 'proxy_rule'
    | 'gfwlist'
    | 'default'
    | 'unknown';
  rule?: string;
}

export interface ProxyRuleParseResult {
  ok: boolean;
  rules: ProxyRuleSet;
  normalized: string;
  ignored: number;
  errorLine?: number;
  error?: string;
}

export const DEFAULT_GFWLIST_URL =
  'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt';

export const EMPTY_PROXY_RULE_SET = (): ProxyRuleSet => ({
  exactDomains: [],
  suffixDomains: [],
  wildcardDomains: [],
  ipv4Ranges: [],
  ipv6Ranges: [],
});

const MAX_RULE_TEXT = 1024 * 1024;
const MAX_RULE_COUNT = 10000;

const uniqueSorted = (values: string[]) =>
  Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));

const normalizeDomain = (value: string): string | null => {
  const candidate = value.trim().replace(/^\.+|\.+$/g, '').toLowerCase();
  if (!candidate || candidate.length > 253 || /[:/?#@\s]/.test(candidate)) {
    return null;
  }
  try {
    const hostname = new URL(`http://${candidate}`).hostname.toLowerCase();
    if (!hostname || hostname.length > 253 || hostname.includes(':')) return null;
    if (
      hostname
        .split('.')
        .some(
          (part) =>
            !part ||
            part.length > 63 ||
            !/^[a-z0-9-]+$/i.test(part) ||
            part.startsWith('-') ||
            part.endsWith('-'),
        )
    ) {
      return null;
    }
    return hostname;
  } catch {
    return null;
  }
};

const parseIpv4 = (value: string): number | null => {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const number = Number(part);
    if (number < 0 || number > 255 || String(number) !== part.replace(/^0+(?=\d)/, '')) {
      return null;
    }
    result = result * 256 + number;
  }
  return result >>> 0;
};

const ipv4Text = (value: number) =>
  [24, 16, 8, 0].map((shift) => String((value >>> shift) & 255)).join('.');

const parseIpv6 = (value: string): string | null => {
  let input = value.toLowerCase();
  if (input.startsWith('[') && input.endsWith(']')) input = input.slice(1, -1);
  const zone = input.indexOf('%');
  if (zone >= 0) input = input.slice(0, zone);
  if (!input || (input.match(/::/g) || []).length > 1) return null;
  const halves = input.split('::');
  const expand = (part: string): string[] | null => {
    if (!part) return [];
    const out: string[] = [];
    for (const item of part.split(':')) {
      if (item.includes('.')) {
        const ipv4 = parseIpv4(item);
        if (ipv4 == null) return null;
        out.push(((ipv4 >>> 16) & 65535).toString(16));
        out.push((ipv4 & 65535).toString(16));
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(item)) return null;
        out.push(item);
      }
    }
    return out;
  };
  const left = expand(halves[0]);
  const right = expand(halves[1] || '');
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return null;
  }
  const words = [...left, ...new Array(Math.max(0, missing)).fill('0'), ...right];
  if (words.length !== 8) return null;
  return words.map((word) => word.padStart(4, '0')).join('');
};

const addHex = (value: string, addition: bigint): string =>
  (BigInt(`0x${value}`) + addition).toString(16).padStart(value.length, '0');

const parseIpRule = (
  value: string,
): { family: 4 | 6; range: ProxyIpRange; normalized: string } | null => {
  const parts = value.split('/');
  if (parts.length > 2) return null;
  const ipv4 = parseIpv4(parts[0]);
  if (ipv4 != null) {
    const prefix = parts.length === 2 ? Number(parts[1]) : 32;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
    const size = 2 ** (32 - prefix);
    const start = Math.floor(ipv4 / size) * size;
    const end = start + size - 1;
    return {
      family: 4,
      range: { start: String(start), end: String(end) },
      normalized: `${ipv4Text(start)}/${prefix}`,
    };
  }
  const ipv6 = parseIpv6(parts[0]);
  if (!ipv6) return null;
  const prefix = parts.length === 2 ? Number(parts[1]) : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null;
  const address = BigInt(`0x${ipv6}`);
  const hostBits = BigInt(128 - prefix);
  const start = hostBits === BigInt(128) ? BigInt(0) : (address >> hostBits) << hostBits;
  const end = start + (BigInt(1) << hostBits) - BigInt(1);
  return {
    family: 6,
    range: {
      start: start.toString(16).padStart(32, '0'),
      end: end.toString(16).padStart(32, '0'),
    },
    normalized: `${start.toString(16).padStart(32, '0')}/${prefix}`,
  };
};

const mergeRanges = (ranges: ProxyIpRange[], ipv6: boolean): ProxyIpRange[] => {
  const sorted = ranges.slice().sort((a, b) =>
    ipv6 ? a.start.localeCompare(b.start) : Number(a.start) - Number(b.start),
  );
  const out: ProxyIpRange[] = [];
  for (const range of sorted) {
    const previous = out[out.length - 1];
    if (!previous) {
      out.push({ ...range });
      continue;
    }
    const overlaps = ipv6
      ? range.start <= addHex(previous.end, BigInt(1))
      : Number(range.start) <= Number(previous.end) + 1;
    if (!overlaps) out.push({ ...range });
    else if (
      ipv6
        ? range.end > previous.end
        : Number(range.end) > Number(previous.end)
    ) {
      previous.end = range.end;
    }
  }
  return out;
};

export const parseProxyRules = (
  text: string,
  options: { source?: boolean; tolerateInvalid?: boolean } = {},
): ProxyRuleParseResult => {
  const empty = EMPTY_PROXY_RULE_SET();
  if (text.length > MAX_RULE_TEXT) {
    return { ok: false, rules: empty, normalized: '', ignored: 0, error: 'too_large' };
  }
  const exactDomains: string[] = [];
  const suffixDomains: string[] = [];
  const wildcardDomains: string[] = [];
  const ipv4Ranges: ProxyIpRange[] = [];
  const ipv6Ranges: ProxyIpRange[] = [];
  const normalized: string[] = [];
  let ignored = 0;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index].trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const comment = line.search(/\s+#/);
    if (comment >= 0) line = line.slice(0, comment).trim();
    if (!line) continue;
    if (normalized.length >= MAX_RULE_COUNT) {
      return {
        ok: false,
        rules: empty,
        normalized: '',
        ignored,
        errorLine: index + 1,
        error: 'too_many',
      };
    }
    const ip = parseIpRule(line);
    if (ip) {
      (ip.family === 4 ? ipv4Ranges : ipv6Ranges).push(ip.range);
      normalized.push(ip.normalized);
      continue;
    }
    const wildcard = line.startsWith('*.');
    const domain = normalizeDomain(wildcard ? line.slice(2) : line);
    if (!domain) {
      if (options.tolerateInvalid) {
        ignored++;
        continue;
      }
      return {
        ok: false,
        rules: empty,
        normalized: '',
        ignored,
        errorLine: index + 1,
        error: 'invalid_rule',
      };
    }
    if (options.source) suffixDomains.push(domain);
    else if (wildcard) wildcardDomains.push(domain);
    else exactDomains.push(domain);
    normalized.push(wildcard ? `*.${domain}` : domain);
  }
  return {
    ok: true,
    rules: {
      exactDomains: uniqueSorted(exactDomains),
      suffixDomains: uniqueSorted(suffixDomains),
      wildcardDomains: uniqueSorted(wildcardDomains),
      ipv4Ranges: mergeRanges(ipv4Ranges, false),
      ipv6Ranges: mergeRanges(ipv6Ranges, true),
    },
    normalized: uniqueSorted(normalized).join('\n'),
    ignored,
  };
};

const decodeGfwList = (text: string): string => {
  const trimmed = text.replace(/\s/g, '');
  if (!trimmed || !/^[a-z0-9+/]+={0,2}$/i.test(trimmed)) return text;
  try {
    if (typeof Buffer !== 'undefined') {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
      if (/\r?\n/.test(decoded) && /(?:\|\||@@|\[AutoProxy|^!|https?:\/\/)/m.test(decoded)) {
        return decoded;
      }
    }
  } catch {}
  return text;
};

export const parseGfwList = (input: string): ProxyRuleParseResult => {
  const text = decodeGfwList(input);
  const converted: string[] = [];
  let ignored = 0;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('!') || line.startsWith('[') || line.startsWith('@@')) {
      continue;
    }
    line = line.replace(/^\|\|/, '').replace(/^\|https?:\/\//i, '');
    line = line.replace(/^https?:\/\//i, '');
    const host = line.split(/[\/^|?*]/, 1)[0].replace(/^\*\./, '');
    if (!host || (!normalizeDomain(host) && !parseIpRule(host))) {
      ignored++;
      continue;
    }
    converted.push(host);
  }
  const parsed = parseProxyRules(converted.join('\n'), {
    source: true,
    tolerateInvalid: true,
  });
  parsed.ignored += ignored;
  return parsed;
};

const binaryHas = (values: string[], target: string): boolean => {
  let low = 0;
  let high = values.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (values[middle] === target) return true;
    if (values[middle] < target) low = middle + 1;
    else high = middle - 1;
  }
  return false;
};

const domainMatch = (host: string, rules: ProxyRuleSet): string | undefined => {
  if (binaryHas(rules.exactDomains, host)) return host;
  const labels = host.split('.');
  for (let index = 0; index < labels.length; index++) {
    const suffix = labels.slice(index).join('.');
    if (binaryHas(rules.suffixDomains, suffix)) return suffix;
    if (index > 0 && binaryHas(rules.wildcardDomains, suffix)) return `*.${suffix}`;
  }
  return undefined;
};

const ipMatch = (ip: string, rules: ProxyRuleSet): string | undefined => {
  const ipv4 = parseIpv4(ip);
  const ipv6 = ipv4 === null ? parseIpv6(ip) : null;
  if (ipv4 === null && !ipv6) return undefined;
  const ranges = ipv4 === null ? rules.ipv6Ranges : rules.ipv4Ranges;
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle];
    const before =
      ipv4 === null ? ipv6! < range.start : ipv4 < Number(range.start);
    const after =
      ipv4 === null ? ipv6! > range.end : ipv4 > Number(range.end);
    if (before) high = middle - 1;
    else if (after) low = middle + 1;
    else return ip;
  }
  return undefined;
};

const matchRuleSet = (
  host: string,
  resolvedIps: string[],
  rules: ProxyRuleSet,
): string | undefined =>
  domainMatch(host, rules) ||
  ipMatch(host, rules) ||
  resolvedIps.map((ip) => ipMatch(ip, rules)).find(Boolean);

const LOCAL_RULES = parseProxyRules(
  [
    '127.0.0.0/8',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '169.254.0.0/16',
    '::1/128',
    'fe80::/10',
    'fc00::/7',
  ].join('\n'),
).rules;

export const decideProxyRoute = (
  hostInput: string,
  routing: IProxyRoutingSettings,
  directRules: ProxyRuleSet,
  proxyRules: ProxyRuleSet,
  data: ProxyRouteData,
  resolvedIps: string[] = [],
): ProxyRouteDecision => {
  const host = normalizeDomain(hostInput) || hostInput.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    routing.bypassLocal &&
    (host === 'localhost' || host.endsWith('.localhost') || matchRuleSet(host, resolvedIps, LOCAL_RULES))
  ) {
    return { action: 'direct', source: 'local' };
  }
  const direct = matchRuleSet(host, resolvedIps, directRules);
  if (direct) return { action: 'direct', source: 'direct_rule', rule: direct };
  const proxy = matchRuleSet(host, resolvedIps, proxyRules);
  if (proxy) return { action: 'proxy', source: 'proxy_rule', rule: proxy };

  if (routing.mode === 'proxy_list') return { action: 'direct', source: 'default' };
  if (routing.mode === 'direct_list' || routing.mode === 'global') {
    return { action: 'proxy', source: 'default' };
  }
  // Mainland modes use the same GFWList classification and differ only in the
  // action for a match. There is no second China domain/IP database.
  if (
    routing.mode === 'bypass_mainland' ||
    routing.mode === 'proxy_mainland'
  ) {
    if (!data.gfwlistAvailable) return { action: 'proxy', source: 'unknown' };
    const match = matchRuleSet(host, resolvedIps, data.gfwlist);
    if (routing.mode === 'proxy_mainland') {
      return match
        ? { action: 'direct', source: 'gfwlist', rule: match }
        : { action: 'proxy', source: 'default' };
    }
    return match
      ? { action: 'proxy', source: 'gfwlist', rule: match }
      : { action: 'direct', source: 'default' };
  }
  return { action: 'proxy', source: 'unknown' };
};

const serializeRules = (rules: ProxyRuleSet) => JSON.stringify(rules);

export const generateProxyPac = (
  routing: IProxyRoutingSettings,
  directRules: ProxyRuleSet,
  proxyRules: ProxyRuleSet,
  data: ProxyRouteData,
  proxyDirective: string,
): string => {
  const payload = JSON.stringify({ routing, directRules, proxyRules, data, proxyDirective });
  return `// Generated by Rainsee proxy routing.\nvar P=${payload};\n${pacRuntimeSource}\nfunction FindProxyForURL(url,host){return route(host);}\n`;
};

// ES5-only PAC runtime: Chromium evaluates this in a restricted PAC sandbox.
const pacRuntimeSource = `
function bsearch(a,v){var l=0,h=a.length-1,m;while(l<=h){m=(l+h)>>1;if(a[m]===v)return true;if(a[m]<v)l=m+1;else h=m-1}return false}
function v4(s){var p=s.split('.'),n=0,i,x;if(p.length!==4)return null;for(i=0;i<4;i++){if(!/^\\d{1,3}$/.test(p[i]))return null;x=Number(p[i]);if(x<0||x>255)return null;n=n*256+x}return n}
function v6(s){s=s.toLowerCase().replace(/^\\[|\\]$/g,'').split('%')[0];if(!s||s.split('::').length>2)return null;var h=s.split('::'),l=h[0]?h[0].split(':'):[],r=h[1]?h[1].split(':'):[],i,o=[],miss=8-l.length-r.length;function add(x){if(x.indexOf('.')>=0){var n=v4(x);if(n===null)return false;o.push(((n>>>16)&65535).toString(16));o.push((n&65535).toString(16));return true}if(!/^[0-9a-f]{1,4}$/.test(x))return false;o.push(x);return true}for(i=0;i<l.length;i++)if(!add(l[i]))return null;if(h.length===2){if(miss<1)return null;while(miss--)o.push('0')}for(i=0;i<r.length;i++)if(!add(r[i]))return null;if(o.length!==8)return null;for(i=0;i<8;i++)o[i]=('0000'+o[i]).slice(-4);return o.join('')}
function iphit(ip,R){var a=v4(ip),v=a===null?v6(ip):a,rs=a===null?R.ipv6Ranges:R.ipv4Ranges,l=0,h=rs.length-1,m,s,e;if(v===null)return false;while(l<=h){m=(l+h)>>1;s=a===null?rs[m].start:Number(rs[m].start);e=a===null?rs[m].end:Number(rs[m].end);if(v<s)h=m-1;else if(v>e)l=m+1;else return ip}return false}
function dhit(host,R){if(bsearch(R.exactDomains,host))return host;var p=host.split('.'),i,s;for(i=0;i<p.length;i++){s=p.slice(i).join('.');if(bsearch(R.suffixDomains,s))return s;if(i>0&&bsearch(R.wildcardDomains,s))return '*.'+s}return false}
// Never resolve a hostname from PAC. dnsResolve/dnsResolveEx use the local
// resolver and leak the destination domain before the proxy sees it. Domain
// rules still match normally; CIDR rules apply to literal IP destinations.
function ips(host){return v4(host)!==null||v6(host)!==null?[host]:[]}
function hit(host,all,R){var m=dhit(host,R)||iphit(host,R),i;if(m)return m;for(i=0;i<all.length;i++){m=iphit(all[i],R);if(m)return m}return false}
function route(raw){var host=String(raw||'').toLowerCase().replace(/^\\[|\\]$/g,''),all=ips(host),r=P.routing,m;
if(r.bypassLocal&&(host==='localhost'||/\\.localhost$/.test(host)||hit(host,all,${serializeRules(LOCAL_RULES)})))return 'DIRECT';
if(hit(host,all,P.directRules))return 'DIRECT';if(hit(host,all,P.proxyRules))return P.proxyDirective;
if(r.mode==='proxy_list')return 'DIRECT';if(r.mode==='direct_list'||r.mode==='global')return P.proxyDirective;
if(r.mode==='bypass_mainland'||r.mode==='proxy_mainland'){if(!P.data.gfwlistAvailable)return P.proxyDirective;m=hit(host,all,P.data.gfwlist);if(r.mode==='proxy_mainland')return m?'DIRECT':P.proxyDirective;return m?P.proxyDirective:'DIRECT'}
return P.proxyDirective}
`;
