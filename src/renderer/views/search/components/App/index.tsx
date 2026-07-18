import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';

import { StyledApp, Input, CurrentIcon, SearchBox, NewTabHint } from './style';
import store from '../../store';
import { ipcRenderer } from 'electron';
import { realurl, parseBookmarklet } from '~/utils';
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
  if (e.which === 13) {
    // Enter.
    e.preventDefault();

    const text = e.currentTarget.value;
    const { suggestions, searchEngine } = store;
    let url: string;

    if (suggestions.selected !== 0 && suggestions.selectedSuggestion) {
      // 用户用方向键主动选中了某条建议,尊重该选择。
      const suggestion = suggestions.selectedSuggestion;
      if (suggestion.isSearch) {
        url = searchEngine.url.replace('%s', text);
      } else if (suggestion.url) {
        // bookmarklet(javascript:):无 '://',会被下面的兜底误补 http://,直接原样用。
        url =
          parseBookmarklet(suggestion.url) !== null ||
          suggestion.url.indexOf('://') !== -1
            ? suggestion.url
            : `http://${suggestion.url}`;
      } else {
        url = normalizeInternalInputUrl(text, searchEngine.url);
      }
    } else {
      // 默认回车:按输入框当前内容判定网址 / 搜索(对齐安卓 realurl)。
      // 这样自动补全成 yjllq.com 后回车会直达网址,而非把网址当搜索词。
      url = normalizeInternalInputUrl(text, searchEngine.url);
    }

    e.currentTarget.value = url;

    // 外部协议(motrixnext://、thunder://、magnet:、mailto: 等)→ 唤起系统默认应用,不在页内加载。
    if (getExternalProtocol(url)) {
      ipcRenderer.send('open-external-url', url);
      store.hide({enter: true});
      return;
    }

    store.navigate(url);

    // 双引擎搜索:解析出的是主引擎搜索结果页时,触发副引擎侧边栏。
    const query = extractSearchQuery(searchEngine.url, url);
    if (query) ipcRenderer.send(`dual-engine-search-${store.windowId}`, query);

    store.hide({enter: true});
  }
};

const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
  const { suggestions } = store;
  const { list } = suggestions;
  const input = store.inputRef.current;

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
      input.value = suggestion.isSearch
        ? suggestion.primaryText
        : suggestion.url;
    }
  }
};

const onInput = (e: any) => {
  store.inputText = e.currentTarget.value;

  // 输入为空时不再隐藏对话框,改为展示历史搜索词。
  // TODO: if (store.settings.object.suggestions) {
  store.suggest();
  // }
};

export const App = observer(() => {
  const suggestionsVisible = store.suggestions.list.length !== 0;
  const multiLinkVisible = !!store.multiLink;

  let height = 0;

  if (suggestionsVisible) {
    for (const s of store.suggestions.list) {
      height += 38;
    }
    height += FILTER_BAR_HEIGHT;
  }

  // 多链接助手高度独立累加:不依赖 suggestionsVisible——
  // 极端情况(所有联想来源关闭、仅 suggestClipboard 开、输入为空)下 suggestions
  // 可能为空,但多链接助手仍需展示,放进上面 if 内会裁掉窗口。
  if (multiLinkVisible) {
    // 优先用测量到的真实高度;尚未测量时用预估 fallback(避免首帧窗口过小)。
    height += store.multiLinkHeight || store.multiLink?.estimatedHeight || 0;
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
        searchBoxHeight:
          store.anchorHeight !== null
            ? store.anchorHeight
            : store.settings.topBarVariant === 'compact'
            ? COMPACT_TITLEBAR_HEIGHT
            : TOOLBAR_HEIGHT - 1,
      }}
    >
      <StyledApp>
        <UIStyle />
        <SearchBox>
          {isDefaultPageIcon ? (
            <CurrentIcon
              style={{
                opacity: 0.54,
                color: store.theme['dialog.lightForeground'] ? '#fff' : '#000',
              }}
            >
              <File size={16} weight="regular" />
            </CurrentIcon>
          ) : (
            <CurrentIcon
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
          <Input
            onKeyDown={onKeyDown}
            onInput={onInput}
            ref={store.inputRef}
            onKeyPress={onKeyPress}
          ></Input>
          {store.openInNewTab && (
            <NewTabHint title="本次搜索将在新标签页中打开">
              <ArrowSquareOut size={12} weight="bold" />
              新标签页打开
            </NewTabHint>
          )}
        </SearchBox>
        <MultiLink visible={multiLinkVisible} />
        <Suggestions visible={suggestionsVisible}></Suggestions>
        <FilterBar visible={suggestionsVisible}></FilterBar>
      </StyledApp>
    </ThemeProvider>
  );
});
