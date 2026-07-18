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
  private showCallback: any = null;

  // 本弹窗自建的所有 ipcMain channel,destroy 时统一 removeAllListeners。
  // 子类把自建的 channel(如 resize-dialog-${id})也 push 进来,避免销毁后泄漏。
  protected ipcChannels: string[] = [];

  // 隐藏后的「自动销毁」计时器。与 hide() 用的 this.timeout(延迟 removeBrowserView)
  // 必须独立字段,否则二者会互相 clearTimeout。
  private disposeTimeout: NodeJS.Timeout | null = null;

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

    webContents.once('dom-ready', () => {
      this.loaded = true;

      // 合并进程下渲染表面就绪较晚,构造期设的透明底色可能被重置,这里重涂一次,
      // 确保透明生效(否则 --process-per-site 下弹窗背景会变白)。
      try {
        this.browserView.setBackgroundColor('#00000000');
      } catch {
        // 忽略
      }

      if (this.showCallback) {
        this.showCallback();
        this.showCallback = null;
      }
    });

    if (process.env.NODE_ENV === 'development') {
      this.webContents.loadURL(`http://localhost:4444/${this.htmlFile}.html`);
    } else {
      this.webContents.loadURL(
        pathToFileURL(join(app.getAppPath(), 'build', `${this.htmlFile}.html`)).href,
      );
    }
  }

  public get webContents() {
    return this.browserView.webContents;
  }

  public get id() {
    return this.webContents.id;
  }

  // 是否已完成首次 dom-ready。子类据此决定 show 的 waitForLoad:
  // 已加载则秒开(不等),未加载(销毁重建后首次)则等 dom-ready 避免白屏闪现。
  public get isLoaded() {
    return this.loaded;
  }

  // 取消挂起的自动销毁。任何 show 路径都应调用。
  public clearDisposeTimer() {
    if (this.disposeTimeout) {
      clearTimeout(this.disposeTimeout);
      this.disposeTimeout = null;
    }
  }

  // 安排一次自动销毁,由 DialogsService 在 hide 后调度(仅 disposable 名单)。
  public setDisposeTimer(cb: () => void, delay: number) {
    this.clearDisposeTimer();
    this.disposeTimeout = setTimeout(() => {
      this.disposeTimeout = null;
      cb();
    }, delay);
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

  public show(browserWindow: BrowserWindow, focus = true, waitForLoad = true) {
    return new Promise<void>((resolve, reject) => {
      // 守卫:已销毁(dialog 被回收过)则 reject,由 DialogsService catch 后走重建路径。
      if (!this.browserView || this.webContents.isDestroyed()) {
        reject(new Error('PersistentDialog destroyed'));
        return;
      }

      // 任何 show 路径都取消挂起的自动销毁。
      this.clearDisposeTimer();

      this.browserWindow = browserWindow;

      clearTimeout(this.timeout);

      browserWindow.webContents.send(
        'dialog-visibility-change',
        this.name,
        true,
      );

      const callback = () => {
        if (this.visible) {
          if (focus) this.webContents.focus();
          this.emit('shown');
          resolve();
          return;
        }

        this.visible = true;

        browserWindow.addBrowserView(this.browserView);
        this.rearrange();

        if (focus) this.webContents.focus();

        this.emit('shown');
        resolve();
      };

      if (!this.loaded && waitForLoad) {
        this.showCallback = callback;
        return;
      }

      callback();
    });
  }

  public hideVisually() {
    this.send('visible', false);
  }

  public send(channel: string, ...args: any[]) {
    this.webContents.send(channel, ...args);
  }

  public hide(bringToTop = false, hideVisually = true) {
    if (!this.browserWindow) return;

    if (hideVisually) this.hideVisually();

    if (!this.visible) return;

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
      } catch {
        // ignore
      }
    }
    this.ipcChannels = [];

    this.clearDisposeTimer();

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
