import { observable, computed, makeObservable } from 'mobx';

import {
  getHistorySuggestions,
  getSearchHistorySuggestions,
  getBookmarkSuggestions,
  getTabSuggestions,
  getSearchSuggestions,
  ISuggestionTab,
} from '../utils/suggestions';
import { extractLinks } from '../utils/multi-link';
import { isURL, normalizeUrlInput } from '~/utils';
import {
  IBookmark,
  IHistoryItem,
  ISearchEngine,
  ISuggestion,
} from '~/interfaces';
import { Store } from '.';
import { ICON_SEARCH, ICON_PAGE } from '~/renderer/constants';

const MAX_SUGGESTIONS_COUNT = 50;

// 底部筛选栏可选的来源筛选。null 表示不筛选(全部来源)。
export type SuggestionFilter = null | 'history' | 'bookmarks' | 'tabs';

export interface SuggestionsQueryContext {
  settings: any;
  searchEngine: ISearchEngine;
  visitedItems: IHistoryItem[];
  bookmarks: IBookmark[];
  tabs: ISuggestionTab[];
  clipboard: string;
  filter?: SuggestionFilter;
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
      visitedItems: this.store.visitedItems,
      bookmarks: this.store.bookmarks,
      tabs: this.store.tabs,
      clipboard: this.store.clipboard,
      filter: this.filter,
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
    engineSuggestions: ISuggestion[],
  ): ISuggestion[] {
    const selectedFilter = context.filter ?? null;

    const tabs =
      this.enabled(context, 'suggestTabs') &&
      (selectedFilter === null || selectedFilter === 'tabs')
        ? getTabSuggestions(filter, context.tabs)
        : [];
    const searchTerms =
      this.enabled(context, 'suggestSearchHistory') &&
      (selectedFilter === null || selectedFilter === 'history')
        ? getSearchHistorySuggestions(
            filter,
            context.visitedItems,
            context.settings.searchEngines,
          )
        : [];
    const bookmarks =
      this.enabled(context, 'suggestBookmarks') &&
      (selectedFilter === null || selectedFilter === 'bookmarks')
        ? getBookmarkSuggestions(filter, context.bookmarks)
        : [];
    const history =
      this.enabled(context, 'suggestHistory') &&
      (selectedFilter === null || selectedFilter === 'history')
        ? getHistorySuggestions(filter, context.visitedItems)
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
    engineSuggestions: ISuggestion[] = [],
    inputValue = filter,
  ): SuggestionsQueryResult {
    const trimmed = filter.trim();
    const fullInput = inputValue.trim();
    const head: ISuggestion[] = [];
    const history = this.enabled(context, 'suggestHistory')
      ? getHistorySuggestions(filter, context.visitedItems)
      : [];
    const canSuggestFirst =
      fullInput === trimmed && history[0] && history[0].canSuggest;

    if (canSuggestFirst) {
      head.push({ ...history[0], type: 'url' });
    } else if (
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
      fullInput !== '' &&
      fullInput !== trimmed &&
      (isURL(fullInput) || fullInput.indexOf('://') !== -1);

    if (!editingUrl) {
      head.push({
        primaryText: filter,
        secondaryText: `${context.searchEngine.name} 搜索`,
        favicon: ICON_SEARCH,
        isSearch: true,
        type: 'search',
      });
    }

    return {
      list:
        filter === ''
          ? this.build(filter, [], context, engineSuggestions)
          : this.build(filter, head, context, engineSuggestions),
      autocomplete: canSuggestFirst
        ? history[0].displayUrl || history[0].url || ''
        : '',
    };
  }

  public async query(
    filter: string,
    context: SuggestionsQueryContext,
    onRevision: (revision: number, result: SuggestionsQueryResult) => void,
    inputValue = filter,
  ) {
    onRevision(0, this.createSnapshot(filter, context, [], inputValue));

    if (
      filter.trim() === '' ||
      !this.enabled(context, 'suggestEngine') ||
      (context.filter ?? null) !== null
    ) {
      return;
    }

    try {
      const data = await getSearchSuggestions(filter, context.searchEngine);
      const engineSuggestions = data.map((item) => ({
        primaryText: item,
        isSearch: true,
        type: 'suggestion' as const,
      }));
      onRevision(
        1,
        this.createSnapshot(filter, context, engineSuggestions, inputValue),
      );
    } catch (error) {
      console.error(error);
    }
  }

  public load(input: HTMLInputElement): Promise<string> {
    const filter = getSuggestionFilter(input);
    const inputValue = input.value;
    const requestId = ++this.loadRequestId;
    const context = this.getContext();
    const initial = this.createSnapshot(filter, context, [], inputValue);

    this.list = initial.list;
    void this.query(filter, context, (revision, result) => {
      if (revision === 0) return;
      if (
        requestId === this.loadRequestId &&
        getSuggestionFilter(input) === filter &&
        input.value === inputValue
      ) {
        this.list = result.list;
      }
    }, inputValue);

    return Promise.resolve(initial.autocomplete);
  }
}
