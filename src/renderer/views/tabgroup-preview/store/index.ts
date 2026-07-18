import { ipcRenderer } from 'electron';
import { observable, makeObservable } from 'mobx';
import { DialogStore } from '~/models/dialog-store';

export interface IPreviewTab {
  id: number;
  title: string;
  favicon: string;
  selected: boolean;
  loading?: boolean;
}

// 标签组悬停列表弹窗的渲染端 store。payload 由宿主(app.html)经主进程透传:
// {groupId, groupName, groupColor, tabs:[...], x, y, width, height}。交互(选中/
// 关闭/右键/拖拽排序/鼠标进出)通过 IPC 回传宿主执行——弹窗是独立 webContents,
// 不持有宿主的 mobx store。
export class Store extends DialogStore {
  public groupId = -1;
  public groupName = '';
  public groupColor = '#3b82f6';
  public palette: string[] = [];
  public tabs: IPreviewTab[] = [];

  public constructor() {
    // persistent + 不用 visibilityWrapper(自己监听 'visible') + 不在失焦时自动隐藏
    // (悬停弹窗的显隐完全由鼠标进出 + 宿主定时器管理,避免与右键菜单等交互打架)。
    super({ visibilityWrapper: false, persistent: true, hideOnBlur: false });

    makeObservable(this, {
      groupId: observable,
      groupName: observable,
      groupColor: observable,
      palette: observable,
      tabs: observable,
    });

    ipcRenderer.on('visible', (e, flag: boolean, payload: any) => {
      if (flag && payload) {
        this.groupId = payload.groupId;
        this.groupName = payload.groupName || '';
        this.groupColor = payload.groupColor || '#3b82f6';
        this.palette = payload.palette || [];
        this.tabs = payload.tabs || [];
        this.visible = true;
      } else {
        this.visible = false;
      }
    });
  }

  // 把交互动作回传宿主执行(经主进程转发到 app.html)。附带 groupId,供宿主校验
  // 「只对当前预览的组」生效(防止弹窗已切组时旧消息误操作)。
  public action(payload: any) {
    ipcRenderer.send('tabgroup-preview-action', {
      ...payload,
      groupId: this.groupId,
    });
  }

  public notifyEnter() {
    ipcRenderer.send('tabgroup-preview-enter');
  }

  // 色盘(原生 color picker)打开期间抑制 leave,否则鼠标移向系统取色窗会触发
  // 鼠标离开 → 弹窗被收起,取色中断。
  public pickingColor = false;

  // 改名输入框聚焦期间抑制 leave,否则鼠标略微移出弹窗即收起,输入中断。
  public editingName = false;

  public notifyLeave() {
    if (this.pickingColor || this.editingName) return;
    ipcRenderer.send('tabgroup-preview-leave');
  }
}

export default new Store();
