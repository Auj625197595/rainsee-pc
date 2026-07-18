import {ipcRenderer} from 'electron';
import {observable, computed, action, makeObservable} from 'mobx';

import {DialogStore} from '~/models/dialog-store';
import {IExtItem} from '~/interfaces';
import {getWebUIURL} from '~/common/webui';
import {extensionMainChannel} from '~/common/rpc/extensions';

export class Store extends DialogStore {
  // 全部已安装且启用的扩展(含 popup/icon)。
  public extensions: IExtItem[] = [];

  // 打开列表时记录的锚点坐标(全部扩展按钮右下角),用于定位扩展 popup。
  public anchor = {x: 0, y: 0};

  // 本弹窗所属窗口是否无痕(由主进程在 open 时随 visible 事件下发)。
  // 无痕模式下只展示允许在无痕运行的扩展,与地址栏 pinned 图标过滤一致。
  public incognito = false;

  public constructor() {
    super({persistent: true, visibilityWrapper: false});

    makeObservable(this, {
      extensions: observable,
      anchor: observable,
      incognito: observable,
      pinned: computed,
      load: action,
    });

    this.load();

    // 持久弹窗每次显示时:刷新扩展列表并记录锚点坐标。
    ipcRenderer.on('visible', (e, flag, data) => {
      this.visible = flag;
      if (flag) {
        if (data) {
          this.anchor = {x: data.x, y: data.y};
          this.incognito = !!data.incognito;
        }
        this.load();
      }
    });
  }

  public async load() {
    const list: IExtItem[] = await ipcRenderer.invoke('extensions-get-detailed');
    if (!list) return;
    // 仅展示已启用的扩展;无痕窗口下进一步排除未获「在无痕模式运行」权限的扩展。
    this.extensions = list.filter(
      (x) => x.enabled && (!this.incognito || x.incognitoAllowed),
    );
  }

  public get pinned(): string[] {
    return this.settings.pinnedExtensions || [];
  }

  public isPinned(id: string): boolean {
    return this.pinned.includes(id);
  }

  public togglePin(id: string) {
    const pinned = this.pinned;
    const next = pinned.includes(id)
      ? pinned.filter((x) => x !== id)
      : [...pinned, id];

    this.settings = {...this.settings, pinnedExtensions: next};
    ipcRenderer.send('save-settings', {
      settings: JSON.stringify(this.settings),
    });
  }

  // 点击扩展行时复用地址栏扩展按钮(BrowserAction)的点击逻辑:
  // 有 popup 时走 show-extension-popup IPC 在锚点处渲染 popup BrowserView,
  // 无 popup 时派发 action click 触发 chrome.action.onClicked。
  public openExtensionAction(ext: IExtItem) {
    if (ext.popup) {
      ipcRenderer.send(
        `show-extension-popup-${this.windowId}`,
        this.anchor.x,
        this.anchor.y,
        ext.popup,
        false,
        ext.id,
      );
    } else {
      extensionMainChannel
        .getInvoker()
        .dispatchActionClick(ext.id, -1, {
          x: this.anchor.x,
          y: this.anchor.y,
          width: 0,
          height: 0,
        });
    }
    this.hide();
  }

  public openPopup(ext: IExtItem) {
    this.openExtensionAction(ext);
  }

  // 打开该扩展的选项页(options_page / options_ui)在新标签页中,并关闭列表弹窗。
  // ext.optionsUrl 为主进程组装好的 chrome-extension://<id>/<options> 完整 URL。
  public openOptions(ext: IExtItem) {
    if (!ext.optionsUrl) return;
    ipcRenderer.send(`add-tab-${this.windowId}`, {
      url: ext.optionsUrl,
      active: true,
    });
    this.hide();
  }

  // 打开「拓展」管理页(新标签页)。
  public openManager() {
    ipcRenderer.send(`add-tab-${this.windowId}`, {
      url: getWebUIURL('extensions'),
      active: true,
    });
    this.hide();
  }
}

export default new Store();
