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
import { SuggestionsStore } from './suggestions';
import { extractLinks, MultiLinkResult } from '../utils/multi-link';
import { DialogStore } from '~/models/dialog-store';
import { callViewMethod } from '~/utils/view';
import { parseBookmarklet } from '~/utils/url';

let lastSuggestion: string;

interface ISearchTab {
  id?: number;
  title?: string;
  url?: string;
  favicon?: string;
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
  public searchEngineOverride: ISearchEngine | null = null;

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
      clipboard: observable,
      multiLinkHeight: observable,
      openInNewTab: observable,
      anchorHeight: observable,
      origin: observable,
      searchEngineOverride: observable,
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
        this.anchorHeight = Number.isFinite(Number(data.anchorHeight))
          ? Math.min(Math.max(Math.round(Number(data.anchorHeight)), 36), 64)
          : null;
        this.searchEngineOverride = this.resolveSearchEngine(
          data.engineKeyword,
          data.searchMode,
          data.searchType,
        );
        // 主进程下发的剪贴板内容(弹窗弹出时读一次),置顶建议项使用。
        this.clipboard = (data.clipboard || '').trim();
        this.loadHistory();
        this.loadBookmarks();

        this.canSuggest = this.inputText.length <= data.text.length;

        this.inputRef.current.value = data.text;
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
      this.inputRef.current.value = '';
      this.suggestions.list = [];
      this.anchorHeight = null;
      this.origin = 'addressbar';
      this.searchEngineOverride = null;
    };
  }

  private resolveSearchEngine(
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

  // 打开某条结果:新标签页模式下经主进程在所属窗口新建标签,否则在当前标签加载。
  public navigate(url: string) {
    // bookmarklet(javascript: 脚本):改走 add-tab 咽喉——主进程 view-manager 会识别
    // javascript: URL 改为在当前网页执行(executeJavaScript),既不新开标签也不 loadURL。
    if (parseBookmarklet(url) !== null) {
      ipcRenderer.send(`add-tab-${this.windowId}`, { url, active: true });
      return;
    }
    if (this.openInNewTab) {
      ipcRenderer.send(`search-open-new-tab-${this.id}`, url);
    } else {
      callViewMethod(this.tabId, 'loadURL', url);
    }
  }

  public async loadHistory() {
    this.visitedItems = await ipcRenderer.invoke('topsites-get', 100);
  }

  public async loadBookmarks() {
    this.bookmarks = await ipcRenderer.invoke('bookmarks-get');
  }

  public suggest() {
    const { suggestions } = this;
    const input = this.inputRef.current;

    if (this.canSuggest) {
      this.autoComplete(input.value, lastSuggestion);
    }

    suggestions.load(input).then((suggestion) => {
      lastSuggestion = suggestion;
      if (this.canSuggest) {
        this.autoComplete(
          input.value.substring(0, input.selectionStart),
          suggestion,
        );
        this.canSuggest = false;
      }
    });

    suggestions.selected = 0;
  }

  public autoComplete(text: string, suggestion: string) {
    // 输入为空时不做补全,否则会把上一次的联想词整段填入空地址栏。
    if (text === '') return;

    const regex = /(http(s?)):\/\/(www.)?|www./gi;
    const regex2 = /(http(s?)):\/\//gi;

    const start = text.length;

    const input = this.inputRef.current;

    if (input.selectionStart !== input.value.length) return;

    if (suggestion) {
      if (suggestion.startsWith(text.replace(regex, ''))) {
        input.value = text + suggestion.replace(text.replace(regex, ''), '');
      } else if (`www.${suggestion}`.startsWith(text.replace(regex2, ''))) {
        input.value =
          text + `www.${suggestion}`.replace(text.replace(regex2, ''), '');
      }
      input.setSelectionRange(start, input.value.length);
    }
  }
}

export default new Store();
