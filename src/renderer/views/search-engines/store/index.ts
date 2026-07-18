import { ipcRenderer } from 'electron';
import * as remote from '@electron/remote';
import { DialogStore } from '~/models/dialog-store';
import { getWebUIURL } from '~/common/webui';

export class Store extends DialogStore {
  public constructor() {
    // 持久弹窗:启动预加载、常驻复用,自己处理 visible 事件,实现秒开
    super({ persistent: true, visibilityWrapper: false });

    ipcRenderer.on('visible', (e, flag) => {
      this.visible = flag;
    });
  }

  // 切换搜索引擎:交由主进程统一处理(持久化 + 结果页带词重搜),随后关闭弹窗
  public async switchEngine(index: number) {
    const win = remote.getCurrentWindow();
    await ipcRenderer.invoke(`switch-search-engine-${win.id}`, index);
    this.hide();
  }

  // 打开设置页的「地址栏」分区,随后关闭弹窗
  public openSettings() {
    ipcRenderer.send(`add-tab-${this.windowId}`, {
      url: `${getWebUIURL('settings')}?section=address-bar`,
      active: true,
    });
    this.hide();
  }
}

export default new Store();

