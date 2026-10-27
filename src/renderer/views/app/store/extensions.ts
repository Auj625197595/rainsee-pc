/* eslint @typescript-eslint/camelcase: 0 */

import {action, computed, makeObservable, observable} from 'mobx';
import {join} from 'path';

import {IBrowserAction} from '../models';
import {promises} from 'fs';
import {ipcRenderer} from 'electron';
import store from '.';
import {extensionMainChannel} from '~/common/rpc/extensions';
import {
  moveInExtensionOrder,
  sortByExtensionOrder,
} from '~/common/extension-order';

const logExtensionActions = (...args: any[]) => {
  if (process.env.DEBUG_IMMERSIVE_HEADER === '1') {
    console.log('[immersive-extensions]', ...args);
  }
};

export class ExtensionsStore {
  public browserActions: IBrowserAction[] = [];

  public defaultBrowserActions: IBrowserAction[] = [];

  public currentlyToggledPopup = '';

  public constructor() {
    makeObservable(this, {
      browserActions: observable,
      defaultBrowserActions: observable,
      currentlyToggledPopup: observable,
      pinnedExtensions: computed,
      visibleExtensionIds: computed,
      uninstallExtension: action,
      togglePin: action,
      moveExtension: action,
    });

    this.load();

    ipcRenderer.on('load-browserAction', async (e, extension) => {
      await this.loadExtension(extension);
    });

    // 管理页停用/卸载扩展后,主进程广播 remove-browserAction,
    // 同步移除工具栏图标。
    ipcRenderer.on('remove-browserAction', (e, id: string) => {
      this.removeActions(id);
    });
  }

  public addBrowserActionToTab(tabId: number, browserAction: IBrowserAction) {
    const matches = this.browserActions.filter(
      (item) => item.tabId === tabId && item.extensionId === browserAction.extensionId,
    );
    if (matches.length > 0) {
      logExtensionActions('duplicate action add', {
        tabId,
        extensionId: browserAction.extensionId,
        duplicateCount: matches.length,
        total: this.browserActions.length,
      });

      // Per-tab actions are keyed by extension + tab. Reuse the existing
      // observable entry and remove stale duplicates instead of appending a
      // second toolbar item on every tab/view reconciliation.
      const existing = matches[0];
      existing.icon = browserAction.icon;
      existing.title = browserAction.title;
      existing.popup = browserAction.popup;
      existing.badgeBackgroundColor = browserAction.badgeBackgroundColor;
      existing.badgeTextColor = browserAction.badgeTextColor;
      existing.badgeText = browserAction.badgeText;
      existing.wasOpened = browserAction.wasOpened;
      for (let i = this.browserActions.length - 1; i >= 0; i--) {
        const item = this.browserActions[i];
        if (
          item !== existing &&
          item.tabId === tabId &&
          item.extensionId === browserAction.extensionId
        ) {
          this.browserActions.splice(i, 1);
        }
      }
      return;
    }

    // Build the per-tab entry via the real constructor so makeObservable() runs
    // on it. A shallow Object.create/Object.assign clone copies the field values
    // but never invokes the constructor, leaving `icon`/`title`/`badgeText`
    // NON-observable — so later chrome.action.setIcon mutations on the per-tab
    // entry don't trigger a re-render of the observer toolbar (icon looks frozen
    // even though the model updates and the tab matches).
    const tabBrowserAction = new IBrowserAction({
      icon: browserAction.icon,
      title: browserAction.title,
      extensionId: browserAction.extensionId,
      popup: browserAction.popup,
    });
    tabBrowserAction.badgeBackgroundColor = browserAction.badgeBackgroundColor;
    tabBrowserAction.badgeTextColor = browserAction.badgeTextColor;
    tabBrowserAction.badgeText = browserAction.badgeText;
    tabBrowserAction.wasOpened = browserAction.wasOpened;
    tabBrowserAction.tabId = tabId;
    this.browserActions.push(tabBrowserAction);
    logExtensionActions('action add', {
      tabId,
      extensionId: browserAction.extensionId,
      total: this.browserActions.length,
    });
  }

  private findDefaultIcon(extension: Electron.Extension): string {
    const {icons} = extension.manifest;
    if (icons) {
      const size = ["128", "96", "64", "48", "32", "16"];
      for (let s of size) {
        if (icons[s]) {
          return icons[s];
        }
      }
    }
    return null;
  }

  public async loadExtension(extension: Electron.Extension) {
    console.log(extension);
    if (this.defaultBrowserActions.find((x) => x.extensionId === extension.id))
      return;

    if (extension.manifest.browser_action) {
      const {default_icon, default_title} = extension.manifest.browser_action;

      let icon1 = default_icon;

      if (typeof icon1 === 'object') {
        icon1 = Object.values(default_icon)[
        Object.keys(default_icon).length - 1
          ];
      }
      if(!icon1) {
        icon1 = this.findDefaultIcon(extension);
      }

      const data = await promises.readFile(
        join(extension.path, icon1 as string),
      );

      if (
        this.defaultBrowserActions.find((x) => x.extensionId === extension.id)
      )
        return;

      const icon = window.URL.createObjectURL(new Blob([data]));
      // default_title 可能是 __MSG_xxx__;交主进程按扩展 _locales 的 UI 语言解析
      // (renderer 无磁盘访问)。fallback 用 extension.name(Electron loadExtension 时
      // 已本地化),而非 manifest.name 原文。
      const resolvedTitle = default_title
        ? ipcRenderer.sendSync('crx-resolve-msg', extension.id, default_title)
        : '';
      const browserAction = new IBrowserAction({
        extensionId: extension.id,
        icon,
        title: resolvedTitle || extension.name,
        popup: extension.manifest?.browser_action?.default_popup,
      });

      this.defaultBrowserActions.push(browserAction);

      for (const tab of store.tabs.list) {
        this.addBrowserActionToTab(tab.id, browserAction);
      }
    } else if (extension.manifest.action) {
      const {default_icon, default_title} = extension.manifest.action;
      let icon1 = default_icon;
      if (typeof icon1 === 'object') {
        icon1 = Object.values(default_icon)[
        Object.keys(default_icon).length - 1
          ];
      }
      if(!icon1) {
        icon1 = this.findDefaultIcon(extension);
      }

      const data = await promises.readFile(
        join(extension.path, icon1 as string),
      );

      if (
        this.defaultBrowserActions.find((x) => x.extensionId === extension.id)
      )
        return;

      const icon = window.URL.createObjectURL(new Blob([data]));
      const resolvedTitle = default_title
        ? ipcRenderer.sendSync('crx-resolve-msg', extension.id, default_title)
        : '';
      const browserAction = new IBrowserAction({
        extensionId: extension.id,
        icon,
        title: resolvedTitle || extension.name,
        popup: extension.manifest?.action?.default_popup,
      });

      this.defaultBrowserActions.push(browserAction);

      for (const tab of store.tabs.list) {
        this.addBrowserActionToTab(tab.id, browserAction);
      }
    }
  }

  public async load() {
    if (!process.env.ENABLE_EXTENSIONS) return;

    const extensions: Electron.Extension[] = await ipcRenderer.invoke(
      'get-extensions',
    );

    await Promise.all(extensions.map((x) => this.loadExtension(x)));
  }

  private removeActions(id: string) {
    this.browserActions = this.browserActions.filter(
      (x) => x.extensionId !== id,
    );
    this.defaultBrowserActions = this.defaultBrowserActions.filter(
      (x) => x.extensionId !== id,
    );
  }

  // 已钉住(固定到地址栏左侧)的扩展 id 列表。
  public get pinnedExtensions(): string[] {
    return store.settings.object.pinnedExtensions || [];
  }

  // 地址栏实际显示的扩展 id 由「固定到地址栏」和当前窗口的扩展权限共同决定。
  // 主进程正常只会把无痕实例中的扩展下发给无痕窗口；这里仍做一次权限兜底，
  // 避免扩展更新等异步广播把普通实例的 browser action 暂时带进无痕工具栏。
  public get visibleExtensionIds(): string[] {
    const incognitoAllowed = new Set(
      store.settings.object.incognitoAllowedExtensions || [],
    );

    const ids = this.pinnedExtensions.filter(
      (id) =>
        this.defaultBrowserActions.some((x) => x.extensionId === id) &&
        (!store.isIncognito || incognitoAllowed.has(id)),
    );
    // 与「全部扩展」列表共用 extensionOrder;未入序的按钉住先后排在末尾。
    return sortByExtensionOrder(
      ids,
      store.settings.object.extensionOrder,
      (id) => id,
    );
  }

  // 地址栏图标拖动排序:改写完整顺序,全部扩展列表随之变化。
  public moveExtension(fromId: string, toId: string, after: boolean) {
    const object = store.settings.object;
    const next = moveInExtensionOrder(
      object.extensionOrder,
      this.visibleExtensionIds,
      fromId,
      toId,
      after,
    );
    store.settings.object = { ...object, extensionOrder: next };
    store.settings.save();
  }

  public isPinned(id: string): boolean {
    return this.pinnedExtensions.includes(id);
  }

  public togglePin(id: string) {
    const pinned = this.pinnedExtensions;
    const next = pinned.includes(id)
      ? pinned.filter((x) => x !== id)
      : [...pinned, id];

    store.settings.object = {
      ...store.settings.object,
      pinnedExtensions: next,
    };
    store.settings.save();
  }

  async uninstallExtension(id: string) {
    try {
      const removed = await extensionMainChannel.getInvoker().uninstall(id);
      if (removed) this.removeActions(id);
    } catch (_) {}
  }
}
