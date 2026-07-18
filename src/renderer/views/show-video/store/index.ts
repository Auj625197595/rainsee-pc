// 导入 electron 的 ipcRenderer 模块
import { ipcRenderer } from 'electron';
// 导入 mobx 中的 makeObservable 和 observable 方法
import { makeObservable, observable } from 'mobx';
// 导入自定义的 DialogStore 类
import { DialogStore } from '~/models/dialog-store';

// 创建 Store 类，并继承自 DialogStore 类
export class Store extends DialogStore {
  // 定义属性 videoUrls，默认为空数组
  public videoUrls: string[] = [];
  // 定义属性 tabId，默认为0
  public tabId: number = 0;

  // 构造函数
  public constructor() {
    // 调用父类的构造函数
    super();

    // 使用 mobx 的 makeObservable 方法，将属性 videoUrls 和 tabId 设为可观察
    makeObservable(this, {
      videoUrls: observable,
      tabId: observable,
    });

    // 监听名为 'data' 的事件，并在触发时更新 videoUrls 和 tabId 属性的值
    ipcRenderer.on('data', async (e, data) => {
      // 从传入的数据中获取 videoUrls 和 tabId，并赋值给相应的属性
      const { videoUrls, tabId } = data;
      this.videoUrls = videoUrls;
      this.tabId = tabId;
    });
  }
}

// 导出 Store 类的一个实例
export default new Store();
