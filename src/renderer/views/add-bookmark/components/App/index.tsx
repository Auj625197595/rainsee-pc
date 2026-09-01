import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';

import {
  StyledApp,
  Surface,
  Header,
  HeaderActions,
  Title,
  CloseButton,
  HeaderDeleteButton,
  Body,
  Field,
  FieldLabel,
  Input,
  FolderTrigger,
  FolderTriggerHint,
  FolderTriggerText,
  FolderTriggerArrow,
  FolderPanel,
  FolderPanelHead,
  FolderPanelTitle,
  FolderPanelActions,
  FolderToolbar,
  SearchField,
  SearchIcon,
  ToolbarMeta,
  ToolbarButton,
  TreeViewport,
  TreeItemRow,
  TreeToggle,
  TreeToggleSpacer,
  TreeIconBox,
  TreeLabel,
  TreeMeta,
  TreeCheck,
  EmptyState,
  Buttons,
  SecondaryButton,
  AccentSecondaryButton,
  PrimaryButton,
} from './style';
import store from '../../store';
import { ipcRenderer } from 'electron';
import { IBookmark } from '~/interfaces';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { useI18n } from '~/renderer/components/I18n';

// 内联 getBookmarkTitle,避免 import bookmarks/utils 把整个 bookmarks store
// (依赖 window.electron,本弹窗上下文不存在)在模块加载时拖进来导致崩溃。
const getBookmarkTitle = (item: IBookmark) => {
  if (!item.static) return item.title;
  const t = useI18n();
  if (item.static === 'main') return t('bookmarkBar');
  if (item.static === 'mobile') return t('mobileDeviceBookmarks');
  if (item.static === 'other') return t('bookmarksOtherFolder');
  return item.title;
};

const onDone = () => {
  store.hide();
};

const updateBookmark = () => {
  if (!store.bookmark) return;
  ipcRenderer.send('bookmarks-update', store.bookmark._id, store.bookmark);
};

const onTitleChange = () => {
  store.bookmark.title = store.titleRef.current.value;
  updateBookmark();
};

const onUrlChange = () => {
  store.bookmark.url = store.urlRef.current.value;
  updateBookmark();
};

const onRemove = () => {
  if (!store.bookmark) return;
  ipcRenderer.send('bookmarks-remove', [store.bookmark._id]);
  store.hide();
};

const onClose = () => {
  store.hide();
};

const onAddToHomepage = async () => {
  const success = await store.addToHomepage();
  if (success) {
    store.hide();
  }
};

const onFolderSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  store.setFolderSearch(e.target.value);
};

const onFolderTriggerClick = () => {
  if (store.folderPanelOpen) {
    store.setFolderSearch('');
    store.closeFolderPanel();
    return;
  }

  store.openFolderPanel();
};

const onFolderSelect = (folder: IBookmark) => () => {
  if (!folder?._id || !store.bookmark) return;

  store.setCurrentFolder(folder);
  store.bookmark.parent = folder._id;
  updateBookmark();
  store.setFolderSearch('');
  store.closeFolderPanel();
};

const onTreeToggle = (folder: IBookmark) => (
  e: React.MouseEvent<HTMLButtonElement>,
) => {
  e.stopPropagation();
  store.toggleFolderExpanded(folder._id);
};

const FolderGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
    <path
      d="M3.75 7.5A2.25 2.25 0 0 1 6 5.25h4.03a2.25 2.25 0 0 1 1.59.66l1.22 1.22a2.25 2.25 0 0 0 1.59.66H18A2.25 2.25 0 0 1 20.25 10v6A2.25 2.25 0 0 1 18 18.25H6A2.25 2.25 0 0 1 3.75 16V7.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

const ChevronGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
    <path
      d="m9 6 6 6-6 6"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SearchGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path
      d="m21 21-4.35-4.35"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <circle
      cx="11"
      cy="11"
      r="6"
      stroke="currentColor"
      strokeWidth="2.2"
    />
  </svg>
);

const CheckGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <path
      d="m5.5 12.5 4 4 9-9"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const getFolderChildren = (folder: IBookmark) =>
  store.getFolderChildren(folder._id);

const matchesFolder = (folder: IBookmark, query: string): boolean => {
  if (query === '') return true;

  if (getBookmarkTitle(folder).toLowerCase().includes(query)) {
    return true;
  }

  return getFolderChildren(folder).some((child) => matchesFolder(child, query));
};

const countMatches = (folders: IBookmark[], query: string): number => {
  if (query === '') return folders.length;

  return folders.reduce((count, folder) => {
    const selfMatch = getBookmarkTitle(folder).toLowerCase().includes(query)
      ? 1
      : 0;
    return count + selfMatch;
  }, 0);
};

const FolderTreeItem = observer(
  ({ folder, depth, query }: { folder: IBookmark; depth: number; query: string }) => {
    const t = useI18n();
    const children = getFolderChildren(folder);
    const visibleChildren = children.filter((child) => matchesFolder(child, query));
    const selected = store.currentFolder?._id === folder._id;
    const expanded = query !== '' || store.isFolderExpanded(folder._id);

    if (query !== '' && !matchesFolder(folder, query)) {
      return null;
    }

    return (
      <>
        <TreeItemRow
          depth={depth}
          selected={selected}
          onClick={onFolderSelect(folder)}
        >
          {children.length > 0 ? (
            <TreeToggle
              type="button"
              expanded={expanded}
              onClick={onTreeToggle(folder)}
              aria-label={
                expanded
                  ? t('bmFolderCollapseAria')
                  : t('bmFolderExpandAria')
              }
            >
              <ChevronGlyph />
            </TreeToggle>
          ) : (
            <TreeToggleSpacer />
          )}
          <TreeIconBox selected={selected}>
            <FolderGlyph />
          </TreeIconBox>
          <TreeLabel selected={selected}>{getBookmarkTitle(folder)}</TreeLabel>
          <TreeMeta>
            {children.length > 0
              ? t('bmChildCount', { count: children.length })
              : t('bmEmptyFolder')}
          </TreeMeta>
          <TreeCheck selected={selected}>
            {selected && <CheckGlyph />}
          </TreeCheck>
        </TreeItemRow>
        {expanded &&
          visibleChildren.map((child) => (
            <FolderTreeItem
              key={child._id}
              folder={child}
              depth={depth + 1}
              query={query}
            />
          ))}
      </>
    );
  },
);

export const App = observer(() => {
  const t = useI18n();
  const query = store.folderSearch.trim().toLowerCase();
  const rootFolders = store
    .getRootFolders()
    .filter((folder) => matchesFolder(folder, query));
  const allExpanded =
    store.folders.length > 0 &&
    store.expandedFolderIds.length >= store.folders.length;
  const selectedPath = store.currentFolder
    ? store
        .getFolderPath(store.currentFolder._id)
        .map((folder) => store.getFolderLabel(folder))
        .join(' / ')
    : t('bookmarkBar');
  const matchCount = countMatches(store.folders, query);

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <StyledApp visible={store.visible}>
        <UIStyle />
        <Surface>
          <Header>
            <div>
              <Title>{store.dialogTitle}</Title>
            </div>
            <HeaderActions>
              {store.bookmark && (
                <HeaderDeleteButton type="button" onClick={onRemove}>
                  {t('abmDelete')}
                </HeaderDeleteButton>
              )}
              <CloseButton type="button" onClick={onClose} aria-label={t('abmCloseAria')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </CloseButton>
            </HeaderActions>
          </Header>
          <Body>
            <Field>
              <FieldLabel>{t('abmName')}</FieldLabel>
              <Input
                tabIndex={0}
                ref={store.titleRef}
                onChange={onTitleChange}
              />
            </Field>

            {!store.bookmark?.isFolder && (
              <Field>
                <FieldLabel>{t('abmUrl')}</FieldLabel>
                <Input
                  tabIndex={0}
                  ref={store.urlRef}
                  type="url"
                  onChange={onUrlChange}
                />
              </Field>
            )}

            <Field as="div">
              <FieldLabel>{t('abmFolder')}</FieldLabel>
              {!store.folderPanelOpen && (
                <FolderTrigger onClick={onFolderTriggerClick}>
                  <div>
                    <FolderTriggerHint>{t('abmCurrentFolder')}</FolderTriggerHint>
                    <FolderTriggerText>{selectedPath}</FolderTriggerText>
                  </div>
                  <FolderTriggerArrow expanded={store.folderPanelOpen}>
                    <ChevronGlyph />
                  </FolderTriggerArrow>
                </FolderTrigger>
              )}

              {store.folderPanelOpen && (
                <FolderPanel>
                  <FolderPanelHead>
                    <FolderPanelTitle>{t('abmChooseLocation')}</FolderPanelTitle>
                    <FolderPanelActions>
                      <ToolbarButton
                        type="button"
                        onClick={
                          query !== ''
                            ? () => store.setFolderSearch('')
                            : allExpanded
                              ? () => store.collapseAllFolders()
                              : () => store.expandAllFolders()
                        }
                      >
                        {query !== ''
                          ? t('abmClearSearch')
                          : allExpanded
                            ? t('abmCollapseAll')
                            : t('abmExpandAll')}
                      </ToolbarButton>
                      <ToolbarButton type="button" onClick={onFolderTriggerClick}>
                        {t('abmCollapse')}
                      </ToolbarButton>
                    </FolderPanelActions>
                  </FolderPanelHead>

                  <FolderToolbar>
                    <SearchIcon>
                      <SearchGlyph />
                    </SearchIcon>
                    <SearchField
                      type="text"
                      value={store.folderSearch}
                      onChange={onFolderSearchChange}
                      placeholder={t('bmSearchFolder')}
                    />
                    {query !== '' && (
                      <ToolbarMeta>
                        {t('abmMatchCount', { count: matchCount })}
                      </ToolbarMeta>
                    )}
                  </FolderToolbar>

                  <TreeViewport>
                    {rootFolders.length > 0 ? (
                      rootFolders.map((folder) => (
                        <FolderTreeItem
                          key={folder._id}
                          folder={folder}
                          depth={0}
                          query={query}
                        />
                      ))
                    ) : (
                      <EmptyState>
                        {store.folders.length === 0 && query === ''
                          ? t('abmLoadingFolders')
                          : t('abmNoMatchingFolders')}
                      </EmptyState>
                    )}
                  </TreeViewport>
                </FolderPanel>
              )}
            </Field>
          </Body>

          <Buttons>
            <SecondaryButton type="button" onClick={onRemove}>
              {t('abmDelete')}
            </SecondaryButton>
            <AccentSecondaryButton
              type="button"
              onClick={onAddToHomepage}
              disabled={store.addingToHomepage}
            >
              {store.addingToHomepage
                ? t('abmAddingToHomepage')
                : t('abmAddToHomepage')}
            </AccentSecondaryButton>
            <PrimaryButton type="button" onClick={onDone}>
              {t('abmDone')}
            </PrimaryButton>
          </Buttons>
        </Surface>
      </StyledApp>
    </ThemeProvider>
  );
});
