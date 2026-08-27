import { ipcRenderer } from 'electron';
import { action, makeObservable, observable } from 'mobx';
import { IDownloadItem } from '~/interfaces';
import { DialogStore } from '~/models/dialog-store';

export class Store extends DialogStore {
  public downloads: IDownloadItem[] = [];

  public maxHeight = 0;

  public constructor() {
    super();

    makeObservable(this, { downloads: observable, maxHeight: observable });

    this.init();

    ipcRenderer.on('download-started', (e, item) => {
      this.downloads.push(item);
    });

    ipcRenderer.on('download-progress', (e, item: IDownloadItem) => {
      const index = this.downloads.findIndex((x) => x.id === item.id);
      if (index === -1) return;

      // 完成/取消是终态。旧的进度事件可能在 IPC 队列中晚于终态事件到达，
      // 不能让它把已完成任务重新显示成暂停或下载中。
      if (this.isTerminal(this.downloads[index])) return;

      this.downloads[index] = {
        ...this.downloads[index],
        ...item,
      };
    });

    ipcRenderer.on('download-completed', (e, id: string) => {
      const index = this.downloads.findIndex((x) => x.id === id);
      if (index === -1) return;
      this.downloads[index] = {
        ...this.downloads[index],
        completed: true,
        canceled: false,
        paused: false,
        interrupted: false,
        retrying: false,
        speedBytesPerSecond: 0,
      };
    });

    ipcRenderer.on('download-paused', (e, id: string) => {
      const i = this.downloads.find((x) => x.id === id);
      if (!i || this.isTerminal(i)) return;
      i.paused = true;
    });

    ipcRenderer.on('download-canceled', (e, id: string) => {
      const i = this.downloads.find((x) => x.id === id);
      if (!i) return;
      i.completed = false;
      i.canceled = true;
    });

    ipcRenderer.on('download-removed', (e, id: string) => {
      this.downloads = this.downloads.filter((x) => x.id !== id);
    });

    ipcRenderer.on(
      'download-open-when-done-change',
      (e, item: IDownloadItem) => {
        const index = this.downloads.findIndex((x) => x.id === item.id);
        if (index === -1) return;
        this.downloads[index].openWhenDone = item.openWhenDone;
      },
    );

    ipcRenderer.on('max-height', (e, height) => {
      this.maxHeight = height;
    });
  }

  public async init() {
    const snapshot: IDownloadItem[] = await ipcRenderer.invoke('get-downloads');
    if (!Array.isArray(snapshot)) return;

    // init 与 IPC 推送并行：不能用较早的快照整体替换其间已收到的完成事件。
    // 以实时列表为基准保留终态，并补齐快照中的其它任务。
    const currentById = new Map(this.downloads.map((item) => [item.id, item]));
    this.downloads = snapshot.map((item) => {
      const current = currentById.get(item.id);
      return current && this.isTerminal(current) ? current : item;
    });

    for (const current of this.downloads) currentById.delete(current.id);
    this.downloads.push(...currentById.values());
  }

  private isTerminal(item: IDownloadItem): boolean {
    return !!item.completed || !!item.canceled;
  }

  @action
  public openMenu(item: IDownloadItem) {
    const state = item.menuIsOpen;
    this.closeAllDownloadMenu();
    const index = this.downloads.indexOf(
      this.downloads.find((x) => x.id === item.id),
    );

    this.downloads[index] = {
      ...this.downloads[index],
      menuIsOpen: !state,
    };
  }

  @action
  public closeAllDownloadMenu() {
    const downloads = this.downloads.map((download) => ({
      ...download,
      menuIsOpen: false,
    }));
    this.downloads = downloads;
  }
}

export default new Store();
