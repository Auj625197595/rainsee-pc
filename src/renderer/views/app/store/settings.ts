import {observable, action, computed, makeObservable} from 'mobx';
import {ipcRenderer} from 'electron';

import {ISettings} from '~/interfaces';
import {DEFAULT_SETTINGS} from '~/constants';
import {resolveToolbarLayout, ToolbarLayout} from '~/renderer/constants/toolbar-buttons';
import {Store} from '.';
import {updateStoreNewTab, updateStoreNewTabTemp, updateStoreDeviceParams} from "~/common/webui";

export type SettingsSection =
  | 'appearance'
  | 'autofill'
  | 'address-bar'
  | 'privacy'
  | 'permissions'
  | 'startup'
  | 'language'
  | 'shortcuts'
  | 'downloads'
  | 'system'
  | 'customize-toolbar';

export class SettingsStore {
  public selectedSection: SettingsSection = 'appearance';

  public object: ISettings = DEFAULT_SETTINGS;

  public store: Store;

  public constructor(store: Store) {
    makeObservable(this, {
      selectedSection: observable,
      object: observable,
      searchEngine: computed,
      toolbarLayout: computed,
      updateSettings: action,
      setTabsLayout: action,
      setSidebarPinned: action,
      setSearchEngine: action,
      setSidebarWidthLive: action,
    });

    this.store = store;

    let firstTime = false;

    // 同步设备参数(devid/prod/lang/ck),供新标签页 URL 拼接使用
    updateStoreDeviceParams(ipcRenderer.sendSync('get-device-params'));

    ipcRenderer.send('get-settings');

    ipcRenderer.on('update-settings', (e, settings: ISettings) => {
      this.updateSettings(settings);
      if (!firstTime) {
        firstTime = true;
        // 组记录必须先于标签水合:标签恢复时带 tabGroupId,需有对应 ITabGroup
        // 才能渲染成芯片;否则组内标签会先以独立 slot 闪现再折叠。
        store.tabGroups.load().catch(() => {}).finally(() => {
          store.startupTabs.load();
        });
      }
    });

    ipcRenderer.on('update-newtab-url', (e, newtab: string, url: string) => {
      updateStoreNewTab(newtab);
      updateStoreNewTabTemp(url);
      this.object = {...this.object, newtab: newtab};
    });

    // 标签页侧边栏拖拽条实时回传的新宽度(主进程 sidebar-resizer)。拖拽中只改
    // 内存值即时回流(改 theme.sidebarWidth → Sidebar 宽度变 → #view-anchor
    // ResizeObserver → 主进程 fixBounds 收缩网页内容),不落盘;松手时由主进程
    // 走 updateSettings 持久化一次。
    ipcRenderer.on('sidebar-width-live', (e, width: number) => {
      this.setSidebarWidthLive(width);
    });
  }

  public get searchEngine() {
    return this.object.searchEngines[this.object.searchEngine];
  }

  // 工具栏自定义布局(归一化后):left/right 为各区域有序按钮 id,hidden 为隐藏项。
  // 读取 this.object.toolbarLayout(可能为空——老用户)并归一化,前向兼容新按钮。
  public get toolbarLayout(): ToolbarLayout {
    return resolveToolbarLayout((this.object as any).toolbarLayout);
  }

  public updateSettings(newSettings: ISettings) {
    //console.log("updateSettings", newSettings.newtab);
    const prevState = {...this.object};
    this.object = {...this.object, ...newSettings};
    if (newSettings.newtab) {
      if (newSettings.newtab !== prevState.newtab) {
        updateStoreNewTabTemp('');
      }
      updateStoreNewTab(newSettings.newtab);
    }

    if (
      prevState.immersiveBrowsing !== newSettings.immersiveBrowsing ||
      prevState.topBarVariant !== newSettings.topBarVariant ||
      prevState.tabsLayout !== newSettings.tabsLayout ||
      prevState.sidebarWidth !== newSettings.sidebarWidth
    ) {
      requestAnimationFrame(() => {
        this.store.tabs.updateTabsBounds(true);
      });
    }
  }

  public async save() {
    ipcRenderer.send('save-settings', {
      settings: JSON.stringify(this.object),
    });
  }

  public setTabsLayout(layout: 'top' | 'left' | 'right') {
    this.object = { ...this.object, tabsLayout: layout };
    this.save();
    requestAnimationFrame(() => {
      this.store.tabs.updateTabsBounds(true);
    });
  }

  // 切换侧边栏固定/缩放模式并持久化。缩放模式下侧栏常态收窄为窄轨,
  // 鼠标移入才展开(展开靠 Sidebar 组件内部悬停态,不改 sidebarWidth)。
  public setSidebarPinned(pinned: boolean) {
    this.object = { ...this.object, sidebarPinned: pinned };
    this.save();
    requestAnimationFrame(() => {
      this.store.tabs.updateTabsBounds(true);
    });
  }

  // 拖拽侧边栏时高频调用:只更新内存中的 sidebarWidth 以即时回流,不落盘
  // (持久化由主进程在松手时统一处理)。内容区的收缩由 #view-anchor 的
  // ResizeObserver 自动触发,无需在此调用 updateTabsBounds。
  public setSidebarWidthLive(width: number) {
    this.object = { ...this.object, sidebarWidth: width };
  }

  // 切换默认搜索引擎并持久化(地址栏左侧图标的快速切换)
  public setSearchEngine(index: number) {
    if (
      index < 0 ||
      index >= (this.object.searchEngines || []).length ||
      index === this.object.searchEngine
    ) {
      return;
    }
    this.object = { ...this.object, searchEngine: index };
    this.save();
  }
}
