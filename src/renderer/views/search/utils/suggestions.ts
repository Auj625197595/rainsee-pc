import { networkMainChannel } from '~/common/rpc/network';
import { ISuggestion } from '~/interfaces';
import { BAIDU_SUGGEST_URL } from '~/constants/settings';

import store from '../store';

const URL_REGEX = /(http(s?)):\/\/(www.)?|www./gi;

const cleanUrl = (url: string) => {
  let u = url.replace(URL_REGEX, '');
  if (u.endsWith('/')) u = u.slice(0, -1);
  return u;
};

// 解析单个搜索引擎的 host 与查询参数名(%s 所在的参数)。
const parseEngine = (engineUrl: string) => {
  try {
    const u = new URL(engineUrl.replace('%s', '__Q__'));
    let queryKey = '';
    u.searchParams.forEach((value, key) => {
      if (value.indexOf('__Q__') !== -1) queryKey = key;
    });
    return { host: u.host.replace(/^www\./, ''), queryKey };
  } catch (e) {
    return null;
  }
};

// 从一条历史 URL 中,按任意已知搜索引擎规则提取搜索词,提取不到返回 null。
const extractSearchQuery = (rawUrl: string): string | null => {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch (e) {
    return null;
  }
  const host = u.host.replace(/^www\./, '');
  for (const engine of store.settings.searchEngines) {
    const info = parseEngine(engine.url || '');
    if (!info || !info.queryKey) continue;
    if (host !== info.host) continue;
    const q = u.searchParams.get(info.queryKey);
    if (q && q.trim() !== '') return q.trim();
  }
  return null;
};

// 历史记录建议:网址前缀匹配优先,其次标题包含匹配。canSuggest 用于自动补全。
export const getHistorySuggestions = (filter: string): ISuggestion[] => {
  filter = filter.trim().toLowerCase();
  if (filter === '') return [];

  const filterPart = filter.replace(URL_REGEX, '');
  const urlMatched: ISuggestion[] = [];
  const titleMatched: ISuggestion[] = [];
  const seen = new Set<string>();

  for (const item of store.visitedItems) {
    const urlPart = cleanUrl(item.url);
    if (seen.has(urlPart)) continue;

    if (
      urlPart.toLowerCase().startsWith(filterPart) ||
      `www.${urlPart}`.startsWith(filterPart)
    ) {
      seen.add(urlPart);
      urlMatched.push({
        primaryText: item.title,
        url: urlPart,
        favicon: item.favicon,
        canSuggest: true,
        type: 'history',
      });
    } else if ((item.title || '').toLowerCase().includes(filter)) {
      seen.add(urlPart);
      titleMatched.push({
        primaryText: item.title,
        url: urlPart,
        favicon: item.favicon,
        canSuggest: false,
        type: 'history',
      });
    }
  }

  return urlMatched.concat(titleMatched).slice(0, 6);
};

// 历史搜索词建议:从历史 URL 中按任意搜索引擎规则提取搜索词并去重。
export const getSearchHistorySuggestions = (filter: string): ISuggestion[] => {
  filter = filter.trim().toLowerCase();
  // 过滤词为空时(如聚焦空地址栏),按最近访问顺序返回历史搜索词,不做前缀过滤。

  const result: ISuggestion[] = [];
  const seen = new Set<string>();

  for (const item of store.visitedItems) {
    const query = extractSearchQuery(item.url);
    if (!query) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    if (filter !== '' && !key.startsWith(filter)) continue;
    seen.add(key);
    result.push({
      primaryText: query,
      isSearch: true,
      type: 'searchTerm',
    });
    if (result.length >= 6) break;
  }

  return result;
};

// 书签建议:标题或网址包含匹配。
export const getBookmarkSuggestions = (filter: string): ISuggestion[] => {
  filter = filter.trim().toLowerCase();
  if (filter === '') return [];

  const result: ISuggestion[] = [];
  for (const item of store.bookmarks) {
    if (item.isFolder || !item.url) continue;
    const title = (item.title || '').toLowerCase();
    const url = item.url.toLowerCase();
    if (title.includes(filter) || url.includes(filter)) {
      result.push({
        primaryText: item.title || item.url,
        url: cleanUrl(item.url),
        favicon: item.favicon,
        type: 'bookmark',
      });
      if (result.length >= 6) break;
    }
  }

  return result;
};

// 打开的标签页建议:标题或网址包含匹配,携带 tabId 供跳转。
export const getTabSuggestions = (filter: string): ISuggestion[] => {
  filter = filter.trim().toLowerCase();
  if (filter === '') return [];

  const result: ISuggestion[] = [];
  for (const tab of store.tabs) {
    const title = (tab.title || '').toLowerCase();
    const url = (tab.url || '').toLowerCase();
    if (title.includes(filter) || url.includes(filter)) {
      result.push({
        primaryText: tab.title || tab.url,
        secondaryText: cleanUrl(tab.url || ''),
        favicon: tab.favicon,
        type: 'tab',
        tabId: tab.id,
      });
      if (result.length >= 4) break;
    }
  }

  return result;
};

// requestURL 以 binary(Latin-1)读取响应,中文 UTF-8 会被逐字节映射成乱码。
// 这里把每个字符还原成字节再按 UTF-8 解码。
const decodeUtf8 = (binary: string): string => {
  try {
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i) & 0xff;
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    return binary;
  }
};

// 搜索引擎联想词:优先用当前默认引擎的 keywordsUrl,缺失则回退百度。
// 兼容两种返回:Chrome 格式 [q, [s1,s2...]] 与百度 sugrec { g:[{q},..] }。
export const getSearchSuggestions = (filter: string): Promise<string[]> =>
  // eslint-disable-next-line
  new Promise(async (resolve, reject) => {
    const input = filter.trim().toLowerCase();
    if (input === '') return resolve([]);

    const engineUrl = store.searchEngine && store.searchEngine.keywordsUrl;
    const url = (engineUrl && engineUrl !== '' ? engineUrl : BAIDU_SUGGEST_URL)
      .replace('%s', encodeURIComponent(input));

    try {
      const raw = (
        await networkMainChannel.getInvoker().request(url)
      ).data;
      const data = JSON.parse(decodeUtf8(raw));

      let list: string[] = [];

      if (Array.isArray(data) && Array.isArray(data[1])) {
        // Chrome / opensearch 格式
        list = data[1].map((x: any) => String(x));
      } else if (data && Array.isArray(data.g)) {
        // 百度 sugrec 格式
        list = data.g.map((x: any) => String(x.q));
      } else if (data && Array.isArray(data.s)) {
        // 百度 su 格式兜底
        list = data.s.map((x: any) => String(x));
      }

      const suggestions: string[] = [];
      for (const item of list) {
        const s = item.toLowerCase();
        if (s && suggestions.indexOf(s) === -1) suggestions.push(s);
      }

      resolve(suggestions.sort((a, b) => a.length - b.length).slice(0, 6));
    } catch (e) {
      reject(e);
    }
  });


