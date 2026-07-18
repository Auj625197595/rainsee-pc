import { app, ipcMain, Menu, webContents } from 'electron';
import { isAbsolute, extname } from 'path';
import { existsSync } from 'fs';

// PDF Drag-Drop: 验证主进程是否加载新代码
console.log('[PDF Drag-Drop] *** MAIN PROCESS STARTED - NEW CODE LOADED ***');

import { SessionsService } from './sessions-service';
import { initExtensionAutoUpdater } from './extension-updater';
import { checkFiles } from '~/utils/files';
import {buildKoodoReaderUrl} from '~/constants/files';
import { Settings } from './models/settings';
import { isOnboardingNeeded, showOnboarding } from './onboarding';
import { translateText } from './services/translate';

// 划词翻译下发给 preload 的精简配置(开关 + 目标语言)。
// 用结构化类型,免 import ISettings;settings.object 结构兼容即可。
const buildSelectionTranslateConfig = (s: {
  selectionTranslateEnabled?: boolean;
  selectionTranslateTarget?: string;
}) => ({
  enabled: s.selectionTranslateEnabled !== false,
  target:
    typeof s.selectionTranslateTarget === 'string' && s.selectionTranslateTarget
      ? s.selectionTranslateTarget
      : 'zh-CN',
});
import { isURL, prefixHttp } from '~/utils';
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
} from './menus/gesture-actions';
import { getWebUIURL } from '~/common/webui-main';
import { runAutoUpdaterService, registerDefaultBrowserIpc, runSearchEnginesService, runVideoPlayerWhitelistService } from './services';
import {
  openAppModeWindow,
  getAppModeFromCommandLine,
  parseAppModeFromArgv,
} from './windows/app-mode';
import {getInstalledMeta} from './services/pwa';
import { DialogsService } from './services/dialogs-service';
import { requestAuth } from './dialogs/auth';
import { NetworkServiceHandler } from './network/network-service-handler';
import { ExtensionServiceHandler } from './extension-service-handler';
import { setupMediaPlayer } from './windows/media-player';
import { setupImageViewerIPC } from './services/image-viewer';
import { setupTabDragPreview } from './windows/tab-drag-preview';
import { setupMemoryReport } from './services/memory-report';
import { setupTabThrottle } from './services/tab-throttle';
import { tlog } from './timing';
import { migrationGate } from './data-location';

export class Application {
  public tempTabUrl = "";
  
  public static instance = new Application();

  public sessions: SessionsService;

  public settings = new Settings();

  public storage = new StorageService();

  public windows = new WindowsService();

  public dialogs = new DialogsService();

  public start() {
    const gotTheLock = app.requestSingleInstanceLock();
 tlog('test -21');
    if (!gotTheLock) {
       tlog('test -22');
      app.quit();
      return;
    } else {
       tlog('test -23');
      app.on('second-instance', async (e, argv) => {
        // 已安装 PWA 的快捷方式二次启动(--app=<url>):开独立应用窗口,不开浏览器。
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

        const path = argv[argv.length - 1];

        if (isAbsolute(path) && existsSync(path)) {
          if (process.env.NODE_ENV !== 'development') {
            const path = argv[argv.length - 1];
            const ext = extname(path).toLowerCase().slice(1);

            if (ext === 'html' || ext === 'htm') {
              this.windows.current.showAndFocus();
              this.windows.current.viewManager.create({
                url: `file:///${path.replace(/\\/g, '/')}`,
                active: true,
              });
            } else {
              // koodoreader 支持的电子书格式 → 阅读器直开
              const koodoUrl = buildKoodoReaderUrl(path);
              if (koodoUrl) {
                this.windows.current.showAndFocus();
                this.windows.current.viewManager.create({
                  url: koodoUrl,
                  active: true,
                });
              }
            }
          }
          return;
        } else if (isURL(path)) {
          this.windows.current.showAndFocus();
          this.windows.current.viewManager.create({
            url: prefixHttp(path),
            active: true,
          });
          return;
        }

        this.windows.open();
      });
    }
 tlog('test -24');
    app.on('login', async (e, webContents, request, authInfo, callback) => {
      e.preventDefault();

      const window = this.windows.findByBrowserView(webContents.id);
      const credentials = await requestAuth(
        window.win,
        request.url,
        webContents.id,
      );

      if (credentials) {
        callback(credentials.username, credentials.password);
      }
    });

    ipcMain.on('create-window', (e, incognito = false) => {
      this.windows.open(incognito);
    });
 tlog('test -1');
    // 快捷键设置:下发可配置动作列表 / 保存用户改键 / 恢复默认。
    // 改键后 rebuildMenu() 立即重建应用菜单生效;updateSettings 会顺带落盘并广播
    // update-settings 给所有窗口(含设置页),设置页 mobx 自动刷新,无需额外刷新通道。
    this.registerShortcutIpc();
 tlog('test -2');
    // 普通网页 window.close():只关闭发起调用的 BrowserView 标签。
    // 不接收 renderer 传来的 tab id，始终按 sender 定位，防止网页关闭其它标签。
    ipcMain.on('web-page-window-close', (e) => {
      const appWindow = this.windows.findByBrowserView(e.sender.id);
      if (!appWindow || e.sender.isDestroyed()) return;
      appWindow.send('remove-tab', e.sender.id);
    });

    // 鼠标右键手势:下发动作目录/预设形状/绑定 + 保存/恢复 + 同步配置 + 识别后执行。
    // 配置经主进程 frame.executeJavaScript 注入到每个帧(含跨源子帧/沙箱扩展页),
    // 变更时广播重注入(见 broadcastGestureConfig)。
    this.registerGestureIpc();
 tlog('test -3');
    // 划词翻译:网页选中文本 → preload 判定 → 主进程翻译 → 卡片回显。
    // 配置变更同样用专门的 selection-translate-config-changed 广播到所有 view。
    this.registerSelectionTranslateIpc();
 tlog('test -4');
    // 默认浏览器:状态查询 / 设为默认(写注册表 + 打开系统设置)。
    registerDefaultBrowserIpc();
 tlog('test -5');
    this.onReady();
  }

  // 重建应用菜单(应用级,对所有窗口立即生效)。onReady 初次构建一次;用户在
  // 设置-快捷键改键后再次调用,让新 accelerator 立即生效。
  private rebuildMenu() {
    Menu.setApplicationMenu(getMainMenu());
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
      return {
        categories: GESTURE_CATEGORIES,
        actions: GESTURE_ACTIONS,
        presets: PRESET_SHAPES,
        bindings: GESTURE_ACTIONS.map((a) => ({
          id: a.id,
          shape: effectiveShape(a.id, overrides),
          defaultShape: effectiveShape(a.id, undefined),
        })),
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
      (_e, key: 'enabled' | 'color', value: any) => {
        if (key === 'enabled') {
          this.settings.updateSettings({ mouseGesturesEnabled: !!value });
        } else if (key === 'color' && typeof value === 'string') {
          this.settings.updateSettings({ mouseGestureColor: value });
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

    // 设置页:开关 / 目标语言。保存后广播给所有 view。
    ipcMain.handle(
      'set-selection-translate-option',
      (_e, key: 'enabled' | 'target', value: any) => {
        if (key === 'enabled') {
          this.settings.updateSettings({ selectionTranslateEnabled: !!value });
        } else if (key === 'target' && typeof value === 'string' && value) {
          this.settings.updateSettings({ selectionTranslateTarget: value });
        }
        this.broadcastSelectionTranslateConfig();
        return true;
      },
    );

    // preload 判定选中文本需翻译 → 主进程翻译 → 按 webContentsId 路由回原 tab。
    // id 用于 preload 侧在途取消(快速重选时丢弃旧响应)。
    ipcMain.on(
      'selection-translate-request',
      (_e, p: { id: number; text: string; target: string; webContentsId: number }) => {
        if (!p || typeof p.text !== 'string' || !p.webContentsId) return;
        const wc = webContents.fromId(p.webContentsId);
        const reply = (payload: unknown) => {
          if (wc && !wc.isDestroyed()) {
            wc.send(`selection-translate-result-${p.webContentsId}`, payload);
          }
        };
        translateText(p.text, p.target || 'zh-CN')
          .then((text) => reply({ id: p.id, ok: true, text }))
          .catch((err) =>
            reply({ id: p.id, ok: false, error: String((err as Error)?.message || err) }),
          );
      },
    );

    // 卡片齿轮:开新标签打开设置-划词翻译。
    ipcMain.handle('selection-translate-open-settings', async () => {
      const appWindow = this.windows.current;
      if (!appWindow) return false;
      appWindow.viewManager.create({
        url: `${getWebUIURL('settings')}?section=selection-translate`,
        active: true,
      });
      return true;
    });
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

  // 手势动作分发:把手势 actionId 映射到已有的导航/标签/缩放调用。
  // 窗口/ViewManager 经 webContentsId 反查(findByBrowserView)。
  private runGestureAction(actionId: string, webContentsId: number) {
    const appWindow = this.windows.findByBrowserView(webContentsId);
    const wc = webContents.fromId(webContentsId);
    const viewManager = appWindow?.viewManager;
    switch (actionId) {
      case 'back':
        // 能后退就后退;否则关闭当前标签页。
        // tab.close() 在关闭「当前选中标签」时会自动选中左侧标签(见 models/tab.ts),
        // 故等价于「退到上一个标签页」。
        if (wc && wc.canGoBack()) {
          wc.goBack();
        } else {
          appWindow?.send('remove-tab', webContentsId);
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
        wc?.loadURL(getWebUIURL('newtab'));
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

  private async onReady() {
    tlog('onReady: entered (before whenReady)');
    app.commandLine.appendSwitch('lang', 'zh-CN');
    await app.whenReady();
    tlog('onReady: app.whenReady() resolved');

    // 等待数据迁移完成(若有 pending):迁移会切换 userData 并复制旧目录数据,
    // 必须在打开任何数据库/会话/窗口之前完成。无 pending 时 gate 立即 resolve。
    try {
      await migrationGate.promise;
    } catch {
      // gate 不会 reject(失败也 resolve 回退到旧目录),此处仅兜底。
    }
    tlog('onReady: migrationGate resolved');

    new ExtensionServiceHandler();

    NetworkServiceHandler.get();

    checkFiles();

    // 设备参数(开源版无账号模块,返回默认值)。供新标签页 URL 拼接
    // (common/newtab-url.ts appendDeviceParams),仅对 pcapp.rainsee.cn 生效;
    // 开源版默认新标签页非该域,参数实际不拼接,留 handler 仅为兼容渲染端调用。
    ipcMain.handle('get-device-params', () => ({
      ck: '',
      devid: '',
      prod: process.platform === 'darwin' ? 'mac' : 'windows',
      lang: app.getLocale() || 'zh-CN',
    }));

    // 智能播放器窗口 IPC(数据/关闭/外部播放/复制/注入)
    setupMediaPlayer();
    // 看图模式 IPC(图片数据拉取 + zip 打包下载)
    setupImageViewerIPC();
    // 标签撕离拖拽时跟随光标的预览窗口 IPC
    setupTabDragPreview();
    // 运行内存诊断:启动 20s 后自动打一份逐进程占用表到日志,`dump-memory-report` 可手动再打。
    setupMemoryReport();
    // 后台标签轻量节流(仅内存节省开启时生效):闲置 30min 的后台标签释放内存缓存。
    setupTabThrottle();

    tlog('onReady: before storage.openDatabases()');
    // 只打开数据库句柄(便宜且同步),让 storage-* IPC 立即可用。
    // 书签/收藏/历史的内存缓存载入是启动重活,移到首屏渲染后(见 runDeferredStartupWork)。
    this.storage.openDatabases();
    tlog('onReady: storage.openDatabases() done');
    this.dialogs.run();

    // Sessions must be initialized before any window/view is created.
    // Opening a window triggers the renderer to create tabs (views-create-*),
    // and View's constructor reads Application.instance.sessions.view /
    // .chromeExtensions immediately. Creating sessions first avoids the race
    // that caused "Cannot read properties of undefined (reading 'view')".
    this.sessions = new SessionsService();
    tlog('onReady: SessionsService constructed');

    // 预热 pcapp.rainsee.cn 连接(DNS/TCP/TLS),与新标签页 webui 壳的 bundle 下载/解析并行,
    // 让壳里内嵌 pcapp 的 iframe 挂载时连接已就绪、省去握手白屏。必须用 view session
    // (persist:view)——BrowserView 的网络走该分区 socket pool,defaultSession 预热不生效。
    // best-effort:预热失败不影响后续加载。
    try {
      this.sessions.view.preconnect({ url: 'https://pcapp.rainsee.cn', numSockets: 1 });
    } catch (e) {
      tlog('onReady: pcapp preconnect failed', e);
    }

    // 立即开窗——首屏不依赖 storage 内存缓存(书签栏走 bookmarks-get IPC 且会响应
    // reload-bookmarks 刷新;历史页/搜索联想走 storage-get 直查 DB)。扩展加载、缓存
    // 载入与云端同步全部推迟到窗口绘制后,避免它们的磁盘/CPU/网络争抢首屏。
    //
    // --app=<url> 模式:从已安装 PWA 的桌面/开始菜单快捷方式冷启动时,只开独立应用窗口,
    // 不开浏览器外壳。
    const appMode = getAppModeFromCommandLine();
    if (appMode) {
      const meta = getInstalledMeta(appMode.url);
      openAppModeWindow({
        url: appMode.url,
        name: meta?.name || appMode.name,
        icon: meta?.iconPath || appMode.icon,
        themeColor: meta?.themeColor,
      });
      tlog('onReady: app-mode window opened');
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

    const mainWindow = this.windows.open();
    tlog('onReady: windows.open() returned');

    this.rebuildMenu();

    // 首屏渲染后再跑启动重活(storage 缓存载入、扩展加载、云端同步)。
    // 用主窗口外壳「加载完成」作为信号;若该事件迟迟不来(异常),用 1.5s 兜底,
    // 保证这些工作最终都会执行。
    let deferred = false;
    const deferStartupWork = () => {
      if (deferred) return;
      deferred = true;
      this.runDeferredStartupWork();
    };
    mainWindow.webContents.once('did-finish-load', () => setTimeout(deferStartupWork, 0));
    setTimeout(deferStartupWork, 1500);

    app.on('activate', () => {
      if (this.windows.list.filter((x) => x !== null).length === 0) {
        this.windows.open();
      }
    });
  }

  // 启动关键路径之外的重活,首屏绘制后执行(见 onReady 的 deferStartupWork)。只跑一次。
  private async runDeferredStartupWork() {
    // 1) 载入书签/收藏/历史内存缓存,完成后广播刷新书签栏(其首次 load 可能读到空缓存)。
    try {
      tlog('deferred: before storage.loadCaches()');
      await this.storage.loadCaches();
      tlog('deferred: storage.loadCaches() done');
      this.windows.broadcast('reload-bookmarks');
    } catch (e) {
      console.error('deferred storage.loadCaches failed', e);
    }

    // 2) 扩展加载(膨胀清理 + SHIM 打补丁 + loadExtension + 启动 MV3 后台 SW)。
    // 之前在开窗前就 fire-and-forget,其磁盘/CPU 争抢首屏;现移到首屏之后。
    // loadExtensions() 幂等并与 renderer 的 load-extensions IPC 合流。
    if (process.env.ENABLE_EXTENSIONS) {
      tlog('deferred: kicking off loadExtensions()');
      // 先注入持久化的扩展命令改键覆盖:必须 await settings 就绪且在加载扩展前,
      // 否则 extension-loaded→processExtension 会用 manifest 默认值,用户改键被抢占。
      await this.settings.ready();
      this.sessions.chromeExtensions.applyExtensionCommandOverrides(
        this.settings.object.extensionShortcuts,
      );
      this.sessions.loadExtensions().catch((e) => console.error(e));
      // 扩展后台自动更新(与 Chrome 一致):启动后定时检查并升级。
      initExtensionAutoUpdater(this.sessions);
    }

    // 3) 各类云端同步/更新检查——均为后台 fire-and-forget,移出首屏关键路径。
    runAutoUpdaterService();

    // 搜索引擎列表:启动时从云端同步一次(失败回退本地缓存),云端为搜索 URL 权威来源
    runSearchEnginesService();

    // 智能播放器白名单:启动时从云端同步一次,命中 host 不嗅探视频、不显示播放器图标
    runVideoPlayerWhitelistService();
  }
}
