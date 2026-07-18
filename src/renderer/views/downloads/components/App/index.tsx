import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';

import store, { DownloadFilter } from '../../store';
import { DownloadSection } from '../DownloadSection';
import { Container } from '~/renderer/components/Pages';
import { GlobalNavigationDrawer } from '~/renderer/components/GlobalNavigationDrawer';
import { WebUIStyle } from '~/renderer/mixins/default-styles';
import {
  Sidebar,
  SideTitle,
  SearchBox,
  SearchInput,
  SectionLabel,
  FilterNav,
  FilterButton,
  FilterIconBox,
  FilterLabel,
  FilterCount,
  BottomActions,
  ClearButton,
  MainScroll,
  MainInner,
  EmptyState,
  EmptyText,
} from './style';

// ===== 内联图标(跟随 currentColor)=====

const IconSearch = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7"></circle>
    <path d="m20 20-3.5-3.5"></path>
  </svg>
);

const IconAll = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6"></line>
    <line x1="8" y1="12" x2="21" y2="12"></line>
    <line x1="8" y1="18" x2="21" y2="18"></line>
    <line x1="3" y1="6" x2="3.01" y2="6"></line>
    <line x1="3" y1="12" x2="3.01" y2="12"></line>
    <line x1="3" y1="18" x2="3.01" y2="18"></line>
  </svg>
);

const IconActive = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12"></path>
    <path d="m7 10 5 5 5-5"></path>
    <path d="M5 21h14"></path>
  </svg>
);

const IconCompleted = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"></circle>
    <path d="m8.5 12 2.5 2.5 4.5-5"></path>
  </svg>
);

const IconCanceled = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"></circle>
    <path d="M15 9l-6 6M9 9l6 6"></path>
  </svg>
);

const IconTrash = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18"></path>
    <path d="M8 6V4h8v2"></path>
    <path d="M19 6l-1 14H6L5 6"></path>
  </svg>
);

const IconEmpty = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <path d="m7 10 5 5 5-5"></path>
    <path d="M12 15V3"></path>
  </svg>
);

const onInput = (e: React.FormEvent<HTMLInputElement>) => {
  store.search(e.currentTarget.value);
};

const onClearClick = () => {
  store.clearFinished();
};

const FilterItem = observer(
  ({
    filter,
    icon,
    children,
  }: {
    filter: DownloadFilter;
    icon: React.ReactNode;
    children: React.ReactNode;
  }) => {
    const selected = store.selectedFilter === filter;
    return (
      <FilterButton
        selected={selected}
        onClick={() => (store.selectedFilter = filter)}
      >
        <FilterIconBox selected={selected}>{icon}</FilterIconBox>
        <FilterLabel selected={selected}>{children}</FilterLabel>
        <FilterCount selected={selected}>
          {store.countForFilter(filter)}
        </FilterCount>
      </FilterButton>
    );
  },
);

export default observer(() => {
  const sections = store.sections;

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <Container>
        <WebUIStyle />
        <GlobalNavigationDrawer></GlobalNavigationDrawer>

        <Sidebar>
          <SideTitle>下载管理</SideTitle>

          <SearchBox>
            <IconSearch />
            <SearchInput placeholder="搜索下载内容" onInput={onInput} />
          </SearchBox>

          <SectionLabel>状态</SectionLabel>
          <FilterNav>
            <FilterItem icon={<IconAll />} filter="all">
              全部
            </FilterItem>
            <FilterItem icon={<IconActive />} filter="active">
              正在下载
            </FilterItem>
            <FilterItem icon={<IconCompleted />} filter="completed">
              已完成
            </FilterItem>
            <FilterItem icon={<IconCanceled />} filter="canceled">
              已取消
            </FilterItem>
          </FilterNav>

          <BottomActions>
            <ClearButton onClick={onClearClick}>
              <IconTrash />
              清除下载记录
            </ClearButton>
          </BottomActions>
        </Sidebar>

        <MainScroll>
          <MainInner>
            {sections.length === 0 ? (
              <EmptyState>
                <IconEmpty />
                <EmptyText>
                  {store.searched ? '没有找到相关下载' : '暂无下载内容'}
                </EmptyText>
              </EmptyState>
            ) : (
              sections.map((data) => (
                <DownloadSection data={data} key={data.key} />
              ))
            )}
          </MainInner>
        </MainScroll>
      </Container>
    </ThemeProvider>
  );
});
