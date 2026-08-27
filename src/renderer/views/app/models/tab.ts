import { ipcRenderer } from 'electron';
import { observable, computed, action, makeObservable } from 'mobx';
import * as React from 'react';
import { parse as parseUrl } from 'url';

import store from '../store';
import {
  TAB_ANIMATION_DURATION,
  TAB_MIN_WIDTH,
  TAB_MAX_WIDTH,
  TAB_PINNED_WIDTH,
} from '../constants';
import { callViewMethod } from '~/utils/view';
import { animateTab } from '../utils/tabs';
import { getWebUIURL } from '~/common/webui';
import { ADD_TAB_BUTTON_WIDTH } from '~/constants/design';
import { isImmersiveHeaderWindow } from '../utils/windows';

export class ITab {
  // 工作区文档中的稳定键。普通窗口留空;工作区重开后用它维持标签身份。
  public workspaceKey?: string;
  private static nextViewKey = 0;

  public readonly viewKey = `tab-${++ITab.nextViewKey}`;

  public id = -1;

  public addressbarFocused = false;
  public addressbarSelectionRange = [0, 0];

  public width = 0;
  public left = 0;

  public lastUrl = '';
  public isClosing = false;
  public ref = React.createRef<HTMLDivElement>();

  public removeTimeout: any;

  public marginLeft = 0;

  // Observable

  public isDragging = false;

  public isPinned = false;

  public isMuted = false;

  public isPlaying = false;

  public title = '新标签页';

  public loading = true;

  public favicon = '';

  // 延迟加载标记(内存节省):为 true 表示该标签尚未创建 BrowserView,
  // 仅在标签栏显示标题/图标。切换到它时由主进程 materialize 后回写为 false。
  public discarded = false;
  // 占位标签点击后到真实 BrowserView 创建完成前的过渡态。
  // 这段时间先显示 loading 转圈,并防止重复触发 materialize。
  public materializing = false;

  public tabGroupId = -1;

  // 创建当前标签的来源标签。关闭当前标签时优先回到来源页，保持 Chrome 的行为。
  public openerTabId = -1;

  // True for an incognito ("无痕") tab — either an individually-opened
  // incognito tab inside a normal window, or any tab in an incognito window.
  // Drives the distinct tab styling and skips history/startup persistence.
  public incognito = false;

  public addressbarValue: string = null;

  public url = '';

  public blockedAds: any[] = [];

  public videoUrls: string[] = [];
  public filtersCount = 0;

  // 当前域名是否被加入广告拦截白名单(即本站已暂停拦截)
  public siteWhitelisted = false;

  public hasCredentials = false;

  // 网页翻译:页面语言与 App 语言不一致时为 true,地址栏显示翻译图标。
  public canTranslate = false;

  // 检测到的页面语言主语种子(如 'en'/'ja'),仅用于 tooltip 提示。
  public detectedLanguage = '';

  // 当前页是否已点击翻译(用于图标高亮/还原态切换,仅本地态)。
  public translated = false;

  // 当前翻译目标语言(如 'zh-CN'),由主进程 translate-state 事件同步。
  public translateTarget = 'zh-CN';

  // PWA 安装:页面满足 manifest + SW 条件时为 true,地址栏显示安装图标。
  public canInstallPwa = false;
  // 探测到的 PWA manifest 快照(主进程下发,用于安装弹窗渲染)。
  public pwaManifest: any = null;
  // 本站是否已安装为 PWA。已安装时图标呈"已安装"态(蓝色)。
  public pwaInstalled = false;

  // Computed
  public get isSelected() {
    return this.id !== -1 && store.tabs.selectedTabId === this.id;
  }

  public get isHovered() {
    return this.id !== -1 && store.tabs.hoveredTabId === this.id;
  }

  public get isExpanded() {
    return (
      this.isHovered ||
      this.isSelected ||
      (!store.tabs.scrollable && this.width > TAB_MIN_WIDTH)
    );
  }

  public get isIconSet() {
    return this.favicon !== '' || this.loading;
  }

  public constructor(
    {
      active,
      url,
      pinned,
      incognito,
      title,
      favicon,
      discarded,
    }: chrome.tabs.CreateProperties & {
      incognito?: boolean;
      title?: string;
      favicon?: string;
      discarded?: boolean;
    },
    id: number,
  ) {
    makeObservable(this, {
      // 顶部标签的关闭按钮密度取决于 width。新标签首帧宽度为 0，布局完成
      // 后必须通知 React 重渲染，否则悬停按钮会一直维持 0 宽。
      width: observable,
      addressbarValue: observable,
      url: observable,
      favicon: observable,
      loading: observable,
      discarded: observable,
      materializing: observable,
      tabGroupId: observable,
      isDragging: observable,
      isPinned: observable,
      isMuted: observable,
      isPlaying: observable,
      title: observable,
      blockedAds: observable,
      videoUrls: observable,
      siteWhitelisted: observable,
      hasCredentials: observable,
      canTranslate: observable,
      detectedLanguage: observable,
      translated: observable,
      translateTarget: observable,
      canInstallPwa: observable,
      pwaManifest: observable,
      pwaInstalled: observable,
      isSelected: computed,
      isHovered: computed,
      isExpanded: computed,
      isIconSet: computed,
    });

    this.url = url;
    this.id = id;
    this.isPinned = pinned;
    // Either an explicitly-opened incognito tab, or any tab in an incognito
    // window.
    this.incognito = !!incognito || store.isIncognito;

    // 延迟标签(内存节省):用恢复时持久化的标题/图标填充标签栏,
    // 且不显示 loading 转圈(尚未 loadURL,由主进程 materialize 后触发加载)。
    this.discarded = !!discarded;
    if (title) this.title = title;
    if (favicon) this.favicon = favicon;
    this.loading = !this.discarded;

    if (getWebUIURL('newtab').startsWith(url)) {
      this.addressbarFocused = true;
    }

    if (active) {
      requestAnimationFrame(() => {
        this.select();
      });
    }

    if (process.env.ENABLE_EXTENSIONS && !this.discarded) {
      // 占位标签(discarded)不注册 browser action:它未加载、非选中,工具栏不
      // 显示其按钮;loadDiscardedTab 走新建流程时再按真实 id 注册,避免错位。
      const { defaultBrowserActions } = store.extensions;

      for (const item of defaultBrowserActions) {
        store.extensions.addBrowserActionToTab(this.id, item);
      }
    }
  }

  @action
  public async updateData() {
    if (!this.incognito) {
      await store.startupTabs.addStartupTabItem({
        id: this.id,
        windowId: store.windowId,
        url: this.url,
        favicon: this.favicon,
        pinned: !!this.isPinned,
        title: this.title,
        tabGroupId: this.tabGroupId,
        isUserDefined: false,
        order: store.tabs.list.indexOf(this),
      });
    }
  }

  // 查询当前域名是否在广告拦截白名单中,用于地址栏盾牌图标显示
  public async refreshSiteWhitelisted() {
    try {
      const hostname = parseUrl(this.url).hostname || '';
      if (!hostname) {
        this.siteWhitelisted = false;
        return;
      }
      this.siteWhitelisted = await ipcRenderer.invoke(
        'is-site-whitelisted',
        hostname,
      );
    } catch (e) {
      this.siteWhitelisted = false;
    }
  }

  public get tabGroup() {
    return store.tabGroups.getGroupById(this.tabGroupId);
  }

  @action
  public async select() {
    if (this.isClosing) return;

    // 沉浸悬浮头部:标签操作回传主渲染进程执行(单一数据源),本地仅乐观更新高亮。
    if (isImmersiveHeaderWindow()) {
      store.tabs.selectedTabId = this.id;
      ipcRenderer.send(`immersive-header-cmd-${store.windowId}`, {
        type: 'select',
        id: this.id,
      });
      return;
    }

    // 占位标签(内存节省):走新建标签流程加载内容(得到真实 id),再选中显示。
    if (this.discarded) {
      await store.tabs.loadDiscardedTab(this);
      return;
    }

    store.tabs.selectedTabId = this.id;
    if (!this.incognito) {
      store.startupTabs.setActiveStartupTab(this.id);
    }
    // 记录组内当前标签:点击组名时切换到它(内存派生,不持久化)。
    if (this.tabGroup) this.tabGroup.selectedTabId = this.id;

    ipcRenderer.send(`browserview-show-${store.windowId}`);

    const focused = this.addressbarFocused;

    await ipcRenderer.invoke(
      `view-select-${store.windowId}`,
      this.id,
      !this.addressbarFocused,
    );

    if (focused && store.inputRef) {
      store.inputRef.focus();
      store.inputRef.setSelectionRange(
        this.addressbarSelectionRange[0],
        this.addressbarSelectionRange[1],
      );
    }
  }

  // 悬停可只在后台恢复，也可恢复后切换到该标签。
  public async activateOnHover(switchToTab = false) {
    if (this.isClosing) return;
    if (this.discarded) {
      await store.tabs.loadDiscardedTab(this, switchToTab);
    } else if (switchToTab && !this.isSelected) {
      await this.select();
    }
  }

  public getWidth(containerWidth: number = null, tabs: ITab[] = null) {
    if (this.isPinned) return TAB_PINNED_WIDTH;

    // 组内标签无独立 strip 宽度(它们在芯片 favicon 行里)。返回最近宽度(或最小
    // 宽度)供关闭动画等路径使用,避免参与非分组标签的平分计算。
    if (this.tabGroupId !== -1) return this.width || TAB_MIN_WIDTH;

    if (containerWidth === null) {
      containerWidth = store.tabs.containerWidth;
    }

    const slots = store.tabs.getSlots();
    const pinnedWidths =
      slots.filter((s) => s.kind === 'tab' && s.tab.isPinned).length *
      (TAB_PINNED_WIDTH + store.tabs.slotPadding);
    const chipWidths = slots
      .filter((s) => s.kind === 'group')
      .reduce((acc, s) => acc + s.group.width + store.tabs.slotPadding, 0);
    const shareTabs =
      slots.filter((s) => s.kind === 'tab' && !s.tab.isPinned).length +
      store.tabs.removedTabs;

    // TabsContainer 右侧留出了 padding(见 Tabbar/style.ts)给浮动的
    // 「+ 新建标签」按钮。offsetWidth 含该 padding,这里减掉它,标签才会恰好
    // 铺满可见内容区。reserved 还含固定标签 + 芯片 + slot 间距。
    const reserved =
      ADD_TAB_BUTTON_WIDTH +
      6 +
      pinnedWidths +
      chipWidths +
      store.tabs.leftMargins;

    const width =
      shareTabs > 0
        ? (containerWidth - reserved) / shareTabs - store.tabs.slotPadding
        : TAB_MAX_WIDTH;

    if (width > TAB_MAX_WIDTH) return TAB_MAX_WIDTH;
    const minWidth =
      store.settings.object.tabOverflowBehavior === 'shrink'
        ? 0
        : TAB_MIN_WIDTH;
    if (width < minWidth) return minWidth;
    return width;
  }

  public getLeft(calcNewLeft = false) {
    const slots = store.tabs.getSlots();

    if (calcNewLeft) store.tabs.calculateTabMargins();

    let left = 0;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      left += i === 0 ? 0 : store.tabs.slotMargin;

      const isSelf =
        slot.kind === 'tab'
          ? slot.tab === this
          : slot.group.tabs.some((t) => t === this);

      if (isSelf) return left;

      left +=
        (slot.kind === 'group' ? slot.group.width : slot.tab.width) +
        store.tabs.slotPadding;
    }

    return left;
  }

  public removeFromGroup() {
    if (!this.tabGroup) return;

    const groupId = this.tabGroupId;

    if (this.tabGroup.tabs.length === 1) {
      // 组内最后一个成员离开 → 组消失:从内存移除并删除持久化记录。
      store.tabGroups.list = store.tabGroups.list.filter(
        (x) => x.id !== groupId,
      );
      store.tabGroups.removeGroupDoc(groupId);
    }

    this.tabGroupId = -1;
    // 离组后本标签才作为独立 slot 挂载 <Tab>(此前在芯片内无独立 DOM)。同步
    // updateTabsBounds 时 ref 还是 null → animateTab 失效 → 停在 width:0 的
    // 空白态。延迟到 rAF,snap 到位后再布局动画(同 dissolveGroup / createTab)。
    requestAnimationFrame(() => {
      this.setLeft(this.getLeft(), false);
      this.setWidth(this.getWidth(), false);
      store.tabs.updateTabsBounds(true);
    });
    // 持久化"已离组"(此前只改内存,重启后仍带旧 tabGroupId)。
    store.startupTabs.updateStartupTabItem(this);
  }

  @action
  public setLeft(left: number, animation: boolean) {
    if (animation && this.left === left) return;
    animateTab('translateX', left, this.ref.current, animation);
    this.left = left;
  }

  @action
  public setWidth(width: number, animation: boolean) {
    if (animation && this.width === width) return;
    animateTab('width', width, this.ref.current, animation);
    this.width = width;
  }

  @action
  public close() {
    if (this.isClosing) return;

    // 沉浸悬浮头部:关闭回传主渲染进程执行(在真实 store 上销毁 view + 写库),
    // 本地不直接毁 view/删库,避免孤儿 view 与 startupTabs 污染。
    if (isImmersiveHeaderWindow()) {
      ipcRenderer.send(`immersive-header-cmd-${store.windowId}`, {
        type: 'close',
        id: this.id,
      });
      return;
    }

    store.tabs.closedUrl = this.url;
    store.tabs.pushClosedTab({
      url: this.url,
      title: this.title,
      favicon: this.favicon,
      incognito: this.incognito,
    });
    store.tabs.canShowPreview = false;
    ipcRenderer.send(`hide-tab-preview-${store.windowId}`);

    const selected = this.isSelected;

    store.startupTabs.removeStartupTabItem(this.id);

    // 占位标签未创建 View,无需销毁主进程 view。
    if (!this.discarded) {
      ipcRenderer.send(`view-destroy-${store.windowId}`, this.id);
    }

    const notClosingTabs = store.tabs.list.filter((x) => !x.isClosing);
    const index = notClosingTabs.indexOf(this);

    if (notClosingTabs.length === 1) {
      //closeWindow();
      // 关闭最后一个可用标签时补出空白页。批量关闭期间 list 仍保留正在播放
      // 退出动画的标签，因此必须按 notClosingTabs 判断，不能使用物理数组长度。
      void store.tabs.addTab(undefined, -1);
    }

    this.isClosing = true;
    if (notClosingTabs.length - 1 === index) {
      const previousTab = store.tabs.list[index - 1];
      if (previousTab) {
        this.setLeft(previousTab.getLeft(true) + this.getWidth(), true);
      }
      store.tabs.updateTabsBounds(true);
    } else {
      // 仅非分组标签占用平分宽度槽位:关闭时用 removedTabs 维持分母稳定,避免
      // 动画期间其它标签抖动。组内标签在芯片里不参与平分,关闭不应计入。
      if (this.tabGroupId === -1) store.tabs.removedTabs++;
    }

    this.removeFromGroup();

    this.setWidth(0, true);
    store.tabs.setTabsLefts(true);

    if (selected) {
      const nextTab = store.tabs.getTabToSelectAfterRemoval(
        this,
        notClosingTabs,
      );
      nextTab?.select();
    }

    this.removeTimeout = setTimeout(() => {
      store.tabs.removeTab(this.id);
    }, TAB_ANIMATION_DURATION);
  }

  public callViewMethod = (scope: string, ...args: any[]): Promise<any> => {
    return callViewMethod(this.id, scope, ...args);
  };
}
