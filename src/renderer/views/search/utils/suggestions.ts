import { ipcRenderer } from 'electron';

import { networkMainChannel } from '~/common/rpc/network';
import { IBookmark, ISearchEngine, ISuggestion } from '~/interfaces';
import { BAIDU_SUGGEST_URL } from '~/constants/settings';
import type {
  HistorySuggestRequest,
  HistorySuggestResult,
} from '~/utils/history-suggest';

import store from '../store';

const URL_REGEX = /(http(s?)):\/\/(www.)?|www./gi;

const cleanUrl = (url: string) => {
  let u = url.replace(URL_REGEX, '');
  if (u.endsWith('/')) u = u.slice(0, -1);
  return u;
};

export const EMPTY_HISTORY_RESULT: HistorySuggestResult = {
  history: [],
  searchTerms: [],
};

// 历史网址与历史搜索词建议:主进程在全量历史上检索并按网址/搜索词去重,
// 这里只拿回命中的少量条目,不再把历史快照传到弹窗。
// 网址项:前缀命中优先(canSuggest 用于行内补全),其次关键词命中标题或网址。
// 搜索词项:过滤词为空(聚焦空地址栏)时按最近访问返回,否则前缀过滤。
export const fetchHistorySuggestions = async (
  request: HistorySuggestRequest,
): Promise<HistorySuggestResult> => {
  if (!request.urls && !request.terms) return EMPTY_HISTORY_RESULT;
  if (!request.terms && (request.filter || '').trim() === '') {
    return EMPTY_HISTORY_RESULT;
  }

  try {
    const result = await ipcRenderer.invoke('history-suggest', request);
    return {
      history: Array.isArray(result?.history) ? result.history : [],
      searchTerms: Array.isArray(result?.searchTerms)
        ? result.searchTerms
        : [],
    };
  } catch (error) {
    console.error('[history-suggest] query failed', error);
    return EMPTY_HISTORY_RESULT;
  }
};

// 书签建议:标题或网址包含匹配。
export const getBookmarkSuggestions = (
  filter: string,
  bookmarks: IBookmark[] = store.bookmarks,
): ISuggestion[] => {
  filter = filter.trim().toLowerCase();
  if (filter === '') return [];

  const result: ISuggestion[] = [];
  for (const item of bookmarks) {
    if (item.isFolder || !item.url) continue;
    const title = (item.title || '').toLowerCase();
    const url = item.url.toLowerCase();
    if (title.includes(filter) || url.includes(filter)) {
      result.push({
        primaryText: item.title || item.url,
        displayUrl: cleanUrl(item.url),
        url: item.url,
        favicon: item.favicon,
        type: 'bookmark',
      });
      if (result.length >= 6) break;
    }
  }

  return result;
};

// 打开的标签页建议:标题或网址包含匹配,携带 tabId 供跳转。
export interface ISuggestionTab {
  id?: number;
  title?: string;
  url?: string;
  favicon?: string;
}

export const getTabSuggestions = (
  filter: string,
  tabs: ISuggestionTab[] = store.tabs,
): ISuggestion[] => {
  filter = filter.trim().toLowerCase();
  if (filter === '') return [];

  const result: ISuggestion[] = [];
  for (const tab of tabs) {
    const title = (tab.title || '').toLowerCase();
    const url = (tab.url || '').toLowerCase();
    if (title.includes(filter) || url.includes(filter)) {
      result.push({
        primaryText: tab.title || tab.url,
        secondaryText: cleanUrl(tab.url || ''),
        url: tab.url || '',
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
export const getSearchSuggestions = (
  filter: string,
  engine: ISearchEngine = store.searchEngine,
): Promise<string[]> =>
  // eslint-disable-next-line
  new Promise(async (resolve, reject) => {
    const input = filter.trim().toLowerCase();
    if (input === '') return resolve([]);

    const engineUrl = engine && engine.keywordsUrl;
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


