import { ipcRenderer } from 'electron';
import { action, makeObservable, observable } from 'mobx';
import { IBookmark } from '~/interfaces';
import * as React from 'react';
import { createLocaleTranslator } from '~/common/i18n';
import { DialogStore } from '~/models/dialog-store';

const COLLAPSED_DIALOG_HEIGHT = 408;
const EXPANDED_DIALOG_HEIGHT = 626;
const FOLDER_COLLAPSED_DIALOG_HEIGHT = 344;
const FOLDER_EXPANDED_DIALOG_HEIGHT = 562;

// 记住上次选择的保存文件夹(localStorage 属弹窗自身 webContents,跨会话持久)。
const LAST_FOLDER_KEY = 'add-bookmark.last-folder-id';

const getFolderLabel = (item: IBookmark, tr?: (key: any) => string) => {
  if (!item?.static) return item?.title || '';
  const t =
    tr || createLocaleTranslator(undefined);
  if (item.static === 'main') return t('bookmarkBar');
  if (item.static === 'mobile') return t('mobileDeviceBookmarks');
  if (item.static === 'other') return t('bookmarksOtherFolder');
  return item.title || '';
};

export class Store extends DialogStore {
  public titleRef = React.createRef<HTMLInputElement>();

  public urlRef = React.createRef<HTMLInputElement>();

  public bookmark: IBookmark;

  public pageTitle = '';

  public pageUrl = '';

  public pageFavicon = '';

  public addingToHomepage = false;

  // Observable

  public folders: IBookmark[] = [];

  public dialogTitle = '';

  public currentFolder: IBookmark = null;

  public folderSearch = '';

  public expandedFolderIds: string[] = [];

  public folderPanelOpen = false;

  public constructor() {
    super({persistent: true, visibilityWrapper: false});

    (async () => {
      await this.refreshFolders();
      this.currentFolder = this.folders.find((x) => x.static === 'main') || null;
      this.syncExpandedFolders();
      this.resizeDialog(false);
    })();

    makeObservable(this, {
      folders: observable,
      dialogTitle: observable,
      currentFolder: observable,
      folderSearch: observable,
      expandedFolderIds: observable,
      folderPanelOpen: observable,
      addingToHomepage: observable,
      setFolderSearch: action,
      toggleFolderExpanded: action,
      expandAllFolders: action,
      collapseAllFolders: action,
      setCurrentFolder: action,
      openFolderPanel: action,
      closeFolderPanel: action,
    });

    // 持久弹窗：显示与数据都通过 'visible' 事件下发，隐藏后由主进程回收。
    ipcRenderer.on('visible', async (e, flag, data) => {
      this.visible = flag;
      if (!flag || !data) return;
      const { bookmark, title, url, favicon, folderId } = data;

      this.dialogTitle = !bookmark
        ? createLocaleTranslator(this.settings.language)('abmAdded')
        : createLocaleTranslator(this.settings.language)('abmEditBookmark');
      this.folderSearch = '';
      this.folderPanelOpen = false;
      this.addingToHomepage = false;
      this.pageTitle = title || '';
      this.pageUrl = url || '';
      this.pageFavicon = favicon || '';

      this.bookmark = bookmark;
      await this.refreshFolders();
      const mainFolder = this.folders.find((x) => x.static === 'main') || null;

      if (!this.bookmark) {
        // 从书签栏空白处新增时优先保存到当前展示目录；其它入口仍记住上次选择。
        let parentFolder = folderId
          ? this.folders.find((x) => x._id === folderId) || mainFolder
          : mainFolder;
        if (!folderId) {
          try {
            const lastId = localStorage.getItem(LAST_FOLDER_KEY);
            if (lastId) {
              parentFolder =
                this.folders.find((x) => x._id === lastId) || mainFolder;
            }
          } catch {
            // localStorage 不可用则回退默认
          }
        }
        if (!parentFolder?._id) return;
        this.bookmark = await ipcRenderer.invoke('bookmarks-add', {
          title,
          url,
          favicon,
          parent: parentFolder._id,
        });
      }

      this.currentFolder = this.folders.find(
        (x) => x._id === this.bookmark.parent,
      ) || mainFolder;
      this.syncExpandedFolders();
      this.resizeDialog(false);

      if (this.titleRef.current) {
        this.titleRef.current.value = title;
        this.titleRef.current.focus();
        this.titleRef.current.select();
      }

      if (this.urlRef.current) {
        this.urlRef.current.value = url || '';
      }
    });
  }

  // 含「移动设备书签」整棵子树:收藏时可选择保存到移动端目录(经 v3 云服务
  // mobile scope 双向同步回手机)。
  public async refreshFolders() {
    this.folders = await ipcRenderer.invoke('bookmarks-get-folders', true);
  }

  public getFolderLabel(item: IBookmark) {
    return getFolderLabel(
      item,
      createLocaleTranslator(this.settings.language),
    );
  }

  public getFolderById(id: string) {
    return this.folders.find((x) => x._id === id) || null;
  }

  public getRootFolders() {
    return this.folders
      .filter((x) => x.parent == null)
      .slice()
      .sort((a, b) => a.order - b.order);
  }

  public getFolderChildren(parentId: string) {
    return this.folders
      .filter((x) => x.parent === parentId)
      .slice()
      .sort((a, b) => a.order - b.order);
  }

  public getFolderPath(folderId: string) {
    const path: IBookmark[] = [];
    let current = this.getFolderById(folderId);

    while (current) {
      path.unshift(current);
      if (!current.parent) break;
      current = this.getFolderById(current.parent);
    }

    return path;
  }

  public setFolderSearch(value: string) {
    this.folderSearch = value;
  }

  public setCurrentFolder(folder: IBookmark) {
    if (!folder) return;
    this.currentFolder = folder;
    this.expandPath(folder._id);
    try {
      localStorage.setItem(LAST_FOLDER_KEY, folder._id);
    } catch {
      // localStorage 不可用时静默忽略,记忆功能退化但不影响收藏
    }
  }

  public openFolderPanel() {
    this.folderPanelOpen = true;
    this.resizeDialog(true);
  }

  public closeFolderPanel() {
    this.folderPanelOpen = false;
    this.resizeDialog(false);
  }

  public isFolderExpanded(folderId: string) {
    return (
      this.folderSearch.trim() !== '' ||
      this.expandedFolderIds.includes(folderId)
    );
  }

  public toggleFolderExpanded(folderId: string) {
    if (this.expandedFolderIds.includes(folderId)) {
      this.expandedFolderIds = this.expandedFolderIds.filter(
        (id) => id !== folderId,
      );
      return;
    }

    this.expandedFolderIds = [...this.expandedFolderIds, folderId];
  }

  public expandAllFolders() {
    this.expandedFolderIds = this.folders.map((x) => x._id);
  }

  public collapseAllFolders() {
    this.expandedFolderIds = this.getRootFolders().map((x) => x._id);
  }

  public async addToHomepage() {
    const title = (this.titleRef.current?.value || this.bookmark?.title || this.pageTitle || '').trim();
    const url = (this.bookmark?.url || this.pageUrl || '').trim();

    if (!title || !url || this.addingToHomepage) return false;

    this.addingToHomepage = true;

    try {
      await ipcRenderer.invoke('add-to-homepage', {
        action: 'add',
        id: Date.now(),
        title,
        url,
        icon: this.bookmark?.favicon || this.pageFavicon || '',
        addedAt: new Date().toISOString(),
      });
      return true;
    } finally {
      this.addingToHomepage = false;
    }
  }

  private expandPath(folderId: string) {
    const pathIds = this.getFolderPath(folderId)
      .slice(0, -1)
      .map((x) => x._id);

    this.expandedFolderIds = Array.from(
      new Set([...this.expandedFolderIds, ...pathIds]),
    );
  }

  private syncExpandedFolders() {
    const currentPathIds = this.currentFolder
      ? this.getFolderPath(this.currentFolder._id)
          .slice(0, -1)
          .map((x) => x._id)
      : [];

    const next = new Set<string>([
      ...this.getRootFolders().map((x) => x._id),
      ...currentPathIds,
    ]);

    this.expandedFolderIds
      .filter((id) => this.getFolderById(id))
      .forEach((id) => next.add(id));

    this.expandedFolderIds = Array.from(next);
  }

  private resizeDialog(expanded: boolean) {
    const isFolder = this.bookmark?.isFolder;
    const collapsedHeight = isFolder
      ? FOLDER_COLLAPSED_DIALOG_HEIGHT
      : COLLAPSED_DIALOG_HEIGHT;
    const expandedHeight = isFolder
      ? FOLDER_EXPANDED_DIALOG_HEIGHT
      : EXPANDED_DIALOG_HEIGHT;

    this.send(
      'resize-dialog',
      expanded ? expandedHeight : collapsedHeight,
    );
  }
}

export default new Store();
