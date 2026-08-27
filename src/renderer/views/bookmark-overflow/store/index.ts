import { ipcRenderer } from 'electron';
import { observable, makeObservable } from 'mobx';
import { DialogStore } from '~/models/dialog-store';
import { IBookmark } from '~/interfaces';
import { snapshotBookmarkForIpc } from '~/renderer/utils/bookmark-ipc';

const COL_WIDTH = 240;
const ROW_HEIGHT = 30;
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
}

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
  public submenuPanels: SubmenuPanelState[] = [];

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
      submenuPanels: observable,
    });

    ipcRenderer.on('visible', (e, flag: boolean) => {
      this.visible = flag;
      if (!flag) this.clearSubmenus();
    });

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
      this.clearSubmenus();
      this.visible = true;
    });

    // Esc 关闭浮层
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeAll();
    });
  }

  // 打开网页书签:新建标签 + 关闭浮层。
  public openBookmark(url: string) {
    if (!url) return;
    ipcRenderer.send(`add-tab-${this.windowId}`, { url, active: true });
    this.closeAll();
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
    // 根面板只包含本次打开目录的直属项；移入子文件夹后应立即从根面板移除。
    this.items = this.items.filter((bookmark) => bookmark._id !== id);
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
    return true;
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
