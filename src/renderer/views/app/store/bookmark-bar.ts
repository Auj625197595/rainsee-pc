import { Menu, ipcRenderer } from 'electron';
import { makeObservable, observable, toJS } from 'mobx';
import { IBookmark } from '~/interfaces';
import { Store } from '../store';
import {
  snapshotBookmarkForIpc,
  snapshotBookmarksForIpc,
} from '~/renderer/utils/bookmark-ipc';

export type BookmarkDropTarget = {
  parentId: string;
  insertIndex?: number;
  indicator?: { left: number; top: number; height: number };
};

export class BookmarkBarStore {
  public buttonWidth = 150;
  public overflowMenu: Menu;
  private staticMainID: string;
  private store: Store;

  public list: IBookmark[] = [];

  public bookmarkBarItems: IBookmark[] = [];

  public overflowItems: IBookmark[] = [];

  // 书签栏默认图标(黄文件夹/灰地球)栅格化后的 PNG data URL 缓存。
  // 主进程构建原生菜单时取用,使 popup 默认图标与书签栏一致。
  private defaultMenuIcons: { folder: string; page: string } | null = null;

  public constructor(store: Store) {
    makeObservable(this, {
      list: observable,
      bookmarkBarItems: observable,
      overflowItems: observable,
    });

    this.store = store;
    this.load();

    this.handleWindowResize();
    ipcRenderer.on('reload-bookmarks', () => {
      this.load();
    });
  }

  public async load() {
    const items: IBookmark[] = await ipcRenderer.invoke('bookmarks-get');
    this.list = items;
    const mainFolder = items.find((x) => x.static === 'main');
    this.staticMainID = mainFolder?._id;
    this.setBookmarkBarItems();
  }

  public getDisplayFolderId(): string | undefined {
    const configuredFolderId = this.store.settings.object.bookmarksBarFolderId;
    const configuredFolder = configuredFolderId
      ? this.list.find(
          (bookmark) =>
            bookmark._id === configuredFolderId && bookmark.isFolder,
        )
      : null;

    return configuredFolder?._id || this.staticMainID;
  }

  private getDisplayedItems(): IBookmark[] {
    const folderId = this.getDisplayFolderId();
    if (!folderId) return [];
    return this.list.filter(({ parent }) => parent === folderId);
  }

  private hasSameItems(a: IBookmark[], b: IBookmark[]) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => {
      const next = b[index];
      return (
        item?._id === next?._id &&
        item.title === next.title &&
        item.url === next.url &&
        item.favicon === next.favicon &&
        item.isFolder === next.isFolder &&
        item.parent === next.parent &&
        item.order === next.order
      );
    });
  }

  private applyMeasuredSplit(visibleCount: number) {
    const displayedItems = this.getDisplayedItems();
    const clamped = Math.max(0, Math.min(visibleCount, displayedItems.length));
    const barItems = displayedItems.slice(0, clamped);
    const overflowItems = displayedItems.slice(clamped);

    if (
      this.hasSameItems(this.bookmarkBarItems, barItems) &&
      this.hasSameItems(this.overflowItems, overflowItems)
    ) {
      return;
    }

    this.bookmarkBarItems = barItems;
    this.overflowItems = overflowItems;
  }

  public setBookmarkBarItems(): void {
    // handle calculating how many and which bookmarks we can fit in the bar and which ones need to go in the overflow menu
    if (!this.getDisplayFolderId()) return;
    const barItems: IBookmark[] = [];
    const overflowItems: IBookmark[] = [];
    // 多行书签栏:容量 = 单行宽度 × 行数。优先用 section 实测宽度(与 CSS flex-wrap
    // 换行点一致,消除 clientWidth-65 估算偏差);section 未挂载时回退到旧估算。
    const rows = this.store.settings.object.bookmarksBarRows || 1;
    const sectionEl = document.querySelector(
      '[data-bookmark-section]',
    ) as HTMLElement | null;
    const measured = sectionEl?.getBoundingClientRect().width;
    const perRow =
      measured && measured > 0 ? measured : document.body.clientWidth - 65;
    const barWidth = perRow * rows;
    const maxChars = 18;
    const iconsOnly = this.store.settings.object.bookmarksBarIconsOnly;
    let currentWidth = 0;
    const potentialItems = this.getDisplayedItems();
    potentialItems.forEach((el) => {
      if (currentWidth >= barWidth) {
        overflowItems.push(el);
      } else {
        if (iconsOnly) {
          // 34px 按钮 + 左右各 2px margin，与 BookmarkButton 的实际占位一致。
          currentWidth += 38;
        } else if (el.title.length < maxChars) {
          const realWidth =
            ((this.buttonWidth - 36) / maxChars) * el.title.length;
          currentWidth += realWidth + 36;
        } else {
          currentWidth += this.buttonWidth;
        }
        if (currentWidth < barWidth) {
          barItems.push(el);
        } else {
          overflowItems.push(el);
        }
      }
    });
    if (
      this.hasSameItems(this.bookmarkBarItems, barItems) &&
      this.hasSameItems(this.overflowItems, overflowItems)
    ) {
      return;
    }
    this.bookmarkBarItems = barItems;
    this.overflowItems = overflowItems;
  }

  /**
   * 渲染后实测修正:setBookmarkBarItems 按字符数估算按钮宽度,中文/宽字符标题
   * 实际宽得多(每字 ~12px vs 估算 ~6.3px),导致估算偏乐观——bookmarkBarItems 里
   * 塞进了 CSS 装不下的项,它们被 BookmarkSection 的 overflow:hidden + max-height
   * 裁切,既不可见、又进不了溢出菜单,表现为"书签栏最后一个可见项"与"溢出菜单
   * 第一项"之间缺失若干。组件渲染后用完整主书签序列按 visibleCount 重新切分,
   * 确保书签栏/溢出菜单始终是一个连续前缀 + 连续后缀,不再增量拼接导致漏项。
   */
  public refitOverflow(visibleCount: number) {
    if (visibleCount < 0) return;
    this.applyMeasuredSplit(visibleCount);
  }

  /**
   * 上调修正(与 refitOverflow 的下沉配对):setBookmarkBarItems 按字符数估算宽度,
   * 对英文/数字短标题偏悲观(估算偏宽),会把本该挤进可见行的项推进 overflowItems,
   * 书签栏右侧因此留白、没铺满。这里把主书签完整序列临时铺回书签栏,但保留
   * overflowItems 作为"更多"按钮占位,下一轮 useLayoutEffect 会基于真实宽度
   * 重新精确切分。组件侧用 promoteKey 防止"上调→下沉"反复。
   */
  public promoteOverflow() {
    if (this.overflowItems.length === 0) return;
    const displayedItems = this.getDisplayedItems();
    if (this.hasSameItems(this.bookmarkBarItems, displayedItems)) return;
    this.bookmarkBarItems = displayedItems;
  }

  // 点击"更多"前再按当前 DOM 的真实换行结果同步一次,避免 resize 防抖尚未完成时
  // 弹窗拿到旧 overflowItems,造成书签栏与弹窗之间出现缺口。
  public syncWithRenderedLayout() {
    const sectionEl = document.querySelector(
      '[data-bookmark-section]',
    ) as HTMLElement | null;
    if (!sectionEl) return;

    const children = Array.from(sectionEl.children) as HTMLElement[];
    const rows = this.store.settings.object.bookmarksBarRows || 1;
    const maxH = rows * 26 + (rows - 1) * 4;
    let visibleCount = children.length;

    for (let i = 0; i < children.length; i++) {
      if (children[i].offsetTop >= maxH) {
        visibleCount = i;
        break;
      }
    }

    this.applyMeasuredSplit(visibleCount);
  }

  public removeItems(ids: string[]) {
    for (const id of ids) {
      const item = this.list.find((x) => x._id === id);
      if (!item) continue;
      const parent = this.list.find((x) => x._id === item.parent);
      if (!parent) continue;
      parent.children = parent.children.filter((x) => x !== id);
    }
    this.list = this.list.filter((x) => !ids.includes(x._id));

    ipcRenderer.send('bookmarks-remove', toJS(ids));
  }

  // 书签栏长按拖拽后的新顺序提交：仅传当前展示目录可见项的 _id 序列，
  // 主进程会按同父级重排 order 并广播 reload-bookmarks，触发本 store 重新加载。
  public reorder(orderedIds: string[]) {
    const folderId = this.getDisplayFolderId();
    if (!folderId) return;
    ipcRenderer.send('bookmarks-reorder', folderId, toJS(orderedIds));
  }

  public canMoveItemToFolder(id: string, targetId: string): boolean {
    if (!id || !targetId || targetId === this.getDisplayFolderId() || id === targetId)
      return false;

    const item = this.list.find((bookmark) => bookmark._id === id);
    const target = this.list.find((bookmark) => bookmark._id === targetId);
    if (!item || !target?.isFolder || item.parent === targetId) return false;

    // 文件夹不能移入自己的后代，否则会形成循环目录。
    if (item.isFolder) {
      let current: IBookmark | undefined = target;
      const visited = new Set<string>();
      while (current?.parent && !visited.has(current._id)) {
        if (current.parent === id) return false;
        visited.add(current._id);
        current = this.list.find((bookmark) => bookmark._id === current.parent);
      }
    }

    return true;
  }

  public moveItemToFolder(id: string, targetId: string): boolean {
    if (!this.canMoveItemToFolder(id, targetId)) return false;
    ipcRenderer.send('bookmarks-update', id, { parent: targetId });
    return true;
  }

  /** 返回鼠标所在的文件夹或书签栏插入槽位。 */
  public getDropTargetAtPoint(
    clientX: number,
    clientY: number,
  ): BookmarkDropTarget | null {
    const bar = document.querySelector(
      '[data-rainsee-part="bookmark-bar"]',
    ) as HTMLElement | null;
    if (!bar) return null;

    const barRect = bar.getBoundingClientRect();
    if (
      clientX < barRect.left ||
      clientX > barRect.right ||
      clientY < barRect.top ||
      clientY > barRect.bottom
    ) {
      return null;
    }

    const folderId = this.getDisplayFolderId();
    if (!folderId) return null;

    const elements = Array.from(
      bar.querySelectorAll('[data-rainsee-part="bookmark-item"]'),
    ) as HTMLElement[];
    const folder = elements.find((element) => {
      if (element.dataset.rainseeKind !== 'folder') return false;
      const rect = element.getBoundingClientRect();
      // 文件夹左右边缘留作“插到文件夹前/后”的投放槽位。
      return (
        clientX >= rect.left + 6 &&
        clientX <= rect.right - 6 &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    });
    if (folder?.dataset.id) return { parentId: folder.dataset.id };

    let domIndex = elements.length;
    for (let i = 0; i < elements.length; i++) {
      const rect = elements[i].getBoundingClientRect();
      const beforeRow = clientY < rect.top;
      const sameRowBefore =
        clientY >= rect.top &&
        clientY <= rect.bottom &&
        clientX < rect.left + rect.width / 2;
      if (beforeRow || sameRowBefore) {
        domIndex = i;
        break;
      }
    }

    const displayedItems = this.getDisplayedItems();
    const beforeId = elements[domIndex]?.dataset.id;
    const beforeIndex = beforeId
      ? displayedItems.findIndex((item) => item._id === beforeId)
      : -1;
    const insertIndex =
      beforeIndex >= 0
        ? beforeIndex
        : Math.min(elements.length, displayedItems.length);

    const anchor = elements[domIndex] || elements[elements.length - 1];
    let indicator: BookmarkDropTarget['indicator'];
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      const left = domIndex < elements.length ? rect.left : rect.right;
      indicator = {
        left: Math.max(0, Math.min(left - barRect.left, barRect.width - 2)),
        top: rect.top - barRect.top,
        height: rect.height,
      };
    }

    return { parentId: folderId, insertIndex, indicator };
  }

  public async addDroppedBookmark(
    payload: { url?: string; title?: string; favicon?: string },
    dropTarget?: BookmarkDropTarget,
  ): Promise<boolean> {
    const url = (payload.url || '').trim();
    const parent = dropTarget?.parentId || this.getDisplayFolderId();
    if (!url || !parent) return false;

    const target = this.list.find((item) => item._id === parent);
    if (!target?.isFolder) return false;

    try {
      const siblings = this.list
        .filter((item) => item.parent === parent)
        .slice()
        .sort((a, b) => a.order - b.order);
      const bookmark: IBookmark = await ipcRenderer.invoke('bookmarks-add', {
        title: (payload.title || '').trim() || url,
        url,
        favicon: payload.favicon || '',
        parent,
      });

      if (dropTarget?.insertIndex != null && bookmark?._id) {
        const orderedIds = siblings.map((item) => item._id);
        const insertIndex = Math.max(
          0,
          Math.min(dropTarget.insertIndex, orderedIds.length),
        );
        orderedIds.splice(insertIndex, 0, bookmark._id);
        ipcRenderer.send('bookmarks-reorder', parent, toJS(orderedIds));
      }
      return true;
    } catch {
      return false;
    }
  }

  // 把书签栏的默认图标(黄文件夹 FolderIcon / 灰地球 GlobeIcon)栅格化为 PNG data URL。
  // 主进程 nativeImage 不支持 SVG,需经 canvas 转栅格(手法同 tab-context-menu 的 menuIcon)。
  // SVG 源须与 BookmarkBar/index.tsx 中的 FolderIcon/GlobeIcon 保持一致。
  private rasterizeMenuIcons(): Promise<{ folder: string; page: string }> {
    const toPng = (svg: string) =>
      new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 16;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve('');
          ctx.drawImage(img, 0, 0, 16, 16);
          resolve(canvas.toDataURL());
        };
        img.onerror = () => resolve('');
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      });

    const folderSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#FBC02D"><path d="M3.75 6.75A2.25 2.25 0 0 1 6 4.5h3.38c.6 0 1.17.24 1.59.66l1.12 1.12c.18.18.42.28.67.28H18a2.25 2.25 0 0 1 2.25 2.25v6.53A2.25 2.25 0 0 1 18 17.59H6a2.25 2.25 0 0 1-2.25-2.25V6.75Z"/></svg>';
    const pageSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="#5F6368" stroke-width="1.6"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.4 3.5 8.5S14.3 18.1 12 20.5C9.7 18.1 8.5 15.1 8.5 12S9.7 5.9 12 3.5Z" stroke="#5F6368" stroke-width="1.6"/></svg>';

    return Promise.all([toPng(folderSvg), toPng(pageSvg)]).then(
      ([folder, page]) => ({ folder, page }),
    );
  }

  private async ensureMenuIcons() {
    if (!this.defaultMenuIcons) {
      this.defaultMenuIcons = await this.rasterizeMenuIcons();
    }
    return this.defaultMenuIcons;
  }

  public showOverflow = async (event: any) => {
    const target = event.currentTarget || event.target;
    const clientRect = target.getBoundingClientRect();
    this.syncWithRenderedLayout();
    if (this.overflowItems.length === 0) return;
    // 锚点 = 更多按钮左下角:菜单从此处向左、向下展开。
    const y = Math.floor(clientRect.bottom) + 4;
    const x = Math.floor(clientRect.left);

    // 走独立 BrowserView 多列浮层(支持多列 + 滚动箭头 + 二级悬浮),
    // 不再走原生 Menu。allBookmarks 供二级/切换时按 folderId 查子项。
    void ipcRenderer.invoke(
      `show-bookmarks-bar-overflow-${this.store.windowId}`,
      snapshotBookmarksForIpc(this.overflowItems),
      snapshotBookmarksForIpc(this.list),
      { x, y },
    ).catch((error) => console.error('[bookmarks] open overflow failed', error));
  };

  public showFolderDropdown = (event: any, id: string) => {
    const target = event.currentTarget || event.target;
    const clientRect = target.getBoundingClientRect();
    const y = Math.floor(clientRect.bottom) + 4;
    const x = Math.floor(clientRect.left);
    const items = this.list.filter(
      ({ static: staticName, parent }) => !staticName && parent === id,
    );

    // 文件夹下拉复用「更多书签」的多列浮层，使列表项也能接收右键事件。
    void ipcRenderer.invoke(
      `show-bookmarks-bar-overflow-${this.store.windowId}`,
      snapshotBookmarksForIpc(items),
      snapshotBookmarksForIpc(this.list),
      { x, y, align: 'start' },
    ).catch((error) => console.error('[bookmarks] open folder failed', error));
  };

  public createContextMenu(event: unknown, id?: string) {
    const item = id ? this.list.find(({ _id }) => _id === id) : null;
    const folderId = item ? undefined : this.getDisplayFolderId();
    void ipcRenderer.invoke(
      `show-bookmarks-bar-context-menu-${this.store.windowId}`,
      item ? snapshotBookmarkForIpc(item) : null,
      'bar',
      folderId,
    ).catch((error) =>
      console.error('[bookmarks] open context menu failed', error),
    );
  }

  private handleWindowResize() {
    let debounceTimer: any;

    window.addEventListener('resize', () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        this.setBookmarkBarItems();
      }, 200);
    });
  }
}
