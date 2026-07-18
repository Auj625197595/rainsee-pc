import { observable, computed, action, toJS, makeObservable } from 'mobx';
import { ISettings, IFavicon, ITheme, IBookmark } from '~/interfaces';
import { getTheme } from '~/utils/themes';
import { PreloadDatabase } from '~/preloads/models/database';
import { ipcRenderer } from '~/common/renderer-ipc';
import * as React from 'react';
import { Textfield } from '~/renderer/components/Textfield';
import { compareBookmark, SortCriteria } from '../utils';

export class Store {
  public faviconsDb = new PreloadDatabase<IFavicon>('favicons');

  public nameInputRef = React.createRef<Textfield>();

  public urlInputRef = React.createRef<Textfield>();

  @observable
  public settings: ISettings = { ...(window as any).settings };

  @observable
  public list: IBookmark[] = [];

  @observable
  public itemsLoaded = this.getDefaultLoaded();

  @observable
  public menuLeft = 0;

  @observable
  public menuTop = 0;

  @observable
  public menuVisible = false;

  // 右上角「排序」弹出菜单
  @observable
  public sortMenuVisible = false;

  @observable
  public sortMenuLeft = 0;

  @observable
  public sortMenuTop = 0;

  @observable
  public searched = '';

  @observable
  public draggedBookmarkId: string | null = null;

  @observable
  public dragOverBookmarkId: string | null = null;

  @observable
  public dragPosition: 'before' | 'after' | null = null;

  // 右上角「在新页面打开」勾选项。勾选→单击书签在新标签打开;未勾选→当前页打开。
  // localStorage 持久化(与 extensions/store 的 DEV_MODE_KEY 同款,webUI 页可用)。
  @observable
  public openInNewTab =
    localStorage.getItem('bookmarks.openInNewTab') === '1';

  @action
  public setOpenInNewTab(value: boolean) {
    this.openInNewTab = value;
    localStorage.setItem('bookmarks.openInNewTab', value ? '1' : '0');
  }

  @observable
  public selectedItems: string[] = [];

  // ===== 重点标记(本地)=====
  // 标记纯属本地 UI 偏好,按书签 _id 存 localStorage,不写入书签库、不参与云同步,
  // 避免云端 pull 覆盖未知字段或触发同步抖动。
  @observable
  public flaggedIds: string[] = (() => {
    try {
      const raw = localStorage.getItem('bookmarks.flaggedIds');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  })();

  // 「仅看标记」开关:开启后跨文件夹平铺展示所有已标记项。
  @observable
  public showFlaggedOnly = false;

  // 从刻度尺跳转时短暂高亮目标书签。
  @observable
  public flashId: string | null = null;

  private flashTimer: any = null;

  public isFlagged(id: string): boolean {
    return this.flaggedIds.includes(id);
  }

  @computed
  public get hasFlagged(): boolean {
    return this.flaggedIds.length > 0;
  }

  private persistFlags() {
    localStorage.setItem(
      'bookmarks.flaggedIds',
      JSON.stringify(toJS(this.flaggedIds)),
    );
  }

  @action
  public toggleFlag(id: string) {
    const i = this.flaggedIds.indexOf(id);
    if (i === -1) {
      this.flaggedIds.push(id);
    } else {
      this.flaggedIds.splice(i, 1);
    }
    this.persistFlags();
    // 标记清空后自动退出「仅看标记」,避免停留在空列表。
    if (this.flaggedIds.length === 0) this.showFlaggedOnly = false;
  }

  @action
  public clearAllFlags() {
    this.flaggedIds = [];
    this.persistFlags();
    this.showFlaggedOnly = false;
  }

  @action
  public toggleShowFlaggedOnly() {
    if (!this.hasFlagged) return;
    this.showFlaggedOnly = !this.showFlaggedOnly;
  }

  @action
  public flash(id: string) {
    this.flashId = id;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flashId = null;
    }, 1200);
  }

  @observable
  public favicons: Map<string, string> = new Map();

  @observable
  public currentFolder: string = null;

  @observable
  private _dialogVisible = false;

  public showDialog(content: 'edit' | 'new-folder' | 'rename-folder') {
    this.dialogContent = content;
    this.dialogVisible = true;

    if (content === 'edit' || content === 'rename-folder') {
      this.nameInputRef.current.value = this.currentBookmark.title;

      if (content === 'edit') {
        this.urlInputRef.current.value = this.currentBookmark.url;
      }
    }

    this.nameInputRef.current.inputRef.current.focus();
    this.nameInputRef.current.inputRef.current.select();
  }

  @observable
  public dialogContent: 'edit' | 'new-folder' | 'rename-folder' = 'new-folder';

  @observable
  public currentBookmark: IBookmark = null;

  // ===== 从本机浏览器导入：对话框状态 =====
  // 仅持有 UI 状态；实际 addImported 逻辑留在组件层，避免与 utils 的循环依赖。
  @observable
  public importBrowserVisible = false;

  @observable
  public availableBrowsers: { chrome: boolean; edge: boolean; firefox: boolean } | null = null;

  @observable
  public importBusy = false;

  @observable
  public importError: string | null = null;

  // 选择 → 确认 两阶段：读完先停在 confirm 阶段，展示数量等用户确认再写入。
  @observable
  public importPhase: 'select' | 'confirm' = 'select';

  // 待确认的导入数据（已读取、未写入）及其统计、来源浏览器名。
  @observable
  public pendingImport: any[] | null = null;

  @observable
  public pendingCounts: { folders: number; bookmarks: number } = {
    folders: 0,
    bookmarks: 0,
  };

  @observable
  public pendingBrowserName = '';

  public async openBrowserImport() {
    this.importError = null;
    this.availableBrowsers = null;
    this.importPhase = 'select';
    this.pendingImport = null;
    this.importBrowserVisible = true;
    try {
      this.availableBrowsers = await ipcRenderer.invoke('browser-import-detect');
    } catch {
      this.availableBrowsers = { chrome: false, edge: false, firefox: false };
      this.importError = '检测失败，请稍后重试';
    }
  }

  public closeBrowserImport() {
    this.importBrowserVisible = false;
    this.importError = null;
    this.importPhase = 'select';
    this.pendingImport = null;
  }

  // 从确认页返回选择页（丢弃已读取的数据，可换一个浏览器）。
  public backToBrowserSelect() {
    this.importPhase = 'select';
    this.pendingImport = null;
    this.importError = null;
  }

  // Computed

  @computed
  public get visibleItems() {
    // 「仅看标记」:跨文件夹平铺展示所有已标记书签/文件夹,按标记顺序排列。
    if (this.showFlaggedOnly && this.searched === '') {
      return this.flaggedIds
        .map((id) => this.list.find((x) => x._id === id))
        .filter(Boolean);
    }

    return this.list
      .filter(
        (x) =>
          (this.searched !== '' &&
            ((x.url &&
              x.url.toLowerCase().includes(this.searched.toLowerCase())) ||
              (x.title &&
                x.title
                  .toLowerCase()
                  .includes(this.searched.toLowerCase())))) ||
          (this.searched === '' && x.parent === this.currentFolder),
      )
      .slice()
      .sort((a, b) => {
        return a.order - b.order;
      });
  }

  @computed
  public get canManualSort(): boolean {
    return (
      this.searched === '' &&
      !this.currentFolderReadOnly &&
      !this.showFlaggedOnly
    );
  }

  @computed
  public get canDragSortBookmarks(): boolean {
    return this.canManualSort && this.visibleItems.length > 1;
  }

  @computed
  public get dialogVisible() {
    return this._dialogVisible;
  }

  public set dialogVisible(value: boolean) {
    if (!value) {
      this.nameInputRef.current.value = '';
    }

    this.menuVisible = false;

    this._dialogVisible = value;
  }

  @computed
  public get theme(): ITheme {
    return getTheme(this.settings.theme);
  }

  @computed
  public get path() {
    return this.getFolderPath(this.currentFolder);
  }

  @computed
  public get folders() {
    return this.list.filter((x) => x.isFolder);
  }

  // 当前所在文件夹是否只读(移动设备目录)。用于隐藏新建/编辑入口。
  @computed
  public get currentFolderReadOnly(): boolean {
    const folder = this.list.find((x) => x._id === this.currentFolder);
    return folder ? this.isReadOnly(folder) : false;
  }

  public constructor() {
    makeObservable(this);

    (window as any).updateSettings = (settings: ISettings) => {
      this.settings = { ...this.settings, ...settings };
    };

    this.load();
    this.loadFavicons();

    window.addEventListener('resize', () => {
      const loaded = this.getDefaultLoaded();

      if (loaded > this.itemsLoaded) {
        this.itemsLoaded = loaded;
      }
    });

    window.addEventListener('mousedown', () => {
      this.menuVisible = false;
      this.sortMenuVisible = false;
    });
  }

  public resetLoadedItems(): void {
    this.itemsLoaded = this.getDefaultLoaded();
  }

  public getById(id: string) {
    return this.list.find((x) => x._id === id);
  }

  // 移动设备书签为云端同步下发,禁止本地编辑/删除/新增。
  // 向上遍历 parent 链,命中 static==='mobile' 即视为只读(含该文件夹自身)。
  public isReadOnly(item: IBookmark): boolean {
    let cur: IBookmark | undefined = item;
    while (cur) {
      if (cur.static === 'mobile') return true;
      if (cur.parent == null) break;
      cur = this.list.find((x) => x._id === cur.parent);
    }
    return false;
  }

  public async load() {
    const items: IBookmark[] = await ipcRenderer.invoke('bookmarks-get');
    this.list = items.map((x) => ({ ...x }));
    this.currentFolder = this.list.find((x) => x.static === 'main')?._id || null;
    this.clearBookmarkDrag();
  }

  public async loadFavicons() {
    (await this.faviconsDb.get({})).forEach((favicon) => {
      const { data } = favicon;

      if (this.favicons.get(favicon.url) == null) {
        this.favicons.set(favicon.url, data);
      }
    });
  }

  public removeItems(ids: string[]) {
    // 过滤掉移动设备(只读)书签
    ids = ids.filter((id) => {
      const item = this.list.find((x) => x._id === id);
      return item && !this.isReadOnly(item);
    });
    if (ids.length === 0) return;

    for (const id of ids) {
      const item = this.list.find((x) => x._id === id);
      const parent = this.list.find((x) => x._id === item.parent);
      parent.children = parent.children.filter((x) => x !== id);
    }
    this.list = this.list.filter((x) => !ids.includes(x._id));

    // 同步清理被删书签的本地标记。
    if (this.flaggedIds.some((id) => ids.includes(id))) {
      this.flaggedIds = this.flaggedIds.filter((id) => !ids.includes(id));
      this.persistFlags();
      if (this.flaggedIds.length === 0) this.showFlaggedOnly = false;
    }

    ipcRenderer.send('bookmarks-remove', toJS(ids));
  }

  public async addItem(item: IBookmark) {
    // 禁止向移动设备目录新增
    const parent = this.list.find((x) => x._id === item.parent);
    if (parent && this.isReadOnly(parent)) return null;

    const i = await ipcRenderer.invoke('bookmarks-add', item);
    this.list.push({ ...i });
    this.list.find((x) => x._id === i.parent).children.push(i._id);
    return i;
  }

  public async updateItem(id: string, change: IBookmark) {
    const item = this.list.find((x) => x._id === id);
    // 禁止编辑移动设备(只读)书签
    if (item && this.isReadOnly(item)) return;

    const index = this.list.indexOf(item);
    this.list[index] = { ...this.list[index], ...change };
    ipcRenderer.send('bookmarks-update', id, toJS(change));
  }

  @action
  public search(str: string) {
    this.searched = str.toLowerCase().toLowerCase();
    this.itemsLoaded = this.getDefaultLoaded();
    this.clearBookmarkDrag();
  }

  // 右上角排序:对当前文件夹下的兄弟书签按指定规则重排,并持久化 order。
  // 搜索结果跨父级(重排无意义)、只读目录(移动设备)禁止排序。
  @action
  public sortBy(criteria: SortCriteria) {
    this.sortMenuVisible = false;

    if (this.searched !== '' || this.currentFolderReadOnly) return;
    const parent = this.currentFolder;
    if (parent == null) return;

    const sorted = this.list
      .filter((x) => x.parent === parent)
      .slice()
      .sort((a, b) => compareBookmark(a, b, criteria));

    this.persistSiblingOrder(
      parent,
      sorted.map((x) => x._id),
    );
  }

  @action
  public startBookmarkDrag(id: string) {
    if (!this.canDragSortBookmarks) return;
    this.draggedBookmarkId = id;
    this.dragOverBookmarkId = null;
    this.dragPosition = null;
  }

  @action
  public updateBookmarkDragTarget(
    id: string,
    position: 'before' | 'after',
  ) {
    if (!this.draggedBookmarkId || !this.canDragSortBookmarks) return;

    if (id === this.draggedBookmarkId) {
      this.dragOverBookmarkId = null;
      this.dragPosition = null;
      return;
    }

    this.dragOverBookmarkId = id;
    this.dragPosition = position;
  }

  @action
  public clearBookmarkDrag() {
    this.draggedBookmarkId = null;
    this.dragOverBookmarkId = null;
    this.dragPosition = null;
  }

  @action
  public commitBookmarkDrag(targetId: string, position: 'before' | 'after') {
    const sourceId = this.draggedBookmarkId;
    const parent = this.currentFolder;

    if (!sourceId || !this.canDragSortBookmarks || parent == null) {
      this.clearBookmarkDrag();
      return;
    }

    if (sourceId === targetId) {
      this.clearBookmarkDrag();
      return;
    }

    const siblings = this.list
      .filter((x) => x.parent === parent)
      .slice()
      .sort((a, b) => a.order - b.order);

    const dragged = siblings.find((x) => x._id === sourceId);
    if (!dragged) {
      this.clearBookmarkDrag();
      return;
    }

    const next = siblings.filter((x) => x._id !== sourceId);
    const targetIndex = next.findIndex((x) => x._id === targetId);
    if (targetIndex === -1) {
      this.clearBookmarkDrag();
      return;
    }

    const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
    next.splice(insertIndex, 0, dragged);

    const orderedIds = next.map((x) => x._id);
    const unchanged =
      orderedIds.length === siblings.length &&
      orderedIds.every((id, index) => id === siblings[index]._id);

    if (!unchanged) {
      this.persistSiblingOrder(parent, orderedIds);
    }

    this.clearBookmarkDrag();
  }

  public getDefaultLoaded() {
    return Math.floor(window.innerHeight / 48);
  }

  @action
  public deleteSelected() {
    this.removeItems(this.selectedItems);
    this.selectedItems = [];
  }

  @action
  public toggleSelectAllVisible() {
    if (this.allVisibleSelected) {
      this.selectedItems = [];
      return;
    }

    this.selectedItems = this.visibleItems.map((item) => item._id);
  }

  @computed
  public get allVisibleSelected(): boolean {
    const visibleIds = this.visibleItems.map((item) => item._id);
    return (
      visibleIds.length > 0 &&
      visibleIds.every((id) => this.selectedItems.includes(id))
    );
  }

  private getFolderPath(parent: string) {
    const parentFolder = this.list.find((x) => x._id === parent);
    let path: IBookmark[] = [];

    if (parentFolder == null) return [];

    if (parentFolder.parent != null) {
      path = path.concat(this.getFolderPath(parentFolder.parent));
    }

    path.push(parentFolder);
    return path;
  }

  private persistSiblingOrder(parent: string, orderedIds: string[]) {
    const siblings = this.list
      .filter((x) => x.parent === parent)
      .slice()
      .sort((a, b) => a.order - b.order);

    if (siblings.length === 0) return;

    const base = siblings.reduce(
      (min, item) => Math.min(min, item.order ?? 0),
      Infinity,
    );
    const start = Number.isFinite(base) ? base : 0;
    const orderMap = new Map<string, number>();

    orderedIds.forEach((id, index) => {
      orderMap.set(id, start + index);
    });

    this.list = this.list.map((item) =>
      item.parent === parent && orderMap.has(item._id)
        ? { ...item, order: orderMap.get(item._id)! }
        : item,
    );

    // 持久化:主进程按 parent 重算 order 并广播 reload-bookmarks(书签栏会刷新;
    // 本页不监听该事件,以免 load() 把 currentFolder 重置回 main)。
    ipcRenderer.send('bookmarks-reorder', parent, orderedIds);
  }
}

export default new Store();
