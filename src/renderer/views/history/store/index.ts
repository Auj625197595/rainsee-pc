import { observable, computed, action, makeObservable } from 'mobx';
import {
  ISettings,
  IHistoryItem,
  IHistorySection,
  IFavicon,
  ITheme,
} from '~/interfaces';
import { getTheme } from '~/utils/themes';
import { PreloadDatabase } from '~/preloads/models/database';
import { getSectionLabel, compareDates } from '../utils';
import {ipcRenderer} from '~/common/renderer-ipc';
import {getWebUIContext} from '~/common/webui-context';

const webUIContext = getWebUIContext();

export type QuickRange =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'last-week'
  | 'last-month'
  | 'older';

export class Store {
  public faviconsDb = new PreloadDatabase<IFavicon>('favicons');
  public historyDb = new PreloadDatabase<IHistoryItem>('history');

  // Observable

  @observable
  public settings: ISettings = { ...(webUIContext.settings as Partial<ISettings>) } as ISettings;

  @observable
  public items: IHistoryItem[] = [];

  @observable
  public itemsLoaded = this.getDefaultLoaded();

  @observable
  public selectedRange: QuickRange = 'all';

  @observable
  public searched = '';

  // 右上角「在新页面打开」勾选项。勾选→点标题在新标签打开;未勾选→当前页打开。
  // localStorage 持久化(与 extensions/store 的 DEV_MODE_KEY 同款,webUI 页可用)。
  @observable
  public openInNewTab =
    localStorage.getItem('history.openInNewTab') === '1';

  @action
  public setOpenInNewTab(value: boolean) {
    this.openInNewTab = value;
    localStorage.setItem('history.openInNewTab', value ? '1' : '0');
  }

  @observable
  public selectedItems: string[] = [];

  @observable
  public favicons: Map<string, string> = new Map();

  @computed
  public get theme(): ITheme {
    return getTheme(this.settings.theme);
  }

  @computed
  public get sections() {
    const list: IHistorySection[] = [];
    let section: IHistorySection;
    let loaded = 0;

    for (let i = this.items.length - 1; i >= 0; i--) {
      if (loaded > this.itemsLoaded) break;

      const item = this.items[i];
      const date = new Date(item.date);

      if (
        this.searched !== '' &&
        !item.title.toLowerCase().includes(this.searched) &&
        !item.url.includes(this.searched)
      ) {
        continue;
      }

      if (this.range) {
        if (date.getTime() >= this.range.max) continue;
        if (date.getTime() <= this.range.min) break;
      }

      if (compareDates(section && section.date, date)) {
        section.items.push(item);
      } else {
        section = {
          label: getSectionLabel(date),
          items: [item],
          date,
        };
        list.push(section);
      }

      loaded++;
    }

    return list;
  }

  @computed
  public get range() {
    const current = new Date();
    const day = current.getDate();
    const month = current.getMonth();
    const year = current.getFullYear();

    let minDate: Date;
    let maxDate: Date;

    switch (this.selectedRange) {
      case 'today': {
        minDate = new Date(year, month, day, 0, 0, 0, 0);
        maxDate = new Date(year, month, day, 23, 59, 59, 999);
        break;
      }
      case 'yesterday': {
        minDate = new Date(year, month, day - 1, 0, 0, 0, 0);
        maxDate = new Date(year, month, day - 1, 23, 59, 59, 999);
        break;
      }
      case 'last-week': {
        let currentDay = current.getDay() - 1;
        if (currentDay === -1) currentDay = 6;
        minDate = new Date(year, month, day - currentDay - 7, 0, 0, 0, 0);
        maxDate = new Date(year, month, day - currentDay - 1, 0, 0, 0, 0);
        break;
      }
      case 'last-month': {
        minDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
        maxDate = new Date(year, month, 0, 0, 0, 0, 0);
        break;
      }
      case 'older': {
        let currentDay = current.getDay() - 1;
        if (currentDay === -1) currentDay = 6;
        minDate = new Date(0);
        maxDate = new Date(year, month, day - currentDay - 7, 0, 0, 0, 0);
        break;
      }
    }

    return (
      this.selectedRange !== 'all' && {
        min: minDate.getTime(),
        max: maxDate.getTime(),
      }
    );
  }

  public constructor() {
    makeObservable(this);

    ipcRenderer.on('update-settings', (_event, settings: ISettings) => {
      this.settings = { ...this.settings, ...settings };
    });

    this.load();
    this.loadFavicons();

    window.addEventListener('resize', () => {
      const loaded = this.getDefaultLoaded();

      if (loaded > this.itemsLoaded) {
        this.itemsLoaded = loaded;
      }
    });
  }

  public resetLoadedItems(): void {
    this.itemsLoaded = this.getDefaultLoaded();
  }

  public getById(id: string): IHistoryItem {
    return this.items.find((x) => x._id === id);
  }

  private sortByDate(items: IHistoryItem[]): IHistoryItem[] {
    return (items || []).slice().sort((a, b) => {
      const aDate =
        typeof a.date === 'string' ? new Date(a.date).getTime() : a.date;
      const bDate =
        typeof b.date === 'string' ? new Date(b.date).getTime() : b.date;
      return aDate - bDate;
    });
  }

  private async fetchLocal(): Promise<IHistoryItem[]> {
    try {
      const list = await ipcRenderer.invoke('history-get');
      if (Array.isArray(list)) return list;
      const fallback = await this.historyDb.get({} as IHistoryItem);
      return this.sortByDate(fallback);
    } catch (e) {
      return [];
    }
  }

  @action
  private setItems(items: IHistoryItem[]) {
    // 云端合并可能刚追加了较早的记录；倒序分组前先统一按访问时间排序。
    this.items = this.sortByDate(items);
  }

  public async load() {
    // 先读取本地库立即渲染,避免等待网络导致列表迟迟不出来
    this.setItems(await this.fetchLocal());
  }

  public async loadFavicons() {
    (await this.faviconsDb.get({})).forEach((favicon) => {
      const { data } = favicon;

      if (this.favicons.get(favicon.url) == null) {
        this.favicons.set(favicon.url, data);
      }
    });
  }

  public clear() {
    ipcRenderer.send('history-remove', this.items.map((x) => x._id));
    this.items = [];
  }

  public removeItems(id: string[]) {
    this.items = this.items.filter((x) => id.indexOf(x._id) === -1);
    ipcRenderer.send('history-remove', [...id]);
  }

  @action
  public search(str: string) {
    this.searched = str.toLowerCase().toLowerCase();
    this.itemsLoaded = this.getDefaultLoaded();
  }

  public getDefaultLoaded() {
    return Math.floor(window.innerHeight / 48);
  }

  @action
  public deleteSelected() {
    this.removeItems(this.selectedItems);
    this.selectedItems = [];
  }
}

export default new Store();
