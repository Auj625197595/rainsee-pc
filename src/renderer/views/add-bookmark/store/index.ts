import { ipcRenderer } from 'electron';
import { action, makeObservable, observable } from 'mobx';
import { IBookmark } from '~/interfaces';
import * as React from 'react';
import { DialogStore } from '~/models/dialog-store';

const COLLAPSED_DIALOG_HEIGHT = 344;
const EXPANDED_DIALOG_HEIGHT = 562;

const getFolderLabel = (item: IBookmark) => {
  if (!item?.static) return item?.title || '';
  if (item.static === 'main') return '书签栏';
  if (item.static === 'mobile') return '移动设备书签';
  if (item.static === 'other') return '其它文件夹';
  return item.title || '';
};

export class Store extends DialogStore {
  public titleRef = React.createRef<HTMLInputElement>();

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

    // 持久弹窗：显示与数据都通过 'visible' 事件下发（弹窗已预加载，秒开后内容再渲染）
    ipcRenderer.on('visible', async (e, flag, data) => {
      this.visible = flag;
      if (!flag || !data) return;
      const { bookmark, title, url, favicon } = data;

      this.dialogTitle = !bookmark ? '书签已添加' : '编辑书签';
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
        if (!mainFolder?._id) return;
        this.bookmark = await ipcRenderer.invoke('bookmarks-add', {
          title,
          url,
          favicon,
          parent: mainFolder._id,
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
    });
  }

  public async refreshFolders() {
    this.folders = await ipcRenderer.invoke('bookmarks-get-folders');
  }

  public getFolderLabel(item: IBookmark) {
    return getFolderLabel(item);
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
    this.send(
      'resize-dialog',
      expanded ? EXPANDED_DIALOG_HEIGHT : COLLAPSED_DIALOG_HEIGHT,
    );
  }
}

export default new Store();
