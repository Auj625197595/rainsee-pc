import { observable, computed, action, makeObservable } from 'mobx';

import { ISettings, IDownloadItem, ITheme } from '~/interfaces';
import { getTheme } from '~/utils/themes';

// 下载页作为内部标签页运行(sandbox: true, nodeIntegration: false)，无法直接
// require('electron')。view-preload 暴露了纯函数桥 window.ipcInvoke / window.ipcSend
// (沙箱下嵌套对象的方法无法跨界传递，纯函数可以)，优先使用；并保留
// window.electron.ipcRenderer 作为兜底。
const w = window as any;
const ipcInvoke: (channel: string, ...args: any[]) => Promise<any> =
  w.ipcInvoke || ((channel, ...args) => w.electron.ipcRenderer.invoke(channel, ...args));
const ipcSend: (channel: string, ...args: any[]) => void =
  w.ipcSend || ((channel, ...args) => w.electron.ipcRenderer.send(channel, ...args));

export type DownloadFilter = 'all' | 'active' | 'completed' | 'canceled';

export type DownloadStatus = 'active' | 'completed' | 'canceled';

export interface IDownloadGroup {
  key: DownloadStatus;
  title: string;
  items: IDownloadItem[];
}

const GROUP_TITLES: Record<DownloadStatus, string> = {
  active: '正在下载',
  completed: '已完成',
  canceled: '已取消',
};

export class Store {
  @observable
  public settings: ISettings = { ...(window as any).settings };

  @observable
  public downloads: IDownloadItem[] = [];

  @observable
  public selectedFilter: DownloadFilter = 'all';

  @observable
  public searched = '';

  private lastJson = '';

  @computed
  public get theme(): ITheme {
    return getTheme(this.settings.theme);
  }

  public statusOf(item: IDownloadItem): DownloadStatus {
    if (item.canceled) return 'canceled';
    if (item.completed) return 'completed';
    return 'active';
  }

  private matchesSearch(item: IDownloadItem): boolean {
    if (this.searched === '') return true;
    return (item.fileName || '').toLowerCase().includes(this.searched);
  }

  // 最新下载排在最前面。
  @computed
  public get sections(): IDownloadGroup[] {
    const order: DownloadStatus[] = ['active', 'completed', 'canceled'];
    const buckets: Record<DownloadStatus, IDownloadItem[]> = {
      active: [],
      completed: [],
      canceled: [],
    };

    for (let i = this.downloads.length - 1; i >= 0; i--) {
      const item = this.downloads[i];
      if (!this.matchesSearch(item)) continue;
      buckets[this.statusOf(item)].push(item);
    }

    return order
      .filter(
        (key) =>
          (this.selectedFilter === 'all' || this.selectedFilter === key) &&
          buckets[key].length > 0,
      )
      .map((key) => ({ key, title: GROUP_TITLES[key], items: buckets[key] }));
  }

  public countForFilter(filter: DownloadFilter): number {
    if (filter === 'all') return this.downloads.length;
    return this.downloads.filter((x) => this.statusOf(x) === filter).length;
  }

  public constructor() {
    makeObservable(this);

    (window as any).updateSettings = (settings: ISettings) => {
      this.settings = { ...this.settings, ...settings };
    };

    this.load();

    // 下载进度事件发送到浏览器外壳窗口而非本标签页，因此通过轮询
    // get-downloads(主进程会原地更新该数组)来获取实时进度。
    setInterval(() => this.load(), 800);
  }

  public async load() {
    const list: IDownloadItem[] = await ipcInvoke('get-downloads');
    if (!list) return;

    const json = JSON.stringify(list);
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.downloads = list;
  }

  @action
  public search(str: string) {
    this.searched = str.toLowerCase();
  }

  public pause(item: IDownloadItem) {
    ipcSend('download-pause', item.id);
  }

  public resume(item: IDownloadItem) {
    ipcSend('download-resume', item.id);
  }

  public cancel(item: IDownloadItem) {
    ipcSend('download-cancel', item.id);
  }

  @action
  public remove(item: IDownloadItem) {
    ipcSend('download-remove', item.id);
    this.downloads = this.downloads.filter((x) => x.id !== item.id);
    this.lastJson = JSON.stringify(this.downloads);
  }

  // 清除列表中所有已完成 / 已取消的记录(不影响进行中的下载)。
  @action
  public clearFinished() {
    this.downloads
      .filter((x) => x.completed || x.canceled)
      .forEach((x) => ipcSend('download-remove', x.id));
    this.downloads = this.downloads.filter((x) => !x.completed && !x.canceled);
    this.lastJson = JSON.stringify(this.downloads);
  }
}

export default new Store();
