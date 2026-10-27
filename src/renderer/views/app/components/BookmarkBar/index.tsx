import { ipcRenderer } from 'electron';
import * as React from 'react';
import { CaretRight } from '@phosphor-icons/react';
import store from '../../store';
import { getShellTranslator } from '../../utils/i18n';
import { observer } from 'mobx-react-lite';
import {
  BookmarkButton,
  BookmarkBar as StyledBookmarkBar,
  BookmarkDropIndicator,
  BookmarkSection,
  Favicon,
  Title,
  MibileBookmarkSection,
  MobileBookmarkIcon,
} from './style';
import { ToolbarButton } from '../ToolbarButton';
import { ICON_ALL } from '~/renderer/constants/icons';
import { getWebUIURL } from '~/common/webui';
import { getIconByUrlNet } from '~/utils/url';
import { IBookmark } from '~/interfaces';
import { getDraggedLinkData, isLinkDragEvent } from '../../utils/link-drop';
import { BookmarkDropTarget } from '../../store/bookmark-bar';
import {
  normalizeBookmarkBarDisplay,
  shouldShowBookmarkBar,
} from '~/common/bookmark-bar';
import { logBookmarkHoverDebug } from '~/common/bookmark-hover-debug';
import { isImmersiveHeaderWindow } from '../../utils/windows';

// 按下后位移超过此距离(px)才进入拖拽——对齐标签栏 mousedown→move 阈值,
// 消除原 350ms 长按死区(此前等待期内移动完全无响应)。纯点击(几乎不动)不触发拖拽,
// click 照常打开书签/进文件夹。
const ARM_THRESHOLD = 4;
// 文件夹悬停展开延迟。短暂停留不应打断长按拖拽,只有指针保持不动才展开。
const FOLDER_HOVER_DELAY = 400;

// Drop target objects contain a fresh indicator object on every hit-test.
// Compare only the values that affect rendering so pointermove does not cause
// a React update while the pointer remains in the same insertion slot.
const getDropTargetKey = (target: BookmarkDropTarget | null) => {
  if (!target) return 'none';
  const indicator = target.indicator;
  return `${target.parentId}:${target.insertIndex ?? 'folder'}:${
    indicator?.left ?? ''
  }:${indicator?.top ?? ''}:${indicator?.height ?? ''}`;
};

// 黄色文件夹图标
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

type BookmarkProps = {
  title: string;
  url: string;
  favicon?: string;
  isFolder: boolean;
  id: string;
  dragging: boolean;
  dropActive: boolean;
  // 书签栏整体处于拖拽排序中:此时悬停提示(title)需要隐藏,避免拖拽时弹出干扰气泡。
  barDragging: boolean;
  // 拖拽发生过为 true,Bookmark 用它在 click 里抑制误开标签,读后复位。
  dragOccurredRef: React.MutableRefObject<boolean>;
  onPointerDown: (id: string, e: React.PointerEvent<HTMLDivElement>) => void;
};

const Bookmark = observer(
  ({
    title,
    url,
    favicon,
    isFolder,
    id,
    dragging,
    dropActive,
    barDragging,
    dragOccurredRef,
    onPointerDown,
  }: BookmarkProps) => {
    const { buttonWidth } = store.bookmarksBar;
    const iconsOnly = store.settings.object.bookmarksBarIconsOnly;
    const [expandLeft, setExpandLeft] = React.useState(false);
    const folderHoverTimerRef = React.useRef<ReturnType<
      typeof setTimeout
    > | null>(null);
    const folderHoverPointRef = React.useRef<{ x: number; y: number } | null>(
      null,
    );

    const cancelFolderHoverExpand = React.useCallback(() => {
      if (folderHoverTimerRef.current !== null) {
        clearTimeout(folderHoverTimerRef.current);
        folderHoverTimerRef.current = null;
      }
      folderHoverPointRef.current = null;
    }, []);

    const scheduleFolderHoverExpand = React.useCallback(
      (target: HTMLDivElement, x: number, y: number) => {
        cancelFolderHoverExpand();
        folderHoverPointRef.current = { x, y };
        folderHoverTimerRef.current = setTimeout(() => {
          if (!folderHoverPointRef.current) return;
          folderHoverTimerRef.current = null;
          folderHoverPointRef.current = null;
          logBookmarkHoverDebug('bar delayed open fired', {
            id,
          });
          store.bookmarksBar.showFolderDropdown({ currentTarget: target }, id);
        }, FOLDER_HOVER_DELAY);
      },
      [cancelFolderHoverExpand, id],
    );

    React.useEffect(() => cancelFolderHoverExpand, [cancelFolderHoverExpand]);

    // 图标解析(与书签管理器一致):优先本地 favicon(data URL 或 http URL),
    // 缺失时走在线图标服务 getIconByUrlNet(url)。在线图标加载失败则回退地球图标。
    const [iconFailed, setIconFailed] = React.useState(false);
    const faviconSrc =
      !isFolder && !iconFailed
        ? favicon || (url ? getIconByUrlNet(url) : undefined)
        : undefined;

    function onClick(event: any) {
      cancelFolderHoverExpand();
      // 拖拽刚结束:抑制紧随其后的 click,避免松手时误开标签。
      if (dragOccurredRef.current) {
        dragOccurredRef.current = false;
        return;
      }
      if (url) {
        ipcRenderer.send(`add-tab-${store.windowId}`, {
          url,
          active: true,
        });
      } else {
        store.bookmarksBar.showFolderDropdown(event, id);
      }
    }

    function onContextMenu(event: any) {
      cancelFolderHoverExpand();
      event.preventDefault();
      event.stopPropagation();
      store.bookmarksBar.createContextMenu(event, id);
    }

    function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
      cancelFolderHoverExpand();
      // 仅左键触发拖拽;右键留给上下文菜单。
      if (event.button !== 0) return;
      onPointerDown(id, event);
    }

    function handleMouseEnter(event: React.MouseEvent<HTMLDivElement>) {
      if (isFolder) {
        logBookmarkHoverDebug('bar enter', {
          id,
          title,
          popupVisible:
            !!store.dialogsVisibility['bookmark-overflow'] ||
            store.bookmarksBar.folderPopupVisible,
          point: { x: event.clientX, y: event.clientY },
        });
      }
      // 文件夹只有在悬停一段时间且指针保持不动时才展开,避免拦截长按拖拽。
      if (isFolder) {
        // 弹窗已经打开时,从一个文件夹移到另一个文件夹属于明确的切换,
        // 不再重复执行首次进入时的防误触延迟。
        if (
          store.dialogsVisibility['bookmark-overflow'] ||
          store.bookmarksBar.folderPopupVisible
        ) {
          cancelFolderHoverExpand();
          logBookmarkHoverDebug('bar switch immediate', { id });
          store.bookmarksBar.showFolderDropdown(
            { currentTarget: event.currentTarget },
            id,
          );
        } else {
          scheduleFolderHoverExpand(
            event.currentTarget,
            event.clientX,
            event.clientY,
          );
        }
      }

      if (iconsOnly) {
        const section = event.currentTarget.closest(
          '[data-bookmark-section]',
        ) as HTMLElement | null;
        if (!section) return;

        const buttonRect = event.currentTarget.getBoundingClientRect();
        const sectionRect = section.getBoundingClientRect();
        const estimatedTitleWidth = Math.min(
          150,
          Math.max(24, title.length * 12),
        );
        setExpandLeft(
          sectionRect.right - buttonRect.right < estimatedTitleWidth,
        );
      }
    }

    function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
      if (!isFolder) return;
      const point = folderHoverPointRef.current;
      if (!point) return;
      if (event.clientX !== point.x || event.clientY !== point.y) {
        // 移动期间不展开,但在移动停止后重新开始等待,避免进入时的
        // 首个 mousemove 取消计时器后再也无法触发悬停菜单。
        scheduleFolderHoverExpand(
          event.currentTarget,
          event.clientX,
          event.clientY,
        );
      }
    }

    // 悬停提示(对齐 Chrome/Edge 书签栏):书签显示「标题 + 网址」两行原生 tooltip。
    // 原生 tooltip 是系统的弹出层,能盖在下层网页 BrowserView 之上;而 DOM 浮层
    // 会被页面视图遮挡。文件夹不显示——悬停展开的下拉菜单已承担说明职责,且
    // 避免与下拉浮层同时出现。拖拽排序期间一律隐藏。
    const hoverTitle = !isFolder && !barDragging && url
      ? title && title !== url
        ? `${title}\n${url}`
        : url
      : undefined;

    return (
      <BookmarkButton
        data-rainsee-part="bookmark-item"
        data-rainsee-kind={isFolder ? 'folder' : 'bookmark'}
        data-icons-only={iconsOnly ? 'true' : undefined}
        data-expand-left={iconsOnly && expandLeft ? 'true' : undefined}
        data-drop-active={dropActive ? 'true' : undefined}
        aria-label={iconsOnly ? title : undefined}
        title={hoverTitle}
        dense
        width={buttonWidth}
        dragging={dragging}
        data-id={id}
        theme={store.theme}
        toggled={false}
        disabled={false}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={cancelFolderHoverExpand}
        onMouseMove={handleMouseMove}
        onContextMenu={onContextMenu}
        onPointerDown={handlePointerDown}
      >
        <Favicon data-rainsee-part="bookmark-icon">
          {isFolder ? (
            <FolderIcon />
          ) : faviconSrc ? (
            <img
              src={faviconSrc}
              width={16}
              height={16}
              draggable={false}
              style={{ display: 'block' }}
              onError={() => setIconFailed(true)}
            />
          ) : (
            <GlobeIcon />
          )}
        </Favicon>
        <Title data-rainsee-part="bookmark-title">{title}</Title>
      </BookmarkButton>
    );
  },
);

export const BookmarkBar = observer(() => {
  const { bookmarkBarItems: list, showOverflow } = store.bookmarksBar;
  const overflowIconColor =
    store.theme['bookmark.textColor'] ||
    store.theme['addressbar.textColor'] ||
    (store.theme['toolbar.lightForeground'] ? '#fff' : '#161b2d');
  const bookmarkBarDisplay = normalizeBookmarkBarDisplay(
    store.settings.object.bookmarksBarDisplay,
    store.settings.object.bookmarksBar,
  );
  const newTabUrl = React.useMemo(
    () => getWebUIURL('newtab'),
    [store.settings.object.newtab],
  );
  const selectedUrl = store.tabs.selectedTab?.url || '';
  const bookmarkBarVisible = React.useMemo(() => {
    const visible = shouldShowBookmarkBar(
      bookmarkBarDisplay,
      selectedUrl,
      newTabUrl,
    );
    // The immersive mirror can render a frame before its first tab snapshot
    // arrives. Keep the bar mounted during that short gap so its data load
    // and height measurement are ready when the header opens.
    return (
      visible ||
      (isImmersiveHeaderWindow() &&
        !selectedUrl &&
        bookmarkBarDisplay !== 'never')
    );
  }, [bookmarkBarDisplay, selectedUrl, newTabUrl]);

  // dragId / order 既有 state(驱动渲染)又有 ref(window 监听闭包内读取最新值,避免 stale)。
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [order, setOrder] = React.useState<string[] | null>(null);
  const dragIdRef = React.useRef<string | null>(null);
  const orderRef = React.useRef<string[] | null>(null);
  const sectionRef = React.useRef<HTMLDivElement>(null);
  const dragOccurredRef = React.useRef(false);
  // 按下点(arm):仅记录起始 id+坐标,位移过阈值后才升级为拖拽。
  const armedRef = React.useRef<{ id: string; x: number; y: number } | null>(
    null,
  );
  // 拖拽虚影独立挂到 body，书签栏中的原项始终留在原位置。
  const dragPreviewRef = React.useRef<HTMLElement | null>(null);
  const dragPreviewOffsetRef = React.useRef({ x: 0, y: 0 });
  const externalPreviewVisibleRef = React.useRef(false);
  const ignorePopupOverUntilRef = React.useRef(0);
  const [dropTarget, setDropTarget] = React.useState<BookmarkDropTarget | null>(
    null,
  );
  const dropTargetKeyRef = React.useRef('none');
  const dropTargetRafRef = React.useRef<number | null>(null);
  const pendingDropPointRef = React.useRef<{ x: number; y: number } | null>(
    null,
  );
  const lastDropLogRef = React.useRef('');

  // The overflow menu lives in a separate BrowserView. During a drag it
  // reports pointer coordinates back through the main process so this window
  // can resolve the real bookmark-bar insertion slot.
  React.useEffect(() => {
    const overChannel = `bookmark-overflow-drag-over-${store.windowId}`;
    const dropChannel = `bookmark-overflow-drag-drop-${store.windowId}`;
    const cancelChannel = `bookmark-overflow-drag-cancel-${store.windowId}`;
    const previewVisibilityChannel = 'bookmark-bar-preview-visibility';
    const onOver = (_event: unknown, id: string, x: number, y: number) => {
      if (!id) return;
      if (Date.now() < ignorePopupOverUntilRef.current) return;
      const target = store.bookmarksBar.getDropTargetAtPoint(x, y);
      const key = `${id}:${target?.parentId || 'none'}:${
        target?.insertIndex ?? 'folder'
      }`;
      if (lastDropLogRef.current !== key) {
        lastDropLogRef.current = key;
        const targetKey = getDropTargetKey(target);
        if (dropTargetKeyRef.current !== targetKey) {
          dropTargetKeyRef.current = targetKey;
          setDropTarget(target);
        }
        logBookmarkHoverDebug('bar received popup drag-over', {
          id,
          point: { x, y },
          target,
        });
      }
    };
    const onDrop = (_event: unknown, id: string, x: number, y: number) => {
      if (!id) return;
      const target = store.bookmarksBar.getDropTargetAtPoint(x, y);
      logBookmarkHoverDebug('bar received popup drag-drop', {
        id,
        point: { x, y },
        target,
      });
      dropTargetKeyRef.current = 'none';
      setDropTarget(null);
      lastDropLogRef.current = '';
      ignorePopupOverUntilRef.current = Date.now() + 250;
      if (!target) {
        logBookmarkHoverDebug('bar drag-drop ignored', {
          id,
          reason: 'no-target',
        });
        return;
      }
      if (
        target.insertIndex === undefined &&
        store.bookmarksBar.moveItemToFolder(id, target.parentId)
      ) {
        ipcRenderer.send(
          `bookmark-overflow-move-committed-${store.windowId}`,
          id,
          target.parentId,
        );
        logBookmarkHoverDebug('bar drag-drop committed', {
          id,
          mode: 'folder',
          target,
        });
        return;
      }
      if (target.insertIndex != null) {
        const committed = store.bookmarksBar.moveItemToDropTarget(id, target);
        logBookmarkHoverDebug('bar drag-drop committed', {
          id,
          mode: 'insert',
          target,
          committed,
        });
      }
    };
    const onCancel = () => {
      lastDropLogRef.current = '';
      ignorePopupOverUntilRef.current = Date.now() + 250;
      dropTargetKeyRef.current = 'none';
      setDropTarget(null);
    };
    const onPreviewVisibility = (_event: unknown, visible: boolean) => {
      externalPreviewVisibleRef.current = visible === true;
      if (dragPreviewRef.current) {
        dragPreviewRef.current.style.visibility = visible
          ? 'hidden'
          : 'visible';
      }
    };
    ipcRenderer.on(overChannel, onOver);
    ipcRenderer.on(dropChannel, onDrop);
    ipcRenderer.on(cancelChannel, onCancel);
    ipcRenderer.on(previewVisibilityChannel, onPreviewVisibility);
    return () => {
      ipcRenderer.removeListener(overChannel, onOver);
      ipcRenderer.removeListener(dropChannel, onDrop);
      ipcRenderer.removeListener(cancelChannel, onCancel);
      ipcRenderer.removeListener(previewVisibilityChannel, onPreviewVisibility);
    };
  }, []);

  const updateDropTarget = React.useCallback(
    (clientX: number, clientY: number) => {
      const target = store.bookmarksBar.getDropTargetAtPoint(clientX, clientY);
      const key = getDropTargetKey(target);
      if (dropTargetKeyRef.current !== key) {
        dropTargetKeyRef.current = key;
        setDropTarget(target);
      }
      return target;
    },
    [],
  );

  // Hit-testing reads layout for every bookmark. Keep the drag preview
  // pointer-driven, but coalesce expensive drop-target reads to one per
  // animation frame.
  const scheduleDropTargetUpdate = React.useCallback(
    (
      clientX: number,
      clientY: number,
      afterUpdate?: (target: BookmarkDropTarget | null) => void,
    ) => {
      pendingDropPointRef.current = { x: clientX, y: clientY };
      if (dropTargetRafRef.current !== null) return;
      dropTargetRafRef.current = requestAnimationFrame(() => {
        dropTargetRafRef.current = null;
        const point = pendingDropPointRef.current;
        pendingDropPointRef.current = null;
        const target = point ? updateDropTarget(point.x, point.y) : null;
        afterUpdate?.(target);
      });
    },
    [updateDropTarget],
  );

  const cancelDropTargetUpdate = React.useCallback(() => {
    if (dropTargetRafRef.current !== null) {
      cancelAnimationFrame(dropTargetRafRef.current);
      dropTargetRafRef.current = null;
    }
    pendingDropPointRef.current = null;
  }, []);

  const onExternalDragOver = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const sidebarTab = store.tabs.getTabById(store.tabs.sidebarDragId);
      if (!sidebarTab && !isLinkDragEvent(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      scheduleDropTargetUpdate(e.clientX, e.clientY);
    },
    [scheduleDropTargetUpdate],
  );

  const onExternalDragLeave = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node))
        return;
      dropTargetKeyRef.current = 'none';
      setDropTarget(null);
    },
    [],
  );

  const onExternalDrop = React.useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      const sidebarTab = store.tabs.getTabById(store.tabs.sidebarDragId);
      const link = sidebarTab
        ? {
            url: sidebarTab.url,
            title: sidebarTab.title,
            favicon: sidebarTab.favicon,
          }
        : getDraggedLinkData(e.dataTransfer);
      e.preventDefault();
      e.stopPropagation();
      cancelDropTargetUpdate();
      const target = updateDropTarget(e.clientX, e.clientY);
      dropTargetKeyRef.current = 'none';
      setDropTarget(null);
      if (!link) return;
      store.tabs.clearSidebarDrag();
      if (!target) return;
      await store.bookmarksBar.addDroppedBookmark(link, target);
    },
    [cancelDropTargetUpdate, updateDropTarget],
  );

  // 顶部标签页采用 mousemove 拖拽而非 HTML5 DragEvent，这里只负责同步投放高亮；
  // 实际松手提交在 TabsStore.onMouseUp 中完成，以便先于“撕离标签页”逻辑处理。
  React.useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const tab = store.tabs.selectedTab;
      if (!store.tabs.isDragging || !tab?.isDragging) return;
      scheduleDropTargetUpdate(e.clientX, e.clientY);
    };
    const clear = () => {
      dropTargetKeyRef.current = 'none';
      setDropTarget(null);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', clear);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', clear);
    };
  }, [scheduleDropTargetUpdate]);

  const setDragIdBoth = React.useCallback((v: string | null) => {
    dragIdRef.current = v;
    setDragId(v);
  }, []);
  const setOrderBoth = React.useCallback((v: string[] | null) => {
    orderRef.current = v;
    setOrder(v);
  }, []);

  // 当前被拖项 DOM。
  const getDraggedEl = React.useCallback((): HTMLElement | null => {
    const id = dragIdRef.current;
    const section = sectionRef.current;
    if (!id || !section) return null;
    const el = Array.from(section.children).find(
      (c) => (c as HTMLElement).dataset.id === id,
    ) as HTMLElement | undefined;
    return el ?? null;
  }, []);

  const removeDragPreview = React.useCallback(() => {
    dragPreviewRef.current?.remove();
    dragPreviewRef.current = null;
    externalPreviewVisibleRef.current = false;
  }, []);

  const createDragPreview = React.useCallback(
    (clientX: number, clientY: number) => {
      removeDragPreview();
      const source = getDraggedEl();
      if (!source) return;

      const rect = source.getBoundingClientRect();
      const computed = window.getComputedStyle(source);
      const preview = source.cloneNode(true) as HTMLElement;
      preview.removeAttribute('data-id');
      preview.removeAttribute('data-rainsee-part');
      preview.removeAttribute('data-drop-active');
      preview.setAttribute('aria-hidden', 'true');
      preview.style.position = 'fixed';
      preview.style.left = '0';
      preview.style.top = '0';
      preview.style.zIndex = '10000';
      preview.style.width = `${rect.width}px`;
      preview.style.maxWidth = 'none';
      preview.style.margin = '0';
      preview.style.pointerEvents = 'none';
      preview.style.opacity = '0.82';
      preview.style.visibility = externalPreviewVisibleRef.current
        ? 'hidden'
        : 'visible';
      preview.style.color = computed.color;
      preview.style.fontFamily = computed.fontFamily;
      preview.style.backgroundColor = 'transparent';
      preview.style.boxShadow = 'none';
      preview.style.willChange = 'transform';

      dragPreviewOffsetRef.current = {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
      document.body.appendChild(preview);
      dragPreviewRef.current = preview;
    },
    [getDraggedEl, removeDragPreview],
  );

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

  const onWinPointerMove = React.useCallback(
    (e: PointerEvent) => {
      // 1) 位移阈值判定进入拖拽(对齐标签栏:按下后移动足够才升级,纯点击不触发)
      const armed = armedRef.current;
      if (armed && !dragIdRef.current) {
        const dx = e.clientX - armed.x;
        const dy = e.clientY - armed.y;
        if (dx * dx + dy * dy < ARM_THRESHOLD * ARM_THRESHOLD) return;
        dragOccurredRef.current = true;
        logBookmarkHoverDebug('bar drag-start', {
          id: armed.id,
          point: { x: e.clientX, y: e.clientY },
          popupVisible: store.bookmarksBar.folderPopupVisible,
        });
        const ids = store.bookmarksBar.bookmarkBarItems.map((b) => b._id);
        setOrderBoth(ids);
        setDragIdBoth(armed.id);
        createDragPreview(armed.x, armed.y);
        ipcRenderer.send(
          `bookmark-overflow-drag-state-${store.windowId}`,
          armed.id,
          true,
        );
      }

      const id = dragIdRef.current;
      if (!id) return;
      moveDragPreview(e.clientX, e.clientY);

      // 文件夹中心区域是“移入”落点；边缘区域仍按普通插入槽位参与排序。
      scheduleDropTargetUpdate(e.clientX, e.clientY, (drop) => {
        if (
          drop &&
          drop.insertIndex === undefined &&
          !store.bookmarksBar.canMoveItemToFolder(id, drop.parentId)
        ) {
          dropTargetKeyRef.current = 'none';
          setDropTarget(null);
        }
      });
    },
    [
      createDragPreview,
      moveDragPreview,
      setDragIdBoth,
      setOrderBoth,
      scheduleDropTargetUpdate,
    ],
  );

  const onWinPointerUp = React.useCallback(
    (e: PointerEvent) => {
      cancelDropTargetUpdate();
      armedRef.current = null;

      window.removeEventListener('pointermove', onWinPointerMove);
      window.removeEventListener('pointerup', onWinPointerUp);
      window.removeEventListener('pointercancel', onWinPointerUp);

      const hadDrag = dragOccurredRef.current;
      const id = dragIdRef.current;
      logBookmarkHoverDebug('bar drag-end', {
        id,
        type: e.type,
        point: { x: e.clientX, y: e.clientY },
        hadDrag,
      });
      const finalTarget =
        e.type === 'pointerup' && id
          ? store.bookmarksBar.getDropTargetAtPoint(e.clientX, e.clientY)
          : null;
      removeDragPreview();
      lastDropLogRef.current = '';
      if (id) {
        ipcRenderer.send(
          `bookmark-overflow-drag-source-end-${store.windowId}`,
          id,
          false,
        );
      }

      // pointercancel 只收尾不提交；正常松手命中文件夹中心时优先执行“移入”，
      // 否则根据最终插入线一次性生成新顺序。
      if (
        id &&
        finalTarget &&
        finalTarget.insertIndex === undefined &&
        store.bookmarksBar.moveItemToFolder(id, finalTarget.parentId)
      ) {
        dropTargetKeyRef.current = 'none';
        setDropTarget(null);
        setDragIdBoth(null);
        setOrderBoth(null);
        return;
      }

      setDragIdBoth(null);
      dropTargetKeyRef.current = 'none';
      setDropTarget(null);

      const currentOrder = orderRef.current;
      if (
        hadDrag &&
        id &&
        currentOrder &&
        currentOrder.length > 1 &&
        finalTarget?.insertIndex != null
      ) {
        const from = currentOrder.indexOf(id);
        if (from >= 0) {
          const next = currentOrder.slice();
          next.splice(from, 1);
          const adjustedIndex =
            from < finalTarget.insertIndex
              ? finalTarget.insertIndex - 1
              : finalTarget.insertIndex;
          next.splice(Math.max(0, Math.min(adjustedIndex, next.length)), 0, id);
          if (next.join(' ') !== currentOrder.join(' ')) {
            // 松手后立即切到最终顺序，并保留到 store 重载完成，避免视觉回退。
            setOrderBoth(next);
            store.bookmarksBar.reorder(next);
            return;
          }
        }
      }
      if (hadDrag) {
        // 拖出书签栏、取消或净位置未变。
        if (currentOrder) {
          setOrderBoth(null);
          return;
        }
      }
      setOrderBoth(null);
    },
    [
      cancelDropTargetUpdate,
      onWinPointerMove,
      removeDragPreview,
      setDragIdBoth,
      setOrderBoth,
    ],
  );

  const onItemPointerDown = React.useCallback(
    (id: string, e: React.PointerEvent<HTMLDivElement>) => {
      dragOccurredRef.current = false;
      armedRef.current = { id, x: e.clientX, y: e.clientY };
      window.addEventListener('pointermove', onWinPointerMove);
      window.addEventListener('pointerup', onWinPointerUp);
      window.addEventListener('pointercancel', onWinPointerUp);
    },
    [onWinPointerMove, onWinPointerUp],
  );

  // 卸载清理:避免监听残留。
  React.useEffect(
    () => () => {
      armedRef.current = null;
      removeDragPreview();
      window.removeEventListener('pointermove', onWinPointerMove);
      window.removeEventListener('pointerup', onWinPointerUp);
      window.removeEventListener('pointercancel', onWinPointerUp);
      cancelDropTargetUpdate();
    },
    [
      cancelDropTargetUpdate,
      onWinPointerMove,
      onWinPointerUp,
      removeDragPreview,
    ],
  );

  // 书签栏可见性、展示目录或行数变化时(含设置页跨窗口改行数触发的 update-settings 广播、
  // 以及刚开启书签栏 section 挂载后),用 section 实测宽度重新拆分可见项/溢出项。
  React.useEffect(() => {
    store.bookmarksBar.setBookmarkBarItems();
  }, [
    bookmarkBarVisible,
    store.settings.object.bookmarksBarFolderId,
    store.settings.object.bookmarksBarIconsOnly,
    store.settings.object.bookmarksBarRows,
  ]);

  // 真实监听书签区宽度变化:窗口 resize 之外,更多按钮显隐/布局切换/容器重排
  // 也会改变 section 宽度。仅靠 window.resize 可能拿不到最终宽度,这里补一层
  // ResizeObserver,让 overflow 拆分跟随真实可用宽度重算。
  React.useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof ResizeObserver === 'undefined') return;

    let rafId = 0;
    let lastWidth = Math.round(section.getBoundingClientRect().width);
    const schedule = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        store.bookmarksBar.setBookmarkBarItems();
      });
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextWidth = Math.round(entry.contentRect.width);
      if (nextWidth === lastWidth) return;
      lastWidth = nextWidth;
      schedule();
    });

    observer.observe(section);
    return () => {
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [
    bookmarkBarVisible,
    store.settings.object.bookmarksBarFolderId,
    store.settings.object.bookmarksBarIconsOnly,
    store.settings.object.bookmarksBarRows,
  ]);

  // 修正估算拆分的裁切:setBookmarkBarItems 按字符数估算按钮宽度,中文/宽字符标题
  // 实际更宽,估算偏乐观会把 CSS 装不下的项也塞进 bookmarkBarItems——它们被
  // BookmarkSection 的 overflow:hidden + max-height 裁切,既不可见、又不在溢出菜单,
  // 表现为"书签栏最后一个可见项"与"溢出菜单第一项"之间缺失若干。这里在渲染后实测
  // 各按钮 offsetTop,把超出可见行的尾部项下沉到 overflowItems(经 refitOverflow),
  // 使两者首尾相接。useLayoutEffect 在绘制前同步执行,无闪烁。
  const measuredRows = store.settings.object.bookmarksBarRows || 1;
  // 防止"上调→下沉"死循环:用 (main 书签总数, section 宽度, 行数) 组合作 key,
  // 同一组状态只 promote 一次。resize / 增删书签会改变其中任一项 → 自动重试。
  const promoteKeyRef = React.useRef('');
  React.useLayoutEffect(() => {
    if (dragId) return; // 拖拽中不修正,避免干扰排序
    const section = sectionRef.current;
    if (!section) return;
    // 与 BookmarkSection 的 CSS max-height 一致:行高 26px(dense) + 行间 gap 4px
    const maxH = measuredRows * 26 + (measuredRows - 1) * 4;
    const sectionRect = section.getBoundingClientRect();
    const children = Array.from(section.children) as HTMLElement[];
    if (children.length === 0) return;
    // 第一个 offsetTop 越过可见区域的按钮 = 被裁切的开始;之前的都可见
    let visibleCount = children.length;
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      // offsetTop 覆盖换行/纵向裁切; right 越界覆盖某些内核在
      // flex-wrap 计算延迟时仍停留在首行的情况,避免漏掉不可见书签。
      if (
        children[i].offsetTop >= maxH ||
        rect.right > sectionRect.right + 1 ||
        rect.left < sectionRect.left - 1
      ) {
        visibleCount = i;
        break;
      }
    }
    // 下沉:有裁切 → 超出可见行的尾部项移到溢出菜单(修正估算偏乐观,如中文短标题)
    if (visibleCount < children.length) {
      store.bookmarksBar.refitOverflow(visibleCount);
      return;
    }
    // 上调:无裁切但溢出菜单还有项 → 估算偏悲观(英文/数字短标题)把本该可见的项推进了
    // overflowItems,书签栏右侧留白没铺满。把 overflowItems 全部并回 bookmarkBarItems,
    // 下一轮本 effect 会按实测重新下沉到刚好铺满。promoteKey 防止"并回→下沉"反复。
    if (store.bookmarksBar.overflowItems.length > 0) {
      const sectionWidth = Math.round(section.getBoundingClientRect().width);
      const totalMain = visibleCount + store.bookmarksBar.overflowItems.length;
      const key = `${totalMain}-${sectionWidth}-${measuredRows}-${
        store.settings.object.bookmarksBarIconsOnly ? 'icons' : 'titles'
      }`;
      if (promoteKeyRef.current !== key) {
        promoteKeyRef.current = key;
        store.bookmarksBar.promoteOverflow();
      }
    }
  }, [
    list,
    measuredRows,
    dragId,
    order,
    store.settings.object.bookmarksBarIconsOnly,
    store.settings.object.bookmarksBarFolderId,
  ]);

  // 防回退闪烁:提交后保留本地 order,等 store 重载到提交顺序后安全切回 list 渲染。
  // - 顺序完全一致 → 切回(无视觉变化)。
  // - 可见项集合变了(增删致本地顺序过期)→ 切回。
  // - 同集合但顺序仍不同(store 尚未重载完成)→ 继续等待。
  React.useEffect(() => {
    const local = orderRef.current;
    if (!local) return;
    const cur = store.bookmarksBar.bookmarkBarItems.map((b) => b._id);
    const sameOrder = cur.join(' ') === local.join(' ');
    const setChanged =
      cur.slice().sort().join(' ') !== local.slice().sort().join(' ');
    if (sameOrder || setChanged) {
      setOrderBoth(null);
    }
  }, [store.bookmarksBar.bookmarkBarItems, setOrderBoth]);

  // 渲染顺序:拖拽中用本地 order,否则用 store 顺序。
  const items: IBookmark[] = order
    ? (order
        .map((id) => list.find((b) => b._id === id))
        .filter(Boolean) as IBookmark[])
    : list;

  return bookmarkBarVisible ? (
    <StyledBookmarkBar
      data-rainsee-part="bookmark-bar"
      data-drop-active={
        dropTarget && !dropTarget.indicator ? 'true' : undefined
      }
      onDragOver={onExternalDragOver}
      onDragLeave={onExternalDragLeave}
      onDrop={onExternalDrop}
      onContextMenu={(event) => {
        event.preventDefault();
        store.bookmarksBar.createContextMenu(event);
      }}
    >
      <BookmarkSection
        ref={sectionRef}
        rows={store.settings.object.bookmarksBarRows || 1}
        dragging={!!dragId}
        data-bookmark-section
      >
        {items.map(({ title, url, favicon, _id, isFolder }: IBookmark) => (
          <Bookmark
            key={_id}
            id={_id}
            title={title}
            url={url}
            favicon={favicon}
            isFolder={isFolder}
            dragging={dragId === _id}
            dropActive={isFolder && dropTarget?.parentId === _id}
            barDragging={!!dragId}
            dragOccurredRef={dragOccurredRef}
            onPointerDown={onItemPointerDown}
          />
        ))}
      </BookmarkSection>
      {dropTarget?.indicator && (
        <BookmarkDropIndicator
          style={{
            left: dropTarget.indicator.left,
            top: dropTarget.indicator.top,
            height: dropTarget.indicator.height,
          }}
        />
      )}
      {store.bookmarksBar.hasOverflow && (
        <ToolbarButton
          rainseeAction="bookmark-overflow"
          icon={CaretRight}
          size={16}
          iconColor={overflowIconColor}
          iconWeight="bold"
          autoInvert={false}
          onClick={showOverflow}
        />
      )}
      <MibileBookmarkSection
        data-icons-only={
          store.settings.object.bookmarksBarIconsOnly ? 'true' : undefined
        }
        data-rainsee-action="open-bookmarks"
        aria-label={
          store.settings.object.bookmarksBarIconsOnly
            ? getShellTranslator()('shellAllBookmarks')
            : undefined
        }
        onClick={() => {
          ipcRenderer.send(`add-tab-${store.windowId}`, {
            url: getWebUIURL('bookmarks'),
            active: true,
          });
        }}
      >
        <MobileBookmarkIcon src={ICON_ALL} alt="" draggable={false} />
        <div>{getShellTranslator()('mgFilterAll')}</div>
      </MibileBookmarkSection>
    </StyledBookmarkBar>
  ) : null;
});
