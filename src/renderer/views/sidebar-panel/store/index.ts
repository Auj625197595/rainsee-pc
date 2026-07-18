import { ipcRenderer } from 'electron';
import { action, observable, makeObservable } from 'mobx';
import { DialogStore } from '~/models/dialog-store';

export interface IPanelTab {
  id: number;
  title: string;
  url: string;
  favicon: string;
  selected: boolean;
  loading?: boolean;
  pinned?: boolean;
  groupId: number;
  groupColor?: string;
  groupName?: string;
  groupNameRaw?: string;
}

// 侧边栏缩放模式悬停浮层的渲染端 store。payload 由宿主(app.html)经主进程透传:
// { side, pinned, groupsCollapsed:{[gid]:bool}, tabs:[...], x,y,width,height }。
// 交互(选中/关闭/新建/折叠分组/切回固定)经 IPC 回传宿主执行——浮层是独立
// webContents,不持有宿主 mobx store。与 tabgroup-preview 完全同构。
export class Store extends DialogStore {
  public side: 'left' | 'right' = 'left';
  public pinned = false;
  public palette: string[] = [];
  public groupsCollapsed: { [gid: number]: boolean } = {};
  public tabs: IPanelTab[] = [];
  public linkDropTargetId = -1;
  public linkDropBefore = false;
  public linkDropGroupId = -1;
  // 每次「隐藏→显示」自增,作为 React key 重放滑入动画;refresh(持续 visible)不自增。
  public showSeq = 0;

  public constructor() {
    // persistent + 不用 visibilityWrapper(自己监听 'visible')+ 不在失焦时自动隐藏
    // (显隐由鼠标进出 + 宿主定时器管理)。
    super({ visibilityWrapper: false, persistent: true, hideOnBlur: false });

    makeObservable(this, {
      side: observable,
      pinned: observable,
      palette: observable,
      groupsCollapsed: observable,
      tabs: observable,
      linkDropTargetId: observable,
      linkDropBefore: observable,
      linkDropGroupId: observable,
      setLinkDropTarget: action,
      setLinkDropGroup: action,
      clearLinkDrop: action,
      showSeq: observable,
    });

    ipcRenderer.on('visible', (e, flag: boolean, payload: any) => {
      if (flag && payload) {
        this.side = payload.side || 'left';
        this.pinned = !!payload.pinned;
        this.palette = payload.palette || [];
        this.groupsCollapsed = payload.groupsCollapsed || {};
        this.tabs = payload.tabs || [];
        this.clearLinkDrop();
        if (!this.visible) this.showSeq += 1; // 仅真正打开时重放动画
        this.visible = true;
      } else {
        this.clearLinkDrop();
        this.visible = false;
      }
    });
  }

  public setLinkDropTarget(targetId: number, before: boolean) {
    if (this.linkDropGroupId !== -1) this.linkDropGroupId = -1;
    if (this.linkDropTargetId !== targetId) this.linkDropTargetId = targetId;
    if (this.linkDropBefore !== before) this.linkDropBefore = before;
  }

  public setLinkDropGroup(groupId: number) {
    if (this.linkDropTargetId !== -1) this.linkDropTargetId = -1;
    if (this.linkDropGroupId !== groupId) this.linkDropGroupId = groupId;
  }

  public clearLinkDrop() {
    this.linkDropTargetId = -1;
    this.linkDropBefore = false;
    this.linkDropGroupId = -1;
  }

  // 把交互动作回传宿主执行(经主进程转发到 app.html)。
  public action(payload: any) {
    ipcRenderer.send('sidebar-panel-action', payload);
  }

  public notifyEnter() {
    ipcRenderer.send('sidebar-panel-enter');
  }

  public notifyLeave() {
    ipcRenderer.send('sidebar-panel-leave');
  }
}

export default new Store();
