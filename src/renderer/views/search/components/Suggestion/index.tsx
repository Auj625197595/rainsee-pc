import { observer } from 'mobx-react-lite';
import * as React from 'react';

import {
  transparency,
  ICON_PAGE,
  ICON_SEARCH,
  ICON_HISTORY,
  ICON_STAR_FILLED,
  ICON_TAB,
} from '~/renderer/constants';
import {
  StyledSuggestion,
  PrimaryText,
  Dash,
  SecondaryText,
  Icon,
  Url,
  JumpButton,
  ClipboardTag,
} from './style';
import { ISuggestion } from '~/interfaces';
import store from '../../store';
import { ipcRenderer } from 'electron';
import { callViewMethod } from '~/utils/view';
import { getWebUIURL } from '~/common/webui';
import { Clipboard } from '@phosphor-icons/react';

interface Props {
  suggestion: ISuggestion;
}

const onMouseEnter = (suggestion: ISuggestion) => () => {
  suggestion.hovered = true;
};

const onMouseLeave = (suggestion: ISuggestion) => () => {
  suggestion.hovered = false;
};

// 跳转到已打开的标签页(可能在其他窗口),交给主进程定位选中。
const onJumpClick = (suggestion: ISuggestion) => (
  e: React.MouseEvent<HTMLDivElement>,
) => {
  e.stopPropagation();
  ipcRenderer.send('search-select-tab', suggestion.tabId);
  store.hide();
};

// 剪贴板项右侧「剪贴板」标识:点击跳转地址栏设置页(可关闭该联想来源)。
const onClipboardTagClick = (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
  callViewMethod(
    store.tabId,
    'loadURL',
    `${getWebUIURL('settings')}?section=address-bar`,
  );
  store.hide();
};

const onClick = (suggestion: ISuggestion) => () => {
  if (suggestion.type === 'tab') {
    ipcRenderer.send('search-select-tab', suggestion.tabId);
    store.hide();
    return;
  }

  let url = suggestion.isSearch ? suggestion.primaryText : suggestion.url;

  if (suggestion.isSearch) {
    url = store.searchEngine.url.replace('%s', url);
    // 双引擎搜索:点击搜索类建议时,触发副引擎侧边栏。
    ipcRenderer.send(`dual-engine-search-${store.windowId}`, suggestion.primaryText);
  } else if (url.indexOf('://') === -1) {
    url = `http://${url}`;
  }

  store.navigate(url);

  store.hide();
};

// 按来源分类返回左侧分类图标。
const getCategoryIcon = (suggestion: ISuggestion): string => {
  switch (suggestion.type) {
    case 'history':
    case 'searchTerm':
      return ICON_HISTORY;
    case 'bookmark':
      return ICON_STAR_FILLED;
    case 'tab':
      return ICON_TAB;
    case 'url':
      return ICON_PAGE;
    case 'clipboard':
      return suggestion.isSearch ? ICON_SEARCH : ICON_PAGE;
    case 'search':
    case 'suggestion':
    default:
      return ICON_SEARCH;
  }
};

export const Suggestion = observer(({ suggestion }: Props) => {
  const { hovered } = suggestion;
  const { primaryText, secondaryText, url } = suggestion;

  const selected = store.suggestions.selected === suggestion.id;

  const favicon = getCategoryIcon(suggestion);

  // 剪贴板置顶项:单行渲染「前往/搜索 <内容>」。数据层 url/primaryText 保持纯值,
  // 前缀只在渲染层拼接,故 onClick/回车拿到的仍是纯剪贴板内容。
  const isClipboard = suggestion.type === 'clipboard';
  const clipboardPrefix = suggestion.isSearch ? '搜索' : '前往';
  const clipboardValue = suggestion.isSearch ? primaryText : url || '';

  return (
    <StyledSuggestion
      selected={selected}
      hovered={hovered}
      onClick={onClick(suggestion)}
      onMouseEnter={onMouseEnter(suggestion)}
      onMouseLeave={onMouseLeave(suggestion)}
    >
      {isClipboard ? (
        <Icon
          style={{
            opacity: transparency.icons.inactive,
            color: store.theme['searchBox.lightForeground'] ? '#fff' : '#000',
          }}
        >
          <Clipboard size={16} weight="regular" />
        </Icon>
      ) : (
        <Icon
          style={{
            backgroundImage: `url(${favicon})`,
            opacity: transparency.icons.inactive,
            filter: store.theme['searchBox.lightForeground']
              ? 'invert(100%)'
              : 'none',
          }}
        />
      )}
      {isClipboard ? (
        <>
          <ClipboardTag title="地址栏设置" onClick={onClipboardTagClick}>
            剪贴板
          </ClipboardTag>
          <PrimaryText style={{ flex: 1, minWidth: 0 }}>
            {clipboardPrefix} {clipboardValue}
          </PrimaryText>
        </>
      ) : (
        <>
          {primaryText && <PrimaryText>{primaryText}</PrimaryText>}
          {primaryText && (secondaryText || url) && <Dash>&ndash;</Dash>}
          {url ? <Url>{url}</Url> : <SecondaryText>{secondaryText}</SecondaryText>}
        </>
      )}
      {suggestion.type === 'tab' && (
        <JumpButton onClick={onJumpClick(suggestion)}>跳转</JumpButton>
      )}
    </StyledSuggestion>
  );
});
