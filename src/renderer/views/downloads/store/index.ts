import { observable, computed, action, makeObservable } from 'mobx';

import { createLocaleTranslator } from '~/common/i18n';
import { ISettings, IDownloadItem, ITheme } from '~/interfaces';
import { getTheme } from '~/utils/themes';
import {ipcRenderer} from '~/common/renderer-ipc';
import {getWebUIContext} from '~/common/webui-context';

const webUIContext = getWebUIContext();

export type DownloadFilter = 'all' | 'active' | 'completed' | 'canceled';

export type DownloadStatus = 'active' | 'completed' | 'canceled';

export interface IDownloadGroup {
  key: DownloadStatus;
  title: string;
  items: IDownloadItem[];
}

const GROUP_TITLES: Record<DownloadStatus, 'dlvActive' | 'dlvCompleted' | 'dlvCanceled'> = {
  active: 'dlvActive',
  completed: 'dlvCompleted',
  canceled: 'dlvCanceled',
};

export class Store {
  @observable
  public settings: ISettings = { ...(webUIContext.settings as Partial<ISettings>) } as ISettings;

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
      .map((key) => ({
        key,
        title: createLocaleTranslator(this.settings.language)(
          GROUP_TITLES[key],
        ),
        items: buckets[key],
      }));
  }

  public countForFilter(filter: DownloadFilter): number {
    if (filter === 'all') return this.downloads.length;
    return this.downloads.filter((x) => this.statusOf(x) === filter).length;
  }

  public constructor() {
    makeObservable(this);

    ipcRenderer.on('update-settings', (_event, settings: ISettings) => {
      this.settings = { ...this.settings, ...settings };
    });

    this.load();

    // 下载进度事件发送到浏览器外壳窗口而非本标签页，因此通过轮询
    // get-downloads(主进程会原地更新该数组)来获取实时进度。
    setInterval(() => this.load(), 800);
  }

  public async load() {
    const list: IDownloadItem[] = await ipcRenderer.invoke('get-downloads');
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
    ipcRenderer.send('download-pause', item.id);
  }

  public resume(item: IDownloadItem) {
    ipcRenderer.send('download-resume', item.id);
  }

  public cancel(item: IDownloadItem) {
    ipcRenderer.send('download-cancel', item.id);
  }

  @action
  public remove(item: IDownloadItem) {
    ipcRenderer.send('download-remove', item.id);
    this.downloads = this.downloads.filter((x) => x.id !== item.id);
    this.lastJson = JSON.stringify(this.downloads);
  }

  // 清除列表中所有已完成 / 已取消的记录(不影响进行中的下载)。
  @action
  public clearFinished() {
    this.downloads
      .filter((x) => x.completed || x.canceled)
      .forEach((x) => ipcRenderer.send('download-remove', x.id));
    this.downloads = this.downloads.filter((x) => !x.completed && !x.canceled);
    this.lastJson = JSON.stringify(this.downloads);
  }

  public open(item: IDownloadItem) {
    return ipcRenderer.invoke('download-open', item.id);
  }

  public showInFolder(item: IDownloadItem) {
    return ipcRenderer.invoke('download-show-in-folder', item.id);
  }

  public createTask(pageUrl: string, fileName?: string) {
    return ipcRenderer.invoke('media-download-create', {pageUrl, fileName});
  }
}

export default new Store();
