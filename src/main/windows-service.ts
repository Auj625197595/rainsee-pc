import { AppWindow } from './windows/app';
import { app, BrowserWindow, ipcMain } from 'electron';
import { WEBUI_BASE_URL } from '~/constants/files';
import { dumpMemoryReport } from './services/memory-report';
import { Application } from './application';
import { IWorkspace } from '~/interfaces';
import { getWebUIURL } from '~/common/webui-main';

interface ExtensionWindowHostOptions {
  focused?: boolean;
  minimumSize?: {width: number; height: number};
  persistWindowState?: boolean;
}

export class WindowsService {
  public list: AppWindow[] = [];

  public current: AppWindow;

  public lastFocused: AppWindow;

  public pendingHomepageItems: any[] = [];

  // 各窗口标签栏的屏幕坐标矩形,由渲染层在拖拽开始时上报,用于跨窗口合并命中检测。
  public tabStripRects = new Map<number, Electron.Rectangle>();

  constructor() {
    if (process.env.ENABLE_EXTENSIONS) {
      // extensions.tabs.on('activated', (tabId, windowId, focus) => {
      //   const win = this.list.find((x) => x.id === windowId);
      //   win.viewManager.select(tabId, focus === undefined ? true : focus);
      // });
      //
      // extensions.tabs.onCreateDetails = (tab, details) => {
      //   const win = this.findByBrowserView(tab.id);
      //   details.windowId = win.id;
      // };
      //
      // extensions.windows.onCreate = async (details) => {
      //   return this.open(details.incognito).id;
      // };
      //
      // extensions.tabs.onCreate = async (details) => {
      //   const win =
      //     this.list.find((x) => x.id === details.windowId) || this.lastFocused;
      //
      //   if (!win) return -1;
      //
      //   const view = win.viewManager.create(details, true, true);
      //   return view.id;
      // };
    }

    ipcMain.handle('get-tab-zoom', (e, tabId) => {
      const appWindow = this.findByBrowserView(tabId);
      return appWindow?.viewManager.findViewByWebContentsId(tabId)?.webContents
        .zoomFactor ?? 1;
    });

    ipcMain.handle('add-to-homepage', async (_e, item: any) => {
      this.pendingHomepageItems.push(item);
      this.broadcastHomepageItems([item]);
      return true;
    });

    ipcMain.handle('get-pending-homepage-items', async () => {
      return this.pendingHomepageItems.slice();
    });

    ipcMain.on('remove-down-homepage-items', (_e, ids: number[]) => {
      if (!Array.isArray(ids) || ids.length === 0) return;
      const idSet = new Set(ids);
      this.pendingHomepageItems = this.pendingHomepageItems.filter(
        (item) => !idSet.has(item?.id),
      );
    });

    this.registerTabDrag();
  }

  // 标签撕离/合并的跨窗口编排。
  private registerTabDrag() {
    // 渲染层上报自己标签栏的屏幕矩形(拖拽开始时及窗口尺寸变化时)。
    ipcMain.on(
      'tab-strip-rect',
      (e, windowId: number, rect: Electron.Rectangle) => {
        this.tabStripRects.set(windowId, rect);
      },
    );

    // 进入撕离态:把当前激活的 BrowserView 从源窗口摘下,让整窗交还 DOM,
    // 否则光标移到页面区(原生 view)后渲染层收不到 mousemove/mouseup,撕离手势会断。
    ipcMain.on('tab-drag-tearing-start', (e, windowId: number) => {
      const win = this.list.find((x) => x.id === windowId);
      const view = win?.viewManager?.selected;
      if (win && view && !view.browserView.webContents.isDestroyed()) {
        view.detachFromWindow();
      }
    });

    // 取消撕离(光标拖回标签栏后松手或继续重排):把 view 挂回去。
    ipcMain.on('tab-drag-tearing-cancel', (e, windowId: number) => {
      const win = this.list.find((x) => x.id === windowId);
      const view = win?.viewManager?.selected;
      if (win && view && !view.browserView.webContents.isDestroyed()) {
        view.attachToWindow();
        win.viewManager.fixBounds();
      }
    });

    // 松手:决定是合并进某个窗口,还是在落点生成新窗口。
    // payload: { sourceWindowId, tabId, screenX, screenY, tabState }
    ipcMain.on('tab-drag-detach', (e, payload) => {
      const {sourceWindowId, tabId, screenX, screenY, tabState} = payload;
      const source = this.list.find((x) => x.id === sourceWindowId);
      if (!source) return;

      const incognito = !!tabState.incognito;

      const target = this.hitTestTabStrip(
        screenX,
        screenY,
        sourceWindowId,
        incognito,
      );

      if (target) {
        this.mergeIntoWindow(source, target, tabId, tabState);
      } else {
        // 源窗只有一个标签时,撕离建新窗只是平移窗口,无意义 → 取消撕离,
        // 把 tearing-start 摘下的 BrowserView 挂回源窗。
        // 计数用 renderer 上报列表:views map 的幽灵 view 会让单标签误判为多标签。
        if (source.viewManager.rendererTabCount <= 1) {
          const view = source.viewManager.selected;
          if (view && !view.browserView.webContents.isDestroyed()) {
            view.attachToWindow();
            source.viewManager.fixBounds();
          }
          return;
        }
        this.detachToNewWindow(source, tabId, screenX, screenY, tabState);
      }
    });

    // 标签右键「在新窗口中打开」:无光标坐标,在源窗口右下方偏移处建新窗。
    ipcMain.on('tab-move-to-new-window', (e, payload) => {
      const {sourceWindowId, tabId, tabState} = payload;
      const source = this.list.find((x) => x.id === sourceWindowId);
      if (!source) return;
      if (source.viewManager.rendererTabCount <= 1) return; // 单标签不允许

      const b = source.win.getBounds();
      this.detachToNewWindow(
        source,
        tabId,
        b.x + 60 + 80,
        b.y + 60 + 16,
        tabState,
      );
    });
  }

  // 把一个标签从 source 合并进已存在的 target 窗口。
  private mergeIntoWindow(
    source: AppWindow,
    target: AppWindow,
    tabId: number,
    tabState: any,
  ) {
    const view = source.viewManager.detachView(tabId);
    if (!view) return;

    try {
      target.viewManager.adoptView(view, true);

      // 源渲染层移除该标签(不销毁 view);目标渲染层领养出一个标签模型。
      source.send('tab-detached-local', tabId);
      target.send('tab-adopt', {...tabState, id: tabId});
      target.win.focus();

      this.closeIfEmpty(source);
    } catch (err) {
      console.error('[tab-merge] failed, restoring to source', err);
      this.restoreToSource(source, view);
    }
  }

  // 在屏幕落点生成新窗口并把标签迁入。新窗口渲染层就绪后再领养。
  private detachToNewWindow(
    source: AppWindow,
    tabId: number,
    screenX: number,
    screenY: number,
    tabState: any,
  ) {
    const view = source.viewManager.detachView(tabId);
    if (!view) return;

    const srcBounds = source.win.getBounds();
    const bounds: Electron.Rectangle = {
      x: Math.round(screenX - 80),
      y: Math.round(screenY - 16),
      width: srcBounds.width,
      height: srcBounds.height,
    };

    let newWin: AppWindow;
    try {
      newWin = this.openAt(source.incognito, bounds);
    } catch (err) {
      console.error('[tab-tearoff] openAt failed, restoring to source', err);
      this.restoreToSource(source, view);
      return;
    }

    // 等新窗口外壳加载完成,渲染层已挂上 tab-adopt 监听器后再迁入。
    newWin.webContents.once('did-finish-load', () => {
      if (newWin.win.isDestroyed() || view.webContents.isDestroyed()) return;
      try {
        newWin.viewManager.adoptView(view, true);
        newWin.send('tab-adopt', {...tabState, id: tabId});
      } catch (err) {
        console.error('[tab-tearoff] adopt failed, restoring to source', err);
        this.restoreToSource(source, view);
      }
    });

    source.send('tab-detached-local', tabId);
    this.closeIfEmpty(source);
  }

  // 迁移失败时把 view 退回源窗口,避免源窗白屏 / view 悬空。
  private restoreToSource(source: AppWindow, view: any) {
    if (source.win.isDestroyed() || view.webContents.isDestroyed()) return;
    source.viewManager.adoptView(view, true);
    source.send('tab-adopt', {
      id: view.id,
      url: view.url,
      title: view.title,
      favicon: view.favicon,
      pinned: false,
      incognito: view.incognito,
    });
  }

  // 源窗口标签全部迁出后自动关闭。
  private closeIfEmpty(source: AppWindow) {
    if (source.viewManager.views.size === 0 && !source.win.isDestroyed()) {
      source.win.close();
      return;
    }
    // 同步检查时 renderer 的空列表上报可能仍在途(其到达后 reconcile 才销毁
    // 幽灵 view)。延迟复检一次:若届时 views 已清空(真实迁出完成、幽灵已对账),
    // 仍按空窗口关闭,避免泄漏。
    setTimeout(() => {
      if (
        !source.win.isDestroyed() &&
        source.viewManager.views.size === 0
      ) {
        source.win.close();
      }
    }, 1500).unref?.();
  }

  // 最后一个浏览器窗口关闭后退出整个应用。
  // 不能只依赖 window-all-closed:运行期间会创建多个辅助 BrowserWindow(白屏覆盖层
  // /扩展 popup/媒体播放器/登录窗等),它们常被 hide() 而非 destroy()。主窗口关了
  // 这些隐藏窗口仍在 → window-all-closed 永不触发 → 主进程残留 → 单例锁
  // requestSingleInstanceLock 不释放 → 下次点图标启动 gotTheLock=false 秒退
  // (现象:首个标签页打不开、菜单点击无效——用户看到的是已卡死的残留旧实例)。
  // 先 destroy 所有辅助窗口(绕过它们 close 里的 preventDefault),再 quit。
  private quitIfNoBrowserWindows() {
    const left = this.list.filter((x) => x && !x.win.isDestroyed());
    if (left.length > 0) return; // 还有其他浏览器窗口(多窗口场景),不退出

    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        try {
          w.destroy();
        } catch {
          // 单个窗口销毁失败不阻断退出
        }
      }
    }
    app.quit();

    // 退出看门狗:正常情况下 app.quit() 会终止整个进程树,下面的定时器随进程一起消失、
    // 永不触发。但若某个残留资源(隐藏辅助窗/未 destroy 的 webContents/被 preventDefault
    // 的 before-quit)卡住优雅退出,进程会留存——用户表现为「关了窗口进程还在」。此时
    // 4s 后仍存活则打一份 [mem] 定位残留,再 app.exit(0) 硬终止,确保不残留、单例锁释放。
    setTimeout(() => {
      try {
        console.log('[mem] 关窗后 4s 仍存活,优雅退出被卡住,强制终止。残留进程:');
        dumpMemoryReport('退出卡住');
      } catch {
        // 诊断失败不影响硬退出
      }
      app.exit(0);
    }, 4000).unref?.();
  }

  private waitForRenderer(window: AppWindow) {
    const contents = window.webContents;
    if (!contents.isLoadingMainFrame() && contents.getURL()) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out while creating extension window'));
      }, 10000);
      timeout.unref?.();

      const cleanup = () => {
        clearTimeout(timeout);
        contents.removeListener('did-finish-load', onReady);
        contents.removeListener('render-process-gone', onGone);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onGone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
        cleanup();
        reject(new Error(`Extension window renderer exited: ${details.reason}`));
      };

      contents.once('did-finish-load', onReady);
      contents.once('render-process-gone', onGone);
    });
  }

  private extensionWindowBounds(details: chrome.windows.CreateData) {
    const reference =
      this.lastFocused?.win && !this.lastFocused.win.isDestroyed()
        ? this.lastFocused.win.getBounds()
        : this.current?.win && !this.current.win.isDestroyed()
          ? this.current.win.getBounds()
          : {x: 80, y: 80, width: 900, height: 600};
    const popup = details.type === 'popup' || details.type === 'panel';

    return {
      x: Math.round(details.left ?? reference.x + 24),
      y: Math.round(details.top ?? reference.y + 24),
      width: Math.round(details.width ?? (popup ? 500 : reference.width)),
      height: Math.round(details.height ?? (popup ? 650 : reference.height)),
    };
  }

  /** Create the distinct browser window required by chrome.windows.create. */
  public async openForExtension(
    details: chrome.windows.CreateData,
    forceIncognito = false,
  ): Promise<BrowserWindow> {
    const requestedTabId = details.tabId;
    const source =
      requestedTabId === undefined
        ? undefined
        : this.list.find((window) => window.viewManager.getById(requestedTabId));
    if (requestedTabId !== undefined && !source) {
      throw new Error(`No tab with id: ${requestedTabId}`);
    }

    const incognito = forceIncognito || details.incognito === true;
    if (source && source.incognito !== incognito) {
      throw new Error('Tabs cannot be moved between normal and incognito windows');
    }

    const previouslyFocused = this.lastFocused || this.current;
    const popup = details.type === 'popup' || details.type === 'panel';
    const bounds = this.extensionWindowBounds(details);
    // The host currently renders popup/panel windows through the regular app
    // shell. Preserve Chrome's lifecycle, sizing and reported type even though
    // the chrome-less popup presentation is an application-level concern.
    const window = this.openAt(incognito, bounds, {
      focused: details.focused !== false,
      minimumSize: popup ? {width: 100, height: 100} : {width: 800, height: 450},
      persistWindowState: false,
    });
    (window.win as any).__crxWindowType = details.type || 'normal';
    (window.win as any).__crxExtensionCreated = true;

    try {
      await this.waitForRenderer(window);

      if (source && requestedTabId !== undefined) {
        const view = source.viewManager.detachView(requestedTabId);
        if (!view) throw new Error(`No tab with id: ${requestedTabId}`);
        try {
          window.viewManager.adoptView(view, false);
          window.viewManager.select(view.id, false);
          source.send('tab-detached-local', view.id);
          window.send('tab-adopt', {
            id: view.id,
            url: view.url,
            title: view.title,
            favicon: view.favicon,
            pinned: false,
            incognito: view.incognito,
          });
          this.closeIfEmpty(source);
        } catch (error) {
          this.restoreToSource(source, view);
          throw error;
        }
      } else {
        const urls = Array.isArray(details.url)
          ? details.url
          : details.url
            ? [details.url]
            : [getWebUIURL('newtab')];
        urls.forEach((url, index) => {
          window.viewManager.create(
            {
              url,
              // Chrome creates each URL as an active tab in sequence, leaving
              // the final URL selected once the batch is complete.
              active: index === urls.length - 1,
              openerTabId: (details as any).__openerTabId,
            } as chrome.tabs.CreateProperties,
            false,
            true,
            (details as any).__openerTabId,
          );
        });
      }

      switch (details.state) {
        case 'minimized':
          window.win.minimize();
          break;
        case 'maximized':
          window.win.maximize();
          break;
        case 'fullscreen':
          window.win.setFullScreen(true);
          break;
      }

      if (details.focused === false) {
        previouslyFocused?.showAndFocus();
      } else if (details.state !== 'minimized') {
        window.showAndFocus();
      }
      return window.win;
    } catch (error) {
      if (!window.win.isDestroyed()) window.win.destroy();
      throw error;
    }
  }

  private registerWindowLifecycle(window: AppWindow) {
    window.win.on('focus', () => {
      this.lastFocused = window;
    });

    // AppWindow/功能模块还会注册自己的 closed 清理。放在队首，保证即使后续
    // 某个监听器抛错，窗口登记和最后实例退出也已经完成。
    window.win.prependOnceListener('closed', () => {
      this.tabStripRects.delete(window.id);
      Application.instance.workspaces?.unbindWindow(window.id);
      this.list = this.list.filter((item) => item !== window);
      const fallback = this.list.find((item) => !item.win.isDestroyed());
      if (this.current === window) this.current = fallback;
      if (this.lastFocused === window) this.lastFocused = fallback;

      if (window.incognito && !this.list.some((item) => item.incognito)) {
        Application.instance.sessions.endIncognitoSession().catch((error) => {
          console.error('[incognito] cleanup failed', error);
        });
      }
      this.quitIfNoBrowserWindows();
    });
  }

  public open(
    incognito = false,
    initialUrl?: string,
    restoreSessionWithInitialUrl = false,
  ) {
    const window = new AppWindow(
      incognito,
      undefined,
      initialUrl,
      undefined,
      restoreSessionWithInitialUrl,
    );
    this.list.push(window);

    if (incognito) {
      Application.instance.sessions.loadIncognitoExtensions().catch((error) => {
        console.error('[incognito] load extensions failed', error);
      });
    }

    if (process.env.ENABLE_EXTENSIONS) {
      //extensions.windows.observe(window.win);
    }

    this.registerWindowLifecycle(window);

    return window;
  }

  // 在指定屏幕坐标生成一个新窗口(标签撕离落点)。返回的窗口尚未就绪,
  // 调用方需等待其渲染层 ready 后再 adoptView / adopt-tab。
  public openAt(
    incognito: boolean,
    bounds: Electron.Rectangle,
    options: ExtensionWindowHostOptions = {},
  ) {
    const window = new AppWindow(
      incognito,
      bounds,
      undefined,
      undefined,
      false,
      options.focused !== false,
      options.minimumSize,
      options.persistWindowState !== false,
    );
    this.list.push(window);

    if (incognito) {
      Application.instance.sessions.loadIncognitoExtensions().catch((error) => {
        console.error('[incognito] load extensions failed', error);
      });
    }

    this.registerWindowLifecycle(window);

    return window;
  }

  // 工作区窗口使用工作区快照作为唯一启动来源,不读取普通窗口的 startupTabs。
  public openWorkspace(workspace: IWorkspace) {
    const window = new AppWindow(false, undefined, undefined, workspace);
    this.list.push(window);
    Application.instance.workspaces?.bindWindow(workspace.id, window.id);

    this.registerWindowLifecycle(window);

    return window;
  }

  // 命中检测:给定屏幕坐标,返回标签栏覆盖该点的窗口(排除 excludeWindowId)。
  // incognito 必须一致才允许合并(无痕与普通会话隔离)。
  // tabStripRects 存的是「窗口内容坐标系」矩形,这里结合窗口内容位置换算到屏幕。
  public hitTestTabStrip(
    screenX: number,
    screenY: number,
    excludeWindowId: number,
    incognito: boolean,
  ): AppWindow | null {
    for (const win of this.list) {
      if (win.id === excludeWindowId) continue;
      if (win.incognito !== incognito) continue;
      if (win.win.isDestroyed() || win.win.isMinimized()) continue;

      const rect = this.tabStripRects.get(win.id);
      if (!rect) continue;

      const cb = win.win.getContentBounds();
      const x0 = cb.x + rect.x;
      const y0 = cb.y + rect.y;

      if (
        screenX >= x0 &&
        screenX <= x0 + rect.width &&
        screenY >= y0 &&
        screenY <= y0 + rect.height
      ) {
        return win;
      }
    }
    return null;
  }

  public findByBrowserView(webContentsId: number) {
    return this.list.find((x) =>
      !!x.viewManager.findViewByWebContentsId(webContentsId),
    );
  }

  public fromBrowserWindow(browserWindow: BrowserWindow) {
    return this.list.find((x) => x.id === browserWindow.id);
  }

  public broadcast(channel: string, ...args: unknown[]) {
    this.list.forEach((appWindow) =>
      appWindow.win.webContents.send(channel, ...args),
    );
  }

  public broadcastHomepageItems(items: any[]) {
    this.list.forEach((appWindow) => {
      appWindow.viewManager.views.forEach((view) => {
        const url = view.webContents.getURL();
        if (url.startsWith(`${WEBUI_BASE_URL}newtab`)) {
          view.webContents.send('homepage-items', items);
        }
      });
    });
  }
}
