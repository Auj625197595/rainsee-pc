import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';

import store from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { getIconByUrlNet } from '~/utils/url';
import { IBookmark } from '~/interfaces';
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
        store.openBookmark(b.url || '');
      }
    };

    const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      cancelCloseFromLevel(level);
      store.showContextMenu(b);
    };

    return (
      <Row
        data-bookmark-row
        data-bookmark-id={b._id}
        data-parent-id={b.parent}
        data-drag-source={dragId === b._id ? 'true' : undefined}
        data-drop-position={
          dropTarget?.itemId === b._id ? dropTarget.position : undefined
        }
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onPointerDown={(event) => onPointerDown(b, event)}
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
        {isFolder && <RowTail>›</RowTail>}
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
      >
        {items.length === 0 && showEmpty && <EmptyHint>(空)</EmptyHint>}
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
            ▼
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

    const rect = interaction.source.getBoundingClientRect();
    const computed = window.getComputedStyle(interaction.source);
    const preview = interaction.source.cloneNode(true) as HTMLElement;
    preview.removeAttribute('data-bookmark-row');
    preview.removeAttribute('data-bookmark-id');
    preview.removeAttribute('data-parent-id');
    preview.removeAttribute('data-drag-source');
    preview.removeAttribute('data-drop-position');
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
  }, [clearLongPress, moveDragPreview]);

  const resolveDropTarget = React.useCallback(
    (clientX: number, clientY: number): RowDropTarget | null => {
      const source = dragInteractionRef.current?.item;
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
        if (target.parent !== source.parent) return null;
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
      if (parentId && parentId === source.parent) {
        const rows = Array.from(
          column.querySelectorAll(':scope > [data-bookmark-row]'),
        ) as HTMLElement[];
        const lastItemId = rows[rows.length - 1]?.dataset.bookmarkId;
        if (lastItemId) {
          return {
            itemId: lastItemId,
            parentId,
            position: 'after',
          };
        }
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
    }, 0);
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
      clearLongPress();
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
    [clearLongPress, startDrag],
  );

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const interaction = dragInteractionRef.current;
      if (!interaction) return;
      if (!interaction.started) {
        const dx = event.clientX - interaction.startX;
        const dy = event.clientY - interaction.startY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
        startDrag();
      }
      if (!dragInteractionRef.current?.started) return;
      moveDragPreview(event.clientX, event.clientY);
      setDropTarget(resolveDropTarget(event.clientX, event.clientY));
    };

    const finishPointer = (event: PointerEvent) => {
      const interaction = dragInteractionRef.current;
      if (!interaction) return;
      clearLongPress();
      if (interaction.started) {
        if (event.type === 'pointerup' && interaction.item._id) {
          const target = resolveDropTarget(event.clientX, event.clientY);
          if (target?.position === 'inside' && target.itemId) {
            store.moveToFolder(interaction.item._id, target.itemId);
          } else if (target && target.position !== 'inside') {
            store.reorderItem(
              interaction.item._id,
              target.itemId,
              target.position,
            );
          }
        }
        suppressNextClick();
      }
      removeDragPreview();
      dragInteractionRef.current = null;
      setDragId(null);
      setDropTarget(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishPointer);
    window.addEventListener('pointercancel', finishPointer);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishPointer);
      window.removeEventListener('pointercancel', finishPointer);
      clearLongPress();
      removeDragPreview();
      if (suppressClickTimerRef.current != null) {
        window.clearTimeout(suppressClickTimerRef.current);
      }
    };
  }, [
    clearLongPress,
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
  }, [dialogVisible, clearLongPress, removeDragPreview]);

  const cancelScheduledOpen = React.useCallback(() => {
    if (openTimerRef.current != null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const cancelScheduledDialogClose = React.useCallback(() => {
    if (dialogCloseTimerRef.current != null) {
      window.clearTimeout(dialogCloseTimerRef.current);
      dialogCloseTimerRef.current = null;
    }
  }, []);

  const scheduleDialogClose = React.useCallback(() => {
    cancelScheduledDialogClose();
    dialogCloseTimerRef.current = window.setTimeout(() => {
      dialogCloseTimerRef.current = null;
      store.backdropClick();
    }, DIALOG_CLOSE_DELAY);
  }, [cancelScheduledDialogClose]);

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
      cancelCloseFromLevel(level);
      store.closeSubmenusFrom(level);
    },
    [cancelCloseFromLevel, cancelScheduledOpen],
  );

  const scheduleCloseFromLevel = React.useCallback(
    (level: number) => {
      cancelScheduledOpen();
      cancelCloseFromLevel(level);
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
  const rootParentId = items.find((item) => item.parent)?.parent || '';

  const columns: IBookmark[][] = [];
  for (let c = 0; c < cols; c++) {
    columns.push(
      c < cols - 1
        ? items.slice(c * rowsPerCol, (c + 1) * rowsPerCol)
        : items.slice(c * rowsPerCol),
    );
  }
  const lastIdx = Math.max(0, columns.length - 1);

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <UIStyle />
      <TransparentBackground />
      <Backdrop onClick={store.backdropClick}>
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
      </Backdrop>
    </ThemeProvider>
  );
});
