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
  BejsonTag,
  RemoveButton,
} from './style';
import { ISuggestion } from '~/interfaces';
import store from '../../store';
import { callViewMethod } from '~/utils/view';
import { getWebUIURL } from '~/common/webui';
import { Clipboard, X } from '@phosphor-icons/react';
import { ipcRenderer } from 'electron';

interface Props {
  suggestion: ISuggestion;
}

const onMouseEnter = (suggestion: ISuggestion) => () => {
  suggestion.hovered = true;
  // 鼠标悬停项与键盘当前项保持一致,回车时执行用户指向的结果。
  store.suggestions.selected = suggestion.id;
};

const onMouseLeave = (suggestion: ISuggestion) => () => {
  suggestion.hovered = false;
};

// 跳转到已打开的标签页(可能在其他窗口),交给主进程定位选中。
const onJumpClick = (suggestion: ISuggestion) => (
  e: React.MouseEvent<HTMLDivElement>,
) => {
  e.stopPropagation();
  store.executeSuggestion(suggestion);
  store.hide();
};

// 剪贴板项右侧「剪贴板」标识:点击跳转搜索设置页(可关闭该联想来源)。
const onClipboardTagClick = (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
  callViewMethod(
    store.tabId,
    'loadURL',
    `${getWebUIURL('settings')}?section=address-bar`,
  );
  store.hide();
};

const onRemoveClick = (suggestion: ISuggestion) => (
  e: React.MouseEvent<HTMLButtonElement>,
) => {
  e.preventDefault();
  e.stopPropagation();
  store.removeHistorySuggestion(suggestion);
};

const onClick = (suggestion: ISuggestion) => () => {
  store.executeSuggestion(suggestion);
  store.hide();
};

// JSON 剪贴板内容跳转 bejson,由主进程在页面加载完成后负责填充编辑器。
const onBejsonTagClick = (suggestion: ISuggestion) => (
  e: React.MouseEvent<HTMLDivElement>,
) => {
  e.stopPropagation();
  void ipcRenderer.invoke('open-clipboard-in-bejson', {
    webContentsId: store.tabId,
    content: suggestion.rawClipboard || suggestion.primaryText || '',
  });
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
  const { primaryText, secondaryText, displayUrl, url } = suggestion;

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
          <ClipboardTag title="搜索设置" onClick={onClipboardTagClick}>
            剪贴板
          </ClipboardTag>
          <PrimaryText style={{ flex: 1, minWidth: 0 }}>
            {clipboardPrefix} {clipboardValue}
          </PrimaryText>
          {suggestion.isJsonClipboard && (
            <BejsonTag
              title="在 bejson 中格式化 JSON"
              onClick={onBejsonTagClick(suggestion)}
            >
              BeJson
            </BejsonTag>
          )}
        </>
      ) : (
        <>
          {primaryText && <PrimaryText>{primaryText}</PrimaryText>}
          {primaryText && (secondaryText || url) && <Dash>&ndash;</Dash>}
          {url ? (
            <Url>{displayUrl || url}</Url>
          ) : (
            <SecondaryText>{secondaryText}</SecondaryText>
          )}
        </>
      )}
      {suggestion.type === 'tab' && (
        <JumpButton onClick={onJumpClick(suggestion)}>跳转</JumpButton>
      )}
      {(suggestion.type === 'history' ||
        suggestion.type === 'searchTerm') && (
        <RemoveButton
          type="button"
          title={
            suggestion.type === 'searchTerm'
              ? '删除此条搜索历史'
              : '删除此条历史记录'
          }
          aria-label={
            suggestion.type === 'searchTerm'
              ? '删除此条搜索历史'
              : '删除此条历史记录'
          }
          onClick={onRemoveClick(suggestion)}
        >
          <X size={16} weight="regular" />
        </RemoveButton>
      )}
    </StyledSuggestion>
  );
});
