import {
  app,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  webContents,
} from 'electron';
import { isAbsolute, extname, join } from 'path';
import { existsSync, promises as fsPromises } from 'fs';
import { pathToFileURL } from 'url';

// PDF Drag-Drop: 验证主进程是否加载新代码
console.log('[PDF Drag-Drop] *** MAIN PROCESS STARTED - NEW CODE LOADED ***');

import { SessionsService } from './sessions-service';
import { initExtensionAutoUpdater } from './extension-updater';
import { checkFiles } from '~/utils/files';
import {buildKoodoReaderUrl} from '~/constants/files';
import { isURL, prefixHttp } from '~/utils';
import { Settings } from './models/settings';
import { isOnboardingNeeded, showOnboarding } from './onboarding';
import { translateText } from './services/translate';

// 文本选择面板/划词翻译下发给 preload 的精简配置。
// 用结构化类型,免 import ISettings;settings.object 结构兼容即可。
const buildSelectionTranslateConfig = (s: {
  selectionPanelEnabled?: boolean;
  selectionWordCountEnabled?: boolean;
  selectionTranslateEnabled?: boolean;
  selectionTranslateTarget?: string;
}) => ({
  panelEnabled: s.selectionPanelEnabled !== false,
  wordCountEnabled: s.selectionWordCountEnabled !== false,
  translateEnabled: s.selectionTranslateEnabled !== false,
  target:
    typeof s.selectionTranslateTarget === 'string' && s.selectionTranslateTarget
      ? s.selectionTranslateTarget
      : 'zh-CN',
});

// 解析冷启动参数后把目标 URL注入首个窗口。若交给 renderer 再从
// process.argv 解析,外部 HTML 会先等待设置广播、标签组和会话恢复。
const getStartupNavigationUrl = (argv: string[]): string | undefined => {
  // argv[0] 是可执行文件。只检查后续参数,避免普通启动时把应用自身路径
  // 误判成导航目标。文件参数允许其后还有 Chromium 开关,所以倒序查找。
  for (let index = argv.length - 1; index >= 1; index -= 1) {
    const candidate = argv[index];
    if (!candidate || candidate.startsWith('-')) continue;

    if (isAbsolute(candidate) && existsSync(candidate)) {
      const ext = extname(candidate).toLowerCase();
      if (ext === '.html' || ext === '.htm') {
        return pathToFileURL(candidate).href;
      }

      const koodoUrl = buildKoodoReaderUrl(candidate);
      if (koodoUrl) return koodoUrl;
    }

    // URL 后可能还有 Chromium 开关。倒序扫描可保留命令行中最后一个导航目标，
    // 同时 candidate.startsWith('-') 已排除 --proxy-server=<url> 这类开关本身。
    if (isURL(candidate)) return prefixHttp(candidate);
  }
  return undefined;
};
import { WindowsService } from './windows-service';
import { StorageService } from './services/storage';
import { getMainMenu } from './menus/main';
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_CATEGORIES,
  resolveAccelerators,
} from './menus/shortcut-actions';
import {
  GESTURE_ACTIONS,
  GESTURE_CATEGORIES,
  PRESET_SHAPES,
  effectiveShape,
  buildGestureConfig,
  LEFT_GESTURE_ACTIONS,
} from './menus/gesture-actions';
import { getWebUIURL } from '~/common/webui-main';
import { registerDefaultBrowserIpc } from './services/default-browser';
import {
  openAppModeWindow,
  getAppModeFromCommandLine,
  parseAppModeFromArgv,
} from './windows/app-mode';
import {
  getInstalledMeta,
  repairDevelopmentPwaShortcuts,
} from './services/pwa';
import {ensureIncognitoIcon, installIncognitoShortcut} from './services/incognito-icon';
import { DialogsService } from './services/dialogs-service';
import { requestAuth } from './dialogs/auth';
// 开源版：无账号、无云同步、无上报。云端相关服务一律不引入。
import { setupMediaPlayer } from './windows/media-player';
import { setupImageViewerIPC } from './services/image-viewer';
import { setupMemoryReport } from './services/memory-report';
import { startupMark, startupTimer, tlog } from './timing';
import { migrationGate } from './data-location';
import { activeProfileName, profileStartupError } from './bootstrap-paths';
import { parseProfileArgument } from '~/common/profiles';
import { getActiveProxyCredentials } from './profile-network';
import { DesktopScreenshotService } from './services/desktop-screenshot';
import {reloadCertificateErrorPermissions} from './services/certificate-error-permissions';
import {NativeBlankPopupManager} from './native-blank-popup';
import { WorkspaceService } from './workspace-service';
import { SedentaryReminderService } from './services/sedentary-reminder';
import {GoogleConnectivityService} from './services/google-connectivity';
import {
  findSecondInstanceWindow,
  singleInstanceCoordinator,
} from './single-instance';

type StartupPhase = 'boot' | 'window-serviceable' | 'deferred';
type DeferredStartupTrigger = 'renderer-ready' | 'app-mode-ready' | 'timeout';

export class Application {
  public tempTabUrl = "";
  
  public static instance = new Application();

  public sessions: SessionsService;

  public googleConnectivity = new GoogleConnectivityService();

  public settings = new Settings();

  public storage = new StorageService();

  public windows = new WindowsService();

  public workspaces = new WorkspaceService();

  public sedentaryReminders = new SedentaryReminderService(
    () => this.windows?.list || [],
  );

  public nativeBlankPopups = new NativeBlankPopupManager();

  public dialogs = new DialogsService();

  public desktopScreenshot = new DesktopScreenshotService((action, dataURL) =>
    this.handleScreenshotImageAction(action, dataURL),
  );

  private bossKeyTray: Tray | null = null;

  private bossKeyAccelerators: string[] = [];

  private screenshotAccelerators: string[] = [];

  private bossKeyHidden = false;

  private bossKeyMutedViewIds = new Set<number>();

  private bossKeyLastToggleAt = 0;

  private startupPhase: StartupPhase = 'boot';

  private deferredStartupPromise: Promise<void> | null = null;

  private deferredStartupFallback: NodeJS.Timeout | null = null;

  private startupCriticalReadyListening = false;

  // 首个真实网页标签 did-finish-load 的通知(云端服务错峰用)。去重 + 8s 超时回退,
  // 保证无网络/纯本地会话时云服务仍会启动。
  private firstRealTabResolvers: Array<() => void> = [];

  private firstRealTabNotified = false;

  private firstRealTabTimeout: NodeJS.Timeout | null = null;

  public constructor() {
    startupMark('main.application.constructed');
  }

  public start() {
    startupMark('main.application.start.entered');
    this.googleConnectivity.start();
    // 更新服务会在首个真实标签加载后才按需加载；菜单可能更早打开。
    // 先提供稳定的查询结果，延迟服务就绪后会替换为读取实际更新状态的 handler。
    ipcMain.handle('is-update-available', () => false);
    if (profileStartupError) {
      app.whenReady().then(async () => {
        try {
          await dialog.showMessageBox({
            type: 'error',
            title: '无法打开小号',
            message: profileStartupError || '小号启动失败',
            buttons: ['确定'],
          });
        } finally {
          app.exit(1);
        }
      });
      return;
    }

    // 单例锁已由轻量 launcher 在加载完整主进程 bundle 前取得。二次启动
    // 请求由 coordinator 暂存,等 SessionsService 就绪后再接入实际处理器。
    app.once('will-quit', () => {
      this.desktopScreenshot.dispose();
      if (this.deferredStartupFallback) {
        clearTimeout(this.deferredStartupFallback);
        this.deferredStartupFallback = null;
      }
      if (this.startupCriticalReadyListening) {
        ipcMain.removeListener(
          'startup-critical-ready',
          this.onStartupCriticalReady,
        );
        this.startupCriticalReadyListening = false;
      }
    });
    startupMark('main.application.lifecycle_handlers.begin');
    app.on('login', async (e, webContents, request, authInfo, callback) => {
      e.preventDefault();

      if (authInfo.isProxy) {
        const proxyCredentials = getActiveProxyCredentials();
        if (proxyCredentials) {
          callback(proxyCredentials.username, proxyCredentials.password);
          return;
        }
        callback();
        return;
      }

      const window = this.windows.findByBrowserView(webContents.id);
      if (!window) {
        callback();
        return;
      }

      let credentials: {username: string; password: string} | undefined;
      try {
        credentials = await requestAuth(window.win, request.url, webContents.id);
      } catch (error) {
        console.error('[auth] failed to show credentials dialog', error);
      }

      if (credentials) {
        callback(credentials.username, credentials.password);
      } else {
        callback();
      }
    });

    ipcMain.on('create-window', (e, incognito = false) => {
      this.windows.open(incognito);
    });
    startupMark('main.application.window_ipc.registered');
    // 快捷键设置:下发可配置动作列表 / 保存用户改键 / 恢复默认。
    // 改键后 rebuildMenu() 立即重建应用菜单生效;updateSettings 会顺带落盘并广播
    // update-settings 给所有窗口(含设置页),设置页 mobx 自动刷新,无需额外刷新通道。
    this.registerShortcutIpc();
    startupMark('main.application.shortcut_ipc.registered');
    // 普通网页 window.close():只关闭发起调用的 BrowserView 标签。
    // 不接收 renderer 传来的 tab id，始终按 sender 定位，防止网页关闭其它标签。
    ipcMain.on('web-page-window-close', (e) => {
      const appWindow = this.windows.findByBrowserView(e.sender.id);
      if (!appWindow || e.sender.isDestroyed()) return;
      const view = appWindow.viewManager.findViewByWebContentsId(e.sender.id);
      if (view) view.requestCloseFromWebContents(e.sender.id);
      else appWindow.send('remove-tab', e.sender.id);
    });

    // preload 在 window.open 返回后登记 WindowProxy token。此时 createWindow
    // 已同步把真实子 WebContents 注册进 ViewManager，可按 opener 精确关联。
    ipcMain.on('web-page-popup-register', (e, token: string) => {
      e.returnValue = false;
      if (typeof token !== 'string' || token.length > 160) return;

      const appWindow = this.windows.findByBrowserView(e.sender.id);
      if (!appWindow) return;
      const openerFrame = e.sender.mainFrame;
      const target = appWindow.viewManager.findViewByOpener(
        openerFrame,
        (view) => !view.popupCloseToken,
      );
      if (!target) return;

      target.popupCloseToken = token;
      e.returnValue = true;
    });

    ipcMain.on('web-page-popup-close', (e, token: string) => {
      e.returnValue = false;
      if (typeof token !== 'string' || token.length > 160) return;

      const appWindow = this.windows.findByBrowserView(e.sender.id);
      if (!appWindow) return;
      const openerFrame = e.sender.mainFrame;
      const target = appWindow.viewManager.findViewByOpener(
        openerFrame,
        (view) => view.popupCloseToken === token,
      );
      if (!target) return;

      target.requestCloseFromPage();
      e.returnValue = true;
    });

    ipcMain.on(
      'native-blank-popup-message-to-opener',
      (e, popupContentsId: number, message: unknown, targetOrigin: string) => {
        if (
          !Number.isInteger(popupContentsId) ||
          typeof targetOrigin !== 'string'
        ) return;
        this.nativeBlankPopups.relayToOpener(
          e.sender,
          popupContentsId,
          message,
          targetOrigin,
        );
      },
    );

    ipcMain.on('native-blank-popup-is-opener-closed', (e, popupContentsId: number) => {
      e.returnValue = true;
      if (!Number.isInteger(popupContentsId)) return;
      e.returnValue = this.nativeBlankPopups.isOpenerClosed(
        e.sender,
        popupContentsId,
      );
    });

    ipcMain.on('native-blank-popup-close', (e, popupContentsId: number) => {
      if (!Number.isInteger(popupContentsId)) return;
      this.nativeBlankPopups.closeFromOverlay(e.sender, popupContentsId);
    });

    // 鼠标右键手势:下发动作目录/预设形状/绑定 + 保存/恢复 + 同步配置 + 识别后执行。
    // 配置经主进程 frame.executeJavaScript 注入到每个帧(含跨源子帧/沙箱扩展页),
    // 变更时广播重注入(见 broadcastGestureConfig)。
    this.registerGestureIpc();
    startupMark('main.application.gesture_ipc.registered');
    // 划词翻译:网页选中文本 → preload 判定 → 主进程翻译 → 卡片回显。
    // 配置变更同样用专门的 selection-translate-config-changed 广播到所有 view。
    this.registerSelectionTranslateIpc();
    startupMark('main.application.selection_translate_ipc.registered');
    // 默认浏览器:状态查询 / 设为默认(写注册表 + 打开系统设置)。
    registerDefaultBrowserIpc();
    startupMark('main.application.lifecycle_handlers.end');
    void this.onReady();
  }

  private async handleSecondInstance(argv: string[]) {
    const incognito = argv.includes('--incognito');
    const findExistingWindow = () =>
      findSecondInstanceWindow({
        incognito,
        current: this.windows.current,
        lastFocused: this.windows.lastFocused,
        list: this.windows.list,
      });

    startupMark('main.second_instance.received', {
      appMode: !!parseAppModeFromArgv(argv),
      incognito,
      navigation: !!getStartupNavigationUrl(argv),
    });
    const requestedProfile = parseProfileArgument(argv);
    if (
      requestedProfile.present &&
      requestedProfile.name &&
      requestedProfile.name === activeProfileName
    ) {
      const existing = findExistingWindow();
      if (existing) existing.showAndFocus();
      else this.windows.open(incognito);
      return;
    }

    const appMode = parseAppModeFromArgv(argv);
    if (appMode) {
      const meta = getInstalledMeta(appMode.url);
      openAppModeWindow({
        url: appMode.url,
        name: meta?.name || appMode.name,
        icon: meta?.iconPath || appMode.icon,
        themeColor: meta?.themeColor,
      });
      return;
    }

    if (incognito) {
      const existing = findExistingWindow();
      if (existing) {
        existing.showAndFocus();
      } else {
        this.windows.open(true);
      }
      return;
    }

    const startupUrl = getStartupNavigationUrl(argv);
    if (startupUrl) {
      const existing = findExistingWindow();
      // 应用模式冷启动没有普通浏览器窗口。把目标作为新窗口 initialUrl
      // 注入，让它走预创建/领养流程，避免 app.html 监听器尚未注册时丢 add-tab IPC。
      const target = existing || this.windows.open(incognito, startupUrl, true);
      target.showAndFocus();
      if (existing) {
        target.viewManager.create({url: startupUrl, active: true});
      }
      return;
    }

    const existing = findExistingWindow();
    if (existing) {
      existing.showAndFocus();
    } else {
      this.windows.open(incognito);
    }
  }

  private readonly onStartupCriticalReady = (event: Electron.IpcMainEvent) => {
    const owner = this.windows.list.find(
      (window) => window && window.win.webContents === event.sender,
    );
    if (!owner) return;
    startupMark('main.renderer.startup_critical_ready');
    this.ensureDeferredStartup('renderer-ready');
  };

  private enterWindowServiceablePhase() {
    if (this.startupPhase !== 'boot') return;
    this.startupPhase = 'window-serviceable';
    startupMark('main.startup_phase.window_serviceable');

    // Install the business handler as soon as SessionsService and a window are
    // available. Renderer completion is not required: URL launches can use the
    // pre-created View path, while focus-only launches can target the native window.
    singleInstanceCoordinator.setHandler((argv) => {
      void this.handleSecondInstance(argv);
    });

    ipcMain.on('startup-critical-ready', this.onStartupCriticalReady);
    this.startupCriticalReadyListening = true;

    // This timer belongs to the Application, not the first BrowserWindow. A
    // renderer crash or an early window close must not permanently cancel core
    // service registration for a later activate/reopen.
    this.deferredStartupFallback = setTimeout(
      () => this.ensureDeferredStartup('timeout'),
      30000,
    );
    this.deferredStartupFallback.unref?.();
  }

  // —— 首个真实标签就绪信号 ——
  // 云端服务(密码/书签同步、互联心跳、登录校验)原为固定 1500ms 延时启动,
  // 会与恢复会话首个网页的首字节竞争带宽(慢网络下首页 commit 被拖长数秒)。
  // View 的 did-finish-load 对前台 http(s) 页面调用 notifyFirstRealTabReady();等待方
  // 用 whenFirstRealTabReady()。8s 超时兜底覆盖离线/纯本地标签场景。
  public notifyFirstRealTabReady(url: string) {
    if (this.firstRealTabNotified) return;
    this.firstRealTabNotified = true;
    if (this.firstRealTabTimeout) {
      clearTimeout(this.firstRealTabTimeout);
      this.firstRealTabTimeout = null;
    }
    startupMark('main.first_real_tab.ready', {url: url.slice(0, 120)});
    const resolvers = this.firstRealTabResolvers;
    this.firstRealTabResolvers = [];
    for (const resolve of resolvers) resolve();
  }

  public whenFirstRealTabReady(): Promise<void> {
    if (this.firstRealTabNotified) return Promise.resolve();
    return new Promise((resolve) => {
      this.firstRealTabResolvers.push(resolve);
    });
  }

  private armFirstRealTabFallback() {
    if (this.firstRealTabTimeout || this.firstRealTabNotified) return;
    this.firstRealTabTimeout = setTimeout(() => {
      this.firstRealTabTimeout = null;
      if (!this.firstRealTabNotified) {
        startupMark('main.first_real_tab.fallback_timeout');
        this.notifyFirstRealTabReady('');
      }
    }, 8000);
    this.firstRealTabTimeout.unref?.();
  }

  private ensureDeferredStartup(trigger: DeferredStartupTrigger) {
    if (this.deferredStartupPromise) return this.deferredStartupPromise;

    this.startupPhase = 'deferred';
    if (this.deferredStartupFallback) {
      clearTimeout(this.deferredStartupFallback);
      this.deferredStartupFallback = null;
    }
    if (this.startupCriticalReadyListening) {
      ipcMain.removeListener(
        'startup-critical-ready',
        this.onStartupCriticalReady,
      );
      this.startupCriticalReadyListening = false;
    }

    startupMark('main.deferred_work.triggered', {trigger});
    this.deferredStartupPromise = this.runDeferredStartupWork().catch((error) => {
      console.error('[startup] deferred work failed', error);
      startupMark('main.deferred_work.failed', {trigger});
    });
    return this.deferredStartupPromise;
  }

  private loadStartupExtensions(attempt = 1) {
    void this.sessions.loadExtensions().catch((error) => {
      console.error(`[extensions] startup load attempt ${attempt} failed`, error);
      startupMark('main.extensions.load.retry_scheduled', {attempt});
      if (attempt >= 3) return;
      const retryTimer = setTimeout(
        () => this.loadStartupExtensions(attempt + 1),
        attempt === 1 ? 2000 : 10000,
      );
      retryTimer.unref?.();
    });
  }

  // 重建应用菜单(应用级,对所有窗口立即生效)。onReady 初次构建一次;用户在
  // 设置-快捷键改键后再次调用,让新 accelerator 立即生效。
  private rebuildMenu() {
    Menu.setApplicationMenu(getMainMenu());
    this.registerBossKeyShortcut();
    this.registerScreenshotShortcut();
  }

  /** Register screenshot as an OS-level shortcut so it works outside Rainsee. */
  private registerScreenshotShortcut() {
    for (const accelerator of this.screenshotAccelerators) {
      try {
        globalShortcut.unregister(accelerator);
      } catch {
        // Electron unregisters shortcuts automatically during shutdown.
      }
    }
    this.screenshotAccelerators = [];

    const accelerators = resolveAccelerators(
      'screenshot',
      this.settings.object.shortcuts || {},
    );
    for (const accelerator of accelerators) {
      if (!accelerator) continue;
      try {
        if (
          globalShortcut.register(accelerator, () => {
            void this.openDesktopScreenshot();
          })
        ) {
          this.screenshotAccelerators.push(accelerator);
        }
      } catch (error) {
        console.warn('[desktop-screenshot] shortcut register failed:', accelerator, error);
      }
    }
  }

  public async openDesktopScreenshot() {
    await this.desktopScreenshot.open();
  }

  public async handleScreenshotImageAction(
    action: 'search',
    dataURL: string,
  ) {
    const target = [
      this.windows.current,
      this.windows.lastFocused,
      ...this.windows.list,
    ].find((item) => item && !item.win.isDestroyed());
    if (!target || !dataURL) return false;

    const tempDir = join(app.getPath('temp'), 'rainsee-screenshot-actions');
    const filePath = join(
      tempDir,
      `screenshot-${process.pid}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.png`,
    );
    try {
      const image = nativeImage.createFromDataURL(dataURL);
      if (image.isEmpty()) return false;
      await fsPromises.mkdir(tempDir, { recursive: true });
      await fsPromises.writeFile(filePath, image.toPNG());

      target.showAndFocus();
      const result = await target.viewManager.handleImageFileAction(
        'image-search',
        filePath,
      );

      // 搜图页加载后才通过 CDP 读取文件,读完后清理临时文件。
      const cleanupDelay = 120000;
      const timer = setTimeout(() => {
        fsPromises.rm(filePath, { force: true }).catch(() => undefined);
      }, cleanupDelay);
      timer.unref?.();
      return result;
    } catch (error) {
      console.error('[desktop-screenshot] image action failed:', error);
      fsPromises.rm(filePath, { force: true }).catch(() => undefined);
      return false;
    }
  }

  /** 注册老板键的全局快捷键,窗口隐藏后仍可用。 */
  private registerBossKeyShortcut() {
    for (const accelerator of this.bossKeyAccelerators) {
      try {
        globalShortcut.unregister(accelerator);
      } catch {
        // 退出阶段可能已自动注销,忽略。
      }
    }
    this.bossKeyAccelerators = [];

    const accelerators = resolveAccelerators(
      'boss-key',
      this.settings.object.shortcuts || {},
    );
    for (const accelerator of accelerators) {
      if (!accelerator) continue;
      try {
        if (
          globalShortcut.register(accelerator, () => this.toggleBossKey())
        ) {
          this.bossKeyAccelerators.push(accelerator);
        }
      } catch (error) {
        console.warn('[boss-key] register failed:', accelerator, error);
      }
    }
  }

  /** 老板键:隐藏所有浏览器窗口到托盘并静音,再次触发或点击托盘恢复。 */
  public toggleBossKey() {
    const now = Date.now();
    // globalShortcut 与应用菜单 accelerator 在前台可能同时触发,合并为一次。
    if (now - this.bossKeyLastToggleAt < 120) return;
    this.bossKeyLastToggleAt = now;

    if (this.bossKeyHidden) {
      this.restoreFromBossKey();
      return;
    }

    this.bossKeyHidden = true;
    this.bossKeyMutedViewIds.clear();
    for (const appWindow of this.windows.list) {
      if (!appWindow || appWindow.win.isDestroyed()) continue;
      for (const view of appWindow.viewManager.views.values()) {
        try {
          if (!view.webContents.isAudioMuted()) {
            this.bossKeyMutedViewIds.add(view.id);
            view.webContents.setAudioMuted(true);
          }
        } catch {
          // 页面可能正在销毁,单页失败不阻断老板键。
        }
      }
      appWindow.win.hide();
    }

    this.ensureBossKeyTray();
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
  }

  private ensureBossKeyTray() {
    if (this.bossKeyTray && !this.bossKeyTray.isDestroyed()) return;
    const iconPath = join(
      app.getAppPath(),
      'static',
      'icons',
      'icon.png',
    );
    const icon = nativeImage.createFromPath(iconPath);
    this.bossKeyTray = new Tray(icon);
    this.bossKeyTray.setToolTip(`${app.name} - 已隐藏`);
    this.bossKeyTray.on('click', () => this.restoreFromBossKey());
    this.bossKeyTray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '显示窗口',
          click: () => this.restoreFromBossKey(),
        },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() },
      ]),
    );
  }

  private restoreFromBossKey() {
    if (!this.bossKeyHidden) return;
    this.bossKeyHidden = false;
    for (const appWindow of this.windows.list) {
      if (!appWindow || appWindow.win.isDestroyed()) continue;
      appWindow.win.show();
      for (const view of appWindow.viewManager.views.values()) {
        if (!this.bossKeyMutedViewIds.has(view.id)) continue;
        try {
          view.webContents.setAudioMuted(false);
        } catch {
          // 页面可能已销毁。
        }
      }
    }
    this.bossKeyMutedViewIds.clear();
    const target = this.windows.current || this.windows.lastFocused || this.windows.list[0];
    target?.showAndFocus();
    if (this.bossKeyTray && !this.bossKeyTray.isDestroyed()) {
      this.bossKeyTray.destroy();
    }
    this.bossKeyTray = null;
    if (process.platform === 'darwin' && app.dock) app.dock.show();
  }

  // 设置-快捷键 的三个 IPC:读取可配置动作列表 / 保存某动作的改键 / 恢复默认。
  private registerShortcutIpc() {
    ipcMain.handle('get-shortcut-actions', () => {
      const overrides = this.settings.object.shortcuts || {};
      return {
        categories: SHORTCUT_CATEGORIES,
        actions: SHORTCUT_ACTIONS.map((a) => ({
          id: a.id,
          label: a.label,
          category: a.category,
          defaults: a.defaults,
          accelerators: resolveAccelerators(a.id, overrides),
        })),
      };
    });

    // 捕获模式开关:进入捕获时让设置页 webContents 忽略应用菜单 accelerator,
    // 否则用户按下已绑定的组合(如 Ctrl+T)会先触发菜单动作,干扰按键捕获。
    // 捕获结束(或设置页关闭)时恢复。
    ipcMain.handle('shortcut-capture-mode', (e, on: boolean) => {
      try {
        (e.sender as any).setIgnoreMenuShortcuts(!!on);
      } catch {
        // 部分 webContents 可能不支持,忽略
      }
      return true;
    });

    ipcMain.handle(
      'set-shortcut',
      (_e, id: string, accelerators: string[]) => {
        if (!id || !Array.isArray(accelerators)) return false;
        this.settings.updateSettings({
          shortcuts: {
            ...(this.settings.object.shortcuts || {}),
            [id]: accelerators,
          },
        });
        this.rebuildMenu();
        return true;
      },
    );

    ipcMain.handle('reset-shortcut', (_e, id?: string) => {
      const next = { ...(this.settings.object.shortcuts || {}) };
      if (id) {
        delete next[id];
      } else {
        for (const k of Object.keys(next)) delete next[k];
      }
      this.settings.updateSettings({ shortcuts: next });
      this.rebuildMenu();
      return true;
    });

    // ===== 扩展命令(chrome.commands)改键(设置页「扩展命令」区块) =====
    // 读取所有扩展命令快照(shortcut=覆盖后当前生效;defaultShortcut=manifest 默认)。
    ipcMain.handle('get-extension-shortcuts', async () => {
      await this.settings.ready();
      return this.sessions.chromeExtensions.getExtensionCommandSnapshot(
        this.sessions.extensions,
      );
    });

    // 改键:内存立即生效 + 持久化。与 manifest 默认等价则不写覆盖(保持 settings 干净)。
    ipcMain.handle(
      'set-extension-shortcut',
      async (_e, extId: string, name: string, accel: string) => {
        if (!extId || !name || typeof accel !== 'string') return false;
        const snap = this.sessions.chromeExtensions.getExtensionCommandSnapshot(
          this.sessions.extensions,
        );
        const ext = snap.find((e: any) => e.id === extId);
        const cmd = ext?.commands?.find((c: any) => c.name === name);
        const sameAsDefault =
          !!cmd &&
          !!cmd.defaultShortcut &&
          this.normalizeAccel(cmd.defaultShortcut) === this.normalizeAccel(accel);
        // 内存立即生效(app-scoped before-input-event 表 + global globalShortcut 同步更新)
        this.sessions.chromeExtensions.setExtensionCommandOverride(extId, name, accel);
        // 持久化
        const next = { ...(this.settings.object.extensionShortcuts || {}) };
        const perExt = { ...(next[extId] || {}) };
        if (sameAsDefault) delete perExt[name];
        else perExt[name] = accel;
        if (Object.keys(perExt).length === 0) delete next[extId];
        else next[extId] = perExt;
        this.settings.updateSettings({ extensionShortcuts: next });
        return true;
      },
    );

    // 恢复:删 settings 覆盖 + 清 overrides + reloadExtension 重 processExtension 恢复默认。
    ipcMain.handle(
      'reset-extension-shortcut',
      async (_e, extId: string, name?: string) => {
        if (!extId) return false;
        const next = { ...(this.settings.object.extensionShortcuts || {}) };
        if (name) {
          const perExt = { ...(next[extId] || {}) };
          delete perExt[name];
          if (Object.keys(perExt).length === 0) delete next[extId];
          else next[extId] = perExt;
        } else {
          delete next[extId];
        }
        this.settings.updateSettings({ extensionShortcuts: next });
        // 清 overrides,使 reload 后 processExtension 恢复 manifest 默认
        this.sessions.chromeExtensions.clearExtensionCommandOverride(extId, name);
        await this.sessions.reloadExtension(extId);
        return true;
      },
    );
  }

  // 鼠标右键手势:下发动作目录/预设形状/绑定 + 保存/恢复 + 同步配置 + 识别后执行。
  private registerGestureIpc() {
    // 设置页:拉取动作目录 + 预设形状 + 每个动作的当前/默认 shape。
    ipcMain.handle('get-gesture-actions', () => {
      const overrides = this.settings.object.mouseGestures || {};
      const gestureConfig = buildGestureConfig(this.settings.object);
      return {
        categories: GESTURE_CATEGORIES,
        actions: GESTURE_ACTIONS,
        presets: PRESET_SHAPES,
        bindings: GESTURE_ACTIONS.map((a) => ({
          id: a.id,
          shape: effectiveShape(a.id, overrides),
          defaultShape: effectiveShape(a.id, undefined),
        })),
        leftActions: LEFT_GESTURE_ACTIONS,
        leftThreshold: this.settings.object.mouseLeftGestureThreshold,
        // Return the effective map so the settings UI shows the new default
        // (background open) even when an older profile omitted these fields.
        leftGestures: gestureConfig.leftMap,
      };
    });

    // 绑定/解绑某动作到形状(null = 显式解绑)。冲突由设置页下拉过滤保证。
    ipcMain.handle(
      'set-gesture',
      (_e, actionId: string, shape: string | null) => {
        if (!actionId) return false;
        const next = { ...(this.settings.object.mouseGestures || {}) };
        next[actionId] = shape;
        this.settings.updateSettings({ mouseGestures: next });
        this.broadcastGestureConfig();
        return true;
      },
    );

    // 恢复默认:删该动作覆盖(无 actionId 则全部恢复)。
    ipcMain.handle('reset-gesture', (_e, actionId?: string) => {
      const next = { ...(this.settings.object.mouseGestures || {}) };
      if (actionId) delete next[actionId];
      else for (const k of Object.keys(next)) delete next[k];
      this.settings.updateSettings({ mouseGestures: next });
      this.broadcastGestureConfig();
      return true;
    });

    // 启用开关 / 轨迹颜色。
    ipcMain.handle(
      'set-gesture-option',
      (_e, key: 'enabled' | 'leftEnabled' | 'color' | 'leftThreshold' | 'leftGesture' | 'leftOpenInBackground' | 'sideButton', value: any) => {
        if (key === 'enabled') {
          this.settings.updateSettings({ mouseGesturesEnabled: !!value });
        } else if (key === 'leftEnabled') {
          this.settings.updateSettings({ mouseLeftGesturesEnabled: !!value });
        } else if (key === 'color' && typeof value === 'string') {
          this.settings.updateSettings({ mouseGestureColor: value });
        } else if (key === 'leftThreshold' && typeof value === 'number' && Number.isFinite(value)) {
          this.settings.updateSettings({
            mouseLeftGestureThreshold: Math.max(8, Math.min(200, Math.round(value))),
          });
        } else if (key === 'leftOpenInBackground') {
          this.settings.updateSettings({
            mouseLeftGestureOpenInBackground: !!value,
          });
        } else if (key === 'leftGesture' && value && typeof value.direction === 'string') {
          const direction = value.direction.toUpperCase();
          if (!['U', 'D', 'L', 'R'].includes(direction)) return false;
          const next = {...(this.settings.object.mouseLeftGestures || {})};
          next[direction] = value.actionId == null || value.actionId === '' ? null : String(value.actionId);
          this.settings.updateSettings({mouseLeftGestures: next});
        } else if (key === 'sideButton' && value) {
          const button = String(value.button);
          if (!['3', '4'].includes(button)) return false;
          const next = {...(this.settings.object.mouseSideButtons || {})};
          next[button] = value.actionId == null || value.actionId === '' ? null : String(value.actionId);
          this.settings.updateSettings({mouseSideButtons: next});
        }
        this.broadcastGestureConfig();
        return true;
      },
    );

    // preload 识别出手势 → 执行对应动作。
    ipcMain.on('gesture-trigger', (_e, payload: { actionId: string; webContentsId: number }) => {
      if (!payload || !payload.actionId) return;
      try {
        this.runGestureAction(payload.actionId, payload.webContentsId);
      } catch (err) {
        console.warn('[gesture-trigger]', err);
      }
    });
  }

  // 把最新配置推给所有窗口的所有 view(view.webContents),preload 监听后刷新缓存。
  private broadcastGestureConfig() {
    const cfg = buildGestureConfig(this.settings.object);
    for (const appWindow of this.windows.list) {
      try {
        appWindow.viewManager.views.forEach((v) => {
          if (!v.webContents.isDestroyed()) {
            // 注入脚本(顶层+子帧)的配置是注入期快照,热更新靠重注入(版本戳去重)。
            v.reinjectGesture();
          }
        });
      } catch {
        // 窗口销毁中,忽略
      }
    }
  }

  // 划词翻译:同步下发配置 / 翻译请求路由回原 tab / 打开设置 / 保存触发广播。
  // update-settings 广播只到 WebUI 视图,到不了普通网页,故单独广播(同 gesture)。
  private registerSelectionTranslateIpc() {
    // 同步下发配置给 preload(每次导航 sendSync 一次,保证新鲜)。
    ipcMain.on('get-selection-translate-config-sync', (e) => {
      e.returnValue = buildSelectionTranslateConfig(this.settings.object);
    });

    // 设置页:开关 / 目标语言 / 翻译引擎 / 自定义 LLM 配置。保存后广播给所有 view。
    ipcMain.handle(
      'set-selection-translate-option',
      (
        _e,
        key:
          | 'enabled'
          | 'target'
          | 'panelEnabled'
          | 'wordCountEnabled'
          | 'engine'
          | 'customLlmConfig',
        value: any,
      ) => {
        let engineChanged = false;
        if (key === 'enabled') {
          this.settings.updateSettings({ selectionTranslateEnabled: !!value });
        } else if (key === 'panelEnabled') {
          this.settings.updateSettings({ selectionPanelEnabled: !!value });
        } else if (key === 'wordCountEnabled') {
          this.settings.updateSettings({ selectionWordCountEnabled: !!value });
        } else if (key === 'target' && typeof value === 'string' && value) {
          this.settings.updateSettings({ selectionTranslateTarget: value });
        } else if (key === 'engine') {
          this.settings.updateSettings({ translateEngine: value });
          engineChanged = true;
        } else if (key === 'customLlmConfig' && value && typeof value === 'object') {
          this.settings.updateSettings({ customLlmConfig: value });
          // 自定义配置变更仅对 custom-llm 引擎有意义;统一触发 redrive 简化判断。
          if (this.settings.object.translateEngine === 'custom-llm') {
            engineChanged = true;
          }
        }
        this.broadcastSelectionTranslateConfig();
        // 引擎/配置变更:让已开启翻译的标签立即换引擎重译(原地 revert + 重驱动)。
        if (engineChanged) {
          this.redriveActiveTranslations();
        }
        return true;
      },
    );

    const broadcastSiteRule = (host: string, hidden: boolean) => {
      for (const appWindow of this.windows.list) {
        appWindow.viewManager.views.forEach((view) => {
          if (!view.webContents.isDestroyed()) {
            view.webContents.send('selection-panel-site-rule-changed', host, hidden);
          }
        });
      }
    };

    ipcMain.handle('selection-panel-site-state', async (e) => {
      try {
        const host = new URL(e.sender.getURL()).hostname;
        if (!host) return false;
        const record = await this.storage.findOne<any>({
          scope: 'permissions',
          query: { url: host, permission: 'selection-panel', mediaTypes: '' },
        });
        return record?.type === 2;
      } catch {
        return false;
      }
    });

    ipcMain.handle('selection-panel-hide-site', async (e) => {
      try {
        const host = new URL(e.sender.getURL()).hostname;
        if (!host) return false;
        const query = {
          url: host,
          permission: 'selection-panel',
          mediaTypes: '',
        };
        const existing = await this.storage.findOne<any>({
          scope: 'permissions',
          query,
        });
        if (existing?._id) {
          await this.storage.update({
            scope: 'permissions',
            query: { _id: existing._id },
            value: { type: 2, mediaTypes: '' },
          });
        } else {
          await this.storage.insert({
            scope: 'permissions',
            item: { ...query, type: 2 },
          });
        }
        broadcastSiteRule(host, true);
        return true;
      } catch {
        return false;
      }
    });

    ipcMain.handle('selection-panel-hide-global', () => {
      this.settings.updateSettings({ selectionPanelEnabled: false });
      this.broadcastSelectionTranslateConfig();
      return true;
    });

    ipcMain.on(
      'selection-panel-rule-updated',
      (e, host: string, hidden: boolean) => {
        if (!e.sender.getURL().startsWith(getWebUIURL('settings'))) return;
        broadcastSiteRule(host, hidden);
      },
    );

    ipcMain.on('selection-panel-search', (e, text: string) => {
      if (typeof text !== 'string' || !text.trim()) return;
      const appWindow = this.windows.findByBrowserView(e.sender.id);
      const engine =
        this.settings.object.searchEngines?.[this.settings.object.searchEngine] ||
        this.settings.object.searchEngines?.[0];
      const keyword = encodeURIComponent(text.trim());
      const url = engine?.url
        ? engine.url.replace('%s', keyword)
        : `https://www.google.com/search?q=${keyword}`;
      appWindow?.viewManager.create({ url, active: true });
    });

    ipcMain.handle('selection-panel-copy', async (e, text: string) => {
      if (typeof text !== 'string' || text.length === 0) return false;
      if (!this.windows.findByBrowserView(e.sender.id)) return false;

      // The native clipboard can be temporarily locked by another process
      // (especially on Windows). Electron's writeText is fire-and-forget, so
      // verify the value and retry briefly instead of reporting false success.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          clipboard.writeText(text);
          if (clipboard.readText() === text) return true;
        } catch {
          // Retry after a short delay when the OS clipboard is unavailable.
        }
        if (attempt < 2) {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, 20 * (attempt + 1)),
          );
        }
      }
      return false;
    });

    ipcMain.on('selection-panel-more', (e, text: string) => {
      if (typeof text !== 'string' || !text.trim()) return;
      const appWindow = this.windows.findByBrowserView(e.sender.id);
      const view = appWindow?.viewManager.findViewByWebContentsId(e.sender.id);
      view?.showSelectionContextMenu(text);
    });

    // preload 判定选中文本需翻译 → 主进程翻译 → 按 webContentsId 路由回原 tab。
    // id 用于 preload 侧在途取消(快速重选时丢弃旧响应)。title/description 为页面语境,
    // 供 LLM 引擎消歧(微软引擎忽略)。
    ipcMain.on(
      'selection-translate-request',
      (_e, p: {
        id: number;
        text: string;
        target: string;
        webContentsId: number;
        title?: string;
        description?: string;
      }) => {
        if (!p || typeof p.text !== 'string' || !p.webContentsId) return;
        const wc = webContents.fromId(p.webContentsId);
        const reply = (payload: unknown) => {
          if (wc && !wc.isDestroyed()) {
            wc.send(`selection-translate-result-${p.webContentsId}`, payload);
          }
        };
        translateText(p.text, p.target || 'zh-CN', {
          title: p.title,
          description: p.description,
        })
          .then((text) => reply({ id: p.id, ok: true, text }))
          .catch((err) =>
            reply({ id: p.id, ok: false, error: String((err as Error)?.message || err) }),
          );
      },
    );

    // 文本选择卡片:开新标签打开对应设置项。
    ipcMain.handle(
      'selection-translate-open-settings',
      async (_e, highlight?: string) => {
        const appWindow = this.windows.current;
        if (!appWindow) return false;
        const params = new URLSearchParams({ section: 'selection-translate' });
        if (highlight === 'selectionWordCount') {
          params.set('highlight', highlight);
        }
        appWindow.viewManager.create({
          url: `${getWebUIURL('settings')}?${params.toString()}`,
          active: true,
        });
        return true;
      },
    );
  }

  // 把最新划词翻译配置推给所有窗口的所有 view,preload 监听后刷新缓存。
  private broadcastSelectionTranslateConfig() {
    const cfg = buildSelectionTranslateConfig(this.settings.object);
    for (const appWindow of this.windows.list) {
      try {
        appWindow.viewManager.views.forEach((v) => {
          if (!v.webContents.isDestroyed()) {
            v.webContents.send('selection-translate-config-changed', cfg);
          }
        });
      } catch {
        // 窗口销毁中,忽略
      }
    }
  }

  // 翻译引擎/自定义配置变更后,让所有"翻译已开启"的标签原地换引擎重译。
  // 复用 View.changeTranslationTarget 的 revert+redrive 路径(driveTranslate 会 abort
  // 旧在途请求并用新引擎重驱动)。
  private redriveActiveTranslations() {
    for (const appWindow of this.windows.list) {
      try {
        appWindow.viewManager.views.forEach((v) => {
          if (v.translateActive && !v.webContents.isDestroyed()) {
            v.changeTranslationTarget(v.translateTarget || 'zh-CN');
          }
        });
      } catch {
        // 窗口销毁中,忽略
      }
    }
  }

  // 主进程侧手势分发入口:供 view.ts 的 console-message 监听器调用。
  // 注入脚本(跨源子帧 + chrome-extension 顶层)无 ipcRenderer,改用 console.log
  // 作信号通道;view.ts 拦截 '__gesture_fire__:' 前缀后调这里,复用与 gesture-trigger
  // IPC 同一条执行路径。
  public dispatchGesture(actionId: string, webContentsId: number) {
    if (!actionId) return;
    console.log('[gesture-fire] dispatch actionId=' + actionId + ' wc=' + webContentsId);
    try {
      this.runGestureAction(actionId, webContentsId);
    } catch (err) {
      console.warn('[gesture-dispatch]', err);
    }
  }

  public dispatchLeftGesture(
    payload: { actionId: string; url: string; imageUrl?: string; isImage?: boolean; x?: number; y?: number },
    webContentsId: number,
  ) {
    const appWindow = this.windows.findByBrowserView(webContentsId);
    const wc = webContents.fromId(webContentsId);
    const action = payload.actionId;
    const url = payload.url;
    if (!appWindow || !wc || !url) return;
    if (/^javascript:/i.test(url)) return;
    if (action === 'copy') {
      if (payload.isImage && typeof payload.x === 'number' && typeof payload.y === 'number') {
        try {
          wc.copyImageAt(payload.x, payload.y);
          return;
        } catch (_) {
          // Blob/cross-frame images may not be available at the browser view point.
        }
      }
      clipboard.writeText(payload.isImage ? payload.imageUrl || url : url);
      return;
    }
    if (action === 'download') {
      wc.downloadURL(url);
      return;
    }
    if (action === 'open-left' || action === 'open-right' || action === 'open-left-background' || action === 'open-right-background') {
      appWindow.send('left-gesture-open-link', {
        url,
        side: action.includes('left') ? 'left' : 'right',
        active: !action.includes('background'),
      });
    }
  }

  // 手势动作分发:把手势 actionId 映射到已有的导航/标签/缩放调用。
  // 窗口/ViewManager 经 webContentsId 反查(findByBrowserView)。
  private runGestureAction(actionId: string, webContentsId: number) {
    const appWindow = this.windows.findByBrowserView(webContentsId);
    const wc = webContents.fromId(webContentsId);
    const viewManager = appWindow?.viewManager;
    const view = viewManager?.findViewByWebContentsId(webContentsId);
    switch (actionId) {
      case 'back':
        // 能后退就后退;否则关闭当前标签页。
        // tab.close() 优先返回来源页；没有来源页时再按用户设置选择接管标签。
        if (wc && wc.canGoBack()) {
          wc.goBack();
        } else {
          if (view) view.requestCloseFromWebContents(webContentsId);
          else appWindow?.send('remove-tab', webContentsId);
        }
        break;
      case 'forward':
        wc?.goForward();
        break;
      case 'reload':
        wc?.reload();
        break;
      case 'stop':
        wc?.stop();
        break;
      case 'home':
        view?.load(getWebUIURL('newtab'));
        break;
      case 'new-tab':
        viewManager?.create({
          url: getWebUIURL('newtab'),
          active: true,
        } as any);
        break;
      case 'close-tab':
        appWindow?.send('remove-tab', viewManager?.selectedId);
        break;
      case 'reopen-closed-tab':
        appWindow?.send('revert-closed-tab');
        break;
      case 'next-tab':
        appWindow?.webContents.send('select-next-tab');
        break;
      case 'previous-tab':
        appWindow?.webContents.send('select-previous-tab');
        break;
      case 'scroll-to-top':
        wc
          ?.executeJavaScript('window.scrollTo({top:0,behavior:"smooth"})')
          .catch(() => {});
        break;
      case 'scroll-to-bottom':
        wc
          ?.executeJavaScript(
            'window.scrollTo({top:document.documentElement.scrollHeight,behavior:"smooth"})',
          )
          .catch(() => {});
        break;
      case 'zoom-in':
        viewManager?.changeZoom('in');
        break;
      case 'zoom-out':
        viewManager?.changeZoom('out');
        break;
      case 'reset-zoom':
        viewManager?.resetZoom();
        break;
      case 'find-in-page':
        appWindow?.send('find');
        break;
      default:
        break;
    }
  }

  // accelerator 归一比较:与设置页 Shortcuts 组件的 normalizeAccel 同源逻辑。
  // 录制产出 'CmdOrCtrl+Shift+Y',manifest 默认常为 'Ctrl+Shift+Y';归一后比较才正确。
  private normalizeAccel(a: string): string {
    return a
      .replace(/CommandOrCtrl|CmdOrCtrl/g, 'Ctrl')
      .replace(/\bSuper\b|\bMeta\b/g, 'Win');
  }

  private initializePostWindowServices() {
    // These handlers only register IPC/timers and have no synchronous
    // dependency on the first renderer. Load them after the native window
    // exists so their parsing cannot delay BrowserWindow construction, while
    // the renderer is still loading its shell.
    void Promise.all([
      import(
        /* webpackChunkName: "post-window-extension-rpc" */
        './extension-service-handler'
      ),
      import(
        /* webpackChunkName: "post-window-network-rpc" */
        './network/network-service-handler'
      ),
      import(
        /* webpackChunkName: "post-window-tab-drag-preview" */
        './windows/tab-drag-preview'
      ),
      import(
        /* webpackChunkName: "post-window-tab-throttle" */
        './services/tab-throttle'
      ),
    ])
      .then(([extensionRpc, networkRpc, tabDragPreview, tabThrottle]) => {
        new extensionRpc.ExtensionServiceHandler();
        networkRpc.NetworkServiceHandler.get();
        tabDragPreview.setupTabDragPreview();
        tabThrottle.setupTabThrottle();
        startupMark('main.post_window_services.ready');
      })
      .catch((error) => {
        console.error('[startup] post-window services initialization failed', error);
      });
  }

  private async onReady() {
    startupMark('main.ready_pipeline.entered');
    app.commandLine.appendSwitch('lang', 'zh-CN');
    const readyTimer = startupTimer();
    startupMark('main.electron_ready.wait.begin');
    await app.whenReady();
    startupMark('main.electron_ready.wait.end', {durationMs: readyTimer()});
    // bootstrap-paths 已在 Electron ready 前完成数据迁移并确定 userData。这里等
    // ready 回调放行,确保失败提示已安排且任何数据库/会话/窗口都不会提前打开。
    const migrationTimer = startupTimer();
    startupMark('main.migration_gate.wait.begin');
    try {
      await migrationGate.promise;
    } catch {
      // gate 不会 reject(失败也 resolve 回退到旧目录),此处仅兜底。
    }
    startupMark('main.migration_gate.wait.end', {durationMs: migrationTimer()});

    // 解析一次冷启动目标。只有显式 HTTP(S) 目标会在 windows.open() 内立即
    // 导航，因此必须先等证书白名单。普通启动先加载本地 app.html，权限查询可与
    // 首窗创建并行，并会在 renderer 恢复网页标签前完成；本地文件同样无需等待。
    const startupUrl = getStartupNavigationUrl(process.argv);
    const startupNeedsCertificatePermissions =
      !!startupUrl && /^https?:/i.test(startupUrl);

    const preWindowServicesTimer = startupTimer();
    startupMark('main.pre_window_services.begin', {
      startupTarget: startupUrl ? (/^file:/i.test(startupUrl) ? 'file' : 'url') : 'none',
    });

    checkFiles();

    // 智能播放器窗口 IPC(数据/关闭/外部播放/复制/注入)
    setupMediaPlayer();
    // 看图模式 IPC(图片数据拉取 + zip 打包下载)
    setupImageViewerIPC();
    // 运行内存诊断:启动 20s 后自动打一份逐进程占用表到日志,`dump-memory-report` 可手动再打。
    setupMemoryReport();
    startupMark('main.pre_window_services.end', {
      durationMs: preWindowServicesTimer(),
    });
    const databaseTimer = startupTimer();
    startupMark('main.storage.open_databases.begin');
    // 只打开数据库句柄(便宜且同步),让 storage-* IPC 立即可用。
    // 书签/收藏/历史的内存缓存载入是启动重活,移到首屏渲染后(见 runDeferredStartupWork)。
    this.storage.openDatabases();
    startupMark('main.storage.open_databases.end', {durationMs: databaseTimer()});
    // certificate-error requires the persisted allow-list to be ready before
    // the first navigation can synchronously consult it.
    const certificatePermissionsReady = reloadCertificateErrorPermissions(this.storage).catch(
      () => undefined,
    );
    if (startupNeedsCertificatePermissions) {
      const certificateTimer = startupTimer();
      startupMark('main.certificate_permissions.wait.begin');
      await certificatePermissionsReady;
      startupMark('main.certificate_permissions.wait.end', {
        durationMs: certificateTimer(),
      });
    } else {
      void certificatePermissionsReady.then(() => {
        startupMark('main.certificate_permissions.loaded_deferred');
      });
    }
    // Sessions must be initialized before any window/view is created.
    // Opening a window triggers the renderer to create tabs (views-create-*),
    // and View's constructor reads Application.instance.sessions.view /
    // .chromeExtensions immediately. Creating sessions first avoids the race
    // that caused "Cannot read properties of undefined (reading 'view')".
    const sessionsTimer = startupTimer();
    startupMark('main.sessions.construct.begin');
    this.sessions = new SessionsService();
    startupMark('main.sessions.construct.end', {durationMs: sessionsTimer()});
    // Settings starts loading with Application construction. As soon as both
    // settings and sessions exist, install adblock before the renderer restores
    // real tabs; this avoids letting the first page escape request filtering.
    void this.settings
      .ready()
      .then(() => {
        this.settings.startDeferredNetworkServices();
        startupMark('main.deferred_adblock_services.started');
      })
      .catch((error) => {
        console.error('[startup] deferred adblock services failed', error);
      });
    // 立即开窗——首屏不依赖 storage 内存缓存(书签栏走 bookmarks-get IPC 且会响应
    // reload-bookmarks 刷新;历史页/搜索联想走 storage-get 直查 DB)。扩展加载、缓存
    // 载入与云端同步全部推迟到窗口绘制后,避免它们的磁盘/CPU/网络争抢首屏。
    //
    // --app=<url> 模式:从已安装 PWA 的桌面/开始菜单快捷方式冷启动时,只开独立应用窗口,
    // 不开浏览器外壳。
    // 无痕任务栏图标 + 开始菜单快捷方式(注册独立 AUMID,供右键「固定到任务栏」)。
    // 普通首窗延后到首屏后(runDeferredStartupWork):copyFileSync + writeShortcutLink 的
    // 同步 IO 与首屏争抢磁盘,且普通启动首窗用不到无痕图标。无痕首窗(--incognito 冷启动)
    // 的 BrowserWindow 构造需要 icon + setAppDetails,必须在此同步生成,故仅无痕时立即跑。
    const startIncognito = app.commandLine.hasSwitch('incognito');
    if (startIncognito) {
      try {
        ensureIncognitoIcon();
        installIncognitoShortcut();
      } catch (e) {
        console.error('[incognito-icon] startup ensure failed', e);
      }
    }

    const appMode = getAppModeFromCommandLine();
    if (appMode) {
      const meta = getInstalledMeta(appMode.url);
      const appModeWindow = openAppModeWindow({
        url: appMode.url,
        name: meta?.name || appMode.name,
        icon: meta?.iconPath || appMode.icon,
        themeColor: meta?.themeColor,
      });
      this.initializePostWindowServices();
      tlog('onReady: app-mode window opened');
      this.enterWindowServiceablePhase();
      // PWA has no app.html renderer and therefore never emits
      // startup-critical-ready. Its own DOM readiness enters the same deferred
      // pipeline as a normal browser window.
      appModeWindow.webContents.once('dom-ready', () => {
        startupMark('main.app_mode.dom_ready');
        this.ensureDeferredStartup('app-mode-ready');
      });

      app.on('activate', () => {
        // 应用模式下无浏览器窗口;dock 点击重开同一应用窗口。
        openAppModeWindow({
          url: appMode.url,
          name: meta?.name || appMode.name,
          icon: meta?.iconPath || appMode.icon,
          themeColor: meta?.themeColor,
        });
      });
      return;
    }

    // 首次启动引导：标志文件(userData/onboarding-done)不存在时弹全屏引导窗，
    // 完成/跳过后写标志；主窗在其后才创建显示。异常一律放行，不阻断进主界面。
    const onboardingTimer = startupTimer();
    startupMark('main.onboarding_check.begin');
    try {
      if (isOnboardingNeeded()) {
        const onboardingResult = await showOnboarding();
        if (onboardingResult === 'quit') {
          return;
        }
      }
    } catch (onboardingErr) {
      console.error('[onboarding] error', onboardingErr);
    }
    startupMark('main.onboarding_check.end', {durationMs: onboardingTimer()});

    // 冷启动带 --incognito(从固定的「无痕浏览」任务栏/开始菜单项首次启动):首窗即无痕。
    // 外部 HTML/URL 同时注入首窗,避免 renderer 等待设置和会话恢复后才开始加载。
    const windowTimer = startupTimer();
    startupMark('main.window.open.begin', {
      incognito: startIncognito,
      initialUrl: !!startupUrl,
    });
    const mainWindow = this.windows.open(
      startIncognito,
      startupUrl,
      !!startupUrl,
    );
    startupMark('main.window.open.end', {durationMs: windowTimer()});
    this.enterWindowServiceablePhase();
    this.initializePostWindowServices();
    mainWindow.webContents.once('did-finish-load', () => {
      startupMark('main.renderer.did_finish_load');
    });

    void certificatePermissionsReady;

    // The global screenshot shortcut must use persisted overrides on startup.
    const settingsTimer = startupTimer();
    startupMark('main.settings.ready.wait.begin');
    await this.settings.ready();
    startupMark('main.settings.ready.wait.end', {durationMs: settingsTimer()});
    this.rebuildMenu();

    app.on('activate', () => {
      if (this.windows.list.filter((x) => x !== null).length === 0) {
        this.windows.open();
      }
    });
  }

  // 启动关键路径之外的重活,首屏绘制后执行(见 onReady 的 deferStartupWork)。只跑一次。
  private async runDeferredStartupWork() {
    const deferredTimer = startupTimer();
    startupMark('main.deferred_work.begin');
    // 搜索弹窗保持常驻，但延后到主框架 dom-ready 后再创建。
    const dialogsTimer = startupTimer();
    try {
      this.dialogs.run();
      startupMark('main.deferred_dialogs.registered', {
        durationMs: dialogsTimer(),
      });
    } catch (error) {
      console.error('[startup] deferred dialogs registration failed', error);
      startupMark('main.deferred_dialogs.failed', {
        durationMs: dialogsTimer(),
      });
    }
    setTimeout(() => repairDevelopmentPwaShortcuts(), 1000);

    // 0) 普通首窗:无痕图标 + 开始菜单快捷方式延后到首屏后(无痕首窗已在 onReady 同步生成)。
    //    copyFileSync + shell.writeShortcutLink 是同步 IO,放首屏前会与渲染争抢磁盘。
    if (!app.commandLine.hasSwitch('incognito')) {
      setTimeout(() => {
        const shortcutTimer = startupTimer();
        try {
          ensureIncognitoIcon();
          installIncognitoShortcut();
        } catch (e) {
          console.error('[incognito-icon] deferred ensure failed', e);
        }
        startupMark('main.deferred_incognito_shortcut.finished', {
          durationMs: shortcutTimer(),
        });
      }, 1200);
    }

    // 1) 载入书签/收藏/历史内存缓存,完成后广播刷新书签栏(其首次 load 可能读到空缓存)。
    try {
      const cacheTimer = startupTimer();
      startupMark('main.storage.load_caches.begin');
      await this.storage.loadCaches();
      startupMark('main.storage.load_caches.end', {durationMs: cacheTimer()});
      this.windows.broadcast('reload-bookmarks');
    } catch (e) {
      console.error('deferred storage.loadCaches failed', e);
    }

    // 2) 扩展加载(膨胀清理 + SHIM 打补丁 + loadExtension + 启动 MV3 后台 SW)。
    // 之前在开窗前就 fire-and-forget,其磁盘/CPU 争抢首屏;现移到首屏之后。
    // loadExtensions() 幂等并与 renderer 的 load-extensions IPC 合流。
    if (process.env.ENABLE_EXTENSIONS) {
      startupMark('main.extensions.load.requested');
      // 先注入持久化的扩展命令改键覆盖:必须 await settings 就绪且在加载扩展前,
      // 否则 extension-loaded→processExtension 会用 manifest 默认值,用户改键被抢占。
      await this.settings.ready();
      try {
        this.sessions.chromeExtensions.applyExtensionCommandOverrides(
          this.settings.object.extensionShortcuts,
        );
      } catch (error) {
        console.error('[extensions] command overrides failed', error);
      }
      this.sessions.allowStartupExtensionLoad();
      this.loadStartupExtensions();
      // 扩展后台自动更新(与 Chrome 一致):启动后定时检查并升级。
      try {
        initExtensionAutoUpdater(this.sessions);
      } catch (error) {
        console.error('[extensions] auto-updater init failed', error);
      }
    }

    // 首个真实标签完成加载后才启动非关键服务。8s 兜底覆盖极慢或
    // 纯本地标签场景，避免后台服务永久不启动。
    this.armFirstRealTabFallback();
    void this.whenFirstRealTabReady().then(async () => {
      const servicesTimer = startupTimer();
      startupMark('main.deferred_network_cloud_services.begin');
      try {
        await this.settings.ready();
        const [
          autoUpdater,
          searchEngines,
          userAgentConfig,
          videoWhitelist,
        ] = await Promise.all([
          import(
            /* webpackChunkName: "deferred-auto-updater" */
            './services/auto-updater'
          ),
          import(
            /* webpackChunkName: "deferred-search-engines" */
            './services/search-engines'
          ),
          import(
            /* webpackChunkName: "deferred-user-agent-config" */
            './services/user-agent-config'
          ),
          import(
            /* webpackChunkName: "deferred-video-whitelist" */
            './services/video-player-whitelist'
          ),
        ]);

        // These services may issue network requests during initialization, so
        // keep their imports and first calls behind the same startup gate.
        autoUpdater.runAutoUpdaterService();
        searchEngines.runSearchEnginesService();
        videoWhitelist.runVideoPlayerWhitelistService();
        userAgentConfig.runUserAgentConfigService();
      } catch (error) {
        console.error('[startup] deferred network/cloud services failed', error);
      } finally {
        startupMark('main.deferred_network_cloud_services.end', {
          durationMs: servicesTimer(),
        });
      }
    });

    startupMark('main.deferred_work.scheduled_all', {
      durationMs: deferredTimer(),
      extensionsEnabled: !!process.env.ENABLE_EXTENSIONS,
    });
  }
}
