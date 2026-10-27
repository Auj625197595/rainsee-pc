import { observable, computed, makeObservable } from 'mobx';

import {
  EMPTY_HISTORY_RESULT,
  fetchHistorySuggestions,
  getBookmarkSuggestions,
  getTabSuggestions,
  getSearchSuggestions,
  ISuggestionTab,
} from '../utils/suggestions';
import { extractLinks } from '../utils/multi-link';
import { isURL, normalizeUrlInput } from '~/utils';
import { IBookmark, ISearchEngine, ISuggestion } from '~/interfaces';
import {
  HistorySuggestResult,
  refilterHistoryResult,
} from '~/utils/history-suggest';
import { Store } from '.';
import { ICON_SEARCH, ICON_PAGE } from '~/renderer/constants';
import { createLocaleTranslator } from '~/common/i18n';

const MAX_SUGGESTIONS_COUNT = 50;

// 底部筛选栏可选的来源筛选。null 表示不筛选(全部来源)。
export type SuggestionFilter = null | 'history' | 'bookmarks' | 'tabs';

export interface SuggestionsQueryContext {
  settings: any;
  searchEngine: ISearchEngine;
  bookmarks: IBookmark[];
  tabs: ISuggestionTab[];
  clipboard: string;
  filter?: SuggestionFilter;
  // 快捷字词模式:只出搜索类建议(当前词搜索、历史搜索词、引擎联想),不出网址/标签/书签。
  shortcutMode?: boolean;
}

export interface SuggestionsQueryResult {
  list: ISuggestion[];
  autocomplete: string;
}

// 点击地址栏时当前 URL 会被整段选中(selectionStart=0)。此时用光标前缀
// 会把过滤词误判为空字符串，弹窗就会展示空输入的历史搜索词，而不是当前地址
// 的相关联想。整段选中应以完整输入作为过滤词；正常输入仍只取光标前内容。
export const getSuggestionFilter = (input: HTMLInputElement): string => {
  const value = input.value || '';
  const start = input.selectionStart ?? value.length;
  const end = input.selectionEnd ?? start;

  if (value !== '' && start === 0 && end === value.length) return value;
  return value.substring(0, start);
};

export class SuggestionsStore {
  private store: Store;

  private loadRequestId = 0;

  // 上一次主进程历史检索结果,IPC 返回前按新输入同步重筛出临时列表。
  private lastHistory: HistorySuggestResult = EMPTY_HISTORY_RESULT;

  // Observable
  public list: ISuggestion[] = [];

  public selected = 0;

  public height = 0;

  public filter: SuggestionFilter = null;

  // Computed
  public get selectedSuggestion() {
    return this.list.find((x) => x.id === this.selected);
  }

  // 剪贴板仅在空输入时作为默认操作；用户输入后，回车应执行当前输入的主项。
  public selectDefault(input: HTMLInputElement) {
    this.selected = this.getDefaultSelectedId(this.list, input.value);
  }

  public getDefaultSelectedId(list: ISuggestion[], input: string) {
    const defaultSuggestion =
      input.length > 0
        ? list.find((suggestion) => suggestion.type !== 'clipboard')
        : list[0];

    return defaultSuggestion?.id ?? 0;
  }

  constructor(store: Store) {
    makeObservable(this, {
      list: observable,
      selected: observable,
      height: observable,
      filter: observable,
      selectedSuggestion: computed,
    });

    this.store = store;
  }

  public getContext(
    overrides: Partial<SuggestionsQueryContext> = {},
  ): SuggestionsQueryContext {
    return {
      settings: this.store.settings,
      searchEngine: this.store.searchEngine,
      bookmarks: this.store.bookmarks,
      tabs: this.store.tabs,
      clipboard: this.store.clipboard,
      filter: this.filter,
      shortcutMode: !!this.store.shortcutEngine,
      ...overrides,
    };
  }

  // 设置中的来源开关(总开关 suggestions 关闭时全部视为关闭)。
  private enabled(context: SuggestionsQueryContext, key: string): boolean {
    return !!context.settings.suggestions && !!context.settings[key];
  }

  // 剪贴板置顶建议项:弹窗弹出时主进程读一次剪贴板内容下发。
  // 是网址→「前往」直达;否则→用默认引擎「搜索」。返回 null 表示不展示。
  private getClipboardItem(
    filter: string,
    context: SuggestionsQueryContext,
  ): ISuggestion | null {
    const rawClipboard = context.clipboard || '';
    const cb = rawClipboard.replace(/\s+/g, ' ').trim();
    if (!cb) return null;
    if (cb === filter.trim()) return null;

    let isJsonClipboard = false;
    try {
      const parsed = JSON.parse(rawClipboard.trim());
      isJsonClipboard = parsed !== null && typeof parsed === 'object';
    } catch {
      // 非 JSON 剪贴板内容继续按普通搜索词处理。
    }

    // JSON 优先于多链接识别:对象中的 URL 字段也应保留 bejson 入口。
    if (isJsonClipboard) {
      return {
        primaryText: cb,
        isSearch: true,
        isJsonClipboard: true,
        rawClipboard,
        favicon: ICON_SEARCH,
        type: 'clipboard',
      };
    }

    // 多链接由弹窗的 MultiLink 单独渲染，不进入可桥接的建议列表。
    if (extractLinks(cb)) return null;

    const looksUrl = isURL(cb) || cb.indexOf('://') !== -1;
    if (looksUrl) {
      return {
        url: normalizeUrlInput(cb),
        favicon: ICON_PAGE,
        type: 'clipboard',
      };
    }
    return {
      primaryText: cb,
      isSearch: true,
      isJsonClipboard,
      rawClipboard,
      favicon: ICON_SEARCH,
      type: 'clipboard',
    };
  }

  // 权重:标签页 > 历史搜索词 > 书签 > 历史 > 联想词。
  private build(
    filter: string,
    head: ISuggestion[],
    context: SuggestionsQueryContext,
    historyResult: HistorySuggestResult,
    engineSuggestions: ISuggestion[],
  ): ISuggestion[] {
    const selectedFilter = context.filter ?? null;

    if (context.shortcutMode) {
      const searchTerms = this.enabled(context, 'suggestSearchHistory')
        ? historyResult.searchTerms
        : [];
      const engine = this.enabled(context, 'suggestEngine')
        ? engineSuggestions
        : [];
      return head
        .concat(searchTerms, engine)
        .slice(0, MAX_SUGGESTIONS_COUNT)
        .map((item, id) => ({ ...item, id }));
    }

    const tabs =
      this.enabled(context, 'suggestTabs') &&
      (selectedFilter === null || selectedFilter === 'tabs')
        ? getTabSuggestions(filter, context.tabs)
        : [];
    const searchTerms =
      this.enabled(context, 'suggestSearchHistory') &&
      (selectedFilter === null || selectedFilter === 'history')
        ? historyResult.searchTerms
        : [];
    const bookmarks =
      this.enabled(context, 'suggestBookmarks') &&
      (selectedFilter === null || selectedFilter === 'bookmarks')
        ? getBookmarkSuggestions(filter, context.bookmarks)
        : [];
    const history =
      this.enabled(context, 'suggestHistory') &&
      (selectedFilter === null || selectedFilter === 'history')
        ? historyResult.history
        : [];
    const engine =
      this.enabled(context, 'suggestEngine') && selectedFilter === null
        ? engineSuggestions
        : [];

    const headItems = selectedFilter === null ? head : [];
    const clipboardItem =
      selectedFilter === null && this.enabled(context, 'suggestClipboard')
        ? this.getClipboardItem(filter, context)
        : null;
    const clipboardItems = clipboardItem ? [clipboardItem] : [];

    const headUrls = new Set(
      headItems.filter((item) => item.url).map((item) => item.url),
    );
    const historyItems = history.filter((item) => !headUrls.has(item.url));

    return clipboardItems
      .concat(
        headItems,
        tabs,
        searchTerms,
        bookmarks,
        historyItems,
        engine,
      )
      .slice(0, MAX_SUGGESTIONS_COUNT)
      .map((item, id) => ({ ...item, id }));
  }

  public createSnapshot(
    filter: string,
    context: SuggestionsQueryContext,
    historyResult: HistorySuggestResult = EMPTY_HISTORY_RESULT,
    engineSuggestions: ISuggestion[] = [],
    inputValue = filter,
  ): SuggestionsQueryResult {
    const trimmed = filter.trim();
    const fullInput = inputValue.trim();
    const head: ISuggestion[] = [];
    const history = this.enabled(context, 'suggestHistory')
      ? historyResult.history
      : [];
    const canSuggestFirst =
      !context.shortcutMode &&
      fullInput === trimmed &&
      history[0] &&
      history[0].canSuggest;

    if (canSuggestFirst) {
      head.push({ ...history[0], type: 'url' });
    } else if (
      !context.shortcutMode &&
      fullInput !== '' &&
      (isURL(fullInput) || fullInput.indexOf('://') !== -1)
    ) {
      head.push({
        url: normalizeUrlInput(fullInput),
        favicon: ICON_PAGE,
        type: 'url',
      });
    }

    // 编辑 URL 中间位置时，filter 只是光标前缀(例如 "http")；此时展示并
    // 默认选中该前缀的搜索项会误导回车行为。完整输入已经可直接导航时，仅
    // 保留完整 URL 的前往项和匹配记录。
    const editingUrl =
      !context.shortcutMode &&
      fullInput !== '' &&
      fullInput !== trimmed &&
      (isURL(fullInput) || fullInput.indexOf('://') !== -1);

    if (!editingUrl) {
      head.push({
        primaryText: filter,
        secondaryText: createLocaleTranslator(
          context.settings.language,
        )('svEngineSearchSuffix', { name: context.searchEngine.name }),
        favicon: ICON_SEARCH,
        isSearch: true,
        type: 'search',
      });
    }

    return {
      list:
        filter === ''
          ? this.build(filter, [], context, historyResult, engineSuggestions)
          : this.build(
              filter,
              head,
              context,
              historyResult,
              engineSuggestions,
            ),
      autocomplete: canSuggestFirst
        ? history[0].displayUrl || history[0].url || ''
        : '',
    };
  }

  // 历史网址与历史搜索词由主进程在全量历史上检索并去重。
  // 网址项不受来源筛选限制:行内补全首项在任何筛选下都可用,与原实现一致。
  private fetchHistory(
    filter: string,
    context: SuggestionsQueryContext,
  ): Promise<HistorySuggestResult> {
    const selectedFilter = context.filter ?? null;
    const terms = this.enabled(context, 'suggestSearchHistory');
    return fetchHistorySuggestions({
      filter,
      urls: !context.shortcutMode && this.enabled(context, 'suggestHistory'),
      terms:
        terms &&
        (context.shortcutMode ||
          selectedFilter === null ||
          selectedFilter === 'history'),
      // 开启历史搜索词时,搜索结果页已由搜索词项代表,不再占用网址项名额。
      excludeSearchPages: terms,
      limit: 6,
    });
  }

  // 删除历史建议后同步剔除缓存,避免临时列表把刚删除的项再显示出来。
  public forgetHistorySuggestion(suggestion: ISuggestion) {
    const query = (suggestion.primaryText || '').trim().toLowerCase();
    this.lastHistory = {
      history: this.lastHistory.history.filter(
        (item) =>
          suggestion.type !== 'history' ||
          (item.url !== suggestion.url &&
            item.displayUrl !== suggestion.displayUrl),
      ),
      searchTerms: this.lastHistory.searchTerms.filter(
        (item) =>
          suggestion.type !== 'searchTerm' ||
          (item.primaryText || '').trim().toLowerCase() !== query,
      ),
    };
  }

  public async query(
    filter: string,
    context: SuggestionsQueryContext,
    onRevision: (
      revision: number,
      result: SuggestionsQueryResult,
      historyResult: HistorySuggestResult,
    ) => void,
    inputValue = filter,
  ) {
    const wantEngine =
      filter.trim() !== '' &&
      this.enabled(context, 'suggestEngine') &&
      ((context.filter ?? null) === null || context.shortcutMode);
    // 联想词与历史检索并行发起,联想词网络请求不必排在历史 IPC 之后。
    const engineRequest = wantEngine
      ? getSearchSuggestions(filter, context.searchEngine)
      : null;
    // 等待历史检索期间联想词先失败时,不能变成 unhandled rejection。
    engineRequest?.catch(() => undefined);

    const historyResult = await this.fetchHistory(filter, context);
    onRevision(
      0,
      this.createSnapshot(filter, context, historyResult, [], inputValue),
      historyResult,
    );

    if (!engineRequest) return;

    try {
      const data = await engineRequest;
      const engineSuggestions = data.map((item) => ({
        primaryText: item,
        isSearch: true,
        type: 'suggestion' as const,
      }));
      onRevision(
        1,
        this.createSnapshot(
          filter,
          context,
          historyResult,
          engineSuggestions,
          inputValue,
        ),
        historyResult,
      );
    } catch (error) {
      console.error(error);
    }
  }

  // 先同步给出临时列表(上次历史结果按新输入重筛),保证回车/方向键始终对应当前输入;
  // 主进程全量检索返回后替换列表,并返回行内补全候选。
  // 结果按 requestId 与输入框当前内容校验,过期请求不会覆盖新输入的列表。
  public load(input: HTMLInputElement): Promise<string> {
    const filter = getSuggestionFilter(input);
    const inputValue = input.value;
    const requestId = ++this.loadRequestId;
    const context = this.getContext();
    const isCurrent = () =>
      requestId === this.loadRequestId &&
      getSuggestionFilter(input) === filter &&
      input.value === inputValue;

    this.list = this.createSnapshot(
      filter,
      context,
      refilterHistoryResult(this.lastHistory, filter),
      [],
      inputValue,
    ).list;
    this.selectDefault(input);
    const provisionalSelected = this.selected;

    // 等待期间用户移动过选中项(如鼠标悬停)时尽量保留,否则重置为新列表的默认项。
    const applyList = (list: ISuggestion[], keepSelection: boolean) => {
      const selected = this.selected;
      this.list = list;
      if (!keepSelection || !list.some((item) => item.id === selected)) {
        this.selectDefault(input);
      }
    };

    return new Promise<string>((resolve) => {
      void this.query(
        filter,
        context,
        (revision, result, historyResult) => {
          const current = isCurrent();
          if (revision === 0) {
            if (current) {
              this.lastHistory = historyResult;
              applyList(result.list, this.selected !== provisionalSelected);
            }
            resolve(current ? result.autocomplete : '');
            return;
          }
          // 联想词追加在末尾,保留用户已选中的项。
          if (current) applyList(result.list, true);
        },
        inputValue,
      ).catch((error) => {
        console.error(error);
        resolve('');
      });
    });
  }
}
