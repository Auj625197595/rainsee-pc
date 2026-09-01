import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { BrowsersIcon } from '@phosphor-icons/react';

import store, { ExtFilter, IStoreExt } from '../../store';
import { IExtItem } from '~/interfaces';
import { Container } from '~/renderer/components/Pages';
import { GlobalNavigationDrawer } from '~/renderer/components/GlobalNavigationDrawer';
import { WebUIStyle } from '~/renderer/mixins/default-styles';
import { Switch } from '~/renderer/components/Switch';
import {
  IconSearch,
  IconAll,
  IconCheck,
  IconBan,
  IconStore,
  IconFolder,
  IconCrx,
  IconPuzzle,
  IconRefresh,
  IconPlus,
  IconEdit,
  IconTrash,
} from './icons';
import { ExtCard } from './ExtCard';
import { ExtDetail } from './ExtDetail';
import { BrowserMigrationDialog } from './BrowserMigrationDialog';
import { ModalBackdrop } from './card';
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
  DevToggleRow,
  InstallButton,
  UpdateStatus,
  MainScroll,
  MainInner,
  DragOverlay,
  DragCard,
  DragTitle,
  DragText,
  Grid,
  EmptyState,
  EmptyText,
  StoreDivider,
  StoreHeader,
  StoreTitle,
  StoreSubtitle,
  StoreGrid,
  StoreCard,
  StoreCardHead,
  StoreIcon,
  StoreName,
  StoreIntro,
  StoreInstallBtn,
  MainHeader,
  MainTitle,
  HeaderAction,
  GroupSection as GroupSectionStyle,
  GroupHeader,
  GroupTitle,
  GroupCount,
  GroupAction,
  DragItem,
  DropZone,
  GroupEditorMask,
  GroupEditorDialog,
  GroupEditorTitle,
  GroupEditorInput,
  GroupEditorActions,
  GroupEditorButton,
} from './style';
import { useI18n } from '~/renderer/components/I18n';

const getPathForFile = (file: File) => {
  const fn = (globalThis as any).rainseeWebUI?.getPathForFile;
  if (typeof fn !== 'function') return '';
  try {
    return fn(file) || '';
  } catch {
    return '';
  }
};

const extractPackagePaths = (files: FileList | null) =>
  Array.from(files || [])
    .map((file) => getPathForFile(file))
    .filter((filePath) => /\.(crx|zip)$/i.test(filePath));

const hasDraggedFiles = (e: DragEvent) =>
  !!e.dataTransfer &&
  Array.from(e.dataTransfer.items || []).some((item) => item.kind === 'file');

const onInput = (e: React.FormEvent<HTMLInputElement>) => {
  store.search(e.currentTarget.value);
};

const FilterItem = observer(
  ({
    filter,
    icon,
    children,
  }: {
    filter: ExtFilter;
    icon: React.ReactNode;
    children: React.ReactNode;
  }) => {
    const selected = store.selectedFilter === filter;
    return (
      <FilterButton selected={selected} onClick={() => store.setFilter(filter)}>
        <FilterIconBox selected={selected}>{icon}</FilterIconBox>
        <FilterLabel selected={selected}>{children}</FilterLabel>
        <FilterCount selected={selected}>
          {store.countForFilter(filter)}
        </FilterCount>
      </FilterButton>
    );
  },
);

const cleanIntro = (intro: string) =>
  (intro || '')
    .replace(/\\\//g, '/')
    .replace(/#+\s?/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim();

const StoreItemCard = observer(({ item }: { item: IStoreExt }) => {
  const t = useI18n();
  const installing = store.isInstalling(item.crxkey);
  const icon = (item.icon_image || '').replace(/\\\//g, '/');
  return (
    <StoreCard>
      <StoreCardHead>
        <StoreIcon
          style={{ backgroundImage: icon ? `url(${icon})` : 'none' }}
        />
        <StoreName title={item.name}>{item.name}</StoreName>
      </StoreCardHead>
      <StoreIntro title={cleanIntro(item.intro)}>
        {cleanIntro(item.intro)}
      </StoreIntro>
      <StoreInstallBtn
        installed={item.installed}
        disabled={item.installed || installing}
        onClick={() => store.installFromStore(item)}
      >
        {item.installed
    ? t('extInstalled')
    : installing
      ? t('extInstalling')
      : t('extInstall')}
      </StoreInstallBtn>
    </StoreCard>
  );
});

const StoreSection = observer(() => {
  const t = useI18n();
  if (store.storeLoading && store.storeList.length === 0) {
    return (
      <>
        <StoreDivider />
        <StoreHeader>
          <StoreTitle>{t('extStoreTitle')}</StoreTitle>
          <StoreSubtitle>{t('extStoreLoading')}</StoreSubtitle>
        </StoreHeader>
      </>
    );
  }

  if (store.storeList.length === 0) return null;

  return (
    <>
      <StoreDivider />
      <StoreHeader>
        <StoreTitle>{t('extStoreTitle')}</StoreTitle>
        <StoreSubtitle>{t('extStoreSubtitle')}</StoreSubtitle>
      </StoreHeader>
      <StoreGrid>
        {store.storeList.map((item) => (
          <StoreItemCard item={item} key={item.id} />
        ))}
      </StoreGrid>
    </>
  );
});

const ExtensionDropCard = ({
  item,
  groupId,
}: {
  item: IExtItem;
  groupId: string | null;
}) => {
  const onDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.id);
  };
  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const id = event.dataTransfer.getData('text/plain');
    if (id && id !== item.id) store.moveExtension(id, groupId, item.id);
  };

  return (
    <DragItem
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <ExtCard item={item} />
    </DragItem>
  );
};

const ExtensionGroup = observer(
  ({
    groupId,
    title,
    onRename,
  }: {
    groupId: string | null;
    title: string;
    onRename: (groupId: string, name: string) => void;
  }) => {
    const t = useI18n();
    const group = groupId ? store.groups.find((item) => item.id === groupId) : null;
    const items = store.itemsForGroup(groupId);
    const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const id = event.dataTransfer.getData('text/plain');
      if (id) store.moveExtension(id, groupId);
    };

    return (
      <GroupSectionStyle>
        <GroupHeader>
          <GroupTitle>{title}</GroupTitle>
          <GroupCount>{t('extGroupCount', { count: items.length })}</GroupCount>
          {group && (
            <>
              <Switch
                value={store.groupEnabled(group.id)}
                onClick={() => store.setGroupEnabled(group.id, !store.groupEnabled(group.id))}
              />
              <GroupAction
                aria-label={t('extRenameGroup')}
                title={t('extRenameGroup')}
                onClick={() => onRename(group.id, group.name)}
              >
                <IconEdit />
              </GroupAction>
              <GroupAction
                aria-label={t('extDeleteGroup')}
                title={t('extDeleteGroup')}
                onClick={() => {
                  if (window.confirm(t('extDeleteGroupConfirm', { name: group.name }))) {
                    store.removeGroup(group.id);
                  }
                }}
              >
                <IconTrash />
              </GroupAction>
            </>
          )}
        </GroupHeader>
        <div onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          {items.length > 0 ? (
            <Grid>
              {items.map((item) => (
                <ExtensionDropCard item={item} groupId={groupId} key={item.id} />
              ))}
            </Grid>
          ) : (
            <DropZone>{t('extDropToGroup')}</DropZone>
          )}
        </div>
      </GroupSectionStyle>
    );
  },
);

export default observer(() => {
  const t = useI18n();
  const list: IExtItem[] = store.list;
  const detail = store.selected;
  const [dragActive, setDragActive] = React.useState(false);
  const [groupEditor, setGroupEditor] = React.useState<{
    groupId: string | null;
    name: string;
  } | null>(null);
  const dragDepth = React.useRef(0);

  const submitGroupEditor = () => {
    if (!groupEditor || !groupEditor.name.trim()) return;
    if (groupEditor.groupId) {
      store.renameGroup(groupEditor.groupId, groupEditor.name);
    } else {
      store.createGroup(groupEditor.name);
    }
    setGroupEditor(null);
  };

  // 详情以整页视图展示，Escape 与顶部返回按钮都可回到扩展列表。
  React.useEffect(() => {
    if (!detail) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail]);

  React.useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!hasDraggedFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragActive(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!hasDraggedFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setDragActive(true);
    };

    const onDragLeave = (e: DragEvent) => {
      if (!hasDraggedFiles(e)) return;
      e.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) {
        setDragActive(false);
      }
    };

    const onDrop = (e: DragEvent) => {
      if (!hasDraggedFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepth.current = 0;
      setDragActive(false);
      const paths = extractPackagePaths(e.dataTransfer?.files || null);
      void store.installFromPaths(paths);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <Container>
        <WebUIStyle />
        <GlobalNavigationDrawer></GlobalNavigationDrawer>

        <Sidebar>
          <SideTitle>{t('extSideTitle')}</SideTitle>

          <SearchBox>
            <IconSearch />
            <SearchInput placeholder={t('extSearchPlaceholder')} onInput={onInput} />
          </SearchBox>

          <SectionLabel>{t('extStatusSection')}</SectionLabel>
          <FilterNav>
            <FilterItem icon={<IconAll />} filter="all">
              {t('mgFilterAll')}
            </FilterItem>
            <FilterItem icon={<IconCheck />} filter="enabled">
              {t('extEnabled')}
            </FilterItem>
            <FilterItem icon={<IconBan />} filter="disabled">
              {t('extDisabled')}
            </FilterItem>
          </FilterNav>

          <SectionLabel>{t('suSectionUpdates')}</SectionLabel>
          <InstallButton
            onClick={() => store.checkUpdates()}
            style={
              store.checking
                ? { opacity: 0.6, pointerEvents: 'none' }
                : undefined
            }
          >
            <IconRefresh />
            {store.checking
              ? t('extUpdateChecking')
              : t('extCheckUpdates')}
          </InstallButton>
          {store.updateStatus && (
            <UpdateStatus>{store.updateStatus}</UpdateStatus>
          )}

          <SectionLabel>{t('abmInstallSection')}</SectionLabel>
          <InstallButton onClick={() => store.openBrowserMigration()}>
            <BrowsersIcon size={17} />
            {t('extMigrateTitle')}
          </InstallButton>
          <InstallButton onClick={() => store.installFromCrx()}>
            <IconCrx />
            {t('extInstallCrxLocal')}
          </InstallButton>
          <InstallButton onClick={() => store.installFromDir()}>
            <IconFolder />
            {t('extInstallUnpacked')}
          </InstallButton>
          <InstallButton
            onClick={() =>
              store.installFromWeb(
                'https://microsoftedge.microsoft.com/addons/Microsoft-Edge-Extensions-Home?hl=zh-CN',
              )
            }
          >
            <IconStore />
            {t('extEdgeStore')}
          </InstallButton>
          <InstallButton
            onClick={() =>
              store.installFromWeb('https://chromewebstore.google.com/')
            }
          >
            <IconStore />
            {t('extChromeStore')}
          </InstallButton>
          {/* <InstallButton
            onClick={() => store.installFromWeb('https://www.crxsoso.com/')}
          >
            <IconStore />
            Crx 搜搜商店
          </InstallButton> */}

          <BottomActions>
            <DevToggleRow>
              <span>{t('extAutoUpdate')}</span>
              <Switch
                value={store.autoUpdate}
                onClick={() => store.setAutoUpdate(!store.autoUpdate)}
              />
            </DevToggleRow>
            <DevToggleRow>
              <span>{t('extDevMode')}</span>
              <Switch
                value={store.devMode}
                onClick={() => store.toggleDevMode()}
              />
            </DevToggleRow>
          </BottomActions>
        </Sidebar>

        <MainScroll>
          <MainInner>
            <MainHeader>
              <MainTitle>{t('extInstalledTitle')}</MainTitle>
              <HeaderAction
                type="button"
                onClick={() => setGroupEditor({ groupId: null, name: '' })}
              >
                <IconPlus />
                {t('extNewGroup')}
              </HeaderAction>
            </MainHeader>
            {groupEditor && (
              <GroupEditorMask onMouseDown={() => setGroupEditor(null)}>
                <GroupEditorDialog
                  onMouseDown={(event) => event.stopPropagation()}
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitGroupEditor();
                  }}
                >
                  <GroupEditorTitle>
                    {groupEditor.groupId ? t('extRenameGroup') : t('extNewGroup')}
                  </GroupEditorTitle>
                  <GroupEditorInput
                    autoFocus
                    maxLength={40}
                    value={groupEditor.name}
                    placeholder={t('extGroupNamePlaceholder')}
                    onChange={(event) =>
                      setGroupEditor({ ...groupEditor, name: event.currentTarget.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setGroupEditor(null);
                    }}
                  />
                  <GroupEditorActions>
                    <GroupEditorButton type="button" onClick={() => setGroupEditor(null)}>
                      {t('cancel')}
                    </GroupEditorButton>
                    <GroupEditorButton primary type="submit" disabled={!groupEditor.name.trim()}>
                      {t('confirm')}
                    </GroupEditorButton>
                  </GroupEditorActions>
                </GroupEditorDialog>
              </GroupEditorMask>
            )}
            {dragActive && (
              <DragOverlay>
                <DragCard>
                  <IconCrx />
                  <DragTitle>{t('extDropInstallTitle')}</DragTitle>
                  <DragText>
                    {t('extDropInstallHint1')}
                    <br />
                    {t('extDropInstallHint2')}
                  </DragText>
                </DragCard>
              </DragOverlay>
            )}
            {store.migrationOpen && <BrowserMigrationDialog />}
            {detail && (
              <ModalBackdrop>
                <ExtDetail item={detail} />
              </ModalBackdrop>
            )}

            {list.length === 0 ? (
              <EmptyState>
                <IconPuzzle />
                <EmptyText>
                  {store.searched || store.selectedFilter !== 'all'
                    ? t('extNoMatch')
                    : t('extNoneInstalled')}
                </EmptyText>
              </EmptyState>
            ) : (
              <>
                {store.groups.map((group) => (
                  <ExtensionGroup
                    groupId={group.id}
                    title={group.name}
                    key={group.id}
                    onRename={(groupId, name) => setGroupEditor({ groupId, name })}
                  />
                ))}
                <ExtensionGroup groupId={null} title={t('extUngrouped')} onRename={() => undefined} />
              </>
            )}

            <StoreSection />
          </MainInner>
        </MainScroll>
      </Container>
    </ThemeProvider>
  );
});
