// 导入 electron 的 ipcRenderer 模块
import { ipcRenderer } from 'electron';
// 导入 mobx 中的 makeObservable 和 observable 方法
import { makeObservable, observable } from 'mobx';
// 导入自定义的 DialogStore 类
import { DialogStore } from '~/models/dialog-store';

// 创建 Store 类，并继承自 DialogStore 类
export class Store extends DialogStore {
  // 定义属性 alwaysOnTop，默认为 false
  public alwaysOnTop = false;

  // 构造函数
  public constructor() {
    // 持久弹窗自己处理 visible 事件；隐藏后由主进程统一回收。
    super({persistent: true, visibilityWrapper: false});

    // 使用 mobx 的 makeObservable 方法，将属性 alwaysOnTop 设为可观察
    makeObservable(this, {
      alwaysOnTop: observable,
    });

    // 初始化
    this.init();

    // 持久弹窗每次显示时重新拉取需刷新的状态（alwaysOnTop 等）
    ipcRenderer.on('visible', (e, flag, data) => {
      this.visible = flag;
      if (flag) this.init(data);
    });

  }

  // 异步初始化方法
  public async init(data?: {alwaysOnTop?: boolean}) {
    if (typeof data?.alwaysOnTop === 'boolean') {
      this.alwaysOnTop = data.alwaysOnTop;
    }

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
