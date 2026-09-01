import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { Gear as GearIcon } from '@phosphor-icons/react';

import store, { DownloadFilter } from '../../store';
import { DownloadSection } from '../DownloadSection';
import { Container } from '~/renderer/components/Pages';
import { GlobalNavigationDrawer } from '~/renderer/components/GlobalNavigationDrawer';
import { WebUIStyle } from '~/renderer/mixins/default-styles';
import { getWebUIURL } from '~/common/webui';
import {
  Sidebar,
  SideHeader,
  SideTitle,
  SettingsButton,
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
  CreateTaskButton,
  TaskDialog,
  TaskDialogPanel,
  TaskDialogTitle,
  TaskInput,
  TaskDialogHint,
  TaskDialogError,
  TaskDialogActions,
  TaskDialogButton,
} from './style';
import { useI18n } from '~/renderer/components/I18n';

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

const IconPlus = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M12 5v14M5 12h14"></path>
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

const onSettingsClick = () => {
  window.location.href = `${getWebUIURL('settings')}?section=downloads`;
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
  const t = useI18n();
  const sections = store.sections;
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [pageUrl, setPageUrl] = React.useState('');
  const [fileName, setFileName] = React.useState('');
  const [taskError, setTaskError] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  const submitTask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setTaskError('');
    const result = await store.createTask(pageUrl.trim(), fileName.trim());
    setCreating(false);
    if (!result?.ok) {
      setTaskError(result?.message || t('dlvCreateFailed'));
      return;
    }
    setDialogOpen(false);
    setPageUrl('');
    setFileName('');
  };

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <Container>
        <WebUIStyle />
        <GlobalNavigationDrawer></GlobalNavigationDrawer>

        <Sidebar>
          <SideHeader>
            <SideTitle>{t('dlvTitle')}</SideTitle>
            <CreateTaskButton type="button" onClick={() => { setTaskError(''); setDialogOpen(true); }} title={t('dlvCreateTaskTitle')}>
              <IconPlus />
              {t('dlvNewTask')}
            </CreateTaskButton>
            <SettingsButton onClick={onSettingsClick} title={t('dlvSettings')}>
              <GearIcon size={16} weight="bold" />
              {t('dlvSettingsShort')}
            </SettingsButton>
          </SideHeader>

          <SearchBox>
            <IconSearch />
            <SearchInput placeholder={t('dlvSearchPlaceholder')} onInput={onInput} />
          </SearchBox>

          <SectionLabel>{t('dlvStatusSection')}</SectionLabel>
          <FilterNav>
            <FilterItem icon={<IconAll />} filter="all">
              {t('mgFilterAll')}
            </FilterItem>
            <FilterItem icon={<IconActive />} filter="active">
              {t('dlvActive')}
            </FilterItem>
            <FilterItem icon={<IconCompleted />} filter="completed">
              {t('dlvCompleted')}
            </FilterItem>
            <FilterItem icon={<IconCanceled />} filter="canceled">
              {t('dlvCanceled')}
            </FilterItem>
          </FilterNav>

          <BottomActions>
            <ClearButton onClick={onClearClick}>
              <IconTrash />
              {t('dlvClearRecords')}
            </ClearButton>
          </BottomActions>
        </Sidebar>

        <MainScroll>
          <MainInner>
            {sections.length === 0 ? (
              <EmptyState>
                <IconEmpty />
                <EmptyText>
                  {store.searched ? t('dlvNoResults') : t('dlvEmpty')}
                </EmptyText>
              </EmptyState>
            ) : (
              sections.map((data) => (
                <DownloadSection data={data} key={data.key} />
              ))
            )}
          </MainInner>
        </MainScroll>

        {dialogOpen && (
          <TaskDialog onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}>
            <TaskDialogPanel onSubmit={submitTask}>
              <TaskDialogTitle>{t('dlvCreateTaskTitle')}</TaskDialogTitle>
              <TaskInput
                autoFocus
                required
                type="url"
                placeholder={t('dlvUrlPlaceholder')}
                value={pageUrl}
                onChange={(event) => setPageUrl(event.currentTarget.value)}
              />
              <TaskDialogHint>{t('dlvTaskHint')}</TaskDialogHint>
              <TaskInput
                style={{marginTop: 12}}
                placeholder={t('dlvFilenamePlaceholder')}
                value={fileName}
                onChange={(event) => setFileName(event.currentTarget.value)}
              />
              <TaskDialogError>{taskError}</TaskDialogError>
              <TaskDialogActions>
                <TaskDialogButton type="button" onClick={() => setDialogOpen(false)}>{t('cancel')}</TaskDialogButton>
                <TaskDialogButton primary type="submit" disabled={creating}>{creating ? t('dlvCreating') : t('dlvCreateTask')}</TaskDialogButton>
              </TaskDialogActions>
            </TaskDialogPanel>
          </TaskDialog>
        )}
      </Container>
    </ThemeProvider>
  );
});
