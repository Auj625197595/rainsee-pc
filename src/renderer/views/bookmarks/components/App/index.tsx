import * as React from 'react';
import { observer } from 'mobx-react-lite';

import store from '../../store';
import { ThemeProvider } from 'styled-components';
import { SelectionDialog } from '~/renderer/components/SelectionDialog';
import { Container } from '~/renderer/components/Pages';
import { GlobalNavigationDrawer } from '~/renderer/components/GlobalNavigationDrawer';
import { IBookmark } from '~/interfaces';
import {
  Sidebar,
  SideHeader,
  SideTitle,
  SideSubtitle,
  SearchBox,
  SearchInput,
  FolderSection,
  SectionLabel,
  BottomActions,
  ActionItem,
  Main,
  MainInner,
  HeaderRow,
  Breadcrumb,
  Crumb,
  HeadingRow,
  BackBtn,
  Heading,
  ActionBtns,
  GhostBtn,
  PrimaryBtn,
  ListHeaderRow,
  CountText,
  CardList,
  Dialog,
  DialogTitle,
  DialogField,
  DialogFieldLabel,
  DialogInput,
  DialogButtons,
  BrowserRow,
  BrowserBadge,
  ImportNote,
  ToggleBtn,
  Ruler,
  RulerLine,
  RulerTick,
  FolderField,
  FolderLabel,
  FolderTrigger,
  FolderTriggerText,
  FolderTriggerArrow,
  FolderPanel,
  ToolboxSummary,
  ToolboxList,
  ToolboxRow,
  ToolboxUrl,
  ToolboxTitles,
} from './style';
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from '~/renderer/components/ContextMenu';
import { getBookmarkTitle, addImported } from '../../utils';
import type { SortCriteria } from '../../utils';
import { getDraggedBookmarkId, hasBookmarkSortDrag } from '../../utils/drag';
import Tree from '../Tree';
import { Bookmark } from '../Bookmark';
import { FolderPicker } from '../FolderPicker';
import { ipcRenderer } from '~/common/renderer-ipc';
import {
  createTranslator,
  resolveAppLanguage,
  Translator,
} from '~/common/i18n';
import { Button } from '~/renderer/components/Button';
import { ICON_EDIT, ICON_TRASH, ICON_FOLDER } from '~/renderer/constants';
import { WebUIStyle } from '~/renderer/mixins/default-styles';
import { OpenInNewTabToggle } from '~/renderer/components/OpenInNewTabToggle';
import { useI18n } from '~/renderer/components/I18n';

// ===== 内联图标（跟随 currentColor）=====

const IconSearch = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="7"></circle>
    <path d="m20 20-3.5-3.5"></path>
  </svg>
);

const IconPlus = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 5v14M5 12h14"></path>
  </svg>
);

const IconSort = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 6h18"></path>
    <path d="M7 12h10"></path>
    <path d="M11 18h2"></path>
  </svg>
);

const IconChevron = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m9 18 6-6-6-6"></path>
  </svg>
);

const IconBack = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M19 12H5"></path>
    <path d="m12 19-7-7 7-7"></path>
  </svg>
);

const IconNewFolder = () => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 5v14"></path>
    <path d="M5 12h14"></path>
  </svg>
);

const IconImport = () => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3v12"></path>
    <path d="m7 10 5 5 5-5"></path>
    <path d="M5 21h14"></path>
  </svg>
);

const IconExport = () => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 21V9"></path>
    <path d="m17 14-5-5-5 5"></path>
    <path d="M5 3h14"></path>
  </svg>
);

const IconBrowserImport = () => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="4" width="18" height="13" rx="2"></rect>
    <path d="M8 21h8"></path>
    <path d="M12 17v4"></path>
  </svg>
);

// 本机浏览器品牌信息（名称 + 标识色），选择行用纯色圆点示意。
const BROWSER_META: Record<
  'chrome' | 'edge' | 'firefox',
  { name: string; color: string }
> = {
  chrome: { name: 'Chrome', color: '#4285F4' },
  edge: { name: 'Microsoft Edge', color: '#0078D7' },
  firefox: { name: 'Firefox', color: '#FF7139' },
};

const BrowserDot = ({ color }: { color: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10" fill={color}></circle>
  </svg>
);

// 页面文案走统一 i18n 目录(见 docs/internationalization.md)。语言偏好来自
// WebUI 注入的 settings,auto 时以 navigator.language 为系统语言基线——主进程
// 在创建渲染器前已设 --lang,两者一致。
const getAppTranslator = (): Translator =>
  createTranslator(
    resolveAppLanguage(
      store.settings.language,
      typeof navigator === 'undefined' ? undefined : navigator.language,
    ),
  );

// 后端 __error 信封 → 本地化提示。
const mapImportError = (msg: string, t: Translator): string => {
  if (msg.startsWith('BROWSER_NOT_FOUND'))
    return t('importErrorBrowserNotFound');
  if (msg.startsWith('PROFILE_NOT_FOUND')) return t('importErrorProfileNotFound');
  if (msg.startsWith('PARSE_FAILED')) return t('importErrorParseFailed');
  return t('importErrorGeneric');
};

const getImportErrorMessage = (error: unknown, t: Translator): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return String(error || t('importErrorUnknown'));
};

const IconFlag = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="12" r="9"></circle>
  </svg>
);

const IconEdit = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 20h9"></path>
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"></path>
  </svg>
);

const IconToolbox = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.1"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 7h16v13H4z"></path>
    <path d="M8 7V4h8v3"></path>
    <path d="M4 12h16"></path>
    <path d="M10 12v2h4v-2"></path>
  </svg>
);

const onScroll = (e: any) => {
  const scrollPos = e.target.scrollTop;
  const scrollMax = e.target.scrollHeight - e.target.clientHeight - 256;

  if (scrollPos >= scrollMax) {
    store.itemsLoaded += store.getDefaultLoaded();
  }
};

const onCancelClick = () => {
  store.selectedItems = [];
};

const onDeleteClick = () => {
  store.deleteSelected();
};

const onSelectAllClick = () => {
  store.toggleSelectAllVisible();
};

const onRemoveClick = (item: IBookmark) => () => {
  store.removeItems([item._id]);
  store.menuVisible = false;
};

const onInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
  store.search(e.currentTarget.value);
};

const onNewFolderClick = () => {
  store.showDialog('new-folder');
};

const onToggleFlaggedOnly = () => {
  store.toggleShowFlaggedOnly();
};

const onClearFlags = () => {
  store.clearAllFlags();
};

// 点击刻度:滚动到对应书签并短暂高亮。若不在当前视图(在其它文件夹),
// 先切到该书签所在文件夹再滚动。
const onTickClick = (id: string) => () => {
  const item = store.getById(id);
  if (!item) return;

  const scrollToCard = () => {
    const el = document.querySelector(`[data-bm-id="${id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    store.flash(id);
  };

  // 「仅看标记」或当前文件夹已含该项:直接滚动;否则先切文件夹,等渲染后再滚。
  const inView = store.visibleItems.some((x) => x._id === id);
  if (inView) {
    scrollToCard();
  } else {
    store.showFlaggedOnly = false;
    store.currentFolder = item.parent ?? null;
    store.selectedItems = [];
    setTimeout(scrollToCard, 60);
  }
};

// 右上角「排序」菜单宽度(与下方 ContextMenu 的 width 一致,用于右对齐定位)。
const SORT_MENU_WIDTH = 176;

const onSortClick = (e: React.MouseEvent<HTMLButtonElement>) => {
  // 搜索结果跨父级(重排无意义)、只读目录(移动设备)禁止排序。
  if (store.searched !== '' || store.currentFolderReadOnly) return;
  const rect = e.currentTarget.getBoundingClientRect();
  store.sortMenuLeft = Math.round(rect.right - SORT_MENU_WIDTH);
  store.sortMenuTop = Math.round(rect.bottom) + 6;
  store.sortMenuVisible = !store.sortMenuVisible;
};

// 阻止按钮 mousedown 冒泡到 window 全局监听:否则点击按钮时全局监听先把菜单关掉,
// 随后 click 又把它打开,导致无法用按钮关闭菜单。
const onSortTriggerMouseDown = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.stopPropagation();
};

const onSortMenuMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
};

const onSortPick = (criteria: SortCriteria) => () => {
  store.sortBy(criteria);
};

const onEditClick = () => {
  store.showDialog('edit');
};

const onRemoveItemClick = (item: IBookmark) => (e: React.MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  store.removeItems([item._id]);
  store.selectedItems = store.selectedItems.filter((id) => id !== item._id);
};

const onRenameClick = () => {
  store.showDialog('rename-folder');
};

const onPathItemClick = (item: IBookmark) => () => {
  if (item) {
    store.currentFolder = item._id;
  } else {
    store.currentFolder = null;
  }
};

// ===== 移动入口 =====

// 右键菜单「移动到…」:移动当前右键项。
const onMoveItemClick = () => {
  if (store.currentBookmark?._id) {
    store.openMoveDialog([store.currentBookmark._id]);
  }
  store.menuVisible = false;
};

// 多选浮动条「移动」:移动全部选中项。
const onMoveSelected = () => {
  store.openMoveDialog(store.selectedItems);
};

const onPinSelected = () => {
  store.pinSelected();
};

// ===== 面包屑拖拽放置目标 =====

// 面包屑每段对应一个文件夹;根「我的书签」(null)解析为书签栏(main)。
const crumbTargetId = (item: IBookmark | null): string | null => {
  if (item) return item._id;
  return store.list.find((x) => x.static === 'main')?._id ?? null;
};

const ROOT_CRUMB_KEY = '__root__';
const crumbKey = (item: IBookmark | null) => item?._id ?? ROOT_CRUMB_KEY;

const onCrumbDragOver =
  (item: IBookmark | null, setHover: (v: boolean) => void) =>
  (e: React.DragEvent<HTMLSpanElement>) => {
    // dragover 阶段只能读 types,getData 受安全限制返回空。
    if (!hasBookmarkSortDrag(e.dataTransfer)) return;
    if (!crumbTargetId(item)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setHover(true);
  };

const onCrumbDrop =
  (item: IBookmark | null, setHover: (v: boolean) => void) =>
  (e: React.DragEvent<HTMLSpanElement>) => {
    setHover(false);
    const draggedId = getDraggedBookmarkId(e.dataTransfer);
    if (!draggedId) return;
    e.preventDefault();
    const targetId = crumbTargetId(item);
    if (!targetId) return;
    const ids = store.getMoveSetFromDrag(draggedId);
    store.moveItemsToFolder(ids, targetId);
    store.clearBookmarkDrag();
  };

// 文件夹选择器触发按钮的路径文本。
const folderPathLabel = (id: string | null): string => {
  const t = getAppTranslator();
  const targetId =
    id ?? store.list.find((x) => x.static === 'main')?._id ?? null;
  if (!targetId) return t('bookmarkBar');
  const path = store.getFolderPath(targetId).map(getBookmarkTitle);
  return path.length > 0 ? path.join(' / ') : t('bookmarkBar');
};

// 返回上一级目录:跳到当前文件夹的 parent
const onBackClick = () => {
  const folder = store.list.find((x) => x._id === store.currentFolder);
  if (folder && folder.parent != null) {
    store.currentFolder = folder.parent;
  }
};

const onImportClick = async () => {
  const res = await ipcRenderer.invoke('import-bookmarks');
  await addImported(res);
};

const onExportClick = async () => {
  ipcRenderer.invoke('export-bookmarks');
};

const onBrowserImportClick = () => {
  store.openBrowserImport();
};

// 统计读取结果里的书签 / 文件夹数量，供确认页展示。
const countImported = (arr: any[]) => {
  let folders = 0;
  let bookmarks = 0;
  const walk = (nodes: any[]) => {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      if (n.type === 'folder') {
        folders++;
        walk(n.children);
      } else if (n.type === 'bookmark') {
        bookmarks++;
      }
    }
  };
  walk(arr);
  return { folders, bookmarks };
};

const onPickBrowser = (id: 'chrome' | 'edge' | 'firefox') => async () => {
  if (store.importBusy) return;
  const t = getAppTranslator();
  store.importBusy = true;
  store.importError = null;
  try {
    const res = await ipcRenderer.invoke('browser-import-read', id);
    if (res && res.__error) {
      store.importError = mapImportError(res.__error, t);
    } else {
      const counts = countImported(res);
      if (counts.bookmarks === 0 && counts.folders === 0) {
        store.importError = t('noBookmarksRead');
      } else {
        // 先停在确认页，等用户确认再写入。
        store.pendingImport = res;
        store.pendingCounts = counts;
        store.pendingBrowserName = BROWSER_META[id].name;
        store.importPhase = 'confirm';
      }
    }
  } catch (error) {
    console.error('[browser-import] read failed', error);
    store.importError = t('importFailed', {
      reason: getImportErrorMessage(error, t),
    });
  } finally {
    store.importBusy = false;
  }
};

const onConfirmImport = async () => {
  if (store.importBusy || !store.pendingImport) return;
  const t = getAppTranslator();
  store.importBusy = true;
  store.importError = null;
  try {
    await addImported(store.pendingImport);
    store.closeBrowserImport();
  } catch (error) {
    console.error('[browser-import] commit failed', error);
    store.importError = t('importFailed', {
      reason: getImportErrorMessage(error, t),
    });
  } finally {
    store.importBusy = false;
  }
};

const onContextMenuMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
};

const onContainerMouseDown = () => {
  store.dialogVisible = false;
};

const onDialogMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
};

const onSaveClick = () => {
  if (store.dialogContent === 'new-folder') {
    store.addItem({
      title: store.nameInputRef.current.value,
      isFolder: true,
      parent: store.editParentFolderId ?? store.currentFolder,
      children: [],
    });
  } else if (store.dialogContent === 'edit') {
    store.updateItem(store.currentBookmark._id, {
      title: store.nameInputRef.current.value,
      url: store.urlInputRef.current.value,
      parent: store.editParentFolderId,
    });
  } else if (store.dialogContent === 'rename-folder') {
    store.updateItem(store.currentBookmark._id, {
      title: store.nameInputRef.current.value,
      parent: store.editParentFolderId,
    });
  }

  store.dialogVisible = false;
};

// 与 Chrome 书签管理器一致，使用 ?id=<folderId> 表示当前文件夹。
// 当前页的文件夹切换分散在侧栏、面包屑和卡片中；在此统一同步，避免每个
// 入口都维护 URL。等书签数据加载后才读 id，防止初始 load 覆盖深链目标。
const BookmarksUrlSync = observer(() => {
  const { currentFolder, list } = store;
  const [urlReady, setUrlReady] = React.useState(false);
  const lastFolderRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (urlReady || list.length === 0) return;

    const folderId = new URLSearchParams(window.location.search).get('id');
    const folder = folderId
      ? list.find((item) => item._id === folderId && item.isFolder)
      : null;

    if (folder) {
      lastFolderRef.current = folder._id;
      store.currentFolder = folder._id;
    } else {
      lastFolderRef.current = currentFolder;
    }
    setUrlReady(true);
  }, [currentFolder, list, urlReady]);

  React.useEffect(() => {
    if (!urlReady) return;

    const onPopState = () => {
      const folderId = new URLSearchParams(window.location.search).get('id');
      const folder = folderId
        ? store.list.find((item) => item._id === folderId && item.isFolder)
        : null;
      const fallback =
        store.list.find((item) => item.static === 'main')?._id ?? null;
      const nextFolder = folderId ? folder?._id ?? fallback : null;
      lastFolderRef.current = nextFolder;
      store.currentFolder = nextFolder;
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [urlReady]);

  React.useEffect(() => {
    if (!urlReady || currentFolder === lastFolderRef.current) return;

    const url = new URL(window.location.href);
    if (currentFolder) {
      url.searchParams.set('id', currentFolder);
    } else {
      url.searchParams.delete('id');
    }
    window.history.pushState({ folderId: currentFolder }, '', url.toString());
    lastFolderRef.current = currentFolder;
  }, [currentFolder, urlReady]);

  return null;
});

const BookmarksContent = observer(() => {
  const t = useI18n();
  const [editing, setEditing] = React.useState(false);
  const items = store.visibleItems;
  const path = store.path;
  const currentTitle =
    path.length > 0 ? getBookmarkTitle(path[path.length - 1]) : t('bookmarks');
  // 面包屑拖拽悬停高亮:key = crumbKey(item) 或根标记。
  const [crumbHoverKey, setCrumbHoverKey] = React.useState<string | null>(null);

  const toggleEditing = () => {
    setEditing((value) => !value);
    store.selectedItems = [];
  };

  return (
    <MainInner>
      <SelectionDialog
        theme={store.theme}
        visible={store.selectedItems.length > 0}
        amount={store.selectedItems.length}
        onDeleteClick={onDeleteClick}
        onCancelClick={onCancelClick}
        onSelectAllClick={onSelectAllClick}
        onMoveClick={onMoveSelected}
        onPinClick={store.canManualSort ? onPinSelected : undefined}
        selectAllLabel={store.allVisibleSelected ? t('deselectAll') : t('selectAll')}
      />

      <HeaderRow>
        <div>
          <HeadingRow>
            {path.length > 0 && (
              <BackBtn onClick={onBackClick} title={t('backToParent')}>
                <IconBack />
              </BackBtn>
            )}
            <Heading>{currentTitle}</Heading>
          </HeadingRow>
        </div>
        <ActionBtns>
          {store.hasFlagged && (
            <ToggleBtn
              active={store.showFlaggedOnly}
              onClick={onToggleFlaggedOnly}
              title={
                store.showFlaggedOnly
                  ? t('showAllBookmarks')
                  : t('showFlaggedOnly')
              }
            >
              <IconFlag />
              {t('flaggedOnly')}
            </ToggleBtn>
          )}
          {store.hasFlagged && (
            <GhostBtn onClick={onClearFlags} title={t('clearFlagsTitle')}>
              {t('clearFlags')}
            </GhostBtn>
          )}
          <OpenInNewTabToggle
            checked={store.openInNewTab}
            onChange={(v) => store.setOpenInNewTab(v)}
            title={t('openInNewTabHint')}
          />
          <GhostBtn
            onClick={toggleEditing}
            title={editing ? t('finishEditing') : t('editBookmarks')}
          >
            <IconEdit />
            {editing ? t('done') : t('edit')}
          </GhostBtn>
          <GhostBtn
            onClick={onSortClick}
            onMouseDown={onSortTriggerMouseDown}
            disabled={store.searched !== '' || store.currentFolderReadOnly}
          >
            <IconSort />
            {t('sort')}
          </GhostBtn>
          {!store.currentFolderReadOnly && (
            <PrimaryBtn onClick={onNewFolderClick}>
              <IconPlus />
              {t('newFolder')}
            </PrimaryBtn>
          )}
        </ActionBtns>
      </HeaderRow>

      <ListHeaderRow>
        <Breadcrumb>
          <Crumb
            dropHover={crumbHoverKey === ROOT_CRUMB_KEY}
            onClick={onPathItemClick(null)}
            onDragOver={onCrumbDragOver(null, (v) =>
              setCrumbHoverKey(v ? ROOT_CRUMB_KEY : null),
            )}
            onDragLeave={() =>
              setCrumbHoverKey((k) => (k === ROOT_CRUMB_KEY ? null : k))
            }
            onDrop={onCrumbDrop(null, () => setCrumbHoverKey(null))}
          >
            {t('myBookmarks')}
          </Crumb>
          {path.map((item) => (
            <React.Fragment key={item._id}>
              <IconChevron />
              <Crumb
                active
                dropHover={crumbHoverKey === item._id}
                onClick={onPathItemClick(item)}
                onDragOver={onCrumbDragOver(item, (v) =>
                  setCrumbHoverKey(v ? item._id : null),
                )}
                onDragLeave={() =>
                  setCrumbHoverKey((k) => (k === item._id ? null : k))
                }
                onDrop={onCrumbDrop(item, () => setCrumbHoverKey(null))}
              >
                {getBookmarkTitle(item)}
              </Crumb>
            </React.Fragment>
          ))}
        </Breadcrumb>
        <CountText>{t('itemsCount', { count: items.length })}</CountText>
      </ListHeaderRow>

      <CardList>
        {items.map((data) => (
          <Bookmark
            data={data}
            editing={editing}
            onRemove={onRemoveItemClick(data)}
            key={data._id}
          />
        ))}
      </CardList>

      {store.hasFlagged && (
        <Ruler>
          <RulerLine />
          {items.map((data, i) => {
            if (!data._id || !store.isFlagged(data._id)) return null;
            // 刻度位置 = 该书签在当前列表中的序号 / 总数(取槽位中点),
            // 与其在垂直方向的真实滚动位置对应。
            const pct = ((i + 0.5) / items.length) * 100;
            return (
              <RulerTick
                key={data._id}
                style={{ top: `${pct}%` }}
                title={getBookmarkTitle(data)}
                onClick={onTickClick(data._id)}
              />
            );
          })}
        </Ruler>
      )}
    </MainInner>
  );
});

// 开源版：书签云同步面板与安全提醒已随云服务移除。

export default observer(() => {
  const t = useI18n();
  const [toolboxVisible, setToolboxVisible] = React.useState(false);

  const duplicateGroups = store.duplicateGroups;
  const duplicateRemoveIds = duplicateGroups.flatMap(
    (group) => group.removeIds,
  );

  const removeDuplicateBookmarks = () => {
    if (duplicateRemoveIds.length === 0) return;
    const confirmed = window.confirm(
      t('duplicateConfirm', {
        groups: duplicateGroups.length,
        count: duplicateRemoveIds.length,
      }),
    );
    if (!confirmed) return;
    store.removeItems(duplicateRemoveIds);
  };

  let dialogTitle = '新建文件夹';

  if (store.dialogContent === 'edit') {
    dialogTitle = t('editBookmark');
  } else if (store.dialogContent === 'rename-folder') {
    dialogTitle = t('renameFolder');
  } else if (store.dialogContent === 'move') {
    dialogTitle =
      store.moveTargetIds.length > 1
        ? t('moveItemsToFolder', { count: store.moveTargetIds.length })
        : t('moveToFolder');
  }

  const showEditFolderPicker =
    store.dialogContent === 'edit' || store.dialogContent === 'rename-folder';

  React.useEffect(() => {
    if (!store.dialogVisible || store.dialogContent === 'move') return;
    const input = store.nameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [store.dialogVisible, store.dialogContent, store.currentBookmark]);

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <Container
        onMouseDown={onContainerMouseDown}
        darken={
          store.dialogVisible || store.importBrowserVisible || toolboxVisible
        }
      >
        <WebUIStyle />
        <BookmarksUrlSync />
        <GlobalNavigationDrawer></GlobalNavigationDrawer>

        <Sidebar>
          <SideHeader>
            <SideTitle>{t('bookmarks')}</SideTitle>
            <SideSubtitle>{t('bookmarksSubtitle')}</SideSubtitle>
          </SideHeader>

          <SearchBox>
            <IconSearch />
            <SearchInput placeholder={t('searchBookmarks')} onInput={onInput} />
          </SearchBox>

          <FolderSection>
            <SectionLabel>{t('folders')}</SectionLabel>
            <Tree />
          </FolderSection>

          <BottomActions>
            {!store.currentFolderReadOnly && (
              <ActionItem onClick={onNewFolderClick}>
                <IconNewFolder />
                {t('newFolder')}
              </ActionItem>
            )}
            <ActionItem onClick={onImportClick}>
              <IconImport />
              {t('importBookmarks')}
            </ActionItem>
            <ActionItem onClick={onBrowserImportClick}>
              <IconBrowserImport />
              {t('importFromBrowser')}
            </ActionItem>
            <ActionItem onClick={onExportClick}>
              <IconExport />
              {t('exportBookmarks')}
            </ActionItem>
            <ActionItem onClick={() => setToolboxVisible(true)}>
              <IconToolbox />
              {t('toolbox')}
            </ActionItem>
          </BottomActions>
        </Sidebar>

        <ContextMenu
          onMouseDown={onContextMenuMouseDown}
          style={{
            top: store.menuTop,
            left: store.menuLeft,
          }}
          visible={store.menuVisible}
        >
          {store.currentBookmark && !store.currentBookmark.isFolder && (
            <ContextMenuItem onClick={onEditClick} icon={ICON_EDIT}>
              {t('edit')}
            </ContextMenuItem>
          )}
          {store.currentBookmark && store.currentBookmark.isFolder && (
            <ContextMenuItem onClick={onRenameClick} icon={ICON_EDIT}>
              {t('rename')}
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={onMoveItemClick} icon={ICON_FOLDER}>
            {t('moveTo')}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={onRemoveClick(store.currentBookmark)}
            icon={ICON_TRASH}
          >
            {t('deleteItem')}
          </ContextMenuItem>
        </ContextMenu>

        <ContextMenu
          onMouseDown={onSortMenuMouseDown}
          style={{
            top: store.sortMenuTop,
            left: store.sortMenuLeft,
            width: SORT_MENU_WIDTH,
          }}
          visible={store.sortMenuVisible}
        >
          <ContextMenuItem onClick={onSortPick('title-asc')}>
            {t('sortTitleAsc')}
          </ContextMenuItem>
          <ContextMenuItem onClick={onSortPick('title-desc')}>
            {t('sortTitleDesc')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onSortPick('url-asc')}>
            {t('sortUrlAsc')}
          </ContextMenuItem>
          <ContextMenuItem onClick={onSortPick('url-desc')}>
            {t('sortUrlDesc')}
          </ContextMenuItem>
        </ContextMenu>

        <Main onScroll={onScroll}>
          <BookmarksContent />
        </Main>
      </Container>

      {toolboxVisible && (
        <Dialog onMouseDown={onDialogMouseDown} wide visible>
          <DialogTitle>{t('toolboxTitle')}</DialogTitle>
          <ToolboxSummary>{t('toolboxDescription')}</ToolboxSummary>
          {duplicateGroups.length === 0 ? (
            <ToolboxSummary>{t('toolboxNoDuplicates')}</ToolboxSummary>
          ) : (
            <React.Fragment>
              <ToolboxSummary>
                {t('toolboxFound', {
                  groups: duplicateGroups.length,
                  count: duplicateRemoveIds.length,
                })}
              </ToolboxSummary>
              <ToolboxList>
                {duplicateGroups.map((group) => (
                  <ToolboxRow key={group.url}>
                    <ToolboxUrl title={group.url}>{group.url}</ToolboxUrl>
                    <ToolboxTitles
                      title={group.items
                        .map((item) => item.title || t('untitled'))
                        .join(t('listSeparator'))}
                    >
                      {t('bookmarksColon', { count: group.items.length })}
                      {group.items
                        .map((item) => item.title || t('untitled'))
                        .join(t('listSeparator'))}
                    </ToolboxTitles>
                  </ToolboxRow>
                ))}
              </ToolboxList>
            </React.Fragment>
          )}
          <DialogButtons>
            <Button
              onClick={() => setToolboxVisible(false)}
              background={
                store.theme['dialog.lightForeground']
                  ? 'rgba(255, 255, 255, 0.08)'
                  : 'rgba(0, 0, 0, 0.08)'
              }
              foreground={
                store.theme['dialog.lightForeground'] ? 'white' : 'black'
              }
            >
              {t('close')}
            </Button>
            <Button
              onClick={removeDuplicateBookmarks}
              style={{
                marginLeft: 8,
                opacity: duplicateRemoveIds.length > 0 ? 1 : 0.5,
              }}
            >
              {t('cleanDuplicates')}
            </Button>
          </DialogButtons>
          <div style={{ clear: 'both' }}></div>
        </Dialog>
      )}

      {store.dialogVisible && store.dialogContent !== 'move' && (
        <Dialog
          onMouseDown={onDialogMouseDown}
          wide={showEditFolderPicker && store.editFolderPanelOpen}
          visible
        >
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogField>
            <DialogFieldLabel>{t('nameField')}</DialogFieldLabel>
            <DialogInput
              ref={store.nameInputRef}
              defaultValue={
                store.dialogContent === 'new-folder'
                  ? ''
                  : store.currentBookmark?.title || ''
              }
            />
          </DialogField>

          {store.dialogContent === 'edit' && (
            <DialogField>
              <DialogFieldLabel>{t('addressField')}</DialogFieldLabel>
              <DialogInput
                ref={store.urlInputRef}
                type="url"
                defaultValue={store.currentBookmark?.url || ''}
              />
            </DialogField>
          )}

          {showEditFolderPicker && (
            <FolderField>
              <FolderLabel>{t('parentFolder')}</FolderLabel>
              {!store.editFolderPanelOpen ? (
                <FolderTrigger
                  onClick={() => store.openEditFolderPanel()}
                  title={t('chooseFolder')}
                >
                  <FolderTriggerText>
                    {folderPathLabel(store.editParentFolderId)}
                  </FolderTriggerText>
                  <FolderTriggerArrow expanded={store.editFolderPanelOpen}>
                    <IconChevron />
                  </FolderTriggerArrow>
                </FolderTrigger>
              ) : (
                <FolderPanel>
                  <FolderPicker
                    selectedId={store.editParentFolderId}
                    excludeIds={store.getEditExcludeIds()}
                    onSelect={(folder) => {
                      store.setEditParent(folder._id);
                      store.closeEditFolderPanel();
                    }}
                  />
                  <div style={{ textAlign: 'right', marginTop: 8 }}>
                    <Button
                      onClick={() => store.closeEditFolderPanel()}
                      background={
                        store.theme['dialog.lightForeground']
                          ? 'rgba(255, 255, 255, 0.08)'
                          : 'rgba(0, 0, 0, 0.08)'
                      }
                      foreground={
                        store.theme['dialog.lightForeground']
                          ? 'white'
                          : 'black'
                      }
                    >
                      {t('collapse')}
                    </Button>
                  </div>
                </FolderPanel>
              )}
            </FolderField>
          )}

          <DialogButtons>
            <Button
              onClick={() => (store.dialogVisible = false)}
              background={
                store.theme['dialog.lightForeground']
                  ? 'rgba(255, 255, 255, 0.08)'
                  : 'rgba(0, 0, 0, 0.08)'
              }
              foreground={
                store.theme['dialog.lightForeground'] ? 'white' : 'black'
              }
            >
              {t('cancel')}
            </Button>
            <Button onClick={onSaveClick} style={{ marginLeft: 8 }}>
              {t('save')}
            </Button>
          </DialogButtons>
          <div style={{ clear: 'both' }}></div>
        </Dialog>
      )}

      {/* 移动到文件夹弹窗(多选「移动」/ 右键「移动到…」) */}
      {store.dialogVisible && store.dialogContent === 'move' && (
        <Dialog onMouseDown={onDialogMouseDown} wide visible>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <FolderPicker
            selectedId={store.moveTargetFolderId}
            excludeIds={store.moveExcludeIds}
            onSelect={(folder) => (store.moveTargetFolderId = folder._id)}
          />
          <DialogButtons>
            <Button
              onClick={() => (store.dialogVisible = false)}
              background={
                store.theme['dialog.lightForeground']
                  ? 'rgba(255, 255, 255, 0.08)'
                  : 'rgba(0, 0, 0, 0.08)'
              }
              foreground={
                store.theme['dialog.lightForeground'] ? 'white' : 'black'
              }
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={() => store.confirmMove()}
              style={{
                marginLeft: 8,
                opacity: store.moveTargetFolderId ? 1 : 0.5,
              }}
            >
              {t('moveAction')}
            </Button>
          </DialogButtons>
          <div style={{ clear: 'both' }}></div>
        </Dialog>
      )}

      {store.importBrowserVisible && (
        <Dialog onMouseDown={onDialogMouseDown} visible>
          {store.importPhase === 'confirm' ? (
            <React.Fragment>
              <DialogTitle>{t('confirmImportTitle')}</DialogTitle>
              <ImportNote>
                {t('importConfirmBody', {
                  browser: store.pendingBrowserName,
                  count: store.pendingCounts.bookmarks,
                  folders:
                    store.pendingCounts.folders > 0
                      ? t('importFoldersNote', {
                          count: store.pendingCounts.folders,
                        })
                      : '',
                })}
              </ImportNote>
              {store.importBusy && <ImportNote>{t('importing')}</ImportNote>}
              {store.importError && (
                <ImportNote error>{store.importError}</ImportNote>
              )}
              <DialogButtons>
                <Button
                  onClick={() => store.backToBrowserSelect()}
                  style={{ opacity: store.importBusy ? 0.5 : 1 }}
                  background={
                    store.theme['dialog.lightForeground']
                      ? 'rgba(255, 255, 255, 0.08)'
                      : 'rgba(0, 0, 0, 0.08)'
                  }
                  foreground={
                    store.theme['dialog.lightForeground'] ? 'white' : 'black'
                  }
                >
                  {t('backAction')}
                </Button>
                <Button
                  onClick={onConfirmImport}
                  style={{ marginLeft: 8, opacity: store.importBusy ? 0.5 : 1 }}
                >
                  {t('confirmImportAction')}
                </Button>
              </DialogButtons>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <DialogTitle>{t('importFromBrowserTitle')}</DialogTitle>
              {store.importBusy ? (
                <ImportNote>{t('readingBookmarks')}</ImportNote>
              ) : (
                <React.Fragment>
                  {(['chrome', 'edge', 'firefox'] as const).map((b) => {
                    const meta = BROWSER_META[b];
                    const detected = store.availableBrowsers?.[b];
                    const disabled = !detected;
                    return (
                      <BrowserRow
                        key={b}
                        disabled={disabled}
                        style={{ marginTop: 8 }}
                        onClick={disabled ? undefined : onPickBrowser(b)}
                      >
                        <BrowserDot color={meta.color} />
                        <span>{meta.name}</span>
                        {!detected && (
                          <BrowserBadge>{t('notDetected')}</BrowserBadge>
                        )}
                      </BrowserRow>
                    );
                  })}
                  {store.importError && (
                    <ImportNote error>{store.importError}</ImportNote>
                  )}
                </React.Fragment>
              )}
              <DialogButtons>
                <Button
                  onClick={() => store.closeBrowserImport()}
                  background={
                    store.theme['dialog.lightForeground']
                      ? 'rgba(255, 255, 255, 0.08)'
                      : 'rgba(0, 0, 0, 0.08)'
                  }
                  foreground={
                    store.theme['dialog.lightForeground'] ? 'white' : 'black'
                  }
                >
                  {t('close')}
                </Button>
              </DialogButtons>
            </React.Fragment>
          )}
          <div style={{ clear: 'both' }}></div>
        </Dialog>
      )}
    </ThemeProvider>
  );
});
