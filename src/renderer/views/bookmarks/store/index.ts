import { observable, computed, action, toJS, makeObservable } from 'mobx';
import { ISettings, IFavicon, ITheme, IBookmark } from '~/interfaces';
import { getTheme } from '~/utils/themes';
import { PreloadDatabase } from '~/preloads/models/database';
import { ipcRenderer } from '~/common/renderer-ipc';
import * as React from 'react';
import { compareBookmark, SortCriteria } from '../utils';

export class Store {
  public faviconsDb = new PreloadDatabase<IFavicon>('favicons');

  public nameInputRef = React.createRef<HTMLInputElement>();

  public urlInputRef = React.createRef<HTMLInputElement>();

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
  public dragPosition: 'before' | 'after' | 'into' | null = null;

  // 右上角「在新页面打开」勾选项。勾选→单击书签在新标签打开;未勾选→当前页打开。
  // localStorage 持久化(与 extensions/store 的 DEV_MODE_KEY 同款,webUI 页可用)。
  @observable
  public openInNewTab = localStorage.getItem('bookmarks.openInNewTab') === '1';

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

  public showDialog(content: 'edit' | 'new-folder' | 'rename-folder' | 'move') {
    this.dialogContent = content;
    this.dialogVisible = true;
    this.editFolderPanelOpen = false;

    if (content === 'edit' || content === 'rename-folder') {
      // 编辑/重命名时初始化所属文件夹为当前 parent。
      this.editParentFolderId = this.currentBookmark.parent ?? null;
    } else if (content === 'new-folder') {
      // 新建文件夹默认放进当前目录。
      this.editParentFolderId = this.currentFolder;
    }
  }

  @observable
  public dialogContent: 'edit' | 'new-folder' | 'rename-folder' | 'move' =
    'new-folder';

  @observable
  public currentBookmark: IBookmark = null;

  // ===== 文件夹移动：弹窗 + 文件夹选择器状态 =====
  // 移动弹窗：待移动项、目标文件夹、目标禁选(自身+后代,防循环)。
  @observable
  public moveTargetIds: string[] = [];

  @observable
  public moveTargetFolderId: string | null = null;

  @observable
  public moveExcludeIds: string[] = [];

  // 编辑弹窗里的所属文件夹（parent）。新建/重命名文件夹时也可改归属。
  @observable
  public editParentFolderId: string | null = null;

  // 编辑弹窗内文件夹面板展开态。
  @observable
  public editFolderPanelOpen = false;

  // 文件夹选择器（FolderPicker）共享状态：搜索词 + 展开的文件夹 id。
  // 移动弹窗与编辑弹窗同一时刻只开一个,共用即可。
  @observable
  public folderPickerSearch = '';

  @observable
  public expandedFolderIds: string[] = [];

  // ===== 从本机浏览器导入：对话框状态 =====
  // 仅持有 UI 状态；实际 addImported 逻辑留在组件层，避免与 utils 的循环依赖。
  @observable
  public importBrowserVisible = false;

  @observable
  public availableBrowsers: {
    chrome: boolean;
    edge: boolean;
    firefox: boolean;
  } | null = null;

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
      this.availableBrowsers = await ipcRenderer.invoke(
        'browser-import-detect',
      );
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

  // 按 URL 汇总重复书签。文件夹和空 URL 不参与，保留每组在当前书签
  // 列表中最先出现的节点，其余节点由工具箱一次性删除。
  @computed
  public get duplicateGroups(): Array<{
    url: string;
    items: IBookmark[];
    removeIds: string[];
  }> {
    const groups = new Map<string, IBookmark[]>();
    for (const item of this.list) {
      if (item.isFolder || !item._id || !item.url || !item.url.trim()) {
        continue;
      }
      const url = item.url.trim();
      const group = groups.get(url);
      if (group) group.push(item);
      else groups.set(url, [item]);
    }

    return Array.from(groups, ([url, items]) => ({
      url,
      items,
      removeIds: items.slice(1).map((item) => item._id),
    })).filter((group) => group.items.length > 1);
  }

  @computed
  public get canManualSort(): boolean {
    return (
      this.searched === '' &&
      !this.currentFolderReadOnly &&
      !this.showFlaggedOnly
    );
  }

  // 将当前文件夹中选中的节点移动到最前面，并保留选中项原有相对顺序。
  @action
  public pinSelected() {
    if (!this.canManualSort || this.currentFolder == null) return;

    const selected = new Set(this.selectedItems);
    const siblings = this.list
      .filter((item) => item.parent === this.currentFolder)
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const pinned = siblings.filter((item) => selected.has(item._id));
    if (pinned.length === 0) return;

    const ordered = [
      ...pinned,
      ...siblings.filter((item) => !selected.has(item._id)),
    ];
    const unchanged = ordered.every(
      (item, index) => item._id === siblings[index]?._id,
    );
    if (!unchanged) {
      this.persistSiblingOrder(
        this.currentFolder,
        ordered.map((item) => item._id),
      );
    }
  }

  // 可拖拽(普通视图、非搜索、非仅看标记、非只读目录)。
  // 拖拽手柄在每个可拖拽项上都显示;拖到侧边栏文件夹/面包屑=移动,
  // 拖到同文件夹内另一卡片=排序(后者额外要求 >1 项)。
  @computed
  public get canDragBookmarks(): boolean {
    return this.canManualSort;
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
      // 弹窗按需挂载，关闭时输入节点会随弹窗一并卸载。
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

  // 云端移动书签可在 PC 端直接维护；固定根目录本身仍由 static 标记保护。
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

  public isReadOnly(item: IBookmark): boolean {
    return false;
  }

  private bookmarkScope(
    itemOrId: IBookmark | string | null,
  ): 'desktop' | 'mobile' | null {
    let item =
      typeof itemOrId === 'string'
        ? this.list.find((x) => x._id === itemOrId)
        : itemOrId;
    const visited = new Set<string>();
    while (item && !visited.has(item._id)) {
      visited.add(item._id);
      if (item.static === 'mobile') return 'mobile';
      if (item.static === 'main' || item.static === 'other') return 'desktop';
      item = item.parent
        ? this.list.find((candidate) => candidate._id === item.parent)
        : null;
    }
    return null;
  }

  private folderPickerScope(): 'desktop' | 'mobile' | null {
    if (this.dialogContent === 'move') {
      return this.bookmarkScope(this.moveTargetIds[0] || null);
    }
    if (
      this.dialogContent === 'edit' ||
      this.dialogContent === 'rename-folder'
    ) {
      return this.bookmarkScope(this.currentBookmark);
    }
    return this.bookmarkScope(this.currentFolder);
  }

  public async load(preserveCurrentFolder = false) {
    const items: IBookmark[] = await ipcRenderer.invoke('bookmarks-get');
    const previousFolder = this.currentFolder;
    this.list = items.map((x) => ({ ...x }));
    const mainFolder = this.list.find((x) => x.static === 'main')?._id || null;
    this.currentFolder =
      preserveCurrentFolder && this.list.some((x) => x._id === previousFolder)
        ? previousFolder
        : mainFolder;
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
    // static 根不会出现在可删除卡片中，移动域普通节点允许删除。
    ids = ids.filter((id) => {
      const item = this.list.find((x) => x._id === id);
      return item && !this.isReadOnly(item);
    });
    if (ids.length === 0) return;

    const deleting = new Set(ids);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const item of this.list) {
        if (
          item.parent &&
          deleting.has(item.parent) &&
          !deleting.has(item._id)
        ) {
          deleting.add(item._id);
          expanded = true;
        }
      }
    }
    ids = [...deleting];

    for (const id of ids) {
      const item = this.list.find((x) => x._id === id);
      if (!item) continue;
      const parent = this.list.find((x) => x._id === item.parent);
      if (parent) parent.children = parent.children.filter((x) => x !== id);
    }
    this.list = this.list.filter((x) => !ids.includes(x._id));
    this.selectedItems = this.selectedItems.filter((id) => !ids.includes(id));

    // 同步清理被删书签的本地标记。
    if (this.flaggedIds.some((id) => ids.includes(id))) {
      this.flaggedIds = this.flaggedIds.filter((id) => !ids.includes(id));
      this.persistFlags();
      if (this.flaggedIds.length === 0) this.showFlaggedOnly = false;
    }

    ipcRenderer.send('bookmarks-remove', toJS(ids));
  }

  public async addItem(item: IBookmark) {
    // 允许在移动设备目录中新建，主进程会写回 mobile 云作用域。
    const parent = this.list.find((x) => x._id === item.parent);
    if (parent && this.isReadOnly(parent)) return null;

    const i = await ipcRenderer.invoke('bookmarks-add', item);
    this.list.push({ ...i });
    this.list.find((x) => x._id === i.parent).children.push(i._id);
    return i;
  }

  public async updateItem(id: string, change: IBookmark) {
    const item = this.list.find((x) => x._id === id);
    // 移动域普通节点与桌面节点使用相同编辑流程。
    if (item && this.isReadOnly(item)) return;
    if (
      item &&
      change.parent &&
      this.bookmarkScope(item) !== this.bookmarkScope(change.parent)
    ) {
      return;
    }

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
    // 起拖只记录状态(卡片半透明反馈);排序落点逻辑各自门控 canDragSortBookmarks,
    // 所以单文件/非排序场景拖到文件夹=移动,不会误触发排序。
    this.draggedBookmarkId = id;
    this.dragOverBookmarkId = null;
    this.dragPosition = null;
  }

  @action
  public updateBookmarkDragTarget(id: string, position: 'before' | 'after') {
    if (!this.draggedBookmarkId || !this.canDragSortBookmarks) return;

    if (id === this.draggedBookmarkId) {
      this.dragOverBookmarkId = null;
      this.dragPosition = null;
      return;
    }

    this.dragOverBookmarkId = id;
    this.dragPosition = position;
  }

  // 拖到文件夹卡片(或侧栏/面包屑文件夹)= 移入。不受排序条件限制,
  // 单项也能移。整卡高亮(dragPosition='into')。
  @action
  public setFolderDragInto(id: string) {
    this.dragOverBookmarkId = id;
    this.dragPosition = 'into';
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

  // ===== 文件夹树辅助（供 FolderPicker / 编辑弹窗使用）=====

  // 文件夹树只展示当前操作所属作用域，避免 cloud_id 跨 desktop/mobile。
  public getFolderTreeRoots(): IBookmark[] {
    const scope = this.folderPickerScope();
    return this.list
      .filter(
        (x) =>
          x.isFolder &&
          x.parent == null &&
          !this.isReadOnly(x) &&
          (!scope || this.bookmarkScope(x) === scope),
      )
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  // 某文件夹下的子文件夹(不含书签叶子),按 order 排序。
  public getFolderChildren(parentId: string): IBookmark[] {
    return this.list
      .filter((x) => x.isFolder && x.parent === parentId)
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  public getFolderById(id: string): IBookmark | undefined {
    return this.list.find((x) => x._id === id);
  }

  public isFolderExpanded(folderId: string): boolean {
    return (
      this.folderPickerSearch.trim() !== '' ||
      this.expandedFolderIds.includes(folderId)
    );
  }

  @action
  public toggleFolderExpanded(folderId: string) {
    if (this.expandedFolderIds.includes(folderId)) {
      this.expandedFolderIds = this.expandedFolderIds.filter(
        (id) => id !== folderId,
      );
      return;
    }
    this.expandedFolderIds = [...this.expandedFolderIds, folderId];
  }

  @action
  public expandAllFolders() {
    const scope = this.folderPickerScope();
    this.expandedFolderIds = this.list
      .filter(
        (x) =>
          x.isFolder &&
          !this.isReadOnly(x) &&
          (!scope || this.bookmarkScope(x) === scope),
      )
      .map((x) => x._id);
  }

  @action
  public collapseAllFolders() {
    this.expandedFolderIds = this.getFolderTreeRoots().map((x) => x._id);
  }

  @action
  public setFolderPickerSearch(value: string) {
    this.folderPickerSearch = value;
  }

  // 打开文件夹选择器前重置:清搜索、展开目标路径祖先(让目标可见)。
  @action
  public resetFolderPicker(targetFolderId: string | null) {
    this.folderPickerSearch = '';
    if (targetFolderId) {
      const pathIds = this.getFolderPath(targetFolderId)
        .slice(0, -1)
        .map((x) => x._id);
      this.expandedFolderIds = Array.from(
        new Set([
          ...this.getFolderTreeRoots().map((x) => x._id),
          ...this.expandedFolderIds,
          ...pathIds,
        ]),
      );
    } else {
      this.expandedFolderIds = Array.from(
        new Set([
          ...this.getFolderTreeRoots().map((x) => x._id),
          ...this.expandedFolderIds,
        ]),
      );
    }
  }

  // ===== 移动原语 =====

  // 沿 parent 链判断 candidateId 是否为 ancestorId 的后代(含间接)。
  public isDescendantOf(candidateId: string, ancestorId: string): boolean {
    let cur = this.getFolderById(candidateId);
    while (cur?.parent) {
      if (cur.parent === ancestorId) return true;
      cur = this.getFolderById(cur.parent);
    }
    return false;
  }

  // 某文件夹的所有后代文件夹 id(递归 children,仅文件夹)。
  public getDescendantFolderIds(folderId: string): string[] {
    const out: string[] = [];
    const walk = (id: string) => {
      const children = this.getFolderChildren(id);
      for (const c of children) {
        out.push(c._id);
        walk(c._id);
      }
    };
    walk(folderId);
    return out;
  }

  // 多选拖拽语义:被拖项在已选集合里且选中数>1 → 移动全部选中;否则只移该项。
  public getMoveSetFromDrag(draggedId: string): string[] {
    if (
      this.selectedItems.includes(draggedId) &&
      this.selectedItems.length > 1
    ) {
      return [...this.selectedItems];
    }
    return [draggedId];
  }

  // 把若干书签/文件夹移到 targetId 文件夹下。
  // - 跳过只读、跨作用域、目标已是当前父级、移进自身/自身后代(循环)。
  // - 本地同步 old/new 父级 children 数组(本页不监听 reload-bookmarks,
  //   不本地补会让侧边栏 Tree 计数/展开变脏)。
  // - 每条发 bookmarks-update(主进程再改一遍 children + 广播,幂等)。
  @action
  public moveItemsToFolder(ids: string[], targetId: string) {
    if (!targetId) return;
    const target = this.getFolderById(targetId);
    if (!target || !target.isFolder || this.isReadOnly(target)) return;

    const movedSelected = ids.some((id) => this.selectedItems.includes(id));

    for (const id of ids) {
      const item =
        this.getFolderById(id) || this.list.find((x) => x._id === id);
      if (!item) continue;
      if (this.isReadOnly(item)) continue;
      if (this.bookmarkScope(item) !== this.bookmarkScope(target)) continue;
      if (item.parent === targetId) continue; // 已在目标下
      if (id === targetId) continue; // 不能移进自己
      // 文件夹移进自己后代会成环
      if (item.isFolder && this.isDescendantOf(targetId, id)) continue;

      const oldParentId = item.parent;
      // 旧父级 children 移除
      if (oldParentId) {
        const oldParent = this.getFolderById(oldParentId);
        if (oldParent?.children?.includes(id)) {
          oldParent.children = oldParent.children.filter((x) => x !== id);
        }
      }
      // 新父级 children 追加
      if (!target.children) target.children = [];
      if (!target.children.includes(id)) target.children.push(id);
      // 本地改 parent
      item.parent = targetId;

      ipcRenderer.send('bookmarks-update', id, { parent: targetId });
    }

    if (movedSelected) this.selectedItems = [];
  }

  // ===== 移动弹窗 =====

  @action
  public openMoveDialog(ids: string[]) {
    if (!ids || ids.length === 0) return;
    // 过滤掉只读项
    const valid = ids.filter((id) => {
      const item = this.list.find((x) => x._id === id);
      return item && !this.isReadOnly(item);
    });
    if (valid.length === 0) return;

    this.moveTargetIds = valid;
    // 默认目标:首项当前父级(main 友好)。
    const first = this.list.find((x) => x._id === valid[0]);
    this.moveTargetFolderId = first?.parent ?? null;
    // 禁选:被移动的文件夹自身 + 所有后代(防循环)。书签叶子无后代。
    const exclude = new Set<string>();
    for (const id of valid) {
      const item = this.list.find((x) => x._id === id);
      if (item?.isFolder) {
        exclude.add(id);
        this.getDescendantFolderIds(id).forEach((d) => exclude.add(d));
      }
    }
    this.moveExcludeIds = Array.from(exclude);

    this.dialogContent = 'move';
    this.resetFolderPicker(this.moveTargetFolderId);
    this.dialogVisible = true;
  }

  @action
  public confirmMove() {
    if (this.moveTargetFolderId) {
      this.moveItemsToFolder(this.moveTargetIds, this.moveTargetFolderId);
    }
    this.dialogVisible = false;
    this.moveTargetIds = [];
    this.moveTargetFolderId = null;
    this.moveExcludeIds = [];
  }

  // ===== 编辑弹窗文件夹面板 =====

  @action
  public openEditFolderPanel() {
    this.editFolderPanelOpen = true;
    this.resetFolderPicker(this.editParentFolderId);
  }

  @action
  public closeEditFolderPanel() {
    this.editFolderPanelOpen = false;
    this.folderPickerSearch = '';
  }

  @action
  public setEditParent(folderId: string | null) {
    this.editParentFolderId = folderId;
  }

  // 编辑某文件夹时,禁选=自身+后代(防循环)。供 FolderPicker excludeIds 用。
  public getEditExcludeIds(): string[] {
    const item = this.currentBookmark;
    if (!item?.isFolder) return [];
    return [item._id, ...this.getDescendantFolderIds(item._id)];
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

  public getFolderPath(parent: string) {
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
