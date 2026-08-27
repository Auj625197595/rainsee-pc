import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';

import {
  StyledApp,
  Input,
  InputArea,
  InlineCompletion,
  InlineCompletionPrefix,
  InlineCompletionSuffix,
  CurrentIcon,
  SearchBox,
  NewTabHint,
  SearchEnginePicker,
  SearchEngineOption,
  SearchEngineOptionIcon,
  SearchEngineOptionName,
  SearchEngineOptionCheck,
} from './style';
import store from '../../store';
import { clipboard, ipcRenderer } from 'electron';
import { realurl } from '~/utils';
import { extractSearchQuery, getExternalProtocol } from '~/utils/url';
import { getWebUIURL } from '~/common/webui';
import { Suggestions } from '../Suggestions';
import { MultiLink } from '../MultiLink';
import { FilterBar } from '../FilterBar';
import { FILTER_BAR_HEIGHT } from '../FilterBar/style';
import { ICON_SEARCH, ICON_PAGE } from '~/renderer/constants';
import { ArrowSquareOut, File } from '@phosphor-icons/react';
import { UIStyle } from '~/renderer/mixins/default-styles';
import {
  COMPACT_TITLEBAR_HEIGHT,
  DEFAULT_TITLEBAR_HEIGHT,
  TOOLBAR_HEIGHT,
} from '~/constants/design';

const SUGGESTION_ROW_HEIGHT = 38;
const MAX_VISIBLE_SUGGESTIONS = 10;

const normalizeInternalInputUrl = (value: string, searchEngineUrl: string) => {
  const trimmed = (value || '').trim();
  const match = /^(chrome:\/\/flags|yjllq:\/\/flags|ktllq:\/\/flags)([/?#].*)?$/i.exec(
    trimmed,
  );

  if (match) {
    return `${getWebUIURL('flags')}${match[2] || ''}`;
  }

  return realurl(trimmed, searchEngineUrl);
};

const onKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.nativeEvent.isComposing || store.isComposing) return;

  if (e.which === 13) {
    // Enter.
    e.preventDefault();

    const text = e.currentTarget.value;
    const { suggestions, searchEngine } = store;
    let url: string;

    const caretAtEnd =
      e.currentTarget.selectionStart === e.currentTarget.value.length &&
      e.currentTarget.selectionEnd === e.currentTarget.value.length;

    // 联想过滤词按光标前缀计算。光标位于 URL 中间编辑时，第 0 项可能只是
    // 前缀(例如删除 https 中的 s 后得到 "http"),不能覆盖用户实际输入的完整 URL。
    // 仅在光标位于末尾时执行默认联想项;中间编辑统一按完整输入解析。
    if (suggestions.selectedSuggestion && caretAtEnd) {
      const suggestion = suggestions.selectedSuggestion;
      if (store.executeSuggestion(suggestion, text)) {
        store.hide({ enter: true });
        return;
      }
    }

    // 默认回车:按输入框当前内容判定网址 / 搜索(对齐安卓 realurl)。
    // 这样自动补全成 yjllq.com 后回车会直达网址,而非把网址当搜索词。
    url = normalizeInternalInputUrl(text, searchEngine.url);

    e.currentTarget.value = url;

    // 外部协议(motrixnext://、thunder://、magnet:、mailto: 等)→ 唤起系统默认应用,不在页内加载。
    if (getExternalProtocol(url)) {
      ipcRenderer.send('open-external-url', url);
      store.hide({enter: true});
      return;
    }

    const query = extractSearchQuery(searchEngine.url, url);
    store.navigate(url, query || undefined);

    store.hide({enter: true});
  }
};

const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
  const { suggestions } = store;
  const { list } = suggestions;
  const input = store.inputRef.current;

  if (e.nativeEvent.isComposing || e.keyCode === 229 || store.isComposing) {
    store.canSuggest = false;
    return;
  }

  if (store.deleteInlineAutocomplete(e.key)) {
    e.preventDefault();
    return;
  }

  store.canSuggest = store.getCanSuggest(e.keyCode);

  if (e.key === 'Escape') {
    store.hide({ focus: true, escape: true });
  } else if (e.keyCode === 38 || e.keyCode === 40) {
    e.preventDefault();
    if (e.keyCode === 40 && suggestions.selected + 1 <= list.length - 1) {
      suggestions.selected++;
    } else if (e.keyCode === 38 && suggestions.selected - 1 >= 0) {
      suggestions.selected--;
    }

    const suggestion = list.find((x) => x.id === suggestions.selected);

    if (suggestion) {
      // 不能把缺少 URL 的建议写成字符串 "undefined"。
      input.value = suggestion.isSearch
        ? suggestion.primaryText || ''
        : suggestion.displayUrl ||
          suggestion.url ||
          suggestion.secondaryText ||
          suggestion.primaryText ||
          '';
      syncImmersivePreview();
    }
  }
};

const syncImmersivePreview = () => {
  if (!store.immersive || !store.inputRef.current) return;
  const input = store.inputRef.current;
  ipcRenderer.send(`immersive-addressbar-preview-${store.id}`, {
    id: store.tabId,
    text: input.value,
    selectionStart: input.selectionStart,
    selectionEnd: input.selectionEnd,
  });
};

const onInput = (e: any) => {
  const inputType = String(e.nativeEvent?.inputType || '');

  // 以实际输入事件为准兜底删除操作。仅依赖 keydown 会漏掉选区删除、
  // 编辑菜单删除等路径，导致沿用上一次输入的许可并再次拼接行内补全。
  if (inputType.startsWith('delete')) {
    store.canSuggest = false;
  }

  store.inputText = e.currentTarget.value;
  store.clearInlineAutocomplete();
  syncImmersivePreview();

  if (store.isComposing || e.nativeEvent.isComposing) {
    store.canSuggest = true;
    store.suggest();
    return;
  }

  store.clearCompositionAutocomplete();

  // 输入为空时不再隐藏对话框,改为展示历史搜索词。
  // TODO: if (store.settings.object.suggestions) {
  store.suggest();
  // }
};

const onSearchEngineIconClick = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.preventDefault();
  store.toggleSearchEnginePicker();
};

const pasteAndSearch = () => {
  const input = store.inputRef.current;
  const text = clipboard.readText();

  if (!input || !text.trim()) return;

  input.value = text;
  input.setSelectionRange(text.length, text.length);
  store.inputText = text;
  store.clearInlineAutocomplete();
  store.clearCompositionAutocomplete();

  // 复用回车的默认地址/搜索判定，但不采用粘贴前遗留的联想项。
  const url = normalizeInternalInputUrl(text, store.searchEngine.url);
  if (getExternalProtocol(url)) {
    ipcRenderer.send('open-external-url', url);
    store.hide({ enter: true });
    return;
  }

  const query = extractSearchQuery(store.searchEngine.url, url);
  store.navigate(url, query || undefined);
  store.hide({ enter: true });
};

export const App = observer(() => {
  const suggestionsVisible = store.suggestions.list.length !== 0;
  const multiLinkVisible = !!store.multiLink;
  const searchEnginePickerVisible = store.searchEnginePickerVisible;
  const searchEngines = store.settings.searchEngines || [];
  const searchEnginePickerHeight = Math.min(224, searchEngines.length * 36);

  React.useEffect(() => {
    ipcRenderer.on('search-paste-and-search', pasteAndSearch);

    return () => {
      ipcRenderer.removeListener('search-paste-and-search', pasteAndSearch);
    };
  }, []);

  let height = 0;

  if (suggestionsVisible) {
    height +=
      Math.min(store.suggestions.list.length, MAX_VISIBLE_SUGGESTIONS) *
      SUGGESTION_ROW_HEIGHT;
    height += FILTER_BAR_HEIGHT;
  }

  // 多链接助手高度独立累加:不依赖 suggestionsVisible——
  // 极端情况(所有联想来源关闭、仅 suggestClipboard 开、输入为空)下 suggestions
  // 可能为空,但多链接助手仍需展示,放进上面 if 内会裁掉窗口。
  if (multiLinkVisible) {
    // 优先用测量到的真实高度;尚未测量时用预估 fallback(避免首帧窗口过小)。
    height += store.multiLinkHeight || store.multiLink?.estimatedHeight || 0;
  }

  if (searchEnginePickerVisible) {
    height += searchEnginePickerHeight + 4;
  }

  requestAnimationFrame(() => {
    ipcRenderer.send(`height-${store.id}`, height);
  });

  const suggestion = store.suggestions.selectedSuggestion;
  let favicon = store.searchEngineOverride?.icon || ICON_SEARCH;
  let customIcon = !store.searchEngineOverride?.icon;

  if (suggestion && suggestionsVisible) {
    favicon = suggestion.favicon;
    customIcon = false;

    if (suggestion.isSearch) {
      favicon = store.searchEngine.icon;
    } else if (
      favicon == null ||
      favicon.trim() === '' ||
      favicon === ICON_PAGE
    ) {
      favicon = ICON_PAGE;
      customIcon = true;
    }
  }

  // 默认页面图标(无站点 favicon)用 phosphor FileText 替代 ICON_PAGE。
  const isDefaultPageIcon = customIcon && favicon === ICON_PAGE;

  return (
    <ThemeProvider
      theme={{
        ...store.theme,
        dark: store.theme['searchBox.lightForeground'],
        searchBoxHeight:
          store.anchorHeight !== null
            ? store.anchorHeight
            : store.settings.topBarVariant === 'compact'
            ? COMPACT_TITLEBAR_HEIGHT
            : TOOLBAR_HEIGHT - 1,
      }}
    >
      <StyledApp $immersive={store.immersive}>
        <UIStyle />
        <SearchBox $immersive={store.immersive}>
          {isDefaultPageIcon ? (
            <CurrentIcon
              type="button"
              title="选择搜索引擎"
              aria-label="选择搜索引擎"
              aria-expanded={searchEnginePickerVisible}
              onClick={onSearchEngineIconClick}
              style={{
                opacity: 0.54,
                color: store.theme['dialog.lightForeground'] ? '#fff' : '#000',
              }}
            >
              <File size={16} weight="regular" />
            </CurrentIcon>
          ) : (
            <CurrentIcon
              type="button"
              title="选择搜索引擎"
              aria-label="选择搜索引擎"
              aria-expanded={searchEnginePickerVisible}
              onClick={onSearchEngineIconClick}
              style={{
                backgroundImage: `url(${favicon})`,
                filter:
                  customIcon && store.theme['dialog.lightForeground']
                    ? 'invert(100%)'
                    : 'none',
                opacity: customIcon ? 0.54 : 1,
              }}
            ></CurrentIcon>
          )}
          <InputArea>
            <Input
              onKeyDown={onKeyDown}
              onInput={onInput}
              onCompositionStart={() => store.beginComposition()}
              onCompositionEnd={() => {
                store.endComposition();
                syncImmersivePreview();
              }}
              ref={store.inputRef}
              onKeyPress={onKeyPress}
              autoComplete="off"
              spellCheck={false}
            ></Input>
            {store.compositionAutocompleteSuffix && (
              <InlineCompletion aria-hidden="true">
                <InlineCompletionPrefix>
                  {store.inputText}
                </InlineCompletionPrefix>
                <InlineCompletionSuffix>
                  {store.compositionAutocompleteSuffix}
                </InlineCompletionSuffix>
              </InlineCompletion>
            )}
          </InputArea>
          {store.openInNewTab && (
            <NewTabHint title="本次搜索将在新标签页中打开">
              <ArrowSquareOut size={12} weight="bold" />
              新标签页打开
            </NewTabHint>
          )}
        </SearchBox>
        {searchEnginePickerVisible && (
          <SearchEnginePicker
            $height={searchEnginePickerHeight}
            role="listbox"
            aria-label="搜索引擎"
          >
            {searchEngines.map((engine, index) => (
              <SearchEngineOption
                key={engine.keyword || index}
                type="button"
                $selected={index === store.settings.searchEngine}
                aria-selected={index === store.settings.searchEngine}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => store.selectSearchEngine(index)}
              >
                <SearchEngineOptionIcon
                  style={{
                    backgroundImage: `url(${engine.icon || ICON_SEARCH})`,
                  }}
                />
                <SearchEngineOptionName>{engine.name}</SearchEngineOptionName>
                {index === store.settings.searchEngine && (
                  <SearchEngineOptionCheck>✓</SearchEngineOptionCheck>
                )}
              </SearchEngineOption>
            ))}
          </SearchEnginePicker>
        )}
        <MultiLink visible={multiLinkVisible} />
        <Suggestions visible={suggestionsVisible}></Suggestions>
        <FilterBar visible={suggestionsVisible}></FilterBar>
      </StyledApp>
    </ThemeProvider>
  );
});
