import * as React from 'react';
import { ipcRenderer } from 'electron';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { CaretDown, CaretRight } from '@phosphor-icons/react';

import store, { ROW_HEIGHT } from '../../store';
import { useI18n } from '~/renderer/components/I18n';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { getIconByUrlNet } from '~/utils/url';
import { IBookmark } from '~/interfaces';
import { logBookmarkHoverDebug } from '~/common/bookmark-hover-debug';
import {
  Backdrop,
  Panel,
  Columns,
  Column,
  Row,
  Favicon,
  Title,
  ScrollArrow,
  EmptyHint,
  TransparentBackground,
  SubPanel,
  RowTail,
  BarDropIndicator,
  DropIndicator,
} from './style';

const SUBMENU_OPEN_DELAY = 120;
const SUBMENU_CLOSE_DELAY = 140;
const DIALOG_CLOSE_DELAY = 160;
const LONG_PRESS_DELAY = 180;
const DRAG_THRESHOLD = 4;

type RowDropTarget = {
  itemId: string | null;
  parentId: string;
  position: 'before' | 'after' | 'inside' | 'end';
};

// 黄色文件夹图标(与书签栏 BookmarkBar/index.tsx 的 FolderIcon 一致)
const FolderIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="#FBC02D">
    <path d="M3.75 6.75A2.25 2.25 0 0 1 6 4.5h3.38c.6 0 1.17.24 1.59.66l1.12 1.12c.18.18.42.28.67.28H18a2.25 2.25 0 0 1 2.25 2.25v6.53A2.25 2.25 0 0 1 18 17.59H6a2.25 2.25 0 0 1-2.25-2.25V6.75Z" />
  </svg>
);

// 无法解析图标时的默认地球图标
const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="8.5" stroke="#5F6368" strokeWidth="1.6" />
    <path
      d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.4 3.5 8.5S14.3 18.1 12 20.5C9.7 18.1 8.5 15.1 8.5 12S9.7 5.9 12 3.5Z"
      stroke="#5F6368"
      strokeWidth="1.6"
    />
  </svg>
);

type RowItemProps = {
  b: IBookmark;
  level: number;
  scheduleOpenFolder: (folderId: string, rect: DOMRect, level: number) => void;
  toggleFolderNow: (folderId: string, rect: DOMRect, level: number) => void;
  closeFromLevel: (level: number) => void;
  scheduleCloseFromLevel: (level: number) => void;
  cancelCloseFromLevel: (level: number) => void;
  dragId: string | null;
  dropTarget: RowDropTarget | null;
  onPointerDown: (
    item: IBookmark,
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
  consumeDragClick: () => boolean;
};

const RowItem = observer(
  ({
    b,
    level,
    scheduleOpenFolder,
    toggleFolderNow,
    closeFromLevel,
    scheduleCloseFromLevel,
    cancelCloseFromLevel,
    dragId,
    dropTarget,
    onPointerDown,
    consumeDragClick,
  }: RowItemProps) => {
    const [iconFailed, setIconFailed] = React.useState(false);
    const isFolder = !!b.isFolder;
    const faviconSrc =
      !isFolder && !iconFailed
        ? b.favicon || (b.url ? getIconByUrlNet(b.url) : undefined)
        : undefined;

    const handleEnter = (e: React.MouseEvent<HTMLDivElement>) => {
      cancelCloseFromLevel(level);
      if (isFolder) {
        scheduleOpenFolder(
          b._id || '',
          e.currentTarget.getBoundingClientRect(),
          level,
        );
      } else {
        closeFromLevel(level);
      }
    };

    const handleLeave = () => {
      if (isFolder) scheduleCloseFromLevel(level);
    };

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (consumeDragClick()) return;
      if (isFolder) {
        toggleFolderNow(
          b._id || '',
          e.currentTarget.getBoundingClientRect(),
          level,
        );
      } else {
        store.openBookmark(b.url || '', e.ctrlKey || e.metaKey);
      }
    };

    const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      cancelCloseFromLevel(level);
      // 「其他书签」「移动书签」等静态根目录不可编辑/删除。
      if (b.static) return;
      store.showContextMenu(b);
    };

    // 悬停提示(与书签栏一致):书签显示「标题 + 网址」两行原生 tooltip;
    // 文件夹不显示(悬停即展开子菜单),拖拽期间隐藏。
    const url = b.url || '';
    const title = b.title || '';
    const hoverTitle =
      !isFolder && url && !dragId && !store.externalDragId
        ? title && title !== url
          ? `${title}\n${url}`
          : url
        : undefined;

    return (
      <Row
        title={hoverTitle}
        data-bookmark-row
        data-bookmark-id={b._id}
        data-parent-id={b.parent}
        data-static={b.static || undefined}
        data-drag-source={dragId === b._id ? 'true' : undefined}
        data-drop-position={
          dropTarget?.itemId === b._id ? dropTarget.position : undefined
        }
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onPointerDown={(event) => {
          if (!b.static) onPointerDown(b, event);
        }}
      >
        <Favicon>
          {isFolder ? (
            <FolderIcon />
          ) : faviconSrc ? (
            <img
              src={faviconSrc}
              width={16}
              height={16}
              draggable={false}
              onError={() => setIconFailed(true)}
            />
          ) : (
            <GlobeIcon />
          )}
        </Favicon>
        <Title>{b.title || ''}</Title>
        {isFolder && (
          <RowTail aria-hidden="true">
            <CaretRight size={14} weight="bold" />
          </RowTail>
        )}
      </Row>
    );
  },
);

type MenuColumnProps = {
  items: IBookmark[];
  overflow: boolean;
  rowLevel: number;
  showEmpty?: boolean;
  scheduleOpenFolder: (folderId: string, rect: DOMRect, level: number) => void;
  toggleFolderNow: (folderId: string, rect: DOMRect, level: number) => void;
  closeFromLevel: (level: number) => void;
  scheduleCloseFromLevel: (level: number) => void;
  cancelCloseFromLevel: (level: number) => void;
  parentId: string;
  dragId: string | null;
  dropTarget: RowDropTarget | null;
  onPointerDown: (
    item: IBookmark,
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
  consumeDragClick: () => boolean;
};

const MenuColumn = observer(
  ({
    items,
    overflow,
    rowLevel,
    showEmpty,
    scheduleOpenFolder,
    toggleFolderNow,
    closeFromLevel,
    scheduleCloseFromLevel,
    cancelCloseFromLevel,
    parentId,
    dragId,
    dropTarget,
    onPointerDown,
    consumeDragClick,
  }: MenuColumnProps) => {
    const t = useI18n();
    const colRef = React.useRef<HTMLDivElement>(null);
    const rafRef = React.useRef<number | null>(null);

    const cancelScroll = React.useCallback(() => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }, []);

    const startScroll = React.useCallback(() => {
      const el = colRef.current;
      if (!el) return;
      cancelScroll();
      const tick = () => {
        el.scrollTop += 5;
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }, [cancelScroll]);

    React.useEffect(() => () => cancelScroll(), [cancelScroll]);

    return (
      <Column
        overflow={overflow}
        ref={colRef}
        data-bookmark-column
        data-parent-id={parentId}
        data-row-level={rowLevel}
        data-scrollable={overflow ? 'true' : undefined}
      >
        {items.length === 0 && showEmpty && (
          <EmptyHint>{t('boEmpty')}</EmptyHint>
        )}
        {items.map((b) => (
          <RowItem
            key={b._id || `${rowLevel}-${b.title}-${b.url}`}
            b={b}
            level={rowLevel}
            scheduleOpenFolder={scheduleOpenFolder}
            toggleFolderNow={toggleFolderNow}
            closeFromLevel={closeFromLevel}
            scheduleCloseFromLevel={scheduleCloseFromLevel}
            cancelCloseFromLevel={cancelCloseFromLevel}
            dragId={dragId}
            dropTarget={dropTarget}
            onPointerDown={onPointerDown}
            consumeDragClick={consumeDragClick}
          />
        ))}
        {overflow && (
          <ScrollArrow onMouseEnter={startScroll} onMouseLeave={cancelScroll}>
            <CaretDown size={14} weight="bold" />
          </ScrollArrow>
        )}
      </Column>
    );
  },
);

export const App = observer(() => {
  const openTimerRef = React.useRef<number | null>(null);
  const closeTimersRef = React.useRef<Map<number, number>>(new Map());
  const dialogCloseTimerRef = React.useRef<number | null>(null);
  const longPressTimerRef = React.useRef<number | null>(null);
  const dragPreviewRef = React.useRef<HTMLElement | null>(null);
  const dragPreviewOffsetRef = React.useRef({ x: 0, y: 0 });
  const externalPreviewRef = React.useRef<HTMLElement | null>(null);
  const lastPointerRef = React.useRef({ x: 0, y: 0 });
  const dropEndedUntilRef = React.useRef(0);
  const dragInteractionRef = React.useRef<{
    item: IBookmark;
    source: HTMLElement;
    startX: number;
    startY: number;
    started: boolean;
  } | null>(null);
  const suppressDragClickRef = React.useRef(false);
  const suppressClickTimerRef = React.useRef<number | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<RowDropTarget | null>(
    null,
  );
  const lastBarAnchorLogRef = React.useRef('');
  const lastDragLogRef = React.useRef('');
  const dragHitTestRafRef = React.useRef<number | null>(null);
  const pendingHitPointRef = React.useRef<{ x: number; y: number } | null>(
    null,
  );
  const dialogVisible = store.visible;

  const clearLongPress = React.useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const removeDragPreview = React.useCallback(() => {
    dragPreviewRef.current?.remove();
    dragPreviewRef.current = null;
  }, []);

  const removeExternalPreview = React.useCallback(() => {
    externalPreviewRef.current?.remove();
    externalPreviewRef.current = null;
  }, []);

  const cancelScheduledDialogClose = React.useCallback(() => {
    if (dialogCloseTimerRef.current != null) {
      window.clearTimeout(dialogCloseTimerRef.current);
      dialogCloseTimerRef.current = null;
    }
  }, []);

  // A drag that started in the main window cannot use that window's preview:
  // the full-screen overflow BrowserView is above it in the compositor. Draw
  // a lightweight copy in this view so the pointer still has visible feedback
  // while it crosses an expanded folder menu.
  React.useEffect(() => {
    removeExternalPreview();
    if (dragInteractionRef.current || !store.externalDragId) return undefined;
    const item = store.getItem(store.externalDragId);
    if (!item) return undefined;
    dropEndedUntilRef.current = 0;
    logBookmarkHoverDebug('popup create external preview', {
      itemId: item._id,
      title: item.title,
    });
    const preview = document.createElement('div');
    preview.setAttribute('aria-hidden', 'true');
    Object.assign(preview.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      zIndex: '10000',
      minWidth: '34px',
      maxWidth: '180px',
      width: 'max-content',
      height: '26px',
      boxSizing: 'border-box',
      padding: '4px',
      margin: '0',
      display: 'flex',
      alignItems: 'center',
      borderRadius: '2px',
      background: 'transparent',
      color:
        store.theme['bookmark.textColor'] ||
        store.theme['addressbar.textColor'] ||
        '#161b2d',
      boxShadow: 'none',
      fontSize: '12px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      pointerEvents: 'none',
      opacity: '0.82',
      willChange: 'transform',
    });

    // Keep the cross-BrowserView preview visually equivalent to the clone
    // created by BookmarkBar. Building the two small nodes here also avoids
    // recreating the whole preview while the pointer is moving.
    const icon = document.createElement('span');
    Object.assign(icon.style, {
      width: '16px',
      height: '16px',
      marginLeft: '4px',
      marginRight: '4px',
      flex: '0 0 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });
    if (item.isFolder) {
      icon.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.75 6.75A2.25 2.25 0 0 1 6 4.5h3.38c.6 0 1.17.24 1.59.66l1.12 1.12c.18.18.42.28.67.28H18a2.25 2.25 0 0 1 2.25 2.25v6.53A2.25 2.25 0 0 1 18 17.59H6a2.25 2.25 0 0 1-2.25-2.25V6.75Z" fill="#FBC02D"/></svg>';
    } else if (item.favicon || item.url) {
      const image = document.createElement('img');
      image.width = 16;
      image.height = 16;
      image.draggable = false;
      image.src = item.favicon || getIconByUrlNet(item.url || '');
      image.style.display = 'block';
      icon.appendChild(image);
    }
    const title = document.createElement('span');
    title.textContent = item.title || item.url || '';
    Object.assign(title.style, {
      minWidth: '0',
      maxWidth: '150px',
      overflow: 'hidden',
      textOverflow: 'clip',
      paddingRight: '4px',
    });
    preview.append(icon, title);
    document.body.appendChild(preview);
    externalPreviewRef.current = preview;
    const previewVisibilityChannel = `bookmark-overflow-preview-visibility-${store.windowId}`;
    ipcRenderer.send(previewVisibilityChannel, true);
    preview.style.transform = `translate3d(${store.externalDragPoint.x + 8}px, ${
      store.externalDragPoint.y + 8
    }px, 0)`;
    return () => {
      ipcRenderer.send(previewVisibilityChannel, false);
      removeExternalPreview();
    };
  }, [
    removeExternalPreview,
    store.externalDragId,
  ]);

  React.useEffect(() => {
    const onExternalMove = (_event: unknown, x: number, y: number) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      lastPointerRef.current = { x, y };
      if (externalPreviewRef.current) {
        externalPreviewRef.current.style.transform = `translate3d(${x + 8}px, ${
          y + 8
        }px, 0)`;
      }
      // Native pointer events can stay attached to the source BrowserView
      // while the cursor crosses into this full-window view. Feed the same
      // coordinates through the normal pointermove path so drop indicators
      // are resolved even when Chromium does not retarget the event.
      try {
        window.dispatchEvent(
          new PointerEvent('pointermove', {
            clientX: x,
            clientY: y,
            bubbles: false,
            buttons: 1,
            pointerId: 1,
            pointerType: 'mouse',
          }),
        );
      } catch {
        // Older Electron builds may not expose PointerEvent in this view.
      }
    };
    ipcRenderer.on('bookmark-overflow-external-drag-move', onExternalMove);
    return () => {
      ipcRenderer.removeListener(
        'bookmark-overflow-external-drag-move',
        onExternalMove,
      );
    };
  }, []);

  const moveDragPreview = React.useCallback(
    (clientX: number, clientY: number) => {
      const preview = dragPreviewRef.current;
      if (!preview) return;
      const { x, y } = dragPreviewOffsetRef.current;
      preview.style.transform = `translate3d(${clientX - x}px, ${
        clientY - y
      }px, 0)`;
    },
    [],
  );

  const startDrag = React.useCallback(() => {
    const interaction = dragInteractionRef.current;
    if (!interaction || interaction.started || !interaction.item._id) return;
    interaction.started = true;
    clearLongPress();
    cancelScheduledDialogClose();
    ipcRenderer.send(
      `bookmark-overflow-drag-state-${store.windowId}`,
      interaction.item._id,
      true,
    );

    const rect = interaction.source.getBoundingClientRect();
    const computed = window.getComputedStyle(interaction.source);
    const preview = interaction.source.cloneNode(true) as HTMLElement;
    preview.removeAttribute('data-bookmark-row');
    preview.removeAttribute('data-bookmark-id');
    preview.removeAttribute('data-parent-id');
    preview.removeAttribute('data-drag-source');
    preview.removeAttribute('data-drop-position');
    preview.removeAttribute('title');
    preview.setAttribute('aria-hidden', 'true');
    preview.style.position = 'fixed';
    preview.style.left = '0';
    preview.style.top = '0';
    preview.style.zIndex = '10000';
    preview.style.width = `${rect.width}px`;
    preview.style.margin = '0';
    preview.style.pointerEvents = 'none';
    preview.style.opacity = '0.82';
    preview.style.color = computed.color;
    preview.style.fontFamily = computed.fontFamily;
    preview.style.backgroundColor = 'transparent';
    preview.style.boxShadow = 'none';
    preview.style.willChange = 'transform';
    dragPreviewOffsetRef.current = {
      x: interaction.startX - rect.left,
      y: interaction.startY - rect.top,
    };
    document.body.appendChild(preview);
    dragPreviewRef.current = preview;
    setDragId(interaction.item._id);
    moveDragPreview(interaction.startX, interaction.startY);
  }, [cancelScheduledDialogClose, clearLongPress, moveDragPreview]);

  const resolveDropTarget = React.useCallback(
    (clientX: number, clientY: number): RowDropTarget | null => {
      const source =
        dragInteractionRef.current?.item ||
        (store.externalDragId ? store.getItem(store.externalDragId) : null);
      if (!source?._id || !source.parent) return null;
      const hit = document.elementFromPoint(clientX, clientY) as HTMLElement;
      const row = hit?.closest('[data-bookmark-row]') as HTMLElement | null;
      if (row) {
        const itemId = row.dataset.bookmarkId || '';
        const target = store.getItem(itemId);
        if (!target?._id || !target.parent) return null;
        const rect = row.getBoundingClientRect();
        const inFolderCenter =
          target.isFolder &&
          clientY >= rect.top + 7 &&
          clientY <= rect.bottom - 7;
        if (inFolderCenter && store.canMoveToFolder(source._id, target._id)) {
          return {
            itemId: target._id,
            parentId: target.parent,
            position: 'inside',
          };
        }
        // A row in an expanded folder is a valid cross-parent insertion
        // target. The commit path moves the source into `target.parent`
        // before applying the before/after order.
        if (
          target.parent !== source.parent &&
          !store.canMoveToFolder(source._id, target.parent)
        )
          return null;
        return {
          itemId: target._id,
          parentId: target.parent,
          position: clientY < rect.top + rect.height / 2 ? 'before' : 'after',
        };
      }

      const column = hit?.closest(
        '[data-bookmark-column]',
      ) as HTMLElement | null;
      const parentId = column?.dataset.parentId;
      if (
        parentId &&
        (parentId === source.parent || store.canMoveToFolder(source._id, parentId))
      ) {
        // 静态根目录尾项(其他书签/移动书签)不是该列父级的子项,不能作插入锚点。
        const rows = Array.from(
          column.querySelectorAll(':scope > [data-bookmark-row]:not([data-static])'),
        ) as HTMLElement[];
        const lastItemId = rows[rows.length - 1]?.dataset.bookmarkId;
        if (lastItemId) {
          return {
            itemId: lastItemId,
            parentId,
            position: 'after',
          };
        }
        // Empty expanded folders still accept a drop at their end.
        return {
          itemId: null,
          parentId,
          position: 'end',
        };
      }
      // The transparent popup covers the bookmark bar while dragging. Use the
      // bar geometry supplied with the open payload to resolve cross-panel drops.
      const bar = store.barRect;
      const anchors = store.barDropAnchors || [];
      const barParent = store.barFolderId;
      if (
        bar &&
        barParent &&
        clientX >= bar.left &&
        clientX <= bar.right &&
        clientY >= bar.top &&
        clientY <= bar.bottom
      ) {
        const rowAnchors = anchors.filter(
          (item) => clientY >= item.top && clientY <= item.bottom,
        );
        const anchor = rowAnchors.find(
          (item) => clientX >= item.left && clientX <= item.right,
        );
        if (anchor) {
          const target = store.getItem(anchor.id);
          const inFolderCenter =
            !!target?.isFolder &&
            clientY >= anchor.top &&
            clientY <= anchor.bottom &&
            clientX >= anchor.left + 6 &&
            clientX <= anchor.right - 6;
          if (inFolderCenter && store.canMoveToFolder(source._id, anchor.id)) {
            return {
              itemId: anchor.id,
              parentId: barParent,
              position: 'inside',
            };
          }
          return {
            itemId: anchor.id,
            parentId: barParent,
            position: clientX < anchor.left + (anchor.right - anchor.left) / 2
              ? 'before'
              : 'after',
          };
        }
        // In the gaps between visible items, use the next item as the
        // insertion anchor. This preserves precise before/after placement.
        const next = rowAnchors.find(
          (item) => clientX < item.left + (item.right - item.left) / 2,
        );
        if (next) {
          return {
            itemId: next.id,
            parentId: barParent,
            position: 'before',
          };
        }
        const last = rowAnchors[rowAnchors.length - 1] || anchors[anchors.length - 1];
        return {
          itemId: last?.id || null,
          parentId: barParent,
          position: last ? 'after' : 'end',
        };
      }
      return null;
    },
    [],
  );

  const suppressNextClick = React.useCallback(() => {
    suppressDragClickRef.current = true;
    if (suppressClickTimerRef.current != null) {
      window.clearTimeout(suppressClickTimerRef.current);
    }
    suppressClickTimerRef.current = window.setTimeout(() => {
      suppressDragClickRef.current = false;
      suppressClickTimerRef.current = null;
    }, 250);
  }, []);

  const consumeDragClick = React.useCallback(() => {
    if (!suppressDragClickRef.current) return false;
    suppressDragClickRef.current = false;
    if (suppressClickTimerRef.current != null) {
      window.clearTimeout(suppressClickTimerRef.current);
      suppressClickTimerRef.current = null;
    }
    return true;
  }, []);

  const onRowPointerDown = React.useCallback(
    (item: IBookmark, event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !item._id) return;
      // A new pointer interaction supersedes any delayed synthetic click from
      // the previous drag.
      consumeDragClick();
      clearLongPress();
      dropEndedUntilRef.current = 0;
      dragInteractionRef.current = {
        item,
        source: event.currentTarget,
        startX: event.clientX,
        startY: event.clientY,
        started: false,
      };
      longPressTimerRef.current = window.setTimeout(
        startDrag,
        LONG_PRESS_DELAY,
      );
    },
    [clearLongPress, consumeDragClick, startDrag],
  );

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (Date.now() < dropEndedUntilRef.current) return;
      const interaction = dragInteractionRef.current;
      const externalId = store.externalDragId;
      if (!interaction && !externalId) return;
      if (interaction && !interaction.started) {
        const dx = event.clientX - interaction.startX;
        const dy = event.clientY - interaction.startY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
        startDrag();
      }
      if (interaction?.started) {
        cancelScheduledDialogClose();
        moveDragPreview(event.clientX, event.clientY);
      } else if (externalId) {
        // External drags (started in the main bookmark bar) can inherit a
        // mouseleave close timer from the panel they crossed.
        cancelScheduledDialogClose();
      }
      const sourceId = interaction?.item._id || externalId;
      if (!sourceId) return;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      if (externalId && !interaction?.started && externalPreviewRef.current) {
        externalPreviewRef.current.style.transform = `translate3d(${event.clientX + 8}px, ${
          event.clientY + 8
        }px, 0)`;
      }
      pendingHitPointRef.current = { x: event.clientX, y: event.clientY };
      if (dragHitTestRafRef.current !== null) return;
      dragHitTestRafRef.current = requestAnimationFrame(() => {
        dragHitTestRafRef.current = null;
        const point = pendingHitPointRef.current;
        pendingHitPointRef.current = null;
        if (!point) return;
        const currentInteraction = dragInteractionRef.current;
        const currentExternalId = store.externalDragId;
        const currentSourceId = currentInteraction?.item._id || currentExternalId;
        if (!currentSourceId) return;
        const target = resolveDropTarget(point.x, point.y);
        const dragKey = `${currentSourceId}:${target?.itemId || 'none'}:${
          target?.position || 'none'
        }`;
        if (lastDragLogRef.current !== dragKey) {
          lastDragLogRef.current = dragKey;
          setDropTarget(target);
          logBookmarkHoverDebug('popup drag-over', {
            sourceId: currentSourceId,
            point,
            target,
            external: !!currentExternalId,
          });
          ipcRenderer.send(
            `bookmark-overflow-drag-over-${store.windowId}`,
            currentSourceId,
            point.x,
            point.y,
          );
        }
      });
    };

    const finishPointer = (event: PointerEvent) => {
      if (dragHitTestRafRef.current !== null) {
        cancelAnimationFrame(dragHitTestRafRef.current);
        dragHitTestRafRef.current = null;
      }
      pendingHitPointRef.current = null;
      const interaction = dragInteractionRef.current;
      const externalId = store.externalDragId;
      if (!interaction && !externalId) return;
      clearLongPress();
      if (!externalId && !interaction?.started) {
        dragInteractionRef.current = null;
        return;
      }
      const sourceId = interaction?.item._id || externalId;
      logBookmarkHoverDebug('popup drag-end', {
        sourceId,
        type: event.type,
        point: { x: event.clientX, y: event.clientY },
        external: !!externalId,
      });
      const sourceItem = sourceId ? store.getItem(sourceId) : null;
      const target =
        event.type === 'pointerup' && sourceId
          ? resolveDropTarget(event.clientX, event.clientY)
          : null;
      const barRect = store.barRect;
      const overBar =
        !!barRect &&
        event.clientX >= barRect.left &&
        event.clientX <= barRect.right &&
        event.clientY >= barRect.top &&
        event.clientY <= barRect.bottom;
      let committed = false;
      if (event.type === 'pointerup' && sourceId && target && !overBar) {
        if (target.position === 'inside' && target.itemId) {
          committed = store.moveToFolder(sourceId, target.itemId);
        } else if (target.parentId && target.parentId !== sourceItem?.parent) {
          committed = store.moveToFolderAt(
            sourceId,
            target.parentId,
            target.itemId,
            target.position === 'inside' ? 'end' : target.position,
          );
        } else if (target.position !== 'inside') {
          committed = store.reorderItem(sourceId, target.itemId, target.position);
        }
      }
      logBookmarkHoverDebug('popup drop resolved', {
        sourceId,
        point: { x: event.clientX, y: event.clientY },
        target,
        overBar,
        committed,
      });
      // A drag may have started in the main bookmark bar. In that case this
      // view only receives the drag state through `externalDragId`, but the
      // browser still dispatches the synthetic click here after pointerup.
      // Suppress it just like an in-popup drag so dropping on a folder/empty
      // backdrop does not toggle or close the popup.
      if (interaction?.started || externalId) suppressNextClick();
      // If the pointer left the popup (or the drag originated in the main
      // bookmark bar), let the main renderer resolve the bookmark-bar slot.
      const localTarget = interaction
        ? resolveDropTarget(event.clientX, event.clientY)
        : null;
      if (event.type === 'pointerup' && sourceId && (overBar || !localTarget)) {
        ipcRenderer.send(
          `bookmark-overflow-drag-drop-${store.windowId}`,
          sourceId,
          event.clientX,
          event.clientY,
        );
      }
      if (sourceId) {
        ipcRenderer.send(
          `bookmark-overflow-drag-state-${store.windowId}`,
          sourceId,
          false,
        );
      }
      removeDragPreview();
      dragInteractionRef.current = null;
      setDragId(null);
      setDropTarget(null);
      lastDragLogRef.current = '';
      dropEndedUntilRef.current = Date.now() + 250;
    };

    // Losing focus is not equivalent to releasing the mouse. Cancel an
    // in-popup drag so it cannot commit an unintended move; external drags
    // are finalized by the main-process native mouse/blur handlers.
    const handleWindowBlur = () => {
      if (!dragInteractionRef.current) {
        if (store.externalDragId) {
          logBookmarkHoverDebug('popup drag-blur ignored for external drag', {
            sourceId: store.externalDragId,
          });
        }
        return;
      }
      const point = lastPointerRef.current;
      logBookmarkHoverDebug('popup drag-blur fallback', {
        sourceId: dragInteractionRef.current.item._id,
        point,
      });
      finishPointer({
        type: 'pointercancel',
        clientX: point.x,
        clientY: point.y,
      } as PointerEvent);
    };
    const handleNativeDrop = (
      _event: unknown,
      itemId: string,
      clientX: number,
      clientY: number,
    ) => {
      const externalId = store.externalDragId;
      if (!itemId || (externalId && itemId !== externalId)) return;
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
      logBookmarkHoverDebug('popup native drop', {
        sourceId: itemId,
        point: { x: clientX, y: clientY },
      });
      finishPointer({
        type: 'pointerup',
        clientX,
        clientY,
      } as PointerEvent);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishPointer);
    window.addEventListener('pointercancel', finishPointer);
    window.addEventListener('blur', handleWindowBlur);
    ipcRenderer.on('bookmark-overflow-native-drag-drop', handleNativeDrop);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishPointer);
      window.removeEventListener('pointercancel', finishPointer);
      window.removeEventListener('blur', handleWindowBlur);
      ipcRenderer.removeListener(
        'bookmark-overflow-native-drag-drop',
        handleNativeDrop,
      );
      clearLongPress();
      removeDragPreview();
      if (dragHitTestRafRef.current !== null) {
        cancelAnimationFrame(dragHitTestRafRef.current);
        dragHitTestRafRef.current = null;
      }
      pendingHitPointRef.current = null;
      if (suppressClickTimerRef.current != null) {
        window.clearTimeout(suppressClickTimerRef.current);
      }
    };
  }, [
    clearLongPress,
    cancelScheduledDialogClose,
    moveDragPreview,
    removeDragPreview,
    resolveDropTarget,
    startDrag,
    suppressNextClick,
  ]);

  React.useEffect(() => {
    if (dialogVisible) return;
    clearLongPress();
    removeDragPreview();
    dragInteractionRef.current = null;
    setDragId(null);
    setDropTarget(null);
    lastDragLogRef.current = '';
  }, [dialogVisible, clearLongPress, removeDragPreview]);

  const cancelScheduledOpen = React.useCallback(() => {
    if (openTimerRef.current != null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    const cancel = () => cancelScheduledDialogClose();
    ipcRenderer.on('bookmark-overflow-cancel-close', cancel);
    return () => {
      ipcRenderer.removeListener('bookmark-overflow-cancel-close', cancel);
    };
  }, [cancelScheduledDialogClose]);

  const scheduleDialogClose = React.useCallback(() => {
    // While a drag is active, crossing the panel boundary is expected. Do not
    // let the normal mouseleave close timer tear down the popup before the
    // drop has been committed. `dropEndedUntilRef` also covers the synthetic
    // mouseleave/click events emitted immediately after pointerup.
    if (dragInteractionRef.current?.started || store.externalDragId) {
      cancelScheduledDialogClose();
      return;
    }
    cancelScheduledDialogClose();
    logBookmarkHoverDebug('popup schedule close');
    const dropGrace = Math.max(0, dropEndedUntilRef.current - Date.now());
    dialogCloseTimerRef.current = window.setTimeout(() => {
      dialogCloseTimerRef.current = null;
      logBookmarkHoverDebug('popup close fired');
      store.backdropClick();
    }, DIALOG_CLOSE_DELAY + dropGrace);
  }, [cancelScheduledDialogClose]);

  const handleBackdropClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // A drop can land in the transparent area between rows/panels. The
      // resulting click must not be interpreted as a backdrop dismissal.
      if (consumeDragClick()) {
        event.stopPropagation();
        return;
      }
      // 悬停模式:浮层盖住了唤起按钮,点在按钮上等同点击按钮。
      const anchor = store.hoverAnchor;
      if (
        anchor &&
        event.clientX >= anchor.left &&
        event.clientX <= anchor.right &&
        event.clientY >= anchor.top &&
        event.clientY <= anchor.bottom
      ) {
        store.openAnchorUrl();
        return;
      }
      store.backdropClick();
    },
    [consumeDragClick],
  );

  const handleBackdropMouseDown = React.useCallback(() => {
    // A later, intentional click should not be swallowed by the previous
    // drag's suppression window.
    consumeDragClick();
  }, [consumeDragClick]);

  const cancelCloseFromLevel = React.useCallback((level: number) => {
    closeTimersRef.current.forEach((timer, timerLevel) => {
      if (timerLevel >= level) {
        window.clearTimeout(timer);
        closeTimersRef.current.delete(timerLevel);
      }
    });
  }, []);

  const closeFromLevel = React.useCallback(
    (level: number) => {
      cancelScheduledOpen();
      // While dragging, hovering a regular bookmark must not collapse the
      // submenu that contains the current drop target.
      if (
        dragInteractionRef.current?.started ||
        store.externalDragId
      ) {
        return;
      }
      cancelCloseFromLevel(level);
      store.closeSubmenusFrom(level);
    },
    [cancelCloseFromLevel, cancelScheduledOpen],
  );

  const scheduleCloseFromLevel = React.useCallback(
    (level: number) => {
      cancelScheduledOpen();
      cancelCloseFromLevel(level);
      // Folder menus are part of the drag destination. Keep them mounted
      // while the pointer crosses panel edges and through the immediate
      // post-drop mouseleave events.
      if (
        dragInteractionRef.current?.started ||
        store.externalDragId
      ) {
        return;
      }
      const timer = window.setTimeout(() => {
        closeTimersRef.current.delete(level);
        store.closeSubmenusFrom(level);
      }, SUBMENU_CLOSE_DELAY);
      closeTimersRef.current.set(level, timer);
    },
    [cancelCloseFromLevel, cancelScheduledOpen],
  );

  const toggleFolderNow = React.useCallback(
    (folderId: string, rect: DOMRect, level: number) => {
      cancelScheduledOpen();
      cancelCloseFromLevel(level);
      store.toggleFolder(folderId, rect, level);
    },
    [cancelCloseFromLevel, cancelScheduledOpen],
  );

  const scheduleOpenFolder = React.useCallback(
    (folderId: string, rect: DOMRect, level: number) => {
      cancelScheduledOpen();
      cancelCloseFromLevel(level);
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null;
        store.openFolder(folderId, rect, level);
      }, SUBMENU_OPEN_DELAY);
    },
    [cancelCloseFromLevel, cancelScheduledOpen],
  );

  // 键盘导航作用于指针最近进入的面板层级(根=1,子菜单=panel.level+1)。
  const activeLevelRef = React.useRef(1);

  // 浮层打开时不抢焦点;指针进入面板才向主进程要键盘焦点。
  const enterPanelLevel = React.useCallback((level: number) => {
    activeLevelRef.current = level;
    if (!document.hasFocus()) {
      ipcRenderer.send(`bookmark-overflow-focus-${store.windowId}`);
    }
  }, []);

  React.useEffect(() => {
    if (dialogVisible) activeLevelRef.current = 1;
  }, [dialogVisible, store.openSeq]);

  // Home/End 跳到当前层顶部(最早收集)/尾部(最新收集);PgUp/PgDn 按屏翻页。
  React.useEffect(() => {
    const findColumn = (level: number) => {
      if (level <= 1) {
        return (document.querySelector<HTMLElement>(
          '[data-bookmark-column][data-row-level="1"][data-scrollable]',
        ) ||
          document.querySelector<HTMLElement>(
            '[data-bookmark-column][data-row-level="1"]',
          ));
      }
      return document.querySelector<HTMLElement>(
        `[data-bookmark-column][data-row-level="${level}"]`,
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!store.visible) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (!['Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
      if (dragInteractionRef.current?.started || store.externalDragId) return;
      // 当前层的子菜单可能已被关闭,逐级回退到仍存在的最深层。
      let level = activeLevelRef.current;
      let column = findColumn(level);
      while (!column && level > 1) {
        level -= 1;
        column = findColumn(level);
      }
      if (!column) return;
      event.preventDefault();
      const page = Math.max(
        ROW_HEIGHT,
        Math.floor(column.clientHeight / ROW_HEIGHT) * ROW_HEIGHT - ROW_HEIGHT,
      );
      const before = column.scrollTop;
      if (event.key === 'Home') column.scrollTop = 0;
      else if (event.key === 'End') column.scrollTop = column.scrollHeight;
      else if (event.key === 'PageUp') column.scrollTop -= page;
      else column.scrollTop += page;
      // 行已滚走,收起挂在本层行旁的子菜单。
      if (column.scrollTop !== before) closeFromLevel(level);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeFromLevel]);

  // 悬停模式:指针停在 Backdrop 上(不在任何面板内)时,只要不在锚点按钮/过渡带
  // 内就安排关闭;回到锚点则撤销。已有计时器时不重置,避免持续移动永不关闭。
  const handleHoverModeBackdropMove = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!store.hoverAnchor || event.target !== event.currentTarget) return;
      if (dragInteractionRef.current?.started || store.externalDragId) return;
      if (store.isInHoverKeepZone(event.clientX, event.clientY)) {
        cancelScheduledDialogClose();
        cancelCloseFromLevel(1);
        return;
      }
      if (dialogCloseTimerRef.current == null) {
        scheduleDialogClose();
        scheduleCloseFromLevel(1);
      }
    },
    [
      cancelCloseFromLevel,
      cancelScheduledDialogClose,
      scheduleCloseFromLevel,
      scheduleDialogClose,
    ],
  );

  const handleBarFolderMouseMove = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      handleHoverModeBackdropMove(event);
      // Keep the source popup stable while a drag is in flight. The drop
      // resolver handles folder centers directly and the main renderer owns
      // bookmark-bar insertion slots.
      if (dragInteractionRef.current?.started || store.externalDragId) {
        // The pointer may still be over the bar anchor immediately after the
        // popup opens. Keep the dialog alive while dragging, but do not switch
        // to another top-level folder.
        cancelScheduledDialogClose();
        cancelCloseFromLevel(1);
        return;
      }
      const anchor = store.barFolderAnchors?.find(
        (item) =>
          event.clientX >= item.left &&
          event.clientX <= item.right &&
          event.clientY >= item.top &&
          event.clientY <= item.bottom,
      );
      if (!anchor) return;
      if (lastBarAnchorLogRef.current !== anchor.id) {
        lastBarAnchorLogRef.current = anchor.id;
        logBookmarkHoverDebug('popup bar anchor hit', {
          point: { x: event.clientX, y: event.clientY },
          anchor,
          currentFolder: store.rootFolderId,
        });
      }
      cancelScheduledDialogClose();
      cancelCloseFromLevel(1);
      store.hoverBarFolder(anchor.id, anchor);
    },
    [
      cancelCloseFromLevel,
      cancelScheduledDialogClose,
      handleHoverModeBackdropMove,
    ],
  );

  // 书签栏直接收到 B 的悬停时，主弹层可能已经因离开 A 的面板安排了关闭；
  // 新目录数据到达即代表切换成功，应撤销那次旧关闭。
  React.useEffect(() => {
    cancelScheduledDialogClose();
  }, [cancelScheduledDialogClose, store.rootFolderId]);

  // 冷创建 BrowserView 可能耗时较久;打开时指针若已离开锚点且不在面板内,直接收起。
  // 须声明在上面 rootFolderId 撤销关闭的 effect 之后,否则同一次提交里会被它撤销。
  React.useEffect(() => {
    const point = store.cursorPoint;
    if (!store.hoverAnchor || !point) return;
    if (store.isInHoverKeepZone(point.x, point.y)) return;
    const inPanel =
      point.x >= store.panelX &&
      point.x <= store.panelX + store.panelW &&
      point.y >= store.panelY &&
      point.y <= store.panelY + store.panelH;
    if (!inPanel) scheduleDialogClose();
  }, [scheduleDialogClose, store.openSeq]);

  React.useEffect(
    () => () => {
      cancelScheduledOpen();
      cancelScheduledDialogClose();
      closeTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      closeTimersRef.current.clear();
    },
    [cancelScheduledDialogClose, cancelScheduledOpen],
  );

  const { items, cols, rowsPerCol, overflow, submenuPanels } = store;
  const rootParentId =
    items.find((item) => item.parent)?.parent || store.rootFolderId || '';
  // 固定尾项(其他书签/移动书签)接在根目录书签之后一起分列。
  const rootItems = store.tailItems.length
    ? [...items, ...store.tailItems]
    : items;

  const columns: IBookmark[][] = [];
  for (let c = 0; c < cols; c++) {
    columns.push(
      c < cols - 1
        ? rootItems.slice(c * rowsPerCol, (c + 1) * rowsPerCol)
        : rootItems.slice(c * rowsPerCol),
    );
  }
  const lastIdx = Math.max(0, columns.length - 1);

  // The popup BrowserView covers the bookmark bar, so its insertion line must
  // be rendered in this view as well as in BookmarkBar.
  const barDropIndicator = (() => {
    const bar = store.barRect;
    const target = dropTarget;
    const point = lastPointerRef.current;
    if (
      !bar ||
      !target ||
      target.position === 'inside' ||
      point.x < bar.left ||
      point.x > bar.right ||
      point.y < bar.top ||
      point.y > bar.bottom
    ) {
      return null;
    }
    if (target.parentId !== store.barFolderId) return null;
    const anchors = store.barDropAnchors || [];
    const anchor = target.itemId
      ? anchors.find((item) => item.id === target.itemId)
      : undefined;
    const x = anchor
      ? target.position === 'before'
        ? anchor.left
        : anchor.right
      : anchors[anchors.length - 1]?.right ?? bar.right;
    return {
      left: x - 1,
      top: bar.top,
      height: Math.max(1, bar.bottom - bar.top),
    };
  })();

  const rowDropIndicator = (() => {
    const target = dropTarget;
    if (!target?.itemId || target.position === 'inside' || target.position === 'end') {
      return null;
    }
    const row = Array.from(
      document.querySelectorAll<HTMLElement>('[data-bookmark-row]'),
    ).find((element) => element.dataset.bookmarkId === target.itemId);
    if (!row) return null;
    const rect = row.getBoundingClientRect();
    return {
      left: rect.left + 8,
      top: (target.position === 'before' ? rect.top : rect.bottom) - 1,
      width: Math.max(1, rect.width - 16),
    };
  })();

  // 隐藏时不渲染面板,保证摘除 BrowserView 前合成的最后一帧是空白;
  // 否则下次挂载会先闪出上一次的列表,直到新 data 到达。
  if (!dialogVisible) {
    return (
      <ThemeProvider theme={{ ...store.theme }}>
        <UIStyle />
        <TransparentBackground />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <UIStyle />
      <TransparentBackground />
      <Backdrop
        onMouseDown={handleBackdropMouseDown}
        onClick={handleBackdropClick}
        onMouseEnter={handleBarFolderMouseMove}
        onMouseMove={handleBarFolderMouseMove}
        onMouseLeave={() => {
          // 悬停模式下指针直接从按钮移出窗口时,也要收起浮层。
          if (store.hoverAnchor) scheduleDialogClose();
        }}
      >
        <Panel
          style={{
            left: store.panelX,
            top: store.panelY,
            width: store.panelW,
            height: store.panelH,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          onMouseEnter={() => {
            cancelScheduledDialogClose();
            cancelCloseFromLevel(1);
            enterPanelLevel(1);
          }}
          onMouseLeave={() => {
            scheduleDialogClose();
            scheduleCloseFromLevel(1);
          }}
        >
          <Columns
            style={{
              flexDirection: store.reverseColumns ? 'row-reverse' : 'row',
            }}
          >
            {columns.map((col, ci) => {
              const isLast = ci === lastIdx;
              const colOverflow = isLast && overflow;
              return (
                <MenuColumn
                  key={ci}
                  items={col}
                  overflow={colOverflow}
                  rowLevel={1}
                  showEmpty={isLast}
                  scheduleOpenFolder={scheduleOpenFolder}
                  toggleFolderNow={toggleFolderNow}
                  closeFromLevel={closeFromLevel}
                  scheduleCloseFromLevel={scheduleCloseFromLevel}
                  cancelCloseFromLevel={cancelCloseFromLevel}
                  parentId={rootParentId}
                  dragId={dragId}
                  dropTarget={dropTarget}
                  onPointerDown={onRowPointerDown}
                  consumeDragClick={consumeDragClick}
                />
              );
            })}
          </Columns>
        </Panel>

        {submenuPanels.map((panel) => (
          <SubPanel
            key={`${panel.level}-${panel.folderId}`}
            style={{
              left: panel.left,
              top: panel.top,
              width: panel.width,
              height: panel.height,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            onMouseEnter={() => {
              cancelScheduledDialogClose();
              // 从父级菜单进入更深一层时，父级的 mouseleave 已经安排了
              // level 较低的关闭定时器；必须一并取消，避免子子菜单刚进入就消失。
              cancelCloseFromLevel(1);
              enterPanelLevel(panel.level + 1);
            }}
            onMouseLeave={() => {
              scheduleDialogClose();
              scheduleCloseFromLevel(panel.level);
            }}
          >
            <MenuColumn
              items={panel.items}
              overflow={panel.overflow}
              rowLevel={panel.level + 1}
              showEmpty
              scheduleOpenFolder={scheduleOpenFolder}
              toggleFolderNow={toggleFolderNow}
              closeFromLevel={closeFromLevel}
              scheduleCloseFromLevel={scheduleCloseFromLevel}
              cancelCloseFromLevel={cancelCloseFromLevel}
              parentId={panel.folderId}
              dragId={dragId}
              dropTarget={dropTarget}
              onPointerDown={onRowPointerDown}
              consumeDragClick={consumeDragClick}
            />
          </SubPanel>
        ))}
        {rowDropIndicator && <DropIndicator style={rowDropIndicator} />}
        {barDropIndicator && <BarDropIndicator style={barDropIndicator} />}
      </Backdrop>
    </ThemeProvider>
  );
});
