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
import { useI18n } from '~/renderer/components/I18n';

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

const CHIPS: { labelKey: 'pvItemHistory' | 'shellFavorites' | 'svTabs'; filter: SuggestionFilter }[] = [
  { labelKey: 'pvItemHistory', filter: 'history' },
  { labelKey: 'shellFavorites', filter: 'bookmarks' },
  { labelKey: 'svTabs', filter: 'tabs' },
];

interface Props {
  visible: boolean;
}

export const FilterBar = observer(({ visible }: Props) => {
  if (!visible) return null;

  const t = useI18n();
  const active = store.suggestions.filter;

  return (
    <StyledFilterBar onMouseDown={onMouseDown}>
      <Label>{t('svFilterLabel')}</Label>
      {CHIPS.map((c) => (
        <Chip
          key={c.filter}
          active={active === c.filter}
          onClick={onFilterClick(c.filter)}
        >
          {t(c.labelKey)}
        </Chip>
      ))}
      <Spacer />
      <SettingsButton
        title={t('searchSettings')}
        style={{ backgroundImage: `url(${ICON_SETTINGS})` }}
        onClick={onSettingsClick}
      />
    </StyledFilterBar>
  );
});
