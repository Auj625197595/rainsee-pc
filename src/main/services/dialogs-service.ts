import { BrowserView, app, ipcMain } from 'electron';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { SearchDialog } from '../dialogs/search';
import { PreviewDialog } from '../dialogs/preview';
import { ShowBlockDialog } from '../dialogs/show-block';
import { AddBookmarkDialog } from '../dialogs/add-bookmark';
import { MenuDialog } from '../dialogs/menu';
import { ExtensionsListDialog } from '../dialogs/extensions-list';
import { UpdateDialog } from '../dialogs/update';
import { ShareDialog } from '../dialogs/share';
import { ScreenshotDialog } from '../dialogs/screenshot';
import { SearchEnginesDialog } from '../dialogs/search-engines';
import { SiteInfoDialog } from '../dialogs/site-info';
import { TranslateDialog } from '../dialogs/translate';
import { InstallAppDialog } from '../dialogs/install-app';
import { TabGroupPreviewDialog } from '../dialogs/tabgroup-preview';
import { SidebarPanelDialog } from '../dialogs/sidebar-panel';
// 开源版：手机互联(phone tabs)弹窗已移除。
import { BookmarkOverflowDialog } from '../dialogs/bookmark-overflow';
import { PersistentDialog } from '../dialogs/dialog';
import { ClearBrowsingDataDialog } from '../dialogs/clear-browsing-data';
import { HistoryBookmarksDialog } from '../dialogs/history-bookmarks';
import { DownloadPromptDialog } from '../dialogs/download-prompt';
import { CredentialsDialog } from '../dialogs/credentials';
import { FormFillDialog } from '../dialogs/form-fill';
import { Application } from '../application';
import { IRectangle } from '~/interfaces';

interface IDialogTabAssociation {
  tabId?: number;
  getTabInfo?: (tabId: number) => any;
  setTabInfo?: (tabId: number, ...args: any[]) => void;
}

type BoundsDisposition = 'move' | 'resize';

interface IDialogShowOptions {
  name: string;
  browserWindow: Electron.BrowserWindow;
  hideTimeout?: number;
  devtools?: boolean;
  tabAssociation?: IDialogTabAssociation;
  onWindowBoundsUpdate?: (disposition: BoundsDisposition) => void;
  onHide?: (dialog: IDialog) => void;
  getBounds: () => IRectangle;
}

interface IDialog {
  name: string;
  browserWindow: Electron.BrowserWindow;
  browserView: BrowserView;
  id: number;
  tabIds: number[];
  _sendTabInfo: (tabId: number) => void;
  hide: (tabId?: number) => void;
  handle: (name: string, cb: (...args: any[]) => any) => void;
  on: (name: string, cb: (...args: any[]) => any) => void;
  rearrange: (bounds?: IRectangle) => void;
}

export const roundifyRectangle = (rect: IRectangle): IRectangle => {
  const newRect: any = { ...rect };
  Object.keys(newRect).forEach((key) => {
    if (!isNaN(newRect[key])) newRect[key] = Math.round(newRect[key]);
  });
  return newRect;
};

export class DialogsService {
  public browserViews: BrowserView[] = [];
  public browserViewDetails = new Map<number, boolean>();
  public dialogs: IDialog[] = [];

  public persistentDialogs: PersistentDialog[] = [];

  // 懒加载工厂:每个 PersistentDialog 的构造会立刻 new BrowserView() 并 loadURL
  // 一个完整的 React+mobx 包,代价不小。构造阶段只登记工厂,除 search 外均在
  // 用户真正打开时才创建,避免隐藏页面占用内存和启动资源。
  // 用户若在 run() 前操作,getPersistent 也能从已登记工厂即时创建所需弹窗。
  private persistentDialogFactories: {
    [name: string]: () => PersistentDialog;
  } = {};

  // search 是地址栏输入关键路径,保持常驻。其余工厂弹窗默认全部进入回收机制,
  // 新增弹窗不再依赖人工维护白名单。
  private readonly persistentDialogNames = new Set<string>();
  private disposeTimers = new Map<string, NodeJS.Timeout>();
  private readonly DISPOSE_DELAY = 60_000;

  private started = false;

  public constructor() {
    // Factory registration is cheap and must be available as soon as a window
    // can emit UI IPC. BrowserViews remain lazy, so this closes the early-click
    // window without moving renderer work back onto the native-window path.
    this.persistentDialogFactories = {
      search: () => new SearchDialog(),
      'show-block': () => new ShowBlockDialog(),
      'add-bookmark': () => new AddBookmarkDialog(),
      menu: () => new MenuDialog(),
      'extensions-list': () => new ExtensionsListDialog(),
      update: () => new UpdateDialog(),
      share: () => new ShareDialog(),
      screenshot: () => new ScreenshotDialog(),
      'search-engines': () => new SearchEnginesDialog(),
      'site-info': () => new SiteInfoDialog(),
      'clear-browsing-data': () => new ClearBrowsingDataDialog(),
      'download-prompt': () => new DownloadPromptDialog(),
      credentials: () => new CredentialsDialog(),
      'form-fill': () => new FormFillDialog(),
      translate: () => new TranslateDialog(),
      'install-app': () => new InstallAppDialog(),
      'tabgroup-preview': () => new TabGroupPreviewDialog(),
      'sidebar-panel': () => new SidebarPanelDialog(),
      'bookmark-overflow': () => new BookmarkOverflowDialog(),
      'history-bookmarks-popup': () => new HistoryBookmarksDialog(),
      preview: () => new PreviewDialog(),
    };
    Object.keys(this.persistentDialogFactories).forEach((name) =>
      this.persistentDialogNames.add(name),
    );
  }

  public run() {
    if (this.started) return;

    // search 与地址栏输入联想强相关,保持即时创建。
    // 其余持久弹窗以及动态弹窗 BrowserView 都在实际打开时创建。
    this.ensurePersistent('search');
    this.started = true;
  }

  // 首次真正打开时从工厂创建持久弹窗;已存在则直接返回。
  private ensurePersistent(name: string): PersistentDialog | undefined {
    const existing = this.persistentDialogs.find((x) => x.name === name);
    if (existing) return existing;

    const factory = this.persistentDialogFactories[name];
    if (!factory) return undefined;

    const dialog = factory();
    this.persistentDialogs.push(dialog);
    // 不 delete 工厂(原实现是一次性 delete):disposable 弹窗销毁后需要靠工厂重建,
    // 工厂必须常驻。几个函数引用的内存开销可忽略。

    // 除 search 外所有工厂弹窗统一接入回收生命周期。
    if (this.isDisposable(name)) {
      dialog.on('showing', () => this.cancelDispose(name));
      dialog.on('shown', () => this.cancelDispose(name));
      dialog.on('hidden', () => this.scheduleDispose(name));
      this.scheduleDispose(name);
    }
    dialog.once('load-failed', (error) => {
      console.error(`[dialog] ${name} load failed`, error);
      this.destroyPersistentInstance(name, dialog);
    });

    return dialog;
  }

  private isDisposable(name: string) {
    return name !== 'search' && this.persistentDialogNames.has(name);
  }

  // 安排弹窗在 hide 后 DISPOSE_DELAY 销毁。除 search 外统一生效。已有计时器先清,
  // 保证只保留最近一次 hide 的调度(防止快速 show/hide 反复 setTimeout)。
  public scheduleDispose(name: string) {
    if (!this.isDisposable(name)) return;
    // dialog 已不在(销毁中或已销毁),不要(重新)挂计时器,避免残留无谓计时器。
    if (!this.persistentDialogs.some((x) => x.name === name)) return;
    const existing = this.disposeTimers.get(name);
    if (existing) clearTimeout(existing);
    this.disposeTimers.set(
      name,
      setTimeout(() => this.disposePersistent(name), this.DISPOSE_DELAY),
    );
  }

  // 取消挂起的销毁(show 时调用)。
  public cancelDispose(name: string) {
    const t = this.disposeTimers.get(name);
    if (t) {
      clearTimeout(t);
      this.disposeTimers.delete(name);
    }
  }

  // 销毁并回收一个 disposable 弹窗的 BrowserView + React 包。
  // PersistentDialog 是全局单例,销毁影响所有窗口(其他窗口下次 hover 重建挂到那个
  // 窗口)——预期行为,内存优先。race 防护:计时器 fire 时若仍 visible(用户又 show),
  // 重新调度而非销毁。
  private disposePersistent(name: string) {
    // 先清计时器标记,无论后续走哪条路径。
    this.disposeTimers.delete(name);

    const idx = this.persistentDialogs.findIndex((x) => x.name === name);
    if (idx === -1) return;
    const dialog = this.persistentDialogs[idx];

    if (dialog.visible) {
      // 仍可见(用户在计时器窗口内又 show 了),重新调度等下次 hide。
      this.scheduleDispose(name);
      return;
    }

    this.destroyPersistentInstance(name, dialog);
  }

  private destroyPersistentInstance(name: string, dialog: PersistentDialog) {
    this.cancelDispose(name);
    const idx = this.persistentDialogs.indexOf(dialog);
    if (idx === -1) return;

    // 先从数组移除:这样后续 hide() 触发的 hidden → scheduleDispose 会因
    // some() 检查失败而不再重设计时器,避免销毁后残留计时器。
    this.persistentDialogs.splice(idx, 1);

    // hide 确保 removeBrowserView + 清子类的 window resize/move listener,
    // 再 destroy 释放 webContents。两者都容错。
    try {
      dialog.hide();
    } catch {
      // ignore
    }
    try {
      dialog.destroy();
    } catch {
      // ignore
    }
  }

  private createBrowserView() {
    const view = new BrowserView({
      webPreferences: {
        nodeIntegration: true,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: false,
        enableRemoteModule: true,
        webviewTag: true,
        worldSafeExecuteJavaScript: false,
        allowRunningInsecureContent: true,
      },
    });
    require('@electron/remote/main').enable(view.webContents);

    // 透明背景：让弹窗圆角外/毛玻璃面板能透出底层页面(实现真实背景模糊)
    try {
      view.setBackgroundColor('#00000000');
    } catch (e) {
      console.error('setBackgroundColor transparent failed', e);
    }

    this.browserViews.push(view);

    this.browserViewDetails.set(view.webContents.id, false);

    return view;
  }

  public show(options: IDialogShowOptions): IDialog {
    const {
      name,
      browserWindow,
      getBounds,
      devtools,
      onHide,
      hideTimeout,
      onWindowBoundsUpdate,
      tabAssociation,
    } = options;

    const foundDialog = this.getDynamic(name);

    let browserView = foundDialog
      ? foundDialog.browserView
      : this.browserViews.find(
          (x) => !this.browserViewDetails.get(x.webContents.id),
        );

    if (!browserView) {
      browserView = this.createBrowserView();
    }

    const appWindow =
      Application.instance.windows.fromBrowserWindow(browserWindow);

    if (foundDialog && tabAssociation) {
      foundDialog.tabIds.push(tabAssociation.tabId);
      foundDialog._sendTabInfo(tabAssociation.tabId);
    }

    if (foundDialog) {
      foundDialog.browserWindow = browserWindow;
    }

    browserWindow.webContents.send('dialog-visibility-change', name, true);

    this.browserViewDetails.set(browserView.webContents.id, true);

    if (foundDialog) {
      browserWindow.addBrowserView(browserView);
      foundDialog.rearrange();
      return null;
    }

    browserWindow.addBrowserView(browserView);
    browserView.setBounds({ x: 0, y: 0, width: 1, height: 1 });

    if (devtools) {
      browserView.webContents.openDevTools({ mode: 'detach' });
    }

    const tabsEvents: {
      activate?: (id: number) => void;
      remove?: (id: number) => void;
    } = {};

    const windowEvents: {
      resize?: () => void;
      move?: () => void;
    } = {};

    const channels: string[] = [];

    const dialog: IDialog = {
      browserView,
      browserWindow,
      id: browserView.webContents.id,
      name,
      tabIds: [tabAssociation?.tabId],
      _sendTabInfo: (tabId) => {
        if (tabAssociation.getTabInfo) {
          const data = tabAssociation.getTabInfo(tabId);
          browserView.webContents.send('update-tab-info', tabId, data);
        }
      },
      hide: (tabId) => {
        const { selectedId } = appWindow.viewManager;

        dialog.tabIds = dialog.tabIds.filter(
          (x) => x !== (tabId || selectedId),
        );

        if (tabId && tabId !== selectedId) return;

        browserWindow.webContents.send('dialog-visibility-change', name, false);

        browserWindow.removeBrowserView(browserView);

        if (tabAssociation && dialog.tabIds.length > 0) return;

        ipcMain.removeAllListeners(`hide-${browserView.webContents.id}`);
        channels.forEach((x) => {
          ipcMain.removeHandler(x);
          ipcMain.removeAllListeners(x);
        });

        this.dialogs = this.dialogs.filter((x) => x.id !== dialog.id);

        this.browserViewDetails.set(browserView.webContents.id, false);

        if (this.browserViews.length > 1) {
          // 并发弹窗临时扩出的 BrowserView 在关闭后立即回收，只保留一个空白槽位
          // 供下一次动态弹窗复用。
          this.browserViewDetails.delete(browserView.webContents.id);
          const index = this.browserViews.indexOf(browserView);
          if (index !== -1) this.browserViews.splice(index, 1);
          try {
            (browserView as any).destroy();
          } catch {
            // ignore
          }
        } else {
          browserView.webContents.loadURL('about:blank');
        }

        if (tabAssociation) {
          appWindow.viewManager.off('activated', tabsEvents.activate);
          appWindow.viewManager.off('removed', tabsEvents.remove);
        }

        browserWindow.removeListener('resize', windowEvents.resize);
        browserWindow.removeListener('move', windowEvents.move);

        if (onHide) onHide(dialog);
      },
      handle: (name, cb) => {
        const channel = `${name}-${browserView.webContents.id}`;
        ipcMain.handle(channel, (...args) => cb(...args));
        channels.push(channel);
      },
      on: (name, cb) => {
        const channel = `${name}-${browserView.webContents.id}`;
        ipcMain.on(channel, (...args) => cb(...args));
        channels.push(channel);
      },
      rearrange: (rect) => {
        rect = rect || {};
        browserView.setBounds({
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          ...roundifyRectangle(getBounds()),
          ...roundifyRectangle(rect),
        });
      },
    };

    tabsEvents.activate = (id) => {
      const visible = dialog.tabIds.includes(id);
      browserWindow.webContents.send('dialog-visibility-change', name, visible);

      if (visible) {
        dialog._sendTabInfo(id);
        browserWindow.removeBrowserView(browserView);
        browserWindow.addBrowserView(browserView);
      } else {
        browserWindow.removeBrowserView(browserView);
      }
    };

    tabsEvents.remove = (id) => {
      dialog.hide(id);
    };

    const emitWindowBoundsUpdate = (type: BoundsDisposition) => {
      if (
        tabAssociation &&
        !dialog.tabIds.includes(appWindow.viewManager.selectedId)
      ) {
        onWindowBoundsUpdate(type);
      }
    };

    windowEvents.move = () => {
      emitWindowBoundsUpdate('move');
    };

    windowEvents.resize = () => {
      emitWindowBoundsUpdate('resize');
    };

    if (tabAssociation) {
      appWindow.viewManager.on('removed', tabsEvents.remove);
      appWindow.viewManager.on('activated', tabsEvents.activate);
    }

    if (onWindowBoundsUpdate) {
      browserWindow.on('resize', windowEvents.resize);
      browserWindow.on('move', windowEvents.move);
    }

    const onLoaded = () => {
      if (browserView.webContents.isDestroyed()) return;
      // 重涂透明底色:--process-per-site 合并进程后,构造期设的透明会被继承的
      // 不透明底色覆盖,页面加载后重涂确保浮层透明(否则背景变白)。
      try {
        browserView.setBackgroundColor('#00000000');
      } catch {
        // 忽略
      }
      dialog.rearrange();
      browserView.webContents.focus();
    };

    let loadPromise: Promise<void>;
    if (process.env.NODE_ENV === 'development') {
      loadPromise = browserView.webContents.loadURL(
        `http://localhost:4444/${name}.html`,
      );
    } else {
      loadPromise = browserView.webContents.loadURL(
        pathToFileURL(join(app.getAppPath(), 'build', `${name}.html`)).href,
      );
    }
    loadPromise.then(onLoaded).catch((error) => {
      // hide() 可能用 about:blank 主动取消尚未完成的加载，此时 dialog 已从
      // dialogs 移除，不应记录成加载异常。
      if (!this.dialogs.some((item) => item.id === dialog.id)) return;
      console.error(`[dialog] ${name} load failed`, error);
      dialog.hide();
    });

    ipcMain.on(`hide-${browserView.webContents.id}`, () => {
      dialog.hide();
    });

    if (tabAssociation) {
      dialog.on('loaded', () => {
        dialog._sendTabInfo(tabAssociation.tabId);
      });

      if (tabAssociation.setTabInfo) {
        dialog.on('update-tab-info', (e, tabId, ...args) => {
          tabAssociation.setTabInfo(tabId, ...args);
        });
      }
    }

    this.dialogs.push(dialog);

    return dialog;
  }

  public getBrowserViews = () => {
    return this.browserViews.concat(
      Array.from(this.persistentDialogs).map((x) => x.browserView),
    );
  };

  // BrowserView 的后添加项位于 z 序顶部。沉浸头部在内容视图重挂载后需要回到
  // 内容之上时，调用方会先重挂头部；这里再按原有显示顺序恢复页面弹窗，保证它们
  // 始终位于头部之上。
  public bringVisibleToTop(browserWindow: Electron.BrowserWindow) {
    for (const dialog of this.persistentDialogs) {
      if (dialog.visible && dialog.browserWindow === browserWindow) {
        dialog.bringToTop();
      }
    }

    for (const dialog of this.dialogs) {
      if (dialog.browserWindow !== browserWindow) continue;
      browserWindow.removeBrowserView(dialog.browserView);
      browserWindow.addBrowserView(dialog.browserView);
    }
  }

  public destroy = () => {
    // 清所有挂起的销毁计时器,避免 fire 时访问已 destroy 的 webContents。
    for (const t of this.disposeTimers.values()) clearTimeout(t);
    this.disposeTimers.clear();
    this.browserViews.forEach((view) => {
      if (!view.webContents.isDestroyed()) (view.webContents as any).destroy();
    });
    this.persistentDialogs.forEach((dialog) => dialog.destroy());
    this.browserViews = [];
    this.persistentDialogs = [];
    this.browserViewDetails.clear();
  };

  public sendToAll = (channel: string, ...args: any[]) => {
    this.getBrowserViews().forEach(
      (x) =>
        !x.webContents.isDestroyed() && x.webContents.send(channel, ...args),
    );
  };

  public get(name: string) {
    return this.getDynamic(name) || this.getPersistent(name);
  }

  public getDynamic(name: string) {
    return this.dialogs.find((x) => x.name === name);
  }

  public getPersistent(name: string) {
    // 首次打开时若尚未创建,按工厂即时创建。
    return this.ensurePersistent(name);
  }

  // 仅查询现有实例。后台状态广播和幂等 hide 不应为了“可能存在”的弹窗创建
  // 一个完整 React BrowserView。
  public getExistingPersistent(name: string) {
    return this.persistentDialogs.find((dialog) => dialog.name === name);
  }

  public isVisible = (name: string) => {
    return !!(
      this.getDynamic(name) || this.getExistingPersistent(name)?.visible
    );
  };

  // 关闭本窗口所有仍可见的持久弹窗。
  //
  // 背景:ViewManager.select() 会把内容 view 经 addBrowserView 重新挂回窗口,
  // 而 addBrowserView 总是把视图放到 z 序顶端——于是内容 view 会盖住此前打开的
  // 弹窗 BrowserView(弹窗落在标题栏以下、与内容区重叠的那部分会被网页遮住,
  // 表现为「弹窗一部分被网页遮挡」)。弹窗原本靠自身渲染层的 window blur 自动关闭,
  // 但在本环境里 blur 偶发不触发,弹窗便卡在「被遮挡、又关不掉」的状态。
  //
  // 因此在内容 view 重新获焦/切标签时直接关闭这些浮层:既从根上避免被内容遮挡,
  // 也对齐 Chrome「点网页/切标签即关闭菜单、地址栏下拉等浮层」的交互,且不再依赖
  // 不稳定的 blur。仅关闭挂在指定窗口上的弹窗,多窗口互不影响;带 tabAssociation
  // 的动态弹窗(find 等)由 tabsEvents.activate 自行按标签 detach/重挂,不在此处理,
  // 避免破坏其切回原标签时复现的行为。
  public hideAllPersistent = (
    browserWindow?: Electron.BrowserWindow,
    exceptNames: string[] = [],
  ) => {
    const excluded = new Set(exceptNames);
    for (const d of this.persistentDialogs) {
      if (!d.visible) continue;
      if (browserWindow && d.browserWindow !== browserWindow) continue;
      if (excluded.has(d.name)) continue;
      try {
        d.hide();
      } catch {
        // 弹窗在关闭过程中被销毁等,忽略,不影响主流程。
      }
    }
  };
}
