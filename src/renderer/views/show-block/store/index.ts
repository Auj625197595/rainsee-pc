import {ipcRenderer} from 'electron';
import {makeObservable, observable} from 'mobx';
import {DialogStore} from '~/models/dialog-store';

export class Store extends DialogStore {
  public list: any[] = [];
  public filterCount = 0;
  public domain = '';
  public siteEnabled = true;
  public toggling = false;

  public constructor() {
    super({persistent: true, visibilityWrapper: false});
    makeObservable(this, {
      list: observable,
      filterCount: observable,
      domain: observable,
      siteEnabled: observable,
      toggling: observable,
    });
    (async () => {
      this.filterCount = await ipcRenderer.invoke('get-ad-filter-count');
    })();

    // 持久弹窗：显示与数据都通过 'visible' 事件下发，隐藏后由主进程回收。
    ipcRenderer.on('visible', async (e, flag, data) => {
      this.visible = flag;
      if (!flag || !data) return;
      this.list = data.data || [];
      // data.count 是该 tab 命中时记录的规则数；为 0 时(本页未命中)回退到引擎真实总数
      if (data.count) {
        this.filterCount = data.count;
      } else {
        this.filterCount = await ipcRenderer.invoke('get-ad-filter-count');
      }
      if (typeof data.domain === 'string') this.domain = data.domain;
      if (typeof data.siteEnabled === 'boolean') this.siteEnabled = data.siteEnabled;
    });
  }

  public async toggleSite() {
    if (!this.domain || this.toggling) return;
    this.toggling = true;
    try {
      const enabled = await ipcRenderer.invoke('toggle-site-adblock', this.domain);
      this.siteEnabled = enabled;
    } finally {
      this.toggling = false;
    }
  }
}

export default new Store();
