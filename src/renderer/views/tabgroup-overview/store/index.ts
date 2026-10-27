import { ipcRenderer } from 'electron';
import { observable, makeObservable, action, computed } from 'mobx';
import { DialogStore } from '~/models/dialog-store';

export interface IOverviewTab {
  id: number;
  title: string;
  url: string;
  favicon: string;
  selected: boolean;
  loading?: boolean;
  discarded?: boolean;
}

export interface IOverviewGroup {
  id: number;
  name: string;
  color: string;
  pinned: boolean;
  count: number;
  containsActive: boolean;
}

// 标签组总览的渲染端 store。payload 由宿主(app.html)构建、主进程补缩略图后透传:
// {focusGroupId, groups(全部分组摘要), tabs(聚焦分组的标签), backdropId,
// thumbnails, palette, freshOpen}。缩略图按 tabId 增量下发(只发变化的),这里
// 合并缓存。交互经 IPC 回传宿主执行——总览是独立 webContents,不持有宿主 mobx store。
export class Store extends DialogStore {
  public groups: IOverviewGroup[] = [];
  public tabs: IOverviewTab[] = [];
  public focusGroupId = -1;
  public backdropId = -1;
  public palette: string[] = [];
  public thumbnails: { [tabId: number]: string } = {};
  // 每次全新打开/切换分组自增,用于重放卡片入场动画。
  public animSeq = 0;

  public constructor() {
    super({ visibilityWrapper: false, persistent: true, hideOnBlur: false });

    makeObservable(this, {
      groups: observable.ref,
      tabs: observable.ref,
      focusGroupId: observable,
      backdropId: observable,
      palette: observable.ref,
      thumbnails: observable.ref,
      animSeq: observable,
      focusGroup: computed,
      apply: action,
    });

    ipcRenderer.on('visible', (e, flag: boolean, payload: any) => {
      if (flag && payload) {
        this.apply(payload);
      } else {
        this.visible = false;
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.visible) return;
      const target = e.target as HTMLElement | null;
      // 改名输入框内的 Esc 由输入框自己处理(先退出编辑)。
      if (target && target.tagName === 'INPUT') return;
      this.action({ type: 'close-overview' });
    });
  }

  public get focusGroup() {
    return this.groups.find((g) => g.id === this.focusGroupId) || null;
  }

  public apply(payload: any) {
    const nextFocus = payload.focusGroupId ?? -1;
    if (payload.freshOpen) this.thumbnails = {};
    if (payload.freshOpen || nextFocus !== this.focusGroupId) {
      this.animSeq += 1;
    }
    if (payload.thumbnails && Object.keys(payload.thumbnails).length) {
      this.thumbnails = { ...this.thumbnails, ...payload.thumbnails };
    }
    this.groups = Array.isArray(payload.groups) ? payload.groups : [];
    this.tabs = Array.isArray(payload.tabs) ? payload.tabs : [];
    this.focusGroupId = nextFocus;
    this.backdropId = payload.backdropId ?? -1;
    this.palette = payload.palette || [];
    this.visible = true;
  }

  public action(payload: any) {
    ipcRenderer.send('tabgroup-overview-action', payload);
  }
}

export default new Store();
