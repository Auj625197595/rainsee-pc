import { action, computed, makeObservable, observable } from 'mobx';
import { ISettings, ITheme } from '~/interfaces';
import { getTheme } from '~/utils/themes';
import { ipcRenderer } from '~/common/renderer-ipc';

export type FlagSelection = 'default' | 'enabled' | 'disabled';
export type FlagsTab = 'available' | 'unavailable';

export interface IFlagItem {
  key: string;
  title: string;
  description: string;
  permalink: string;
  supportedPlatforms: string[];
  defaultSelection: FlagSelection;
  selected: FlagSelection;
  available: boolean;
}

interface IFlagsPayload {
  version: {
    electron: string;
    chromium: string;
  };
  tabs: {
    available: IFlagItem[];
    unavailable: IFlagItem[];
  };
  needsRestart: boolean;
}

export class Store {
  @observable
  public settings: ISettings = { ...(window as any).settings };

  @observable
  public search = '';

  @observable
  public selectedTab: FlagsTab = 'available';

  @observable
  public available: IFlagItem[] = [];

  @observable
  public unavailable: IFlagItem[] = [];

  @observable
  public needsRestart = false;

  @observable
  public chromiumVersion = '';

  @observable
  public electronVersion = '';

  @observable
  public loading = false;

  @observable
  public highlightedKey = '';

  public constructor() {
    makeObservable(this);

    (window as any).updateSettings = (settings: ISettings) => {
      this.settings = { ...this.settings, ...settings };
    };

    this.load();
    this.syncHash();
    window.addEventListener('hashchange', this.syncHash);
  }

  @computed
  public get theme(): ITheme {
    return getTheme(this.settings.theme);
  }

  @computed
  public get filteredAvailable(): IFlagItem[] {
    return this.filterItems(this.available);
  }

  @computed
  public get filteredUnavailable(): IFlagItem[] {
    return this.filterItems(this.unavailable);
  }

  @computed
  public get visibleItems(): IFlagItem[] {
    return this.selectedTab === 'available'
      ? this.filteredAvailable
      : this.filteredUnavailable;
  }

  @computed
  public get activeCount(): number {
    return this.visibleItems.length;
  }

  private syncHash = () => {
    this.highlightedKey = decodeURIComponent(
      (window.location.hash || '').replace(/^#/, ''),
    ).trim();
  };

  private filterItems(list: IFlagItem[]) {
    const q = this.search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((item) => {
      const platforms = item.supportedPlatforms.join(' ').toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        item.key.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        platforms.includes(q)
      );
    });
  }

  @action
  public setSearch(value: string) {
    this.search = value;
  }

  @action
  public setTab(tab: FlagsTab) {
    this.selectedTab = tab;
  }

  @action
  public async load() {
    this.loading = true;
    try {
      const payload = (await ipcRenderer.invoke('flags-get')) as IFlagsPayload;
      this.applyPayload(payload);
    } finally {
      this.loading = false;
    }
  }

  @action
  public async setFlag(key: string, selection: FlagSelection) {
    const payload = (await ipcRenderer.invoke(
      'flags-set',
      key,
      selection,
    )) as IFlagsPayload;
    this.applyPayload(payload);
  }

  @action
  public async resetAll() {
    const payload = (await ipcRenderer.invoke('flags-reset-all')) as IFlagsPayload;
    this.applyPayload(payload);
  }

  @action
  private applyPayload(payload: IFlagsPayload) {
    this.available = payload?.tabs?.available || [];
    this.unavailable = payload?.tabs?.unavailable || [];
    this.needsRestart = !!payload?.needsRestart;
    this.chromiumVersion = payload?.version?.chromium || '';
    this.electronVersion = payload?.version?.electron || '';
  }
}

export default new Store();
