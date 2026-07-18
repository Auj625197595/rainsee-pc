import * as React from 'react';
import { observer } from 'mobx-react-lite';

import store, { QuickRange } from '../../store';
import { ThemeProvider } from 'styled-components';
import { SelectionDialog } from '~/renderer/components/SelectionDialog';
import { HistorySection } from '../HistorySection';
import { Container } from '~/renderer/components/Pages';
import { GlobalNavigationDrawer } from '~/renderer/components/GlobalNavigationDrawer';
import { WebUIStyle } from '~/renderer/mixins/default-styles';
import { getRangeBounds } from '../../utils';
import {
  Sidebar,
  SideTitle,
  SearchBox,
  SearchInput,
  SectionLabel,
  RangeNav,
  RangeButton,
  RangeIconBox,
  RangeLabel,
  RangeCount,
  BottomActions,
  ClearButton,
  MainScroll,
  MainInner,
  HeaderRow,
} from './style';
import { OpenInNewTabToggle } from '~/renderer/components/OpenInNewTabToggle';

// ===== 内联图标（跟随 currentColor）=====

const IconSearch = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7"></circle>
    <path d="m20 20-3.5-3.5"></path>
  </svg>
);

const IconAll = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7"></rect>
    <rect x="14" y="3" width="7" height="7"></rect>
    <rect x="3" y="14" width="7" height="7"></rect>
    <rect x="14" y="14" width="7" height="7"></rect>
  </svg>
);

const IconToday = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="5" width="16" height="15" rx="2"></rect>
    <path d="M8 3v4"></path>
    <path d="M16 3v4"></path>
    <path d="M4 10h16"></path>
  </svg>
);

const IconYesterday = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 3-6.7"></path>
    <path d="M3 4v5h5"></path>
    <path d="M12 7v5l-3 2"></path>
  </svg>
);

const IconWeek = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2"></rect>
    <path d="M9 4v16"></path>
    <path d="M15 4v16"></path>
  </svg>
);

const IconOlder = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="3" width="16" height="18" rx="2"></rect>
    <path d="M8 3v4"></path>
    <path d="M16 3v4"></path>
  </svg>
);

const IconTrash = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18"></path>
    <path d="M8 6V4h8v2"></path>
    <path d="M19 6l-1 14H6L5 6"></path>
  </svg>
);

const onScroll = (e: any) => {
  const scrollPos = e.target.scrollTop;
  const scrollMax = e.target.scrollHeight - e.target.clientHeight - 256;

  if (scrollPos >= scrollMax) {
    store.itemsLoaded += store.getDefaultLoaded();
  }
};

const countForRange = (range: QuickRange) => {
  if (range === 'all') return store.items.length;
  const bounds = getRangeBounds(range as any);
  if (!bounds) return 0;
  return store.items.filter((x) => {
    const t = new Date(x.date).getTime();
    return t > bounds.min && t < bounds.max;
  }).length;
};

const RangeItem = observer(
  ({
    range,
    children,
    icon,
  }: {
    range: QuickRange;
    children: any;
    icon: React.ReactNode;
  }) => {
    const selected = store.selectedRange === range;
    return (
      <RangeButton
        selected={selected}
        onClick={() => (store.selectedRange = range)}
      >
        <RangeIconBox selected={selected}>{icon}</RangeIconBox>
        <RangeLabel selected={selected}>{children}</RangeLabel>
        <RangeCount selected={selected}>{countForRange(range)}</RangeCount>
      </RangeButton>
    );
  },
);

const onCancelClick = (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
  store.selectedItems = [];
};

const onDeleteClick = (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
  store.deleteSelected();
};

const onInput = (e: React.FormEvent<HTMLInputElement>) => {
  store.search(e.currentTarget.value);
};

const onClearClick = () => {
  store.clear();

  // TODO: ipcRenderer.send('clear-browsing-data');
};

export default observer(() => {
  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <Container>
        <WebUIStyle />
        <GlobalNavigationDrawer></GlobalNavigationDrawer>

        <Sidebar>
          <SideTitle>历史记录</SideTitle>

          <SearchBox>
            <IconSearch />
            <SearchInput placeholder="搜索历史记录" onInput={onInput} />
          </SearchBox>

          <SectionLabel>时间范围</SectionLabel>
          <RangeNav>
            <RangeItem icon={<IconAll />} range="all">
              全部
            </RangeItem>
            <RangeItem icon={<IconToday />} range="today">
              今天
            </RangeItem>
            <RangeItem icon={<IconYesterday />} range="yesterday">
              昨天
            </RangeItem>
            <RangeItem icon={<IconWeek />} range="last-week">
              上周
            </RangeItem>
            <RangeItem icon={<IconOlder />} range="older">
              更久以前
            </RangeItem>
          </RangeNav>

          <BottomActions>
            <ClearButton onClick={onClearClick}>
              <IconTrash />
              清除浏览记录
            </ClearButton>
          </BottomActions>
        </Sidebar>

        <MainScroll onScroll={onScroll}>
          <MainInner>
            <HeaderRow>
              <OpenInNewTabToggle
                checked={store.openInNewTab}
                onChange={(v) => store.setOpenInNewTab(v)}
                title="勾选后,点标题在新标签页打开;未勾选则在当前页打开(行单击仍是选中)"
              />
            </HeaderRow>
            <SelectionDialog
              theme={store.theme}
              visible={store.selectedItems.length > 0}
              amount={store.selectedItems.length}
              onDeleteClick={onDeleteClick}
              onCancelClick={onCancelClick}
            />
            {store.sections.map((data) => (
              <HistorySection data={data} key={data.date.getTime()} />
            ))}
          </MainInner>
        </MainScroll>
      </Container>
    </ThemeProvider>
  );
});
