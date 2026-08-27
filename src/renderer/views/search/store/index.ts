import * as React from 'react';

import { ipcRenderer } from 'electron';
import { observable, computed, makeObservable } from 'mobx';
import {
  IBookmark,
  IHistoryItem,
  ISearchEngine,
  ISuggestion,
  IVisitedItem,
} from '~/interfaces';
import {
  SuggestionsQueryContext,
  SuggestionsStore,
  getSuggestionFilter,
} from './suggestions';
import { extractLinks, MultiLinkResult } from '../utils/multi-link';
import { DialogStore } from '~/models/dialog-store';
import { callViewMethod } from '~/utils/view';
import { getExternalProtocol, parseBookmarklet } from '~/utils/url';
import { findSearchQuery } from '~/utils/search-engine';

let lastSuggestion: string;

interface ISearchTab {
  id?: number;
  title?: string;
  url?: string;
  favicon?: string;
}

export type SearchSuggestionCommand =
  | { kind: 'select-tab'; tabId: number }
  | { kind: 'navigate'; url: string; query?: string };

interface BridgeSnapshot {
  createdAt: number;
  text: string;
  context: SuggestionsQueryContext;
  items: ISuggestion[];
}

export class Store extends DialogStore {
  public suggestions = new SuggestionsStore(this);

  @observable
  public visitedItems: IHistoryItem[] = [];

  @observable
  public bookmarks: IBookmark[] = [];

  @observable
  public tabs: ISearchTab[] = [];

  @observable
  public inputText = '';

  @observable
  public compositionAutocompleteSuffix = '';

  // 主进程弹窗弹出时读取的剪贴板纯文本,供置顶「前往/搜索」建议项使用。
  @observable
  public clipboard = '';

  // MultiLink 组件测量的实际渲染高度(px)。0 = 尚未测量,窗口高度计算用预估 fallback。
  @observable
  public multiLinkHeight = 0;

  // 由「新标签页搜索」气泡唤起时为 true:搜索结果在新标签页打开而非当前页。
  @observable
  public openInNewTab = false;

  @observable
  public anchorHeight: number | null = null;

  @observable
  public origin: 'addressbar' | 'newtab' = 'addressbar';

  @observable
  public immersive = false;

  @observable
  public searchEngineOverride: ISearchEngine | null = null;

  @observable
  public searchEnginePickerVisible = false;

  @computed
  public get effectiveSearchEngine() {
    return (
      this.searchEngineOverride ||
      this.settings.searchEngines[this.settings.searchEngine]
    );
  }

  public get searchEngine() {
    return this.effectiveSearchEngine;
  }

  // 多链接助手:剪贴板是一段夹杂链接的文本时,解析出链接切片供 MultiLink 组件渲染。
  // 复用 suggestClipboard 总开关;extractLinks 对纯单链接返回 null(保留给原直达)。
  @computed
  public get multiLink(): MultiLinkResult | null {
    if (!this.clipboard) return null;
    const s = this.settings as any;
    if (!s.suggestions || !s.suggestClipboard) return null;
    return extractLinks(this.clipboard);
  }

  // MultiLink 组件测量到实际高度后回写;窗口高度计算优先用它。
  public setMultiLinkHeight(h: number) {
    this.multiLinkHeight = h;
  }

  public canSuggest = false;

  public isComposing = false;

  private inlineAutocompleteStart: number | null = null;

  private suggestRequestId = 0;

  private bridgeSnapshots = new Map<string, BridgeSnapshot>();

  public inputRef = React.createRef<HTMLInputElement>();

  public tabId = 1;

  public constructor() {
    super({
      visibilityWrapper: false,
      persistent: true,
    });

    makeObservable(this, {
      visitedItems: observable,
      bookmarks: observable,
      tabs: observable,
      inputText: observable,
      compositionAutocompleteSuffix: observable,
      clipboard: observable,
      multiLinkHeight: observable,
      openInNewTab: observable,
      anchorHeight: observable,
      origin: observable,
      immersive: observable,
      searchEngineOverride: observable,
      searchEnginePickerVisible: observable,
      effectiveSearchEngine: computed,
      multiLink: computed,
    });

    ipcRenderer.on('visible', (e, visible, data) => {
      this.visible = visible;

      if (visible) {
        this.tabs = [];
        this.tabId = data.id;
        // 是否「在新标签页打开」模式(由地址栏新标签页搜索气泡透传)。
        this.openInNewTab = !!data.openInNewTab;
        this.origin = data.origin === 'newtab' ? 'newtab' : 'addressbar';
        this.immersive = !!data.immersive;
        this.anchorHeight = Number.isFinite(Number(data.anchorHeight))
          ? Math.min(Math.max(Math.round(Number(data.anchorHeight)), 36), 64)
          : null;
        this.searchEngineOverride = this.resolveSearchEngine(
          data.engineKeyword,
          data.searchMode,
          data.searchType,
        );
        this.searchEnginePickerVisible = false;
        // 主进程下发的剪贴板内容(弹窗弹出时读一次),置顶建议项使用。
        this.clipboard = (data.clipboard || '').trim();
        this.loadHistory();
        this.loadBookmarks();

        this.canSuggest =
          !data.suppressAutocomplete &&
          this.inputText.length <= data.text.length;
        this.isComposing = false;
        this.inlineAutocompleteStart = null;
        this.compositionAutocompleteSuffix = '';
        this.suggestRequestId++;

        this.inputRef.current.value = data.text;
        this.inputText = data.text;
        this.inputRef.current.focus();

        if (data.selectAll) {
          this.inputRef.current.select();
        } else {
          this.inputRef.current.setSelectionRange(
            data.cursorPos,
            data.cursorPos,
          );
        }

        const event = new Event('input', { bubbles: true });
        this.inputRef.current.dispatchEvent(event);
      }
    });

    ipcRenderer.on('search-tabs', (e, tabs) => {
      this.tabs = tabs;
    });

    ipcRenderer.on('pc-search-bridge-query', async (_e, payload) => {
      const bridgeId = String(payload?.bridgeId || '');
      const text = typeof payload?.text === 'string' ? payload.text : '';
      if (!bridgeId) return;

      await Promise.all([this.loadHistory(), this.loadBookmarks()]);
      const context = this.suggestions.getContext({
        searchEngine:
          this.resolveSearchEngine(payload.engineKeyword) ||
          this.settings.searchEngines[this.settings.searchEngine],
        visitedItems: this.visitedItems.slice(),
        bookmarks: this.bookmarks.slice(),
        tabs: Array.isArray(payload.tabs) ? payload.tabs : [],
        clipboard:
          typeof payload.clipboard === 'string' ? payload.clipboard : '',
        filter: null,
      });

      this.pruneBridgeSnapshots();
      void this.suggestions.query(text, context, (revision, result) => {
        this.bridgeSnapshots.set(bridgeId, {
          createdAt: Date.now(),
          text,
          context,
          items: result.list,
        });
        ipcRenderer.send('pc-search-bridge-result', {
          bridgeId,
          revision,
          selectedId: this.suggestions.getDefaultSelectedId(
            result.list,
            text,
          ),
          items: result.list,
        });
      });
    });

    ipcRenderer.on('pc-search-bridge-action', (_e, payload) => {
      const bridgeId = String(payload?.bridgeId || '');
      const snapshot = this.bridgeSnapshots.get(bridgeId);
      const itemId = Number(payload?.itemId);
      const suggestion = snapshot?.items.find((item) => item.id === itemId);
      if (!snapshot || !suggestion) {
        ipcRenderer.send('pc-search-bridge-action-result', {
          bridgeId,
          ok: false,
        });
        return;
      }

      if (payload.action === 'remove') {
        const removed = this.removeHistorySuggestionFromItems(
          suggestion,
          snapshot.context.visitedItems,
        );
        ipcRenderer.send('pc-search-bridge-action-result', {
          bridgeId,
          ok: removed,
          removed,
        });
        return;
      }

      const command = this.resolveSuggestionCommand(
        suggestion,
        snapshot.text,
        snapshot.context.searchEngine,
      );
      ipcRenderer.send('pc-search-bridge-action-result', {
        bridgeId,
        ok: !!command,
        command,
      });
    });

    this.loadHistory();
    this.loadBookmarks();

    ipcRenderer.send(`can-show-${this.id}`);

    this.onHide = (data) => {
      if (this.origin !== 'newtab') {
        ipcRenderer.send(`addressbar-update-input-${this.id}`, {
          id: this.tabId,
          text: this.inputRef.current.value,
          selectionStart: this.inputRef.current.selectionStart,
          selectionEnd: this.inputRef.current.selectionEnd,
          ...data,
        });
      }

      this.tabs = [];
      this.isComposing = false;
      this.inlineAutocompleteStart = null;
      this.compositionAutocompleteSuffix = '';
      this.suggestRequestId++;
      this.inputRef.current.value = '';
      this.inputText = '';
      this.suggestions.list = [];
      this.anchorHeight = null;
      this.origin = 'addressbar';
      this.immersive = false;
      this.searchEngineOverride = null;
      this.searchEnginePickerVisible = false;
    };
  }

  public toggleSearchEnginePicker() {
    this.searchEnginePickerVisible = !this.searchEnginePickerVisible;
  }

  public async selectSearchEngine(index: number) {
    const engines = this.settings.searchEngines || [];
    if (index < 0 || index >= engines.length) return;

    await ipcRenderer.invoke(`switch-search-engine-${this.windowId}`, index);
    this.searchEnginePickerVisible = false;
    this.clearInlineAutocomplete();
    this.clearCompositionAutocomplete();
    this.suggestions.selected = 0;
    this.inputRef.current?.focus();
    this.suggest();
  }

  public resolveSearchEngine(
    keyword: unknown,
    searchMode?: unknown,
    searchType?: unknown,
  ): ISearchEngine | null {
    if (typeof keyword !== 'string' || keyword.trim() === '') return null;
    const normalizedKeyword = keyword
      .trim()
      .toLowerCase()
      .replace(/^www\./, '');

    const engine = this.settings.searchEngines.find((item) => {
      if ((item.keyword || '').toLowerCase() === normalizedKeyword) {
        return true;
      }
      try {
        const hostname = new URL((item.url || '').replace('%s', '')).hostname
          .toLowerCase()
          .replace(/^www\./, '');
        return (
          hostname === normalizedKeyword ||
          hostname.endsWith(`.${normalizedKeyword}`)
        );
      } catch {
        return false;
      }
    });
    if (!engine || normalizedKeyword !== 'metaso.cn') return engine || null;

    return this.withMetasoSearchOptions(engine, searchMode, searchType);
  }

  private withMetasoSearchOptions(
    engine: ISearchEngine,
    searchMode: unknown,
    searchType: unknown,
  ): ISearchEngine {
    const template = engine.url || '';
    if (!template.includes('%s')) return engine;

    try {
      const queryMarker = 'RAINSEE_QUERY_PLACEHOLDER';
      const url = new URL(template.replace('%s', queryMarker));

      if (searchMode === 'fast_thinking') {
        url.searchParams.set('mdl', 'fast_thinking');
      } else {
        url.searchParams.delete('mdl');
      }

      const searchTypes = new Set([
        'scholar',
        'podcast',
        'image',
        'pdf',
        'webpage',
        'video',
      ]);
      if (typeof searchType === 'string' && searchTypes.has(searchType)) {
        url.searchParams.set('et', searchType);
      } else {
        url.searchParams.delete('et');
      }

      return {
        ...engine,
        url: url.toString().replace(queryMarker, '%s'),
      };
    } catch {
      return engine;
    }
  }

  public getCanSuggest(key: number) {
    if (
      key !== 8 && // backspace
      key !== 13 && // enter
      key !== 17 && // ctrl
      key !== 18 && // alt
      key !== 16 && // shift
      key !== 9 && // tab
      key !== 20 && // capslock
      key !== 46 && // delete
      key !== 32 // space
    ) {
      return true;
    }

    return false;
  }

  private hasInlineAutocomplete(input = this.inputRef.current) {
    const start = this.inlineAutocompleteStart;

    return (
      start !== null &&
      input.selectionStart === start &&
      input.selectionEnd === input.value.length &&
      start < input.value.length
    );
  }

  public clearInlineAutocomplete() {
    this.inlineAutocompleteStart = null;
  }

  public clearCompositionAutocomplete() {
    this.compositionAutocompleteSuffix = '';
  }

  public beginComposition() {
    const input = this.inputRef.current;
    this.isComposing = true;
    this.canSuggest = false;
    this.suggestRequestId++;
    this.compositionAutocompleteSuffix = '';

    // Inline completion is selected text, but an IME owns its own selection
    // and replacement range. Remove the synthetic suffix before it starts.
    if (this.hasInlineAutocomplete(input)) {
      const value = input.value.substring(0, this.inlineAutocompleteStart);
      input.value = value;
      input.setSelectionRange(value.length, value.length);
      this.inputText = value;
    }

    this.inlineAutocompleteStart = null;
  }

  public endComposition() {
    const input = this.inputRef.current;
    const suffix = this.compositionAutocompleteSuffix;
    const committedValue = input.value;

    this.isComposing = false;
    this.canSuggest = true;
    this.inlineAutocompleteStart = null;
    this.compositionAutocompleteSuffix = '';

    // Some Windows IMEs do not emit another input event after Enter commits
    // Latin text. Promote the previewed suffix to regular inline completion,
    // but only when the committed value is still the text that was previewed.
    // A converted candidate (for example Chinese text) must not inherit it.
    if (
      suffix &&
      committedValue === this.inputText &&
      input.selectionStart === committedValue.length &&
      input.selectionEnd === committedValue.length
    ) {
      input.value = `${committedValue}${suffix}`;
      input.setSelectionRange(committedValue.length, input.value.length);
      this.inlineAutocompleteStart = committedValue.length;
      this.canSuggest = false;
    }
  }

  public deleteInlineAutocomplete(key: string) {
    const input = this.inputRef.current;
    if (
      (key !== 'Backspace' && key !== 'Delete') ||
      !this.hasInlineAutocomplete(input)
    ) {
      return false;
    }

    // The completion suffix is an active selection. Both deletion keys should
    // remove only that synthetic suffix and preserve everything the user typed.
    const value = input.value.substring(0, this.inlineAutocompleteStart);

    input.value = value;
    input.setSelectionRange(value.length, value.length);
    this.inputText = value;
    this.inlineAutocompleteStart = null;
    this.canSuggest = false;
    this.suggest();
    this.syncImmersivePreview();

    return true;
  }

  // 打开结果。搜索词存在时先按效率搜索模式分流，网址直达不受影响。
  public navigate(url: string, searchQuery?: string) {
    // bookmarklet(javascript: 脚本):改走 add-tab 咽喉——主进程 view-manager 会识别
    // javascript: URL 改为在当前网页执行(executeJavaScript),既不新开标签也不 loadURL。
    if (parseBookmarklet(url) !== null) {
      ipcRenderer.send(`add-tab-${this.windowId}`, { url, active: true });
      return;
    }
    if (
      searchQuery &&
      this.settings.efficiencySearchMode === 'multi-tab'
    ) {
      ipcRenderer.send(`search-open-multi-tabs-${this.id}`, searchQuery);
      return;
    }
    if (this.openInNewTab) {
      ipcRenderer.send(`search-open-new-tab-${this.id}`, {
        url,
        dualQuery:
          searchQuery && this.settings.efficiencySearchMode === 'dual'
            ? searchQuery
            : undefined,
      });
    } else {
      callViewMethod(this.tabId, 'loadURL', url);
      if (searchQuery && this.settings.efficiencySearchMode === 'dual') {
        ipcRenderer.send(`dual-engine-search-${this.windowId}`, {
          query: searchQuery,
          viewId: this.tabId,
        });
      }
    }
  }

  public resolveSuggestionCommand(
    suggestion: ISuggestion,
    fallbackText = '',
    engine: ISearchEngine = this.searchEngine,
  ): SearchSuggestionCommand | null {
    if (suggestion.type === 'tab' && Number.isFinite(suggestion.tabId)) {
      return { kind: 'select-tab', tabId: Number(suggestion.tabId) };
    }

    if (suggestion.isSearch) {
      const query = (suggestion.primaryText || fallbackText).trim();
      if (!query) return null;
      return {
        kind: 'navigate',
        url: engine.url.replace('%s', query),
        query,
      };
    }

    let url = suggestion.url || '';
    if (!url) return null;
    if (parseBookmarklet(url) === null && url.indexOf('://') === -1) {
      url = `http://${url}`;
    }
    return { kind: 'navigate', url };
  }

  public executeSuggestion(suggestion: ISuggestion, fallbackText = '') {
    const command = this.resolveSuggestionCommand(suggestion, fallbackText);
    if (!command) return false;

    if (command.kind === 'select-tab') {
      ipcRenderer.send('search-select-tab', command.tabId);
    } else {
      if (getExternalProtocol(command.url)) {
        ipcRenderer.send('open-external-url', command.url);
      } else {
        this.navigate(command.url, command.query);
      }
    }
    return true;
  }

  public removeHistorySuggestion(suggestion: ISuggestion) {
    if (!this.removeHistorySuggestionFromItems(suggestion, this.visitedItems)) {
      return;
    }

    const input = this.inputRef.current;
    if (this.hasInlineAutocomplete(input)) {
      const value = input.value.substring(0, this.inlineAutocompleteStart);
      input.value = value;
      input.setSelectionRange(value.length, value.length);
      this.inputText = value;
      this.inlineAutocompleteStart = null;
      this.syncImmersivePreview();
    }

    this.clearCompositionAutocomplete();
    this.suggest();
  }

  private removeHistorySuggestionFromItems(
    suggestion: ISuggestion,
    visitedItems: IHistoryItem[],
  ) {
    if (suggestion.type !== 'history' && suggestion.type !== 'searchTerm') {
      return false;
    }

    const searchQuery = (suggestion.primaryText || '').trim().toLowerCase();
    const ids = visitedItems
      .filter((item) => {
        if (!item._id || !item.url) return false;
        if (suggestion.type === 'history') {
          return item.url === suggestion.url;
        }

        const query = findSearchQuery(
          item.url,
          this.settings.searchEngines,
        );
        return !!query && query.toLowerCase() === searchQuery;
      })
      .map((item) => item._id);

    if (ids.length === 0) return false;

    const idSet = new Set(ids);
    this.visitedItems = this.visitedItems.filter(
      (item) => !item._id || !idSet.has(item._id),
    );
    ipcRenderer.send('history-remove', ids);
    return true;
  }

  private pruneBridgeSnapshots() {
    const expiresBefore = Date.now() - 15_000;
    for (const [id, snapshot] of this.bridgeSnapshots) {
      if (snapshot.createdAt < expiresBefore) this.bridgeSnapshots.delete(id);
    }
    while (this.bridgeSnapshots.size > 32) {
      const first = this.bridgeSnapshots.keys().next().value;
      if (!first) break;
      this.bridgeSnapshots.delete(first);
    }
  }

  public async loadHistory() {
    // 建议层最多展示 50 条；限制 IPC 快照，避免每次聚焦地址栏都传输全量历史。
    this.visitedItems = await ipcRenderer.invoke('topsites-get', 500);
  }

  public async loadBookmarks() {
    this.bookmarks = await ipcRenderer.invoke('bookmarks-get');
  }

  public suggest() {
    const { suggestions } = this;
    const input = this.inputRef.current;
    const requestId = ++this.suggestRequestId;
    const composing = this.isComposing;
    const canAutoComplete = this.canSuggest;
    this.canSuggest = false;
    const text = getSuggestionFilter(input);

    if (canAutoComplete) {
      if (composing) {
        this.updateCompositionAutocomplete(text, lastSuggestion);
      } else {
        this.autoComplete(text, lastSuggestion);
      }
    }

    suggestions.load(input).then((suggestion) => {
      if (
        requestId !== this.suggestRequestId ||
        this.isComposing !== composing
      ) {
        return;
      }

      lastSuggestion = suggestion;
      if (canAutoComplete) {
        if (composing) {
          this.updateCompositionAutocomplete(text, suggestion);
        } else {
          this.autoComplete(text, suggestion);
        }
      }
    });

    suggestions.selectDefault(input);
  }

  public syncImmersivePreview() {
    if (!this.immersive || !this.inputRef.current) return;
    const input = this.inputRef.current;
    ipcRenderer.send(`immersive-addressbar-preview-${this.id}`, {
      id: this.tabId,
      text: input.value,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
    });
  }

  public autoComplete(text: string, suggestion: string) {
    // 拼音分隔单引号表示用户正在明确组织输入,对齐 Edge:保留联想列表,
    // 但不再把网址后缀写进输入框。该判断同时覆盖键入、粘贴和 IME 提交。
    if (this.isComposing) return;

    const start = text.length;

    const input = this.inputRef.current;

    if (input.selectionStart !== input.value.length) return;

    const completed = this.getAutocompleteValue(text, suggestion);
    if (completed.length > start) {
      input.value = completed;
      input.setSelectionRange(start, completed.length);
      this.inlineAutocompleteStart = start;
      this.syncImmersivePreview();
    }
  }

  private updateCompositionAutocomplete(text: string, suggestion: string) {
    const input = this.inputRef.current;
    if (input.selectionStart !== input.value.length) {
      this.compositionAutocompleteSuffix = '';
      return;
    }

    const completed = this.getAutocompleteValue(text, suggestion);
    this.compositionAutocompleteSuffix = completed.substring(text.length);
  }

  private getAutocompleteValue(text: string, suggestion: string) {
    if (text === '' || text.includes("'") || !suggestion) return '';

    const urlPrefix = /(http(s?)):\/\/(www.)?|www./gi;
    const protocol = /(http(s?)):\/\//gi;
    const textWithoutUrlPrefix = text.replace(urlPrefix, '');
    const textWithoutProtocol = text.replace(protocol, '');
    const wwwSuggestion = `www.${suggestion}`;

    if (
      suggestion.toLowerCase().startsWith(textWithoutUrlPrefix.toLowerCase())
    ) {
      return text + suggestion.substring(textWithoutUrlPrefix.length);
    }

    if (
      wwwSuggestion
        .toLowerCase()
        .startsWith(textWithoutProtocol.toLowerCase())
    ) {
      return text + wwwSuggestion.substring(textWithoutProtocol.length);
    }

    return '';
  }
}

export default new Store();
