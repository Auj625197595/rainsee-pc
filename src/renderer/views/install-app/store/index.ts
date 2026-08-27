import { ipcRenderer } from 'electron';
import { DialogStore } from '~/models/dialog-store';

// PWA 安装与小号快捷方式共用的确认弹窗 store。
// 主进程经 visible 下发模式、名称和图标，确认时按模式调用对应 IPC。
export class Store extends DialogStore {
  // 显示态字段:仅随 visible 翻转(observable)同步赋值,触发重渲染,故可为普通字段。
  public mode: 'pwa' | 'profile' = 'pwa';
  public name = '应用';
  public publisher = '';
  public iconUrl = '';
  public fallbackIconUrl = '';
  public startUrl = '';
  public themeColor = '';
  public installed = false;

  public constructor() {
    // 持久弹窗自己处理 visible(含 data 载荷)，隐藏后由主进程回收。
    super({ persistent: true, visibilityWrapper: false, hideOnBlur: false });

    ipcRenderer.on('visible', (e, flag, data) => {
      if (flag && data) {
        this.mode = data.mode === 'profile' ? 'profile' : 'pwa';
        this.name = data.name || '应用';
        this.publisher = data.publisher || '';
        this.iconUrl = data.iconUrl || '';
        this.fallbackIconUrl = data.fallbackIconUrl || '';
        this.startUrl = data.startUrl || '';
        this.themeColor = data.themeColor || '';
        this.installed = !!data.installed;
      }
      this.visible = flag;
    });
  }

  // desktop/startMenu 控制快捷方式位置，localIconPath 为可选自定义图标。
  public async confirm(opts: {
    desktop: boolean;
    startMenu: boolean;
    localIconPath?: string;
  }) {
    try {
      return await ipcRenderer.invoke(
        this.mode === 'profile'
          ? `profile-shortcut-confirm-${this.windowId}`
          : `pwa-install-confirm-${this.windowId}`,
        opts,
      );
    } catch {
      return false;
    }
  }

  public async selectIcon(): Promise<{ path: string; dataUrl: string } | null> {
    try {
      return await ipcRenderer.invoke(
        `pwa-install-select-icon-${this.windowId}`,
      );
    } catch {
      return null;
    }
  }

  public cancel() {
    ipcRenderer.send(`pwa-install-cancel-${this.windowId}`);
    this.hide();
  }
}

export default new Store();
