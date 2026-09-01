import './util-compat';
// 必须在 ./application 之前 import:统一 app.name 与 userData 路径(写到 data 目录,
// 不进系统 AppData)。Application 在 import 阶段就静态构造 Settings 并同步解析
// userData,故路径设置必须更早执行。详见 bootstrap-paths.ts。
import { activeProfileName, isNightly } from './bootstrap-paths';
// 必须在 ./application 之前 import:此时 userData 已由 bootstrap-paths 设好,
// 自初始化的文件日志会覆盖 console,从而捕获 Application 构造期间的全部输出与异常。
import { getLogDir } from './logger';
// 必须在 ./application 之前 import:data-location 创建 migrationGate(Settings.load
// 与 onReady 都 await 它)。文件复制已由 bootstrap-paths 在 ready 前完成,这里负责
// ready 后放行 gate 与展示失败提示。
import {
  runPendingMigrationIfAny,
  setupDataLocationIpc,
} from './data-location';
import { setupDataBackupIpc } from './data-backup';
import {
  ipcMain,
  app,
  webContents,
  shell,
  session,
  BrowserWindow,
  dialog,
  Menu,
} from 'electron';
import type { Session } from 'electron';
import { setIpcMain } from '~/common/rpc/electron';
setIpcMain(ipcMain);

// Must match electron-builder.json's appId. Windows uses this identity to bind
// the running process to Start menu and taskbar shortcuts. Without an explicit
// process AUMID, a pinned shortcut can be treated as stale when NSIS replaces
// the executable during an in-place update.
if (process.platform === 'win32') {
  // 本地 Electron 运行不能复用安装包的 AUMID。否则 Windows 会把安装版的
  // 快捷方式/任务栏激活请求路由到正在运行的未打包实例。
  app.setAppUserModelId(
    app.isPackaged
      ? 'com.rainsee.pcbrowser'
      : 'com.rainsee.pcbrowser.development',
  );
}

require('@electron/remote/main').initialize();

if (process.env.NODE_ENV === 'development') {
  require('source-map-support').install();
}

import { platform } from 'os';
import { Application } from './application';
import { getWebUIURL } from '~/common/webui-main';
import { startupMark, tlog } from './timing';
import { setupSearchAnnotatorIpc } from './services/search-annotator';
import { buildKoodoReaderUrl, filePathFromFileUrl } from '~/constants/files';
import { getExternalProtocol } from '~/utils/url';
import { applyPersistedFlagsBeforeReady, setupFlagsIpc } from './flags-service';
// side-effect import:注册「立即清除」/「立即退出」IPC + performClearOnExit 编排。
import './services/clear-on-exit';
import { readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { ChromeUserAgent } from './user-agent';
import { isHeavyUI } from './utils/hardware-profile';
import { setupProfilesIpc } from './profiles';
import { setupProfileNetworkIpc } from './profile-network';
import { normalizeAppLanguage, resolveAppLanguage } from '~/common/i18n';
import { getMainTranslator } from './i18n';
import { getNavigationContext } from './utils/navigation-context';

// 兼容旧的 `import { isNightly } from '..'`(src/main/windows/app.ts)。
export { isNightly };

(process.env as any)['ELECTRON_DISABLE_SECURITY_WARNINGS'] = true;

startupMark('main.index.execution.begin');
// Electron 会在 ready 时创建默认菜单。先清空，避免首窗出现默认菜单后再被
// Application.rebuildMenu() 替换；正式菜单仍会在 settings.ready() 后生成。
Menu.setApplicationMenu(null);
applyPersistedFlagsBeforeReady();

// 启动早期同步读一次 settings.json(与 flags-service 同一路径):硬件加速与
// --process-per-site 都必须在 app.ready 之前决定,共用这一次读取。
let persistedSettings: Record<string, any> = {};
let hasPersistedFile = false;
try {
  const settingsPath = resolve(app.getPath('userData'), 'settings.json');
  persistedSettings = JSON.parse(readFileSync(settingsPath, 'utf8')) || {};
  hasPersistedFile = true;
} catch {
  // 首次启动/无配置:persistedSettings 保持空对象,下面按机器档位给默认。
}

// Explicit language choices can be applied immediately. For `auto`, Electron's
// system locale is only reliable after app ready (before that getLocale APIs can
// report Chromium's en-US default); application.ts resolves it before opening
// the first BrowserWindow.
const startupLanguage = normalizeAppLanguage(persistedSettings.language);
if (startupLanguage !== 'auto') {
  app.commandLine.appendSwitch('lang', resolveAppLanguage(startupLanguage));
}

// 硬件加速:app.disableHardwareAcceleration() 必须在 app.ready 之前调用才能生效。
// - 用户显式设置过(settings.json 含 hardwareAcceleration 键)→ 遵从其值。
// - 未显式设置(首次启动/无该键)→ 按物理内存给默认:RAM≤8GB 关加速(去掉 GPU 进程
//   省 ~160MB),>8GB 开。实测关加速不影响弹窗透明(软件合成仍支持 alpha)。
//   运行时在设置页切换只落盘,真正生效要等下次启动。
// 注:webPreferences 里的 hardwareAcceleration 不是合法键(Electron 静默忽略),
// 全局 app.disableHardwareAcceleration() 才是官方且唯一能关掉 GPU 进程的做法。
const hwAccelEnabled =
  hasPersistedFile && 'hardwareAcceleration' in persistedSettings
    ? persistedSettings.hardwareAcceleration !== false
    : isHeavyUI();
if (!hwAccelEnabled) {
  app.disableHardwareAcceleration();
}

app.commandLine.appendSwitch('--enable-transparent-visuals');
app.commandLine.appendSwitch(
  'enable-features',
  'CSSColorSchemeUARendering, ImpulseScrollAnimations, ParallelDownloading',
);

// 禁用 Chromium 的"备用渲染进程"预热(SpareRendererForSitePerProcess)。
// 现象:扩展 MV3 service worker 启动期间(SW running-status-changed 到 stopping
// 之前)点击打开 popup,弹窗只显示一个加载不出内容的小方块,渲染进程报:
//   sandboxed_renderer.bundle.js script failed to run
//   TypeError: Cannot destructure property 'preloadScripts' of
//   'binding.startupData' as it is null.
// 根因:Chromium 会提前 fork 一个 spare 渲染进程备用。该进程是在 popup 的
// session/preload(startupData)就绪之前预热的,当 popup 窗口(sandbox:false)
// 复用了这个 spare 进程时,startupData 尚未通过 mojo 投递,sandbox bundle 解构
// 即崩溃。SW 进入 stopping 后会新起一个带完整 startupData 的进程,故之后又正常。
// 关掉 spare 预热,popup 窗口每次都新建进程并走完整初始化,消除该竞态。
app.commandLine.appendSwitch(
  'disable-features',
  'SpareRendererForSitePerProcess',
);

// [内存节省] --process-per-site:把「同一站点」的所有页面塌进同一个渲染进程,
// 而非默认的 process-per-site-instance。效果:同源 UI 页(app/search/preview/各弹窗)
// 合并到一个进程,React 框架只加载一次,省 ~150-190MB。代价:同一网站多标签共享进程
// (崩溃/安全隔离下降)。仅在「内存节省」(memorySaver,默认开)开启时启用。
// 注:合并进程会让透明弹窗 BrowserView 继承 app.html 的不透明底色 → 变白。已在
// PersistentDialog / dialogs-service 显式 setBackgroundColor('#00000000') 并在 dom-ready
// 后重涂,消除该副作用(见对应文件)。
// if (persistedSettings.memorySaver !== false) {
//   app.commandLine.appendSwitch('process-per-site');
// }

// 「重启后保持登录」由 SessionsService 在退出时按用户配置的主域名白名单处理。
// 不使用 Chromium 的 --persist-session-cookies:该开关会把所有站点的会话 Cookie
// 一并持久化，无法在用户重新登录时准确清理旧登录态。

if (process.env.NODE_ENV === 'development' && !activeProfileName) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}
startupMark('main.pre_ready_flags.applied', {
  hardwareAcceleration: hwAccelEnabled,
  persistedSettings: hasPersistedFile,
});

const applyGlobalUserAgent = (ses: Session) => {
  ses.setUserAgent(ChromeUserAgent);
};

app.userAgentFallback = ChromeUserAgent;
app.on('session-created', applyGlobalUserAgent);

// Debug: surface the full stack of any unhandled promise rejection in the main
// process. Helps pin down the recurring "An object could not be cloned" error
// seen during userscript install (likely an extension IPC carrying an
// uncloneable payload). console.log 已由 logger.ts 安全接管，正式版若原始
// stdout/stderr 已断开会自动降级为仅写文件，不再抛 EPIPE。
process.on('unhandledRejection', (reason: any) => {
  console.log(
    '[unhandledRejection]',
    reason && reason.stack ? reason.stack : reason,
  );
});

ipcMain.setMaxListeners(0);

ipcMain.on('startup-timing', (event, payload: any) => {
  const phase =
    typeof payload?.phase === 'string'
      ? payload.phase.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 100)
      : '';
  if (!phase) return;
  const details = payload?.details;
  startupMark(phase, {
    webContentsId: event.sender.id,
    ...(details && typeof details === 'object' && !Array.isArray(details)
      ? details
      : {}),
  });
});

// app.setAsDefaultProtocolClient('http');
// app.setAsDefaultProtocolClient('https');

const application = Application.instance;
startupMark('main.application.instance_ready');
startupMark('main.ipc_registration.begin');
setupSearchAnnotatorIpc();
setupFlagsIpc();
setupProfilesIpc();
setupProfileNetworkIpc();
setupDataLocationIpc();
setupDataBackupIpc();
startupMark('main.ipc_registration.end');
// bootstrap-paths 已在 ready 前完成迁移或安全回退。ready 后 resolve gate,
// 让阻塞的 Settings.load() / onReady() 继续,并在有失败记录时显示提示。
app.whenReady().then(() => {
  applyGlobalUserAgent(session.defaultSession);
  runPendingMigrationIfAny();
});
startupMark('main.application.start.call');
application.start();
startupMark('main.application.start.returned');

app.on('window-all-closed', () => {
  if (platform() !== 'darwin') {
    app.quit();
  }
});

// 兜底:任何退出路径(Alt+F4 / 系统菜单 / 关机等触发 app.quit)都强制销毁所有残留
// BrowserWindow。隐藏的辅助窗口(白屏覆盖层/扩展 popup/媒体播放器等)若仅 hide 不
// destroy,其渲染进程会延迟释放,导致主进程残留、单例锁 requestSingleInstanceLock
// 不释放,下次启动拿不到锁而秒退。destroy() 绕过 close 里的 preventDefault(如数据
// 迁移窗),确保进程真正终止。与 windows-service.quitIfNoBrowserWindows 配合覆盖
// 全部退出场景。
let quitCleanupComplete = false;
let quitCleanupPromise: Promise<void> | null = null;

app.on('before-quit', (event) => {
  if (quitCleanupComplete) return;

  // Keep the process alive until the split incognito extension context has
  // unloaded and Electron has finished clearing its storage. BrowserWindow
  // "closed" handlers enqueue the same cleanup asynchronously, so deleting the
  // partition immediately after destroy() races live extension/LevelDB handles.
  event.preventDefault();
  if (quitCleanupPromise) return;

  quitCleanupPromise = (async () => {
    // 先等待「退出时自动清理」中(close 事件触发)的窗口跑完。
    // 清理过程中用户再 Alt+F4 / 关机会进 before-quit,这里最多等 6s,
    // 与下方 endIncognitoSession 超时一致,避免清理 IO 卡死时无限阻塞退出。
    try {
      const clearingWindows = application.windows.list.filter(
        (w: any) => w.clearOnExitInProgress && !w.clearOnExitFinished,
      );
      if (clearingWindows.length > 0) {
        await Promise.race([
          Promise.all(
            clearingWindows.map((w: any) => w.clearOnExitDonePromise),
          ),
          new Promise<void>((resolve) => setTimeout(resolve, 6000)),
        ]);
      }
    } catch {
      // 等待失败不阻断退出
    }

    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        try {
          win.destroy();
        } catch {
          // 单个窗口销毁失败不阻断退出
        }
      }
    }

    // 会话 Cookie 持久化:仅处理用户手动添加的主域名。8s 超时兜底,避免 Cookie
    // IO 异常卡死退出。Cookie 挂在 process-scoped 的 session 上,window 已 destroy
    // 不影响读取。
    try {
      await Promise.race([
        application.sessions.persistSessionCookies(),
        new Promise<void>((resolve) => setTimeout(resolve, 8000)),
      ]);
    } catch (error) {
      console.error('[cookies] persist on quit failed', error);
    }

    // Cap the wait: endIncognitoSession takes a process lock, and if it never
    // releases we must not strand the process on exit. The 6s ceiling lets the
    // rmSync below + startup clearCache('incognito') remain the fallback. The
    // promise is caught inline so a late rejection (after the timeout wins the
    // race) cannot surface as an unhandled rejection.
    await Promise.race([
      application.sessions.endIncognitoSession().catch((error) => {
        console.error('[incognito] quit cleanup failed', error);
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 6000)),
    ]);

    // The Electron session object remains process-scoped, so directory removal
    // is still best-effort on Windows. It now runs only after extension unload +
    // clearStorageData; startup cleanup remains the crash/locked-file fallback.
    try {
      rmSync(join(app.getPath('userData'), 'Partitions', 'view_incognito'), {
        recursive: true,
        force: true,
      });
    } catch (error) {
      console.error('[incognito] partition removal failed', error);
    }
  })().finally(() => {
    quitCleanupComplete = true;
    app.quit();
  });
});

ipcMain.on('get-webcontents-id', (e) => {
  e.returnValue = e.sender.id;
});
ipcMain.on('get-extensions', (e) => {
  e.returnValue = application.sessions.extensions;
});

ipcMain.on('get-window-id', (e) => {
  const directId = Number((e.sender as any).windowId);
  if (Number.isFinite(directId) && directId > 0) {
    e.returnValue = directId;
    return;
  }

  // BrowserWindow.fromWebContents/getCurrentWindow do not resolve a
  // BrowserView's owner on newer Electron versions. Dialog renderers still
  // need the host id for their window-scoped IPC channels, so find the window
  // to which the sender's BrowserView is currently attached.
  const owner = BrowserWindow.getAllWindows().find((win) => {
    if (win.webContents.id === e.sender.id) return true;
    try {
      return win
        .getBrowserViews()
        .some((view) => view.webContents.id === e.sender.id);
    } catch {
      return false;
    }
  });
  e.returnValue = owner?.id ?? -1;
});

ipcMain.on('view-clear-tab-hover', (e, tabId: number) => {
  for (const appWindow of Application.instance.windows?.list || []) {
    if (appWindow.viewManager.getById(tabId)) {
      appWindow.send('clear-tab-hover');
      Application.instance.dialogs.getExistingPersistent('preview')?.hide();
      return;
    }
  }
});

ipcMain.handle(
  `web-contents-call`,
  async (e, { webContentsId, method, args = [] }) => {
    try {
      const appWindow =
        Application.instance.windows.findByBrowserView(webContentsId);
      const view =
        appWindow?.viewManager.findViewByWebContentsId(webContentsId);
      // window.open 覆盖标签保持原始 tab id；操作必须落到当前可见的 BrowserView。
      const wc = view?.webContents || webContents.fromId(webContentsId);
      // 地址栏与搜索建议通过 callViewMethod('loadURL') 进入这里。必须交给
      // View.load()，以便统一执行特殊域名重定向、扩展新标签页和导航状态逻辑。
      if (method === 'loadURL' && view && typeof args[0] === 'string') {
        view.load(args[0], args[1]);
        return;
      }
      if ('home' == method) {
        // 启动行为「打开特定页面」:主页按钮(及网络错误页"主页")前往配置网址,
        // 与 Ctrl+T / 新建标签页共用 settings.startupBehavior 同一真相源;否则回新标签页。
        const sb = Application.instance.settings.object.startupBehavior;
        const raw = sb.type === 'urls' && sb.url ? sb.url.trim() : '';
        const homeUrl = raw
          ? raw.includes('://')
            ? raw
            : `http://${raw}`
          : getWebUIURL('newtab');
        if (view) {
          view.load(homeUrl);
          return;
        }
        return await wc.loadURL(homeUrl);
      }
      const result = (wc as any)[method](...args);

      if (result) {
        if (result instanceof Promise) {
          return await result;
        }

        return result;
      }
    } catch (e) {
      return false;
    }
  },
);

// 地址栏剪贴板 JSON 的 bejson 快捷入口。由目标标签的 View 负责导航及页面注入,
// 保证 CodeMirror 异步挂载完成后再写入并触发格式化按钮。
ipcMain.handle(
  'open-clipboard-in-bejson',
  async (
    _e,
    { webContentsId, content }: { webContentsId: number; content: string },
  ) => {
    try {
      const appWindow =
        Application.instance.windows.findByBrowserView(webContentsId);
      const view =
        appWindow?.viewManager.findViewByWebContentsId(webContentsId);
      if (!view || typeof content !== 'string') return false;
      view.loadClipboardInBejson(content);
      return true;
    } catch {
      return false;
    }
  },
);

// 地址栏/搜索框输入外部协议(motrixnext://、thunder://、magnet:、mailto: 等)
// → 唤起系统默认应用,而非当搜索词或塞给 webContents.loadURL。仅放行真正的外部
// 协议(排除 http/file 等内部协议),避免被滥用打开任意 URL/可执行体。
ipcMain.on('open-external-url', async (_e, url: string) => {
  try {
    if (!url || typeof url !== 'string' || !getExternalProtocol(url)) return;
    await shell.openExternal(url);
  } catch (err) {
    console.error('[open-external-url] 唤起失败:', url, err);
    const t = getMainTranslator(
      Application.instance.settings?.object?.language,
    );
    dialog.showMessageBox({
      type: 'warning',
      title: t('dialogHintTitle'),
      message: t('notifOpenExternalFailed'),
      buttons: [t('confirm')],
    });
  }
});

// Opens the OS network settings — wired to the "检查网络" button on the
// network-error page (see static/pages/network-error.html).
ipcMain.handle('check-network', async () => {
  try {
    if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:network-status');
    } else if (process.platform === 'darwin') {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.network',
      );
    }
  } catch (e) {
    // best-effort; ignore if the settings URI can't be opened
  }
});

// 在系统文件管理器中打开日志目录(data/logs)。入口为设置页"关于"底部的
// "打开日志目录",便于排查问题时快速取回 main-*.log。
ipcMain.handle('open-log-dir', async () => {
  try {
    await shell.openPath(getLogDir());
  } catch (e) {
    // best-effort; ignore if the folder can't be opened
  }
});

// We need to prevent extension background pages from being garbage collected.
const backgroundPages: Electron.WebContents[] = [];
const crxVerbose = process.env.CRX_VERBOSE === '1';

app.on('web-contents-created', (e, webContents) => {
  try {
    tlog(
      `web-contents-created: type=${webContents.getType()} url=${webContents.getURL()}`,
    );
  } catch (err) {}

  if (webContents.getType() === 'backgroundPage')
    backgroundPages.push(webContents);

  // 拦截所有 webContents 的电子书文件导航 → 重定向到 koodoreader
  webContents.on('will-navigate', (event, url) => {
    const navigation = getNavigationContext(event, url);
    if (!navigation.isMainFrame) return;
    console.log('[file-nav] will-navigate url:', navigation.url);
    if (navigation.url.startsWith('file:///')) {
      const path = filePathFromFileUrl(navigation.url);
      const koodoUrl = buildKoodoReaderUrl(path);
      if (koodoUrl) {
        console.log(
          '[file-nav] will-navigate redirect to koodoreader:',
          koodoUrl,
        );
        event.preventDefault();
        webContents.loadURL(koodoUrl);
      }
    }
  });

  // Surface console output from extension pages (e.g. Tampermonkey's
  // ask.html install dialog) to the main process stdout for debugging.
  try {
    webContents.on(
      'console-message' as any,
      (_ev: any, level: any, message: any, line: any, sourceId: any) => {
        const url = webContents.getURL() || '';
        const isExtPage =
          webContents.getType() === 'backgroundPage' ||
          (sourceId && sourceId.startsWith('chrome-extension://')) ||
          url.startsWith('chrome-extension://');
        // 扩展背景页可能在每个 Port frame / webRequest 上输出诊断信息。默认只
        // 镜像错误，避免 console-message -> 主进程 -> 文件日志的高频跨进程链路。
        if (isExtPage && (crxVerbose || Number(level) >= 3)) {
          console.log(`[ext-page][${level}] ${message} (${sourceId}:${line})`);
        }
        // koodoreader 阅读器页面:preload 在导航期间执行,此时 getURL() 可能
        // 还是旧值/空。所以按 URL 或消息内容双重匹配,确保 preload 的
        // [koodo-preload] 日志能打到 stdout,不用 DevTools 即可排查。
        const msgStr = typeof message === 'string' ? message : String(message);
        if (
          url.startsWith('yjllq://web.koodoreader.com/') ||
          msgStr.includes('[koodo') ||
          (sourceId && sourceId.includes('web.koodoreader.com'))
        ) {
          console.log(`[koodo-page][${level}] ${msgStr} (${sourceId}:${line})`);
        }
      },
    );
  } catch (err) {
    // best-effort
  }
});
