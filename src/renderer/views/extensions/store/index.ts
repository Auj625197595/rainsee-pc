import { observable, computed, action, makeObservable } from 'mobx';

import { ISettings, ITheme, IExtItem, IExtInspectView } from '~/interfaces';
import { getTheme } from '~/utils/themes';
import { RUFFLE_EXTENSION_ID } from '~/constants';
import { ipcRenderer } from '~/common/renderer-ipc';

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
  public settings: ISettings = { ...(window as any).settings };

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

  // 更新结果提示文案(null 为不显示)。
  @observable
  public updateStatus: string | null = null;

  // 扩展自动更新开关(与主进程设置同步,默认开启)。
  @observable
  public autoUpdate = true;

  // 提示自动清除的令牌,避免旧定时器清掉新提示。
  private statusToken = 0;

  @computed
  public get theme(): ITheme {
    return getTheme(this.settings.theme);
  }

  @computed
  public get list(): IExtItem[] {
    const q = this.searched;
    return this.extensions.filter((x) => {
      if (this.selectedFilter === 'enabled' && !x.enabled) return false;
      if (this.selectedFilter === 'disabled' && x.enabled) return false;
      if (q && !`${x.name} ${x.description}`.toLowerCase().includes(q))
        return false;
      return true;
    });
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

    (window as any).updateSettings = (settings: ISettings) => {
      this.settings = { ...this.settings, ...settings };
    };

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

  public async setIncognitoAllowed(item: IExtItem, allowed: boolean) {
    await ipcRenderer.invoke(
      'extension-set-incognito-allowed',
      item.id,
      allowed,
    );
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
      this.inspectStatus = '此扩展当前没有可检查的视图。';
      return;
    }

    const token = ++this.inspectStatusToken;
    this.inspectingTargetId = selectedTarget.id;
    this.inspectStatusError = false;
    this.inspectStatus =
      selectedTarget.type === 'service-worker'
        ? '正在启动服务工作进程并打开开发者工具，请稍候…'
        : `正在打开「${selectedTarget.label}」开发者工具…`;
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
          `无法打开「${selectedTarget.label}」开发者工具。`;
        return;
      }
      this.inspectStatus = `已请求打开「${selectedTarget.label}」开发者工具。`;
      setTimeout(() => {
        if (token === this.inspectStatusToken) this.inspectStatus = null;
      }, 3000);
    } catch {
      if (token !== this.inspectStatusToken) return;
      this.inspectStatusError = true;
      this.inspectStatus = `无法打开「${selectedTarget.label}」开发者工具。`;
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
      !confirm(`确定要卸载「${item.name}」吗?`)
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
      this.setStatus(`已安装「${res.name}」`);
    }
  }

  public async installFromDir() {
    const res = await ipcRenderer.invoke('load-extension-from-dir');
    if (res && res.name) {
      await this.load();
      await this.loadStore();
      this.setStatus(`已加载「${res.name}」`);
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
      this.setStatus('仅支持安装 .crx 或 .zip 文件');
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
      this.setStatus(`已安装「${names[0]}」`);
      return;
    }

    if (ok > 0 && failed === 0) {
      this.setStatus(`已安装 ${ok} 个扩展`);
      return;
    }

    if (ok > 0) {
      this.setStatus(`已安装 ${ok} 个扩展，${failed} 个失败`);
      return;
    }

    this.setStatus('安装失败，请确认文件是有效的扩展包');
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
        alert(`安装「${item.name}」失败,请稍后重试`);
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
    this.updateStatus = '正在检查更新…';
    try {
      const res = await ipcRenderer.invoke('extensions-check-updates');
      const updated = (res && res.updated) || [];
      const failed = (res && res.failed) || [];
      if (updated.length > 0) {
        const names = updated
          .map((u: any) => `${u.name} → v${u.toVersion}`)
          .join('、');
        this.updateStatus = `已更新 ${updated.length} 个扩展:${names}`;
        await this.load();
        await this.loadStore();
      } else if (failed.length > 0) {
        this.updateStatus = `检查完成,${failed.length} 个扩展更新失败`;
      } else {
        this.updateStatus = '所有扩展均为最新版本';
      }
    } catch {
      this.updateStatus = '检查更新失败,请稍后重试';
    } finally {
      this.checking = false;
      // 数秒后自动清除提示(用令牌避免旧定时器清掉后续新提示)。
      this.setStatus(this.updateStatus, 6000);
    }
  }
}

export default new Store();
