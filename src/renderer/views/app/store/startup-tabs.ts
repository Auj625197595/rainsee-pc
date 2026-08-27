import {makeObservable, observable} from 'mobx';
import {ipcRenderer} from 'electron';

import {Store} from '.';
import * as remote from '@electron/remote';
import {prefixHttp, isURL} from '~/utils';
import {getIconByUrlNet} from '~/utils/url';
import {Database} from '~/models/database';
import {IStartupTab} from '~/interfaces/startup-tab';
import {ITab} from '../models';
import type {AddTabsBehavior} from './tabs';
import {getWebUIURL} from "~/common/webui";
import {isImmersiveHeaderWindow} from '../utils/windows';
import {rendererStartupMark, rendererStartupTimer} from './startup-timing';

const CRASH_RESTORE_ARG = '--restore-after-crash=';
const INITIAL_TAB_LOAD_TIMEOUT = 800;

export class StartupTabsStore {
  public db = new Database<IStartupTab>('startupTabs');

  public isLoaded = false;

  public list: IStartupTab[] = [];

  private store: Store;

  private pendingWrites = new Map<number, Promise<void>>();

  private replacingIds = new Map<number, number>();

  private replacementWrites = new Map<number, Promise<void>>();

  private initialTabPromise: Promise<ITab | undefined> | null = null;

  private initialTabReadyPromise: Promise<void> | null = null;

  private suppressedPersistenceIds = new Set<number>();

  public constructor(store: Store) {
    makeObservable(this, {list: observable});

    this.store = store;
  }

  private addTabs(
    options: chrome.tabs.CreateProperties[],
    behavior: AddTabsBehavior = {},
  ): Promise<ITab[]> {
    if (behavior.loadImmediately) {
      return this.store.tabs.addTabs(options, behavior);
    }

    if (document.readyState === 'complete') {
      return this.store.tabs.addTabs(options, behavior);
    }

    return new Promise((resolve, reject) => {
      const onReadyStateChange = () => {
        if (document.readyState !== 'complete') return;
        document.removeEventListener('readystatechange', onReadyStateChange);
        this.store.tabs.addTabs(options, behavior).then(resolve, reject);
      };
      document.addEventListener('readystatechange', onReadyStateChange);
    });
  }

  public loadInitialUrl(): Promise<ITab | undefined> {
    if (!this.store.initialUrl) return Promise.resolve(undefined);
    if (this.initialTabPromise) return this.initialTabPromise;

    const initialTabTimer = rendererStartupTimer();
    rendererStartupMark('renderer.initial_file.load.begin');

    const channel = `view-loaded-${this.store.windowId}`;
    const loadedBeforeTarget = new Set<number>();
    let targetId = -1;
    let timeoutId: number | null = null;
    let settled = false;
    let resolveReady: () => void = () => undefined;

    const cleanup = () => {
      ipcRenderer.removeListener(channel, onLoaded);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
    const finish = (reason: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      rendererStartupMark('renderer.initial_file.view_ready', {
        durationMs: initialTabTimer(),
        reason,
        tabId: targetId,
      });
      resolveReady();
    };
    const onLoaded = (_event: Electron.IpcRendererEvent, viewId: number) => {
      if (targetId === -1) {
        loadedBeforeTarget.add(viewId);
      } else if (viewId === targetId) {
        finish('view-loaded');
      }
    };

    this.initialTabReadyPromise = new Promise((resolve) => {
      resolveReady = resolve;
    });
    ipcRenderer.on(channel, onLoaded);
    timeoutId = window.setTimeout(() => finish('timeout'), INITIAL_TAB_LOAD_TIMEOUT);

    this.initialTabPromise = this.addTabs(
      [{url: this.store.initialUrl, active: true}],
      {loadImmediately: true, persist: false},
    ).then((tabs) => {
      const tab = tabs[0];
      rendererStartupMark('renderer.initial_file.tab_created', {
        durationMs: initialTabTimer(),
        tabId: tab?.id || -1,
      });
      // 主进程已按 active:true 选中对应 BrowserView。同步 renderer 状态，避免
      // 等历史标签持久化完成后地址栏/扩展才能拿到当前标签。
      if (tab) {
        targetId = tab.id;
        this.store.tabs.selectedTabId = tab.id;
        if (loadedBeforeTarget.has(tab.id)) finish('view-loaded-before-tab-created');
      } else {
        finish('no-tab');
      }
      return tab;
    }, (error) => {
      finish('create-error');
      throw error;
    });
    return this.initialTabPromise;
  }

  private async deferSessionRestoreForInitialTab() {
    if (this.initialTabReadyPromise) await this.initialTabReadyPromise;

    await new Promise<void>((resolve) => {
      const requestIdle = (window as any).requestIdleCallback;
      if (typeof requestIdle === 'function') {
        requestIdle(() => resolve(), {timeout: 200});
      } else {
        window.setTimeout(resolve, 50);
      }
    });
  }

  public suppressPersistence(ids: number[]) {
    ids.forEach((id) => this.suppressedPersistenceIds.add(id));
  }

  public resumePersistence(id: number) {
    this.suppressedPersistenceIds.delete(id);
  }

  private async finalizeInitialTab(
    tab: ITab,
    options: {select?: boolean; persist?: boolean} = {},
  ) {
    const {select = true, persist = true} = options;

    try {
      if (select) await tab.select();
    } catch (error) {
      // BrowserView 可能在恢复期间被关闭或迁走。不能因此中断其余标签恢复，
      // 也不能让该 id 永久停留在持久化抑制集合中。
      console.error('[startup-tabs] failed to select initial tab', error);
    } finally {
      this.resumePersistence(tab.id);
    }

    if (
      !persist ||
      tab.isClosing ||
      !this.store.tabs.list.includes(tab)
    ) return;

    try {
      await this.updateStartupTabItem(tab);
    } catch (error) {
      console.error('[startup-tabs] failed to persist initial tab', error);
    }
  }

  private dedupeRestoredTabs(tabs: IStartupTab[]) {
    const map = new Map<string, IStartupTab>();
    const result: IStartupTab[] = [];

    for (const tab of tabs) {
      const hasOrder = typeof tab.order === 'number';
      const key = hasOrder
        ? `${!!tab.pinned}|${tab.order}|${tab.url || ''}`
        : '';

      if (!key || !map.has(key)) {
        if (key) map.set(key, tab);
        result.push(tab);
        continue;
      }

      const existing = map.get(key);
      existing.active = !!existing.active || !!tab.active;
      existing.title = existing.title || tab.title;
      existing.favicon = existing.favicon || tab.favicon;
    }

    return result;
  }

  public async load() {
    if (this.isLoaded) return;

    this.isLoaded = true;
    const restoreTimer = rendererStartupTimer();
    rendererStartupMark('renderer.session_restore.begin', {
      initialUrl: !!this.store.initialUrl,
      incognito: this.store.isIncognito,
    });
    try {
      await this.loadSession();
    } finally {
      rendererStartupMark('renderer.session_restore.end', {
        durationMs: restoreTimer(),
        tabCount: this.store.tabs.list.length,
        selectedTabId: this.store.tabs.selectedTabId,
      });
    }
  }

  private async loadSession() {

    // 沉浸悬浮头部(镜像):标签由主渲染进程经 immersive-header-sync 推来重建,
    // 不再从磁盘 startupTabs 用陈旧 id 自建(那会导致 loading 永不清除、与主窗口失步)。
    if (isImmersiveHeaderWindow()) return;

    let initialTab: ITab | undefined;
    if (this.store.initialUrl) {
      try {
        initialTab = await this.loadInitialUrl();
      } catch (error) {
        // 快速创建失败不能中断正常会话恢复;后续仍恢复历史标签或新标签页。
        console.error('[startup-tabs] failed to load initial URL', error);
      }
    }

    if (this.store.workspaceContext) {
      const groups = new Map(
        this.store.tabGroups.list.map((group) => [group.workspaceKey, group.id]),
      );
      const sourceTabs = [...(this.store.workspaceContext.tabs || [])].sort(
        (left, right) => left.order - right.order,
      );
      await this.addTabs(
        (sourceTabs.length ? sourceTabs : [{ url: getWebUIURL('newtab'), order: 0 } as any]).map(
          (tab, index) => ({
            url: tab.url,
            title: tab.title,
            favicon: tab.favicon,
            pinned: !!tab.pinned,
            active: !initialTab && (sourceTabs.length ? !!tab.active : true),
            order: index,
            workspaceKey: tab.key,
            tabGroupId: tab.groupKey ? groups.get(tab.groupKey) : -1,
          } as any),
        ),
        {preserveActiveTab: !!initialTab},
      );
      if (initialTab) {
        await this.finalizeInitialTab(initialTab);
      }
      return;
    }

    // 由标签撕离生成的窗口不加载启动标签页;它的标签由主进程迁入(tab-adopt)。
    if (this.store.isPendingDetach) {
      return;
    }

    // 外部目标先开始加载,但不替代正常会话恢复。恢复标签在后台创建,
    // 保持外部页面为当前页。
    // 无痕窗口永远从干净的新标签页开始:不恢复上次会话(那会带入普通会话的标签页,
    // 也违背无痕不留痕)。无痕窗口也不向共享 startupTabs 写入(下方各 mutator 已
    // isIncognito 守卫),故不残留、不泄漏到下次普通会话恢复。
    if (this.store.isIncognito) {
      if (initialTab) {
        await this.finalizeInitialTab(initialTab, {
          select: false,
          persist: false,
        });
        return;
      }
      await this.addTabs([{url: getWebUIURL('newtab'), active: true}]);
      return;
    }

    // 应用内“在新窗口打开”只创建目标页。只有冷启动外部文件/URL 才在目标页
    // 已开始加载后继续恢复上次普通会话。
    if (initialTab && !this.store.restoreSessionWithInitialUrl) {
      await this.finalizeInitialTab(initialTab, {select: false});
      return;
    }

    if (initialTab) {
      await this.deferSessionRestoreForInitialTab();
      if (
        initialTab.isClosing ||
        !this.store.tabs.list.includes(initialTab)
      ) {
        initialTab = undefined;
      }
    }

    let tabsToLoad: IStartupTab[] = [];
    let restoreSource = 'none';
    const dataTimer = rendererStartupTimer();
    rendererStartupMark('renderer.session_restore.data_query.begin');
    const args = remote.process.argv;
    const crashRestoreArg = args.find((arg) => arg.startsWith(CRASH_RESTORE_ARG));
    const crashRestoreWindowIds = crashRestoreArg
      ? crashRestoreArg
          .slice(CRASH_RESTORE_ARG.length)
          .split(',')
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
      : [];
    const isCrashRecovery = !!crashRestoreArg;
    if (isCrashRecovery) ipcRenderer.send('crash-recovery-consumed');

    if (isCrashRecovery) {
      restoreSource = 'crash-recovery';
      // 异常重启优先于常规启动偏好。多窗口标签按原窗口顺序合并到重启后的
      // 主窗口,保证页面不丢;后续创建标签时会用新窗口 id 重新持久化。
      const recovered = await Promise.all(
        crashRestoreWindowIds.map((windowId) => this.db.get({windowId})),
      );
      tabsToLoad = recovered
        .reduce((all, tabs) => all.concat(tabs), [] as IStartupTab[])
        .filter((tab) => !tab.isUserDefined)
        .sort((left, right) => {
          const windowDiff =
            crashRestoreWindowIds.indexOf(left.windowId) -
            crashRestoreWindowIds.indexOf(right.windowId);
          return windowDiff || (left.order || 0) - (right.order || 0);
        })
        .map((tab, order) => ({...tab, order}));
    } else if (this.store.settings.object.startupBehavior.type === 'continue') {
      restoreSource = 'continue';
      tabsToLoad = await this.db.get({windowId: this.store.windowId});
    } else if (this.store.windowId === 1) {
      if (this.store.settings.object.startupBehavior.type === 'urls') {
        restoreSource = 'configured-url';
        // 「打开特定页面」:单一网址来自 settings.startupBehavior.url(与新建标签页同一真相源),
        // 合并已固定标签一起恢复;不再从 startupTabs DB 读 isUserDefined 条目。
        const pinnedTabs = await this.db.get({pinned: true});
        const configuredUrl = this.store.settings.object.startupBehavior.url;
        const trimmed = configuredUrl && configuredUrl.trim();
        tabsToLoad = [
          ...pinnedTabs,
          ...(trimmed
            ? [{
                url: prefixHttp(trimmed),
                isUserDefined: true,
                pinned: false,
                order: pinnedTabs.length,
              } as IStartupTab]
            : []),
        ];
        this.list = trimmed ? [{url: trimmed, isUserDefined: true} as IStartupTab] : [];
      } else if (this.store.settings.object.startupBehavior.type === 'empty') {
        restoreSource = 'pinned-only';
        tabsToLoad = await this.db.get({pinned: true});
      }
    }
    rendererStartupMark('renderer.session_restore.data_query.end', {
      count: tabsToLoad.length,
      durationMs: dataTimer(),
      source: restoreSource,
    });

    if (
      !isCrashRecovery &&
      this.store.settings.object.startupBehavior.type !== 'continue'
    ) {
      await this.clearStartupTabs(false, false);
    }

    let needsNewTabPage = false;
    // If we have tabs saved, load them
    if (tabsToLoad && tabsToLoad.length > 0) {
      // 崩溃恢复时同一 URL 可能本来就在多个窗口各开了一份,不能去重。
      if (!isCrashRecovery) tabsToLoad = this.dedupeRestoredTabs(tabsToLoad);
      await this.clearStartupTabs(true, false);

      const sortedTabs = tabsToLoad.sort((x, y) =>
        x.pinned && y.pinned
          ? x.order - y.order
          : x.pinned
            ? -1
            : y.pinned
              ? 1
              : x.order - y.order,
      );
      const savedActiveIndex = sortedTabs.findIndex((tab) => tab.active);
      const activeIndex = savedActiveIndex >= 0
        ? savedActiveIndex
        : sortedTabs.length - 1;

      const placeholderTimer = rendererStartupTimer();
      rendererStartupMark('renderer.session_restore.placeholders.begin', {
        count: sortedTabs.length,
        activeIndex,
      });
      await this.addTabs(
        sortedTabs.map((tab, i) => {
            const active =
              !initialTab &&
              i === activeIndex &&
              !(args.length > 1 && isURL(args[args.length - 1]));
            // 内存节省:恢复时全部建占位标签(含 active)。active 占位标签启动时
            // 由 requestAnimationFrame→select→loadDiscardedTab 自动加载(走新建流程);
            // 其余标签点击时才加载。
            const discarded = this.store.settings.object.memorySaver;
            // 延迟标签不重新加载,标题/图标只能来自上次持久化的值。历史标签的
            // title 可能停留在创建时的'新标签页'(此前 title 变化未回写 DB),
            // favicon 可能为空。这里对 http(s) 标签退回 url 域名 + 在线图标,
            // 避免标签栏一片'新标签页'/无图标;newtab/file 等非 http 标签保留原值。
            let title = tab.title;
            let favicon = tab.favicon;
            const fullUrl = prefixHttp(tab.url || '');
            if (discarded && /^https?:\/\//.test(fullUrl)) {
              if (!title || title === '新标签页') {
                try {
                  title = new URL(fullUrl).hostname;
                } catch {
                  title = tab.title;
                }
              }
              if (!favicon) {
                favicon = getIconByUrlNet(fullUrl);
              }
            }
            return {
              url: prefixHttp(tab.url),
              pinned: tab.pinned,
              active,
              title,
              favicon,
              discarded,
              // 恢复持久化的分组归属(-1 = 未分组),经 createTabs 回填到 ITab.tabGroupId。
              tabGroupId: typeof tab.tabGroupId === 'number' ? tab.tabGroupId : -1,
            };
          }),
        {preserveActiveTab: !!initialTab},
      );
      rendererStartupMark('renderer.session_restore.placeholders.end', {
        count: sortedTabs.length,
        durationMs: placeholderTimer(),
      });

      // If we only load up pinned tabs, add a new tab page
      if (tabsToLoad.filter((x) => !x.pinned).length == 0) {
        needsNewTabPage = true;
      }
    } else {
      // No tabs saved. Just load a new tab page.
      needsNewTabPage = true;
    }

    if (initialTab) needsNewTabPage = false;

    if (needsNewTabPage) {
      await this.addTabs([{
        url: getWebUIURL("newtab"),
        active: true
      }]);
    }

    // 会话数据库清理/恢复结束后再记录提前创建的外部标签。
    if (initialTab) {
      // 恢复期间用户可能已切换标签，或另一个文件启动请求创建了更新的
      // active 标签。只有仍停留在初始文件时才重选它，不能抢回焦点。
      await this.finalizeInitialTab(initialTab, {
        select: this.store.tabs.selectedTabId === initialTab.id,
      });
    }
  }

  public beginReplacingStartupTabId(oldId: number, newId: number) {
    if (!this.store.canPersistNormalSession) return;
    this.replacingIds.set(newId, oldId);
  }

  private async waitPendingWrite(id: number) {
    const pending = this.pendingWrites.get(id);
    if (pending) await pending;
  }

  public async addStartupTabItem(item: IStartupTab) {
    if (!this.store.canPersistNormalSession) return;
    if (this.suppressedPersistenceIds.has(item.id)) return;
    if (!item.url || item.url.startsWith("chrome-ex") || item.url.endsWith(".crx") || item.url.endsWith(".zip")) {
      return;
    }

    if (this.replacingIds.has(item.id)) {
      await this.replaceStartupTabId(this.replacingIds.get(item.id), item.id, item);
      return;
    }

    await this.waitPendingWrite(item.id);

    const itemToReplace = this.list.find((x) => x.id === item.id);
    if (itemToReplace) {
      const write = this.db.update({id: item.id}, item).then(() => undefined);
      this.pendingWrites.set(item.id, write);
      await write.finally(() => this.pendingWrites.delete(item.id));
      this.list[this.list.indexOf(itemToReplace)] = {
        ...itemToReplace,
        ...item,
      };
    } else {
      const write = this.db.insert(item).then((doc) => {
        this.list.push(doc);
      });
      this.pendingWrites.set(item.id, write);
      await write.finally(() => this.pendingWrites.delete(item.id));
    }
  }

  public async setActiveStartupTab(id: number) {
    if (!this.store.canPersistNormalSession) return;
    if (!id) return;
    if (this.suppressedPersistenceIds.has(id)) return;
    await this.waitPendingWrite(id);
    this.list = this.list.map((tab) => ({
      ...tab,
      active: tab.id === id,
    }));
    await this.db.update(
      {windowId: this.store.windowId} as any,
      {active: false} as any,
      true,
    );
    await this.db.update({id} as any, {active: true} as any);
  }

  public removeStartupTabItem(tabId: number) {
    const wasSuppressed = this.suppressedPersistenceIds.delete(tabId);
    if (!this.store.canPersistNormalSession) return;
    if (wasSuppressed) return;
    const itemToDelete = this.list.find((x) => x.id === tabId);
    if (itemToDelete) {
      this.list = this.list.filter((x) => x.id !== tabId);
      this.db.remove({id: tabId});
    }
  }

  public updateStartupTabItem(tab: ITab): Promise<void> {
    if (!this.store.canPersistNormalSession) return Promise.resolve();
    if (!tab.url || tab.url.startsWith("chrome-ex") || tab.url.endsWith(".crx") || tab.url.endsWith(".zip")) {
      return Promise.resolve();
    }
    return this.addStartupTabItem({
      id: tab.id,
      windowId: this.store.windowId,
      url: tab.url,
      pinned: tab.isPinned,
      title: tab.title,
      favicon: tab.favicon,
      tabGroupId: tab.tabGroupId,
      isUserDefined: false,
      order: this.store.tabs.list.indexOf(tab),
      active: tab.isSelected,
    });
  }

  // 延迟标签 materialize 后,把持久化的占位 id 改写为真实 webContents.id,
  // 保持 startupTabs DB 与当前 ITab.id 一致(否则后续 update/remove 查找错位)。
  public async replaceStartupTabId(
    oldId: number,
    newId: number,
    patch: Partial<IStartupTab> = {},
  ) {
    if (!this.store.canPersistNormalSession) return;
    const previousReplacement = this.replacementWrites.get(newId);
    if (previousReplacement) await previousReplacement;

    const replacement = this.replaceStartupTabIdNow(oldId, newId, patch);
    this.replacementWrites.set(newId, replacement);
    await replacement.finally(() => this.replacementWrites.delete(newId));
  }

  private async replaceStartupTabIdNow(
    oldId: number,
    newId: number,
    patch: Partial<IStartupTab>,
  ) {
    await this.waitPendingWrite(oldId);

    let item = this.list.find((x) => x.id === oldId);
    if (!item) item = this.list.find((x) => x.id === newId);
    if (!item) {
      item = (await this.db.get({id: oldId} as any))[0];
      if (item) this.list.push(item);
    }

    if (!item) {
      this.replacingIds.delete(newId);
      const tab = this.store.tabs.getTabById(newId);
      if (tab) await this.updateStartupTabItem(tab);
      return;
    }

    const nextItem = {
      ...item,
      ...patch,
      id: newId,
    } as IStartupTab;

    // 更新值显式剔除 _id:nedb 主键不可变,$set 带 _id 在匹配到不同 _id 的文档
    // 时会抛 "You can't change a document's _id"。本字段只改 id(占位→真实),
    // 其余字段随 patch 覆盖,_id 留给 nedb 按 matched 文档保留。
    const {_id, ...updateValue} = nextItem;
    const write = this.db.update({id: oldId}, updateValue as any).then(() => undefined);
    this.pendingWrites.set(newId, write);
    await write.finally(() => this.pendingWrites.delete(newId));

    const index = this.list.indexOf(item);
    if (index >= 0) {
      this.list[index] = nextItem;
    } else if (!this.list.find((x) => x.id === newId)) {
      this.list.push(nextItem);
    }
    this.replacingIds.delete(newId);
  }

  public async clearStartupTabs(
    removePinned: boolean,
    removeUserDefined: boolean,
  ) {
    if (!this.store.canPersistNormalSession) return;
    if (removePinned && removeUserDefined) {
      await this.db.remove({}, true);
      this.list = [];
    } else if (!removePinned) {
      await this.db.remove({pinned: false}, true);
      this.list = this.list.filter((x) => x.pinned);
    } else if (!removeUserDefined) {
      await this.db.remove({isUserDefined: false}, true);
      this.list = this.list.filter((x) => x.isUserDefined);
    } else {
      await this.db.remove({isUserDefined: false, pinned: false}, true);
      this.list = this.list.filter((x) => x.isUserDefined || x.pinned);
    }
  }
}
