import { ipcRenderer } from 'electron';
import { observable, makeObservable, toJS } from 'mobx';
import { DialogStore } from '~/models/dialog-store';
import { IBookmark } from '~/interfaces';
import {
  snapshotBookmarkForIpc,
  snapshotBookmarksForIpc,
} from '~/renderer/utils/bookmark-ipc';
import { logBookmarkHoverDebug } from '~/common/bookmark-hover-debug';

const COL_WIDTH = 240;
export const ROW_HEIGHT = 30;
const PANEL_PADDING = 8;
const EDGE_GAP = 8;
const SUBMENU_GAP = 6;
const BOTTOM_RESERVE = 12;

// 主进程 relayout 后下发的布局数据。渲染页据此切列渲染 + 定位 Panel。
export interface OverflowPayload {
  items: IBookmark[];
  allItems: IBookmark[];
  cols: number;
  rowsPerCol: number;
  overflow: boolean; // 最左(末)列是否需要内部滚动
  reverseColumns: boolean;
  panelX: number; // Panel 左上角窗口坐标 + 尺寸(absolute 定位)
  panelY: number;
  panelW: number;
  panelH: number;
  rootFolderId?: string;
  barFolderAnchors?: Array<{
    id: string;
    left: number;
    right: number;
    top: number;
    bottom: number;
  }>;
  barDropAnchors?: Array<{
    id: string;
    left: number;
    right: number;
    top: number;
    bottom: number;
    index: number;
    parentId: string;
    isFolder?: boolean;
  }>;
  barRect?: { left: number; right: number; top: number; bottom: number };
  barFolderId?: string;
  externalDragId?: string;
  externalDragPoint?: { x: number; y: number };
  tailItems?: IBookmark[];
  hoverAnchor?: HoverAnchor;
  anchorClickUrl?: string;
  cursorPoint?: { x: number; y: number };
}

export type HoverAnchor = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export interface SubmenuPanelState {
  folderId: string;
  items: IBookmark[];
  left: number;
  top: number;
  width: number;
  height: number;
  overflow: boolean;
  level: number;
}

export class Store extends DialogStore {
  public items: IBookmark[] = [];
  public allItems: IBookmark[] = [];
  public cols = 1;
  public rowsPerCol = 1;
  public overflow = false;
  public reverseColumns = true;
  public panelX = 0;
  public panelY = 0;
  public panelW = 0;
  public panelH = 0;
  public rootFolderId = '';
  private overflowParentId = '';
  private overflowItemIds = new Set<string>();
  public barFolderAnchors: OverflowPayload['barFolderAnchors'] = [];
  public barDropAnchors: OverflowPayload['barDropAnchors'] = [];
  // Explicit initializer keeps the field present at runtime for MobX
  // makeObservable (a type-only declaration is erased by TypeScript).
  public barRect: OverflowPayload['barRect'] = undefined;
  public barFolderId = '';
  private hoveredBarFolderId = '';
  public submenuPanels: SubmenuPanelState[] = [];
  // Source id for a drag that started in the main bookmark bar. The popup is
  // a separate BrowserView, so it receives this state through the main process.
  public externalDragId = '';
  public externalDragPoint = { x: 0, y: 0 };
  // 根列表末尾的固定项(地址栏书签按钮浮层里的「其他书签」「移动书签」)。
  public tailItems: IBookmark[] = [];
  // 悬停唤起模式的锚点按钮矩形;为空表示普通(点击关闭)模式。
  public hoverAnchor: HoverAnchor | null = null;
  public anchorClickUrl = '';
  // 每次 data 到达自增,供组件在打开后按 cursorPoint 判断是否需要立即收起。
  public openSeq = 0;
  public cursorPoint: { x: number; y: number } | null = null;
  private reloadTimer: number | null = null;

  public constructor() {
    // persistent:常驻复用秒开。
    // hideOnBlur:false:全屏 Backdrop 已捕获点击关闭,blur 关闭多余。
    // 关闭统一靠 Backdrop 点击 / 切标签(hideAllPersistent)/ 窗口 resize/move / Esc。
    // visibilityWrapper:false:自己监听 'visible'(主进程 hide 时下发 false)。
    super({ persistent: true, hideOnBlur: false, visibilityWrapper: false });

    makeObservable(this, {
      items: observable,
      allItems: observable,
      cols: observable,
      rowsPerCol: observable,
      overflow: observable,
      reverseColumns: observable,
      panelX: observable,
      panelY: observable,
      panelW: observable,
      panelH: observable,
      rootFolderId: observable,
      barFolderAnchors: observable,
      barDropAnchors: observable,
      barRect: observable,
      barFolderId: observable,
      submenuPanels: observable,
      externalDragId: observable,
      externalDragPoint: observable,
      tailItems: observable,
      hoverAnchor: observable,
      anchorClickUrl: observable,
      openSeq: observable,
    });

    ipcRenderer.on('visible', (e, flag: boolean) => {
      this.visible = flag;
      if (!flag) {
        // 常驻视图复用同一份 DOM:关闭时清空本次内容,避免下次打开(如先悬停
        // 地址栏书签按钮、再悬停书签栏文件夹)先闪出上一次的列表。
        this.resetContent();
        this.externalDragId = '';
        if (this.reloadTimer !== null) {
          window.clearTimeout(this.reloadTimer);
          this.reloadTimer = null;
        }
      }
    });

    ipcRenderer.on(
      'bookmark-overflow-external-drag',
      (_e, itemId: string, x?: number, y?: number) => {
        logBookmarkHoverDebug('popup external drag state', {
          itemId: itemId || '',
          visible: this.visible,
        });
        this.externalDragId = itemId || '';
        if (Number.isFinite(x) && Number.isFinite(y)) {
          this.externalDragPoint = { x: x as number, y: y as number };
        }
      },
    );
    ipcRenderer.on(
      'bookmark-overflow-move-committed',
      (_e, itemId: string, folderId: string) => {
        const applied = this.applyExternalMove(itemId, folderId);
        logBookmarkHoverDebug('popup external move applied', {
          itemId,
          folderId,
          applied,
        });
      },
    );

    ipcRenderer.on('data', (e, p: OverflowPayload) => {
      this.items = p.items || [];
      this.allItems = p.allItems || [];
      this.cols = p.cols;
      this.rowsPerCol = p.rowsPerCol;
      this.overflow = p.overflow;
      this.reverseColumns = p.reverseColumns !== false;
      this.panelX = p.panelX;
      this.panelY = p.panelY;
      this.panelW = p.panelW;
      this.panelH = p.panelH;
      this.rootFolderId = p.rootFolderId || '';
      this.overflowParentId =
        this.rootFolderId ||
        p.items?.find((item) => item.parent)?.parent ||
        p.barFolderId ||
        '';
      this.overflowItemIds = new Set(
        !this.rootFolderId
          ? (p.items || [])
              .map((item) => item._id)
              .filter((id): id is string => Boolean(id))
          : [],
      );
      this.barFolderAnchors = p.barFolderAnchors || [];
      this.barDropAnchors = p.barDropAnchors || [];
      this.barRect = p.barRect;
      this.barFolderId = p.barFolderId || '';
      // Carry a drag that started before this popup was created.
      this.externalDragId = p.externalDragId || '';
      this.externalDragPoint = p.externalDragPoint || { x: 0, y: 0 };
      this.hoveredBarFolderId = this.rootFolderId;
      this.tailItems = p.tailItems || [];
      this.hoverAnchor = p.hoverAnchor || null;
      this.anchorClickUrl = p.anchorClickUrl || '';
      this.cursorPoint = p.cursorPoint || null;
      this.openSeq += 1;
      logBookmarkHoverDebug('popup data', {
        rootFolderId: this.rootFolderId,
        itemCount: this.items.length,
        anchorCount: this.barFolderAnchors.length,
        barFolderAnchors: this.barFolderAnchors,
        externalDragId: this.externalDragId,
      });
      this.clearSubmenus();
      this.refreshRenderedItems();
      this.visible = true;
    });

    // Esc 关闭浮层
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeAll();
    });
  }

  // 打开网页书签:新建标签 + 关闭浮层。
  // background=true(Ctrl/⌘+点击):后台新标签打开且浮层保持,便于连续打开多个书签。
  // 后台标签不会触发 select(),故不会经 hideAllPersistent 把浮层关掉。
  public openBookmark(url: string, background = false) {
    if (!url) return;
    ipcRenderer.send(`add-tab-${this.windowId}`, { url, active: !background });
    if (!background) this.closeAll();
  }

  // 悬停模式:浮层盖住了唤起按钮,点击按钮区域等同点击按钮本身。
  public openAnchorUrl() {
    if (this.anchorClickUrl) {
      ipcRenderer.send(`add-tab-${this.windowId}`, {
        url: this.anchorClickUrl,
        active: true,
      });
    }
    this.closeAll();
  }

  // 指针是否位于锚点按钮或按钮与面板之间的过渡带内。
  public isInHoverKeepZone(x: number, y: number) {
    const anchor = this.hoverAnchor;
    if (!anchor) return false;
    const bottom = Math.max(anchor.bottom, this.panelY + 2);
    return x >= anchor.left && x <= anchor.right && y >= anchor.top && y <= bottom;
  }

  // 右键书签项 → 复用书签栏的「编辑/删除」原生菜单。
  // 主进程用 ipcMain.handle 注册,故须用 invoke；发送前只保留可克隆字段。
  public showContextMenu(item: IBookmark) {
    void ipcRenderer
      .invoke(
        `show-bookmarks-bar-context-menu-${this.windowId}`,
        snapshotBookmarkForIpc(item),
        'bar',
      )
      .catch((error) =>
        console.error('[bookmarks] open context menu failed', error),
      );
  }

  public getChildren(folderId: string) {
    return this.allItems
      .filter(
        ({ static: staticName, parent }) => !staticName && parent === folderId,
      )
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  public getItem(id: string) {
    return this.allItems.find((item) => item._id === id);
  }

  public canMoveToFolder(id: string, folderId: string) {
    const item = this.getItem(id);
    const folder = this.getItem(folderId);
    if (
      !item ||
      !folder?.isFolder ||
      id === folderId ||
      item.parent === folderId
    ) {
      return false;
    }

    // 文件夹不能移入自己的后代。
    if (item.isFolder) {
      let current: IBookmark | undefined = folder;
      const visited = new Set<string>();
      while (current?.parent && !visited.has(current._id || '')) {
        if (current.parent === id) return false;
        if (current._id) visited.add(current._id);
        current = this.getItem(current.parent);
      }
    }
    return true;
  }

  private refreshRenderedItems() {
    const order = new Map(
      this.allItems.map((item, index) => [item._id || '', index]),
    );
    this.items = this.items
      .slice()
      .sort(
        (a, b) => (order.get(a._id || '') ?? 0) - (order.get(b._id || '') ?? 0),
      );
    const maxRowsByWindow = Math.max(
      1,
      Math.floor(
        (window.innerHeight - BOTTOM_RESERVE - PANEL_PADDING * 2) / ROW_HEIGHT,
      ),
    );
    // The root panel dimensions come from the initial main-process layout.
    // Moving a bookmark into the open folder can add rows afterwards, so
    // remeasure the single-column panel and enable scrolling at the viewport
    // limit instead of leaving the new row clipped by the old height.
    if (this.cols === 1) {
      const maxHeight = Math.max(
        ROW_HEIGHT + PANEL_PADDING * 2,
        window.innerHeight - this.panelY - BOTTOM_RESERVE,
      );
      const rootMaxRows = Math.max(
        1,
        Math.floor((maxHeight - PANEL_PADDING * 2) / ROW_HEIGHT),
      );
      const rowCount = Math.max(1, this.items.length + this.tailItems.length);
      const visibleRows = Math.min(rowCount, rootMaxRows);
      this.panelH = Math.min(
        maxHeight,
        visibleRows * ROW_HEIGHT + PANEL_PADDING * 2,
      );
      this.overflow = rowCount > rootMaxRows;
    }
    const maxRows = Math.max(
      1,
      Math.min(this.rowsPerCol || 1, maxRowsByWindow),
    );
    this.submenuPanels = this.submenuPanels.map((panel) => {
      const items = this.getChildren(panel.folderId);
      const visibleRows = Math.max(1, Math.min(items.length || 1, maxRows));
      const height = visibleRows * ROW_HEIGHT + PANEL_PADDING * 2;
      const maxTop = Math.max(
        EDGE_GAP,
        window.innerHeight - height - BOTTOM_RESERVE,
      );
      return {
        ...panel,
        items,
        height,
        overflow: items.length > maxRows,
        top: Math.max(EDGE_GAP, Math.min(panel.top, maxTop)),
      };
    });
  }

  public reorderItem(
    id: string,
    targetId: string | null,
    position: 'before' | 'after' | 'end',
  ) {
    const item = this.getItem(id);
    if (!item?.parent) return false;

    const siblings = this.getChildren(item.parent);
    const from = siblings.findIndex((sibling) => sibling._id === id);
    if (from < 0) return false;

    const next = siblings.slice();
    next.splice(from, 1);
    let insertIndex = next.length;
    if (position !== 'end' && targetId) {
      const targetIndex = next.findIndex((sibling) => sibling._id === targetId);
      if (targetIndex < 0) return false;
      insertIndex = targetIndex + (position === 'after' ? 1 : 0);
    }
    next.splice(insertIndex, 0, item);

    const orderedIds = next
      .map((sibling) => sibling._id)
      .filter((siblingId): siblingId is string => !!siblingId);
    const currentIds = siblings
      .map((sibling) => sibling._id)
      .filter((siblingId): siblingId is string => !!siblingId);
    if (orderedIds.join(' ') === currentIds.join(' ')) return false;

    const start = siblings.reduce(
      (min, sibling) => Math.min(min, sibling.order ?? 0),
      Infinity,
    );
    const base = Number.isFinite(start) ? start : 0;
    const orderById = new Map(
      orderedIds.map((siblingId, index) => [siblingId, base + index]),
    );
    this.allItems = this.allItems
      .map((bookmark) =>
        bookmark.parent === item.parent && bookmark._id
          ? { ...bookmark, order: orderById.get(bookmark._id) }
          : bookmark,
      )
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    this.refreshRenderedItems();
    ipcRenderer.send('bookmarks-reorder', item.parent, orderedIds);
    return true;
  }

  public moveToFolder(id: string, folderId: string) {
    if (!this.canMoveToFolder(id, folderId)) return false;
    const item = this.getItem(id);
    if (!item) return false;
    const children = this.getChildren(folderId);
    const nextOrder =
      children.reduce((max, child) => Math.max(max, child.order ?? 0), -1) + 1;

    this.allItems = this.allItems.map((bookmark) => {
      if (bookmark._id === id) {
        return { ...bookmark, parent: folderId, order: nextOrder };
      }
      if (bookmark._id === item.parent && bookmark.children?.includes(id)) {
        return {
          ...bookmark,
          children: bookmark.children.filter((childId) => childId !== id),
        };
      }
      if (bookmark._id === folderId) {
        return {
          ...bookmark,
          children: bookmark.children?.includes(id)
            ? bookmark.children
            : [...(bookmark.children || []), id],
        };
      }
      return bookmark;
    });
    if (!this.rootFolderId) {
      if (folderId === this.overflowParentId) {
        this.overflowItemIds.add(id);
      } else {
        this.overflowItemIds.delete(id);
      }
    }
    // 根面板只包含本次打开目录的直属项；移入子文件夹后应立即从根面板移除。
    this.items = this.items.filter((bookmark) => bookmark._id !== id);
    if (this.rootFolderId === folderId) {
      this.items = this.getChildren(folderId);
    }
    const movedPanelIndex = this.submenuPanels.findIndex(
      (panel) => panel.folderId === id,
    );
    if (movedPanelIndex >= 0) {
      this.submenuPanels = this.submenuPanels.slice(0, movedPanelIndex);
    }
    this.refreshRenderedItems();

    ipcRenderer.send('bookmarks-update', id, {
      parent: folderId,
      order: nextOrder,
    });
    this.scheduleBookmarkReload();
    return true;
  }

  // Reflect a move committed by the main bookmark-bar renderer without
  // sending a second persistence request from this popup.
  public applyExternalMove(id: string, folderId: string) {
    const item = this.getItem(id);
    if (!item) return false;
    if (item.parent === folderId) {
      if (!this.rootFolderId && folderId === this.overflowParentId) {
        this.overflowItemIds.add(id);
        if (!this.items.some((bookmark) => bookmark._id === id)) {
          this.items = [...this.items, item];
        }
      }
      this.refreshRenderedItems();
      this.scheduleBookmarkReload();
      return true;
    }
    if (!this.canMoveToFolder(id, folderId)) return false;
    const children = this.getChildren(folderId);
    const nextOrder =
      children.reduce((max, child) => Math.max(max, child.order ?? 0), -1) + 1;
    this.allItems = this.allItems.map((bookmark) => {
      if (bookmark._id === id) {
        return {...bookmark, parent: folderId, order: nextOrder};
      }
      if (bookmark._id === item.parent) {
        return {
          ...bookmark,
          children: (bookmark.children || []).filter((childId) => childId !== id),
        };
      }
      if (bookmark._id === folderId) {
        return {
          ...bookmark,
          children: bookmark.children?.includes(id)
            ? bookmark.children
            : [...(bookmark.children || []), id],
        };
      }
      return bookmark;
    });
    if (!this.rootFolderId) {
      if (folderId === this.overflowParentId) {
        this.overflowItemIds.add(id);
      } else {
        this.overflowItemIds.delete(id);
      }
    }
    this.items = this.items.filter((bookmark) => bookmark._id !== id);
    if (this.rootFolderId === folderId) {
      this.items = this.getChildren(folderId);
    }
    this.refreshRenderedItems();
    this.scheduleBookmarkReload();
    return true;
  }

  /** Move an item to another parent and place it beside a specific bar item. */
  public moveToFolderAt(
    id: string,
    folderId: string,
    targetId: string | null,
    position: 'before' | 'after' | 'end',
  ) {
    const item = this.getItem(id);
    if (!item) return false;
    if (item.parent === folderId) {
      return this.reorderItem(id, targetId, position);
    }
    if (!this.canMoveToFolder(id, folderId)) return false;

    const destination = this.getChildren(folderId).filter(
      (child) => child._id !== id,
    );
    let insertIndex = destination.length;
    if (position !== 'end' && targetId) {
      const targetIndex = destination.findIndex(
        (child) => child._id === targetId,
      );
      if (targetIndex < 0) return false;
      insertIndex = targetIndex + (position === 'after' ? 1 : 0);
    }
    destination.splice(insertIndex, 0, item);
    const orderedIds = destination
      .map((child) => child._id)
      .filter((childId): childId is string => !!childId);
    const previousParent = item.parent;
    const destinationFolder = this.getItem(folderId);
    const previousFolder = previousParent ? this.getItem(previousParent) : null;
    const baseOrder = destination.reduce(
      (min, child) => Math.min(min, child.order ?? 0),
      Infinity,
    );
    const startOrder = Number.isFinite(baseOrder) ? baseOrder : 0;
    const orderById = new Map(
      orderedIds.map((childId, index) => [childId, startOrder + index]),
    );

    this.allItems = this.allItems.map((bookmark) => {
      if (bookmark._id === id) {
        return {
          ...bookmark,
          parent: folderId,
          order: orderById.get(id) ?? startOrder + insertIndex,
        };
      }
      if (previousFolder && bookmark._id === previousFolder._id) {
        return {
          ...bookmark,
          children: (bookmark.children || []).filter((childId) => childId !== id),
        };
      }
      if (destinationFolder && bookmark._id === destinationFolder._id) {
        return {
          ...bookmark,
          children: [
            ...orderedIds,
            ...(bookmark.children || []).filter(
              (childId) => !orderedIds.includes(childId) && childId !== id,
            ),
          ],
        };
      }
      if (bookmark.parent === folderId && bookmark._id) {
        const nextOrder = orderById.get(bookmark._id);
        return nextOrder == null ? bookmark : {...bookmark, order: nextOrder};
      }
      return bookmark;
    });
    this.refreshRenderedItems();
    ipcRenderer.send('bookmarks-move', id, folderId, toJS(orderedIds));
    this.scheduleBookmarkReload();
    return true;
  }

  private scheduleBookmarkReload() {
    if (this.reloadTimer !== null) window.clearTimeout(this.reloadTimer);
    this.reloadTimer = window.setTimeout(() => {
      this.reloadTimer = null;
      void ipcRenderer
        .invoke('bookmarks-get')
        .then((bookmarks: IBookmark[]) => {
          if (!Array.isArray(bookmarks)) return;
          this.allItems = bookmarks;
          if (this.rootFolderId) {
            this.items = this.getChildren(this.rootFolderId);
          } else {
            this.items = bookmarks.filter(
              (bookmark) =>
                !!bookmark._id &&
                this.overflowItemIds.has(bookmark._id) &&
                (!this.overflowParentId || bookmark.parent === this.overflowParentId),
            );
          }
          this.refreshRenderedItems();
          logBookmarkHoverDebug('popup bookmarks reloaded after move', {
            rootFolderId: this.rootFolderId,
            itemCount: this.items.length,
            panelCount: this.submenuPanels.length,
          });
        })
        .catch(() => {
          // The window may be closing while the persistence snapshot is read.
        });
    }, 250);
  }

  private buildSubmenuPanel(
    folderId: string,
    rect: DOMRect,
    level: number,
  ): SubmenuPanelState {
    const items = this.getChildren(folderId);
    const maxRowsByWindow = Math.max(
      1,
      Math.floor(
        (window.innerHeight - BOTTOM_RESERVE - PANEL_PADDING * 2) / ROW_HEIGHT,
      ),
    );
    const maxRows = Math.max(
      1,
      Math.min(this.rowsPerCol || 1, maxRowsByWindow),
    );
    const visibleRows = Math.max(1, Math.min(items.length || 1, maxRows));
    const height = visibleRows * ROW_HEIGHT + PANEL_PADDING * 2;
    const overflow = items.length > maxRows;
    const maxTop = Math.max(
      EDGE_GAP,
      window.innerHeight - height - BOTTOM_RESERVE,
    );
    const top = Math.max(
      EDGE_GAP,
      Math.min(Math.floor(rect.top - PANEL_PADDING), maxTop),
    );

    let left = Math.floor(rect.right + SUBMENU_GAP);
    if (left + COL_WIDTH + PANEL_PADDING * 2 > window.innerWidth - EDGE_GAP) {
      left = Math.max(
        EDGE_GAP,
        Math.floor(rect.left - COL_WIDTH - PANEL_PADDING * 2 - SUBMENU_GAP),
      );
    }
    return {
      folderId,
      items,
      left,
      top,
      width: COL_WIDTH + PANEL_PADDING * 2,
      height,
      overflow,
      level,
    };
  }

  public openFolder(folderId: string, rect: DOMRect, level: number) {
    this.submenuPanels = [
      ...this.submenuPanels.slice(0, level - 1),
      this.buildSubmenuPanel(folderId, rect, level),
    ];
  }

  public toggleFolder(folderId: string, rect: DOMRect, level: number) {
    const current = this.submenuPanels[level - 1];
    if (current?.folderId === folderId) {
      this.closeSubmenusFrom(level);
      return;
    }
    this.openFolder(folderId, rect, level);
  }

  public closeSubmenusFrom(level: number) {
    this.submenuPanels = this.submenuPanels.slice(0, Math.max(0, level - 1));
  }

  public clearSubmenus() {
    this.submenuPanels = [];
  }

  private resetContent() {
    this.clearSubmenus();
    this.items = [];
    this.tailItems = [];
    this.rootFolderId = '';
    this.hoveredBarFolderId = '';
    this.hoverAnchor = null;
    this.anchorClickUrl = '';
    this.cursorPoint = null;
    this.panelW = 0;
    this.panelH = 0;
  }

  // 弹层覆盖书签栏时，弹层本身代替书签栏接收鼠标事件；切换到另一个
  // 顶层文件夹无需再次经过防误触延迟，直接重开当前浮层。
  public hoverBarFolder(
    folderId: string,
    anchor: { left: number; bottom: number },
  ) {
    if (
      !folderId ||
      folderId === this.rootFolderId ||
      folderId === this.hoveredBarFolderId
    )
      return;
    this.hoveredBarFolderId = folderId;
    const items = this.getChildren(folderId);
    logBookmarkHoverDebug('popup switch folder', {
      from: this.rootFolderId,
      to: folderId,
      anchor,
      childCount: items.length,
    });
    void ipcRenderer
      .invoke(
        `show-bookmarks-bar-overflow-${this.windowId}`,
        snapshotBookmarksForIpc(items),
        snapshotBookmarksForIpc(this.allItems),
        {
          x: Math.floor(anchor.left),
          y: Math.floor(anchor.bottom) + 4,
          align: 'start',
          rootFolderId: folderId,
          barFolderAnchors: this.barFolderAnchors,
          barDropAnchors: this.barDropAnchors,
          barRect: this.barRect,
          barFolderId: this.barFolderId,
        },
      )
      .catch((error) =>
        console.error('[bookmarks] switch folder failed', error),
      );
  }

  // 全屏 Backdrop 点击 → 关闭浮层。箭头函数:作为 onClick 引用时 this 绑定实例。
  public backdropClick = () => {
    this.closeAll();
  };

  private closeAll() {
    this.clearSubmenus();
    ipcRenderer.send(`bookmark-overflow-close-all-${this.windowId}`);
  }
}

export default new Store();
