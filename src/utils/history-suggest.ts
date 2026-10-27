import type {IHistoryItem, ISearchEngine, ISuggestion} from '~/interfaces';
import {parseEngine} from '~/utils/search-engine';

// 地址栏历史联想的全量检索。纯逻辑,由主进程 storage 持有实例(见 history-suggest IPC)。
//
// 原实现由搜索弹窗拉取最近 500 条历史在 renderer 侧过滤,更早的记录永远联想不到。
// 这里直接在 storage.history 全量上检索,只把命中的少量条目回传。性能靠两层缓存:
//   1. 每条记录的派生字段(去重键/小写标题/搜索词)按对象缓存在 WeakMap,
//      只有 url/title 被原地改写(View.updateData、云同步合并)时才重算;
//   2. 按去重键保留最新一次访问的「唯一记录」列表。新访问 push 到末尾时增量合并,
//      数组被替换(删除/导入/排序)或去重键被原地改写时才全量重建。
// 每次查询只遍历唯一记录,网址前缀层/搜索词凑满上限即提前结束。

const URL_PREFIX = /^(?:https?:\/\/)?(?:www\.)?/i;
// 只取 scheme://host 部分做搜索引擎 host 预筛,避免对每条历史都 new URL。
const URL_HOST = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?([^/?#:]+)/i;

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 50;

// 去掉协议、www. 与末尾斜杠,作为展示网址与去重键(与地址栏展示保持一致)。
export const cleanHistoryUrl = (url: string): string => {
  let u = url.replace(URL_PREFIX, '');
  if (u.endsWith('/')) u = u.slice(0, -1);
  return u;
};

export type SearchQueryExtractor = (url: string) => string | null;

// 与 findSearchQuery 语义一致(按引擎顺序取第一个命中的非空搜索词),
// 但引擎模板只解析一次,且先用 host 预筛,非搜索结果页不会构造 URL 对象。
export const createSearchQueryExtractor = (
  engines: ISearchEngine[],
): SearchQueryExtractor => {
  const keysByHost = new Map<string, string[]>();
  const hostnames = new Set<string>();

  for (const engine of engines || []) {
    const info = parseEngine((engine && engine.url) || '');
    if (!info || !info.queryKey) continue;
    const keys = keysByHost.get(info.host) || [];
    if (keys.indexOf(info.queryKey) === -1) keys.push(info.queryKey);
    keysByHost.set(info.host, keys);
    hostnames.add(info.host.replace(/:\d+$/, ''));
  }

  return (url: string) => {
    if (!url || keysByHost.size === 0) return null;
    const match = URL_HOST.exec(url);
    if (!match) return null;
    if (!hostnames.has(match[1].toLowerCase().replace(/^www\./, ''))) {
      return null;
    }

    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    const keys = keysByHost.get(u.host.replace(/^www\./, ''));
    if (!keys) return null;
    for (const key of keys) {
      const q = u.searchParams.get(key);
      if (q && q.trim() !== '') return q.trim();
    }
    return null;
  };
};

// 网址项匹配规则,主进程检索与 renderer 本地重筛共用。
// 返回 'prefix'(可做行内补全)/'words'(关键词都出现在标题或网址中)/null。
const matchHistoryUrl = (
  urlLower: string,
  titleLower: string,
  filterPart: string,
  wwwPrefix: boolean,
  words: string[],
): 'prefix' | 'words' | null => {
  if (wwwPrefix || urlLower.startsWith(filterPart)) return 'prefix';
  if (
    words.every((word) => titleLower.includes(word) || urlLower.includes(word))
  ) {
    return 'words';
  }
  return null;
};

const parseUrlFilter = (filter: string) => {
  const filterPart = filter.replace(URL_PREFIX, '');
  return {
    filterPart,
    // 输入 "w"/"ww"/"www" 时视为 www. 前缀的一部分,与原实现一致。
    wwwPrefix: 'www.'.startsWith(filterPart),
    words: filter.split(/\s+/).filter(Boolean),
  };
};

// 用上一次检索结果按新的过滤词同步重筛。主进程结果经 IPC 异步返回,
// 期间下拉框与回车默认项需要先对上当前输入;继续输入时这是正确结果的子集。
export const refilterHistoryResult = (
  previous: HistorySuggestResult,
  rawFilter: string,
): HistorySuggestResult => {
  const filter = rawFilter.trim().toLowerCase();
  const {filterPart, wwwPrefix, words} = parseUrlFilter(filter);
  const prefixMatched: ISuggestion[] = [];
  const wordMatched: ISuggestion[] = [];

  if (filter !== '') {
    for (const item of previous.history) {
      const match = matchHistoryUrl(
        (item.displayUrl || '').toLowerCase(),
        (item.primaryText || '').toLowerCase(),
        filterPart,
        wwwPrefix,
        words,
      );
      if (match === 'prefix') {
        prefixMatched.push({...item, canSuggest: true});
      } else if (match === 'words') {
        wordMatched.push({...item, canSuggest: false});
      }
    }
  }

  return {
    history: prefixMatched.concat(wordMatched),
    searchTerms: previous.searchTerms.filter(
      (item) =>
        filter === '' ||
        (item.primaryText || '').toLowerCase().startsWith(filter),
    ),
  };
};

const engineSignature = (engines: ISearchEngine[]) =>
  (engines || []).map((engine) => (engine && engine.url) || '').join('\n');

interface DerivedEntry {
  item: IHistoryItem;
  rawUrl: string;
  rawTitle: string;
  key: string;
  urlLower: string;
  titleLower: string;
  // 搜索词按引擎配置签名懒计算;签名不同即重算。
  termSig: string | null;
  term: string | null;
}

export interface HistorySuggestRequest {
  filter?: string;
  // 需要网址历史建议
  urls?: boolean;
  // 需要历史搜索词建议
  terms?: boolean;
  // 搜索结果页已由历史搜索词代表,不再作为网址项重复出现(含行内补全)。
  // 与 terms 分开:来源筛选只看书签时不取搜索词,但补全口径要保持一致。
  excludeSearchPages?: boolean;
  limit?: number;
}

export interface HistorySuggestResult {
  history: ISuggestion[];
  searchTerms: ISuggestion[];
}

export interface HistorySuggestRemoveRequest {
  type?: string;
  url?: string;
  query?: string;
}

export class HistorySuggestIndex {
  private derived = new WeakMap<IHistoryItem, DerivedEntry>();

  private source: IHistoryItem[] | null = null;

  private sourceLength = -1;

  private sourceFirst: IHistoryItem | undefined;

  private sourceLast: IHistoryItem | undefined;

  // 按去重键保留最新一次访问,最新在前。直接存派生字段,查询时免去逐条 WeakMap 查找。
  private unique: DerivedEntry[] = [];

  private extractor: SearchQueryExtractor | null = null;

  private extractorSig: string | null = null;

  // 某条记录的去重键被原地改写过,唯一列表的去重结果已不可信,下次查询全量重建。
  private keysDirty = false;

  public query(
    history: IHistoryItem[],
    request: HistorySuggestRequest,
    engines: ISearchEngine[],
    resolveFavicon?: (favicon: string) => string | undefined,
  ): HistorySuggestResult {
    const filter =
      typeof request?.filter === 'string'
        ? request.filter.trim().toLowerCase()
        : '';
    const rawLimit = Math.floor(Number(request?.limit));
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const wantUrls = !!request?.urls && filter !== '';
    const wantTerms = !!request?.terms;
    const needTerm = wantTerms || (wantUrls && !!request?.excludeSearchPages);

    const result: HistorySuggestResult = {history: [], searchTerms: []};
    if (!wantUrls && !wantTerms) return result;

    this.sync(history || []);
    const sig = needTerm ? this.prepareExtractor(engines) : null;
    const termOf = (entry: DerivedEntry) => {
      if (entry.termSig !== sig) {
        entry.term = this.extractor(entry.rawUrl);
        entry.termSig = sig;
      }
      return entry.term;
    };

    // 网址层:前缀命中优先(可做行内补全),其次每个关键词都出现在标题或网址中。
    const {filterPart, wwwPrefix, words} = parseUrlFilter(filter);
    const prefixMatched: ISuggestion[] = [];
    const wordMatched: ISuggestion[] = [];
    let urlsDone = !wantUrls;

    // 搜索词层:过滤词为空(聚焦空地址栏)时按最近访问返回,否则前缀过滤。
    const terms = result.searchTerms;
    const seenTerms = new Set<string>();
    let termsDone = !wantTerms;

    for (let entry of this.unique) {
      if (urlsDone && termsDone) break;

      const {item} = entry;
      if (
        item.url !== entry.rawUrl ||
        item.title !== entry.rawTitle ||
        item.isDeleted
      ) {
        // 记录在缓存后被原地改写(View.updateData、云同步合并)。去重键不变时只刷新
        // 派生字段;键变了或记录失效,去重结果已不可信,全量重建后重查(罕见)。
        const fresh = this.derive(item);
        if (!fresh || fresh.key !== entry.key) {
          this.keysDirty = true;
          return this.query(history, request, engines, resolveFavicon);
        }
        entry = fresh;
      }

      const term = needTerm ? termOf(entry) : null;

      if (term && !termsDone) {
        const lower = term.toLowerCase();
        if (
          !seenTerms.has(lower) &&
          (filter === '' || lower.startsWith(filter))
        ) {
          seenTerms.add(lower);
          terms.push({primaryText: term, isSearch: true, type: 'searchTerm'});
          if (terms.length >= limit) termsDone = true;
        }
      }

      if (urlsDone || (term && request.excludeSearchPages)) continue;

      const match = matchHistoryUrl(
        entry.urlLower,
        entry.titleLower,
        filterPart,
        wwwPrefix,
        words,
      );
      if (match === 'prefix') {
        prefixMatched.push(this.toSuggestion(entry, true, resolveFavicon));
        if (prefixMatched.length >= limit) urlsDone = true;
      } else if (match === 'words' && wordMatched.length < limit) {
        wordMatched.push(this.toSuggestion(entry, false, resolveFavicon));
      }
    }

    if (wantUrls) {
      result.history = prefixMatched.concat(wordMatched).slice(0, limit);
    }
    return result;
  }

  // 返回要删除的历史 _id。网址项按去重键匹配,协议/www/末尾斜杠变体一并删除,
  // 否则删掉一条后同一网址的另一个变体会立刻顶上来;搜索词项匹配所有引擎。
  public findRemovalIds(
    history: IHistoryItem[],
    request: HistorySuggestRemoveRequest,
    engines: ISearchEngine[],
  ): string[] {
    const ids: string[] = [];

    if (request?.type === 'history') {
      const url = typeof request.url === 'string' ? request.url : '';
      if (!url) return ids;
      const key = cleanHistoryUrl(url);
      for (const item of history || []) {
        if (!item || !item._id || !item.url) continue;
        if (item.url === url || cleanHistoryUrl(item.url) === key) {
          ids.push(item._id);
        }
      }
      return ids;
    }

    if (request?.type === 'searchTerm') {
      const query =
        typeof request.query === 'string'
          ? request.query.trim().toLowerCase()
          : '';
      if (!query) return ids;
      this.prepareExtractor(engines);
      for (const item of history || []) {
        if (!item || !item._id || !item.url) continue;
        const term = this.extractor(item.url);
        if (term && term.toLowerCase() === query) ids.push(item._id);
      }
    }

    return ids;
  }

  private toSuggestion(
    entry: DerivedEntry,
    canSuggest: boolean,
    resolveFavicon?: (favicon: string) => string | undefined,
  ): ISuggestion {
    const {item} = entry;
    return {
      primaryText: item.title,
      displayUrl: entry.key,
      url: item.url,
      favicon: resolveFavicon ? resolveFavicon(item.favicon) : item.favicon,
      canSuggest,
      type: 'history',
    };
  }

  // 与原 topsites-get 一致只收录有标题的记录(过滤重定向/未加载完成的空白项),
  // 并排除云同步墓碑。
  private derive(item: IHistoryItem): DerivedEntry | null {
    if (!item || !item.url || !item.title || item.isDeleted) return null;
    let entry = this.derived.get(item);
    if (!entry || entry.rawUrl !== item.url || entry.rawTitle !== item.title) {
      const key = cleanHistoryUrl(item.url);
      if (entry && entry.key !== key) this.keysDirty = true;
      entry = {
        item,
        rawUrl: item.url,
        rawTitle: item.title,
        key,
        urlLower: key.toLowerCase(),
        titleLower: item.title.toLowerCase(),
        termSig: null,
        term: null,
      };
      this.derived.set(item, entry);
    }
    return entry;
  }

  // history 以时间升序存放(新访问 push 到末尾),倒序遍历即最新在前。
  // 删除/导入/排序都会替换数组;同一数组只追加时增量合并,首尾引用兜住原地重排。
  private sync(history: IHistoryItem[]) {
    const sameArray =
      !this.keysDirty &&
      history === this.source &&
      history[0] === this.sourceFirst &&
      history.length >= this.sourceLength &&
      history[this.sourceLength - 1] === this.sourceLast;

    if (sameArray && history.length === this.sourceLength) return;

    if (sameArray) {
      // 只有新追加的记录:新记录(最新在前)接到唯一列表头部,并剔除被它们覆盖的旧记录。
      const fresh: DerivedEntry[] = [];
      const freshKeys = new Set<string>();
      for (let i = history.length - 1; i >= this.sourceLength; i--) {
        const entry = this.derive(history[i]);
        if (!entry || freshKeys.has(entry.key)) continue;
        freshKeys.add(entry.key);
        fresh.push(entry);
      }
      if (fresh.length > 0) {
        const rest = this.unique.filter((entry) => !freshKeys.has(entry.key));
        this.unique = fresh.concat(rest);
      }
    } else {
      const seen = new Set<string>();
      const unique: DerivedEntry[] = [];
      for (let i = history.length - 1; i >= 0; i--) {
        const entry = this.derive(history[i]);
        if (!entry || seen.has(entry.key)) continue;
        seen.add(entry.key);
        unique.push(entry);
      }
      this.unique = unique;
      // 重建过程中 derive 发现的改写已体现在新列表里,最后再清标记。
      this.keysDirty = false;
    }

    this.source = history;
    this.sourceLength = history.length;
    this.sourceFirst = history[0];
    this.sourceLast = history[history.length - 1];
  }

  private prepareExtractor(engines: ISearchEngine[]): string {
    const sig = engineSignature(engines);
    if (!this.extractor || sig !== this.extractorSig) {
      this.extractor = createSearchQueryExtractor(engines);
      this.extractorSig = sig;
    }
    return sig;
  }
}
