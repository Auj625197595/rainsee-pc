import {
  observable,
  action,
  computed,
  makeObservable,
  makeAutoObservable,
  reaction,
} from 'mobx';
import * as React from 'react';

import { ITab, ITabGroup } from '../models';

import {
  TAB_ANIMATION_DURATION,
  TABS_PADDING,
  TAB_MAX_WIDTH,
  TAB_MIN_WIDTH,
  TAB_PINNED_WIDTH,
  CHIP_PAD_LR,
  CHIP_NAME_MAX,
  CHIP_NAME_FAV_GAP,
  CHIP_FAV_W,
  CHIP_ACTIVE_TITLE_W,
  CHIP_MAX_WIDTH,
  CHIP_SLOT_MARGIN,
} from '../constants';

import store from '.';
import { ipcRenderer } from 'electron';
import { TOOLBAR_HEIGHT, ADD_TAB_BUTTON_WIDTH } from '~/constants/design';
import { TabEvent } from '~/interfaces/tabs';
import { getWebUIURL } from '~/common/webui';
import { prefixHttp } from '~/utils';
import { isImmersiveHeaderWindow } from '../utils/windows';

export interface AddTabsBehavior {
  loadImmediately?: boolean;
  preserveActiveTab?: boolean;
  persist?: boolean;
}

// 最近关闭标签的快照:「最近关闭」按钮列表数据源。按窗口、仅内存。
export interface IClosedTabSnapshot {
  id: number;
  url: string;
  title: string;
  favicon: string;
  closedAt: number;
}

export class TabsStore {
  public isDragging = false;

  // 顶部标签栏正在拖动的分组。分组芯片与普通标签共用全局 mousemove/mouseup，
  // 但移动时以整个成员块为单位重排，不能借用 selectedTab 的单标签逻辑。
  public draggingGroupId = -1;
  private groupOrderChanged = false;

  public hoveredTabId = -1;

  public list: ITab[] = [];

  public selectedTabId = -1;

  // 当前窗口内的标签激活顺序，最新激活的 id 在最前面。
  private recentlyActiveTabIds: number[] = [];

  public removedTabs = 0;

  public lastScrollLeft = 0;
  public lastMouseX = 0;
  public mouseStartX = 0;
  public tabStartX = 0;

  private scrollTimeout: any;

  public scrollingToEnd = false;
  public scrollable = false;

  public closedUrl = '';

  // 最近关闭的标签快照(最新在前)。仅内存、按窗口;无痕标签不入列。
  public recentlyClosed: IClosedTabSnapshot[] = [];

  // 快照自增 id(供 React key 用,避免同毫秒关闭撞 key)。
  private closedSeq = 0;

  // 占位标签 id 自增序列:负数,与真实 webContents.id(正数)不冲突。
  // -1 被各类“无选中/无拖拽目标”状态用作哨兵值,必须保留不用。
  private placeholderSeq = 0;

  // 悬停恢复过程中若用户点击该标签，创建完成后仍需执行正常选中流程。
  private discardedTabsPendingSelection = new WeakSet<ITab>();

  public canShowPreview = true;

  // 拖拽撕离:当前是否处于"已拖出标签栏"状态(松手将建窗/合并)。
  public isTearing = false;

  // 拖拽合入分组的「待定目标」:拖动标签悬停在某芯片上方时记其组 id(高亮该芯片,
  // 但不立即合入);松手才真正合入,中途拖离则清零取消。-1 表示当前不在任何组上方。
  // Chrome 式交互:先高亮再确认,可反悔。区别于旧版一越过阈值就即时 setTabToGroup。
  public pendingGroupDropId = -1;

  // 网页链接拖入顶部标签栏:投放指示线 content 坐标 X(null=隐藏)。由标签栏
  // 容器上的 HTML5 dragover 计算写入,render 时画一条竖线提示新标签落点。
  public linkDropLeft: number | null = null;

  public containerRef = React.createRef<HTMLDivElement>();

  public leftMargins = 0;
  public slotMargin = CHIP_SLOT_MARGIN;
  public slotPadding = TABS_PADDING;

  public get selectedTab() {
    return this.getTabById(this.selectedTabId);
  }

  public get hoveredTab() {
    return this.getTabById(this.hoveredTabId);
  }

  public constructor() {
    makeObservable(this, {
      list: observable,
      isDragging: observable,
      draggingGroupId: observable,
      hoveredTabId: observable,
      selectedTabId: observable,
      scrollable: observable,
      pendingGroupDropId: observable,
      linkDropLeft: observable,
      sidebarDragId: observable,
      sidebarDragGroupId: observable,
      sidebarDropTargetId: observable,
      sidebarDropBefore: observable,
      sidebarDropGroupId: observable,
      sidebarDropGroupTargetId: observable,
      sidebarDropGroupBefore: observable,
      sidebarDropOutside: observable,
      panelGroupCollapsed: observable,
      panelVisible: observable,
      recentlyClosed: observable,
      selectedTab: computed,
      hoveredTab: computed,
    });

    // 把可视标签栏顺序(id 序列)同步给主进程,供扩展系统计算准确的
    // chrome.tabs.Tab.index。本 store 是标签顺序的唯一权威来源(新建/关闭/拖拽重排
    // 都只在这里发生),主进程并不知晓拖拽后的顺序。任何 list 变更都重发一次。
    reaction(
      () => this.list.map((t) => t.id),
      (ids) => {
        // overlay 是镜像:标签顺序由主渲染进程权威上报,overlay 不得重发覆盖。
        if (isImmersiveHeaderWindow()) return;
        try {
          ipcRenderer.send('crx-set-tab-order', store.windowId, ids);
        } catch {
          // best-effort:窗口销毁期 send 可能抛
        }
      },
    );

    reaction(
      () => this.selectedTabId,
      (id) => this.recordTabActivation(id),
      { fireImmediately: true },
    );

    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('resize', this.onResize);

    ipcRenderer.on('tabs-resize', () => {
      this.updateTabsBounds(true);
    });

    ipcRenderer.on('clear-tab-hover', () => {
      this.hoveredTabId = -1;
      this.canShowPreview = true;
    });

    // 标签组悬停弹窗(独立 BrowserView)回传的交互。
    ipcRenderer.on('tabgroup-preview-action', (e, payload) => {
      this.onPreviewAction(payload);
    });
    ipcRenderer.on('tabgroup-preview-enter', () => {
      this.cancelPreviewHide();
    });
    ipcRenderer.on('tabgroup-preview-leave', () => {
      // 弹窗与标签组之间存在阴影留白，返回标签组时也需要给另一侧的 enter
      // 留出接管时间，避免弹窗先被立即隐藏后又延迟重开。
      this.schedulePreviewHide();
    });

    // 侧边栏缩放模式悬停浮层(独立 BrowserView)回传的交互与鼠标进出。
    ipcRenderer.on('sidebar-panel-action', (e, payload) => {
      this.onSidebarPanelAction(payload);
    });
    ipcRenderer.on('sidebar-panel-enter', () => {
      this.cancelSidebarPanelHide();
    });
    ipcRenderer.on('sidebar-panel-leave', () => {
      // 留一点缓冲:指针从浮层滑回窄轨(两者重叠)时,窄轨的 enter 会及时取消,
      // 不会误收起;也避免与滑入动画抢拍。
      this.scheduleSidebarPanelHide(120);
    });

    ipcRenderer.on(
      'create-tab',
      (
        e,
        options: chrome.tabs.CreateProperties,
        isNext: boolean,
        id: number,
        openerTabId?: number,
      ) => {
        // 只有网页通过 window.open/target=_blank 新建标签时才继承明确来源标签的分组；
        // Ctrl+T、菜单和其他用户入口没有 opener，必须创建普通的非分组标签。
        const effectiveOpenerTabId =
          typeof openerTabId === 'number'
            ? openerTabId
            : typeof options.openerTabId === 'number'
            ? options.openerTabId
            : undefined;
        const opener =
          typeof effectiveOpenerTabId === 'number'
            ? this.getTabById(effectiveOpenerTabId)
            : undefined;
        const anchor = opener || this.selectedTab;
        const tabGroupId = opener && !opener.isPinned ? opener.tabGroupId : -1;

        if (isNext) {
          // window.open/target=_blank 必须紧跟来源标签。异步创建期间用户可能
          // 已切换标签，多开时 selectedTab 也会变化，因此优先使用明确的来源 id。
          const anchorIndex = this.list.indexOf(anchor);
          options.index = anchorIndex >= 0 ? anchorIndex + 1 : this.list.length;
        }

        this.createTab(options, id, tabGroupId, {
          skipScrollToEnd: isNext,
          openerTabId: opener?.id,
        });
      },
    );

    ipcRenderer.on('select-next-tab', () => {
      this.switchAdjacentTab(1);
    });

    ipcRenderer.on('select-tab-index', (e, i) => {
      this.list[i]?.select();
    });

    ipcRenderer.on('select-last-tab', () => {
      this.list[this.list.length - 1]?.select();
    });

    // 左键长按手势打开链接:由主进程转发到当前窗口,这里根据 renderer 的
    // 唯一标签顺序计算当前标签左右插入点,因此与标签栏拖放完全一致。
    ipcRenderer.on(
      'left-gesture-open-link',
      (
        _e,
        payload: { url?: string; side?: 'left' | 'right'; active?: boolean },
      ) => {
        const url = typeof payload?.url === 'string' ? payload.url : '';
        if (!url) return;
        const current = this.selectedTab;
        const currentIndex = current
          ? this.list.indexOf(current)
          : this.list.length - 1;
        const index = Math.max(
          0,
          currentIndex + (payload.side === 'left' ? 0 : 1),
        );
        this.openLinkAt(url, index, -1, payload.active !== false).catch(
          () => undefined,
        );
      },
    );

    ipcRenderer.on('select-previous-tab', () => {
      this.switchAdjacentTab(-1);
    });

    ipcRenderer.on('remove-tab', (e, id: number) => {
      this.getTabById(id)?.close();
    });

    // 后台 renderer 崩溃后，主进程已释放 BrowserView；保留原标签位置和元数据，
    // 改成与启动恢复相同的 discarded 占位标签，用户切回时才创建并加载。
    ipcRenderer.on(
      'discard-crashed-tab',
      (
        _e,
        payload: { id: number; url: string; title?: string; favicon?: string },
      ) => {
        this.discardCrashedTab(payload);
      },
    );

    // 标签被迁出到其它窗口:本窗口仅移除模型,不销毁 view。
    ipcRenderer.on('tab-detached-local', (e, id: number) => {
      this.detachTabLocally(id);
    });

    // 领养来自其它窗口的标签:用已存在的 view id 构造标签模型并插入。
    // 不调用 view-create(view 已由主进程迁入本窗口)。
    ipcRenderer.on('tab-adopt', (e, tabState: any) => {
      const { id, index } = tabState;
      if (this.getTabById(id)) return; // 幂等,避免重复领养

      const tab = this.createTab(
        {
          url: tabState.url,
          active: true,
          pinned: !!tabState.pinned,
          incognito: !!tabState.incognito,
          index: typeof index === 'number' ? index : undefined,
        } as any,
        id,
      );

      // 用迁移过来的元数据回填,等页面事件后续刷新。
      if (tabState.title) tab.title = tabState.title;
      if (tabState.favicon) tab.favicon = tabState.favicon;
    });

    ipcRenderer.on('tab-event', (e, event: TabEvent, tabId, args) => {
      const tab = this.getTabById(tabId);

      if (tab) {
        if (event === 'blocked-ad') {
          tab.blockedAds.push({ request: args[0], result: args[1] });
          tab.filtersCount = args[2];
        }
        if (event === 'title-updated') {
          const changed = tab.title !== args[0];
          tab.title = args[0];
          // 回写标题:延迟标签恢复时不重新加载,标题只能取自 DB,
          // 必须在变化时持久化,否则下次恢复停留在创建时的旧值。
          if (changed) store.startupTabs.updateStartupTabItem(tab);
        }
        if (event === 'favicon-updated') {
          const changed = tab.favicon !== args[0];
          tab.favicon = args[0];
          if (changed) store.startupTabs.updateStartupTabItem(tab);
        }
        if (event === 'did-navigate') tab.favicon = '';
        if (event === 'media-playing') tab.isPlaying = true;
        if (event === 'media-paused') tab.isPlaying = false;
        if (event === 'loading') tab.loading = args[0];
        if (event === 'pinned') tab.isPinned = args[0];
        if (event === 'credentials') tab.hasCredentials = args[0];
        if (event === 'supervideo-video') tab.videoUrls = args[0] || [];
        if (event === 'can-translate') {
          // 翻译开关态由 translate-state 事件负责,这里不覆盖 translated,
          // 否则 reload 切语言时会被 did-start-navigation 的 can-translate[false] 清掉。
          tab.canTranslate = !!args[0];
          tab.detectedLanguage = args[1] || '';
        }
        if (event === 'translate-state') {
          tab.translated = !!args[0];
          tab.translateTarget = args[1] || 'zh-CN';
        }
        if (event === 'pwa-installable') {
          // canInstall / manifest / installed 三参。导航离开时主进程会下发 false 清态。
          tab.canInstallPwa = !!args[0];
          tab.pwaManifest = args[1] || null;
          tab.pwaInstalled = !!args[2];
        }
        if (event === 'pwa-installed') {
          tab.pwaInstalled = !!args[0];
        }

        if (event === 'url-updated') {
          const [url] = args;
          tab.url = url;
          tab.updateData();
          tab.refreshSiteWhitelisted();

          if (tab.id === this.selectedTabId && !store.addressbarFocused) {
            this.selectedTab.addressbarValue = null;
          }
        }

        if (event === 'load-commit') {
          const [, , isMainFrame] = args;
          if (isMainFrame) {
            tab.blockedAds = [];
          }
        }

        // 缩放模式浮层可见时,标题/图标/加载态变化即刷新其内容。
        if (
          this.panelVisible &&
          (event === 'title-updated' ||
            event === 'favicon-updated' ||
            event === 'did-navigate' ||
            event === 'loading')
        ) {
          this.refreshSidebarPanel();
        }
      }
    });

    ipcRenderer.on('revert-closed-tab', () => {
      this.revertClosed();
    });

    ipcRenderer.on('site-adblock-updated', () => {
      // 白名单变化后,重新查询所有标签页的盾牌状态
      this.list.forEach((tab) => tab.refreshSiteWhitelisted());
    });

    ipcRenderer.on('search-tabs-request', (_event, requestId: string) => {
      // overlay 是镜像:搜索标签列表由主渲染进程权威响应,overlay 不得双响应。
      if (isImmersiveHeaderWindow()) return;
      ipcRenderer.send('search-tabs-response', {
        requestId,
        tabs: this.list.map((tab) => ({
          favicon: tab.favicon,
          url: tab.url,
          title: tab.title,
          id: tab.id,
        })),
      });
    });

    ipcRenderer.on('search-select-tab', (e, tabId: number) => {
      this.getTabById(tabId)?.select();
    });
  }

  /** 按完整标签顺序切换相邻项，越过首尾时回绕。 */
  public switchAdjacentTab(direction: 1 | -1): boolean {
    if (this.list.length === 0) return false;

    const currentIndex = this.list.indexOf(this.selectedTab);
    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = this.list.length - 1;
    else if (nextIndex >= this.list.length) nextIndex = 0;

    const next = this.list[nextIndex];
    if (!next) return false;
    next.select();
    return true;
  }

  @action
  public onResize = (e: Event) => {
    if (e.isTrusted) {
      this.removedTabs = 0;
      this.updateTabsBounds(false);
    }
    this.reportTabStripRect();
  };

  // 上报本窗口标签栏在「窗口内容坐标系」中的矩形,主进程结合窗口位置换算到
  // 屏幕坐标做跨窗口合并命中检测。覆盖整条标题栏高度,放宽落点容差。
  public reportTabStripRect() {
    // overlay 是镜像:标签栏矩形(供跨窗口合并命中检测)由主渲染进程权威上报,
    // overlay 的矩形会污染同 windowId 的命中数据。
    if (isImmersiveHeaderWindow()) return;
    const el = this.containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    ipcRenderer.send('tab-strip-rect', store.windowId, {
      x: Math.round(rect.left),
      y: 0,
      width: Math.round(rect.width),
      height: Math.round(rect.bottom),
    });
  }

  public get containerWidth() {
    if (this.containerRef.current) {
      return this.containerRef.current.offsetWidth;
    }
    return 0;
  }

  public getTabById(id: number) {
    if (id === -1) return undefined;
    return this.list.find((x) => x.id === id);
  }

  private recordTabActivation(id: number) {
    if (id === -1) return;
    this.recentlyActiveTabIds = [
      id,
      ...this.recentlyActiveTabIds.filter((tabId) => tabId !== id),
    ];
  }

  public getRecentlyActiveTab(excludeId: number): ITab | undefined {
    for (const id of this.recentlyActiveTabIds) {
      if (id === excludeId) continue;
      const tab = this.getTabById(id);
      if (tab && !tab.isClosing) return tab;
    }
    return undefined;
  }

  public getTabToSelectAfterRemoval(
    tab: ITab,
    availableTabs = this.list.filter((item) => !item.isClosing),
  ): ITab | undefined {
    const index = availableTabs.indexOf(tab);
    const leftTab = availableTabs[index - 1];
    const rightTab = availableTabs[index + 1];
    const opener = this.getTabById(tab.openerTabId);

    // 与 Chrome 一致：有仍然可用的来源页时始终回到来源页。用户设置只决定
    // 没有来源页（或来源页已经关闭）时由哪个标签接管。
    if (opener && availableTabs.includes(opener)) return opener;

    const behavior = store.settings.object.tabCloseSelectionBehavior || 'right';

    if (behavior === 'left') return leftTab || rightTab;
    if (behavior === 'recent') {
      return this.getRecentlyActiveTab(tab.id) || rightTab || leftTab;
    }

    return rightTab || leftTab;
  }

  @action
  public discardCrashedTab(payload: {
    id: number;
    url: string;
    title?: string;
    favicon?: string;
  }) {
    const tab = this.getTabById(payload.id);
    // 主进程仅对后台标签调用；若 IPC 到达前用户已选中，保留当前模型，
    // 随后的主进程前台恢复会接管这个标签。
    if (!tab || this.selectedTabId === payload.id) return;

    const oldId = tab.id;
    const placeholderId = this.nextPlaceholderId();
    store.startupTabs.beginReplacingStartupTabId(oldId, placeholderId);

    tab.id = placeholderId;
    tab.url = payload.url || tab.url;
    if (payload.title) tab.title = payload.title;
    if (payload.favicon) tab.favicon = payload.favicon;
    tab.addressbarValue = null;
    tab.loading = false;
    tab.discarded = true;
    tab.materializing = false;
    tab.isPlaying = false;
    tab.videoUrls = [];
    tab.canTranslate = false;
    tab.translated = false;
    tab.canInstallPwa = false;

    if (this.hoveredTabId === oldId) this.hoveredTabId = placeholderId;
    if (process.env.ENABLE_EXTENSIONS) {
      store.extensions.browserActions = store.extensions.browserActions.filter(
        (action) => action.tabId !== oldId,
      );
    }

    void store.startupTabs.replaceStartupTabId(oldId, placeholderId, {
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      pinned: tab.isPinned,
      tabGroupId: tab.tabGroupId,
      order: this.list.indexOf(tab),
      active: false,
    });
  }

  @action
  public createTab(
    options: chrome.tabs.CreateProperties,
    id: number,
    tabGroupId = -1,
    openOpts: { skipScrollToEnd?: boolean; openerTabId?: number } = {},
  ) {
    this.removedTabs = 0;

    const tab = new ITab(options, id);

    tab.tabGroupId = tabGroupId;
    if (
      typeof openOpts.openerTabId === 'number' &&
      openOpts.openerTabId !== id
    ) {
      tab.openerTabId = openOpts.openerTabId;
    }

    if (options.index !== undefined) {
      this.list.splice(options.index, 0, tab);
    } else {
      this.list.push(tab);
    }

    requestAnimationFrame(() => {
      tab.setLeft(tab.getLeft(), false);
      this.updateTabsBounds(true);
      // 仅「自然追加到末尾」时滚到末尾;链接拖放等显式指定 index 插入到中间时,
      // 新标签落在投放点(本就在可视区),保持当前滚动位置,不被强行滚走。
      if (!openOpts.skipScrollToEnd) {
        this.scrollToEnd(TAB_ANIMATION_DURATION);
      }
    });
    store.startupTabs.updateStartupTabItem(tab);
    return tab;
  }

  @action
  public createTabs(
    options: chrome.tabs.CreateProperties[],
    ids: number[],
    persist = true,
  ) {
    this.removedTabs = 0;

    if (!persist) store.startupTabs.suppressPersistence(ids);

    const tabs = options.map((option, i) => {
      const tab = new ITab(option, ids[i]);
      // 恢复路径:把持久化的分组归属串到模型(createTabs 不经 createTab 的
      // tabGroupId 形参,需在此显式回填,否则恢复的组内标签 tabGroupId 恒为 -1)。
      const gid = (option as any).tabGroupId;
      if (typeof gid === 'number') tab.tabGroupId = gid;
      if ((option as any).workspaceKey)
        tab.workspaceKey = String((option as any).workspaceKey);
      this.list.push(tab);
      return tab;
    });

    requestAnimationFrame(() => {
      this.updateTabsBounds(false);
      if (this.scrollable && this.containerRef.current) {
        this.containerRef.current.scrollLeft =
          this.containerRef.current.scrollWidth;
      }
    });
    if (persist) {
      for (const tab of tabs) {
        void store.startupTabs.updateStartupTabItem(tab).catch((error) => {
          console.error('[startup-tabs] failed to persist restored tab', error);
        });
      }
    }

    return tabs;
  }

  public scrollToEnd = (milliseconds: number) => {
    if (!this.scrollable) return;

    const frame = () => {
      if (!this.scrollingToEnd) return;
      try {
        this.containerRef.current.scrollLeft =
          this.containerRef.current.scrollWidth;
      } catch (e) {
        console.log(e);
      }
      requestAnimationFrame(frame);
    };

    if (!this.scrollingToEnd) {
      this.scrollingToEnd = true;
      frame();
    }

    clearTimeout(this.scrollTimeout);

    this.scrollTimeout = setTimeout(() => {
      this.scrollingToEnd = false;
    }, milliseconds);
  };

  @action
  public async addTab(
    options: {
      url: string;
      active: boolean;
      title?: string;
      favicon?: string;
    } = { url: null, active: true },
    tabGroupId: number = -1,
  ) {
    // 沉浸悬浮头部:新建标签回传主渲染进程执行(建 view + 写库都在真实 store)。
    if (isImmersiveHeaderWindow()) {
      ipcRenderer.send(`immersive-header-cmd-${store.windowId}`, {
        type: 'new',
        options,
        tabGroupId,
      });
      return undefined;
    }

    // 普通新建默认不分组；右键菜单等需要归入指定分组时显式传入组 ID。
    const effectiveTabGroupId = tabGroupId;
    const anchor = this.selectedTab;

    const defaultTabOptions = {
      url: getWebUIURL('newtab'),
      active: true,
    };
    // 是否为「空白新标签页」:调用方未指定 url(点「+」、侧栏新建等),且启动行为
    // 未配置「打开特定页面」。据此在创建后把焦点交给地址栏;打开指定网址/搜索词/
    // 恢复已关闭标签/打开特定页面则不聚焦。
    let isBlankNewTab = !options.url;
    if (!options.url) {
      const sb = store.settings.object.startupBehavior;
      if (sb.type === 'urls' && sb.url && sb.url.trim()) {
        // 启动行为「打开特定页面」:新建标签页也打开配置网址(非空白)。
        options.url = prefixHttp(sb.url.trim());
        isBlankNewTab = false;
      } else {
        options.url = defaultTabOptions.url;
      }
    }
    console.log('[PDF Drag-Drop] addTab called, options.url:', options.url);
    ipcRenderer.send(`hide-window-${store.windowId}`);

    const opts: chrome.tabs.CreateProperties = {
      ...defaultTabOptions,
      ...options,
    };
    if (effectiveTabGroupId !== -1 && opts.index === undefined) {
      // 显式从非当前分组的右键菜单新建时，以目标组末尾成员为锚点，不能误用
      // 当前选中标签；普通新建则仍紧跟当前组内标签。
      const groupAnchor =
        anchor && anchor.tabGroupId === effectiveTabGroupId
          ? anchor
          : [...this.list]
              .reverse()
              .find((tab) => tab.tabGroupId === effectiveTabGroupId);
      const anchorIndex = this.list.indexOf(groupAnchor);
      if (anchorIndex >= 0) opts.index = anchorIndex + 1;
    }
    console.log('[PDF Drag-Drop] addTab opts to IPC:', opts);

    const id: number = await ipcRenderer.invoke(
      `view-create-${store.windowId}`,
      opts,
    );
    const tab = this.createTab(opts, id, effectiveTabGroupId);
    // 空白新标签页:光标自动聚焦到地址栏输入框,便于直接输入搜索词/网址。
    // ITab 构造已按 url 推断 addressbarFocused,但推断依赖两次 getWebUIURL 取值一致
    // (中间隔着 await view-create,storeNewTabTemp/ck 可能被 update-newtab-url/
    // account-updated 事件改写而失配),此处按「空白新建」语义兜底置位更稳定。
    // createTab 内 select() 走 requestAnimationFrame,本同步赋值先于其执行生效。
    if (isBlankNewTab && tab) {
      store.addressbarTextVisible = false;
      store.addressbarFocused = true;
      store.addressbarEditing = false;
      tab.addressbarFocused = true;
      // 页面加载完成时 autofocus 会抢走地址栏焦点;主进程 view-loaded 事件到达后
      // 据此标志夺回焦点(一次性:addTab 置位、view-loaded 消费)。
      store.expectingNewTabFocus = true;
      // 新标签创建后立即尝试把键盘焦点交给地址栏,慢加载时用户首个按键也能直接输入。
      store.scheduleAddressBarFocus(tab, [0, 32, 120]);
    }
    return tab;
  }

  // 占位标签 id(负数,与真实 webContents.id 不冲突)。
  private nextPlaceholderId(): number {
    return -(++this.placeholderSeq + 1);
  }

  @action
  public async addTabs(
    options: chrome.tabs.CreateProperties[],
    behavior: AddTabsBehavior = {},
  ) {
    const {
      loadImmediately = false,
      preserveActiveTab = false,
      persist = true,
    } = behavior;
    //ipcRenderer.send(`hide-window-${store.windowId}`);
    let activeCount = options.filter((it) => it.active).length;
    if (activeCount !== 1 && !(activeCount === 0 && preserveActiveTab)) {
      for (let i = 0; i < options.length; i++) {
        if (i === options.length - 1) {
          options[i].active = true;
        } else {
          options[i].active = false;
        }
      }
    }

    if (store.settings.object.memorySaver && !loadImmediately) {
      // 内存节省:恢复时仅建占位标签(标签栏 UI),不创建 BrowserView。
      // 占位标签用本地负数 id;切换到它时由 loadDiscardedTab 走标准
      // view-create 新建流程加载,得到真实 webContents.id。
      options = options.map((option) => ({
        ...option,
        discarded: true,
      }));
      const ids = options.map(() => this.nextPlaceholderId());
      return this.createTabs(options, ids, persist);
    }

    const ids = await ipcRenderer.invoke(
      `views-create-${store.windowId}`,
      options,
    );
    return this.createTabs(options, ids, persist);
  }

  // 占位标签(discarded)加载内容:走标准新建标签流程(view-create),复用与
  // 用户新建标签完全一致的路径——主进程 create View + loadURL + addTab,
  // 返回真实 webContents.id。就地把占位 tab 的 id 更新为真实 id(保持标签栏
  // 位置与引用不变),并按真实 id 注册 browser action,杜绝 id 错位。
  @action
  public async loadDiscardedTab(tab: ITab, selectAfterLoad = true) {
    if (!tab.discarded) return;
    if (tab.materializing) {
      if (selectAfterLoad) this.discardedTabsPendingSelection.add(tab);
      return;
    }

    tab.materializing = true;
    // 先切到与普通标签一致的 UI:点击后立即显示旋转进度条,
    // 不必等主进程 did-start-loading 回推。
    tab.loading = true;

    try {
      const realId: number = await ipcRenderer.invoke(
        `view-create-${store.windowId}`,
        { url: tab.url },
      );

      const oldId = tab.id;
      store.startupTabs.beginReplacingStartupTabId(oldId, realId);
      tab.id = realId;
      tab.discarded = false;
      if (this.selectedTabId === oldId) this.selectedTabId = realId;

      // 占位时未注册 browser action,现按真实 id 注册(工具栏扩展按钮,如篡改猴)。
      if (process.env.ENABLE_EXTENSIONS) {
        const { defaultBrowserActions } = store.extensions;
        for (const item of defaultBrowserActions) {
          store.extensions.addBrowserActionToTab(realId, item);
        }
      }

      // startupTabs DB 的 id 同步改写(占位 id → 真实 id)。
      await store.startupTabs.replaceStartupTabId(oldId, realId);

      const shouldSelect =
        selectAfterLoad || this.discardedTabsPendingSelection.has(tab);
      this.discardedTabsPendingSelection.delete(tab);

      // 点击路径选中并显示；悬停路径只在后台创建 View。
      if (shouldSelect) await tab.select();
    } catch (error) {
      // 创建失败时回到占位静默态,避免标签一直卡在 loading。
      tab.loading = false;
      this.discardedTabsPendingSelection.delete(tab);
      throw error;
    } finally {
      tab.materializing = false;
    }
  }

  public removeTab(id: number) {
    (this.list as any).remove(this.getTabById(id));
    this.recentlyActiveTabIds = this.recentlyActiveTabIds.filter(
      (tabId) => tabId !== id,
    );
    store.startupTabs.removeStartupTabItem(id);
  }

  // 标签被撕离/合并到其它窗口:从本窗口列表移除,但不发 view-destroy
  // (底层 BrowserView 已被主进程迁走,webContents 仍存活)。
  @action
  public detachTabLocally(id: number) {
    const tab = this.getTabById(id);
    if (!tab) return;

    const wasSelected = this.selectedTabId === id;

    const notClosing = this.list.filter((x) => !x.isClosing);

    // 移除前按用户配置算好接管标签；迁出后原标签已不在本窗口。
    const nextTab = this.getTabToSelectAfterRemoval(tab, notClosing);

    this.removeTab(id);

    if (wasSelected) {
      if (nextTab && !nextTab.isClosing) {
        nextTab.select();
      } else if (this.list.length === 0) {
        // 本窗口已空,主进程会关闭它,无需处理。
        this.selectedTabId = -1;
      }
    }

    this.updateTabsBounds(true);
  }

  // 固定区(zone)成员判定:单独固定的标签,或属于「整组固定」分组的成员。
  // 与 getSlots / setGroupPinned 的列表序不变量一致——固定区恒在 list 最前。
  // 纯查询,渲染/拖拽/重排均可复用,是「某标签是否在固定区」的单一真源。
  public isTabInPinnedZone(tab: ITab): boolean {
    if (!tab || tab.isClosing) return false;
    if (tab.isPinned) return true;
    if (tab.tabGroupId !== -1 && tab.tabGroup?.isPinned) return true;
    return false;
  }

  // 固定标签:Chrome 行为——固定即离组(组内标签先 removeFromGroup),聚到 list
  // 最前的固定区。重排走纯 list 顺序(不读 .left/.width 几何),故顶部栏与侧边栏
  // 两种布局下结果完全一致,切换布局不再错位。
  @action
  public pinTab(tab: ITab) {
    if (!tab || tab.isPinned) return;

    // Chrome:固定标签不可属于任何分组。removeFromGroup 自带 rAF + 持久化,
    // 安全先行;其内部几何回流与本方法的 list 重排互不干扰(几何由下面的
    // updateTabsBounds 统一重算)。
    if (tab.tabGroupId !== -1) {
      tab.removeFromGroup();
    }

    tab.isPinned = true;

    // 移到「单独固定块末尾、固定分组之前」——即首个非 isPinned 标签处。
    // 新固定的标签排在已固定标签之后,保持固定顺序(与 Chrome 一致)。
    const list = [...this.list];
    const from = list.indexOf(tab);
    if (from !== -1) list.splice(from, 1);

    let insertAt = list.length;
    for (let i = 0; i < list.length; i++) {
      if (!list[i].isPinned) {
        insertAt = i;
        break;
      }
    }
    list.splice(insertAt, 0, tab);
    this.list = list;

    // 单次写入同时持久化 pinned 字段与新顺序(order 由 list.indexOf 实时派生)。
    store.startupTabs.updateStartupTabItem(tab);
    this.updateTabsBounds(true);
  }

  // 取消固定:移到「固定区之后、非固定区开头」。不自动入组(与 Chrome 一致)。
  @action
  public unpinTab(tab: ITab) {
    if (!tab || !tab.isPinned) return;

    tab.isPinned = false;

    const list = [...this.list];
    const from = list.indexOf(tab);
    if (from !== -1) list.splice(from, 1);

    // 插到首个「不在固定区」的标签处 = 固定区紧后位置。
    let insertAt = list.length;
    for (let i = 0; i < list.length; i++) {
      if (!this.isTabInPinnedZone(list[i])) {
        insertAt = i;
        break;
      }
    }
    list.splice(insertAt, 0, tab);
    this.list = list;

    store.startupTabs.updateStartupTabItem(tab);
    this.updateTabsBounds(true);
  }

  @action
  public muteTab(tab: ITab) {
    if (tab.discarded) return; // 占位标签无 webContents/音频
    ipcRenderer.send(`mute-view-${store.windowId}`, tab.id);
    tab.isMuted = true;
  }

  @action
  public unmuteTab(tab: ITab) {
    if (tab.discarded) return;
    ipcRenderer.send(`unmute-view-${store.windowId}`, tab.id);
    tab.isMuted = false;
  }

  @action
  public updateTabsBounds(animation: boolean) {
    // 沉浸悬浮头部本身直接显隐，内部标签布局也必须瞬时落位；否则 resize / mouseleave
    // 触发的重算会用 anime.js 改变 width/translateX，看起来像头部横向缩放。
    if (isImmersiveHeaderWindow()) animation = false;

    this.calculateTabMargins();
    this.setTabsWidths(animation);
    // setTabGroupsLefts 已并入 setTabsLefts:芯片本体即 slot 元素,在那里定位。
    this.setTabsLefts(animation);
    // 布局变化(增删标签/窗口尺寸)后刷新标签栏矩形,供跨窗口合并命中检测。
    if (!this.isDragging) {
      this.reportTabStripRect();
    }
  }

  // 标签栏 slot 抽象:每个非分组/固定标签是一个 tab slot;每个标签组(无论含
  // 多少成员)折叠成一个 group slot,位于其首个成员在 list 中的位置。组内其余
  // 成员不再作为独立 slot 渲染(由芯片内 favicon 行表示)。
  public getSlots(): Array<
    { kind: 'tab'; tab: ITab } | { kind: 'group'; group: ITabGroup }
  > {
    const slots: Array<
      { kind: 'tab'; tab: ITab } | { kind: 'group'; group: ITabGroup }
    > = [];
    const seenGroups = new Set<number>();

    for (const tab of this.list) {
      if (tab.isClosing) continue;
      // 固定标签始终独立 slot(即便误带 tabGroupId 也不进芯片)。
      if (tab.isPinned || tab.tabGroupId === -1) {
        slots.push({ kind: 'tab', tab });
        continue;
      }
      if (seenGroups.has(tab.tabGroupId)) continue;
      seenGroups.add(tab.tabGroupId);
      const group = tab.tabGroup;
      // 组记录尚未水合时按 tab slot 兜底渲染,避免首帧缺组时标签消失。
      if (group) slots.push({ kind: 'group', group });
      else slots.push({ kind: 'tab', tab });
    }

    return slots;
  }

  // 芯片解析法宽度:padding + 组名槽 + favicon 行 + 标题槽,clamp 到上限。
  // 固定分组(整组钉住)为紧凑态:不显示活动标题,故不预留 CHIP_ACTIVE_TITLE_W。
  public computeChipWidth(group: ITabGroup): number {
    const tabs = group.tabs;
    let w = CHIP_PAD_LR * 2;
    if (group.name) w += CHIP_NAME_MAX + CHIP_NAME_FAV_GAP;
    w += tabs.length * CHIP_FAV_W;
    if (!group.isPinned) w += CHIP_ACTIVE_TITLE_W;
    return Math.min(w, CHIP_MAX_WIDTH);
  }

  @action
  public calculateTabMargins() {
    const slots = this.getSlots();
    const gapCount = Math.max(0, slots.length - 1);
    const shrinkTabs = store.settings.object.tabOverflowBehavior === 'shrink';

    if (shrinkTabs) {
      // 空间充足时保留完整间距，让选中标签的描边与相邻标签之间有清晰呼吸感；
      // 标签增多后只使用不挤占 36px 图标态宽度的剩余空间，间距会自然降到 0。
      const availableWidth = Math.max(
        0,
        this.containerWidth - ADD_TAB_BUTTON_WIDTH - 6,
      );
      const iconOnlyWidth = 36;
      const affordableMargin =
        gapCount > 0
          ? (availableWidth - slots.length * iconOnlyWidth) / gapCount
          : CHIP_SLOT_MARGIN;
      this.slotMargin = Math.max(
        0,
        Math.min(CHIP_SLOT_MARGIN, affordableMargin),
      );
      this.slotPadding = 0;
    } else {
      this.slotMargin = CHIP_SLOT_MARGIN;
      this.slotPadding = TABS_PADDING;
    }

    // 首个 slot 无间距；其余 slot 使用当前模式算出的统一间距。
    this.leftMargins = gapCount * this.slotMargin;
  }

  @action
  public setTabsWidths(animation: boolean) {
    const slots = this.getSlots();
    const containerWidth = this.containerWidth;
    const shrinkTabs = store.settings.object.tabOverflowBehavior === 'shrink';
    let scrollable = false;

    // Pass A:先解析标签组的理想宽度。滚动模式保持原来的固定芯片宽度；持续
    // 缩小模式仅在固定标签和标签组本身已经塞不下时才按比例压缩它们。
    const chipWidths = new Map<number, number>();
    let chipWidthsTotal = 0;
    for (const slot of slots) {
      if (slot.kind === 'group') {
        const w = this.computeChipWidth(slot.group);
        chipWidths.set(slot.group.id, w);
        chipWidthsTotal += w + this.slotPadding;
        if (!shrinkTabs && w >= CHIP_MAX_WIDTH) scrollable = true;
      }
    }

    // Pass B:普通固定项优先保留宽度；非固定标签组与普通标签作为同级槽位，
    // 平分剩余空间。这样持续缩小时，标签组不会一直挤占固定宽度。
    const pinnedSlots = slots.filter(
      (s) => s.kind === 'tab' && s.tab.isPinned,
    ).length;
    const pinnedWidthsTotal =
      pinnedSlots * (TAB_PINNED_WIDTH + this.slotPadding);
    const pinnedGroupWidthsTotal = slots.reduce(
      (sum, slot) =>
        slot.kind === 'group' && slot.group.isPinned
          ? sum + (chipWidths.get(slot.group.id) || 0)
          : sum,
      0,
    );
    const flexibleSlots =
      slots.filter(
        (s) =>
          (s.kind === 'tab' && !s.tab.isPinned) ||
          (s.kind === 'group' && !s.group.isPinned),
      ).length + this.removedTabs;

    if (shrinkTabs) {
      this.scrollingToEnd = false;
      if (this.containerRef.current?.scrollLeft) {
        this.containerRef.current.scrollLeft = 0;
      }

      const fixedPreferred =
        pinnedSlots * TAB_PINNED_WIDTH + pinnedGroupWidthsTotal;
      const slotPadding = (slots.length + this.removedTabs) * this.slotPadding;
      const widthCapacity = Math.max(
        0,
        containerWidth -
          ADD_TAB_BUTTON_WIDTH -
          6 -
          this.leftMargins -
          slotPadding,
      );
      const fixedScale =
        fixedPreferred > widthCapacity && fixedPreferred > 0
          ? widthCapacity / fixedPreferred
          : 1;
      const remainingWidth = Math.max(
        0,
        widthCapacity - fixedPreferred * fixedScale,
      );
      const sharedWidth =
        flexibleSlots > 0
          ? Math.min(TAB_MAX_WIDTH, remainingWidth / flexibleSlots)
          : TAB_MAX_WIDTH;

      for (const slot of slots) {
        if (slot.kind === 'group') {
          slot.group.setWidth(
            slot.group.isPinned
              ? (chipWidths.get(slot.group.id) || 0) * fixedScale
              : sharedWidth,
            animation,
          );
          continue;
        }
        slot.tab.setWidth(
          slot.tab.isPinned ? TAB_PINNED_WIDTH * fixedScale : sharedWidth,
          animation,
        );
      }

      this.scrollable = false;
      return;
    }

    const shareTabs =
      slots.filter((s) => s.kind === 'tab' && !s.tab.isPinned).length +
      this.removedTabs;

    for (const slot of slots) {
      if (slot.kind === 'group') {
        slot.group.setWidth(chipWidths.get(slot.group.id) || 0, animation);
      }
    }

    const reserved =
      ADD_TAB_BUTTON_WIDTH +
      6 +
      pinnedWidthsTotal +
      chipWidthsTotal +
      this.leftMargins;

    for (const slot of slots) {
      if (slot.kind !== 'tab') continue;
      const tab = slot.tab;
      let width: number;
      if (tab.isPinned) {
        width = TAB_PINNED_WIDTH;
      } else if (shareTabs > 0) {
        width = (containerWidth - reserved) / shareTabs - this.slotPadding;
        if (width > TAB_MAX_WIDTH) width = TAB_MAX_WIDTH;
        if (width < TAB_MIN_WIDTH) width = TAB_MIN_WIDTH;
      } else {
        width = TAB_MAX_WIDTH;
      }
      tab.setWidth(width, animation);
      if (!tab.isPinned && width <= TAB_MIN_WIDTH) scrollable = true;
    }

    this.scrollable = scrollable;
  }

  @action
  public setTabsLefts(animation: boolean) {
    const slots = this.getSlots();
    const { containerWidth } = store.tabs;

    let left = 0;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      // 首个 slot 无左间距,其余按 CHIP_SLOT_MARGIN。
      left += i === 0 ? 0 : this.slotMargin;

      if (slot.kind === 'group') {
        // 正在拖动的芯片由指针直接定位；这里只动画其余槽位让位。
        if (slot.group.id !== this.draggingGroupId) {
          slot.group.setLeft(left, animation);
        }
      } else if (!slot.tab.isDragging) {
        slot.tab.setLeft(left, animation);
      }

      left +=
        (slot.kind === 'group' ? slot.group.width : slot.tab.width) +
        this.slotPadding;
    }

    store.addTab.setLeft(
      Math.min(left, Math.max(0, containerWidth - ADD_TAB_BUTTON_WIDTH)),
      animation,
    );
  }

  // 取消分组:解散整组——所有成员变回散落标签,组记录从内存与持久层移除。
  // 先捕获成员引用,再删组记录(避免遍历中 tabGroup getter 失效)。
  @action
  public dissolveGroup(group: ITabGroup) {
    const members = group.tabs;
    const gid = group.id;
    store.tabGroups.list = store.tabGroups.list.filter((g) => g.id !== gid);
    store.tabGroups.removeGroupDoc(gid);
    for (const t of members) {
      t.tabGroupId = -1;
      store.startupTabs.updateStartupTabItem(t);
    }
    // 成员此前在芯片内,无独立 <Tab> DOM;解散后它们才作为 slot 挂载。同步调
    // updateTabsBounds 时 ref 还是 null → animateTab 失效 → 标签停在 StyledTab
    // 默认的 width:0(表现为原组位置一片空白,直到下次新建标签才补上)。延迟到
    // rAF:先 snap 到目标位(无动画,避免从 0 滑入),再 updateTabsBounds 动画其余。
    requestAnimationFrame(() => {
      for (const t of members) {
        t.setLeft(t.getLeft(), false);
        t.setWidth(t.getWidth(), false);
      }
      this.updateTabsBounds(true);
    });
  }

  // 固定/取消固定分组。钉住时把组成员整体移到列表最前(固定靠左,位于固定标签
  // 之后);取消钉住保持原位。slot 顺序 = list 顺序,故拖拽逻辑(getTabsToReplace
  // 按 list 迭代)与定位(setTabsLefts 按 slot)一致,不会错位。
  @action
  public setGroupPinned(group: ITabGroup, pinned: boolean) {
    store.tabGroups.setPinned(group.id, pinned);
    if (pinned) {
      const members = this.list.filter((t) => t.tabGroupId === group.id);
      const pinnedTabs = this.list.filter(
        (t) => t.isPinned && t.tabGroupId === -1,
      );
      const rest = this.list.filter(
        (t) =>
          t.tabGroupId !== group.id && !(t.isPinned && t.tabGroupId === -1),
      );
      this.list = [...pinnedTabs, ...members, ...rest];
    }
    this.updateTabsBounds(true);
  }

  @action
  public setTabToGroup(tab: ITab, tabGroupId: number) {
    const tabs = [...this.list];

    const tabIndex = tabs.indexOf(tab);
    const groupFirstTabIndex = tabs.findIndex(
      (x) => x.tabGroupId === tabGroupId,
    );

    const groupLastTab = tabs
      .slice()
      .reverse()
      .find((x) => x.tabGroupId === tabGroupId);
    const groupLastTabIndex = tabs.indexOf(groupLastTab);

    const groupTabIndex =
      tabIndex < groupFirstTabIndex
        ? groupFirstTabIndex - 1
        : groupLastTabIndex + 1;

    tab.tabGroupId = tabGroupId;
    tabs.splice(tabIndex, 1);
    tabs.splice(groupTabIndex, 0, tab);
    this.list = tabs;
    // 加入组的动画:芯片本体与其余标签均已挂载,animateTab 能拿到活 ref,
    // 故直接带动画重排——芯片平滑撑宽、邻居缓动让位(easeOutCirc 200ms),
    // 贴近 Chrome 拖入分组的手感。用 false 会瞬时 snap,表现为生硬跳变。
    // (拖入者的 <Tab> DOM 此帧被卸载、化为芯片内 favicon,无需为它单独补动画;
    //  与 removeFromGroup/dissolveGroup 的 rAF snap-first 不同——那两处新挂载
    //  的标签 ref 首帧为 null,这里没有新挂载元素,直接动画即可。)
    this.updateTabsBounds(true);
    // 持久化新的分组归属(此前只改内存,重启丢失)。
    store.startupTabs.updateStartupTabItem(tab);
  }

  @action
  public replaceTab(firstTab: ITab, secondTab: ITab) {
    const index = this.list.indexOf(secondTab);

    const list = [...this.list];

    list[this.list.indexOf(firstTab)] = secondTab;
    list[index] = firstTab;

    this.list = list;

    // 沉浸头部是镜像，拖动过程只做本地视觉重排；松手后统一把顺序交给
    // 主窗口真实 Store 持久化，避免镜像直接写 startupTabs 数据库。
    if (!isImmersiveHeaderWindow()) {
      firstTab.updateData();
      secondTab.updateData();
    }

    this.updateTabsBounds(true);
  }

  // 把 tab 移到 anchor 之前(before=true)或之后。用于悬停弹窗/侧栏内组内重排、
  // 跨组拖拽。不依赖 strip 绝对定位,故侧栏(纯 flexbox)也可用。
  @action
  public moveTabNextTo(tab: ITab, anchor: ITab, before: boolean) {
    if (!tab || !anchor || tab === anchor) return;
    const list = [...this.list];
    const from = list.indexOf(tab);
    if (from === -1) return;
    list.splice(from, 1);
    let anchorIdx = list.indexOf(anchor);
    if (anchorIdx === -1) return;
    if (!before) anchorIdx += 1;
    list.splice(anchorIdx, 0, tab);
    this.list = list;
    this.updateTabsBounds(true);
    tab.updateData();
  }

  // ===== 侧边栏拖拽重排 =====
  // 侧栏是完整列表(每个标签一行,组内成员缩进渲染),用 HTML5 拖放重排。
  // 拖动过程中记录当前落点(目标行 id + 落在其上/下半),由 SidebarTab 渲染插入线。
  public sidebarDragId = -1;
  // 整组拖拽:记录被拖动的组 id,与单标签拖拽互斥。
  public sidebarDragGroupId = -1;
  public sidebarDropTargetId = -1;
  public sidebarDropBefore = false;
  // 落在分组头上:整组高亮,松手把拖动标签并入该组头部。-1 表示未悬停任何组头。
  public sidebarDropGroupId = -1;
  // 整组拖到另一分组头时的目标与插入方向。
  public sidebarDropGroupTargetId = -1;
  public sidebarDropGroupBefore = false;
  // 落在标签行/分组头之外的列表区域:组内标签离组,或整组移到对应区域末尾。
  public sidebarDropOutside = false;

  @action
  public setSidebarDrag(id: number) {
    this.sidebarDragGroupId = -1;
    this.sidebarDragId = id;
  }

  @action
  public setSidebarGroupDrag(groupId: number) {
    this.sidebarDragId = -1;
    this.sidebarDragGroupId = groupId;
    this.clearSidebarDropTarget();
  }

  @action
  public setSidebarDropTarget(targetId: number, before: boolean) {
    if (this.sidebarDropGroupId !== -1) this.sidebarDropGroupId = -1;
    if (this.sidebarDropGroupTargetId !== -1) {
      this.sidebarDropGroupTargetId = -1;
    }
    if (this.sidebarDropOutside) this.sidebarDropOutside = false;
    if (this.sidebarDropTargetId !== targetId)
      this.sidebarDropTargetId = targetId;
    if (this.sidebarDropBefore !== before) this.sidebarDropBefore = before;
  }

  @action
  public setSidebarDropGroup(groupId: number) {
    if (this.sidebarDropTargetId !== -1) this.sidebarDropTargetId = -1;
    if (this.sidebarDropGroupTargetId !== -1) {
      this.sidebarDropGroupTargetId = -1;
    }
    if (this.sidebarDropOutside) this.sidebarDropOutside = false;
    if (this.sidebarDropGroupId !== groupId) this.sidebarDropGroupId = groupId;
  }

  @action
  public setSidebarGroupDropTarget(groupId: number, before: boolean) {
    this.sidebarDropTargetId = -1;
    this.sidebarDropBefore = false;
    this.sidebarDropGroupId = -1;
    this.sidebarDropOutside = false;
    this.sidebarDropGroupTargetId = groupId;
    this.sidebarDropGroupBefore = before;
  }

  @action
  public setSidebarDropOutside() {
    this.sidebarDropTargetId = -1;
    this.sidebarDropBefore = false;
    this.sidebarDropGroupId = -1;
    this.sidebarDropGroupTargetId = -1;
    this.sidebarDropGroupBefore = false;
    this.sidebarDropOutside = true;
  }

  @action
  public clearSidebarDrag() {
    this.sidebarDragId = -1;
    this.clearSidebarDropTarget();
  }

  @action
  public clearSidebarGroupDrag() {
    this.sidebarDragGroupId = -1;
    this.clearSidebarDropTarget();
  }

  @action
  public clearSidebarDropTarget() {
    this.sidebarDropTargetId = -1;
    this.sidebarDropBefore = false;
    this.sidebarDropGroupId = -1;
    this.sidebarDropGroupTargetId = -1;
    this.sidebarDropGroupBefore = false;
    this.sidebarDropOutside = false;
  }

  // 侧栏落点重排:把 tab 放到 anchor 前/后,并把它的分组归属对齐到 anchor 的组
  // (拖到组内成员旁 → 加入该组;拖到散落标签旁 → 离开原组)。这样组内重排、
  // 拖入/拖出分组统一走一条路径,且组成员在 list 中保持连续(anchor 决定落位)。
  @action
  public moveTabInSidebar(tab: ITab, anchor: ITab, before: boolean) {
    if (!tab || !anchor || tab === anchor) return;
    // 固定标签不参与侧栏组重排语义(它们本就独立排在最前)。
    const targetGroupId = anchor.isPinned ? -1 : anchor.tabGroupId;
    this.applySidebarMove(tab, anchor, before, targetGroupId);
  }

  // 拖到侧栏列表空白/分组间隙:解除分组并放到普通标签区末尾。
  @action
  public moveTabOutOfGroupInSidebar(tab: ITab) {
    if (!tab || tab.tabGroupId === -1 || tab.isPinned) return;

    const sourceGroupId = tab.tabGroupId;
    const list = [...this.list];
    const from = list.indexOf(tab);
    if (from === -1) return;
    list.splice(from, 1);
    list.push(tab);

    tab.tabGroupId = -1;
    this.list = list;

    if (!list.some((t) => !t.isClosing && t.tabGroupId === sourceGroupId)) {
      store.tabGroups.list = store.tabGroups.list.filter(
        (g) => g.id !== sourceGroupId,
      );
      store.tabGroups.removeGroupDoc(sourceGroupId);
    }

    this.updateTabsBounds(true);
    store.startupTabs.updateStartupTabItem(tab);
  }

  // 整组拖到另一组头:按目标组前/后移动整个成员块。
  @action
  public moveGroupInSidebar(
    group: ITabGroup,
    anchorGroup: ITabGroup,
    before: boolean,
  ) {
    if (!group || !anchorGroup || group === anchorGroup) return;
    const anchor = before
      ? anchorGroup.tabs[0]
      : anchorGroup.tabs[anchorGroup.tabs.length - 1];
    if (!anchor) return;
    this.moveGroupNextToTabInSidebar(group, anchor, before);
  }

  // 整组拖到标签行旁:若目标属于另一组,以该组整个块为边界插入。
  @action
  public moveGroupNextToTabInSidebar(
    group: ITabGroup,
    anchor: ITab,
    before: boolean,
  ) {
    if (!group || !anchor || anchor.tabGroupId === group.id) return;

    const anchorInPinnedZone = this.isTabInPinnedZone(anchor);
    if (group.isPinned !== anchorInPinnedZone) return;
    // 单独固定标签始终位于固定分组之前,不作为固定分组的换位锚点。
    if (group.isPinned && anchor.isPinned) return;

    const members = this.list.filter((t) => t.tabGroupId === group.id);
    if (members.length === 0) return;
    const list = this.list.filter((t) => t.tabGroupId !== group.id);

    let insertAt: number;
    if (anchor.tabGroupId !== -1) {
      if (before) {
        insertAt = list.findIndex((t) => t.tabGroupId === anchor.tabGroupId);
      } else {
        insertAt = list.length;
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].tabGroupId === anchor.tabGroupId) {
            insertAt = i + 1;
            break;
          }
        }
      }
    } else {
      const anchorIndex = list.indexOf(anchor);
      if (anchorIndex === -1) return;
      insertAt = anchorIndex + (before ? 0 : 1);
    }

    if (insertAt < 0) return;
    list.splice(insertAt, 0, ...members);
    this.commitSidebarGroupMove(list);
  }

  // 整组拖到列表空白:普通组移到列表末尾,固定组移到固定区末尾。
  @action
  public moveGroupToSidebarEnd(group: ITabGroup) {
    if (!group) return;
    const members = this.list.filter((t) => t.tabGroupId === group.id);
    if (members.length === 0) return;
    const list = this.list.filter((t) => t.tabGroupId !== group.id);

    let insertAt = list.length;
    if (group.isPinned) {
      const firstRegular = list.findIndex((t) => !this.isTabInPinnedZone(t));
      if (firstRegular !== -1) insertAt = firstRegular;
    }

    list.splice(insertAt, 0, ...members);
    this.commitSidebarGroupMove(list);
  }

  private commitSidebarGroupMove(list: ITab[]) {
    this.list = list;
    this.updateTabsBounds(true);
    // 整组换位会同时改变跨越区间内所有标签的 order,统一持久化避免重启乱序。
    for (const tab of this.list) {
      store.startupTabs.updateStartupTabItem(tab);
    }
  }

  // 落在分组头:并入该组,插到组内第一个成员之前(组头部)。
  @action
  public moveTabIntoGroup(tab: ITab, groupId: number) {
    if (!tab) return;
    // 固定标签不可入组(Chrome)。固定态下即便拖到组头也不并入。
    if (tab.isPinned) return;
    if (tab.tabGroupId === groupId) return;
    const firstMember = this.list.find(
      (t) => !t.isClosing && t.tabGroupId === groupId,
    );
    if (!firstMember) return;
    this.applySidebarMove(tab, firstMember, true, groupId);
  }

  // 侧栏重排的公共实现:先记源组,改归属 + 重排 list,再收尾(空组销毁 + 持久化 + 动画)。
  @action
  private applySidebarMove(
    tab: ITab,
    anchor: ITab,
    before: boolean,
    targetGroupId: number,
  ) {
    if (!tab || !anchor || tab === anchor) return;

    // 固定区排他:跨固定/非固定区的拖放静默拒绝(Chrome 不允许把标签拖入/拖出固定区)。
    const tabInZone = this.isTabInPinnedZone(tab);
    const anchorInZone = this.isTabInPinnedZone(anchor);
    if (tabInZone !== anchorInZone) return;
    // 固定标签强制无组(anchor 在固定区时忽略 targetGroupId)。
    const effectiveGroupId = anchorInZone ? -1 : targetGroupId;

    const sourceGroupId = tab.tabGroupId;

    const list = [...this.list];
    const from = list.indexOf(tab);
    if (from === -1) return;
    list.splice(from, 1);
    let anchorIdx = list.indexOf(anchor);
    if (anchorIdx === -1) return;
    if (!before) anchorIdx += 1;
    list.splice(anchorIdx, 0, tab);

    tab.tabGroupId = effectiveGroupId;
    this.list = list;

    // 源组因本次移出而清空 → 销毁组记录(内存 + 持久层)。
    if (
      sourceGroupId !== -1 &&
      sourceGroupId !== effectiveGroupId &&
      !list.some((t) => !t.isClosing && t.tabGroupId === sourceGroupId)
    ) {
      store.tabGroups.list = store.tabGroups.list.filter(
        (g) => g.id !== sourceGroupId,
      );
      store.tabGroups.removeGroupDoc(sourceGroupId);
    }

    // 组内/散落标签在侧栏均有独立行 DOM,ref 活着,直接带动画重排即可
    // (不同于顶部 strip 需处理芯片挂载/卸载的 rAF snap-first)。
    this.updateTabsBounds(true);
    store.startupTabs.updateStartupTabItem(tab);
  }

  // 侧栏外部链接拖入:按目标行/分组头换算出 createTab 所需的 list 索引与分组归属。
  // 落在组成员前/后时,新标签并入同组,避免把连续组拆散;落在固定标签附近时,
  // 统一越过整段固定区,保持「固定标签始终在前」。
  public getSidebarLinkOpenTarget(
    anchor: ITab,
    before: boolean,
  ): { listIndex: number; tabGroupId: number } | null {
    if (!anchor) return null;

    if (anchor.isPinned) {
      let insert = 0;
      for (let i = this.list.length - 1; i >= 0; i--) {
        const tab = this.list[i];
        if (!tab.isClosing && tab.isPinned) {
          insert = i + 1;
          break;
        }
      }
      return { listIndex: insert, tabGroupId: -1 };
    }

    const anchorIndex = this.list.indexOf(anchor);
    if (anchorIndex === -1) return null;

    return {
      listIndex: anchorIndex + (before ? 0 : 1),
      tabGroupId: anchor.tabGroupId === -1 ? -1 : anchor.tabGroupId,
    };
  }

  public getSidebarGroupLinkOpenTarget(
    groupId: number,
  ): { listIndex: number; tabGroupId: number } | null {
    const firstMember = this.list.find(
      (tab) => !tab.isClosing && tab.tabGroupId === groupId,
    );
    if (!firstMember) return null;
    const listIndex = this.list.indexOf(firstMember);
    if (listIndex === -1) return null;
    return { listIndex, tabGroupId: groupId };
  }

  @action
  public async openLinkInSidebarNearTab(
    url: string,
    anchor: ITab,
    before: boolean,
  ) {
    const target = this.getSidebarLinkOpenTarget(anchor, before);
    if (!target) return null;
    return this.openLinkAt(url, target.listIndex, target.tabGroupId);
  }

  @action
  public async openLinkInSidebarGroup(url: string, groupId: number) {
    const target = this.getSidebarGroupLinkOpenTarget(groupId);
    if (!target) return null;
    return this.openLinkAt(url, target.listIndex, target.tabGroupId);
  }

  public getTabsToReplace(callingTab: ITab, direction: string) {
    // 拖拽中途加入组后,callingTab 已是组内成员:strip 不再对它做重排/越界判断
    // (组内重排在悬停弹窗里完成)。
    if (callingTab.tabGroupId !== -1) return;

    const tabs = this.list;
    const index = tabs.indexOf(callingTab);
    if (index === -1) return;
    // 新模型下 callingTab 必为非分组标签:组内标签不再作为独立 slot 渲染,无法在
    // strip 发起拖动(其管理在悬停弹窗内)。故移除了旧版 removeFromGroup 越界分支。

    // 固定区排他:固定区成员不可与非成员互换位置(双向都挡)。这取代旧版单向守卫
    // (原仅挡「固定→非固定」),补上「非固定→固定」缺口——未固定标签原来能被拖进
    // 固定区,违反 Chrome 行为。
    const callingInZone = this.isTabInPinnedZone(callingTab);

    if (direction === 'left') {
      for (let i = index - 1; i >= 0; i--) {
        const tab = tabs[i];
        if (tab.isClosing) continue;
        if (callingInZone !== this.isTabInPinnedZone(tab)) break;

        // 邻居属于某组 → 芯片作为整体屏障停下(不与组内成员互换位置)。是否合入
        // 该组改由 updatePendingGroupDrop 按几何悬停判定 + 松手确认,不在此即时合入。
        if (tab.tabGroupId !== -1 && tab.tabGroup) {
          break;
        }

        if (callingTab.left <= tab.width / 2 + tab.left) {
          this.replaceTab(tabs[i + 1], tab);
        } else {
          break;
        }
      }
    } else if (direction === 'right') {
      for (let i = index + 1; i < tabs.length; i++) {
        const tab = tabs[i];
        if (tab.isClosing) continue;
        if (callingInZone !== this.isTabInPinnedZone(tab)) break;

        if (tab.tabGroupId !== -1 && tab.tabGroup) {
          break;
        }

        if (callingTab.left + callingTab.width >= tab.width / 2 + tab.left) {
          this.replaceTab(tabs[i - 1], tab);
        } else {
          break;
        }
      }
    }
  }

  @action
  public beginGroupDrag(group: ITabGroup, pageX: number) {
    if (!group || group.tabs.length === 0 || !this.containerRef.current) return;

    this.draggingGroupId = group.id;
    this.groupOrderChanged = false;
    this.lastMouseX = 0;
    this.isDragging = true;
    this.mouseStartX = pageX;
    this.tabStartX = group.left;
    this.lastScrollLeft = this.containerRef.current.scrollLeft;
    this.pendingGroupDropId = -1;
    this.hideGroupPreview();
  }

  // 顶部芯片换位：从 list 中取出整个成员块，再插到相邻 slot 的前/后。
  // list 是标签顺序的权威数据源，所以该操作也会让顶部、侧栏与会话恢复顺序一致。
  @action
  private moveGroupNextToSlot(
    group: ITabGroup,
    target: { kind: 'tab'; tab: ITab } | { kind: 'group'; group: ITabGroup },
    before: boolean,
  ) {
    const members = this.list.filter((tab) => tab.tabGroupId === group.id);
    if (members.length === 0) return false;

    const list = this.list.filter((tab) => tab.tabGroupId !== group.id);
    let insertAt = -1;

    if (target.kind === 'group') {
      if (target.group.id === group.id) return false;
      if (before) {
        insertAt = list.findIndex((tab) => tab.tabGroupId === target.group.id);
      } else {
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].tabGroupId === target.group.id) {
            insertAt = i + 1;
            break;
          }
        }
      }
    } else {
      insertAt = list.indexOf(target.tab);
      if (insertAt !== -1 && !before) insertAt += 1;
    }

    if (insertAt < 0) return false;
    list.splice(insertAt, 0, ...members);
    this.list = list;
    this.groupOrderChanged = true;
    this.updateTabsBounds(true);
    return true;
  }

  private canGroupCrossSlot(
    group: ITabGroup,
    slot: { kind: 'tab'; tab: ITab } | { kind: 'group'; group: ITabGroup },
  ) {
    const targetInPinnedZone =
      slot.kind === 'group'
        ? slot.group.isPinned
        : this.isTabInPinnedZone(slot.tab);

    if (group.isPinned !== targetInPinnedZone) return false;
    // 单独固定标签恒位于固定分组之前，固定分组之间可以互相排序。
    if (group.isPinned && slot.kind === 'tab') return false;
    return true;
  }

  // 指针可能单帧跨过多个槽位，因此每次换位后重新读取 slots，直到芯片中心
  // 尚未越过下一个相邻槽位的中心。
  public getSlotsToReplaceGroup(group: ITabGroup, direction: string) {
    let guard = this.getSlots().length;
    while (guard-- > 0) {
      const slots = this.getSlots();
      const index = slots.findIndex(
        (slot) => slot.kind === 'group' && slot.group.id === group.id,
      );
      if (index === -1) return;

      const targetIndex = direction === 'left' ? index - 1 : index + 1;
      const target = slots[targetIndex];
      if (!target || !this.canGroupCrossSlot(group, target)) return;

      const targetLeft =
        target.kind === 'group' ? target.group.left : target.tab.left;
      const targetWidth =
        target.kind === 'group' ? target.group.width : target.tab.width;
      const crossed =
        direction === 'left'
          ? group.left <= targetLeft + targetWidth / 2
          : group.left + group.width >= targetLeft + targetWidth / 2;
      if (!crossed) return;

      if (!this.moveGroupNextToSlot(group, target, direction === 'left')) {
        return;
      }
    }
  }

  // 拖拽中判定「待合入的组」:遍历所有组芯片,若被拖标签的水平中心落在某芯片
  // 横向范围内(且该标签尚未属于任何组、非固定标签),记该组 id 高亮之。移开则清零。
  // 仅记录,不改动 list/归属——真正合入延到 onMouseUp,支持拖回原位取消。
  @action
  public updatePendingGroupDrop(callingTab: ITab) {
    if (!callingTab || callingTab.isPinned || callingTab.tabGroupId !== -1) {
      if (this.pendingGroupDropId !== -1) this.pendingGroupDropId = -1;
      return;
    }

    const center = callingTab.left + callingTab.width / 2;
    let target = -1;

    for (const slot of this.getSlots()) {
      if (slot.kind !== 'group') continue;
      const g = slot.group;
      if (center >= g.left && center <= g.left + g.width) {
        target = g.id;
        break;
      }
    }

    if (this.pendingGroupDropId !== target) {
      this.pendingGroupDropId = target;
    }
  }

  @action
  public onMouseUp = (e?: any) => {
    if (this.draggingGroupId !== -1) {
      const changed = this.groupOrderChanged;
      this.draggingGroupId = -1;
      this.groupOrderChanged = false;
      this.isDragging = false;
      this.isTearing = false;
      this.pendingGroupDropId = -1;

      if (changed) {
        if (isImmersiveHeaderWindow()) {
          ipcRenderer.send(`immersive-header-cmd-${store.windowId}`, {
            type: 'reorder',
            order: this.list.map((tab) => tab.id),
          });
        } else {
          // 整组换位会改变跨越区间内全部标签的 order，统一持久化完整顺序。
          for (const tab of this.list) {
            store.startupTabs.updateStartupTabItem(tab);
          }
        }
      }

      this.updateTabsBounds(true);
      return;
    }

    const selectedTab = this.selectedTab;

    // 标签页拖到书签栏（或书签栏中的文件夹）时直接收藏。顶部标签拖拽使用
    // mousemove/mouseup，因此要在“拖出标签栏后撕离成窗口”之前抢先处理。
    const bookmarkDropTarget =
      selectedTab?.isDragging && e
        ? store.bookmarksBar.getDropTargetAtPoint(e.clientX, e.clientY)
        : null;
    if (selectedTab && bookmarkDropTarget) {
      ipcRenderer.send('tab-drag-preview-hide');
      if (this.isTearing) {
        ipcRenderer.send('tab-drag-tearing-cancel', store.windowId);
      }
      this.isDragging = false;
      this.isTearing = false;
      selectedTab.isDragging = false;
      this.pendingGroupDropId = -1;
      void store.bookmarksBar.addDroppedBookmark(
        {
          url: selectedTab.url,
          title: selectedTab.title,
          favicon: selectedTab.favicon,
        },
        bookmarkDropTarget,
      );
      this.updateTabsBounds(true);
      return;
    }

    // 撕离:在标签栏外松手 → 交给主进程决定建窗 or 合并。
    if (this.isTearing && selectedTab) {
      const tabId = selectedTab.id;
      const tab = selectedTab;
      ipcRenderer.send('tab-drag-preview-hide');
      ipcRenderer.send('tab-drag-detach', {
        sourceWindowId: store.windowId,
        tabId,
        screenX: e ? e.screenX : 0,
        screenY: e ? e.screenY : 0,
        tabState: {
          url: tab.url,
          title: tab.title,
          favicon: tab.favicon,
          pinned: tab.isPinned,
          incognito: tab.incognito,
        },
      });

      this.isTearing = false;
      this.isDragging = false;
      tab.isDragging = false;
      this.pendingGroupDropId = -1;
      return;
    }

    this.isDragging = false;
    this.isTearing = false;

    if (selectedTab) {
      selectedTab.isDragging = false;
    }

    // 松手确认合入:拖动中若停在某组芯片上方(pendingGroupDropId 有效),此刻才
    // 真正把标签并入该组(带动画);否则(拖回原位/停在空处)什么都不做,标签
    // 由下面的 updateTabsBounds 缓动回落到自己的位置 —— 即「拖回取消合入」。
    const dropGroupId = this.pendingGroupDropId;
    this.pendingGroupDropId = -1;
    if (
      selectedTab &&
      dropGroupId !== -1 &&
      !selectedTab.isPinned &&
      selectedTab.tabGroupId === -1 &&
      store.tabGroups.getGroupById(dropGroupId)
    ) {
      if (isImmersiveHeaderWindow()) {
        ipcRenderer.send(`immersive-header-cmd-${store.windowId}`, {
          type: 'group',
          id: selectedTab.id,
          groupId: dropGroupId,
        });
        this.updateTabsBounds(false);
        return;
      }
      this.setTabToGroup(selectedTab, dropGroupId);
      return;
    }

    if (isImmersiveHeaderWindow() && selectedTab) {
      ipcRenderer.send(`immersive-header-cmd-${store.windowId}`, {
        type: 'reorder',
        order: this.list.map((tab) => tab.id),
      });
    }
    this.updateTabsBounds(true);
  };

  @action
  public onMouseMove = (e: any) => {
    const { selectedTab } = this;

    if (this.isDragging) {
      const container = this.containerRef;
      const { tabStartX, mouseStartX, lastMouseX, lastScrollLeft } = store.tabs;

      if (!container.current) return;
      const boundingRect = container.current.getBoundingClientRect();

      if (Math.abs(e.pageX - mouseStartX) < 5) {
        return;
      }

      store.canOpenSearch = false;

      if (this.draggingGroupId !== -1) {
        const group = store.tabGroups.getGroupById(this.draggingGroupId);
        if (!group) {
          this.draggingGroupId = -1;
          this.isDragging = false;
          return;
        }

        const newLeft =
          tabStartX +
          e.pageX -
          mouseStartX -
          (lastScrollLeft - container.current.scrollLeft);
        const maxLeft =
          container.current.scrollLeft +
          container.current.offsetWidth -
          group.width -
          this.slotPadding +
          20;
        group.setLeft(Math.max(0, Math.min(newLeft, maxLeft)), false);

        const direction =
          lastMouseX === 0
            ? e.pageX < mouseStartX
              ? 'left'
              : 'right'
            : lastMouseX - e.pageX >= 1
            ? 'left'
            : 'right';
        this.getSlotsToReplaceGroup(group, direction);
        this.lastMouseX = e.pageX;
        return;
      }

      if (!selectedTab) return;
      selectedTab.isDragging = true;

      // 拖出标签栏(垂直越界,或水平远离)→ 进入撕离态。不在撕离态时正常重排。
      // 侧边栏布局几何不同,v1 仅在顶部标签栏启用撕离。
      const tornOut =
        !store.isSidebar &&
        (e.pageY > TOOLBAR_HEIGHT + 32 ||
          e.pageY < -24 ||
          e.pageX < boundingRect.left - 40 ||
          e.pageX > boundingRect.right + 40);

      if (tornOut) {
        if (!this.isTearing) {
          this.isTearing = true;
          // 摘下激活 view,整窗交还 DOM,保证后续 mousemove/mouseup 不被原生页面吞掉。
          ipcRenderer.send('tab-drag-tearing-start', store.windowId);
          ipcRenderer.send('tab-drag-preview-show', {
            title: selectedTab.title,
            favicon: selectedTab.favicon,
            screenX: e.screenX,
            screenY: e.screenY,
          });
        }
        ipcRenderer.send('tab-drag-preview-move', e.screenX, e.screenY);
        this.lastMouseX = e.pageX;
        return;
      }

      // 回到标签栏内:取消撕离态,把 view 挂回,继续常规拖动重排。
      if (this.isTearing) {
        this.isTearing = false;
        ipcRenderer.send('tab-drag-preview-hide');
        ipcRenderer.send('tab-drag-tearing-cancel', store.windowId);
      }

      const newLeft =
        tabStartX +
        e.pageX -
        mouseStartX -
        (lastScrollLeft - container.current.scrollLeft);

      let left = Math.max(0, newLeft);

      if (
        newLeft + selectedTab.width >
        container.current.scrollLeft +
          container.current.offsetWidth -
          this.slotPadding +
          20
      ) {
        left =
          container.current.scrollLeft +
          container.current.offsetWidth -
          selectedTab.width -
          this.slotPadding +
          20;
      }

      selectedTab.setLeft(left, false);

      this.getTabsToReplace(
        selectedTab,
        lastMouseX - e.pageX >= 1 ? 'left' : 'right',
      );

      // 高亮当前悬停到的组芯片(不合入),松手时再确认。
      this.updatePendingGroupDrop(selectedTab);

      this.lastMouseX = e.pageX;
    }
  };

  // ===== 网页链接拖入顶部标签栏 =====
  // 网页(BrowserView)里拖出的链接,鼠标进入本渲染进程的标签栏时由 HTML5 dragover
  // 调用本方法,把鼠标 clientX 换算成与 tab.left 同坐标系(content 坐标,含滚动偏移),
  // 再按 slot 几何算出新标签应插入 list 的索引 + 指示线 X。新标签为普通(非固定、非分组)
  // 标签;落在固定区上方时越过固定 slot 落到其后第一个位置(对齐 Chrome:不能把非固定
  // 标签插到固定标签左侧)。
  public computeLinkDrop(
    clientX: number,
  ): { listIndex: number; indicatorLeft: number } | null {
    const container = this.containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const contentX = clientX - rect.left + container.scrollLeft;

    const slots = this.getSlots();
    const slotLeft = (
      s: { kind: 'tab'; tab: ITab } | { kind: 'group'; group: ITabGroup },
    ) => (s.kind === 'group' ? s.group.left : s.tab.left);
    const slotWidth = (
      s: { kind: 'tab'; tab: ITab } | { kind: 'group'; group: ITabGroup },
    ) => (s.kind === 'group' ? s.group.width : s.tab.width);

    // 第一个「中点在 contentX 右侧」的 slot —— 投放点应在它之前。
    let target = slots.length;
    for (let i = 0; i < slots.length; i++) {
      if (contentX < slotLeft(slots[i]) + slotWidth(slots[i]) / 2) {
        target = i;
        break;
      }
    }

    // 越过固定 slot:非固定新标签不可落在固定标签的左侧。
    let insert = target;
    while (insert < slots.length && slots[insert].kind === 'tab') {
      const slot = slots[insert];
      if (slot.kind !== 'tab' || !slot.tab.isPinned) break;
      insert++;
    }

    if (insert < slots.length) {
      const s = slots[insert];
      const firstMember =
        s.kind === 'group' ? s.group.tabs.find((t) => !t.isClosing) : s.tab;
      const listIndex = firstMember
        ? this.list.indexOf(firstMember)
        : this.list.length;
      return { listIndex: Math.max(0, listIndex), indicatorLeft: slotLeft(s) };
    }

    // 落在所有 slot 之后:指示线放最后一条 slot 的右沿(无 slot 时放 0)。
    let endLeft = 0;
    if (slots.length > 0) {
      const last = slots[slots.length - 1];
      endLeft = slotLeft(last) + slotWidth(last);
    }
    return { listIndex: this.list.length, indicatorLeft: endLeft };
  }

  @action
  public setLinkDropLeft(x: number | null) {
    this.linkDropLeft = x;
  }

  @action
  public clearLinkDrop() {
    this.linkDropLeft = null;
  }

  // 在指定 list 索引处用网页链接新建标签(标签栏 HTML5 拖放落点)。复用 view-create
  // 主进程路径创建 BrowserView;新标签 active 并在落点插入,且不滚到末尾(保持投放位置可见)。
  @action
  public async openLinkAt(
    url: string,
    listIndex: number,
    tabGroupId = -1,
    active = true,
  ) {
    const opts: chrome.tabs.CreateProperties & { index?: number } = {
      url,
      active,
      index: listIndex,
    };
    const id: number = await ipcRenderer.invoke(
      `view-create-${store.windowId}`,
      opts,
    );
    return this.createTab(opts, id, tabGroupId, { skipScrollToEnd: true });
  }

  public revertClosed() {
    // 优先从「最近关闭」历史弹栈(Ctrl+Shift+T / 手势 / 标签右键「撤销」共用);
    // 历史为空时回退到旧的 closedUrl 单值(兼容)。
    if (this.restoreMostRecent()) return;
    if (this.closedUrl) this.addTab({ active: true, url: this.closedUrl }, -1);
  }

  // 关闭时采集快照(由 ITab.close() 调用)。无痕标签 / 空 url 不入列。
  @action
  public pushClosedTab(snap: {
    url: string;
    title: string;
    favicon: string;
    incognito?: boolean;
  }) {
    if (snap.incognito) return;
    if (!snap.url) return;
    // 去重:同 url 只保留最新一次——新快照置顶,旧的移除。
    this.recentlyClosed = this.recentlyClosed.filter((t) => t.url !== snap.url);
    this.recentlyClosed.unshift({
      id: ++this.closedSeq,
      url: snap.url,
      title: snap.title || '新标签页',
      favicon: snap.favicon || '',
      closedAt: Date.now(),
    });
    if (this.recentlyClosed.length > 50) {
      this.recentlyClosed = this.recentlyClosed.slice(0, 50);
    }
  }

  // 列表视图:30 分钟内全部(最新在前),不足 10 个则用更早的补足,最多 10。
  // 非缓存 getter——每次访问按当前时间重算,避免时间越过 30 分钟后列表不刷新。
  public get recentlyClosedView(): IClosedTabSnapshot[] {
    const now = Date.now();
    const WIN = 30 * 60 * 1000;
    const within: IClosedTabSnapshot[] = [];
    const older: IClosedTabSnapshot[] = [];
    for (const t of this.recentlyClosed) {
      (now - t.closedAt <= WIN ? within : older).push(t);
    }
    if (within.length >= 10) return within.slice(0, 10);
    return within.concat(older).slice(0, 10);
  }

  // 从列表恢复指定项:开新标签(透传标题/图标)并从历史移除。
  @action
  public restoreClosedTab(entry: IClosedTabSnapshot) {
    this.addTab(
      {
        active: true,
        url: entry.url,
        title: entry.title,
        favicon: entry.favicon,
      },
      -1,
    );
    this.recentlyClosed = this.recentlyClosed.filter((t) => t !== entry);
  }

  // 恢复最近一个(右键 / revertClosed 用)。空历史返回 false。
  @action
  public restoreMostRecent(): boolean {
    if (this.recentlyClosed.length === 0) return false;
    const [first, ...rest] = this.recentlyClosed;
    this.recentlyClosed = rest;
    this.addTab(
      {
        active: true,
        url: first.url,
        title: first.title,
        favicon: first.favicon,
      },
      -1,
    );
    return true;
  }

  // ===== 标签组悬停弹窗协调 =====
  // 弹窗是独立 BrowserView(浮于网页之上,避免被遮挡),其显隐/内容由本窗口
  // 经主进程驱动;弹窗内的交互(选中/关闭/右键/拖拽/鼠标进出)经主进程回传到这里执行。
  public groupPreviewGroupId = -1;
  private groupPreviewRect: { x: number; y: number } = { x: 0, y: 0 };
  private previewHideTimer: any;

  private buildGroupPreviewPayload(
    group: ITabGroup,
    rect: { x: number; y: number },
  ) {
    const tabs = group.tabs.map((t) => ({
      id: t.id,
      title: t.title,
      favicon: t.favicon,
      selected: t.isSelected,
      loading: t.loading,
      discarded: t.discarded,
    }));
    // 卡片内容尺寸。
    const cardW = 280;
    const headerH = 34;
    const rowH = 36;
    const cardH = Math.min(400, headerH + tabs.length * rowH + 12);
    // 卡片相对 BrowserView 内缩 SHADOW_M,留出阴影渲染空间——投影不再被
    // BrowserView 边界硬裁(原 width=cardW、卡片全填,阴影边缘发脏)。
    const SHADOW_M = 12;
    // 先把「卡片左上角」夹紧到屏幕可见区(8px 屏边),再换算成 BrowserView 坐标。
    const cardX = Math.max(
      8,
      Math.min(rect.x, this.containerWidth - cardW - 8),
    );
    const cardY = Math.max(8, Math.min(rect.y, window.innerHeight - cardH - 8));
    // BrowserView = 卡片外扩 SHADOW_M 一圈。
    const x = cardX - SHADOW_M;
    const y = cardY - SHADOW_M;
    const width = cardW + SHADOW_M * 2;
    const height = cardH + SHADOW_M * 2;
    return {
      groupId: group.id,
      groupName: group.name,
      groupColor: group.color,
      palette: store.tabGroups.palette,
      tabHoverActivationBehavior:
        store.settings.object.tabHoverActivationBehavior,
      tabHoverActivationDelay: store.settings.object.tabHoverActivationDelay,
      tabs,
      x,
      y,
      width,
      height,
    };
  }

  public openGroupPreview(group: ITabGroup, rect: { x: number; y: number }) {
    if (group.tabs.length === 0) return;
    this.cancelPreviewHide();
    this.groupPreviewRect = rect;
    this.groupPreviewGroupId = group.id;
    ipcRenderer.send(
      `show-tabgroup-preview-${store.windowId}`,
      this.buildGroupPreviewPayload(group, rect),
    );
  }

  public refreshGroupPreview() {
    if (this.groupPreviewGroupId === -1) return;
    const group = store.tabGroups.getGroupById(this.groupPreviewGroupId);
    if (!group || group.tabs.length === 0) {
      this.hideGroupPreview();
      return;
    }
    ipcRenderer.send(
      `refresh-tabgroup-preview-${store.windowId}`,
      this.buildGroupPreviewPayload(group, this.groupPreviewRect),
    );
  }

  public hideGroupPreview() {
    this.groupPreviewGroupId = -1;
    ipcRenderer.send(`hide-tabgroup-preview-${store.windowId}`);
  }

  public schedulePreviewHide(delay = 200) {
    clearTimeout(this.previewHideTimer);
    this.previewHideTimer = setTimeout(() => this.hideGroupPreview(), delay);
  }

  public cancelPreviewHide() {
    clearTimeout(this.previewHideTimer);
  }

  // 弹窗内交互回传(经主进程转发)。
  public onPreviewAction(payload: any) {
    if (!payload || payload.groupId !== this.groupPreviewGroupId) return;
    const tab = this.getTabById(payload.tabId);
    switch (payload.type) {
      case 'activateOnHover':
        if (tab && store.settings.object.tabHoverActivationBehavior !== 'off') {
          void tab
            .activateOnHover(
              store.settings.object.tabHoverActivationBehavior ===
                'activate-and-switch',
            )
            .finally(() => this.refreshGroupPreview());
        }
        break;
      case 'select':
        tab?.select();
        this.refreshGroupPreview();
        break;
      case 'close':
        tab?.close();
        this.refreshGroupPreview();
        break;
      case 'removegroup':
        // 从分组移出:成为散落标签。removeFromGroup 已处理"末位离组→组消失"
        // 并持久化 tabGroupId=-1;组空时 refreshGroupPreview 会自动关闭弹窗。
        tab?.removeFromGroup();
        this.refreshGroupPreview();
        break;
      case 'contextmenu': {
        if (tab) {
          import('../utils/tab-context-menu').then((m) =>
            m.showTabContextMenu(tab),
          );
        }
        break;
      }
      case 'reorder': {
        const from = this.getTabById(payload.fromId);
        const to = this.getTabById(payload.toId);
        if (from && to) this.moveTabNextTo(from, to, !!payload.before);
        this.refreshGroupPreview();
        break;
      }
      case 'setcolor': {
        // 悬停弹窗色盘自定义基准色。
        store.tabGroups.setColor(this.groupPreviewGroupId, payload.color);
        this.refreshGroupPreview();
        break;
      }
      case 'rename': {
        // 悬停弹窗内联输入框改名。
        store.tabGroups.rename(this.groupPreviewGroupId, payload.name);
        this.refreshGroupPreview();
        break;
      }
      case 'new': {
        const groupId = this.groupPreviewGroupId;
        this.addTab(undefined, groupId).then(() => this.refreshGroupPreview());
        break;
      }
    }
  }

  // ===== 侧边栏缩放模式悬停浮层协调 =====
  // 缩放模式下侧边栏收成 62px 窄轨,鼠标移入窄轨时弹出这个浮层(独立 BrowserView,
  // 浮于网页之上),展示与固定模式一致的完整侧边栏。显隐/内容由本窗口经主进程驱动;
  // 浮层内交互(选中/关闭/新建/折叠分组/切回固定)经主进程回传这里执行。
  // 与标签组悬停弹窗同构。
  public panelVisible = false;
  private panelHideTimer: any;
  // 原生右键菜单打开时,指针会短暂离开悬浮 BrowserView;此时不能执行自动收起。
  private sidebarPanelMenuOpen = false;
  // 浮层内分组折叠态(按组 id)。默认展开。与顶部窄轨互不影响。
  public panelGroupCollapsed: { [gid: number]: boolean } = {};

  private buildSidebarPanelPayload() {
    const side = store.tabsLayout === 'right' ? 'right' : 'left';
    const tabs = this.list
      .filter((t) => !t.isClosing)
      .map((t) => {
        const group = t.tabGroupId !== -1 ? t.tabGroup : undefined;
        return {
          id: t.id,
          title: t.title,
          url: t.url,
          favicon: t.favicon,
          selected: t.isSelected,
          loading: t.loading,
          discarded: t.discarded,
          pinned: !!t.isPinned,
          groupId: t.tabGroupId,
          groupColor: group ? group.color : undefined,
          groupName: group
            ? group.name || `${group.tabs.length} 个标签页`
            : undefined,
          // 原始组名(可能为空),供浮层内改名输入框初始化;上面的 groupName 带
          // 「N 个标签页」兜底用于显示。
          groupNameRaw: group ? group.name : undefined,
          groupPinned: group ? group.isPinned : undefined,
        };
      });

    // 浮层尺寸:宽度取设置里的 sidebarWidth 再加宽一档(浮层比固定侧栏更宽敞,
    // 标题不易截断),高度铺满窗口。位置与窄轨同侧对齐(左栏:左缘对齐 x=0;
    // 右栏:右缘贴窗口右缘)——即浮层盖住窄轨向内展开,而非贴在窄轨内侧另起。
    const width = (store.settings.object.sidebarWidth || 240) + 60;
    const height = window.innerHeight;
    const winW = window.innerWidth;
    const x = side === 'left' ? 0 : winW - width;
    return {
      side,
      pinned: false,
      palette: store.tabGroups.palette,
      closeTabOnRightClick: store.settings.object.closeTabOnRightClick,
      tabCloseButtonDisplay: store.settings.object.tabCloseButtonDisplay,
      tabWheelBehavior: store.settings.object.tabWheelBehavior,
      tabHoverActivationBehavior:
        store.settings.object.tabHoverActivationBehavior,
      tabHoverActivationDelay: store.settings.object.tabHoverActivationDelay,
      groupsCollapsed: { ...this.panelGroupCollapsed },
      tabs,
      x,
      y: 0,
      width,
      height,
    };
  }

  public openSidebarPanel() {
    this.cancelSidebarPanelHide();
    // 已可见时只取消待定收起,绝不重发 show——重发会让浮层重放滑入动画。
    // 指针在「窄轨↔浮层」边界抖动时,这一守卫避免动画反复触发。
    if (this.panelVisible) return;
    this.panelVisible = true;
    ipcRenderer.send(
      `show-sidebar-panel-${store.windowId}`,
      this.buildSidebarPanelPayload(),
    );
  }

  public refreshSidebarPanel() {
    if (!this.panelVisible) return;
    ipcRenderer.send(
      `refresh-sidebar-panel-${store.windowId}`,
      this.buildSidebarPanelPayload(),
    );
  }

  public hideSidebarPanel() {
    if (this.sidebarPanelMenuOpen) return;
    this.panelVisible = false;
    ipcRenderer.send(`hide-sidebar-panel-${store.windowId}`);
  }

  public scheduleSidebarPanelHide(delay = 200) {
    clearTimeout(this.panelHideTimer);
    if (this.sidebarPanelMenuOpen) return;
    this.panelHideTimer = setTimeout(() => this.hideSidebarPanel(), delay);
  }

  public cancelSidebarPanelHide() {
    clearTimeout(this.panelHideTimer);
  }

  private startSidebarPanelMenu() {
    this.sidebarPanelMenuOpen = true;
    this.cancelSidebarPanelHide();
  }

  private endSidebarPanelMenu() {
    this.sidebarPanelMenuOpen = false;
    // 右键菜单中的建组、移出分组、固定等操作直接修改宿主 store；悬浮栏是独立
    // BrowserView 的数据镜像，菜单关闭时统一重新推送最新结构。
    this.refreshSidebarPanel();
    // 菜单关闭后若指针未回到浮层,恢复原先的自动收起；已回到浮层时 enter 会取消它。
    this.scheduleSidebarPanelHide(250);
  }

  // 浮层内交互回传(经主进程转发)。
  public onSidebarPanelAction(payload: any) {
    if (!payload) return;
    const tab = this.getTabById(payload.tabId);
    switch (payload.type) {
      case 'activateOnHover':
        if (tab && store.settings.object.tabHoverActivationBehavior !== 'off') {
          void tab
            .activateOnHover(
              store.settings.object.tabHoverActivationBehavior ===
                'activate-and-switch',
            )
            .finally(() => this.refreshSidebarPanel());
        }
        break;
      case 'select':
        tab?.select();
        this.refreshSidebarPanel();
        break;
      case 'wheelSwitch':
        if (payload.direction === 1 || payload.direction === -1) {
          this.switchAdjacentTab(payload.direction);
          this.refreshSidebarPanel();
        }
        break;
      case 'close':
        tab?.close();
        this.refreshSidebarPanel();
        break;
      case 'moveTab': {
        const anchor = this.getTabById(payload.anchorTabId);
        if (tab && anchor) {
          this.moveTabInSidebar(tab, anchor, !!payload.before);
        }
        this.refreshSidebarPanel();
        break;
      }
      case 'moveTabIntoGroup':
        if (tab && typeof payload.groupId === 'number') {
          this.moveTabIntoGroup(tab, payload.groupId);
        }
        this.refreshSidebarPanel();
        break;
      case 'moveGroup': {
        const group = store.tabGroups.getGroupById(payload.groupId);
        const anchor = store.tabGroups.getGroupById(payload.anchorGroupId);
        if (group && anchor) {
          this.moveGroupInSidebar(group, anchor, !!payload.before);
        }
        this.refreshSidebarPanel();
        break;
      }
      case 'new':
        this.addTab(
          undefined,
          typeof payload.groupId === 'number' ? payload.groupId : -1,
        ).then(() => this.refreshSidebarPanel());
        break;
      case 'toggleGroup': {
        const gid = payload.groupId;
        this.panelGroupCollapsed = {
          ...this.panelGroupCollapsed,
          [gid]: !this.panelGroupCollapsed[gid],
        };
        this.refreshSidebarPanel();
        break;
      }
      case 'contextmenu': {
        if (tab) {
          this.startSidebarPanelMenu();
          import('../utils/tab-context-menu').then((m) =>
            m.showTabContextMenu(tab, () => this.endSidebarPanelMenu()),
          );
        }
        break;
      }
      case 'groupcontextmenu': {
        const group = store.tabGroups.getGroupById(payload.groupId);
        if (group) {
          this.startSidebarPanelMenu();
          import('../utils/tab-context-menu').then((m) =>
            m.showTabGroupContextMenu(group, () => this.endSidebarPanelMenu()),
          );
        }
        break;
      }
      case 'closegroup': {
        const group = store.tabGroups.getGroupById(payload.groupId);
        if (group) {
          for (const groupTab of [...group.tabs]) groupTab.close();
          this.refreshSidebarPanel();
        }
        break;
      }
      case 'setcolor':
        // 浮层内组色圆点色盘改色。
        store.tabGroups.setColor(payload.groupId, payload.color);
        this.refreshSidebarPanel();
        break;
      case 'rename':
        // 浮层内双击组名改名。
        store.tabGroups.rename(payload.groupId, payload.name);
        this.refreshSidebarPanel();
        break;
      case 'setpinned':
        // 浮层内点钉子:切回固定模式并收起浮层。
        store.settings.setSidebarPinned(true);
        this.hideSidebarPanel();
        break;
      case 'openLink': {
        if (!payload.url) break;
        if (typeof payload.groupId === 'number' && payload.groupId !== -1) {
          this.openLinkInSidebarGroup(payload.url, payload.groupId);
        } else if (typeof payload.anchorTabId === 'number') {
          const anchor = this.getTabById(payload.anchorTabId);
          if (anchor) {
            this.openLinkInSidebarNearTab(
              payload.url,
              anchor,
              !!payload.before,
            );
          } else {
            this.openLinkAt(payload.url, this.list.length);
          }
        } else {
          this.openLinkAt(payload.url, this.list.length);
        }
        this.refreshSidebarPanel();
        break;
      }
    }
  }
}
