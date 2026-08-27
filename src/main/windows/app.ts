import {BrowserView, BrowserWindow, app, dialog, screen, nativeImage, nativeTheme} from 'electron';
import {activeProfileName} from '../bootstrap-paths';
import {writeFileSync, readFileSync, promises} from 'fs';
import {resolve, join} from 'path';
import { pathToFileURL } from 'url';

import {getPath} from '~/utils';
import {buildKoodoReaderUrl, filePathFromFileUrl} from '~/constants/files';
import {getWebUIURL} from '~/common/webui-main';
import {resolveInternalFlagsUrl} from '~/common/internal-flags';
import {runMessagingService} from '../services/messaging';
import {Application} from '../application';
import {isNightly} from '..';
import {ViewManager} from '../view-manager';
import {ISettings, IWorkspace} from '~/interfaces';
import {PopupView} from "~/main/dialogs/popup";
// 开源版：AI 面板 / 订阅面板已移除。
import {SidePanelManager} from '../side-panel/side-panel-manager';
import {SecondarySearchPanelManager} from '../secondary-search/secondary-search-manager';
import {SidebarResizer} from '../sidebar/sidebar-resizer';
import {attachWhiteScreenDetector} from '../whitescreen-detector';
import {ensureIncognitoIcon, INCOGNITO_AUMID} from '../services/incognito-icon';
import {performClearOnExit, ClearItems} from '../services/clear-on-exit';
import {consumePendingPageClose} from '../page-close-guard';
import {RightGestureOverlay} from './right-gesture-overlay';
import {startupMark, startupTimer} from '../timing';
import {TrackedIpcMain} from '../services/tracked-ipc';
import {
  getWindowStateFileNames,
  loadWindowState,
  PersistedWindowState,
} from '../window-state';

const STARTUP_LIGHT_BG = '#ffffff';
const STARTUP_DARK_BG = '#1c1c1c';
const IMMERSIVE_HEADER_TRIGGER_HEIGHT = 3;
// 悬停检测改由主进程绝对游标轮询驱动(替换 overlay 的 DOM mouseenter/leave:透明
// 置顶窗 resize 会反馈幽灵 mouse 事件 → 偶发显隐闪烁)。触发带比 3px 窗更宽,更好命中。
const IMMERSIVE_HOVER_POLL_MS = 70;
const IMMERSIVE_TRIGGER_BAND = 6;
// renderer 测量期间用于扩大悬停保持区；不会直接用于撑开或显示 overlay。
// 首次使用默认值，测量成功后由真实头部高度覆盖。
const IMMERSIVE_HEADER_WAKE_HEIGHT = 160;
const IMMERSIVE_HEADER_WAKE_TIMEOUT_MS = 1000;
const IMMERSIVE_DEBUG_TOP_BAND = 24;
const IMMERSIVE_PAGE_INDICATOR_ID = '__rainseeImmersivePageIndicator';
const INSTALL_IMMERSIVE_PAGE_INDICATOR = `(() => {
  const id = '${IMMERSIVE_PAGE_INDICATOR_ID}';
  let indicator = document.getElementById(id);
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = id;
    indicator.setAttribute('aria-hidden', 'true');
    indicator.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'top:0', 'left:50%',
      'width:84px', 'height:6px', 'transform:translateX(-50%)',
      'box-sizing:border-box', 'pointer-events:none',
      'border:1px solid rgba(255,255,255,.78)', 'border-top:0',
      'border-radius:0 0 5px 5px', 'background:rgba(255,255,255,.56)',
      'box-shadow:0 1px 5px rgba(0,0,0,.14)',
      'backdrop-filter:blur(14px)', '-webkit-backdrop-filter:blur(14px)',
    ].join(';');
    (document.documentElement || document.body).appendChild(indicator);
  }
})()`;
const REMOVE_IMMERSIVE_PAGE_INDICATOR = `(() => {
  document.getElementById('${IMMERSIVE_PAGE_INDICATOR_ID}')?.remove();
})()`;
const F11_IMMERSIVE_TOAST_MESSAGE = '已开启浸润浏览，再次按F11退出';

const logImmersiveHeader = (...args: any[]) => {
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.DEBUG_IMMERSIVE_HEADER === '1'
  ) {
    console.log('[immersive-header]', ...args);
  }
};

const getStartupThemeSource = (): 'system' | 'dark' | 'light' => {
  try {
    const raw = readFileSync(getPath('settings.json'), 'utf8');
    const settings = JSON.parse(raw) as Partial<ISettings>;
    if (settings.themeAuto === false) {
      return settings.theme === 'wexond-dark' ? 'dark' : 'light';
    }
  } catch (e) {
    // ignore and fall back to system theme
  }

  return 'system';
};

const getStartupBackgroundColor = () => {
  const themeSource = getStartupThemeSource();

  if (nativeTheme.themeSource !== themeSource) {
    nativeTheme.themeSource = themeSource as any;
  }

  const dark =
    themeSource === 'dark' ||
    (themeSource === 'system' && nativeTheme.shouldUseDarkColors);

  return dark ? STARTUP_DARK_BG : STARTUP_LIGHT_BG;
};

export class AppWindow {
  public win: BrowserWindow;

  public viewManager: ViewManager;

  public sidePanels: SidePanelManager;
  public secondarySearchPanels: SecondarySearchPanelManager;

  // 标签页侧边栏与网页内容之间的拖拽条(调节 sidebarWidth)。
  public sidebarResizer: SidebarResizer;

  public incognito: boolean;
  public workspace: IWorkspace | null = null;
  public popup: PopupView;

  // SW keep-alive release handle for popups opened via showExtensionPopup.
  // Mirrors vendor BrowserActionAPI.prewarmPopupServiceWorker: the worker is
  // warmed (startWorkerForScope) before the popup opens so the MV3 service
  // worker takes the normal-start path and its registered service-worker
  // preload re-injects (Electron skips preload re-injection on a passive,
  // popup-triggered wake-up, leaving globalThis.electron undefined). Released
  // when the popup is destroyed / replaced.
  private popupWorkerRelease?: () => void;
  // Prevent overlapping async popup launches from creating two BrowserViews
  // when duplicate toolbar IPC events arrive during SW prewarm.
  private popupLaunchToken = 0;

  // 标签撕离生成的新窗口:渲染层应跳过默认新标签页加载,改为领养被撕离的标签。
  public pendingDetach = false;

  // 由外部请求打开的初始 URL(如右键「在新窗口打开链接」)。新窗口的 startup-tabs
  // 会优先打开它,而非默认 newtab,避免与 create-tab 的 select 竞争。
  public initialUrl?: string;

  // 冷启动外部文件时既立即打开目标页,又继续恢复普通会话。应用内“在新窗口
  // 打开”仍以 initialUrl 作为该窗口唯一初始页。
  public restoreSessionWithInitialUrl = false;

  // 手动拖拽时锁定的 normal 尺寸。will-resize 只放行这个宽高,防止窗口移动到
  // 屏幕边缘后被 Aero Snap 再次撑成最大化或半屏。
  public suppressResize: {width: number; height: number} | null = null;

  private windowDataPath = '';
  private windowDataFallbackPath = '';

  private minimumWidth = 800;
  private minimumHeight = 450;
  private initiallyFocused = true;
  private persistWindowStateEnabled = true;

  private windowState: PersistedWindowState = {};

  private saveTimer: any = null;
  // 沉浸头部必须和页面弹窗处在同一 BrowserView z 序中：页面弹窗后挂载即可
  // 自然覆盖头部。独立 BrowserWindow 无法被主窗的 BrowserView 弹窗越过。
  private immersiveHeaderView: BrowserView | null = null;
  private immersiveHeaderAttached = false;
  private immersiveHeaderHeight = IMMERSIVE_HEADER_TRIGGER_HEIGHT;
  private immersiveHeaderExpandedHeight = IMMERSIVE_HEADER_WAKE_HEIGHT;
  private immersiveHeaderBackgroundColor = STARTUP_LIGHT_BG;
  private immersiveHeaderWaking = false;
  private immersiveHeaderWakeTimer: any = null;
  private immersiveHeaderEnabled = false;
  private immersivePageIndicatorViewId = 0;
  private immersiveBrowsingEnabledByF11 = false;
  private immersiveTriggerArmed = false;
  // 游标轮询表 + 最近一次下发的悬停态(仅变化时下发,避免刷屏)。
  private immersiveHoverTimer: any = null;
  private immersiveHovering = false;
  private immersiveNearTop = false;
  private immersiveLastBlockReason = '';

  private rightGestureOverlay: RightGestureOverlay | null = null;
  private rightGestureContextMenuSuppressionUntil = 0;

  // === 退出时自动清理 ===
  // close 事件触发后异步清理期间为 true;完成或放弃后保持 true 以防重入。
  private clearOnExitInProgress = false;
  // 清理已完成(无论成功/失败/超时)→ close 事件跳过清理分支直接走销毁。
  private clearOnExitFinished = false;
  private ipc = new TrackedIpcMain();
  // 供 before-quit await:清理过程中用户再 Alt+F4 时,退出流程会等本 promise。
  private clearOnExitDoneResolve!: () => void;
  public clearOnExitDonePromise: Promise<void> = new Promise((resolve) => {
    this.clearOnExitDoneResolve = resolve;
  });

  public constructor(
    incognito: boolean,
    initialBounds?: Electron.Rectangle,
    initialUrl?: string,
    workspace?: IWorkspace,
    restoreSessionWithInitialUrl = false,
    initiallyFocused = true,
    minimumSize: {width: number; height: number} = {width: 800, height: 450},
    persistWindowState = true,
  ) {
    const constructorTimer = startupTimer();
    startupMark('main.app_window.constructor.begin', {
      incognito,
      initialUrl: !!initialUrl,
      detached: !!initialBounds,
    });
    this.pendingDetach = !!initialBounds;
    this.initialUrl = initialUrl;
    this.restoreSessionWithInitialUrl = restoreSessionWithInitialUrl;
    this.workspace = workspace || null;
    this.initiallyFocused = initiallyFocused;
    this.minimumWidth = minimumSize.width;
    this.minimumHeight = minimumSize.height;
    this.persistWindowStateEnabled = persistWindowState;
    const windowStateFiles = getWindowStateFileNames(incognito);
    this.windowDataPath = getPath(windowStateFiles.primary) || '';
    this.windowDataFallbackPath = windowStateFiles.fallback
      ? getPath(windowStateFiles.fallback) || ''
      : '';
    const startupBackgroundColor = incognito
      ? STARTUP_DARK_BG
      : getStartupBackgroundColor();
    const tabsLayout = Application.instance.settings.object.tabsLayout;
    const trafficLightPosition =
      process.platform !== 'darwin'
        ? null
        : {
            x: 14,
            y: tabsLayout === 'right' ? 26 : 19,
          };
    const browserWindowTimer = startupTimer();
    startupMark('main.browser_window.construct.begin');
    this.win = new BrowserWindow({
      frame: false,
      minWidth: this.minimumWidth,
      minHeight: this.minimumHeight,
      width: 900,
      height: 600,
      titleBarStyle: 'hiddenInset',
      ...(trafficLightPosition ? {trafficLightPosition} : {}),
      backgroundColor: startupBackgroundColor,
      webPreferences: {
        plugins: true,
        // TODO: enable sandbox, contextIsolation and disable nodeIntegration to improve security
        nodeIntegration: true,
        allowRunningInsecureContent: true,
        webSecurity: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        enableWebSQL: false,
        contextIsolation: false,
        javascript: true,
        //sandbox: false,
        // TODO: get rid of the remote module in renderers
        enableRemoteModule: true,
        worldSafeExecuteJavaScript: true,
      },
      icon: incognito
        ? ensureIncognitoIcon().pngPath
        : resolve(
            app.getAppPath(),
            `static/${isNightly ? 'nightly-icons' : 'icons'}/icon.png`,
          ),
      show: false,
    });
    this.win.once('closed', () => this.ipc.dispose());
    startupMark('main.browser_window.construct.end', {
      durationMs: browserWindowTimer(),
      windowId: this.win.id,
    });
    this.win.webContents.once('dom-ready', () => {
      startupMark('main.window_shell.dom_ready', {windowId: this.win.id});
    });
    this.win.webContents.once('did-finish-load', () => {
      startupMark('main.window_shell.did_finish_load', {windowId: this.win.id});
    });
    require("@electron/remote/main").enable(this.win.webContents);

    // 无痕窗口拿独立 AUMID + 独立任务栏图标 → 与主程序分开成两个任务栏按钮,
    // 用户可右键该按钮用 Windows 自带「固定到任务栏」钉住,点击即进无痕。
    // 注意:BrowserWindow 没有 setAppUserModelId 方法,正确 API 是 Windows 专属的
    // setAppDetails(appId 即 AppUserModelID)。须在 show 之前调用(本窗 show 在下方
    // ready-to-show),任务栏按钮首次出现时即带正确身份。
    if (incognito && process.platform === 'win32') {
      try {
        this.win.setAppDetails({
          appId: INCOGNITO_AUMID,
          appIconPath: ensureIncognitoIcon().icoPath,
          appIconIndex: 0,
        });
      } catch (e) {
        console.error('[incognito] setAppDetails failed', e);
      }
    }

    // Native window visibility is the highest-priority startup milestone.
    // Apply saved bounds and show immediately; ViewManager, panels and IPC
    // wiring can finish behind the already visible solid-color shell.
    const showTimer = startupTimer();
    this.applyWindowState(initialBounds);
    startupMark('main.native_window.shown', {
      durationMs: showTimer(),
      windowId: this.win.id,
    });

    this.incognito = incognito;
    this.immersiveHeaderBackgroundColor = startupBackgroundColor;

    const viewManagerTimer = startupTimer();
    startupMark('main.view_manager.construct.begin', {windowId: this.win.id});
    this.viewManager = new ViewManager(this, incognito);
    startupMark('main.view_manager.construct.end', {
      durationMs: viewManagerTimer(),
      windowId: this.win.id,
    });
    if (this.initialUrl) {
      // Start local-file/Koodo navigation while app.html is still loading.
      // The renderer later adopts this View through its normal views-create IPC.
      const initialViewTimer = startupTimer();
      startupMark('main.initial_view.precreate.begin', {windowId: this.win.id});
      this.viewManager.precreateInitialView(this.initialUrl);
      startupMark('main.initial_view.precreate.end', {
        durationMs: initialViewTimer(),
        windowId: this.win.id,
      });
    }
    // 暗色加载时内容 BrowserView 会暂时分离，内容区输入随之落到主窗口。
    // 将这段输入转给当前标签的同一个原生手势状态机，保证整个导航周期都可用。
    const onLoadingAreaMouse = (
      event: Electron.Event,
      mouse: Electron.MouseInputEvent,
    ) => {
      const selected = this.viewManager.selected;
      const bounds = this.viewManager.contentBounds || selected?.bounds;
      if (!selected?.isLoadingHidden || !bounds) return;
      if (
        mouse.x < bounds.x ||
        mouse.y < bounds.y ||
        mouse.x >= bounds.x + bounds.width ||
        mouse.y >= bounds.y + bounds.height
      ) {
        return;
      }
      const update = selected.handleNativeRightMouseEvent(event, mouse, bounds);
      if (update) {
        this.updateRightGestureOverlay(update, bounds);
      }
    };
    const onRightGestureContextMenu = (event: Electron.Event) => {
      if (!this.consumeRightGestureContextMenuSuppression()) return;
      event.preventDefault();
      console.log('[right-gesture] suppressed main-window context menu');
    };
    const mainWebContents = this.win.webContents;
    this.win.webContents.on('before-mouse-event', onLoadingAreaMouse);
    this.win.webContents.on('context-menu', onRightGestureContextMenu);
    this.win.once('closed', () => {
      // BrowserWindow.closed 时再读取 this.win.webContents 会直接抛
      // "Object has been destroyed"，并中断后续 closed 监听器（包括最终退出）。
      // 提前保留 WebContents 引用，所有清理各自兜底，不能阻断窗口生命周期。
      try {
        this.rightGestureOverlay?.destroy();
        this.rightGestureOverlay = null;
      } catch (error) {
        console.error('[right-gesture] overlay cleanup failed', error);
      }
      if (!mainWebContents.isDestroyed()) {
        mainWebContents.removeListener(
          'before-mouse-event',
          onLoadingAreaMouse,
        );
        mainWebContents.removeListener(
          'context-menu',
          onRightGestureContextMenu,
        );
      }
    });

    const infrastructureTimer = startupTimer();
    startupMark('main.window_infrastructure.begin', {windowId: this.win.id});
    this.sidePanels = new SidePanelManager(this);

    this.secondarySearchPanels = new SecondarySearchPanelManager(this);

    this.sidebarResizer = new SidebarResizer(this);

    // 拖拽主窗口期间抑制 Snap:最大化起步时 getNormalBounds 仍能拿到还原尺寸,
    // 因此 unmaximize 会被放行,其他改变宽高的最大化/半屏吸附会被阻止。
    this.win.on('will-resize', (_e, newBounds) => {
      if (!this.suppressResize) return;
      if (
        Math.abs(newBounds.width - this.suppressResize.width) > 4 ||
        Math.abs(newBounds.height - this.suppressResize.height) > 4
      ) {
        _e.preventDefault();
      }
    });
    const dragResizeChannel = `window-drag-resize-suppress-${this.win.id}`;
    const onDragResizeSuppress = (_e: Electron.IpcMainEvent, on: boolean) => {
      if (!on) {
        this.suppressResize = null;
        return;
      }
      const {width, height} = this.win.getNormalBounds();
      this.suppressResize = {width, height};
    };
    this.ipc.on(dragResizeChannel, onDragResizeSuppress);
    this.win.once('closed', () => {
      this.suppressResize = null;
    });

    runMessagingService(this);

    if (process.env.ENABLE_EXTENSIONS) {
      this.ipc.on(`show-extension-popup-${this.id}`, (e, left, top, url, inspect, extensionId) => {
        console.log(`[action-click] show-extension-popup extId=${extensionId} url=${JSON.stringify(url)} inspect=${inspect} left=${left} top=${top}`);
        this.showExtensionPopup(left, top, url, inspect, extensionId);
      });
    }

    this.ipc.on(`immersive-header-enabled-${this.id}`, (_e, enabled: boolean) => {
      logImmersiveHeader(this.id, 'enabled', enabled);
      this.immersiveHeaderEnabled = enabled;
      if (!enabled) {
        this.destroyImmersiveHeaderView();
      }
      this.syncImmersivePageIndicator();

      // 该消息由 TopLayout 的 effect 在头部 DOM 完成挂载/卸载后发出。
      // 在这个确定的切换点主动重算 BrowserView 边界，避免仅依赖
      // ResizeObserver/resize-height 的异步通知：关闭沉浸时若通知早于头部挂载
      // 或被相邻布局刷新覆盖，网页 view 仍会占满窗口并盖住刚恢复的标签栏，
      // 直到后续窗口 resize/切换标签才重新显示。
      this.viewManager
        .fixBounds()
        .then(() => {
          if (this.immersiveHeaderEnabled !== enabled || this.win.isDestroyed()) {
            return;
          }

          if (enabled) this.ensureImmersiveHeaderView();

          const selected = this.viewManager.selected;
          if (selected && !selected.webContents.isDestroyed()) {
            selected.webContents.focus();
          }
        })
        .catch((error) => {
          console.error('[immersive-header] failed to refresh view bounds', error);
        });
    });

    this.ipc.on(`immersive-header-height-${this.id}`, (_e, height: number) => {
      logImmersiveHeader(this.id, 'ipc height', height);
      this.setImmersiveHeaderHeight(height);
    });

    this.ipc.on(`immersive-page-indicator-sync-${this.id}`, () => {
      this.syncImmersivePageIndicator();
    });

    this.ipc.on(`immersive-header-metrics-${this.id}`, (_e, metrics: any) => {
      const overlay = this.immersiveHeaderView;
      const height = Number(metrics?.height);
      if (
        Number.isFinite(height) &&
        height > IMMERSIVE_HEADER_TRIGGER_HEIGHT &&
        height < 1000
      ) {
        this.immersiveHeaderExpandedHeight = Math.round(height);
      }

      const backgroundColor = metrics?.backgroundColor;
      if (typeof backgroundColor === 'string' && backgroundColor.trim()) {
        this.immersiveHeaderBackgroundColor = backgroundColor;
        if (overlay && !overlay.webContents.isDestroyed()) {
          overlay.setBackgroundColor(backgroundColor);
        }
      }
    });

    // 主渲染进程 → overlay:全量标签快照(单一数据源镜像)。不能用 this.send()
    // ——它同时发主窗 + overlay 会自环。
    this.ipc.on(`immersive-header-sync-${this.id}`, (_e, snapshot: any) => {
      const overlay = this.immersiveHeaderView;
      if (overlay && !overlay.webContents.isDestroyed()) {
        overlay.webContents.send('immersive-header-sync', snapshot);
      }
    });

    // overlay → 主渲染进程:标签操作遥控(select/close/new)与挂载握手拉首帧。
    this.ipc.on(`immersive-header-cmd-${this.id}`, (_e, cmd: any) => {
      if (!this.win.isDestroyed()) {
        this.webContents.send('immersive-header-cmd', cmd);
      }
    });
    this.ipc.on(`immersive-header-request-sync-${this.id}`, () => {
      if (!this.win.isDestroyed()) {
        this.webContents.send('immersive-header-request-sync');
      }
    });

    startupMark('main.window_infrastructure.end', {
      durationMs: infrastructureTimer(),
      windowId: this.win.id,
    });
    const initTimer = startupTimer();
    startupMark('main.window_load.dispatch.begin', {windowId: this.win.id});
    this.initWin(incognito);
    startupMark('main.window_load.dispatch.end', {
      durationMs: initTimer(),
      windowId: this.win.id,
    });
    startupMark('main.app_window.constructor.end', {
      durationMs: constructorTimer(),
      windowId: this.win.id,
    });
  }

  public updateTrafficLightPosition(tabsLayout: ISettings['tabsLayout']) {
    if (process.platform !== 'darwin' || this.win.isDestroyed()) return;

    this.win.setWindowButtonPosition(
      {
        x: 14,
        y: tabsLayout === 'right' ? 24 : 19,
      },
    );
  }

  // 应用持久化的窗口状态(尺寸/位置/最大化/全屏)并立即显示窗口。
  // initialBounds 存在时(标签撕离生成的新窗)优先使用它,忽略磁盘保存的状态。
  // 关键:在 show 之前完成 setBounds/maximize,避免出现"默认 900x600 → 最终尺寸/最大化"
  // 的一帧闪烁;show 紧跟其后,窗口外壳以 backgroundColor 立即可见,不再等 app.html 渲染。
  private applyWindowState(initialBounds?: Electron.Rectangle) {
    if (this.persistWindowStateEnabled) {
      this.windowState = loadWindowState([
        this.windowDataPath,
        this.windowDataFallbackPath,
      ]);
    } else {
      this.windowState = {};
    }

    if (initialBounds) {
      const bounds = this.sanitizeBounds(initialBounds);
      if (bounds) {
        this.windowState.bounds = bounds;
        this.win.setBounds(bounds);
      }
    } else {
      // 还原非全屏/非最大化时的窗口位置与大小,并裁剪到屏幕范围内。
      const bounds = this.sanitizeBounds(this.windowState.bounds);
      if (bounds) {
        this.windowState.bounds = bounds;
        this.win.setBounds(bounds);
      }

      if (this.windowState.maximized) {
        this.win.maximize();
      }
      if (this.windowState.fullscreen) {
        this.win.setFullScreen(true);
      }
    }

    if (this.initiallyFocused) {
      this.win.show();
    } else {
      this.win.showInactive();
    }
  }

  // 需求3：上次保存的宽/高若溢出当前屏幕，把对应的边缩小到屏幕（工作区）尺寸，
  // 并保证窗口左上角仍位于可见区域内（处理分辨率变化、外接屏被拔出等情况）。
  private sanitizeBounds(
    bounds?: Electron.Rectangle,
  ): Electron.Rectangle | null {
    if (
      !bounds ||
      typeof bounds.width !== 'number' ||
      typeof bounds.height !== 'number'
    ) {
      return null;
    }

    // 取与上次窗口重叠最多的显示器（多屏安全；窗口完全离屏时返回最近的一个）。
    const {workArea} = screen.getDisplayMatching(bounds);

    const width = Math.max(
      this.minimumWidth,
      Math.min(bounds.width, workArea.width),
    );
    const height = Math.max(
      this.minimumHeight,
      Math.min(bounds.height, workArea.height),
    );

    let x = typeof bounds.x === 'number' ? bounds.x : workArea.x;
    let y = typeof bounds.y === 'number' ? bounds.y : workArea.y;

    // 缩小尺寸后，确保窗口整体仍落在工作区内。
    x = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width);
    y = Math.min(
      Math.max(y, workArea.y),
      workArea.y + workArea.height - height,
    );

    return {x, y, width, height};
  }

  // 需求2：仅在普通状态（非最大化/全屏/最小化）下记录宽高与左上角坐标。
  private updateBounds = () => {
    if (
      !this.win.isMaximized() &&
      !this.win.isFullScreen() &&
      !this.win.isMinimized()
    ) {
      this.windowState.bounds = this.win.getBounds();
    }
  };

  // 需求1：连同最大化/全屏状态一起持久化到磁盘。
  private persistWindowState = (sync = false) => {
    if (!this.persistWindowStateEnabled) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    if (!this.win || this.win.isDestroyed()) return;

    this.windowState.maximized = this.win.isMaximized();
    this.windowState.fullscreen = this.win.isFullScreen();

    const data = JSON.stringify(this.windowState);
    if (sync) {
      try {
        writeFileSync(this.windowDataPath, data);
      } catch (e) {
        // ignore
      }
    } else {
      promises.writeFile(this.windowDataPath, data).catch(() => {});
    }
  };

  // resize/move 期间防抖写盘，避免异常退出时丢失最新尺寸。
  private scheduleSave = () => {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persistWindowState();
    }, 500);
  };

  private buildImmersiveHeaderUrl() {
    if (process.env.NODE_ENV === 'development') {
      const url = `http://localhost:4444/app.html?immersiveHeader=1&sourceWindowId=${this.id}`;
      logImmersiveHeader(this.id, 'build url', url);
      return url;
    }

    const url = pathToFileURL(join(app.getAppPath(), 'build', 'app.html'));
    url.searchParams.set('immersiveHeader', '1');
    url.searchParams.set('sourceWindowId', String(this.id));
    logImmersiveHeader(this.id, 'build url', url.href);
    return url.href;
  }

  private syncImmersiveHeaderBounds() {
    const overlay = this.immersiveHeaderView;
    if (!overlay || overlay.webContents.isDestroyed() || this.win.isDestroyed()) {
      return;
    }

    const {width} = this.win.getContentBounds();
    overlay.setBounds({
      x: 0,
      y: 0,
      width,
      height: Math.max(IMMERSIVE_HEADER_TRIGGER_HEIGHT, this.immersiveHeaderHeight),
    });
  }

  private attachImmersiveHeaderView() {
    const overlay = this.immersiveHeaderView;
    if (!overlay || overlay.webContents.isDestroyed() || this.win.isDestroyed()) {
      return;
    }

    this.syncImmersiveHeaderBounds();
    if (!this.immersiveHeaderAttached) {
      this.win.addBrowserView(overlay);
      this.immersiveHeaderAttached = true;
    }

    // 头部自己位于网页内容之上；已有弹窗随后恢复到头部之上。
    Application.instance.dialogs.bringVisibleToTop(this.win);
  }

  private detachImmersiveHeaderView() {
    const overlay = this.immersiveHeaderView;
    if (!overlay || !this.immersiveHeaderAttached || this.win.isDestroyed()) {
      this.immersiveHeaderAttached = false;
      return;
    }

    this.win.removeBrowserView(overlay);
    this.immersiveHeaderAttached = false;
  }

  // 内容 view 在切换标签、加载或浮层重挂载时会被追加到 z 序顶部。公开此方法让
  // ViewManager 在内容重新挂载后，把沉浸头部恢复到「内容之上、弹窗之下」的位置。
  public refreshImmersiveHeaderLayer() {
    if (!this.immersiveHeaderAttached || !this.immersiveHeaderView || this.win.isDestroyed()) {
      return;
    }

    this.win.removeBrowserView(this.immersiveHeaderView);
    this.win.addBrowserView(this.immersiveHeaderView);
    this.syncImmersiveHeaderBounds();
    Application.instance.dialogs.bringVisibleToTop(this.win);
  }

  public syncImmersivePageIndicator() {
    const selected =
      this.immersiveHeaderEnabled &&
      Application.instance.settings.object.immersivePageIndicator
      ? this.viewManager.selected
      : undefined;
    const previous = this.viewManager.getById(this.immersivePageIndicatorViewId);

    if (previous && previous !== selected && !previous.webContents.isDestroyed()) {
      previous.webContents
        .executeJavaScript(REMOVE_IMMERSIVE_PAGE_INDICATOR, true)
        .catch(() => undefined);
    }

    if (!selected || selected.webContents.isDestroyed()) {
      this.immersivePageIndicatorViewId = 0;
      return;
    }

    this.immersivePageIndicatorViewId = selected.id;
    selected.webContents
      .executeJavaScript(INSTALL_IMMERSIVE_PAGE_INDICATOR, true)
      .catch(() => undefined);
  }

  public toggleFullscreenFromF11() {
    const enteringFullscreen = !this.win.isFullScreen();
    const isTopTabsLayout =
      Application.instance.settings.object.tabsLayout === 'top';

    if (enteringFullscreen && isTopTabsLayout) {
      const wasImmersiveBrowsing =
        Application.instance.settings.object.immersiveBrowsing;
      this.immersiveBrowsingEnabledByF11 = !wasImmersiveBrowsing;
      if (!wasImmersiveBrowsing) {
        Application.instance.settings.updateSettings({immersiveBrowsing: true});
        setTimeout(() => this.showF11ImmersiveToast(), 120);
      }
    } else if (enteringFullscreen) {
      this.immersiveBrowsingEnabledByF11 = false;
    } else {
      const disableImmersiveBrowsing = this.immersiveBrowsingEnabledByF11;
      this.immersiveBrowsingEnabledByF11 = false;
      if (disableImmersiveBrowsing) {
        Application.instance.settings.updateSettings({immersiveBrowsing: false});
      }
    }

    this.win.setFullScreen(enteringFullscreen);
  }

  private showF11ImmersiveToast() {
    const selected = this.viewManager.selected;
    if (!selected || selected.webContents.isDestroyed()) return;

    const toast = function (message: string) {
      const id = '__rainseeImmersiveF11Toast';
      document.getElementById(id)?.remove();
      const element = document.createElement('div');
      element.id = id;
      element.textContent = message;
      element.setAttribute(
        'style',
        [
          'position:fixed', 'z-index:2147483647', 'top:20px', 'left:50%',
          'transform:translateX(-50%) translateY(-8px)', 'max-width:calc(100vw - 32px)',
          'padding:9px 16px', 'border-radius:8px', 'background:rgba(32,33,36,.92)',
          'color:#fff', 'font:13px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
          'box-shadow:0 6px 20px rgba(0,0,0,.24)', 'opacity:0', 'pointer-events:none',
          'transition:opacity .2s ease,transform .2s ease',
        ].join(';'),
      );
      (document.body || document.documentElement).appendChild(element);
      requestAnimationFrame(() => {
        element.style.opacity = '1';
        element.style.transform = 'translateX(-50%) translateY(0)';
      });
      setTimeout(() => {
        element.style.opacity = '0';
        element.style.transform = 'translateX(-50%) translateY(-8px)';
        setTimeout(() => element.remove(), 220);
      }, 2400);
    };

    selected.webContents
      .executeJavaScript(
        `(${toast.toString()})(${JSON.stringify(F11_IMMERSIVE_TOAST_MESSAGE)})`,
        true,
      )
      .catch(() => undefined);
  }

  private wakeImmersiveHeaderView() {
    const overlay = this.immersiveHeaderView;
    if (!overlay || overlay.webContents.isDestroyed()) {
      logImmersiveHeader(this.id, 'wake skipped: no overlay');
      return;
    }
    const blockReason = this.getImmersiveOverlayBlockReason();
    if (blockReason) {
      logImmersiveHeader(this.id, 'wake skipped:', blockReason);
      return;
    }
    if (this.immersiveHeaderHeight > IMMERSIVE_HEADER_TRIGGER_HEIGHT) {
      logImmersiveHeader(this.id, 'wake skipped: already expanded/waking', {
        height: this.immersiveHeaderHeight,
        visible: this.immersiveHeaderAttached,
        waking: this.immersiveHeaderWaking,
      });
      return;
    }

    logImmersiveHeader(this.id, 'wake', {
      previousHeight: this.immersiveHeaderHeight,
      measuredHeight: this.immersiveHeaderExpandedHeight,
      visible: this.immersiveHeaderAttached,
    });
    this.immersiveHeaderWaking = true;
    if (this.immersiveHeaderWakeTimer) {
      clearTimeout(this.immersiveHeaderWakeTimer);
    }
    this.immersiveHeaderWakeTimer = setTimeout(() => {
      this.immersiveHeaderWakeTimer = null;
      if (
        !this.immersiveHeaderWaking ||
        this.immersiveHeaderHeight > IMMERSIVE_HEADER_TRIGGER_HEIGHT
      ) {
        return;
      }

      logImmersiveHeader(this.id, 'wake measurement timed out');
      this.immersiveHeaderWaking = false;
      // 让下一轮轮询重新产生 hover=true 边沿并再次发起测量。
      this.immersiveHovering = false;
    }, IMMERSIVE_HEADER_WAKE_TIMEOUT_MS);
    // 先让未挂载的 renderer 展开并测量头部，收到真实高度后再挂载 BrowserView。
    // 不能用缓存/default 高度提前撑开不透明视图，否则多出的底色区域会覆盖网页，
    // 在悬浮头部下方形成一大片类似阴影的灰带。
  }

  private ensureImmersiveHeaderView() {
    if (this.immersiveHeaderView && !this.immersiveHeaderView.webContents.isDestroyed()) {
      logImmersiveHeader(this.id, 'ensure existing overlay');
      this.syncImmersiveHeaderBounds();
      this.updateImmersiveOverlayVisibility();
      this.startImmersiveHoverPoll();
      return;
    }

    logImmersiveHeader(this.id, 'create overlay');
    const overlay = new BrowserView({
      backgroundColor: this.immersiveHeaderBackgroundColor,
      webPreferences: {
        plugins: true,
        nodeIntegration: true,
        allowRunningInsecureContent: true,
        webSecurity: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        enableWebSQL: false,
        contextIsolation: false,
        javascript: true,
        enableRemoteModule: true,
        worldSafeExecuteJavaScript: true,
        backgroundThrottling: false,
      },
    });

    require("@electron/remote/main").enable(overlay.webContents);
    overlay.webContents.loadURL(this.buildImmersiveHeaderUrl());
    overlay.webContents.once('dom-ready', () => {
      if (this.immersiveHeaderView !== overlay) return;
      logImmersiveHeader(this.id, 'overlay dom-ready', {
        height: this.immersiveHeaderHeight,
        shouldShow: this.shouldShowImmersiveOverlay(),
        visible: this.immersiveHeaderAttached,
      });
      this.syncImmersiveHeaderBounds();
      if (
        this.shouldShowImmersiveOverlay() &&
        this.immersiveHeaderHeight > IMMERSIVE_HEADER_TRIGGER_HEIGHT
      ) {
        this.attachImmersiveHeaderView();
      }
    });

    this.immersiveHeaderView = overlay;
    this.immersiveHeaderAttached = false;
    // 开启瞬间若鼠标恰好位于顶边，必须先离开再重新进入才唤醒。
    // 避免 BrowserView 创建期间把设置页的后续点击截走。
    this.immersiveTriggerArmed = false;
    this.startImmersiveHoverPoll();
  }

  private getImmersiveOverlayBlockReason(): string | null {
    const overlay = this.immersiveHeaderView;
    if (!overlay || overlay.webContents.isDestroyed()) return 'overlay missing/destroyed';
    if (this.win.isDestroyed()) return 'main window destroyed';
    if (!this.win.isVisible()) return 'main window hidden';
    if (this.win.isMinimized()) return 'main window minimized';
    const focused = BrowserWindow.getFocusedWindow();
    if (focused === null) return 'no focused app window';
    if (this.viewManager && this.viewManager.fullscreen) return 'view fullscreen';
    return null;
  }

  // overlay 应否显示:主窗可见且未最小化、我方 app 在前台(切到别的 app 时
  // BrowserWindow.getFocusedWindow()===null)、且非网页
  // HTML 全屏(视频)。用于可见性绑定与游标轮询门控。
  private shouldShowImmersiveOverlay(): boolean {
    return this.getImmersiveOverlayBlockReason() === null;
  }

  // 按 shouldShow 挂载/移除 overlay。setTimeout(0) 让焦点状态先落定。
  private updateImmersiveOverlayVisibility = () => {
    setTimeout(() => {
      const overlay = this.immersiveHeaderView;
      if (!overlay || overlay.webContents.isDestroyed()) return;
      if (
        this.shouldShowImmersiveOverlay() &&
        this.immersiveHeaderHeight > IMMERSIVE_HEADER_TRIGGER_HEIGHT
      ) {
        this.syncImmersiveHeaderBounds();
        if (!this.immersiveHeaderAttached) {
          logImmersiveHeader(this.id, 'visibility show', {
            height: this.immersiveHeaderHeight,
          });
          this.attachImmersiveHeaderView();
        }
      } else if (this.immersiveHeaderAttached) {
        logImmersiveHeader(this.id, 'visibility hide', {
          height: this.immersiveHeaderHeight,
          blockReason: this.getImmersiveOverlayBlockReason(),
        });
        this.detachImmersiveHeaderView();
      }
    }, 0);
  };

  // 游标轮询:按绝对光标位置判定悬停带命中,仅在悬停态变化时下发给 overlay。
  // 彻底摆脱透明置顶窗 resize 反馈的幽灵 mouse 事件(偶发闪烁根因)。
  private startImmersiveHoverPoll() {
    if (this.immersiveHoverTimer) {
      logImmersiveHeader(this.id, 'hover poll already running');
      return;
    }
    logImmersiveHeader(this.id, 'hover poll start');
    this.immersiveHoverTimer = setInterval(() => {
      const overlay = this.immersiveHeaderView;
      if (!overlay || overlay.webContents.isDestroyed()) {
        logImmersiveHeader(this.id, 'hover poll stop: overlay missing');
        this.stopImmersiveHoverPoll();
        return;
      }
      let hovering = false;
      const pt = screen.getCursorScreenPoint();
      const b = this.win.getBounds();
      // 最大化的无边框窗口在 Windows 上可能带有屏幕外的 resize 边框坐标
      // (例如 y=-8)，必须把窗口边界裁到当前游标所在显示器的可见区域，否则
      // 顶边触发带会整个落在屏幕外。按游标选显示器也能覆盖跨屏窗口的两侧。
      const displayBounds = screen.getDisplayNearestPoint(pt).bounds;
      const visibleBounds = {
        left: Math.max(b.x, displayBounds.x),
        top: Math.max(b.y, displayBounds.y),
        right: Math.min(b.x + b.width, displayBounds.x + displayBounds.width),
      };
      const nearTop =
        pt.x >= visibleBounds.left &&
        pt.x <= visibleBounds.right &&
        pt.y >= visibleBounds.top &&
        pt.y <= visibleBounds.top + IMMERSIVE_DEBUG_TOP_BAND;

      if (!this.immersiveTriggerArmed && !nearTop) {
        this.immersiveTriggerArmed = true;
      }

      if (nearTop !== this.immersiveNearTop) {
        this.immersiveNearTop = nearTop;
        logImmersiveHeader(this.id, nearTop ? 'cursor near top' : 'cursor left top', {
          pt,
          bounds: b,
          visibleBounds,
          height: this.immersiveHeaderHeight,
          visible: this.immersiveHeaderAttached,
          focusedWindowId: BrowserWindow.getFocusedWindow()?.id || null,
        });
      }

      const blockReason = this.getImmersiveOverlayBlockReason();
      if (!blockReason && this.immersiveTriggerArmed) {
        // 折叠用较宽触发带(比 3px 窗好命中);展开用当前头部实高作「保持带」。
        const zoneH =
          this.immersiveHeaderHeight > IMMERSIVE_HEADER_TRIGGER_HEIGHT
            ? this.immersiveHeaderHeight
            : this.immersiveHeaderWaking
            ? this.immersiveHeaderExpandedHeight
            : IMMERSIVE_TRIGGER_BAND;
        hovering =
          pt.x >= visibleBounds.left &&
          pt.x <= visibleBounds.right &&
          pt.y >= visibleBounds.top &&
          pt.y <= visibleBounds.top + zoneH;
        this.immersiveLastBlockReason = '';
      } else if (nearTop && blockReason !== this.immersiveLastBlockReason) {
        this.immersiveLastBlockReason = blockReason;
        logImmersiveHeader(this.id, 'hover blocked', {
          blockReason,
          pt,
          bounds: b,
          visibleBounds,
          focusedWindowId: BrowserWindow.getFocusedWindow()?.id || null,
        });
      }
      if (hovering !== this.immersiveHovering) {
        this.immersiveHovering = hovering;
        logImmersiveHeader(this.id, 'hover change', {
          hovering,
          height: this.immersiveHeaderHeight,
          waking: this.immersiveHeaderWaking,
          visible: this.immersiveHeaderAttached,
        });
        if (hovering) this.wakeImmersiveHeaderView();
        if (!overlay.webContents.isDestroyed()) {
          logImmersiveHeader(this.id, 'send hover', hovering);
          overlay.webContents.send('immersive-header-hover', hovering);
        }
      } else if (
        hovering &&
        this.immersiveHeaderWaking
      ) {
        if (!overlay.webContents.isDestroyed()) {
          logImmersiveHeader(this.id, 'resend hover while waking');
          overlay.webContents.send('immersive-header-hover', true);
        }
      }
    }, IMMERSIVE_HOVER_POLL_MS);
  }

  private stopImmersiveHoverPoll() {
    if (this.immersiveHoverTimer) {
      clearInterval(this.immersiveHoverTimer);
      this.immersiveHoverTimer = null;
    }
    logImmersiveHeader(this.id, 'hover poll stopped');
    this.immersiveHovering = false;
    this.immersiveNearTop = false;
    this.immersiveLastBlockReason = '';
    this.immersiveTriggerArmed = false;
  }

  private setImmersiveHeaderHeight(height: number) {
    const previousHeight = this.immersiveHeaderHeight;
    this.immersiveHeaderHeight = Math.max(
      IMMERSIVE_HEADER_TRIGGER_HEIGHT,
      Math.round(height || IMMERSIVE_HEADER_TRIGGER_HEIGHT),
    );
    this.immersiveHeaderWaking = false;
    if (this.immersiveHeaderWakeTimer) {
      clearTimeout(this.immersiveHeaderWakeTimer);
      this.immersiveHeaderWakeTimer = null;
    }
    const overlay = this.immersiveHeaderView;
    if (overlay && !overlay.webContents.isDestroyed()) {
      const expanded =
        this.immersiveHeaderHeight > IMMERSIVE_HEADER_TRIGGER_HEIGHT;
      if (expanded) {
        this.immersiveHeaderExpandedHeight = this.immersiveHeaderHeight;
      }
      logImmersiveHeader(this.id, 'set height', {
        raw: height,
        previousHeight,
        height: this.immersiveHeaderHeight,
        expanded,
        visible: this.immersiveHeaderAttached,
      });
      // 折叠态直接移除 BrowserView，避免其页面背景在顶部露出白条；展开态再挂回。
      this.syncImmersiveHeaderBounds();
      if (expanded && this.shouldShowImmersiveOverlay()) {
        if (!this.immersiveHeaderAttached) {
          logImmersiveHeader(this.id, 'height show');
          this.attachImmersiveHeaderView();
        }
      } else if (this.immersiveHeaderAttached) {
        logImmersiveHeader(this.id, 'height hide', {
          blockReason: this.getImmersiveOverlayBlockReason(),
        });
        this.detachImmersiveHeaderView();
      }
      return;
    }
    this.syncImmersiveHeaderBounds();
  }

  private destroyImmersiveHeaderView() {
    this.stopImmersiveHoverPoll();
    if (this.immersiveHeaderWakeTimer) {
      clearTimeout(this.immersiveHeaderWakeTimer);
      this.immersiveHeaderWakeTimer = null;
    }
    if (!this.immersiveHeaderView || this.immersiveHeaderView.webContents.isDestroyed()) {
      this.immersiveHeaderView = null;
      this.immersiveHeaderAttached = false;
      this.immersiveHeaderHeight = IMMERSIVE_HEADER_TRIGGER_HEIGHT;
      this.immersiveHeaderWaking = false;
      this.immersiveTriggerArmed = false;
      return;
    }

    const overlay = this.immersiveHeaderView;
    this.detachImmersiveHeaderView();
    this.immersiveHeaderView = null;
    this.immersiveHeaderAttached = false;
    this.immersiveHeaderHeight = IMMERSIVE_HEADER_TRIGGER_HEIGHT;
    this.immersiveHeaderWaking = false;
    this.immersiveTriggerArmed = false;
    overlay.webContents.destroy();
  }

  public initWin = (incognito: boolean) => {
    //this.win.show();
    // 窗口大小/位置变化时记录普通状态下的 bounds，并防抖写盘。
    this.win.on('resize', () => {
      this.updateBounds();
      this.scheduleSave();
      this.syncImmersiveHeaderBounds();
    });

    this.win.on('move', () => {
      this.updateBounds();
      this.scheduleSave();
      this.syncImmersiveHeaderBounds();
    });

    // 沉浸悬浮头部随主窗可见性/前台状态挂载或移除 BrowserView。延迟一拍读取
    // 焦点状态，避免切换窗口过程中错误恢复头部。
    this.win.on('minimize', () => this.updateImmersiveOverlayVisibility());
    this.win.on('restore', () => this.updateImmersiveOverlayVisibility());
    this.win.on('hide', () => this.updateImmersiveOverlayVisibility());
    this.win.on('show', () => this.updateImmersiveOverlayVisibility());
    this.win.on('blur', () => this.updateImmersiveOverlayVisibility());
    this.win.on('focus', () => this.updateImmersiveOverlayVisibility());

    const resize = () => {
      setTimeout(() => {
        if (process.platform === 'linux') {
          this.viewManager.select(this.viewManager.selectedId, false, true);
        } else {
          this.viewManager.fixBounds();
        }
      });

      setTimeout(() => {
        this.webContents.send('tabs-resize');
      }, 500);

      this.webContents.send('tabs-resize');
    };

    this.win.on('maximize', resize);
    this.win.on('restore', resize);
    this.win.on('unmaximize', resize);
    this.win.on('maximize', () => this.syncImmersiveHeaderBounds());
    this.win.on('restore', () => this.syncImmersiveHeaderBounds());
    this.win.on('unmaximize', () => this.syncImmersiveHeaderBounds());

    // 最大化/还原状态变化时持久化（需求1）。
    this.win.on('maximize', () => this.persistWindowState());
    this.win.on('unmaximize', () => {
      this.updateBounds();
      this.persistWindowState();
    });

    this.win.on('close', (event: Electron.Event) => {
      if (consumePendingPageClose(this.win)) {
        event.preventDefault();
        return;
      }

      console.log('[window] close event');
      const {object: settings} = Application.instance.settings;

      // 标签数以 renderer 上报的全量列表为准(viewManager.rendererTabCount):
      // 主进程 views map 可能在个别路径残留幽灵 view,直接读 views.size 会
      // 出现「只开 1 个标签却提示有 2 个打开的标签页」。
      const tabCount = this.viewManager.rendererTabCount;
      if (settings.warnOnQuit && tabCount > 1) {
        const answer = dialog.showMessageBoxSync(null, {
          type: 'question',
          title: `退出 ${app.name}?`,
          message: `退出 ${app.name}?`,
          detail: `有 ${tabCount} 打开的标签页.`,
          buttons: ['关闭', '取消'],
        });

        if (answer === 1) {
          event.preventDefault();
          return;
        }
      }

      // 退出时自动清理:仅最后一个浏览器窗口、且至少勾一项时触发。
      // 清理过程中二次进入 close(目前不会,防御)直接 preventDefault。
      const isLastWindow = Application.instance.windows.list.length === 1;
      const items = settings.clearOnExit;
      const shouldClear =
        isLastWindow &&
        !this.clearOnExitFinished &&
        items &&
        (items.cache || items.cookies || items.history || items.searchHistory);

      if (shouldClear) {
        if (this.clearOnExitInProgress) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        this.clearOnExitInProgress = true;
        void this.runClearOnExit(items);
        return; // ★ 必须 return,否则下面的销毁代码会立刻执行、进度覆盖层无处显示
      }

      this.finalizeWindowDestruction();
    });

    // this.webContents.openDevTools({ mode: 'detach' });

    if (process.env.NODE_ENV === 'development') {
      this.webContents.openDevTools({mode: 'detach'});
      const url = new URL('http://localhost:4444/app.html');
      if (incognito) url.searchParams.set('incognito', '1');
      const startupLook = Application.instance.settings.getStartupLook();
      for (const [key, value] of Object.entries(startupLook)) {
        if (value != null) url.searchParams.set(key, String(value));
      }
      this.win.loadURL(url.href);
    } else {
      //this.webContents.openDevTools({mode: 'detach'});
      const url = pathToFileURL(join(app.getAppPath(), 'build', 'app.html'));
      if (incognito) url.searchParams.set('incognito', '1');
      // 外观启动参数随 URL 注入:main-app.html 的 head 内联脚本据此直接渲染骨架屏,
      // 不再 sendSync('get-settings-sync') 等主进程应答(冷启动时主进程正忙,
      // 同步 IPC 会推迟 dom_ready 约 300-800ms)。
      const startupLook = Application.instance.settings.getStartupLook();
      for (const [key, value] of Object.entries(startupLook)) {
        if (value != null) url.searchParams.set(key, String(value));
      }
      this.win.loadURL(url.href);
    }
    // 窗口已在构造期的 applyWindowState() 中立即 show(纯色底),不再监听 ready-to-show:
    // 此前等 ready-to-show 才 show 会让窗口出现晚 0.5-1s(等 app.html 渲染),是启动卡顿主因。

    // 拦截主窗口的文件拖拽导航(绕过 BrowserView)
    this.webContents.on('will-navigate', (e, url) => {
      const flagsUrl = resolveInternalFlagsUrl(url, getWebUIURL('flags'));
      if (flagsUrl) {
        e.preventDefault();
        this.viewManager.create({
          url: flagsUrl,
          active: true,
        });
        return;
      }

      // 检测是否是 file:// 协议的电子书文件
      if (url.startsWith('file:///')) {
        const path = filePathFromFileUrl(url);
        const koodoUrl = buildKoodoReaderUrl(path);
        if (koodoUrl) {
          console.log('[file-nav] main-window will-navigate redirect to koodoreader:', koodoUrl);
          e.preventDefault();
          this.viewManager.create({ url: koodoUrl, active: true });
        }
      }
    });


    this.win.on('enter-full-screen', () => {
      this.send('fullscreen', true);
      this.viewManager.fixBounds();
      this.persistWindowState();
      this.syncImmersiveHeaderBounds();
    });

    this.win.on('leave-full-screen', () => {
      this.send('fullscreen', false);
      this.viewManager.fixBounds();
      this.updateBounds();
      this.persistWindowState();
      this.syncImmersiveHeaderBounds();
    });

    this.win.on('enter-html-full-screen', () => {
      this.viewManager.fullscreen = true;
      this.send('html-fullscreen', true);
      this.updateImmersiveOverlayVisibility();
    });

    this.win.on('leave-html-full-screen', () => {
      this.viewManager.fullscreen = false;
      this.send('html-fullscreen', false);
      this.updateImmersiveOverlayVisibility();
    });

    this.win.on('scroll-touch-begin', () => {
      this.send('scroll-touch-begin');
    });

    this.win.on('scroll-touch-end', () => {
      this.viewManager.selected.send('scroll-touch-end');
      this.send('scroll-touch-end');
    });

    this.win.on('focus', () => {
      Application.instance.windows.current = this;
    });

    // 主窗口白屏/卡死检测:渲染进程崩或 UI 长时间无响应时弹出独立恢复覆盖层。
    // 仅挂在主 UI 窗口(app.html),不含 popup/dialog。
    attachWhiteScreenDetector(this);
  }

  public get id() {
    return this.win.id;
  }

  public get workspaceId() {
    return this.workspace?.id;
  }

  // 把窗口稳定地带到前台:restore 解除最小化、show 处理隐藏态、focus 抢焦点。
  // 单独 focus() 在 Windows 上对最小化窗口无效(任务栏不动),这是设为默认浏览器后、
  // 外部应用唤起(seacond-instance)时最小化窗口到不了前台的根因。
  // 对齐 connectivity.ts 推送通知点击的 restore+show+focus 约定。
  public showAndFocus() {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    if (w.isMinimized()) w.restore();
    if (!w.isVisible()) w.show();
    w.focus();
  }

  // 创建/切换扩展弹窗。直接点击图标(show-extension-popup IPC)和
  // chrome.action.openPopup() 都走这里,统一使用 main/dialogs/popup.ts
  // 那套带右键菜单的 PopupView。再次点击同一扩展则关闭(toggle)。
  //
  // MV3 readiness acquisition is awaited for a bounded period before the
  // popup is created. A successful acquisition is kept alive for the popup's
  // lifetime; a stale/replaced acquisition is released immediately.
  public async showExtensionPopup(
    left: number,
    top: number,
    url: string,
    inspect: boolean,
    extensionId: string,
  ) {
    const launchToken = ++this.popupLaunchToken;
    // 先释放上一份 popup 持有的 SW keep-alive(切到另一个扩展 / toggle 关闭)。
    this.releasePopupWorker();

    if (this.popup) {
      const toggleExtension =
        !this.popup.isDestroyed() && this.popup.extensionId === extensionId;
      // 同一扩展的 popup 仍在加载(隐藏且未超时)时,再点不销毁,让加载完成——否则慢加载的
      // popup(uBlock popup-fenix)每次再点都在它出现前被切换关闭、loadURL 永远 ERR_FAILED。
      const stalled = toggleExtension && this.popup.isStalled;
      if (toggleExtension && this.popup.isHidden && !stalled) {
        return;
      }
      this.popup.destroy();
      this.popup = undefined;
      // 已显示的 popup → 切换关闭;卡死(stalled,永远到不了 did-finish-load)→ 继续往下重建。
      if (toggleExtension && !stalled) {
        return;
      }
    }

    const session = this.incognito
      ? Application.instance.sessions.viewIncognito
      : Application.instance.sessions.view;

    // Wait for the bounded Worker bridge prewarm before creating the popup.
    // Creating the page first lets MV3 popup code run while chrome.runtime /
    // storage are still unavailable, which presents as an endless spinner.
    const popupWorker = await this.prewarmPopupServiceWorker(session, extensionId);
    if (
      launchToken !== this.popupLaunchToken ||
      this.win.isDestroyed()
    ) {
      popupWorker?.();
      return;
    }

    // Snapshot the host's real tab list for the popup. Sandboxed popup renderers
    // skip crx-preload (binding.startupData===null → no electron bridge), so
    // chrome.tabs.query falls back to Electron's native registry, which doesn't
    // track this app's BrowserView tabs — the AdGuard popup then can't resolve
    // the active site and sits on "Loading". PopupView injects this list via
    // webContents.executeJavaScript (survives the sandbox) and the SHIM's
    // tabs.query reads globalThis.__crxTabs when the bridge is absent.
    const selectedId = this.viewManager.selectedId;
    const tabs: any[] = [];
    for (const v of this.viewManager.views.values()) {
      try {
        tabs.push({
          id: v.id,
          index: tabs.length,
          windowId: this.win.id,
          active: v.id === selectedId,
          selected: v.id === selectedId,
          highlighted: v.id === selectedId,
          url: v.url,
          title: v.title,
          incognito: !!this.incognito,
          pinned: false,
          groupId: Application.instance.sessions.getTabGroupId(v.id, this.incognito),
          status: 'complete',
        });
      } catch {}
    }
    console.log(`[action-click] popup tabs built n=${tabs.length} selectedId=${selectedId}`);

    this.popup = new PopupView({
      extensionId,
      session,
      parent: this.win,
      url: url,
      tabs,
      anchorRect: {
        x: left,
        y: top,
        height: 0,
        width: 0,
      },
    });
    const popup = this.popup;

    if (popupWorker) {
      if (
        launchToken !== this.popupLaunchToken ||
        this.win.isDestroyed() ||
        this.popup !== popup ||
        popup.isDestroyed()
      ) {
        popupWorker();
      } else {
        this.popupWorkerRelease = popupWorker;
      }
    }

    // popup 窗口关闭时释放 SW keep-alive(host PopupView 内部已挂
    // browserWindow.on('closed', destroy);此处再挂一次 once('closed') 仅释放
    // startTask() 引用)。对齐 vendor browser-action.ts:480-487。
    const popupWindow = popup.browserWindow;
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.once('closed', () => this.releasePopupWorker());
    } else {
      this.releasePopupWorker();
    }
  }

  private releasePopupWorker() {
    if (!this.popupWorkerRelease) return;
    try {
      this.popupWorkerRelease();
    } catch {}
    this.popupWorkerRelease = undefined;
  }

  // 预热 MV3 后台 service worker，并等待宿主 API readiness barrier。返回
  // release() 结束 popup 生命周期内的 keep-alive；不适用或失败时返回 undefined。
  private async prewarmPopupServiceWorker(
    session: Electron.Session,
    extensionId: string,
  ): Promise<(() => void) | undefined> {
    try {
      const extension: any =
        typeof (session as any).getExtension === 'function'
          ? (session as any).getExtension(extensionId)
          : undefined;
      const manifest = extension?.manifest;
      if (
        !manifest ||
        manifest.manifest_version !== 3 ||
        !manifest.background?.service_worker
      ) {
        return undefined;
      }

      return await Application.instance.sessions.prewarmExtensionPopupWorker(
        session,
        extensionId,
        8_000,
      );
    } catch (error) {
      console.warn(
        `[action-click] popup SW prewarm failed extId=${extensionId}`,
        error,
      );
      return undefined;
    }
  }

  public get webContents() {
    return this.win.webContents;
  }

  public updateRightGestureOverlay(
    update: import('../services/native-right-gesture').NativeRightGestureVisualUpdate,
    offset?: {x: number; y: number},
  ) {
    if (update.phase === 'start') {
      this.rightGestureContextMenuSuppressionUntil = 0;
    } else if (
      (update.phase === 'move' && update.engaged) ||
      update.phase === 'end'
    ) {
      this.rightGestureContextMenuSuppressionUntil = Date.now() + 2000;
    }
    // 载体窗口按需创建:普通右键(未按住+移动)不建窗,避免每次点菜单
    // 都创建透明 BrowserWindow。overlay 自身构造零开销,可安全常驻。
    if (!this.rightGestureOverlay) {
      this.rightGestureOverlay = new RightGestureOverlay(this.win);
    }
    this.rightGestureOverlay.update(update, offset);
  }

  public consumeRightGestureContextMenuSuppression() {
    const shouldSuppress =
      Date.now() <= this.rightGestureContextMenuSuppressionUntil;
    this.rightGestureContextMenuSuppressionUntil = 0;
    return shouldSuppress;
  }

  public fixDragging() {
    const bounds = this.win.getBounds();
    this.win.setBounds({
      height: bounds.height + 1,
    });
    this.win.setBounds(bounds);
  }

  public send(channel: string, ...args: any[]) {
    // 退出/标签关闭清理路径会在窗口已销毁后仍调用 send(如 removeTab→removeByTabId
    // →send→get webContents),缺守卫会抛 [FATAL] Object has been destroyed。
    if (this.win.isDestroyed()) return;
    this.webContents.send(channel, ...args);

    const overlay = this.immersiveHeaderView;
    if (overlay && !overlay.webContents.isDestroyed()) {
      overlay.webContents.send(channel, ...args);
    }
  }

  public updateTitle() {
    const {selected} = this.viewManager;
    if (!selected) return;

    const productTitle = activeProfileName
      ? `${activeProfileName} - ${app.name}`
      : app.name;
    this.win.setTitle(
      selected.title.trim() === ''
        ? productTitle
        : `${selected.title} - ${productTitle}`,
    );
  }

  // 原 close 事件后半段的同步销毁流程。抽出后供「清理完成后真正关闭」复用:
  // runClearOnExit 跑完 → finalizeWindowDestruction → win.destroy()。
  private finalizeWindowDestruction() {
    if (this.win.isDestroyed()) return;

    // 关闭时同步保存窗口状态（需求1/2）。
    this.persistWindowState(true);

    this.win.setBrowserView(null);

    this.sidePanels?.destroy();

    this.secondarySearchPanels?.destroy();

    this.sidebarResizer?.destroy();

    this.destroyImmersiveHeaderView();

    // Let the extension store mark tab-group removals as window-closing before
    // destroying the last BrowserViews in this window.
    ;(this.win as any).__crxWindowClosing = true
    this.viewManager.clear();

    if (Application.instance.windows.list.length === 1) {
      Application.instance.dialogs.destroy();
    }

    Application.instance.windows.list = Application.instance.windows.list.filter(
      (x) => x.win.id !== this.win.id,
    );

    // destroy() 绕过 close 事件,触发 closed → quitIfNoBrowserWindows → app.quit。
    if (!this.win.isDestroyed()) {
      this.win.destroy();
    }
  }

  // 退出时自动清理:显示进度覆盖层 → 执行清理 → 显示「清理完成」0.5s → 真正关闭。
  // performClearOnExit 自带 30s 超时兜底,不会无限阻塞。
  private async runClearOnExit(items: ClearItems) {
    try {
      // 摘掉当前标签页 BrowserView,否则它会盖住主窗 webContents 里渲染的进度覆盖层。
      // persistWindowState 留给 finalizeWindowDestruction 统一做(close 时窗口位置已是
      // 最终态,无需提前写);viewManager 不销毁——窗口此刻还活着,清理完成后由
      // finalizeWindowDestruction 统一销毁。
      if (!this.win.isDestroyed()) {
        this.win.setBrowserView(null);
      }

      // 通知 renderer 显示进度覆盖层(exit 模式)。
      if (!this.win.isDestroyed() && !this.win.webContents.isDestroyed()) {
        this.win.webContents.send('clear-overlay-show', {mode: 'exit'});
      }

      await performClearOnExit({
        items,
        onProgress: (p) => {
          if (
            this.win &&
            !this.win.isDestroyed() &&
            !this.win.webContents.isDestroyed()
          ) {
            this.win.webContents.send('clear-progress', p);
          }
        },
      });

      // 显示「清理完成」约 0.5s 让用户看到结果。
      await new Promise<void>((r) => setTimeout(r, 500));
    } catch (e) {
      console.error('[clear-on-exit] 清理失败,继续关闭', e);
    } finally {
      this.clearOnExitFinished = true;
      try {
        this.clearOnExitDoneResolve();
      } catch {
        // ignore
      }
      this.finalizeWindowDestruction();
    }
  }
}
