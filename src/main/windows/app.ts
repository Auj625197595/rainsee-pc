import {BrowserWindow, app, dialog, ipcMain, screen, nativeImage, nativeTheme} from 'electron';
import {writeFileSync, readFileSync, promises} from 'fs';
import {resolve, join} from 'path';
import { pathToFileURL } from 'url';

import {getPath} from '~/utils';
import {buildKoodoReaderUrl, filePathFromFileUrl} from '~/constants/files';
import {getWebUIURL} from '~/common/webui-main';
import {runMessagingService} from '../services';
import {Application} from '../application';
import {isNightly} from '..';
import {ViewManager} from '../view-manager';
import {ISettings} from '~/interfaces';
import {PopupView} from "~/main/dialogs/popup";
import {SidePanelManager} from '../side-panel/side-panel-manager';
import {SecondarySearchPanelManager} from '../secondary-search/secondary-search-manager';
import {SidebarResizer} from '../sidebar/sidebar-resizer';
import {attachWhiteScreenDetector} from '../whitescreen-detector';

const STARTUP_LIGHT_BG = '#ffffff';
const STARTUP_DARK_BG = '#1c1c1c';
const IMMERSIVE_HEADER_TRIGGER_HEIGHT = 3;
// 悬停检测改由主进程绝对游标轮询驱动(替换 overlay 的 DOM mouseenter/leave:透明
// 置顶窗 resize 会反馈幽灵 mouse 事件 → 偶发显隐闪烁)。触发带比 3px 窗更宽,更好命中。
const IMMERSIVE_HOVER_POLL_MS = 70;
const IMMERSIVE_TRIGGER_BAND = 6;
// 折叠态没有可见窗口,首次命中顶部时先给 overlay 一个临时可绘制高度。
// renderer 展开后会立刻上报真实高度,随后这里会被真实高度覆盖。
const IMMERSIVE_HEADER_WAKE_HEIGHT = 160;
const IMMERSIVE_DEBUG_TOP_BAND = 24;

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
  public popup: PopupView;

  // SW keep-alive release handle for popups opened via showExtensionPopup.
  // Mirrors vendor BrowserActionAPI.prewarmPopupServiceWorker: the worker is
  // warmed (startWorkerForScope) before the popup opens so the MV3 service
  // worker takes the normal-start path and its registered service-worker
  // preload re-injects (Electron skips preload re-injection on a passive,
  // popup-triggered wake-up, leaving globalThis.electron undefined). Released
  // when the popup is destroyed / replaced.
  private popupWorkerRelease?: () => void;

  // 标签撕离生成的新窗口:渲染层应跳过默认新标签页加载,改为领养被撕离的标签。
  public pendingDetach = false;

  // 手动拖拽时锁定的 normal 尺寸。will-resize 只放行这个宽高,防止窗口移动到
  // 屏幕边缘后被 Aero Snap 再次撑成最大化或半屏。
  public suppressResize: {width: number; height: number} | null = null;

  private windowDataPath = getPath('window-data.json');

  private windowState: {
    bounds?: Electron.Rectangle;
    maximized?: boolean;
    fullscreen?: boolean;
  } = {};

  private saveTimer: any = null;
  private immersiveHeaderWindow: BrowserWindow | null = null;
  private immersiveHeaderHeight = IMMERSIVE_HEADER_TRIGGER_HEIGHT;
  private immersiveHeaderWaking = false;
  // 游标轮询表 + 最近一次下发的悬停态(仅变化时下发,避免刷屏)。
  private immersiveHoverTimer: any = null;
  private immersiveHovering = false;
  private immersiveNearTop = false;
  private immersiveLastBlockReason = '';

  public constructor(incognito: boolean, initialBounds?: Electron.Rectangle) {
    this.pendingDetach = !!initialBounds;
    const startupBackgroundColor = incognito
      ? STARTUP_DARK_BG
      : getStartupBackgroundColor();
    this.win = new BrowserWindow({
      frame: false,
      minWidth: 800,
      minHeight: 450,
      width: 900,
      height: 600,
      titleBarStyle: 'hiddenInset',
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
      icon: resolve(
        app.getAppPath(),
        `static/${isNightly ? 'nightly-icons' : 'icons'}/icon.png`,
      ),
      show: false,
    });
    require("@electron/remote/main").enable(this.win.webContents);

    this.incognito = incognito;

    this.viewManager = new ViewManager(this, incognito);

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
    ipcMain.on(dragResizeChannel, onDragResizeSuppress);
    this.win.once('closed', () => {
      this.suppressResize = null;
      ipcMain.removeListener(dragResizeChannel, onDragResizeSuppress);
    });

    runMessagingService(this);

    if (process.env.ENABLE_EXTENSIONS) {
      ipcMain.on(`show-extension-popup-${this.id}`, (e, left, top, url, inspect, extensionId) => {
        console.log(`[action-click] show-extension-popup extId=${extensionId} url=${JSON.stringify(url)} inspect=${inspect} left=${left} top=${top}`);
        this.showExtensionPopup(left, top, url, inspect, extensionId);
      });
    }

    ipcMain.on(`immersive-header-enabled-${this.id}`, (_e, enabled: boolean) => {
      logImmersiveHeader(this.id, 'enabled', enabled);
      if (enabled) {
        this.ensureImmersiveHeaderWindow();
      } else {
        this.destroyImmersiveHeaderWindow();
      }
    });

    ipcMain.on(`immersive-header-height-${this.id}`, (_e, height: number) => {
      logImmersiveHeader(this.id, 'ipc height', height);
      this.setImmersiveHeaderHeight(height);
    });

    // 主渲染进程 → overlay:全量标签快照(单一数据源镜像)。不能用 this.send()
    // ——它同时发主窗 + overlay 会自环。
    ipcMain.on(`immersive-header-sync-${this.id}`, (_e, snapshot: any) => {
      const overlay = this.immersiveHeaderWindow;
      if (overlay && !overlay.isDestroyed()) {
        overlay.webContents.send('immersive-header-sync', snapshot);
      }
    });

    // overlay → 主渲染进程:标签操作遥控(select/close/new)与挂载握手拉首帧。
    ipcMain.on(`immersive-header-cmd-${this.id}`, (_e, cmd: any) => {
      if (!this.win.isDestroyed()) {
        this.webContents.send('immersive-header-cmd', cmd);
      }
    });
    ipcMain.on(`immersive-header-request-sync-${this.id}`, () => {
      if (!this.win.isDestroyed()) {
        this.webContents.send('immersive-header-request-sync');
      }
    });

    this.restoreWindowState();

    this.restoreWindowState(initialBounds);

    this.initWin(incognito);
  }

  // 启动时读取上次保存的窗口状态并还原（尺寸/位置/最大化/全屏）。
  // initialBounds 存在时(标签撕离生成的新窗)优先使用它,忽略磁盘保存的状态。
  private restoreWindowState(initialBounds?: Electron.Rectangle) {
    try {
      this.windowState =
        JSON.parse(readFileSync(this.windowDataPath, 'utf8')) || {};
    } catch (e) {
      this.windowState = {};
    }

    if (initialBounds) {
      const bounds = this.sanitizeBounds(initialBounds);
      if (bounds) {
        this.windowState.bounds = bounds;
        this.win.setBounds(bounds);
      }
      return;
    }

    // 还原非全屏/非最大化时的窗口位置与大小，并裁剪到屏幕范围内。
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

    const minWidth = 800;
    const minHeight = 450;

    const width = Math.max(minWidth, Math.min(bounds.width, workArea.width));
    const height = Math.max(
      minHeight,
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
    const overlay = this.immersiveHeaderWindow;
    if (!overlay || overlay.isDestroyed()) return;

    const {x, y, width} = this.win.getBounds();
    overlay.setBounds({
      x,
      y,
      width,
      height: Math.max(IMMERSIVE_HEADER_TRIGGER_HEIGHT, this.immersiveHeaderHeight),
    });
  }

  private wakeImmersiveHeaderWindow() {
    const overlay = this.immersiveHeaderWindow;
    if (!overlay || overlay.isDestroyed()) {
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
        visible: overlay.isVisible(),
        waking: this.immersiveHeaderWaking,
      });
      return;
    }

    logImmersiveHeader(this.id, 'wake', {
      previousHeight: this.immersiveHeaderHeight,
      wakeHeight: IMMERSIVE_HEADER_WAKE_HEIGHT,
      visible: overlay.isVisible(),
    });
    this.immersiveHeaderHeight = IMMERSIVE_HEADER_WAKE_HEIGHT;
    this.immersiveHeaderWaking = true;
    overlay.setIgnoreMouseEvents(false);
    this.syncImmersiveHeaderBounds();
    if (!overlay.isVisible()) overlay.showInactive();
  }

  private ensureImmersiveHeaderWindow() {
    if (this.immersiveHeaderWindow && !this.immersiveHeaderWindow.isDestroyed()) {
      logImmersiveHeader(this.id, 'ensure existing overlay');
      this.syncImmersiveHeaderBounds();
      this.updateImmersiveOverlayVisibility();
      this.startImmersiveHoverPoll();
      return;
    }

    logImmersiveHeader(this.id, 'create overlay');
    const overlay = new BrowserWindow({
      parent: this.win,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
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
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setVisibleOnAllWorkspaces(false);
    overlay.setMenuBarVisibility(false);
    // 初始折叠时窗口保持隐藏。顶部命中由主进程绝对游标轮询负责,不需要可见触发带。
    overlay.setIgnoreMouseEvents(true);
    overlay.loadURL(this.buildImmersiveHeaderUrl());
    overlay.once('ready-to-show', () => {
      logImmersiveHeader(this.id, 'overlay ready-to-show', {
        height: this.immersiveHeaderHeight,
        shouldShow: this.shouldShowImmersiveOverlay(),
        visible: overlay.isVisible(),
      });
      this.syncImmersiveHeaderBounds();
      if (
        this.shouldShowImmersiveOverlay() &&
        this.immersiveHeaderHeight > IMMERSIVE_HEADER_TRIGGER_HEIGHT
      ) {
        logImmersiveHeader(this.id, 'ready showInactive');
        overlay.showInactive();
      }
    });
    // 悬浮层获焦/失焦也纳入可见性判定:点击头部使其获焦(主窗随之 blur)时,不应被
    // 误判为「切到别的 app」而隐藏。
    overlay.on('blur', () => this.updateImmersiveOverlayVisibility());
    overlay.on('focus', () => this.updateImmersiveOverlayVisibility());
    overlay.on('closed', () => {
      logImmersiveHeader(this.id, 'overlay closed');
      if (this.immersiveHeaderWindow === overlay) {
        this.immersiveHeaderWindow = null;
        this.immersiveHeaderHeight = IMMERSIVE_HEADER_TRIGGER_HEIGHT;
        this.immersiveHeaderWaking = false;
      }
    });

    this.immersiveHeaderWindow = overlay;
    this.startImmersiveHoverPoll();
  }

  private getImmersiveOverlayBlockReason(): string | null {
    const overlay = this.immersiveHeaderWindow;
    if (!overlay || overlay.isDestroyed()) return 'overlay missing/destroyed';
    if (this.win.isDestroyed()) return 'main window destroyed';
    if (!this.win.isVisible()) return 'main window hidden';
    if (this.win.isMinimized()) return 'main window minimized';
    const focused = BrowserWindow.getFocusedWindow();
    if (focused === null) return 'no focused app window';
    if (this.viewManager && this.viewManager.fullscreen) return 'view fullscreen';
    return null;
  }

  // overlay 应否显示:主窗可见且未最小化、我方 app 在前台(切到别的 app 时
  // BrowserWindow.getFocusedWindow()===null;弹窗/悬浮层获焦仍算前台)、且非网页
  // HTML 全屏(视频)。用于可见性绑定与游标轮询门控。
  private shouldShowImmersiveOverlay(): boolean {
    return this.getImmersiveOverlayBlockReason() === null;
  }

  // 按 shouldShow 显隐 overlay。setTimeout(0) 让 blur 后 getFocusedWindow() 落定
  // ——点击头部使 overlay 获焦时,主窗 blur 不应把 overlay 误藏。
  private updateImmersiveOverlayVisibility = () => {
    setTimeout(() => {
      const overlay = this.immersiveHeaderWindow;
      if (!overlay || overlay.isDestroyed()) return;
      if (
        this.shouldShowImmersiveOverlay() &&
        this.immersiveHeaderHeight > IMMERSIVE_HEADER_TRIGGER_HEIGHT
      ) {
        this.syncImmersiveHeaderBounds();
        if (!overlay.isVisible()) {
          logImmersiveHeader(this.id, 'visibility show', {
            height: this.immersiveHeaderHeight,
          });
          overlay.showInactive();
        }
      } else if (overlay.isVisible()) {
        logImmersiveHeader(this.id, 'visibility hide', {
          height: this.immersiveHeaderHeight,
          blockReason: this.getImmersiveOverlayBlockReason(),
        });
        overlay.hide();
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
      const overlay = this.immersiveHeaderWindow;
      if (!overlay || overlay.isDestroyed()) {
        logImmersiveHeader(this.id, 'hover poll stop: overlay missing');
        this.stopImmersiveHoverPoll();
        return;
      }
      let hovering = false;
      const pt = screen.getCursorScreenPoint();
      const b = this.win.getBounds();
      const displayBounds = screen.getDisplayMatching(b).bounds;
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

      if (nearTop !== this.immersiveNearTop) {
        this.immersiveNearTop = nearTop;
        logImmersiveHeader(this.id, nearTop ? 'cursor near top' : 'cursor left top', {
          pt,
          bounds: b,
          visibleBounds,
          height: this.immersiveHeaderHeight,
          visible: overlay.isVisible(),
          focusedWindowId: BrowserWindow.getFocusedWindow()?.id || null,
        });
      }

      const blockReason = this.getImmersiveOverlayBlockReason();
      if (!blockReason) {
        // 折叠用较宽触发带(比 3px 窗好命中);展开用当前头部实高作「保持带」。
        const zoneH =
          this.immersiveHeaderHeight > IMMERSIVE_HEADER_TRIGGER_HEIGHT
            ? this.immersiveHeaderHeight
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
          visible: overlay.isVisible(),
        });
        if (hovering) this.wakeImmersiveHeaderWindow();
        if (!overlay.isDestroyed()) {
          logImmersiveHeader(this.id, 'send hover', hovering);
          overlay.webContents.send('immersive-header-hover', hovering);
        }
      } else if (
        hovering &&
        this.immersiveHeaderWaking
      ) {
        if (!overlay.isDestroyed()) {
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
  }

  private setImmersiveHeaderHeight(height: number) {
    const previousHeight = this.immersiveHeaderHeight;
    this.immersiveHeaderHeight = Math.max(
      IMMERSIVE_HEADER_TRIGGER_HEIGHT,
      Math.round(height || IMMERSIVE_HEADER_TRIGGER_HEIGHT),
    );
    this.immersiveHeaderWaking = false;
    const overlay = this.immersiveHeaderWindow;
    if (overlay && !overlay.isDestroyed()) {
      const expanded =
        this.immersiveHeaderHeight > IMMERSIVE_HEADER_TRIGGER_HEIGHT;
      logImmersiveHeader(this.id, 'set height', {
        raw: height,
        previousHeight,
        height: this.immersiveHeaderHeight,
        expanded,
        visible: overlay.isVisible(),
      });
      // 折叠态窗口完全隐藏,避免透明窗口的页面背景在顶部露出白条;展开态恢复交互。
      overlay.setIgnoreMouseEvents(!expanded);
      this.syncImmersiveHeaderBounds();
      if (expanded && this.shouldShowImmersiveOverlay()) {
        if (!overlay.isVisible()) {
          logImmersiveHeader(this.id, 'height show');
          overlay.showInactive();
        }
      } else if (overlay.isVisible()) {
        logImmersiveHeader(this.id, 'height hide', {
          blockReason: this.getImmersiveOverlayBlockReason(),
        });
        overlay.hide();
      }
      return;
    }
    this.syncImmersiveHeaderBounds();
  }

  private destroyImmersiveHeaderWindow() {
    this.stopImmersiveHoverPoll();
    if (!this.immersiveHeaderWindow || this.immersiveHeaderWindow.isDestroyed()) {
      this.immersiveHeaderWindow = null;
      this.immersiveHeaderHeight = IMMERSIVE_HEADER_TRIGGER_HEIGHT;
      this.immersiveHeaderWaking = false;
      return;
    }

    const overlay = this.immersiveHeaderWindow;
    this.immersiveHeaderWindow = null;
    this.immersiveHeaderHeight = IMMERSIVE_HEADER_TRIGGER_HEIGHT;
    this.immersiveHeaderWaking = false;
    overlay.destroy();
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

    // 沉浸悬浮头部:主窗可见性/前台状态变化时同步显隐 overlay,避免最小化/切到别的
    // app 后 alwaysOnTop 子窗仍浮在其顶上(问题3)。updateImmersiveOverlayVisibility
    // 内部 setTimeout(0) 去抖,确保点击头部(overlay 获焦→主窗 blur)不会误藏。
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
      const {object: settings} = Application.instance.settings;

      if (settings.warnOnQuit && this.viewManager.views.size > 1) {
        const answer = dialog.showMessageBoxSync(null, {
          type: 'question',
          title: `退出 ${app.name}?`,
          message: `退出 ${app.name}?`,
          detail: `有 ${this.viewManager.views.size} 打开的标签页.`,
          buttons: ['关闭', '取消'],
        });

        if (answer === 1) {
          event.preventDefault();
          return;
        }
      }

      // 关闭时同步保存窗口状态（需求1/2）。
      this.persistWindowState(true);

      this.win.setBrowserView(null);

    this.sidePanels?.destroy();

      this.secondarySearchPanels?.destroy();

      this.sidebarResizer?.destroy();

      this.destroyImmersiveHeaderWindow();

      this.viewManager.clear();

      if (Application.instance.windows.list.length === 1) {
        Application.instance.dialogs.destroy();
      }

      Application.instance.windows.list = Application.instance.windows.list.filter(
        (x) => x.win.id !== this.win.id,
      );
    });

    // this.webContents.openDevTools({ mode: 'detach' });

    if (process.env.NODE_ENV === 'development') {
      this.webContents.openDevTools({mode: 'detach'});
      this.win.loadURL('http://localhost:4444/app.html');
    } else {
      //this.webContents.openDevTools({mode: 'detach'});
      this.win.loadURL(pathToFileURL(join(app.getAppPath(), 'build', 'app.html')).href);
    }
    this.win.on('ready-to-show', () => {
      // 等初始化完成后再显示
      this.win.show();
    });

    // 主窗口外壳(app.html)加载完成后,再「逐个」预热那些非关键的持久弹窗
    // (菜单/添加书签/拦截详情/扩展列表/更新)。放在这里而非启动关键路径上,
    // 避免它们的 React 包加载与首屏内容争抢 CPU/GPU。只跑一次。
    this.webContents.once('did-finish-load', () => {
      // 让首屏先稳定一拍,再开始后台预热。
      setTimeout(() => {
        Application.instance.dialogs.warmUpPersistentDialogs();
        // 预热一个隐藏 BrowserView,供下一次新建标签/懒加载恢复即时复用,
        // 省去 new View() 的固定开销(800ms 错峰避免与首屏争抢 CPU)。
        this.viewManager.ensureWarmView();
      }, 800);
    });

    // 拦截主窗口的文件拖拽导航(绕过 BrowserView)
    this.webContents.on('will-navigate', (e, url) => {
      const match = /^(chrome:\/\/flags|yjllq:\/\/flags)([/?#].*)?$/i.exec(
        url || '',
      );
      if (match) {
        e.preventDefault();
        this.viewManager.create({
          url: `${getWebUIURL('flags')}${match[2] || ''}`,
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
  // 【方案A】开 popup 前先 prewarm MV3 service worker。否则当 SW 处于 stopped
  // 时,popup 加载间接触发 Electron 被动唤醒,而 Electron 42 在被动唤醒下不重跑
  // 已注册的 service-worker preload,导致 SW 内 globalThis.electron 缺失、所有
  // IPC API 失效(正是「第三次唤醒失效」的根因)。显式 startWorkerForScope 强制
  // 走正常启动路径,preload 重注。对齐 vendor BrowserActionAPI.activateClick 的
  // prewarmPopupServiceWorker(browser-action.ts:457/510)。prewarm 失败不得阻断 popup。
  public async showExtensionPopup(
    left: number,
    top: number,
    url: string,
    inspect: boolean,
    extensionId: string,
  ) {
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

    const release = await this.prewarmPopupServiceWorker(session, extensionId);
    this.popupWorkerRelease = release;

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

    // popup 窗口关闭时释放 SW keep-alive(host PopupView 内部已挂
    // browserWindow.on('closed', destroy);此处再挂一次 once('closed') 仅释放
    // startTask() 引用)。对齐 vendor browser-action.ts:480-487。
    const popupWindow = this.popup.browserWindow;
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

  // 预热扩展 MV3 后台 service worker,使 popup 触发的唤醒走正常启动路径(preload
  // 重注)而非 Electron 的 preload-less 被动唤醒。返回 release() 结束 keep-alive
  // 任务;不适用 / 失败时返回 undefined。镜像 vendor prewarmPopupServiceWorker。
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
        return;
      }

      const swApi: any = (session as any).serviceWorkers;
      const hasOriginal =
        typeof swApi?.__origStartWorkerForScope === 'function';
      const startWorker = hasOriginal
        ? swApi.__origStartWorkerForScope.bind(swApi)
        : typeof swApi?.startWorkerForScope === 'function'
          ? swApi.startWorkerForScope.bind(swApi)
          : undefined;
      if (!startWorker) return;

      const scope = extension.url || `chrome-extension://${extensionId}/`;
      console.log(
        `[action-click] popup SW prewarm extId=${extensionId} scope=${scope} usingOriginal=${hasOriginal} (showExtensionPopup)`,
      );

      const sw = await startWorker(scope);
      console.log(
        `[action-click] popup SW prewarm ready extId=${extensionId} versionId=${sw?.versionId ?? 'n/a'} (showExtensionPopup)`,
      );

      if (!sw || typeof sw.startTask !== 'function') return;
      const task = sw.startTask();
      console.log(
        `[action-click] popup SW keepAlive acquired extId=${extensionId} (showExtensionPopup)`,
      );

      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          task.end();
          console.log(
            `[action-click] popup SW keepAlive released extId=${extensionId} (showExtensionPopup)`,
          );
        } catch (e) {
          console.warn(
            `[action-click] popup SW keepAlive release failed extId=${extensionId}`,
            e,
          );
        }
      };
    } catch (error) {
      console.warn(
        `[action-click] popup SW prewarm failed extId=${extensionId}`,
        error,
      );
      return;
    }
  }

  public get webContents() {
    return this.win.webContents;
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

    const overlay = this.immersiveHeaderWindow;
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send(channel, ...args);
    }
  }

  public updateTitle() {
    const {selected} = this.viewManager;
    if (!selected) return;

    this.win.setTitle(
      selected.title.trim() === ''
        ? app.name
        : `${selected.title} - ${app.name}`,
    );
  }
}
