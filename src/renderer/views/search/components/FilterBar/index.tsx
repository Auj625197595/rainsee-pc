import { observer } from 'mobx-react-lite';
import * as React from 'react';

import {
  StyledFilterBar,
  Label,
  Chip,
  Spacer,
  SettingsButton,
} from './style';
import store from '../../store';
import { SuggestionFilter } from '../../store/suggestions';
import { ICON_SETTINGS } from '~/renderer/constants';
import { callViewMethod } from '~/utils/view';
import { getWebUIURL } from '~/common/webui';

const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
};

// 切换筛选并立即重算建议(再次点击同一项取消筛选)。
const onFilterClick = (filter: SuggestionFilter) => (
  e: React.MouseEvent<HTMLDivElement>,
) => {
  e.stopPropagation();
  const { suggestions } = store;
  suggestions.filter = suggestions.filter === filter ? null : filter;
  suggestions.selected = 0;

  if (store.inputRef.current) {
    suggestions.load(store.inputRef.current);
  }
};

// 打开搜索设置页。
const onSettingsClick = (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
  callViewMethod(
    store.tabId,
    'loadURL',
    `${getWebUIURL('settings')}?section=address-bar`,
  );
  store.hide();
};

const CHIPS: { label: string; filter: SuggestionFilter }[] = [
  { label: '历史记录', filter: 'history' },
  { label: '收藏夹', filter: 'bookmarks' },
  { label: '标签页', filter: 'tabs' },
];

interface Props {
  visible: boolean;
}

export const FilterBar = observer(({ visible }: Props) => {
  if (!visible) return null;

  const active = store.suggestions.filter;

  return (
    <StyledFilterBar onMouseDown={onMouseDown}>
      <Label>筛选搜索</Label>
      {CHIPS.map((c) => (
        <Chip
          key={c.filter}
          active={active === c.filter}
          onClick={onFilterClick(c.filter)}
        >
          {c.label}
        </Chip>
      ))}
      <Spacer />
      <SettingsButton
        title="搜索设置"
        style={{ backgroundImage: `url(${ICON_SETTINGS})` }}
        onClick={onSettingsClick}
      />
    </StyledFilterBar>
  );
});
