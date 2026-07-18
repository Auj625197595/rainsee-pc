import { Menu, ipcRenderer } from 'electron';
import { makeObservable, observable, toJS } from 'mobx';
import { IBookmark } from '~/interfaces';
import { Store } from '../store';

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

  public setBookmarkBarItems(): void {
    // handle calculating how many and which bookmarks we can fit in the bar and which ones need to go in the overflow menu
    if (!this.staticMainID) return;
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
    let currentWidth = 0;
    const potentialItems = this.list.filter(
      ({ parent }) => parent === this.staticMainID,
    );
    potentialItems.forEach((el) => {
      if (currentWidth >= barWidth) {
        overflowItems.push(el);
      } else {
        if (el.title.length < maxChars) {
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
    this.bookmarkBarItems = barItems;
    this.overflowItems = overflowItems;
  }

  /**
   * 渲染后实测修正:setBookmarkBarItems 按字符数估算按钮宽度,中文/宽字符标题
   * 实际宽得多(每字 ~12px vs 估算 ~6.3px),导致估算偏乐观——bookmarkBarItems 里
   * 塞进了 CSS 装不下的项,它们被 BookmarkSection 的 overflow:hidden + max-height
   * 裁切,既不可见、又进不了溢出菜单,表现为"书签栏最后一个可见项"与"溢出菜单
   * 第一项"之间缺失若干。组件渲染后实测各按钮位置,把被裁切的尾部项下沉到
   * overflowItems 头部,使两者首尾相接、不再缺失。
   */
  public refitOverflow(visibleCount: number) {
    if (visibleCount < 0) return;
    if (visibleCount >= this.bookmarkBarItems.length) return;
    const sunk = this.bookmarkBarItems.slice(visibleCount);
    this.bookmarkBarItems = this.bookmarkBarItems.slice(0, visibleCount);
    this.overflowItems = [...sunk, ...this.overflowItems];
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

  // 书签栏长按拖拽后的新顺序提交：仅传书签栏可见项的 _id 序列，
  // 主进程会按同父级(main)重排 order 并广播 reload-bookmarks，触发本 store 重新加载。
  public reorder(orderedIds: string[]) {
    if (!this.staticMainID) return;
    ipcRenderer.send('bookmarks-reorder', this.staticMainID, toJS(orderedIds));
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
    const clientRect = event.target.getBoundingClientRect();
    // 锚点 = 更多按钮左下角:菜单从此处向左、向下展开。
    const y = Math.floor(clientRect.bottom) + 4;
    const x = Math.floor(clientRect.left);

    // 走独立 BrowserView 多列浮层(支持多列 + 滚动箭头 + 二级悬浮),
    // 不再走原生 Menu。allBookmarks 供二级/切换时按 folderId 查子项。
    ipcRenderer.invoke(
      `show-bookmarks-bar-overflow-${this.store.windowId}`,
      toJS(this.overflowItems),
      toJS(this.list),
      { x, y },
    );
  };

  // 更多按钮 hover 时后台预加载溢出菜单浮层(不显示),使点击即秒开。
  public preloadOverflow = () => {
    ipcRenderer.send(
      `preload-dialog-on-hover-${this.store.windowId}`,
      'bookmark-overflow',
    );
  };

  public showFolderDropdown = async (event: any, id: string) => {
    const clientRect = event.target.getBoundingClientRect();
    const y = Math.floor(clientRect.bottom) + 12;
    const x = Math.floor(clientRect.left) - 30;

    const bookmarks = toJS(this.list);
    const { folder, page } = await this.ensureMenuIcons();
    ipcRenderer.invoke(
      `show-bookmarks-bar-dropdown-${this.store.windowId}`,
      id,
      bookmarks,
      {
        x,
        y,
        df: folder,
        dp: page,
      },
    );
  };

  public createContextMenu(event: unknown, id: string) {
    const item = this.list.find(({ _id }) => _id === id);
    ipcRenderer.invoke(
      `show-bookmarks-bar-context-menu-${this.store.windowId}`,
      toJS(item),
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
