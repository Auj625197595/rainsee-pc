import { observable, action, makeObservable } from 'mobx';
import { ipcRenderer } from 'electron';

import { ITabGroup } from '../models';
import { Store } from '.';
import { Database } from '~/models/database';
import { IWorkspaceSnapshot } from '~/interfaces';
import { isImmersiveHeaderWindow } from '../utils/windows';
import {
  BLUE_500,
  RED_500,
  PINK_500,
  PURPLE_500,
  DEEP_PURPLE_500,
  INDIGO_500,
  CYAN_500,
  LIGHT_BLUE_500,
  TEAL_500,
  GREEN_500,
  LIGHT_GREEN_500,
  LIME_500,
  YELLOW_500,
  AMBER_500,
  ORANGE_500,
  DEEP_ORANGE_500,
  BLUE_GRAY_500,
} from '~/renderer/constants';

// 持久化的标签组文档。id 跨会话稳定;windowId 隔离不同窗口的组。
interface ITabGroupDoc {
  id: number;
  windowId: number;
  name: string;
  color: string;
  isPinned?: boolean;
}

export class TabGroupsStore {
  public list: ITabGroup[] = [];

  // 运行时自增的稳定 id 序列。load() 时用持久化最大 id 播种,避免跨会话冲突。
  private nextId = 0;

  private db = new Database<ITabGroupDoc>('tabGroups');

  public palette: string[] = [
    BLUE_500,
    RED_500,
    PINK_500,
    PURPLE_500,
    DEEP_PURPLE_500,
    INDIGO_500,
    CYAN_500,
    LIGHT_BLUE_500,
    TEAL_500,
    GREEN_500,
    LIGHT_GREEN_500,
    LIME_500,
    YELLOW_500,
    AMBER_500,
    ORANGE_500,
    DEEP_ORANGE_500,
    BLUE_GRAY_500,
  ];

  private store: Store;

  public constructor(store: Store) {
    makeObservable(this, { list: observable, addGroup: action });

    this.store = store;

    ipcRenderer.on('edit-tabgroup', (e, t) => {
      // overlay 是镜像:组名/色由主渲染进程经快照对齐,overlay 不处理编辑事件(不写 DB)。
      if (isImmersiveHeaderWindow()) return;
      if (t) {
        const group = this.getGroupById(t.id);
        if (!group) return;
        if (t.name != null) group.name = t.name;
        if (t.color) group.color = t.color;
        // 工作区由 workspace snapshot 持久化；普通窗口才写 tabGroups 数据库。
        if (store.canPersistNormalSession) {
          this.db
            .update({ id: t.id } as any, {
              name: group.name,
              color: group.color,
            } as any)
            .catch(() => {});
        }
        store.tabs.updateTabsBounds(true);
      }
    });
  }

  public getGroupById(id: number) {
    return this.list.find((x) => x.id === id);
  }

  // id 由调用方提供(恢复路径,保持持久化 id);缺省则运行时自增。
  public addGroup(id?: number, workspaceKey?: string) {
    const gid = id != null ? id : this.nextId++;
    if (gid >= this.nextId) this.nextId = gid + 1;

    const tabGroup = new ITabGroup(this.store, this, gid);
    tabGroup.workspaceKey = workspaceKey;
    this.list.push(tabGroup);

    // 仅运行时新建的组(无 id 入参)写库;恢复路径由 load() 统一读库,不重复写。
    if (id == null && this.store.canPersistNormalSession) {
      this.db
        .insert({
          id: tabGroup.id,
          windowId: this.store.windowId,
          name: tabGroup.name,
          color: tabGroup.color,
          isPinned: tabGroup.isPinned,
        })
        .catch(() => {});
    }
    return tabGroup;
  }

  // 按工作区快照追加分组(追加不清空:原地切换工作区时旧分组随旧标签关闭自行清理)。
  public addWorkspaceGroups(groups: IWorkspaceSnapshot['groups']) {
    for (const group of groups) {
      const item = this.addGroup(undefined, group.key);
      item.name = group.name;
      item.color = group.color;
      item.isPinned = !!group.isPinned;
    }
  }

  public getGroups(): ITabGroup[] {
    return this.list;
  }

  // startupTabs 与 tabGroups 分属两个数据库，异常退出或旧版本写入中断时，
  // 可能只留下标签上的 tabGroupId。恢复缺失的组记录，避免成员标签因找不到
  // ITabGroup 而在顶部栏被折叠成一个没有 DOM 的空白槽位。
  public async ensureRestoredGroups(ids: number[]) {
    if (isImmersiveHeaderWindow() || this.store.workspaceContext) return;

    const groupIds = Array.from(
      new Set(
        ids.filter(
          (id) =>
            Number.isFinite(id) && id >= 0 && !this.getGroupById(id),
        ),
      ),
    );

    for (const id of groupIds) {
      let doc: ITabGroupDoc | undefined;
      try {
        const docs = await this.db.get({
          id,
          windowId: this.store.windowId,
        } as any);
        doc = docs[0];
      } catch (error) {
        console.error('[tab-groups] failed to query missing group', {
          id,
          error,
        });
      }

      const group = this.addGroup(id);
      if (doc) {
        if (doc.name) group.name = doc.name;
        if (doc.color) group.color = doc.color;
        group.isPinned = !!doc.isPinned;
        continue;
      }

      if (!this.store.canPersistNormalSession) continue;
      try {
        await this.db.insert({
          id: group.id,
          windowId: this.store.windowId,
          name: group.name,
          color: group.color,
          isPinned: group.isPinned,
        });
      } catch (error) {
        console.error('[tab-groups] failed to repair missing group', {
          id,
          error,
        });
      }
    }
  }

  // 组内最后一个成员离开 → 删除持久化的组记录。失败静默(DB 与内存可能瞬时不同步,
  // 下次 load 时空组因无成员不渲染,不致错误)。
  public removeGroupDoc(id: number) {
    if (!this.store.canPersistNormalSession) return;
    this.db.remove({ id } as any).catch(() => {});
  }

  // 设置组基准色(悬停弹窗色盘自定义)。同步内存 + 落库。
  public setColor(id: number, color: string) {
    if (isImmersiveHeaderWindow()) return;
    const g = this.getGroupById(id);
    if (!g || !color) return;
    g.color = color;
    if (this.store.canPersistNormalSession) {
      this.db.update({ id } as any, { color } as any).catch(() => {});
    }
  }

  // 改名(悬停弹窗内联输入框)。同步内存 + 落库。空串视为无组名。
  public rename(id: number, name: string) {
    if (isImmersiveHeaderWindow()) return;
    const g = this.getGroupById(id);
    if (!g) return;
    g.name = (name || '').trim();
    if (this.store.canPersistNormalSession) {
      this.db.update({ id } as any, { name: g.name } as any).catch(() => {});
    }
  }

  // 整组钉住/取消钉住(固定分组)。同步内存 + 落库。
  public setPinned(id: number, pinned: boolean) {
    if (isImmersiveHeaderWindow()) return;
    const g = this.getGroupById(id);
    if (!g) return;
    g.isPinned = pinned;
    if (this.store.canPersistNormalSession) {
      this.db.update({ id } as any, { isPinned: pinned } as any).catch(() => {});
    }
  }

  // 主会话认领后,主进程可能已把上一个主窗口的组记录迁到本窗口 id 名下。
  // 标签尚未创建,直接按本窗口 id 重新读库即可。
  public async reloadForSession() {
    if (isImmersiveHeaderWindow() || this.store.workspaceContext) return;
    this.list = [];
    this.nextId = 0;
    await this.load();
  }

  // 从持久层恢复组记录。必须在 startupTabs.load() 之前完成,使标签恢复时
  // tabGroupId 有对应的 ITabGroup 可绑定。空组(无成员)在此不删除——由
  // removeFromGroup 在运行时关掉最后一个成员时清理,避免 empty 启动模式误删。
  public async load() {
    // overlay 是镜像:分组由主渲染进程经 immersive-header-sync 对齐,不从 DB 自建
    // (否则会与 reconcile 的 addGroup 重复 push)。
    if (isImmersiveHeaderWindow()) return;

    if (this.store.workspaceContext) {
      this.list = [];
      this.addWorkspaceGroups(this.store.workspaceContext.groups || []);
      return;
    }
    let docs: ITabGroupDoc[] = [];
    try {
      docs = await this.db.get({ windowId: this.store.windowId } as any);
    } catch (e) {
      docs = [];
    }

    for (const d of docs) {
      const g = new ITabGroup(this.store, this, d.id);
      if (d.name) g.name = d.name;
      if (d.color) g.color = d.color;
      if (d.isPinned) g.isPinned = true;
      this.list.push(g);
      if (d.id >= this.nextId) this.nextId = d.id + 1;
    }
  }
}
