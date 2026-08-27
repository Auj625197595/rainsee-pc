import { ipcRenderer } from 'electron';
import { action, observable, makeObservable } from 'mobx';
import { DialogStore } from '~/models/dialog-store';
import { TabHoverActivationBehavior, TabWheelBehavior } from '~/interfaces';
import { normalizeTabHoverActivationDelay } from '~/constants';

export interface IPanelTab {
  id: number;
  title: string;
  url: string;
  favicon: string;
  selected: boolean;
  loading?: boolean;
  discarded?: boolean;
  pinned?: boolean;
  groupId: number;
  groupColor?: string;
  groupName?: string;
  groupNameRaw?: string;
  groupPinned?: boolean;
}

// 侧边栏缩放模式悬停浮层的渲染端 store。payload 由宿主(app.html)经主进程透传:
// { side, pinned, groupsCollapsed:{[gid]:bool}, tabs:[...], x,y,width,height }。
// 交互(选中/关闭/新建/折叠分组/切回固定)经 IPC 回传宿主执行——浮层是独立
// webContents,不持有宿主 mobx store。与 tabgroup-preview 完全同构。
export class Store extends DialogStore {
  public side: 'left' | 'right' = 'left';
  public pinned = false;
  public palette: string[] = [];
  public closeTabOnRightClick = false;
  public tabCloseButtonDisplay: 'always' | 'hover' | 'never' = 'always';
  public tabWheelBehavior: TabWheelBehavior = 'auto';
  public tabHoverActivationBehavior: TabHoverActivationBehavior =
    'activate-and-switch';
  public tabHoverActivationDelay = 500;
  public groupsCollapsed: { [gid: number]: boolean } = {};
  public tabs: IPanelTab[] = [];
  public linkDropTargetId = -1;
  public linkDropBefore = false;
  public linkDropGroupId = -1;
  // 悬浮侧栏运行在独立 BrowserView，不能复用宿主侧栏的拖拽状态；在这里单独
  // 保存内部标签拖拽的源与落点，松手后再经 action 回传宿主完成真正的排序。
  public tabDragId = -1;
  public tabDropTargetId = -1;
  public tabDropBefore = false;
  public tabDropGroupId = -1;
  public groupDragId = -1;
  public groupDropTargetId = -1;
  public groupDropBefore = false;
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
      closeTabOnRightClick: observable,
      tabCloseButtonDisplay: observable,
      tabWheelBehavior: observable,
      tabHoverActivationBehavior: observable,
      tabHoverActivationDelay: observable,
      groupsCollapsed: observable,
      tabs: observable,
      linkDropTargetId: observable,
      linkDropBefore: observable,
      linkDropGroupId: observable,
      tabDragId: observable,
      tabDropTargetId: observable,
      tabDropBefore: observable,
      tabDropGroupId: observable,
      groupDragId: observable,
      groupDropTargetId: observable,
      groupDropBefore: observable,
      setLinkDropTarget: action,
      setLinkDropGroup: action,
      clearLinkDrop: action,
      startTabDrag: action,
      setTabDropTarget: action,
      setTabDropGroup: action,
      clearTabDrop: action,
      clearTabDrag: action,
      startGroupDrag: action,
      setGroupDropTarget: action,
      clearGroupDrag: action,
      showSeq: observable,
    });

    ipcRenderer.on('visible', (e, flag: boolean, payload: any) => {
      if (flag && payload) {
        this.side = payload.side || 'left';
        this.pinned = !!payload.pinned;
        this.palette = payload.palette || [];
        this.closeTabOnRightClick = !!payload.closeTabOnRightClick;
        this.tabCloseButtonDisplay =
          payload.tabCloseButtonDisplay === 'hover' ||
          payload.tabCloseButtonDisplay === 'never'
            ? payload.tabCloseButtonDisplay
            : 'always';
        this.tabWheelBehavior =
          payload.tabWheelBehavior === 'always-switch'
            ? 'always-switch'
            : 'auto';
        this.tabHoverActivationBehavior =
          payload.tabHoverActivationBehavior === 'off' ||
          payload.tabHoverActivationBehavior === 'activate'
            ? payload.tabHoverActivationBehavior
            : 'activate-and-switch';
        this.tabHoverActivationDelay = normalizeTabHoverActivationDelay(
          payload.tabHoverActivationDelay,
        );
        this.groupsCollapsed = payload.groupsCollapsed || {};
        this.tabs = payload.tabs || [];
        this.clearLinkDrop();
        if (!this.visible) this.showSeq += 1; // 仅真正打开时重放动画
        this.visible = true;
      } else {
        this.clearLinkDrop();
        this.clearTabDrag();
        this.clearGroupDrag();
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

  public startTabDrag(tabId: number) {
    this.tabDragId = tabId;
    this.clearTabDrop();
  }

  public setTabDropTarget(tabId: number, before: boolean) {
    this.tabDropGroupId = -1;
    this.tabDropTargetId = tabId;
    this.tabDropBefore = before;
  }

  public setTabDropGroup(groupId: number) {
    this.tabDropTargetId = -1;
    this.tabDropBefore = false;
    this.tabDropGroupId = groupId;
  }

  public clearTabDrop() {
    this.tabDropTargetId = -1;
    this.tabDropBefore = false;
    this.tabDropGroupId = -1;
  }

  public clearTabDrag() {
    this.tabDragId = -1;
    this.clearTabDrop();
  }

  public startGroupDrag(groupId: number) {
    this.groupDragId = groupId;
    this.groupDropTargetId = -1;
    this.groupDropBefore = false;
  }

  public setGroupDropTarget(groupId: number, before: boolean) {
    this.groupDropTargetId = groupId;
    this.groupDropBefore = before;
  }

  public clearGroupDrag() {
    this.groupDragId = -1;
    this.groupDropTargetId = -1;
    this.groupDropBefore = false;
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
