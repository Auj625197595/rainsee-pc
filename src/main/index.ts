import './util-compat';
// 必须在 ./application 之前 import:统一 app.name 与 userData 路径(写到 data 目录,
// 不进系统 AppData)。Application 在 import 阶段就静态构造 Settings 并同步解析
// userData,故路径设置必须更早执行。详见 bootstrap-paths.ts。
import { isNightly } from './bootstrap-paths';
// 必须在 ./application 之前 import:此时 userData 已由 bootstrap-paths 设好,
// 自初始化的文件日志会覆盖 console,从而捕获 Application 构造期间的全部输出与异常。
import { getLogDir } from './logger';
// 必须在 ./application 之前 import:data-location 创建 migrationGate(Settings.load
// 与 onReady 都 await 它),并要求在 app.whenReady 之后由 index.ts 触发迁移。
import { runPendingMigrationIfAny, setupDataLocationIpc } from './data-location';
import { ipcMain, app, webContents, shell, session, BrowserWindow, dialog } from 'electron';
import type { Session } from 'electron';
import { setIpcMain } from '~/common/rpc/electron';
setIpcMain(ipcMain);

require('@electron/remote/main').initialize();

if (process.env.NODE_ENV === 'development') {
  require('source-map-support').install();
}

import { platform } from 'os';
import { Application } from './application';
import {getWebUIURL} from "~/common/webui-main";
import { tlog } from './timing';
import {setupSearchAnnotatorIpc} from './services/search-annotator';
import {buildKoodoReaderUrl, filePathFromFileUrl} from '~/constants/files';
import { getExternalProtocol } from '~/utils/url';
import { applyPersistedFlagsBeforeReady, setupFlagsIpc } from './flags-service';
import { readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { ChromeUserAgent } from './user-agent';
import { isHeavyUI } from './utils/hardware-profile';

// 兼容旧的 `import { isNightly } from '..'`(src/main/windows/app.ts)。
export { isNightly };

(process.env as any)['ELECTRON_DISABLE_SECURITY_WARNINGS'] = true;

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
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess');

// [内存节省] --process-per-site:把「同一站点」的所有页面塌进同一个渲染进程,
// 而非默认的 process-per-site-instance。效果:同源 UI 页(app/search/preview/各弹窗)
// 合并到一个进程,React 框架只加载一次,省 ~150-190MB。代价:同一网站多标签共享进程
// (崩溃/安全隔离下降)。仅在「内存节省」(memorySaver,默认开)开启时启用。
// 注:合并进程会让透明弹窗 BrowserView 继承 app.html 的不透明底色 → 变白。已在
// PersistentDialog / dialogs-service 显式 setBackgroundColor('#00000000') 并在 dom-ready
// 后重涂,消除该副作用(见对应文件)。
if (persistedSettings.memorySaver !== false) {
  app.commandLine.appendSwitch('process-per-site');
}

if (process.env.NODE_ENV === 'development') {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

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
  console.log('[unhandledRejection]', reason && reason.stack ? reason.stack : reason);
});

ipcMain.setMaxListeners(0);

// app.setAsDefaultProtocolClient('http');
// app.setAsDefaultProtocolClient('https');

const application = Application.instance;
tlog('index.ts: application.start()');
setupSearchAnnotatorIpc();
setupFlagsIpc();
 tlog('test -13');
setupDataLocationIpc();
 tlog('test -12');
// 迁移 gate:app.ready 之后执行(若有 pending),完成后 resolve gate,
// 让阻塞在 gate 上的 Settings.load() / onReady() 继续。无 pending 时立即放行。
app.whenReady().then(() => {
  applyGlobalUserAgent(session.defaultSession);
  runPendingMigrationIfAny();
});
 tlog('test -11');
application.start();

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
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        try {
          win.destroy();
        } catch {
          // 单个窗口销毁失败不阻断退出
        }
      }
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
  e.returnValue = (e.sender as any).windowId;
});

ipcMain.on('view-clear-tab-hover', (e, tabId: number) => {
  for (const appWindow of Application.instance.windows?.list || []) {
    if (appWindow.viewManager.getById(tabId)) {
      appWindow.send('clear-tab-hover');
      Application.instance.dialogs
        .getPersistent('preview')
        ?.hide();
      return;
    }
  }
});

ipcMain.handle(
  `web-contents-call`,
  async (e, { webContentsId, method, args = [] }) => {
    try {
      const wc = webContents.fromId(webContentsId);
      if ("home" == method) {
        return await wc.loadURL(getWebUIURL("newtab"));
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

// 地址栏/搜索框输入外部协议(motrixnext://、thunder://、magnet:、mailto: 等)
// → 唤起系统默认应用,而非当搜索词或塞给 webContents.loadURL。仅放行真正的外部
// 协议(排除 http/file 等内部协议),避免被滥用打开任意 URL/可执行体。
ipcMain.on('open-external-url', async (_e, url: string) => {
  try {
    if (!url || typeof url !== 'string' || !getExternalProtocol(url)) return;
    await shell.openExternal(url);
  } catch (err) {
    console.error('[open-external-url] 唤起失败:', url, err);
    dialog.showMessageBox({
      type: 'warning',
      title: '温馨提示',
      message: '无法打开该链接,请确认系统已安装对应应用。',
      buttons: ['确定'],
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

app.on('web-contents-created', (e, webContents) => {
  try {
    tlog(`web-contents-created: type=${webContents.getType()} url=${webContents.getURL()}`);
  } catch (err) {}

  if (webContents.getType() === 'backgroundPage')
    backgroundPages.push(webContents);

  // 拦截所有 webContents 的电子书文件导航 → 重定向到 koodoreader
  webContents.on('will-navigate', (event, url) => {
    console.log('[file-nav] will-navigate url:', url);
    if (url && url.startsWith('file:///')) {
      const path = filePathFromFileUrl(url);
      const koodoUrl = buildKoodoReaderUrl(path);
      if (koodoUrl) {
        console.log('[file-nav] will-navigate redirect to koodoreader:', koodoUrl);
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
        if (isExtPage) {
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
