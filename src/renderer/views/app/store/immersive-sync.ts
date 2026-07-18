import { autorun, runInAction } from 'mobx';
import { ipcRenderer } from 'electron';

import { Store } from '.';
import { ITab } from '../models';

// 沉浸悬浮头部是一个独立渲染进程(app.html?immersiveHeader=1),它复用整份 app
// store 代码,却与主窗口渲染进程共用同一个 windowId。若各自从磁盘 startupTabs 建
// 标签,两边 id 对不上、loading 永不清除(见 models/tab.ts 的 loading=!discarded),
// 标签栏一直转圈且不随主窗口更新。
//
// 这里把 overlay 变成主渲染进程标签状态的「只读镜像 + 遥控」:
//   - 主渲染进程(source): autorun 序列化标签/分组/选中 → 经主进程转发给 overlay;
//     并接收 overlay 回传的 select/close/new 指令,在**真实** store 上执行(单一数据源)。
//   - overlay(mirror): 收到快照后按 id 增量对齐本地 store.tabs/tabGroups,标签操作
//     一律回传主渲染进程,不自行建/毁 view、不写 DB。

export interface ImmersiveTabSnapshot {
  id: number;
  url: string;
  title: string;
  favicon: string;
  loading: boolean;
  isPinned: boolean;
  isMuted: boolean;
  isPlaying: boolean;
  tabGroupId: number;
  incognito: boolean;
  discarded: boolean;
}

export interface ImmersiveGroupSnapshot {
  id: number;
  name: string;
  color: string;
  isPinned: boolean;
}

export interface ImmersiveSnapshot {
  tabs: ImmersiveTabSnapshot[];
  selectedTabId: number;
  groups: ImmersiveGroupSnapshot[];
}

// 序列化当前标签栏状态为可经 IPC 结构化克隆的纯对象(observable 数组 .map 出普通数组)。
function buildSnapshot(store: Store): ImmersiveSnapshot {
  return {
    tabs: store.tabs.list.map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title,
      favicon: t.favicon,
      loading: t.loading,
      isPinned: t.isPinned,
      isMuted: t.isMuted,
      isPlaying: t.isPlaying,
      tabGroupId: t.tabGroupId,
      incognito: t.incognito,
      discarded: t.discarded,
    })),
    selectedTabId: store.tabs.selectedTabId,
    groups: store.tabGroups.list.map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color,
      isPinned: g.isPinned,
    })),
  };
}

const isImmersiveEnabled = (store: Store) =>
  !!store.settings.object.immersiveBrowsing && !store.isSidebar;

// ===== 主渲染进程侧:推快照 + 执行遥控指令 =====
export function initImmersiveSyncSource(store: Store) {
  let last = '';

  const send = (snap: ImmersiveSnapshot) => {
    last = JSON.stringify(snap);
    ipcRenderer.send(`immersive-header-sync-${store.windowId}`, snap);
  };

  // autorun 会追踪 buildSnapshot 里读到的所有 observable(list、每个 tab 字段、
  // selectedTabId、groups、immersiveBrowsing、isSidebar),任一变化即重算并去重发送。
  autorun(() => {
    if (!isImmersiveEnabled(store)) {
      // 关闭沉浸时清空去重缓存,下次开启/请求能立即重发首帧。
      last = '';
      return;
    }
    const snap = buildSnapshot(store);
    const json = JSON.stringify(snap);
    if (json === last) return;
    send(snap);
  });

  // overlay 的标签操作回传:在真实 store 上执行(建/毁 view、写 DB 都在这条路径)。
  ipcRenderer.on('immersive-header-cmd', (_e, cmd: any) => {
    if (!cmd) return;
    if (cmd.type === 'select') store.tabs.getTabById(cmd.id)?.select();
    else if (cmd.type === 'close') store.tabs.getTabById(cmd.id)?.close();
    else if (cmd.type === 'new') store.tabs.addTab();
  });

  // overlay 挂载握手:立即重发一帧(绕过去重),保证首屏标签即时呈现。
  ipcRenderer.on('immersive-header-request-sync', () => {
    if (!isImmersiveEnabled(store)) return;
    send(buildSnapshot(store));
  });
}

// ===== overlay 侧:按快照重建本地标签/分组 =====
function reconcile(store: Store, snap: ImmersiveSnapshot) {
  runInAction(() => {
    const byId = new Map(store.tabs.list.map((t) => [t.id, t] as const));
    const nextTabs: ITab[] = [];

    for (const s of snap.tabs) {
      let tab = byId.get(s.id);
      if (!tab) {
        // 直接构造 ITab 并复用——不走 createTab(那会写 startupTabs DB);active:false
        // 不触发 select()。构造后按快照覆盖 loading 等(ctor 的 loading=!discarded 不准)。
        tab = new ITab(
          {
            url: s.url,
            active: false,
            pinned: s.isPinned,
            incognito: s.incognito,
            title: s.title,
            favicon: s.favicon,
            discarded: s.discarded,
          } as any,
          s.id,
        );
      }
      tab.url = s.url;
      tab.title = s.title;
      tab.favicon = s.favicon;
      tab.loading = s.loading;
      tab.isPinned = s.isPinned;
      tab.isMuted = s.isMuted;
      tab.isPlaying = s.isPlaying;
      tab.tabGroupId = s.tabGroupId;
      tab.discarded = s.discarded;
      nextTabs.push(tab);
    }

    store.tabs.list = nextTabs;
    store.tabs.selectedTabId = snap.selectedTabId;

    // 分组:成员由 tab.tabGroupId 派生,这里只对齐组记录(名/色/钉)。
    const gById = new Map(store.tabGroups.list.map((g) => [g.id, g] as const));
    const nextGroups = [] as typeof store.tabGroups.list;
    for (const gs of snap.groups) {
      let g = gById.get(gs.id);
      // addGroup(id) 带 id 不写 DB(仅 id==null 的运行时新建才落库)。
      if (!g) g = store.tabGroups.addGroup(gs.id);
      g.name = gs.name;
      g.color = gs.color;
      g.isPinned = gs.isPinned;
      nextGroups.push(g);
    }
    store.tabGroups.list = nextGroups;
  });

  // 列表变更后重算标签宽度/位置(ref 此时已挂载)。
  requestAnimationFrame(() => {
    store.tabs.updateTabsBounds(false);
  });
}

export function initImmersiveMirror(store: Store) {
  ipcRenderer.on('immersive-header-sync', (_e, snap: ImmersiveSnapshot) => {
    if (snap) reconcile(store, snap);
  });
  // 拉取首帧(主渲染进程可能已渲染完标签,单靠 autorun 变化不会补发)。
  ipcRenderer.send(`immersive-header-request-sync-${store.windowId}`);
}
