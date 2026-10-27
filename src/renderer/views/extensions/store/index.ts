import { observable, computed, action, makeObservable } from 'mobx';

import {
  ISettings,
  ITheme,
  IExtItem,
  ExtensionNotificationMode,
  IExtensionGroup,
  IExtInspectView,
  IBrowserExtensionImportItem,
  IBrowserExtensionImportResult,
  IBrowserExtensionImportSource,
  IBrowserExtensionImportScan,
} from '~/interfaces';
import { getTheme } from '~/utils/themes';
import { RUFFLE_EXTENSION_ID } from '~/constants';
import { ipcRenderer } from '~/common/renderer-ipc';
import { createLocaleTranslator } from '~/common/i18n';
import {getWebUIContext} from '~/common/webui-context';

const webUIContext = getWebUIContext();

// 开发者模式是纯 UI 偏好(显示扩展 ID / 调试按钮),用 localStorage 持久化即可,
// 无需走主进程设置(区别于 autoUpdate,后者主进程需据此决定是否自动更新)。
const DEV_MODE_KEY = 'extensions-dev-mode';
const readDevMode = () => {
  try {
    return localStorage.getItem(DEV_MODE_KEY) === '1';
  } catch {
    return false;
  }
};
const writeDevMode = (v: boolean) => {
  try {
    localStorage.setItem(DEV_MODE_KEY, v ? '1' : '0');
  } catch {
    // 忽略写入失败(隐私模式 / 配额等)
  }
};

export type ExtFilter = 'all' | 'enabled' | 'disabled';

// 拓展商店项(来自 https://admin.yujianpay.com/api/crx/getAll)。
export interface IStoreExt {
  id: number;
  name: string;
  intro: string;
  icon_image: string;
  crxkey: string;
  weight: number;
  white: boolean;
  images: string[];
  installed?: boolean;
}

export class Store {
  @observable
  public settings: ISettings = { ...(webUIContext.settings as Partial<ISettings>) } as ISettings;

  @observable
  public extensions: IExtItem[] = [];

  @observable
  public selectedFilter: ExtFilter = 'all';

  @observable
  public searched = '';

  @observable
  public devMode = readDevMode();

  // 当前展开详情的扩展 id(null 为不展开)。
  @observable
  public selectedId: string | null = null;

  @observable
  public inspectViews: IExtInspectView[] = [];

  private inspectViewsToken = 0;

  @observable
  public inspectStatus: string | null = null;

  @observable
  public inspectStatusError = false;

  @observable
  public inspectingTargetId: string | null = null;

  private inspectStatusToken = 0;

  // 拓展商店列表与状态。
  @observable
  public storeList: IStoreExt[] = [];

  @observable
  public storeLoading = false;

  // 正在安装的 crxkey 集合。
  @observable
  public installing: string[] = [];

  // 「检查更新」进行中标记。
  @observable
  public checking = false;

  // 单个扩展的检查状态，允许列表中的多个扩展独立反馈进度。
  @observable
  public extensionCheckingIds: string[] = [];

  @observable
  public extensionUpdateStatuses: Record<string, string> = {};

  // 更新结果提示文案(null 为不显示)。
  @observable
  public updateStatus: string | null = null;

  // 扩展自动更新开关(与主进程设置同步,默认开启)。
  @observable
  public autoUpdate = true;

  @observable
  public migrationOpen = false;

  @observable
  public migrationLoading = false;

  @observable
  public migrationImporting = false;

  @observable
  public migrationItems: IBrowserExtensionImportItem[] = [];

  @observable
  public migrationSelectedKeys: string[] = [];

  @observable
  public migrationSources: IBrowserExtensionImportSource[] = [];

  @observable
  public migrationDuplicateCount = 0;

  @observable
  public migrationError: string | null = null;

  // 提示自动清除的令牌,避免旧定时器清掉新提示。
  private statusToken = 0;

  @computed
  public get theme(): ITheme {
    return getTheme(this.settings.theme);
  }

  @computed
  public get list(): IExtItem[] {
    const q = this.searched;
    const filtered = this.extensions.filter((x) => {
      if (this.selectedFilter === 'enabled' && !x.enabled) return false;
      if (this.selectedFilter === 'disabled' && x.enabled) return false;
      if (q && !`${x.name} ${x.description}`.toLowerCase().includes(q))
        return false;
      return true;
    });
    const byId = new Map(filtered.map((item) => [item.id, item]));
    const ordered: IExtItem[] = [];
    this.groups.forEach((group) => {
      (Array.isArray(group.extensionIds) ? group.extensionIds : []).forEach((id) => {
        const item = byId.get(id);
        if (item) {
          ordered.push(item);
          byId.delete(id);
        }
      });
    });
    return [...ordered, ...byId.values()];
  }

  @computed
  public get groups(): IExtensionGroup[] {
    return Array.isArray(this.settings.extensionGroups)
      ? this.settings.extensionGroups
      : [];
  }

  public itemsForGroup(groupId: string | null): IExtItem[] {
    const ids = groupId
      ? this.groups.find((group) => group.id === groupId)?.extensionIds || []
      : this.groups.reduce(
          (all, group) =>
            all.concat(Array.isArray(group.extensionIds) ? group.extensionIds : []),
          [] as string[],
        );
    const grouped = new Set(ids);
    return this.list.filter((item) => (groupId ? grouped.has(item.id) : !grouped.has(item.id)));
  }

  @computed
  public get selected(): IExtItem | null {
    return this.extensions.find((x) => x.id === this.selectedId) || null;
  }

  public countForFilter(filter: ExtFilter): number {
    if (filter === 'all') return this.extensions.length;
    if (filter === 'enabled')
      return this.extensions.filter((x) => x.enabled).length;
    return this.extensions.filter((x) => !x.enabled).length;
  }

  public constructor() {
    makeObservable(this);

    ipcRenderer.on('update-settings', (_event, settings: ISettings) => {
      this.settings = { ...this.settings, ...settings };
    });

    this.load();
    this.loadStore();
    this.loadAutoUpdate();
  }

  @action
  public async load() {
    const list: IExtItem[] = await ipcRenderer.invoke(
      'extensions-get-detailed',
    );
    if (!list) return;
    this.extensions = list;
    this.normalizeGroups(list);
    // 若详情面板指向的扩展已被卸载,关闭面板。
    if (this.selectedId && !list.find((x) => x.id === this.selectedId)) {
      this.selectedId = null;
    }
  }

  @action
  public search(str: string) {
    this.searched = str.toLowerCase();
  }

  @action
  public setFilter(filter: ExtFilter) {
    this.selectedFilter = filter;
  }

  @action
  public toggleDevMode() {
    this.devMode = !this.devMode;
    writeDevMode(this.devMode);
  }

  @action
  public select(id: string | null) {
    this.selectedId = this.selectedId === id ? null : id;
    this.inspectViews = [];
    this.inspectStatus = null;
    this.inspectingTargetId = null;
    if (this.selectedId) void this.loadInspectViews(this.selectedId);
  }

  public async setEnabled(item: IExtItem, enabled: boolean) {
    await ipcRenderer.invoke('extension-set-enabled', item.id, enabled);
    await this.load();
  }

  private persistGroups(groups: IExtensionGroup[]) {
    const extensionGroups = groups.map((group) => ({
      ...group,
      extensionIds: [...new Set(group.extensionIds)],
    }));
    this.settings = { ...this.settings, extensionGroups };
    void ipcRenderer.invoke('extensions-set-groups', extensionGroups).catch(() => undefined);
  }

  private normalizeGroups(list: IExtItem[]) {
    const validIds = new Set(list.map((item) => item.id));
    const seen = new Set<string>();
    const next = this.groups
      .filter((group) => group && typeof group.id === 'string' && typeof group.name === 'string')
      .map((group) => ({
        id: group.id,
        name:
          group.name.trim().slice(0, 40) ||
          createLocaleTranslator(this.settings.language)('extUnnamedGroup'),
        extensionIds: (Array.isArray(group.extensionIds) ? group.extensionIds : []).filter(
          (id) => validIds.has(id) && !seen.has(id) && seen.add(id),
        ),
      }));
    const current = JSON.stringify(this.groups);
    if (JSON.stringify(next) !== current) this.persistGroups(next);
  }

  @action
  public createGroup(name: string) {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return;
    this.persistGroups([
      ...this.groups,
      { id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: trimmed, extensionIds: [] },
    ]);
  }

  @action
  public renameGroup(groupId: string, name: string) {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return;
    this.persistGroups(this.groups.map((group) => (group.id === groupId ? { ...group, name: trimmed } : group)));
  }

  @action
  public removeGroup(groupId: string) {
    this.persistGroups(this.groups.filter((group) => group.id !== groupId));
  }

  @action
  public moveExtension(id: string, groupId: string | null, beforeId?: string) {
    const next = this.groups.map((group) => ({
      ...group,
      extensionIds: group.extensionIds.filter((extensionId) => extensionId !== id),
    }));
    if (groupId) {
      const target = next.find((group) => group.id === groupId);
      if (target) {
        const index = beforeId ? target.extensionIds.indexOf(beforeId) : -1;
        if (index >= 0) target.extensionIds.splice(index, 0, id);
        else target.extensionIds.push(id);
      }
    }
    this.persistGroups(next);
  }

  public groupEnabled(groupId: string): boolean {
    const ids = new Set(
      this.groups.find((group) => group.id === groupId)?.extensionIds || [],
    );
    const items = this.extensions.filter((item) => ids.has(item.id));
    return items.length > 0 && items.every((item) => item.enabled);
  }

  public async setGroupEnabled(groupId: string, enabled: boolean) {
    const group = this.groups.find((item) => item.id === groupId);
    if (!group) return;
    const items = (Array.isArray(group.extensionIds) ? group.extensionIds : [])
      .map((id) => this.extensions.find((item) => item.id === id))
      .filter((item): item is IExtItem => !!item && item.enabled !== enabled);
    await Promise.all(items.map((item) => ipcRenderer.invoke('extension-set-enabled', item.id, enabled)));
    await this.load();
  }

  public async setIncognitoAllowed(item: IExtItem, allowed: boolean) {
    await ipcRenderer.invoke(
      'extension-set-incognito-allowed',
      item.id,
      allowed,
    );
    await this.load();
  }

  public async setNotificationMode(item: IExtItem, mode: ExtensionNotificationMode) {
    await ipcRenderer.invoke('extension-set-notification-mode', item.id, mode);
    await this.load();
  }

  public async reload(item: IExtItem) {
    await ipcRenderer.invoke('extension-reload', item.id);
    await this.load();
  }

  @action
  public async loadInspectViews(id: string) {
    const token = ++this.inspectViewsToken;
    try {
      const views: IExtInspectView[] = await ipcRenderer.invoke(
        'extension-get-inspect-views',
        id,
      );
      if (token === this.inspectViewsToken && this.selectedId === id) {
        this.inspectViews = views || [];
      }
    } catch {
      if (token === this.inspectViewsToken && this.selectedId === id) {
        this.inspectViews = [];
      }
    }
  }

  public async inspect(item: IExtItem, target?: IExtInspectView) {
    let selectedTarget = target;
    if (!selectedTarget) {
      const views: IExtInspectView[] = await ipcRenderer.invoke(
        'extension-get-inspect-views',
        item.id,
      );
      selectedTarget =
        (views || []).find((view) => view.type === 'service-worker') ||
        (views || [])[0];
    }
    if (!selectedTarget) {
      this.inspectStatusError = true;
      this.inspectStatus = createLocaleTranslator(
        this.settings.language,
      )('extInspectNoViews');
      return;
    }

    const token = ++this.inspectStatusToken;
    this.inspectingTargetId = selectedTarget.id;
    this.inspectStatusError = false;
    this.inspectStatus =
      selectedTarget.type === 'service-worker'
        ? createLocaleTranslator(this.settings.language)(
            'extInspectStartingSw',
          )
        : createLocaleTranslator(this.settings.language)('extInspectOpening', {
            target: selectedTarget.label,
          });
    try {
      const result: { ok?: boolean; message?: string } | boolean =
        await ipcRenderer.invoke(
          'extension-inspect-target',
          item.id,
          selectedTarget.id,
        );
      if (token !== this.inspectStatusToken) return;
      const opened =
        result === true || (typeof result === 'object' && result?.ok);
      if (!opened) {
        this.inspectStatusError = true;
        this.inspectStatus =
          (typeof result === 'object' && result?.message) ||
          createLocaleTranslator(this.settings.language)('extInspectOpenFailed', {
          target: selectedTarget.label,
        });
        return;
      }
      this.inspectStatus = createLocaleTranslator(
        this.settings.language,
      )('extInspectOpened', { target: selectedTarget.label });
      setTimeout(() => {
        if (token === this.inspectStatusToken) this.inspectStatus = null;
      }, 3000);
    } catch {
      if (token !== this.inspectStatusToken) return;
      this.inspectStatusError = true;
      this.inspectStatus = createLocaleTranslator(this.settings.language)('extInspectOpenFailed', {
          target: selectedTarget.label,
        });
    } finally {
      if (token === this.inspectStatusToken) this.inspectingTargetId = null;
    }
  }

  // 打开该扩展的选项页(options_page / options_ui)于新标签页。
  // 本页为沙箱内部页(sandbox:true),无法直接 ipcRenderer;window.open 经
  // view 的 setWindowOpenHandler 路由为新建 BrowserView 标签页(与书签页
  // 打开链接一致)。optionsUrl 为主进程组装好的 chrome-extension:// 完整 URL。
  public openOptions(item: IExtItem) {
    if (!item.optionsUrl) return;
    window.open(item.optionsUrl, '_blank');
  }

  @action
  public async uninstall(item: IExtItem) {
    if (
      item.id !== RUFFLE_EXTENSION_ID &&
      !confirm(
      createLocaleTranslator(this.settings.language)('extUninstallConfirm', {
        name: item.name,
      }),
    )
    ) {
      return;
    }
    let removed = false;
    try {
      removed = await ipcRenderer.invoke('extension-uninstall', item.id);
    } catch (_) {
      removed = false;
    }
    if (!removed) return;
    this.extensions = this.extensions.filter((x) => x.id !== item.id);
    if (this.selectedId === item.id) this.selectedId = null;
    // 主进程删除目录需要一点时间,稍后刷新一次以保证一致。
    setTimeout(() => this.load(), 600);
  }

  public async installFromCrx() {
    const res = await ipcRenderer.invoke('load-extension-from-crx');
    if (res && res.name) {
      await this.load();
      await this.loadStore();
      this.setStatus(
        createLocaleTranslator(this.settings.language)('extInstalledStatus', {
          name: res.name,
        }),
      );
    }
  }

  public async installFromDir() {
    const res = await ipcRenderer.invoke('load-extension-from-dir');
    if (res && res.name) {
      await this.load();
      await this.loadStore();
      this.setStatus(
        createLocaleTranslator(this.settings.language)('extLoadedStatus', {
          name: res.name,
        }),
      );
    }
  }

  @action
  public async openBrowserMigration() {
    this.migrationOpen = true;
    this.migrationError = null;
    await this.scanBrowserImports(false);
  }

  @action
  public closeBrowserMigration() {
    if (this.migrationImporting) return;
    this.migrationOpen = false;
  }

  @action
  public async scanBrowserImports(selectDirectory: boolean) {
    if (this.migrationLoading || this.migrationImporting) return;
    this.migrationLoading = true;
    this.migrationError = null;
    try {
      const result: IBrowserExtensionImportScan = await ipcRenderer.invoke(
        'extensions-scan-browser-import',
        selectDirectory,
      );
      if (result?.canceled) {
        if (this.migrationItems.length === 0) {
          this.migrationError = createLocaleTranslator(
        this.settings.language,
      )('extMigrationNoDir');
        }
        return;
      }
      if (!selectDirectory && result && !result.detected) {
        this.migrationLoading = false;
        await this.scanBrowserImports(true);
        return;
      }
      this.migrationItems = result?.items || [];
      this.migrationSelectedKeys = this.migrationItems.map((item) => item.key);
      this.migrationSources = result?.sources || [];
      this.migrationDuplicateCount = result?.duplicateCount || 0;
      if (this.migrationItems.length === 0) {
        this.migrationError = this.migrationDuplicateCount
          ? createLocaleTranslator(this.settings.language)(
              'extMigrationAllInstalled',
            )
          : createLocaleTranslator(this.settings.language)(
              'extMigrationNoneFound',
            );
      }
    } catch {
      this.migrationError = createLocaleTranslator(
        this.settings.language,
      )('extMigrationReadFailed');
    } finally {
      this.migrationLoading = false;
    }
  }

  @action
  public toggleBrowserMigrationItem(key: string) {
    this.migrationSelectedKeys = this.migrationSelectedKeys.includes(key)
      ? this.migrationSelectedKeys.filter((item) => item !== key)
      : [...this.migrationSelectedKeys, key];
  }

  @action
  public toggleAllBrowserMigrationItems() {
    this.migrationSelectedKeys =
      this.migrationSelectedKeys.length === this.migrationItems.length
        ? []
        : this.migrationItems.map((item) => item.key);
  }

  @action
  public async importSelectedBrowserExtensions() {
    if (this.migrationImporting || this.migrationSelectedKeys.length === 0)
      return;
    this.migrationImporting = true;
    this.migrationError = null;
    const requested = this.migrationSelectedKeys.length;
    try {
      const result: IBrowserExtensionImportResult = await ipcRenderer.invoke(
        'extensions-import-from-browser',
        [...this.migrationSelectedKeys],
      );
      const imported = result?.imported?.length || 0;
      const failed = result?.failed || [];
      if (imported > 0) {
        await this.load();
        await this.loadStore();
      }
      if (failed.length > 0) {
        const failedKeys = new Set(failed.map((item) => item.key));
        this.migrationItems = this.migrationItems.filter((item) =>
          failedKeys.has(item.key),
        );
        this.migrationSelectedKeys = this.migrationItems.map(
          (item) => item.key,
        );
        this.migrationError = createLocaleTranslator(
        this.settings.language,
      )('extMigrationPartial', { imported, failed: failed.length });
        return;
      }
      this.migrationOpen = false;
      if (imported > 0) {
        this.setStatus(
        createLocaleTranslator(this.settings.language)('extMigrationDone', {
          count: imported,
        }),
      );
      } else if ((result?.skipped || 0) > 0) {
        this.setStatus(
        createLocaleTranslator(this.settings.language)('extMigrationDuplicates'),
      );
      } else {
        this.setStatus(
        createLocaleTranslator(this.settings.language)('extMigrationNoneImported', {
          count: requested,
        }),
      );
      }
    } catch {
      this.migrationError = createLocaleTranslator(
        this.settings.language,
      )('extMigrationReadErr');
    } finally {
      this.migrationImporting = false;
    }
  }

  public async installFromFilePath(filePath: string) {
    const res = await ipcRenderer.invoke('load-extension-from-file', filePath);
    return res && res.name ? res : null;
  }

  @action
  public async installFromPaths(paths: string[]) {
    const uniquePaths = [...new Set((paths || []).filter(Boolean))];
    if (uniquePaths.length === 0) {
      this.setStatus(
        createLocaleTranslator(this.settings.language)('extInstallBadFile'),
      );
      return;
    }

    let ok = 0;
    let failed = 0;
    const names: string[] = [];

    for (const filePath of uniquePaths) {
      const res = await this.installFromFilePath(filePath);
      if (res?.name) {
        ok += 1;
        names.push(res.name);
      } else {
        failed += 1;
      }
    }

    if (ok > 0) {
      await this.load();
      await this.loadStore();
    }

    if (ok === 1 && failed === 0) {
      this.setStatus(
        createLocaleTranslator(this.settings.language)('extInstalledOne', {
          name: names[0],
        }),
      );
      return;
    }

    if (ok > 0 && failed === 0) {
      this.setStatus(
        createLocaleTranslator(this.settings.language)('extInstalledN', {
          count: ok,
        }),
      );
      return;
    }

    if (ok > 0) {
      this.setStatus(
        createLocaleTranslator(this.settings.language)('extInstalledNFailed', {
          ok,
          failed,
        }),
      );
      return;
    }

    this.setStatus(
        createLocaleTranslator(this.settings.language)('extInstallFailedGeneric'),
      );
  }

  @action
  public setStatus(message: string | null, duration = 6000) {
    this.updateStatus = message;
    const token = ++this.statusToken;
    if (!message || duration <= 0) return;
    setTimeout(() => {
      if (this.statusToken === token) this.updateStatus = null;
    }, duration);
  }

  public installFromWeb(url: string) {
    window.location.href = url;
  }

  // 拉取拓展商店列表,并标记已安装状态。
  @action
  public async loadStore() {
    this.storeLoading = true;
    try {
      const list: IStoreExt[] = await ipcRenderer.invoke(
        'extension-store-list',
      );
      const installedKeys = new Set(this.extensions.map((x) => x.id));
      this.storeList = (list || []).map((it) => ({
        ...it,
        installed: it.installed || installedKeys.has(it.crxkey),
      }));
    } finally {
      this.storeLoading = false;
    }
  }

  public isInstalling(crxkey: string): boolean {
    return this.installing.includes(crxkey);
  }

  // 按 crxkey 下载并安装拓展商店中的扩展。
  @action
  public async installFromStore(item: IStoreExt) {
    if (this.isInstalling(item.crxkey)) return;
    this.installing = [...this.installing, item.crxkey];
    try {
      const res = await ipcRenderer.invoke(
        'extension-store-install',
        item.crxkey,
      );
      if (res && res.id) {
        await this.load();
        // 刷新商店列表的已安装标记。
        this.storeList = this.storeList.map((x) =>
          x.crxkey === item.crxkey ? { ...x, installed: true } : x,
        );
      } else {
        alert(
      createLocaleTranslator(this.settings.language)('extInstallFailedOne', {
        name: item.name,
      }),
    );
      }
    } finally {
      this.installing = this.installing.filter((k) => k !== item.crxkey);
    }
  }

  // 从主进程读取「自动更新」开关的当前值。
  @action
  public async loadAutoUpdate() {
    try {
      const v = await ipcRenderer.invoke('extensions-get-auto-update');
      this.autoUpdate = v !== false;
    } catch {
      // 忽略,保持默认值
    }
  }

  // 切换「自动更新」开关并持久化到主进程设置。
  @action
  public async setAutoUpdate(value: boolean) {
    this.autoUpdate = value;
    try {
      await ipcRenderer.invoke('extensions-set-auto-update', value);
    } catch {
      // 忽略写入失败
    }
  }

  // 手动「检查更新」:检查全部扩展并升级,回显结果(与 Chrome 的「更新」按钮一致)。
  @action
  public async checkUpdates() {
    if (this.checking) return;
    this.checking = true;
    this.updateStatus = createLocaleTranslator(
        this.settings.language,
      )('extUpdateChecking');
    try {
      const res = await ipcRenderer.invoke('extensions-check-updates');
      const updated = (res && res.updated) || [];
      const failed = (res && res.failed) || [];
      if (updated.length > 0) {
        const names = updated
          .map((u: any) => `${u.name} → v${u.toVersion}`)
          .join(createLocaleTranslator(this.settings.language)('wbListSep'));
        this.updateStatus = createLocaleTranslator(
        this.settings.language,
      )('extUpdatedN', { count: updated.length, names });
        await this.load();
        await this.loadStore();
      } else if (failed.length > 0) {
        this.updateStatus = createLocaleTranslator(
        this.settings.language,
      )('extUpdatePartFailed', { count: failed.length });
      } else {
        this.updateStatus = createLocaleTranslator(
        this.settings.language,
      )('extUpdateAllLatest');
      }
    } catch {
      this.updateStatus = createLocaleTranslator(
        this.settings.language,
      )('extUpdateFailedGeneric');
    } finally {
      this.checking = false;
      // 数秒后自动清除提示(用令牌避免旧定时器清掉后续新提示)。
      this.setStatus(this.updateStatus, 6000);
    }
  }

  public isExtensionChecking(id: string): boolean {
    return this.extensionCheckingIds.includes(id);
  }

  public extensionUpdateStatus(id: string): string | null {
    return this.extensionUpdateStatuses[id] || null;
  }

  private extensionStatusTokens: Record<string, number> = {};

  @action
  private setExtensionUpdateStatus(id: string, message: string | null) {
    if (message) {
      this.extensionUpdateStatuses = {
        ...this.extensionUpdateStatuses,
        [id]: message,
      };
    } else {
      const next = { ...this.extensionUpdateStatuses };
      delete next[id];
      this.extensionUpdateStatuses = next;
    }
    const token = (this.extensionStatusTokens[id] || 0) + 1;
    this.extensionStatusTokens[id] = token;
    if (message) {
      setTimeout(() => {
        if (this.extensionStatusTokens[id] === token) {
          this.setExtensionUpdateStatus(id, null);
        }
      }, 6000);
    }
  }

  /** 检查并更新单个扩展，结果只回显在该扩展卡片/详情页。 */
  @action
  public async checkUpdate(item: IExtItem) {
    if (!item || this.isExtensionChecking(item.id) || this.checking) return;
    this.extensionCheckingIds = [...this.extensionCheckingIds, item.id];
    const t = createLocaleTranslator(this.settings.language);
    this.setExtensionUpdateStatus(item.id, t('extUpdateChecking'));
    try {
      const res = await ipcRenderer.invoke('extension-check-update', item.id);
      const updated = (res && res.updated) || [];
      const failed = (res && res.failed) || [];
      if (updated.length > 0) {
        this.setExtensionUpdateStatus(
          item.id,
          t('extUpdatedOne', { version: updated[0].toVersion }),
        );
        await this.load();
        await this.loadStore();
      } else if (failed.length > 0 || !res || res.checked !== 1) {
        this.setExtensionUpdateStatus(item.id, t('extUpdateFailedGeneric'));
      } else {
        this.setExtensionUpdateStatus(item.id, t('extUpdateOneLatest'));
      }
    } catch {
      this.setExtensionUpdateStatus(item.id, t('extUpdateFailedGeneric'));
    } finally {
      this.extensionCheckingIds = this.extensionCheckingIds.filter(
        (id) => id !== item.id,
      );
    }
  }
}

export default new Store();
