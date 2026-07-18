import {makeObservable, observable} from 'mobx';

import {Store} from '.';
import * as remote from '@electron/remote';
import {prefixHttp, isURL} from '~/utils';
import {getIconByUrlNet} from '~/utils/url';
import {Database} from '~/models/database';
import {IStartupTab} from '~/interfaces/startup-tab';
import {extname} from 'path';
import {existsSync} from 'fs';
import {ITab} from '../models';
import {getWebUIURL} from "~/common/webui";
import {buildKoodoReaderUrl} from '~/constants/files';
import {isImmersiveHeaderWindow} from '../utils/windows';

export class StartupTabsStore {
  public db = new Database<IStartupTab>('startupTabs');

  public isLoaded = false;

  public list: IStartupTab[] = [];

  private store: Store;

  private pendingWrites = new Map<number, Promise<void>>();

  private replacingIds = new Map<number, number>();

  private replacementWrites = new Map<number, Promise<void>>();

  public constructor(store: Store) {
    makeObservable(this, {list: observable});

    this.store = store;
  }

  private addTabs(options: chrome.tabs.CreateProperties[]) {
    console.log("addTabs", document.readyState);

    function ready(fn: any) {
      if (document.readyState == 'complete') {
        fn();
      } else {
        document.addEventListener('readystatechange', () => {
          if (document.readyState == 'complete') {
            fn();
          }
        });
        // document.addEventListener('DOMContentLoaded', fn);
      }
    }

    ready(() => {
      this.store.tabs.addTabs(options);
    });
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

    // 沉浸悬浮头部(镜像):标签由主渲染进程经 immersive-header-sync 推来重建,
    // 不再从磁盘 startupTabs 用陈旧 id 自建(那会导致 loading 永不清除、与主窗口失步)。
    if (isImmersiveHeaderWindow()) return;

    // 由标签撕离生成的窗口不加载启动标签页;它的标签由主进程迁入(tab-adopt)。
    if (this.store.isPendingDetach) {
      return;
    }

    let tabsToLoad: IStartupTab[] = [];

    if (this.store.settings.object.startupBehavior.type === 'continue') {
      tabsToLoad = await this.db.get({windowId: this.store.windowId});
    } else if (this.store.windowId === 1) {
      if (this.store.settings.object.startupBehavior.type === 'urls') {
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
        tabsToLoad = await this.db.get({pinned: true});
      }
    }

    if (this.store.settings.object.startupBehavior.type !== 'continue') {
      this.clearStartupTabs(false, false);
    }

    const args = remote.process.argv;
    let needsNewTabPage = false;
    // If we have tabs saved, load them
    if (tabsToLoad && tabsToLoad.length > 0) {
      tabsToLoad = this.dedupeRestoredTabs(tabsToLoad);
      this.clearStartupTabs(true, false);

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

      this.addTabs(
        sortedTabs.map((tab, i) => {
            const active =
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
      );

      // If we only load up pinned tabs, add a new tab page
      if (tabsToLoad.filter((x) => !x.pinned).length == 0) {
        needsNewTabPage = true;
      }
    } else {
      // No tabs saved. Just load a new tab page.
      needsNewTabPage = true;
    }

    // load up command line args. If there are any, we don't need a new tab page.

    if (args.length > 1 && this.store.windowId === 1) {
      const path = remote.process.argv[1];
      const ext = extname(path).toLowerCase();

      if (existsSync(path) && (ext === '.html' || ext === '.htm')) {
        this.addTabs([
          {url: `file:///${path.replace(/\\/g, '/')}`, active: true},
        ]);
        needsNewTabPage = false;
      } else if (existsSync(path)) {
        // koodoreader 支持的电子书格式 → 阅读器直开
        const koodoUrl = buildKoodoReaderUrl(path);
        if (koodoUrl) {
          this.addTabs([{url: koodoUrl, active: true}]);
          needsNewTabPage = false;
        }
      } else if (isURL(path)) {
        this.addTabs([
          {
            url: prefixHttp(path),
            active: true,
          },
        ]);
        needsNewTabPage = false;
      }
    }

    if (needsNewTabPage) {
      this.addTabs([{
        url: getWebUIURL("newtab"),
        active: true
      }]);
    }
  }

  public beginReplacingStartupTabId(oldId: number, newId: number) {
    this.replacingIds.set(newId, oldId);
  }

  private async waitPendingWrite(id: number) {
    const pending = this.pendingWrites.get(id);
    if (pending) await pending;
  }

  public async addStartupTabItem(item: IStartupTab) {
    if (isImmersiveHeaderWindow()) return;
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
    if (isImmersiveHeaderWindow()) return;
    if (!id) return;
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
    if (isImmersiveHeaderWindow()) return;
    const itemToDelete = this.list.find((x) => x.id === tabId);
    if (itemToDelete) {
      this.list = this.list.filter((x) => x.id !== tabId);
      this.db.remove({id: tabId});
    }
  }

  public async updateStartupTabItem(tab: ITab) {
    if (isImmersiveHeaderWindow()) return;
    if (!tab.url || tab.url.startsWith("chrome-ex") || tab.url.endsWith(".crx") || tab.url.endsWith(".zip")) {
      return;
    }
    this.addStartupTabItem({
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
    if (isImmersiveHeaderWindow()) return;
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

    const write = this.db.update({id: oldId}, nextItem as any).then(() => undefined);
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

  public clearStartupTabs(removePinned: boolean, removeUserDefined: boolean) {
    if (isImmersiveHeaderWindow()) return;
    if (removePinned && removeUserDefined) {
      this.db.remove({}, true);
      this.list = [];
    } else if (!removePinned) {
      this.db.remove({pinned: false}, true);
      this.list = this.list.filter((x) => x.pinned);
    } else if (!removeUserDefined) {
      this.db.remove({isUserDefined: false}, true);
      this.list = this.list.filter((x) => x.isUserDefined);
    } else {
      this.db.remove({isUserDefined: false, pinned: false}, true);
      this.list = this.list.filter((x) => x.isUserDefined || x.pinned);
    }
  }
}
