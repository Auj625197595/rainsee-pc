import { BrowserView, app, ipcMain, BrowserWindow } from 'electron';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { EventEmitter } from 'events';
import { roundifyRectangle } from '../services/dialogs-service';

interface IOptions {
  name: string;
  // 加载的 html 文件名(不含扩展)。默认与 name 一致;让二级浮层能复用一级的渲染页
  // (如 bookmark-overflow-sub 复用 bookmark-overflow.html),共享渲染代码、省一个入口。
  htmlFile?: string;
  devtools?: boolean;
  bounds?: IRectangle;
  hideTimeout?: number;
  customHide?: boolean;
  webPreferences?: Electron.WebPreferences;
}

interface IRectangle {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export class PersistentDialog extends EventEmitter {
  public browserWindow: BrowserWindow;
  public browserView: BrowserView;

  public visible = false;

  public bounds: IRectangle = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };

  public name: string;

  public htmlFile: string;

  private timeout: any;
  private hideTimeout: number;

  private loaded = false;
  private readySettled = false;
  private readyPromise: Promise<void>;
  private resolveReady: () => void;
  private rejectReady: (error: Error) => void;

  // 标识当前一次 show 意图。冷加载期间发生 hide 或后续 show 时，旧请求不得在
  // dom-ready 后重新把弹窗挂回窗口。
  private visibilityRequest = 0;
  private showPending = false;

  // 本弹窗自建的所有 ipcMain channel,destroy 时统一 removeAllListeners。
  // 子类把自建的 channel(如 resize-dialog-${id})也 push 进来,避免销毁后泄漏。
  protected ipcChannels: string[] = [];

  public constructor({
    bounds,
    name,
    htmlFile,
    devtools,
    hideTimeout,
    webPreferences,
  }: IOptions) {
    super();

    this.browserView = new BrowserView({
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true,
        worldSafeExecuteJavaScript: true,
        allowRunningInsecureContent: true,
        // 冷创建的 BrowserView 在挂载前也要及时完成本地 React 页初始化。
        backgroundThrottling: false,
        ...webPreferences,
      },
    });
    require("@electron/remote/main").enable(this.browserView.webContents)

    // 显式把弹窗视图底色设为透明:毛玻璃/圆角浮层要透出底层页面。
    // 必须显式设置——开启 --process-per-site 后,弹窗会与 app.html 合并进同一渲染
    // 进程并继承其不透明底色,若不强制透明就会渲染成白色。dom-ready 后再重涂一次,
    // 因为渲染表面在合并进程里就绪的时机可能晚于构造,构造期设置会被重置。
    try {
      this.browserView.setBackgroundColor('#00000000');
    } catch {
      // 忽略:个别平台/时序下设置失败不影响主流程
    }

    this.bounds = { ...this.bounds, ...bounds };
    this.hideTimeout = hideTimeout;
    this.name = name;
    this.htmlFile = htmlFile || name;

    const { webContents } = this.browserView;

    const hideChannel = `hide-${webContents.id}`;
    this.ipcChannels.push(hideChannel);
    ipcMain.on(hideChannel, () => {
      this.hide(false, false);
    });

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // 首次加载失败时仍由 show() 观察错误，同时避免 readyPromise 在短暂无人
    // 等待时触发 unhandledRejection。
    this.readyPromise.catch(() => {});

    webContents.once('dom-ready', () => {
      if (this.readySettled) return;
      this.readySettled = true;
      this.loaded = true;
      this.resolveReady();

      if (this.browserWindow && !this.browserWindow.isDestroyed()) {
        this.send('dialog-host-window-id', this.browserWindow.id);
      }

      // 合并进程下渲染表面就绪较晚,构造期设的透明底色可能被重置,这里重涂一次,
      // 确保透明生效(否则 --process-per-site 下弹窗背景会变白)。
      try {
        this.browserView.setBackgroundColor('#00000000');
      } catch {
        // 忽略
      }
    });

    webContents.once(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (isMainFrame === false || errorCode === -3) return;
        this.failReady(
          new Error(
            `Dialog ${this.name} failed to load ${validatedURL}: ${errorDescription} (${errorCode})`,
          ),
        );
      },
    );

    let loadPromise: Promise<void>;
    if (process.env.NODE_ENV === 'development') {
      loadPromise = this.webContents.loadURL(
        `http://localhost:4444/${this.htmlFile}.html`,
      );
    } else {
      loadPromise = this.webContents.loadURL(
        pathToFileURL(join(app.getAppPath(), 'build', `${this.htmlFile}.html`)).href,
      );
    }
    // Electron 的 loadURL Promise 与 did-fail-load 会同时报告主框架错误。统一走
    // failReady 并吞掉 loadURL Promise 拒绝，避免重复产生 unhandledRejection。
    loadPromise.catch((error) => this.failReady(error));
  }

  private failReady(error: Error, emitFailure = true) {
    if (this.readySettled) return;
    this.readySettled = true;
    this.rejectReady(error);
    if (emitFailure) this.emit('load-failed', error);
  }

  public get webContents() {
    return this.browserView.webContents;
  }

  public get id() {
    return this.webContents.id;
  }

  public rearrange(rect: IRectangle = {}) {
    this.bounds = roundifyRectangle({
      height: rect.height || this.bounds.height || 0,
      width: rect.width || this.bounds.width || 0,
      x: rect.x || this.bounds.x || 0,
      y: rect.y || this.bounds.y || 0,
    });

    if (this.visible) {
      this.browserView.setBounds(this.bounds as any);
    }
  }

  public async show(browserWindow: BrowserWindow, focus = true) {
    // 守卫:已销毁(dialog 被回收过)则 reject,由调用方走重建路径。
    if (!this.browserView || this.webContents.isDestroyed()) {
      throw new Error('PersistentDialog destroyed');
    }

    const request = ++this.visibilityRequest;
    this.showPending = true;

    // DialogsService 收到 showing 后会取消挂起的回收计时器。
    this.emit('showing');

    this.browserWindow = browserWindow;

    clearTimeout(this.timeout);

    // 冷创建必须先等渲染页完成初始化。旧代码允许传 false 跳过等待,在取消默认
    // 否则会先挂上透明空视图,并可能把 visible 数据发给尚未注册监听的页面。
    if (!this.loaded) {
      const startedAt = Date.now();
      try {
        await this.readyPromise;
      } catch (error) {
        if (request === this.visibilityRequest) this.showPending = false;
        throw error;
      }
      const waitMs = Date.now() - startedAt;
      if (waitMs >= 100) {
        console.log(`[dialog-perf] ${this.name} cold-load wait=${waitMs}ms`);
      }
    }

    // 加载期间可能已经 mouseleave、切换标签或关闭窗口。此时旧 show 请求必须
    // 终止，且要恢复回收计时器，不能在数秒后突然弹出。
    if (
      request !== this.visibilityRequest ||
      browserWindow.isDestroyed() ||
      !this.browserView ||
      this.webContents.isDestroyed()
    ) {
      if (request === this.visibilityRequest) {
        this.showPending = false;
        this.emit('hidden');
      }
      return false;
    }
    this.showPending = false;

    browserWindow.webContents.send(
      'dialog-visibility-change',
      this.name,
      true,
    );
    this.send('dialog-host-window-id', browserWindow.id);

    if (this.visible) {
      if (focus) this.webContents.focus();
      this.emit('shown');
      return true;
    }

    this.visible = true;

    browserWindow.addBrowserView(this.browserView);
    this.rearrange();

    if (focus) this.webContents.focus();

    this.emit('shown');
    return true;
  }

  public hideVisually() {
    this.send('visible', false);
  }

  public send(channel: string, ...args: any[]) {
    if (!this.browserView || this.webContents.isDestroyed()) return;
    this.webContents.send(channel, ...args);
  }

  public hide(bringToTop = false, hideVisually = true) {
    const hadPendingShow = this.showPending;
    ++this.visibilityRequest;
    this.showPending = false;

    if (!this.browserWindow) {
      if (hadPendingShow) this.emit('hidden');
      return;
    }

    if (hideVisually) this.hideVisually();

    if (!this.visible) {
      if (hadPendingShow) this.emit('hidden');
      return;
    }

    this.browserWindow.webContents.send(
      'dialog-visibility-change',
      this.name,
      false,
    );

    if (bringToTop) {
      this.bringToTop();
    }

    clearTimeout(this.timeout);

    if (this.hideTimeout) {
      this.timeout = setTimeout(() => {
        this.browserWindow.removeBrowserView(this.browserView);
      }, this.hideTimeout);
    } else {
      this.browserWindow.removeBrowserView(this.browserView);
    }

    this.visible = false;

    this.emit('hidden');

    // this.appWindow.fixDragging();
  }

  public bringToTop() {
    this.browserWindow.removeBrowserView(this.browserView);
    this.browserWindow.addBrowserView(this.browserView);
  }

  public destroy() {
    // 清本弹窗自建的所有 ipcMain 监听。原 destroy 只销毁 BrowserView,导致
    // hide-${id}、resize-dialog-${id} 等 channel 的监听器在销毁后仍挂在 ipcMain 上。
    for (const ch of this.ipcChannels) {
      try {
        ipcMain.removeAllListeners(ch);
        ipcMain.removeHandler(ch);
      } catch {
        // ignore
      }
    }
    this.ipcChannels = [];

    clearTimeout(this.timeout);
    ++this.visibilityRequest;
    this.showPending = false;
    if (!this.loaded) {
      this.failReady(
        new Error(`Dialog ${this.name} destroyed before ready`),
        false,
      );
    }

    try {
      if (
        this.browserView &&
        this.browserView.webContents &&
        !this.browserView.webContents.isDestroyed()
      ) {
        this.browserView.destroy();
      }
    } catch {
      // ignore
    }
    this.browserView = null;
  }
}
