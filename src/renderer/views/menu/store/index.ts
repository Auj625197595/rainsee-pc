// 导入 electron 的 ipcRenderer 模块
import { ipcRenderer } from 'electron';
// 导入 mobx 中的 makeObservable 和 observable 方法
import { makeObservable, observable } from 'mobx';
// 导入自定义的 DialogStore 类
import { DialogStore } from '~/models/dialog-store';
// 导入 electron 远程模块
import * as remote from '@electron/remote';

// 创建 Store 类，并继承自 DialogStore 类
export class Store extends DialogStore {
  // 定义属性 alwaysOnTop，默认为 false
  public alwaysOnTop = false;
  // 定义属性 updateAvailable，默认为 false
  public updateAvailable = false;

  // 构造函数
  public constructor() {
    // 调用父类的构造函数（持久弹窗：启动预加载、常驻复用，自己处理 visible 事件）
    super({persistent: true, visibilityWrapper: false});

    // 使用 mobx 的 makeObservable 方法，将属性 alwaysOnTop 和 updateAvailable 设为可观察
    makeObservable(this, {
      alwaysOnTop: observable,
      updateAvailable: observable,
    });

    // 初始化
    this.init();

    // 持久弹窗每次显示时重新拉取需刷新的状态（alwaysOnTop 等）
    ipcRenderer.on('visible', (e, flag) => {
      this.visible = flag;
      if (flag) this.init();
    });

    // 监听名为 'update-available' 的事件，并在触发时将 updateAvailable 属性设为 true
    ipcRenderer.on('update-available', () => {
      this.updateAvailable = true;
    });
  }

  // 异步初始化方法
  public async init() {
    // 检查是否存在当前窗口，若存在则获取是否总在顶层的设置，并赋值给属性 alwaysOnTop
    if (remote.getCurrentWindow()) {
      this.alwaysOnTop = remote.getCurrentWindow().isAlwaysOnTop();
    }

    // 使用 ipcRenderer 发送名为 'is-update-available' 的请求，并等待返回值，将返回值赋值给属性 updateAvailable
    this.updateAvailable = await ipcRenderer.invoke('is-update-available');
  }

  // 异步保存方法
  public async save() {
    // 使用 ipcRenderer 发送名为 'save-settings' 的事件，携带 settings 属性的 JSON 字符串作为参数
    ipcRenderer.send('save-settings', {
      settings: JSON.stringify(this.settings),
    });
  }
}

// 导出 Store 类的一个实例
export default new Store();
