import {observable, action, computed, makeObservable} from 'mobx';
import {ipcRenderer} from 'electron';

import {ISettings} from '~/interfaces';
import {DEFAULT_SETTINGS} from '~/constants';
import {resolveToolbarLayout, ToolbarLayout} from '~/renderer/constants/toolbar-buttons';
import {Store} from '.';
import {updateStoreNewTab, updateStoreNewTabTemp} from "~/common/webui";
import {rendererStartupMark, rendererStartupTimer} from './startup-timing';

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

  public object: ISettings = {
    ...DEFAULT_SETTINGS,
    ...(ipcRenderer.sendSync('get-settings-sync') || {}),
  };

  public store: Store;

  public constructor(store: Store) {
    rendererStartupMark('renderer.settings.constructor.begin');
    makeObservable(this, {
      selectedSection: observable,
      object: observable,
      searchEngine: computed,
      toolbarLayout: computed,
      updateSettings: action,
      setTabsLayout: action,
      setSidebarPinned: action,
      setSearchEngine: action,
    });

    this.store = store;

    let firstTime = false;

    ipcRenderer.send('get-settings');
    rendererStartupMark('renderer.settings.requested');

    ipcRenderer.on('update-settings', (e, settings: ISettings) => {
      this.updateSettings(settings);
      if (!firstTime) {
        firstTime = true;
        rendererStartupMark('renderer.settings.received', {
          startupBehavior: settings.startupBehavior?.type,
        });
        // 组记录必须先于标签水合:标签恢复时带 tabGroupId,需有对应 ITabGroup
        // 才能渲染成芯片;否则组内标签会先以独立 slot 闪现再折叠。
        const groupsTimer = rendererStartupTimer();
        rendererStartupMark('renderer.tab_groups.load.begin');
        store.tabGroups
          .load()
          .catch(() => {})
          .then(() => {
            rendererStartupMark('renderer.tab_groups.load.end', {
              count: store.tabGroups.list.length,
              durationMs: groupsTimer(),
            });
            return store.startupTabs.load();
          })
          .finally(() => {
            rendererStartupMark('renderer.startup_restore.pipeline.end', {
              tabCount: store.tabs.list.length,
            });
            ipcRenderer.send('startup-critical-ready');
            store.activateWorkspaceSync();
          });
      }
    });

    ipcRenderer.on('update-newtab-url', (e, newtab: string, url: string) => {
      updateStoreNewTab(newtab);
      updateStoreNewTabTemp(url);
      this.object = {...this.object, newtab: newtab};
    });

    // 开源版：无账号体系，登录态联动已移除。

    // 拖拽热路径只写 CSS 变量，避免高频修改 MobX settings 触发整棵主题树重渲染。
    // 原生 BrowserView 由主进程同步调宽，松手后再走 updateSettings 持久化一次。
    ipcRenderer.on('sidebar-width-live', (e, width: number) => {
      document.documentElement.style.setProperty(
        '--sidebar-width',
        `${Math.round(width)}px`,
      );
    });

    ipcRenderer.on('sidebar-resize-state', (e, resizing: boolean) => {
      document.documentElement.classList.toggle('sidebar-resizing', resizing);
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
    if (typeof newSettings.sidebarWidth === 'number') {
      document.documentElement.style.setProperty(
        '--sidebar-width',
        `${Math.round(newSettings.sidebarWidth)}px`,
      );
    }
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
      prevState.tabOverflowBehavior !== newSettings.tabOverflowBehavior ||
      prevState.sidebarWidth !== newSettings.sidebarWidth
    ) {
      requestAnimationFrame(() => {
        this.store.tabs.updateTabsBounds(true);
      });
    }
    if (
      prevState.tabHoverActivationBehavior !==
        newSettings.tabHoverActivationBehavior ||
      prevState.tabHoverActivationDelay !== newSettings.tabHoverActivationDelay
    ) {
      this.store.tabs.refreshGroupPreview();
      this.store.tabs.refreshSidebarPanel();
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
