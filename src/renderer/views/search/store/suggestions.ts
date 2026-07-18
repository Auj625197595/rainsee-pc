import { observable, computed, makeObservable } from 'mobx';

import {
  getHistorySuggestions,
  getSearchHistorySuggestions,
  getBookmarkSuggestions,
  getTabSuggestions,
  getSearchSuggestions,
} from '../utils/suggestions';
import { extractLinks } from '../utils/multi-link';
import { isURL } from '~/utils';
import { ISuggestion } from '~/interfaces';
import { Store } from '.';
import { ICON_SEARCH, ICON_PAGE } from '~/renderer/constants';

let searchSuggestions: ISuggestion[] = [];

const MAX_SUGGESTIONS_COUNT = 10;

// 底部筛选栏可选的来源筛选。null 表示不筛选(全部来源)。
export type SuggestionFilter = null | 'history' | 'bookmarks' | 'tabs';

export class SuggestionsStore {
  private store: Store;

  // Observable
  public list: ISuggestion[] = [];

  public selected = 0;

  public height = 0;

  public filter: SuggestionFilter = null;

  // Computed
  public get selectedSuggestion() {
    return this.list.find((x) => x.id === this.selected);
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

  // 设置中的来源开关(总开关 suggestions 关闭时全部视为关闭)。
  private enabled(key: string): boolean {
    const s = this.store.settings as any;
    return !!s.suggestions && !!s[key];
  }

  // 剪贴板置顶建议项:弹窗弹出时主进程读一次剪贴板内容下发。
  // 是网址→「前往」直达;否则→用默认引擎「搜索」。返回 null 表示不展示。
  private getClipboardItem(filter: string): ISuggestion | null {
    const cb = (this.store.clipboard || '').replace(/\s+/g, ' ').trim();
    if (!cb) return null;
    // 与当前输入完全相同则不重复(顶部已有同名直达/搜索主项)。
    if (cb === filter.trim()) return null;

    // 多链接命中(文本里夹杂 ≥1 个 URL 且非纯单链接)时,剪贴板建议项让位,
    // 由 <MultiLink> 组件单独渲染,避免剪贴板内容在 UI 上出现两次。
    if (extractLinks(cb)) return null;

    const looksUrl = isURL(cb) || cb.indexOf('://') !== -1;
    if (looksUrl) {
      return { url: cb, favicon: ICON_PAGE, type: 'clipboard' };
    }
    return {
      primaryText: cb,
      isSearch: true,
      favicon: ICON_SEARCH,
      type: 'clipboard',
    };
  }

  // 按权重组装建议列表。head 为顶部「搜索 / 直达网址」主项。
  // 权重:标签页 > 历史搜索词 > 书签 > 历史 > 联想词。
  private build(filter: string, head: ISuggestion[]): ISuggestion[] {
    const f = this.filter;

    const tabs =
      this.enabled('suggestTabs') && (f === null || f === 'tabs')
        ? getTabSuggestions(filter)
        : [];
    const searchTerms =
      this.enabled('suggestSearchHistory') && (f === null || f === 'history')
        ? getSearchHistorySuggestions(filter)
        : [];
    const bookmarks =
      this.enabled('suggestBookmarks') && (f === null || f === 'bookmarks')
        ? getBookmarkSuggestions(filter)
        : [];
    const history =
      this.enabled('suggestHistory') && (f === null || f === 'history')
        ? getHistorySuggestions(filter)
        : [];
    const engine =
      this.enabled('suggestEngine') && f === null ? searchSuggestions : [];

    // 筛选模式下不展示顶部搜索主项,直接展示该类目结果。
    const headItems = f === null ? head : [];

    // 剪贴板置顶建议项(仅在非筛选模式且开关开启时展示)。
    const clipboardItem =
      f === null && this.enabled('suggestClipboard')
        ? this.getClipboardItem(filter)
        : null;
    const clipboardItems = clipboardItem ? [clipboardItem] : [];

    // 顶部直达主项若取自历史(可补全网址),从历史类目剔除同址项,避免重复展示。
    const headUrls = new Set(
      headItems.filter((h) => h.url).map((h) => h.url),
    );
    const historyItems = history.filter((h) => !headUrls.has(h.url));

    const merged = clipboardItems
      .concat(headItems, tabs, searchTerms, bookmarks, historyItems, engine)
      .slice(0, MAX_SUGGESTIONS_COUNT);

    for (let i = 0; i < merged.length; i++) merged[i].id = i;

    return merged;
  }

  public load(input: HTMLInputElement): Promise<string> {
    return new Promise(async (resolve) => {
      const filter = input.value.substring(0, input.selectionStart);
      const trimmed = filter.trim();

      // 顶部主项:直达网址(可补全) + 用当前引擎搜索。
      const head: ISuggestion[] = [];
      const history = this.enabled('suggestHistory')
        ? getHistorySuggestions(filter)
        : [];

      const canSuggestFirst = history[0] && history[0].canSuggest;

      if (canSuggestFirst) {
        // 已访问过的网址可自动补全:以补全后的完整网址作为默认主项(置顶选中),
        // 这样回车时直接跳转,而不会被当作搜索词送往搜索引擎。
        head.push({ ...history[0], type: 'url' });
      } else if (
        trimmed !== '' &&
        (isURL(filter) || filter.indexOf('://') !== -1)
      ) {
        // 输入本身即是网址 / 域名 / IP:直达跳转。
        head.push({ url: filter, favicon: ICON_PAGE, type: 'url' });
      }

      head.push({
        primaryText: filter,
        secondaryText: `${this.store.searchEngine.name} 搜索`,
        favicon: ICON_SEARCH,
        isSearch: true,
        type: 'search',
      });

      // 输入为空时也构建列表(展示历史搜索词),仅不带顶部「搜索/直达」主项。
      this.list = input.value === '' ? this.build(filter, []) : this.build(filter, head);

      if (canSuggestFirst) {
        resolve(history[0].url);
      }

      // 异步拉取搜索引擎联想词,完成后重组(仅当输入未变化)。
      try {
        const data = await getSearchSuggestions(filter);

        if (input.value.substring(0, input.selectionStart) === filter) {
          searchSuggestions = data.map((item) => ({
            primaryText: item,
            isSearch: true,
            type: 'suggestion',
          }));

          this.list = input.value === '' ? this.build(filter, []) : this.build(filter, head);
        }
      } catch (e) {
        console.error(e);
      }
    });
  }
}
