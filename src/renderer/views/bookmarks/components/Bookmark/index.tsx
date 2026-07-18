import * as React from 'react';
import { observer } from 'mobx-react-lite';

import {
  Card,
  DragHandle,
  IconBox,
  Favicon,
  Info,
  TitleAction,
  Site,
  RowActions,
  IconButton,
  FlagToggle,
} from './style';
import { IBookmark } from '~/interfaces';
import store from '../../store';
import { getBookmarkTitle } from '../../utils';
import { getIconByUrlNet, parseBookmarklet } from '~/utils/url';
import { setDraggedLinkData } from '~/renderer/views/app/utils/link-drop';

// 单击打开后,双击会再触发一次 click → 重复 window.open。按书签 _id 在短时间窗内去重,
// 保证双击同一书签只开一个标签(不同书签不受影响)。
let lastOpened: { id: string; at: number } | null = null;
const BOOKMARK_SORT_MIME = 'application/x-rainsee-bookmark-sort';

const hasBookmarkSortDrag = (dataTransfer: DataTransfer | null) => {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types || []).includes(BOOKMARK_SORT_MIME);
};

const getDropPosition = (
  e: React.DragEvent<HTMLDivElement>,
): 'before' | 'after' => {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
};

const openBookmark = (item: IBookmark) => {
  const now = Date.now();
  if (lastOpened && lastOpened.id === item._id && now - lastOpened.at < 500) {
    return;
  }
  lastOpened = { id: item._id, at: now };

  // bookmarklet(javascript: 脚本):不在书签管理页本身执行(此处 nodeIntegration:false、
  // 也非目标网页),交给主进程在当前选中的网页标签执行。走 add-tab 咽喉——view-manager
  // 会识别 javascript: URL 改为 executeJavaScript。
  if (parseBookmarklet(item.url) !== null) {
    const wid = (window as any).windowId;
    const ipc = (window as any).electron?.ipcRenderer;
    if (wid != null && ipc) {
      ipc.send(`add-tab-${wid}`, { url: item.url, active: true });
    }
    return;
  }

  if (store.openInNewTab) {
    // 勾选「在新页面打开」:开新标签(setWindowOpenHandler → viewManager.create)。
    const win = window.open(item.url, '_blank');
    if (win) {
      try {
        win.focus();
      } catch (e) {
        console.error(e);
      }
    }
  } else if (item.url) {
    // 未勾选:在当前标签打开(替换书签管理页,等价于历史页标题 <a> 的当前页导航)。
    window.location.href = item.url;
  }
};

const onClick = (item: IBookmark) => () => {
  const index = store.selectedItems.indexOf(item._id);
  if (index === -1) {
    store.selectedItems.push(item._id);
  } else {
    store.selectedItems.splice(index, 1);
  }
};

const onTitleClick = (item: IBookmark) => (
  e: React.MouseEvent<HTMLButtonElement>,
) => {
  e.stopPropagation();

  if (item.isFolder) {
    store.currentFolder = item._id;
    store.selectedItems = [];
    return;
  }

  openBookmark(item);
};

const onTitleDragStart = (item: IBookmark) => (
  e: React.DragEvent<HTMLButtonElement>,
) => {
  if (item.isFolder || !item.url) {
    e.preventDefault();
    return;
  }
  setDraggedLinkData(e.dataTransfer, {
    url: item.url,
    title: getBookmarkTitle(item),
  });
};

const onMoreClick = (data: IBookmark) => (e: any) => {
  e.stopPropagation();

  if (store.isReadOnly(data)) return;

  const { left, top } = e.currentTarget.getBoundingClientRect();

  store.menuVisible = true;
  store.menuLeft = left - 130;
  store.menuTop = top;
  store.currentBookmark = data;
};

const onEditClick = (data: IBookmark) => (e: any) => {
  e.stopPropagation();

  if (store.isReadOnly(data)) return;

  store.currentBookmark = data;

  if (data.isFolder) {
    store.showDialog('rename-folder');
  } else {
    store.showDialog('edit');
  }
};

const onContextMenu = (data: IBookmark) => (e: any) => {
  e.preventDefault();

  // 右键仅选中(不进入文件夹),再决定是否弹菜单
  store.selectedItems = [data._id];

  // 移动设备书签只读,不弹右键菜单(编辑/删除均不可用)
  if (store.isReadOnly(data)) return;

  const { pageX, pageY } = e;

  store.menuVisible = true;
  store.menuLeft = pageX;
  store.menuTop = pageY;
  store.currentBookmark = data;
};

const onFlagClick = (data: IBookmark) => (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
  if (data._id) store.toggleFlag(data._id);
};

const onHandleMouseDown = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.stopPropagation();
};

const onHandleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.preventDefault();
  e.stopPropagation();
};

const onHandleDragStart = (data: IBookmark) => (
  e: React.DragEvent<HTMLButtonElement>,
) => {
  if (!store.canDragSortBookmarks || !data._id) {
    e.preventDefault();
    return;
  }

  e.stopPropagation();
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData(BOOKMARK_SORT_MIME, data._id);
  store.startBookmarkDrag(data._id);
};

const onHandleDragEnd = () => {
  store.clearBookmarkDrag();
};

const onCardDragOver = (data: IBookmark) => (
  e: React.DragEvent<HTMLDivElement>,
) => {
  if (!hasBookmarkSortDrag(e.dataTransfer) || !data._id) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  store.updateBookmarkDragTarget(data._id, getDropPosition(e));
};

const onCardDrop = (data: IBookmark) => (e: React.DragEvent<HTMLDivElement>) => {
  if (!hasBookmarkSortDrag(e.dataTransfer) || !data._id) return;
  e.preventDefault();
  e.stopPropagation();
  store.commitBookmarkDrag(data._id, getDropPosition(e));
};

const FlagCircleGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8"></circle>
  </svg>
);

const FolderGlyph = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M10 4l2 2h7a2 2 0 0 1 2 2v1H3V6a2 2 0 0 1 2-2h5zm11 7v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7h18z"></path>
  </svg>
);

const GlobeGlyph = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"></circle>
    <path d="M3 12h18"></path>
    <path d="M12 3a14.5 14.5 0 0 1 0 18 14.5 14.5 0 0 1 0-18"></path>
  </svg>
);

const PencilGlyph = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"></path>
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"></path>
  </svg>
);

const DotsGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="5" cy="12" r="1.8"></circle>
    <circle cx="12" cy="12" r="1.8"></circle>
    <circle cx="19" cy="12" r="1.8"></circle>
  </svg>
);

const DragGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <circle cx="5" cy="4" r="1.2"></circle>
    <circle cx="11" cy="4" r="1.2"></circle>
    <circle cx="5" cy="8" r="1.2"></circle>
    <circle cx="11" cy="8" r="1.2"></circle>
    <circle cx="5" cy="12" r="1.2"></circle>
    <circle cx="11" cy="12" r="1.2"></circle>
  </svg>
);

export const Bookmark = observer(({ data }: { data: IBookmark }) => {
  const selected = store.selectedItems.includes(data._id);
  const flagged = !!data._id && store.isFlagged(data._id);
  const flash = store.flashId === data._id;
  const sortable = store.canDragSortBookmarks;
  const dragging = store.draggedBookmarkId === data._id;
  const dropBefore =
    store.dragOverBookmarkId === data._id && store.dragPosition === 'before';
  const dropAfter =
    store.dragOverBookmarkId === data._id && store.dragPosition === 'after';

  let faviconUrl: string | undefined;

  if (!data.isFolder) {
    if (data.favicon) {
      faviconUrl = data.favicon.startsWith('data:')
        ? data.favicon
        : store.favicons.get(data.favicon);
    }

    if (!faviconUrl && data.url) {
      faviconUrl = getIconByUrlNet(data.url);
    }
  }

  return (
    <Card
      onContextMenu={onContextMenu(data)}
      onClick={onClick(data)}
      onDragOver={onCardDragOver(data)}
      onDrop={onCardDrop(data)}
      selected={selected}
      flash={flash}
      dragging={dragging}
      dropBefore={dropBefore}
      dropAfter={dropAfter}
      sortable={sortable}
      data-dragging={dragging ? 'true' : 'false'}
      data-bm-id={data._id}
    >
      <FlagToggle
        active={flagged}
        onClick={onFlagClick(data)}
        title={flagged ? '取消重点标记' : '重点标记'}
      >
        {!flagged && <FlagCircleGlyph />}
      </FlagToggle>
      {sortable && (
        <DragHandle
          draggable
          onMouseDown={onHandleMouseDown}
          onClick={onHandleClick}
          onDragStart={onHandleDragStart(data)}
          onDragEnd={onHandleDragEnd}
          title="拖拽排序"
        >
          <DragGlyph />
        </DragHandle>
      )}
      <IconBox>
        {data.isFolder ? (
          <FolderGlyph />
        ) : faviconUrl ? (
          <Favicon style={{ backgroundImage: `url(${faviconUrl})` }} />
        ) : (
          <GlobeGlyph />
        )}
      </IconBox>
      <Info>
        <TitleAction
          draggable={!data.isFolder && !!data.url}
          onClick={onTitleClick(data)}
          onDragStart={onTitleDragStart(data)}
        >
          {getBookmarkTitle(data)}
        </TitleAction>
        {!data.isFolder && <Site>{data.url}</Site>}
      </Info>
      {!data.static && !store.isReadOnly(data) && (
        <RowActions>
          <IconButton onClick={onEditClick(data)} title="编辑">
            <PencilGlyph />
          </IconButton>
          <IconButton onClick={onMoreClick(data)} title="更多">
            <DotsGlyph />
          </IconButton>
        </RowActions>
      )}
    </Card>
  );
});
