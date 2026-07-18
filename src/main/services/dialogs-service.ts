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
import { TranslateDialog } from '../dialogs/translate';
import { InstallAppDialog } from '../dialogs/install-app';
import { TabGroupPreviewDialog } from '../dialogs/tabgroup-preview';
import { SidebarPanelDialog } from '../dialogs/sidebar-panel';
import { BookmarkOverflowDialog } from '../dialogs/bookmark-overflow';
import { PersistentDialog } from '../dialogs/dialog';
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
  // 一个完整的 React+mobx 包,代价不小。run() 在 onReady 的关键路径上(紧挨着
  // windows.open()),若在此一次性构造全部弹窗,5 个额外的包加载会与主窗口抢占
  // GPU/IO,拖慢启动。故只即时创建必需的 search/preview,其余登记为工厂,
  // 首次访问时(getPersistent)按需创建;并在主窗口外壳加载完成后「逐个」预热
  // (上一个 dom-ready 再造下一个),既不与启动争抢,也不一次性突发占用 CPU,
  // 兼顾「启动快」与「打开即时」。
  private persistentDialogFactories: { [name: string]: () => PersistentDialog } = {};

  // 默认预热顺序:仅保留高频/关键弹窗(menu/add-bookmark/show-block),它们常驻不回收。
  // 其余弹窗分两类:
  //  - 完全取消预加载(update/share/screenshot/translate/install-app):首次触发时
  //    由 getPersistent→ensurePersistent 即时创建;install-app 另由 warmUpInstallAppDialog
  //    在检测到可安装 PWA 时条件预热。
  //  - hover 预加载 + hide 后 60s 销毁(disposableSet):启动不预热,首次 hover/click
  //    创建,用完自动回收,见 scheduleDispose/disposePersistent。
  // 默认预热顺序:现为空。所有持久弹窗要么即时构造(search),要么按需 / hover 预加载。
  // menu/add-bookmark/show-block 改 hover 预加载(见 disposableSet);preview 首次 hover
  // 标签创建;update/share/screenshot/translate/install-app 完全按需。warmUpPersistentDialogs
  // 保留骨架供 phone-tabs 条件预热复用。
  private warmUpOrder: string[] = [];

  // 纳入「hide 后 60s 自动销毁」的弹窗。走 hover 预加载(或本就 hover 显示),
  // 用完即回收 BrowserView + React 包内存,下次 hover/click 重建。
  private disposableSet = new Set([
    'tabgroup-preview',
    'sidebar-panel',
    'search-engines',
    'bookmark-overflow',
    'extensions-list',
    // 这三个原为默认预热,现改为 hover 预加载(对应按钮 hover 触发)+ hide 60s 销毁。
    'menu',
    'add-bookmark',
    'show-block',
    // 标签 hover 预览:首次 hover 创建,移开后 60s 销毁(高频但常驻太占内存)。
    'preview',
  ]);
  private disposeTimers = new Map<string, NodeJS.Timeout>();
  private readonly DISPOSE_DELAY = 60_000;

  private warmedUp = false;

  public run() {
    this.createBrowserView();

    // search 与地址栏输入联想强相关,保持即时创建。
    // preview 改为首次 hover 标签时按需创建(工厂注册在下面),不再启动即构造。
    this.persistentDialogs.push(new SearchDialog());

    // 其余弹窗仅在用户交互时才会用到,登记为懒加载工厂,移出启动关键路径。
    this.persistentDialogFactories = {
      'show-block': () => new ShowBlockDialog(),
      'add-bookmark': () => new AddBookmarkDialog(),
      menu: () => new MenuDialog(),
      'extensions-list': () => new ExtensionsListDialog(),
      update: () => new UpdateDialog(),
      share: () => new ShareDialog(),
      screenshot: () => new ScreenshotDialog(),
      'search-engines': () => new SearchEnginesDialog(),
      'translate': () => new TranslateDialog(),
      // 地址栏 PWA 安装图标点击后的安装确认弹窗(Edge 风格)。
      'install-app': () => new InstallAppDialog(),
      // 标签组悬停列表:用户悬停标签组芯片才用到,懒加载 + 预热。
      'tabgroup-preview': () => new TabGroupPreviewDialog(),
      // 侧边栏缩放模式悬停浮层:仅缩放模式下悬停窄轨才用到,懒加载 + 预热。
      'sidebar-panel': () => new SidebarPanelDialog(),
      // 书签栏「更多按钮」多列溢出菜单(子文件夹沿用原生单列菜单,故只需一级浮层)。
      'bookmark-overflow': () => new BookmarkOverflowDialog(),
      // 标签 hover 缩略图预览:首次 hover 标签才创建,之后常驻(高频,不纳入销毁)。
      preview: () => new PreviewDialog(),
    };
  }

  // 逐个预热剩余持久弹窗。由主窗口外壳「加载完成」后触发(见 AppWindow),
  // 只跑一次。每个弹窗等上一个 dom-ready(或超时兜底)再创建,避免突发并发。
  public warmUpPersistentDialogs() {
    if (this.warmedUp) return;
    this.warmedUp = true;

    const queue = this.warmUpOrder.filter((n) => this.persistentDialogFactories[n]);

    const next = () => {
      const name = queue.shift();
      if (!name) return;

      const dialog = this.ensurePersistent(name);
      if (!dialog) {
        next();
        return;
      }

      // 已加载完成则直接进入下一个;否则等 dom-ready,并设超时兜底防止卡住队列。
      let advanced = false;
      const advance = () => {
        if (advanced) return;
        advanced = true;
        // 让出一帧再造下一个,进一步摊平 CPU 占用。
        setTimeout(next, 200);
      };

      const wc = dialog.webContents;
      if (!wc || wc.isDestroyed()) {
        advance();
        return;
      }
      wc.once('dom-ready', advance);
      setTimeout(advance, 1500);
    };

    next();
  }

  // 按需(或预热时)从工厂创建持久弹窗;已存在则直接返回。
  private ensurePersistent(name: string): PersistentDialog | undefined {
    const existing = this.persistentDialogs.find((x) => x.name === name);
    if (existing) return existing;

    const factory = this.persistentDialogFactories[name];
    if (!factory) return undefined;

    const dialog = factory();
    this.persistentDialogs.push(dialog);
    // 不 delete 工厂(原实现是一次性 delete):disposable 弹窗销毁后需要靠工厂重建,
    // 工厂必须常驻。几个函数引用的内存开销可忽略。

    // 接入「show 取消销毁 / hide 调度销毁」生命周期。仅 disposable 名单生效;
    // 其余弹窗的 shown/hidden 事件无监听器,行为不变。
    if (this.disposableSet.has(name)) {
      dialog.on('shown', () => this.cancelDispose(name));
      dialog.on('hidden', () => this.scheduleDispose(name));
    }

    return dialog;
  }

  // 检测到页面可安装 PWA 时,预热安装确认弹窗(若尚未创建)。
  // 由渲染端收到 pwa-installable(canInstall=true)后经 IPC 触发;未访问可安装页面
  // 的用户不会浪费一个 React 包的加载。
  public warmUpInstallAppDialog() {
    this.ensurePersistent('install-app');
  }

  // hover 预加载:按钮 hover 时后台创建弹窗(不显示),click 时秒开。已存在则 no-op。
  public preloadOnHover(name: string) {
    this.ensurePersistent(name);
  }

  // 安排弹窗在 hide 后 DISPOSE_DELAY 销毁。仅 disposable 名单生效。已有计时器先清,
  // 保证只保留最近一次 hide 的调度(防止快速 show/hide 反复 setTimeout)。
  public scheduleDispose(name: string) {
    if (!this.disposableSet.has(name)) return;
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

    // 先从数组移除:这样后续 hide() 触发的 onHidden → scheduleDispose 会因
    // some() 检查失败而不再重设计时器,避免销毁后还挂一个无谓的 60s 计时器。
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
    require("@electron/remote/main").enable(view.webContents);

    // 透明背景：让弹窗圆角外/毛玻璃面板能透出底层页面(实现真实背景模糊)
    try {
      view.setBackgroundColor('#00000000');
    } catch (e) {
      console.error('setBackgroundColor transparent failed', e);
    }

    view.webContents.loadURL(`about:blank`);

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

    const appWindow = Application.instance.windows.fromBrowserWindow(
      browserWindow,
    );

    if (foundDialog && tabAssociation) {
      foundDialog.tabIds.push(tabAssociation.tabId);
      foundDialog._sendTabInfo(tabAssociation.tabId);
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
          // TODO: garbage collect unused BrowserViews?
          // this.browserViewDetails.delete(browserView.id);
          // browserView.destroy();
          // this.browserViews.splice(1, 1);
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

    browserView.webContents.once('dom-ready', () => {
      // 重涂透明底色:--process-per-site 合并进程后,构造期设的透明会被继承的
      // 不透明底色覆盖,dom-ready 后重涂确保浮层透明(否则背景变白)。
      try {
        browserView.setBackgroundColor('#00000000');
      } catch {
        // 忽略
      }
      dialog.rearrange();
      browserView.webContents.focus();
    });

    if (process.env.NODE_ENV === 'development') {
      browserView.webContents.loadURL(`http://localhost:4444/${name}.html`);
    } else {
      browserView.webContents.loadURL(
        pathToFileURL(join(app.getAppPath(), 'build', `${name}.html`)).href,
      );
    }

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

  public destroy = () => {
    // 清所有挂起的销毁计时器,避免 fire 时访问已 destroy 的 webContents。
    for (const t of this.disposeTimers.values()) clearTimeout(t);
    this.disposeTimers.clear();
    this.getBrowserViews().forEach((x) => (x.webContents as any).destroy());
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
    // 首次访问时若尚未创建(预热未到/用户提前操作),按工厂即时创建。
    return this.ensurePersistent(name);
  }

  public isVisible = (name: string) => {
    return this.getDynamic(name) || this.getPersistent(name)?.visible;
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
