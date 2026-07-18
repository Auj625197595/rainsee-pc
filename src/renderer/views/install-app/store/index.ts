import {ipcRenderer} from 'electron';
import {DialogStore} from '~/models/dialog-store';

// 地址栏 PWA 安装图标下方的安装确认弹窗(Edge 风格)的 store。
// 主进程经 'visible' 通道下发 {name,publisher,iconUrl,startUrl,themeColor,installed};
// 用户点「安装」→ invoke pwa-install-confirm-<windowId> 携带快捷方式选项;
// 点「取消」/关闭 → send pwa-install-cancel-<windowId>。
export class Store extends DialogStore {
  // 显示态字段:仅随 visible 翻转(observable)同步赋值,触发重渲染,故可为普通字段。
  public name = '应用';
  public publisher = '';
  public iconUrl = '';
  public startUrl = '';
  public themeColor = '';
  public installed = false;

  public constructor() {
    // 持久弹窗:启动预加载、常驻复用,自己处理 visible(含 data 载荷),实现秒开。
    super({persistent: true, visibilityWrapper: false});

    ipcRenderer.on('visible', (e, flag, data) => {
      this.visible = flag;
      if (flag && data) {
        this.name = data.name || '应用';
        this.publisher = data.publisher || '';
        this.iconUrl = data.iconUrl || '';
        this.startUrl = data.startUrl || '';
        this.themeColor = data.themeColor || '';
        this.installed = !!data.installed;
      }
    });
  }

  // 确认安装 / 重新打开。opts 里的 desktop/startMenu 控制是否创建快捷方式;
  // 已安装态重新打开时两项传 false(仅开窗口)。
  public async confirm(opts: {desktop: boolean; startMenu: boolean}) {
    try {
      await ipcRenderer.invoke(`pwa-install-confirm-${this.windowId}`, opts);
    } catch {
      // ignore
    }
    this.hide();
  }

  public cancel() {
    ipcRenderer.send(`pwa-install-cancel-${this.windowId}`);
    this.hide();
  }
}

export default new Store();
