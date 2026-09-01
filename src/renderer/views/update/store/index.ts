import { ipcRenderer } from 'electron';
import { makeObservable, observable } from 'mobx';
import { createLocaleTranslator } from '~/common/i18n';
import { DialogStore } from '~/models/dialog-store';

export class Store extends DialogStore {
  public version = '';
  public currentVersion = '';
  public notes = '';
  public mandatory = false;

  // 状态: idle(待更新) | downloading(下载中) | downloaded(待安装) | error(失败)
  public status: 'idle' | 'downloading' | 'downloaded' | 'error' = 'idle';
  public progress = 0;
  public errorMsg = '';

  public constructor() {
    super({ persistent: true, visibilityWrapper: false });
    makeObservable(this, {
      version: observable,
      currentVersion: observable,
      notes: observable,
      mandatory: observable,
      status: observable,
      progress: observable,
      errorMsg: observable,
    });

    // 持久弹窗: 每次显示拉取更新详情
    ipcRenderer.on('visible', async (e, flag) => {
      this.visible = flag;
      if (flag) {
        await this.loadInfo();
      }
    });

    ipcRenderer.on('update-download-progress', (e, p) => {
      this.status = 'downloading';
      this.progress = Math.round(p.percent || 0);
    });

    ipcRenderer.on('update-downloaded', () => {
      this.status = 'downloaded';
      this.progress = 100;
    });

    ipcRenderer.on('update-error', (e, msg) => {
      this.status = 'error';
      this.errorMsg =
        msg ||
        createLocaleTranslator(this.settings.language)('updFailed');
    });
  }

  public async loadInfo() {
    const info = await ipcRenderer.invoke('get-update-info');
    this.version = info.version || '';
    this.currentVersion = info.currentVersion || '';
    this.notes = info.notes || '';
    this.mandatory = !!info.mandatory;
  }

  public async startUpdate() {
    if (this.status === 'downloading') return;
    this.status = 'downloading';
    this.progress = 0;
    this.errorMsg = '';
    const res = await ipcRenderer.invoke('start-update');
    if (res && !res.ok) {
      this.status = 'error';
      this.errorMsg =
        res.error ||
        createLocaleTranslator(this.settings.language)('updFailed');
    }
  }

  public async skipVersion() {
    await ipcRenderer.invoke('skip-update-version');
    this.hide();
  }

  public async installNow() {
    await ipcRenderer.invoke('quit-and-install');
  }
}

export default new Store();
