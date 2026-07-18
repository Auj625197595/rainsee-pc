import {session, ipcMain, app, dialog, webContents} from 'electron';
import {getPath, makeId} from '~/utils';
import {promises, existsSync} from 'fs';
import {resolve, basename, parse, extname} from 'path';
import {createHash, generateKeyPairSync} from 'crypto';
import {Application} from './application';
import {getWebUIURL} from '~/common/webui-main';
import {registerProtocol} from './models/protocol';
import * as url from 'url';
import {
  IDownloadItem,
  BrowserActionChangeType,
  IElectronDownloadItem,
  IExtInspectView,
} from '~/interfaces';
import {getCrxIdByKey, parseCrx} from '~/utils/crx';
import {
  EXTENSIONS_PROTOCOL,
  RUFFLE_EXTENSION_ID,
  RUFFLE_EXTENSION_URL,
  RUFFLE_MAX_PACKAGE_BYTES,
} from '~/constants';
import {pathExists, deletePath} from '~/utils/files';
import {extractZip} from '~/utils/zip';
import {requestPermission} from './dialogs/permissions';
import * as rimraf from 'rimraf';
import {promisify} from 'util';
import {ElectronChromeExtensions} from "~/vendor/electron-chrome-extensions";
import {resolveExtMessage} from '~/vendor/electron-chrome-extensions/browser/api/i18n';
import {patchExtensionStorage, isExtensionStoragePatched} from './extension-storage-patch';
import * as Electron from "electron";
import tab from "~/renderer/views/app/components/Tab";
import {tlog, nowTs} from "./timing";
import {MediaDownloadManager} from "./services/media-downloader";
import {createBookmarksImpl, createHistoryImpl} from "./services/extension-bookmarks-history";
import {updateAllExtensions} from "./extension-updater";
import {getViewMenu} from "./menus/extension-popup";
import {setWebRequestDispatcher, setDnrEnforcer} from "./services/adblock";
import {
  canHandoffDownload,
  launchExternalDownload,
} from './services/external-downloader';

const rf = promisify(rimraf);
const GENERATED_KEY_SOURCE_FILE = '.rainsee-extension-source.json';
const EXTENSION_RUNTIME_STATE_FILE = '.rainsee-extension-runtime.json';

// 【调试总开关】true 时在 session 源头把 startWorkerForScope 拦成 no-op,
// 彻底阻止主动/按需拉起后台 service worker,用于验证 popup 白屏是否由 SW 共置
// 引起。仅测试用,验证完改回 false。
const DISABLE_START_WORKER_FOR_SCOPE = false;

// DIAGNOSTIC: receive beacons from the crx preload. The service-worker
// `console-message` capture does not reliably surface the worker's own
// preload / main-world logs, so the preload also reports key milestones
// (preload ran, injection branch entered, post-injection namespace state)
// over this IPC channel — which always reaches the main process.
let __crxBeaconWired = false;
function wireCrxBeacon() {
  if (__crxBeaconWired) return;
  __crxBeaconWired = true;
  try {
    ipcMain.on('crx-beacon', (event: any, msg: any) => {
      try {
        console.log(`[crx-beacon] ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
      } catch {}
      try {
        Application.instance?.sessions?.onCrxPreloadBeacon(event, msg);
      } catch {}
    });
  } catch {}
}
wireCrxBeacon();


// TODO: sessions should be separate.  This structure actually doesn't make sense.
export class SessionsService {
  private static readonly DEFAULT_PINNED_EXTENSIONS_COUNT = 3;

  public view = session.fromPartition('persist:view');
  // Electron 不支持向内存型(off-the-record) Session 加载扩展。使用专用持久
  // partition 承载无痕 BrowserContext，并在启动及最后一个无痕窗口关闭时完整清理。
  public viewIncognito = session.fromPartition('persist:view_incognito');

  public incognitoExtensionsLoaded = false;
  public extensionsLoaded = false;

  // In-flight guard so eager (main-process) and renderer-triggered
  // loadExtensions() calls coalesce instead of double-loading.
  private extensionsLoading: Promise<void> | null = null;

  // 多个标签可能同时发现 Flash，只允许一个下载/安装任务；共享结果使所有命中的
  // 原页面都能在同一次安装完成后刷新。任务结束后清空，后续调用会先走已加载检查。
  private ruffleInstallPromise: Promise<boolean> | null = null;
  private ruffleInstallNoticeAvailable = false;

  public extensions: Electron.Extension[] = [];

  public chromeExtensions: ElectronChromeExtensions;
  // 无痕 session 的第二个扩展实例(仅加载 incognitoAllowedExtensions 白名单)。
  // 懒加载:首个无痕窗口创建时由 loadIncognitoExtensions 建立。
  public chromeExtensionsIncognito: ElectronChromeExtensions | null = null;
  private incognitoExtensionTask: Promise<void> = Promise.resolve();
  private incognitoDataReady: Promise<void> = Promise.resolve();

  // Service Worker 本身不是 WebContents。没有活动扩展页时，用同源隐藏页作为
  // inspectServiceWorker() 的宿主，并在枚举检查视图时排除该内部页面。
  private extensionInspectorHosts = new Map<string, Electron.BrowserWindow>();

  // 每个检查目标使用独立、可见的 DevTools BrowserWindow，避免 DevTools
  // 被默认停靠到隐藏的 Offscreen / Service Worker 宿主窗口中。
  private extensionDevToolsWindows = new Map<string, Electron.BrowserWindow>();

  /**
   * Evaluate extension DNR rules for a top-level browser navigation.
   *
   * Electron's service-worker/native DNR binding and its session.webRequest
   * listener can be replaced independently during extension/native bootstrap.
   * Views use this synchronous host matcher as a main-frame fallback so the
   * decision still comes from the installed extensions' rules, never from a
   * browser-side special case for a particular extension or URL suffix.
   */
  public decideExtensionNavigation(url: string, tab: Electron.WebContents) {
    const dnr = (this.chromeExtensions as any)?.ctx?.declarativeNetRequest;
    if (!dnr || typeof dnr.decideBeforeRequest !== 'function') {
      return {action: 'none'} as const;
    }
    try {
      return dnr.decideBeforeRequest({
        url,
        resourceType: 'mainFrame',
        method: 'GET',
        webContentsId: tab.id,
        tabId: tab.id,
        frame: (tab as any).mainFrame || null,
      });
    } catch (error) {
      console.error('[crx-dnr] main-frame decision failed:', url, error);
      return {action: 'none'} as const;
    }
  }

  // ===== MV3 SW preload/API 健康检测 =====
  // Electron 在 popup 触发的「被动唤醒」下可能复活 SW 却不重跑其 service-worker
  // preload,导致 SW 内 globalThis.electron 缺失、IPC API 全失效。方案A 在 popup
  // 路径补 prewarm 堵住主因;这里兜底:SW running 后若超时仍无 [crx-preload] 注入
  // 证据仅用于诊断。不得因 preload 健康探针缺失而卸载扩展：Service Worker
  // 的 IPC beacon 在部分 Electron 启动路径不会到达全局 ipcMain，但 worker 与
  // source shim 实际已经可用；强制重载会打断刚恢复的 userScripts 并延迟首个页面。
  private hasLoadedExtension(id: string): boolean {
    if (!id) return false;
    try {
      if (this.view.getExtension(id)) return true;
    } catch {}
    return this.extensions.some((extension) => extension.id === id);
  }

  private rememberLoadedExtension(extension: Electron.Extension) {
    this.extensions = this.extensions.filter((it) => it.id !== extension.id);
    this.extensions.push(extension);
  }

  /**
   * 确保 Ruffle 已加载。返回 true 仅表示“本次调用共享的任务刚完成了新安装”，
   * 调用方据此显示首次安装提示；已经安装、被用户禁用或安装失败均返回 false。
   */
  public async ensureRuffleExtensionInstalled(): Promise<boolean> {
    if (!process.env.ENABLE_EXTENSIONS) return false;
    if (Application.instance.settings.object.flashSupport === false) return false;

    await this.loadExtensions();
    if (this.hasLoadedExtension(RUFFLE_EXTENSION_ID)) return false;

    const disabled = Application.instance.settings.object.disabledExtensions || [];
    if (disabled.includes(RUFFLE_EXTENSION_ID)) {
      console.log('[flash] Ruffle is disabled by the user; automatic install skipped');
      return false;
    }

    if (this.ruffleInstallPromise) return this.ruffleInstallPromise;

    this.ruffleInstallPromise = this.downloadAndInstallRuffle();
    try {
      return await this.ruffleInstallPromise;
    } finally {
      this.ruffleInstallPromise = null;
    }
  }

  public claimRuffleInstallNotice(): boolean {
    if (!this.ruffleInstallNoticeAvailable) return false;
    this.ruffleInstallNoticeAvailable = false;
    return true;
  }

  public async setFlashSupportEnabled(
    enabled: boolean,
  ): Promise<{ok: boolean; enabled: boolean; message?: string}> {
    const settings = Application.instance.settings;

    if (!enabled) {
      // 先关闭总开关，确保卸载过程中的网页事件不会再次触发探测/安装。
      settings.updateSettings({flashSupport: false});
      try {
        const installPath = resolve(getPath('extensions'), RUFFLE_EXTENSION_ID);
        if (
          this.hasLoadedExtension(RUFFLE_EXTENSION_ID) ||
          (await pathExists(installPath))
        ) {
          await this.uninstallExtension(RUFFLE_EXTENSION_ID, {
            skipRuffleWarning: true,
          });
        }
        return {ok: true, enabled: false};
      } catch (error) {
        console.error('[flash] failed to uninstall Ruffle from settings', error);
        return {ok: false, enabled: false, message: 'Flash 兼容插件卸载失败'};
      }
    }

    try {
      await this.loadExtensions();
      if (this.hasLoadedExtension(RUFFLE_EXTENSION_ID)) {
        settings.updateSettings({flashSupport: true});
        return {ok: true, enabled: true};
      }

      const installPath = resolve(getPath('extensions'), RUFFLE_EXTENSION_ID);
      if (await pathExists(installPath)) {
        const loaded = await this.setExtensionEnabled(RUFFLE_EXTENSION_ID, true, {
          skipRuffleWarning: true,
        });
        settings.updateSettings({flashSupport: loaded});
        return loaded
          ? {ok: true, enabled: true}
          : {ok: false, enabled: false, message: 'Flash 兼容插件启用失败'};
      }

      // 若卸载前曾被停用，清掉残留禁用记录，否则 ensure 会按“尊重用户停用”跳过。
      const disabled = (settings.object.disabledExtensions || []).filter(
        (id) => id !== RUFFLE_EXTENSION_ID,
      );
      if (disabled.length !== (settings.object.disabledExtensions || []).length) {
        settings.updateSettings({disabledExtensions: disabled});
      }

      settings.updateSettings({flashSupport: true});
      const installed = await this.ensureRuffleExtensionInstalled();
      const ready = installed || this.hasLoadedExtension(RUFFLE_EXTENSION_ID);
      settings.updateSettings({flashSupport: ready});
      return ready
        ? {ok: true, enabled: true}
        : {ok: false, enabled: false, message: 'Flash 兼容插件下载安装失败'};
    } catch (error) {
      console.error('[flash] failed to enable Flash support from settings', error);
      settings.updateSettings({flashSupport: false});
      return {ok: false, enabled: false, message: 'Flash 支持开启失败'};
    }
  }

  private async confirmRuffleRemoval(action: 'disable' | 'uninstall'): Promise<boolean> {
    const owner =
      Application.instance.windows.current ||
      Application.instance.windows.lastFocused ||
      Application.instance.windows.list[0];
    const result = owner?.win
      ? await dialog.showMessageBox(owner.win, {
          type: 'warning',
          title: 'Flash 支持',
          message: '关闭 Flash 兼容插件后，网页中的 Flash 内容将无法使用。',
          detail:
            action === 'uninstall'
              ? '继续卸载会同时关闭设置中的“Flash 支持”。'
              : '继续停用会同时关闭设置中的“Flash 支持”。',
          buttons: [action === 'uninstall' ? '继续卸载' : '继续停用', '取消'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        })
      : await dialog.showMessageBox({
          type: 'warning',
          title: 'Flash 支持',
          message: '关闭 Flash 兼容插件后，网页中的 Flash 内容将无法使用。',
          buttons: [action === 'uninstall' ? '继续卸载' : '继续停用', '取消'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
    return result.response === 0;
  }

  private async downloadAndInstallRuffle(): Promise<boolean> {
    try {
      console.log('[flash] downloading Ruffle');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      let packageBuffer = Buffer.alloc(0);
      try {
        const response = await fetch(RUFFLE_EXTENSION_URL, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`download failed: HTTP ${response.status}`);
        }
        const declaredSize = Number(response.headers.get('content-length') || 0);
        if (declaredSize > RUFFLE_MAX_PACKAGE_BYTES) {
          throw new Error(`package is too large: ${declaredSize} bytes`);
        }
        packageBuffer = Buffer.from(await response.arrayBuffer());
      } finally {
        clearTimeout(timer);
      }

      if (!packageBuffer.length || packageBuffer.length > RUFFLE_MAX_PACKAGE_BYTES) {
        throw new Error(`invalid package size: ${packageBuffer.length} bytes`);
      }

      const crxInfo = parseCrx(packageBuffer);
      if (crxInfo.id !== RUFFLE_EXTENSION_ID) {
        throw new Error(`unexpected extension id: ${crxInfo.id || 'missing'}`);
      }

      // 下载期间启动加载或另一个路径可能已装好，避免覆盖正在运行的扩展。
      if (Application.instance.settings.object.flashSupport === false) return false;
      if (this.hasLoadedExtension(RUFFLE_EXTENSION_ID)) return false;

      const installPath = resolve(getPath('extensions'), RUFFLE_EXTENSION_ID);
      const repairExisting = await pathExists(installPath);
      const extension = await this.installExtensionFromCrxInfo(
        crxInfo,
        repairExisting,
        false,
      );
      if (!extension) return false;

      this.broadcastInstalledExtension(extension);
      this.ruffleInstallNoticeAvailable = true;
      console.log(`[flash] Ruffle installed: ${extension.id}`);
      return true;
    } catch (error) {
      console.error('[flash] Ruffle automatic installation failed', error);
      return false;
    }
  }

  private async getRuntimeInstallDetails(
    extensionId: string,
    version?: string,
  ): Promise<chrome.runtime.InstalledDetails | null> {
    if (!extensionId || !version) return null;
    const runtimePath = resolve(getPath('extensions'), extensionId, EXTENSION_RUNTIME_STATE_FILE);
    let prevVersion = '';
    try {
      const payload = JSON.parse(await promises.readFile(runtimePath, 'utf8'));
      prevVersion = typeof payload?.version === 'string' ? payload.version : '';
    } catch {}
    // No persisted state, or the on-disk version is unchanged: a normal
    // startup, NOT a fresh install. Chrome fires runtime.onStartup (never
    // onInstalled) when the browser starts with an extension already on disk.
    // On the first launch after this feature ships NO extension has a state
    // file yet, so returning {reason:'install'} here would mass-retrigger every
    // installed extension's first-install setup on upgrade day. Real
    // installs/updates are detected at explicit install time (where the prior
    // manifest is read directly); this only needs to spot a version change that
    // happened while the app was closed.
    if (typeof prevVersion === 'string' && prevVersion && prevVersion !== version) {
      return {reason: 'update', previousVersion: prevVersion};
    }
    return null;
  }

  /** Map a prior manifest version to onInstalled details. Shared by both CRX
   *  install paths so the reason/previousVersion contract stays identical and
   *  the `typeof === 'string'` guard is applied consistently (a corrupt
   *  manifest with a non-string `version` must not be reported as 'install'). */
  private buildInstalledDetails(previousVersion?: string): chrome.runtime.InstalledDetails {
    return typeof previousVersion === 'string' && previousVersion
      ? {reason: 'update', previousVersion}
      : {reason: 'install'};
  }

  private async saveRuntimeInstalledState(extensionId: string, version?: string) {
    if (!extensionId || !version) return;
    const runtimePath = resolve(getPath('extensions'), extensionId, EXTENSION_RUNTIME_STATE_FILE);
    try {
      await promises.writeFile(runtimePath, JSON.stringify({version}, null, 2), 'utf8');
    } catch (e) {
      console.error('saveRuntimeInstalledState failed', extensionId, e);
    }
  }

  public constructor() {
    registerProtocol(this.view);
    registerProtocol(this.viewIncognito);

    // 【调试】根据全局开关 DISABLE_START_WORKER_FOR_SCOPE 决定是否彻底禁用主动
    // 拉起后台 service worker。SW 由多条路径拉起(主进程 startBackgroundWorker、
    // vendor router.sendEvent 的 alarms 恢复等),单点盖不全,故在 session 源头
    // 把 startWorkerForScope 拦成 no-op,一次性覆盖所有路径。仅用于验证
    // 「SW 强制/主动启动是否导致 popup 白屏」,改全局变量即可开关。
    if (DISABLE_START_WORKER_FOR_SCOPE) {
      for (const ses of [this.view, this.viewIncognito]) {
        try {
          const sw: any = ses.serviceWorkers as any;
          tlog(
            `patch startWorkerForScope: swObj=${!!sw} hasFn=${typeof sw?.startWorkerForScope}`,
          );
          if (sw && typeof sw.startWorkerForScope === 'function') {
            const orig = sw.startWorkerForScope.bind(sw);
            (sw as any).__origStartWorkerForScope = orig;
            sw.startWorkerForScope = (scope: string) => {
              tlog(`startWorkerForScope BLOCKED (debug) scope=${scope}`);
              return Promise.reject(
                new Error('startWorkerForScope disabled (DISABLE_START_WORKER_FOR_SCOPE)'),
              );
            };
            tlog('startWorkerForScope patched OK');
          }
        } catch (e) {
          tlog('failed to patch startWorkerForScope', e);
        }
      }
    }

    this.incognitoDataReady = this.clearCache('incognito');

    if (process.env.ENABLE_EXTENSIONS) {
      // extensions.initializeSession(
      //   this.view,
      //   `${app.getAppPath()}/build/extensions-preload.bundle.js`,
      // );

      ipcMain.on('load-extensions', () => {
        tlog('IPC load-extensions received (from renderer)');
        this.loadExtensions();
      });

      ipcMain.handle('get-extensions', (event) => {
        const owner = Application.instance.windows.list.find(
          (window) => window.win.webContents === event.sender,
        );
        return owner?.incognito
          ? this.getIncognitoExtensions()
          : this.extensions;
      });

      // ===== 「拓展」管理页(yjllq://extensions)后端 =====
      ipcMain.handle('extensions-get-detailed', () => this.getDetailedExtensions());

      // 同步解析单个 __MSG_key__ 串(如 action.default_title),供 renderer 在
      // 没有 manifest/磁盘访问能力时调用(地址栏工具栏按钮标题)。复用运行时
      // catalog 缓存,locale 顺序与扩展 chrome.i18n.getMessage 一致。
      ipcMain.on(
        'crx-resolve-msg',
        (e: any, extensionId: string, text: string) => {
          e.returnValue = this.resolveMessage(extensionId, text);
        },
      );

      ipcMain.handle('extension-set-enabled', (e, id: string, enabled: boolean) =>
        this.setExtensionEnabled(id, enabled),
      );

      ipcMain.handle(
        'extension-set-incognito-allowed',
        (_e, id: string, allowed: boolean) =>
          this.setExtensionIncognitoAllowed(id, allowed),
      );

      ipcMain.handle('flash-support-set-enabled', (_e, enabled: boolean) =>
        this.setFlashSupportEnabled(!!enabled),
      );

      ipcMain.handle('extension-reload', (e, id: string) =>
        this.reloadExtension(id),
      );

      // 手动「检查更新」:检查全部已安装扩展并升级有新版本者,返回结果摘要供前端回显。
      ipcMain.handle('extensions-check-updates', () => updateAllExtensions(this));

      // 扩展自动更新开关的读写(与 Chrome 一致,默认开启)。
      ipcMain.handle(
        'extensions-get-auto-update',
        () => Application.instance.settings.object.extensionsAutoUpdate !== false,
      );
      ipcMain.handle('extensions-set-auto-update', (e, value: boolean) => {
        Application.instance.settings.updateSettings({
          extensionsAutoUpdate: !!value,
        });
        return !!value;
      });

      ipcMain.handle('extension-uninstall', async (_e, id: string) => {
        try {
          return await this.uninstallExtension(id);
        } catch (error) {
          console.error('extension-uninstall failed', id, error);
          return false;
        }
      });

      ipcMain.handle('extension-get-inspect-views', (_e, id: string) =>
        this.getExtensionInspectViews(id),
      );

      ipcMain.handle(
        'extension-inspect-target',
        (_e, id: string, targetId: string) =>
          this.inspectExtensionTarget(id, targetId),
      );

      // The chrome-extension API preload is built as a separate webpack
      // bundle (see webpack.config.js). Point the vendored module at it.
      const modulePath = `${app.getAppPath()}/build/crx-preload.bundle.js`;
      this.chromeExtensions = new ElectronChromeExtensions({
        modulePath: modulePath,
        session: this.view,
        assignTabDetails(details: chrome.tabs.Tab, tab: Electron.WebContents) {

        },
        createTab(details) {
          // viewManager.create is synchronous; return the [webContents, window]
          // pair directly. The previous impl wrapped this in `new Promise(r => { …
          // return [wc, win] })`, but a Promise executor's *return value is
          // ignored* — resolve was never called, so `await impl.createTab()`
          // hung forever and tabs.create errored "reply was never sent",
          // stranding dessant's Ri (open-tab) flow.
          const list = Application.instance.windows.list
          const requested = details.windowId
          // KEY: an extension action (popup/options/dashboard) is ALWAYS triggered
          // from a host browser window. The vendor store passes `lastFocusedWindowId`
          // as details.windowId, but while our popup BrowserWindow has focus that
          // value can be stale or wrong — and if it doesn't match a real AppWindow
          // we must NOT silently fall back to a windows.current that happens to be
          // the wrong one. Resolve the target deterministically: the AppWindow that
          // owns details.windowId if it's a real tracked window, else the host's
          // current/last-focused AppWindow.
          let appWin = list.find((x) => x.win.id === requested) || Application.instance.windows.current
          console.log(
            `[crx-tab-target] createTab url=${details && details.url} `,
            `requestedWindowId=${requested} `,
            `matched=${appWin && appWin.win && !appWin.win.isDestroyed() ? appWin.win.id : 'none'} `,
            `list=[${list.map((x) => x.win.id).join(',')}]`,
          )
          if (!appWin) {
            appWin = Application.instance.windows.lastFocused
          }
          const view = appWin.viewManager.create(details, true, true)
          return [view.webContents, view.window.win]
        },
        selectTab(tab, browserWindow) {
          (Application.instance.windows.list
            .find((x) => x.win.id === browserWindow.id) || Application.instance.windows.current)
            .viewManager.select(tab.id, true, false)
        },
        removeTab(tab, browserWindow) {
          (Application.instance.windows.list
            .find((x) => x.win.id === browserWindow.id) || Application.instance.windows.current)
            .viewManager.removeByTabId(tab.id);
        },
        createWindow(details) {
          // 衔接「新壳窗口 → 渲染层就绪 → 迁入标签」这套握手太脆弱:
          // 直接对壳窗口 loadURL 会顶掉 React UI 并被拦截器拦成 ERR_BLOCKED_BY_CLIENT,
          // 且新窗口里没有注册标签,tabs.query 查不到。改为把扩展请求的 URL 在
          // 当前窗口里以新标签页打开(viewManager.create 会注册进扩展 store 并通知
          // 渲染层),再把当前窗口的真实 BrowserWindow 回给 vendor store。
          const appWin =
            Application.instance.windows.current ||
            Application.instance.windows.lastFocused ||
            Application.instance.windows.open(details.incognito);

          console.log(
            `[crx-tab-target] createWindow type=${details && details.type} url=${details && details.url} `,
            `targetWindowId=${appWin && appWin.win && !appWin.win.isDestroyed() ? appWin.win.id : 'none'}`,
          )

          const urls = Array.isArray(details.url)
            ? details.url
            : details.url
              ? [details.url]
              : [];

          if (urls.length > 0) {
            urls.forEach((u: string, i: number) => {
              appWin.viewManager.create(
                { url: u, active: i === urls.length - 1, incognito: details.incognito },
                false,
                true,
              );
            });
          }

          return appWin.win;
        },
        isIncognitoWindow(window: Electron.BaseWindow) {
          return Application.instance.windows.list.find((item) => item.win.id === window.id)
            ?.incognito;
        },
        removeWindow(window: Electron.BrowserWindow) {
          if (!window.isDestroyed()) {
            window.close();
          }
        },
        async requestPermissions(extension, requested) {
          const permissionNames = [
            ...(requested.permissions || []),
            ...(requested.origins || []),
          ];
          if (permissionNames.length === 0) return true;
          const owner =
            Application.instance.windows.current || Application.instance.windows.lastFocused;
          const options: Electron.MessageBoxOptions = {
            type: 'question',
            title: '扩展权限请求',
            message: `${extension.name} 请求以下权限`,
            detail: permissionNames.join('\n'),
            buttons: ['允许', '拒绝'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
          };
          const result = owner?.win
            ? await dialog.showMessageBox(owner.win, options)
            : await dialog.showMessageBox(options);
          return result.response === 0;
        },
        bookmarks: createBookmarksImpl(Application.instance.storage),
        history: createHistoryImpl(Application.instance.storage),
        management: {
          setEnabled: (id: string, enabled: boolean) => this.setExtensionEnabled(id, enabled),
          uninstall: (id: string) => this.uninstallExtension(id),
        },
        openSidePanel: (extensionId: string, tabId: number, panelPath: string, windowId?: number) => {
          const w = (windowId != null
            ? Application.instance.windows.list.find((x) => x.win.id === windowId)
            : null) || Application.instance.windows.current || Application.instance.windows.lastFocused;
          w?.sidePanels.show(extensionId, tabId, panelPath);
        },
      });
      // if(this.view.getPreloads()) {
      //   this.view.setPreloads(this.view.getPreloads().reverse());
      // }

      // Bridge the vendored BrowserActionAPI's granular change events to the
      // React toolbar. The built-in <browser-action-list> web component uses an
      // observer/getState model, but this app renders actions in React and only
      // refreshes badge/title/popup when it receives 'set-browserAction-info'
      // (see store/index.ts -> onBrowserActionUpdate). Without this wiring the
      // badge number never updates after the initial load.
      // TEMP: surface renderer-side badge matching in the main process terminal.
      ipcMain.on('crx-badge-debug', (_e, msg: string) => {
        tlog(`[crx-badge-debug] ${msg}`);
      });

      // 接收 renderer 推送的可视标签栏顺序,用于给扩展提供准确的 chrome.tabs.Tab.index。
      // 顺序的权威来源是 renderer 的 tabs store(拖拽重排只在 renderer);主进程本身不知道。
      ipcMain.on(
        'crx-set-tab-order',
        (_e: any, windowId: number, orderedTabIds: number[]) => {
          try {
            const owner = Application.instance.windows.list.find(
              (window) => window.win.id === windowId,
            );
            const context = owner?.incognito
              ? this.chromeExtensionsIncognito
              : this.chromeExtensions;
            context?.setTabOrder(windowId, orderedTabIds);
          } catch (err) {
            console.error('[sessions-service] crx-set-tab-order error:', err);
          }
        },
      );

      (this.chromeExtensions as any).on(
        'browser-action-update',
        (extensionId: string, propName: string, value: any, tabId?: number) => {
          // tlog(
          //   `browser-action-update ext=${extensionId} prop=${propName} value=${JSON.stringify(
          //     value,
          //   )} tabId=${tabId}`,
          // );
          let action: BrowserActionChangeType;
          let details: any;
          switch (propName) {
            case 'text':
              action = 'setBadgeText';
              details = { text: value };
              break;
            case 'popup':
              action = 'setPopup';
              details = { popup: value };
              break;
            case 'title':
              action = 'setTitle';
              details = { title: value };
              break;
            case 'color':
              action = 'setBadgeBackgroundColor';
              details = { color: value };
              break;
            case 'textColor':
              action = 'setBadgeTextColor';
              details = { textColor: value };
              break;
            case 'enabled':
              // chrome.action.enable()/disable() — value is a boolean.
              action = 'setEnabled';
              details = { enabled: value };
              break;
            case 'icon':
              // chrome.action.setIcon — value is the icon details object
              // ({ path } or { imageData }). Resolve it to a data URL the React
              // toolbar can render, then forward asynchronously.
              this.resolveActionIcon(extensionId, value)
                .then((icon) => {
                  if (!icon) return;
                  const d: any = { icon };
                  if (tabId) d.tabId = tabId;
                  this.onBrowserActionUpdate(extensionId, 'setIcon', d);
                })
                .catch((err) => tlog('resolveActionIcon failed', err));
              return;
            default:
              return;
          }
          if (tabId) details.tabId = tabId;
          this.onBrowserActionUpdate(extensionId, action, details);
        },
      );

      // The vendored PopupView (created by chrome.action.openPopup() ->
      // BrowserActionAPI.activateClick) loads the popup URL but, unlike the
      // host's own popup (src/main/dialogs/popup.ts), never registers a
      // 'context-menu' handler — so right-clicking inside it does nothing.
      // Attach the SAME getViewMenu handler here so both popup paths share one
      // right-click menu. Interception happens at the popup's webContents,
      // independent of which code path opened it.
      (this.chromeExtensions as any).on(
        'browser-action-popup-created',
        (popup: { browserWindow?: Electron.BrowserWindow }) => {
          const wc = popup?.browserWindow?.webContents;
          if (!wc || wc.isDestroyed()) return;
          if ((wc as any).__crxPopupMenuAttached) return;
          (wc as any).__crxPopupMenuAttached = true;
          wc.on('context-menu', (_e, params) => {
            if (wc.isDestroyed()) return;
            const menu = getViewMenu(params, wc);
            menu.popup();
          });
        },
      );

      // MV3 SW 生命周期跟踪 + preload 注入失败检测(方案B)。view 与 viewIncognito
      // 共用同一套 handler,确保两个 session 的被动唤醒都被覆盖。详见
      // attachSWLifecycleListeners / scheduleSWInjectCheck。
      this.attachSWLifecycleListeners(this.view);
      this.attachSWLifecycleListeners(this.viewIncognito);

      // 设置 webRequest 事件分发器：由于 Electron 的 webRequest API 只支持一个监听器，
      // adblock 的监听器会覆盖扩展的监听器。因此我们需要在 adblock 的 onBeforeRequest
      // 包装器中手动分发事件到扩展。
      this.registerExtensionWebRequest(this.chromeExtensions);
    }

    /*
    // TODO:
    ipcMain.handle(`inspect-extension`, (e, incognito, id) => {
      const context = incognito ? this.extensionsIncognito : this.extensions;
      context.extensions[id].backgroundPage.webContents.openDevTools();
    });
    */

    // 抽成 const 以便同时挂到 view 与 viewIncognito(原仅挂 view,无痕 session 权限
    // 请求走 Electron 默认态)。handler 内只用 Application.instance,不依赖 this。
    const permHandler: NonNullable<
      Parameters<typeof this.view.setPermissionRequestHandler>[0]
    > = async (webContents, permission, callback, details) => {
        const window = Application.instance.windows.findByBrowserView(
          webContents.id,
        );
        if (!window) {
          callback(false);
          return;
        }
        const requestView = window.viewManager.views.get(webContents.id);

        console.log('[permissions] request received', {
          webContentsId: webContents.id,
          selectedId: window?.viewManager.selectedId,
          pageUrl: webContents.getURL(),
          requestingUrl: details?.requestingUrl,
          permission,
          details,
        });

        // 外部协议(motrixnext://、thunder://、magnet:、mailto: 等):Electron 把网页发起的
        // 外部协议跳转(location.href / <a> / window.open / iframe / 302)统一成 'openExternal'
        // 权限请求——直接复用下方标准权限弹窗(requestPermission)与"记住此选择",与其他权限
        // 一致,不再用自定义 dialog。必须在 selectedId 早返之前放行,否则后台标签/iframe(日志
        // webContentsId≠selectedId)的请求被静默丢弃("权限弹窗不显示")。requestPermission 默认
        // 把信息写到 selected 视图,但弹窗按 tabId=webContents.id 取信息,故在请求来源视图上也
        // 写一份,保证后台标签也能正确渲染。callback(true) 时 Electron 自行唤起 OS 默认应用,
        // 无需手动 shell.openExternal。地址栏手动输入走另一条直达 IPC(open-external-url,
        // @src/main/index.ts),不经此处、不弹框。
        if (permission === 'openExternal' && details && details.externalURL) {
          if (requestView) {
            requestView.requestedPermission = {
              name: permission,
              url: webContents.getURL(),
              details,
            };
          }
        }

        if (
          permission !== 'openExternal' &&
          webContents.id !== window.viewManager.selectedId
        ) {
          return;
        }

        if (permission === 'fullscreen') {
          callback(true);
        } else {
          try {
            const {hostname} = url.parse(details.requestingUrl);
            const perm: any = await Application.instance.storage.findOne({
              scope: 'permissions',
              query: {
                url: hostname,
                permission,
                mediaTypes: JSON.stringify(details.mediaTypes) || '',
              },
            });

            if (!perm && ['sensors', 'screen-wake-lock'].includes(permission)) {
              console.log('[permissions] no stored decision for permission, allowing by default', {
                webContentsId: webContents.id,
                pageUrl: webContents.getURL(),
                requestingUrl: details?.requestingUrl,
                permission,
                details,
              });

              callback(true);
            } else if (!perm) {
              console.log('[permissions] showing permission dialog', {
                webContentsId: webContents.id,
                pageUrl: webContents.getURL(),
                requestingUrl: details?.requestingUrl,
                permission,
                details,
              });

              const response = await requestPermission(
                window.win,
                permission,
                webContents.getURL(),
                details,
                webContents.id,
              );

              console.log('[permissions] dialog resolved', {
                webContentsId: webContents.id,
                requestingUrl: details?.requestingUrl,
                permission,
                response,
                details,
              });

              callback(response.allowed);

              // 无痕窗口可以使用已有站点权限，但本次选择只在当前请求生效，
              // 不写入普通配置文件。
              if (response.remember && !requestView?.incognito) {
                await Application.instance.storage.insert({
                  scope: 'permissions',
                  item: {
                    url: hostname,
                    permission,
                    type: response.allowed ? 1 : 2,
                    mediaTypes: JSON.stringify(details.mediaTypes) || '',
                  },
                });
              }
            } else {
              console.log('[permissions] using stored decision', {
                webContentsId: webContents.id,
                requestingUrl: details?.requestingUrl,
                permission,
                storedType: perm.type,
                details,
              });

              callback(perm.type === 1);
            }
          } catch (e) {
            console.log('[permissions] request failed', {
              webContentsId: webContents.id,
              requestingUrl: details?.requestingUrl,
              permission,
              details,
              error: e instanceof Error ? e.message : e,
            });

            callback(false);
          }
        }
    };

    this.view.setPermissionRequestHandler(permHandler);
    this.viewIncognito.setPermissionRequestHandler(permHandler);

    const getDownloadItem = (
      item: Electron.DownloadItem,
      id: string,
    ): IDownloadItem => ({
      fileName: basename(item.savePath),
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      savePath: item.savePath,
      url: item.getURL(),
      paused: item.isPaused(),
      id,
    });

    const getElectronDownloadItem = (
      item: Electron.DownloadItem,
      webContents: Electron.WebContents,
      id: string,
    ): IElectronDownloadItem => ({
      item,
      webContents,
      id,
    });

    // 持久化已完成的下载到 storage/downloads.db,使下载页跨重启保留。仅在
    // done(completed) 分支调用——被扩展接管的走 download-removed、失败的走
    // canceled,都不会到这里。.crx 是扩展安装,不计入下载历史。
    const persistDownload = (dlItem: IDownloadItem) => {
      if ((dlItem.fileName || '').toLowerCase().endsWith('.crx')) return;
      try {
        Application.instance.storage
          .insert({scope: 'downloads', item: {...dlItem, date: Date.now()}})
          .catch(() => {});
      } catch {
        /* storage 未就绪——忽略 */
      }
    };

    const downloadsDialog = () =>
      Application.instance.dialogs.getDynamic('downloads-dialog')?.browserView
        ?.webContents;

    const resolveDownloadWindow = (
      sourceWebContents?: Electron.WebContents | null,
    ) => {
      const {windows} = Application.instance;
      if (sourceWebContents && !sourceWebContents.isDestroyed()) {
        return (
          windows.findByBrowserView(sourceWebContents.id) ||
          windows.list.find(
            (appWindow) =>
              appWindow && appWindow.webContents?.id === sourceWebContents.id,
          )
        );
      }

      return (
        windows.current ||
        windows.lastFocused ||
        windows.list.find(
          (appWindow) => appWindow && appWindow.win && !appWindow.win.isDestroyed(),
        )
      );
    };

    const emitDownloadEvent = (
      targetWindow: ReturnType<typeof resolveDownloadWindow>,
      channel: string,
      ...args: unknown[]
    ) => {
      targetWindow?.send(channel, ...args);
    };

    const downloads: IDownloadItem[] = [];
    const electronDownloads: IElectronDownloadItem[] = [];

    ipcMain.on('download-pause', (e, id) => {
      const found = electronDownloads.find((x) => x.id === id);
      if (!found) return; // 媒体下载等非原生任务交由各自管理器处理
      found.item.pause();
    });

    ipcMain.on('download-resume', (e, id) => {
      const found = electronDownloads.find((x) => x.id === id);
      if (!found) return;
      found.item.resume();
    });

    ipcMain.on('download-cancel', (e, id) => {
      const found = electronDownloads.find((x) => x.id === id);
      if (!found) return;
      found.item.cancel();
    });

    ipcMain.handle('load-extension-from-crx', async (e, id) => {
      const dialogRes = await dialog.showOpenDialog({
        filters: [{name: '选择 crx/zip 扩展程序文件', extensions: ['crx', 'zip']}],
      });
      try {
        if (dialogRes.canceled || !dialogRes.filePaths[0]) return null;
        const ex = await this.installExtensionFromPackageFile(
          dialogRes.filePaths[0],
          true,
          true,
        );
        if (ex) {
          this.broadcastInstalledExtension(ex);
        }
        return ex;
      } catch (err) {
        console.error(err);
      }
      return null;
    });

    ipcMain.handle('load-extension-from-dir', async (e, id) => {
      const dialogRes = await dialog.showOpenDialog({
        filters: [{name: '选择扩展程序文件夹', extensions: []}],
        properties: ['openDirectory'],
      });
      try {
        if (dialogRes.canceled || !dialogRes.filePaths[0]) return null;
        const extension = await this.installExtensionFromDirectorySource(
          dialogRes.filePaths[0],
          true,
          true,
          dialogRes.filePaths[0],
        );
        if (extension) {
          this.broadcastInstalledExtension(extension);
        }
        return extension;
      } catch (err) {
        console.error(err);
      }
      return null;
    });

    ipcMain.handle('load-extension-from-file', async (_e, filePath: string) => {
      if (!filePath) return null;
      try {
        const extension = await this.installExtensionFromPackageFile(
          filePath,
          true,
          true,
        );
        if (extension) {
          this.broadcastInstalledExtension(extension);
        }
        return extension;
      } catch (err) {
        console.error(err);
        return null;
      }
    });

    const installItem = async (
      item: Electron.DownloadItem,
      force: Boolean = false,
    ): Promise<Electron.Extension | null> => {
      const crxBuf = await promises.readFile(item.savePath);
      const crxInfo = parseCrx(crxBuf);
      return this.installExtensionFromCrxInfo(crxInfo, force, true);
    }

    // 拓展商店:拉取后台维护的扩展列表(https://admin.yujianpay.com/api/crx/getAll)。
    ipcMain.handle('extension-store-list', async () => {
      try {
        const res = await fetch('https://admin.yujianpay.com/api/crx/getAll');
        if (res.status !== 200) return [];
        const body = await res.json().catch(() => null);
        const list = body?.data?.data;
        if (!Array.isArray(list)) return [];
        // 标记已安装状态,供前端区分「安装/已安装」。
        const installed = new Set(this.extensions.map((x) => x.id));
        return list.map((it: any) => ({
          ...it,
          installed: installed.has(it.crxkey),
        }));
      } catch (e) {
        console.error('extension-store-list failed', e);
        return [];
      }
    });

    // 拓展商店:按 crxkey 从 Edge 扩展库下载 crx 并安装。
    ipcMain.handle('extension-store-install', async (e, crxkey: string) => {
      if (!crxkey) return null;
      try {
        const url =
          'https://edge.microsoft.com/extensionwebstorebase/v1/crx' +
          '?response=redirect&acceptformat=crx3&x=id%3D' +
          crxkey +
          '%26installsource%3Dondemand%26uc';
        const res = await fetch(url, {redirect: 'follow'});
        if (res.status !== 200) {
          console.error('extension-store-install download failed', res.status);
          return null;
        }
        const crxBuf = Buffer.from(await res.arrayBuffer());
        const crxInfo = parseCrx(crxBuf);
        const ex = await this.installExtensionFromCrxInfo(crxInfo, true, true);
        if (ex) {
          this.broadcastNormal('load-browserAction', ex);
        }
        return ex ? {id: ex.id, name: ex.name} : null;
      } catch (err) {
        console.error('extension-store-install failed', err);
        return null;
      }
    });

    ipcMain.on('download-remove', (e, id) => {
      // 媒体下载由 MediaDownloadManager 管理，但仍需广播 download-removed 给面板。
      const electronDownloadsIndex = electronDownloads.findIndex(
        (x) => x.id === id,
      );

      const window = resolveDownloadWindow(
        electronDownloads[electronDownloadsIndex]?.webContents,
      );

      if (electronDownloadsIndex > -1) {
        electronDownloads.splice(electronDownloadsIndex, 1);
      }

      const downloadsIndex = downloads.findIndex((x) => x.id === id);
      if (downloadsIndex > -1) {
        downloads.splice(downloadsIndex, 1);
      }

      // 同步删除持久化的历史记录(若存在)。进行中、尚未完成的下载没有 DB 记录,
      // remove 是空操作。
      Application.instance.storage
        .remove({scope: 'downloads', query: {id}})
        .catch(() => {});

      downloadsDialog()?.send('download-removed', id);
      window?.send('download-removed', id);

      if (electronDownloads.length === 0 && downloads.length === 0
        && MediaDownloadManager.list().length === 0) {
        Application.instance.dialogs.getDynamic('downloads-dialog').hide();
      }
    });

    ipcMain.on('download-open-when-done', (e, id) => {
      const index = downloads.indexOf(downloads.find((x) => x.id === id));

      downloads[index].openWhenDone = !downloads[index].openWhenDone;

      downloadsDialog()?.send(
        'download-open-when-done-change',
        downloads[index],
      );
    });

    ipcMain.handle('get-downloads', () => {
      return [...downloads, ...MediaDownloadManager.list()];
    });

    // TODO(sentialx): clean up the download listeners
    this.view.on('will-download', (event, item, webContents) => {
      // 外部下载器自动接管:必须同步 preventDefault(await 之后无效)。同步预判能否
      // 唤起(迅雷走协议默认可;其它需路径已配置且存在)。.crx 走扩展安装分支,不接管。
      const s = Application.instance.settings.object;
      if (
        s.downloaderEnabled &&
        s.downloaderAutoIntercept &&
        !item.getURL().toLowerCase().startsWith('blob:') &&
        extname(item.getFilename()) !== '.crx' &&
        canHandoffDownload(s.downloaderType, s.downloaderPath)
      ) {
        event.preventDefault();
        launchExternalDownload({
          type: s.downloaderType,
          customPath: s.downloaderPath,
          customArgs: s.downloaderArgs,
          url: item.getURL(),
          filename: item.getFilename(),
          path: s.downloadsPath,
        });
        return;
      }

      const fileName = item.getFilename();
      const id = makeId(32);
      const sourceWebContents =
        webContents && !webContents.isDestroyed() ? webContents : null;
      const window = resolveDownloadWindow(sourceWebContents);

      if (!Application.instance.settings.object.downloadsDialog) {
        const downloadsPath =
          Application.instance.settings.object.downloadsPath;
        let i = 1;
        let savePath = resolve(downloadsPath, fileName);

        while (existsSync(savePath)) {
          const {name, ext} = parse(fileName);
          savePath = resolve(downloadsPath, `${name} (${i})${ext}`);
          i++;
        }

        item.savePath = savePath;
      }

      const downloadItem = getDownloadItem(item, id);
      downloads.push(downloadItem);

      const electronDownloadItem = getElectronDownloadItem(
        item,
        sourceWebContents ?? undefined,
        id,
      );
      electronDownloads.push(electronDownloadItem);

      downloadsDialog()?.send('download-started', downloadItem);
      emitDownloadEvent(window, 'download-started', downloadItem);
      // If a download-intercepting extension is listening on
      // chrome.downloads.onCreated, hold the popup's auto-open briefly so it
      // can claim the download (onCreated → cancel) without the browser UI
      // flashing. Downloads with no such extension open immediately, unchanged.
      if (
        (this.chromeExtensions as any)?.api?.downloads?.hasCreatedListeners?.()
      ) {
        setTimeout(() => {
          if ((item as any).__crxExtIntercepted) return;
          if ((window as any)?.isDestroyed?.()) return;
          emitDownloadEvent(window, 'show-download-dialog');
        }, 400);
      } else {
        emitDownloadEvent(window, 'show-download-dialog');
      }

      item.on('updated', (event, state) => {
        if (state === 'interrupted') {
          downloadsDialog()?.send('download-paused', id);
          emitDownloadEvent(window, 'download-paused', id);
          console.log('Download is interrupted but can be resumed');
        } else if (state === 'progressing') {
          if (item.isPaused()) {
            downloadsDialog()?.send('download-paused', id);
            emitDownloadEvent(window, 'download-paused', id);
            console.log('Download is paused');
          }
        }

        const data = getDownloadItem(item, id);

        downloadsDialog()?.send('download-progress', data);
        emitDownloadEvent(window, 'download-progress', data);

        Object.assign(downloadItem, data);
        if (
          sourceWebContents &&
          !sourceWebContents.isDestroyed() &&
          sourceWebContents.getURL() === item.getURL()
        ) {
          sourceWebContents.goBack();
        }
      });
      item.once('done', async (event, state) => {
        if (state === 'completed') {
          const dialog = downloadsDialog();
          dialog?.send('download-completed', id);
          emitDownloadEvent(window, 'download-completed', id, !!dialog);

          downloadItem.completed = true;

          persistDownload(downloadItem);

          if (process.env.ENABLE_EXTENSIONS && extname(fileName) === '.crx') {
            const extension = await installItem(item, true);
            if (extension != null) {
              if (window) {
                if (!window.incognito) {
                  window.send('load-browserAction', extension);
                }
              } else {
                this.broadcastNormal('load-browserAction', extension);
              }
            }
          }
        } else if ((item as any).__crxExtIntercepted) {
          // An extension claimed this download via chrome.downloads.onCreated
          // and cancelled it (e.g. MotrixNext, which forwards the URL to its
          // desktop app). Drop it silently — no "canceled" UI, no history
          // record — matching Chrome, which forgets a download an extension has
          // taken over. The 400 ms popup-grace above keeps it off-screen too.
          const dlIdx = downloads.findIndex((x) => x.id === id);
          if (dlIdx > -1) downloads.splice(dlIdx, 1);
          const edlIdx = electronDownloads.findIndex((x) => x.id === id);
          if (edlIdx > -1) electronDownloads.splice(edlIdx, 1);
          downloadsDialog()?.send('download-removed', id);
          emitDownloadEvent(window, 'download-removed', id);
          if (
            electronDownloads.length === 0 &&
            downloads.length === 0 &&
            MediaDownloadManager.list().length === 0
          ) {
            Application.instance.dialogs.getDynamic('downloads-dialog').hide();
          }
        } else {
          downloadItem.completed = false;
          downloadItem.canceled = true;
          downloadsDialog()?.send('download-canceled', id);
          emitDownloadEvent(window, 'download-canceled', id);
          console.log(`Download failed: ${state}`);
        }
      });
    });

    // 无痕 session 下载:外部下载器接管 + 存盘(文件保留),但不进下载历史
    // (downloads 列表 / persistDownload DB)——符合 Chrome 无痕语义。
    this.viewIncognito.on('will-download', (event, item, _webContents) => {
      const s = Application.instance.settings.object;
      if (
        s.downloaderEnabled &&
        s.downloaderAutoIntercept &&
        !item.getURL().toLowerCase().startsWith('blob:') &&
        extname(item.getFilename()) !== '.crx' &&
        canHandoffDownload(s.downloaderType, s.downloaderPath)
      ) {
        event.preventDefault();
        launchExternalDownload({
          type: s.downloaderType,
          customPath: s.downloaderPath,
          customArgs: s.downloaderArgs,
          url: item.getURL(),
          filename: item.getFilename(),
          path: s.downloadsPath,
        });
        return;
      }
      // 存盘(文件保留);不 push downloads、不 persistDownload(无痕不记录)。
      if (!s.downloadsDialog) {
        const fileName = item.getFilename();
        let i = 1;
        let savePath = resolve(s.downloadsPath, fileName);
        while (existsSync(savePath)) {
          const {name, ext} = parse(fileName);
          savePath = resolve(s.downloadsPath, `${name} (${i})${ext}`);
          i++;
        }
        item.savePath = savePath;
      }
    });

    session.defaultSession.on('will-download', (event, item, webContents) => {
      // 外部下载器自动接管(同 view 分支)。
      const s = Application.instance.settings.object;
      if (
        s.downloaderEnabled &&
        s.downloaderAutoIntercept &&
        !item.getURL().toLowerCase().startsWith('blob:') &&
        extname(item.getFilename()) !== '.crx' &&
        canHandoffDownload(s.downloaderType, s.downloaderPath)
      ) {
        event.preventDefault();
        launchExternalDownload({
          type: s.downloaderType,
          customPath: s.downloaderPath,
          customArgs: s.downloaderArgs,
          url: item.getURL(),
          filename: item.getFilename(),
          path: s.downloadsPath,
        });
        return;
      }

      const id = makeId(32);
      const sourceWebContents =
        webContents && !webContents.isDestroyed() ? webContents : null;
      const window = resolveDownloadWindow(sourceWebContents);

      const downloadItem = getDownloadItem(item, id);
      downloads.push(downloadItem);

      const electronDownloadItem = getElectronDownloadItem(
        item,
        sourceWebContents ?? undefined,
        id,
      );
      electronDownloads.push(electronDownloadItem);

      downloadsDialog()?.send('download-started', downloadItem);
      emitDownloadEvent(window, 'download-started', downloadItem);
      emitDownloadEvent(window, 'show-download-dialog');

      item.on('updated', (event, state) => {
        if (state === 'interrupted') {
          downloadsDialog()?.send('download-paused', id);
          emitDownloadEvent(window, 'download-paused', id);
          console.log('Download is interrupted but can be resumed');
        } else if (state === 'progressing') {
          if (item.isPaused()) {
            downloadsDialog()?.send('download-paused', id);
            emitDownloadEvent(window, 'download-paused', id);
            console.log('Download is paused');
          }
        }

        const data = getDownloadItem(item, id);

        Object.assign(downloadItem, data);

        downloadsDialog()?.send('download-progress', data);
        emitDownloadEvent(window, 'download-progress', data);
      });
      item.once('done', async (event, state) => {
        const dialog = downloadsDialog();
        if (state === 'completed') {
          dialog?.send('download-completed', id);
          emitDownloadEvent(window, 'download-completed', id, !!dialog);

          downloadItem.completed = true;

          persistDownload(downloadItem);
        } else {
          downloadItem.completed = false;
          downloadItem.canceled = true;
          downloadsDialog()?.send('download-canceled', id);
          emitDownloadEvent(window, 'download-canceled', id);
          console.log(`Download failed: ${state}`);
        }
      });
    });

    // 读回持久化的已完成下载历史到内存列表,使下载页跨重启保留(get-downloads
    // 轮询会取到)。仅保留最近 100 条;超出 1.5 倍上限的旧记录顺手从 DB 清掉。
    Application.instance.storage
      .find<IDownloadItem & {date?: number}>({scope: 'downloads', query: {}})
      .then((records) => {
        records.sort((a, b) => (a.date || 0) - (b.date || 0));
        const cap = 100;
        for (const r of records.slice(Math.max(0, records.length - cap))) {
          downloads.push({
            fileName: r.fileName,
            receivedBytes: r.receivedBytes,
            totalBytes: r.totalBytes,
            savePath: r.savePath,
            url: r.url,
            id: r.id,
            completed: true,
          });
        }
        if (records.length > cap * 1.5) {
          const excess = records.slice(0, records.length - cap);
          for (const e of excess) {
            Application.instance.storage
              .remove({scope: 'downloads', query: {_id: (e as any)._id}})
              .catch(() => {});
          }
        }
      })
      .catch(() => {
        /* downloads DB 不可用——以空历史启动 */
      });

    ipcMain.on('clear-browsing-data', () => {
      this.clearCache('normal');
      this.clearCache('incognito');
    });

    // 无痕 newtab 页同步询问:本页所在 view 是否无痕(决定渲染本地无痕页而非 pcapp iframe)。
    ipcMain.on('is-newtab-incognito', (e) => {
      const sender = e.sender;
      let incognito = false;
      outer: for (const win of Application.instance.windows.list) {
        for (const view of win.viewManager.views.values()) {
          if (view.browserView && view.browserView.webContents === sender) {
            incognito = !!view.incognito;
            break outer;
          }
        }
      }
      e.returnValue = incognito;
    });

    // 无痕 newtab 搜索框提交:用默认搜索引擎导航当前 view。
    ipcMain.on('newtab-search', (e, query: string) => {
      if (!query || typeof query !== 'string' || query.length > 2048) return;
      const view = Application.instance.windows.list
        .flatMap((window) => Array.from(window.viewManager.views.values()))
        .find((candidate) => candidate.webContents === e.sender);
      if (
        !view?.incognito ||
        !view.webContents.getURL().startsWith(getWebUIURL('newtab'))
      ) {
        return;
      }
      const settings = Application.instance.settings.object;
      const engines = settings.searchEngines;
      const engine = engines?.[settings.searchEngine] || engines?.find((x: any) => x && x.url);
      if (!engine || !engine.url) return;
      const url = (engine.url as string).replace('%s', encodeURIComponent(query));
      if (!view.webContents.isDestroyed()) {
        view.webContents.loadURL(url).catch(() => {});
      }
    });
  }

  public async clearCache(session: 'normal' | 'incognito') {
    const ses = session === 'incognito' ? this.viewIncognito : this.view;

    await Promise.all([
      ses.clearCache(),
      ses.clearStorageData({
        storages: [
          'cookies',
          'filesystem',
          'indexdb',
          'localstorage',
          'shadercache',
          'websql',
          'serviceworkers',
          'cachestorage',
        ],
      }),
    ]).catch((error) => {
      console.error(`[sessions] failed to clear ${session} data`, error);
    });
  }

  public unloadIncognitoExtensions(): Promise<void> {
    return this.queueIncognitoExtensionTask(() =>
      this.unloadIncognitoExtensionsImpl(),
    );
  }

  private getLoadedExtension(id: string): Electron.Extension | undefined {
    try {
      return (
        this.view.getExtension(id) ||
        this.viewIncognito.getExtension(id) ||
        this.extensions.find((extension) => extension.id === id)
      );
    } catch {
      return this.extensions.find((extension) => extension.id === id);
    }
  }

  private isExtensionWebContents(contents: Electron.WebContents, id: string) {
    if (
      contents.isDestroyed() ||
      (contents.session !== this.view && contents.session !== this.viewIncognito)
    )
      return false;
    try {
      return new URL(contents.getURL()).hostname === id;
    } catch {
      return false;
    }
  }

  private extensionViewLabel(rawUrl: string) {
    try {
      const pathname = decodeURIComponent(new URL(rawUrl).pathname)
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
      if (pathname === '_generated_background_page.html') return '背景页';
      return pathname || '扩展页面';
    } catch {
      return '扩展页面';
    }
  }

  private extensionWebContents(id: string) {
    const inspectorHost = this.extensionInspectorHosts.get(id);
    const inspectorHostId =
      inspectorHost && !inspectorHost.isDestroyed()
        ? inspectorHost.webContents.id
        : -1;
    return webContents
      .getAllWebContents()
      .filter(
        (contents) =>
          contents.id !== inspectorHostId &&
          this.isExtensionWebContents(contents, id),
      );
  }

  /** 返回 Chrome「检查视图」中当前可调试的页面与声明的后台 Service Worker。 */
  private getExtensionInspectViews(id: string): IExtInspectView[] {
    const extension = this.getLoadedExtension(id);
    if (!extension) return [];

    const views = this.extensionWebContents(id)
      .map((contents): IExtInspectView => {
        const currentUrl = contents.getURL();
        return {
          id: `web-contents:${contents.id}`,
          type: 'page',
          label: this.extensionViewLabel(currentUrl),
          url: currentUrl,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    const manifest: any = extension.manifest;
    const serviceWorker = manifest?.background?.service_worker;
    if (manifest?.manifest_version === 3 && serviceWorker) {
      views.push({
        id: 'service-worker',
        type: 'service-worker',
        label: '服务工作进程',
        url: `chrome-extension://${id}/${String(serviceWorker).replace(/^\/+/, '')}`,
      });
    }
    return views;
  }

  private destroyExtensionInspectorHost(id: string) {
    const prefix = `${id}:`;
    for (const [key, devToolsWindow] of this.extensionDevToolsWindows) {
      if (!key.startsWith(prefix)) continue;
      this.extensionDevToolsWindows.delete(key);
      try {
        if (!devToolsWindow.isDestroyed()) devToolsWindow.destroy();
      } catch {}
    }

    const host = this.extensionInspectorHosts.get(id);
    this.extensionInspectorHosts.delete(id);
    try {
      if (host && !host.isDestroyed()) host.destroy();
    } catch {}
  }

  private async ensureExtensionInspectorHost(
    id: string,
  ): Promise<Electron.WebContents> {
    const existing = this.extensionInspectorHosts.get(id);
    if (existing && !existing.isDestroyed()) return existing.webContents;

    const host = new Electron.BrowserWindow({
      show: false,
      skipTaskbar: true,
      focusable: false,
      frame: false,
      width: 1,
      height: 1,
      webPreferences: {
        session: this.view,
        sandbox: false,
        contextIsolation: false,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    this.extensionInspectorHosts.set(id, host);
    host.once('closed', () => {
      if (this.extensionInspectorHosts.get(id) === host) {
        this.extensionInspectorHosts.delete(id);
      }
    });
    host.webContents.setWindowOpenHandler(() => ({action: 'deny'}));

    try {
      await host.loadURL(`chrome-extension://${id}/manifest.json`);
      return host.webContents;
    } catch (error) {
      this.destroyExtensionInspectorHost(id);
      throw error;
    }
  }

  private waitForDevToolsFrontend(
    devToolsWindow: Electron.BrowserWindow,
    timeoutMs: number,
  ) {
    return new Promise<boolean>((resolve) => {
      let finished = false;
      let interval: NodeJS.Timeout | undefined;
      let timeout: NodeJS.Timeout | undefined;

      const finish = (opened: boolean) => {
        if (finished) return;
        finished = true;
        if (interval) clearInterval(interval);
        if (timeout) clearTimeout(timeout);
        resolve(opened);
      };

      const check = () => {
        try {
          if (devToolsWindow.isDestroyed()) return finish(false);
          if (devToolsWindow.webContents.getURL().startsWith('devtools://')) {
            finish(true);
          }
        } catch {
          finish(false);
        }
      };

      interval = setInterval(check, 50);
      timeout = setTimeout(() => finish(false), timeoutMs);
      check();
    });
  }

  private async openExtensionDevToolsWindow(
    extensionId: string,
    targetKey: string,
    title: string,
    target: Electron.WebContents,
    open: () => void,
  ): Promise<{ok: boolean; message?: string}> {
    const key = `${extensionId}:${targetKey}`;
    const existing = this.extensionDevToolsWindows.get(key);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      existing.moveTop();
      return {ok: true};
    }
    this.extensionDevToolsWindows.delete(key);

    try {
      if (target.isDevToolsOpened()) target.closeDevTools();
    } catch {}

    const devToolsWindow = new Electron.BrowserWindow({
      show: false,
      width: 1100,
      height: 760,
      minWidth: 720,
      minHeight: 480,
      title,
      autoHideMenuBar: true,
      backgroundColor: '#202124',
    });
    this.extensionDevToolsWindows.set(key, devToolsWindow);

    const cleanup = () => {
      if (this.extensionDevToolsWindows.get(key) === devToolsWindow) {
        this.extensionDevToolsWindows.delete(key);
      }
    };
    devToolsWindow.once('closed', () => {
      cleanup();
      try {
        if (!target.isDestroyed() && target.isDevToolsOpened()) {
          target.closeDevTools();
        }
      } catch {}
    });

    try {
      target.setDevToolsWebContents(devToolsWindow.webContents);
      target.setDevToolsTitle(title);
      open();
      if (!(await this.waitForDevToolsFrontend(devToolsWindow, 5000))) {
        try {
          if (target.isDevToolsOpened()) target.closeDevTools();
        } catch {}
        cleanup();
        if (!devToolsWindow.isDestroyed()) devToolsWindow.destroy();
        return {
          ok: false,
          message: '开发者工具窗口创建失败，请重新加载扩展后重试。',
        };
      }

      target.once('devtools-closed', () => {
        cleanup();
        try {
          if (!devToolsWindow.isDestroyed()) devToolsWindow.destroy();
        } catch {}
      });
      devToolsWindow.show();
      devToolsWindow.setTitle(title);
      devToolsWindow.focus();
      devToolsWindow.moveTop();
      return {ok: true};
    } catch (error) {
      cleanup();
      try {
        if (!devToolsWindow.isDestroyed()) devToolsWindow.destroy();
      } catch {}
      console.error('extension devtools window failed', extensionId, targetKey, error);
      return {ok: false, message: '打开独立开发者工具窗口失败。'};
    }
  }

  private isExtensionWorkerRunning(scope: string) {
    return Object.values(this.view.serviceWorkers.getAllRunning()).some(
      (info) => info.scope === scope,
    );
  }

  private waitForExtensionWorkerRunning(scope: string, timeoutMs: number) {
    if (this.isExtensionWorkerRunning(scope)) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      const workers = this.view.serviceWorkers;
      let finished = false;
      let timer: NodeJS.Timeout | undefined;

      const finish = (running: boolean) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        workers.removeListener('running-status-changed' as any, onStatus);
        resolve(running);
      };

      const onStatus = (details: any) => {
        if (details?.runningStatus !== 'running') return;
        try {
          const worker = workers.getWorkerFromVersionID(details.versionId);
          if (worker?.scope === scope) finish(true);
        } catch {}
      };

      workers.on('running-status-changed' as any, onStatus);
      timer = setTimeout(() => finish(false), timeoutMs);
      // 避免 Worker 在初次检查与事件监听注册之间已进入 running 的竞态。
      if (this.isExtensionWorkerRunning(scope)) finish(true);
    });
  }

  private async inspectExtensionTarget(id: string, targetId: string) {
    const extension = this.getLoadedExtension(id);
    if (!extension) {
      return {ok: false, message: '扩展未启用或已经被卸载。'};
    }

    if (targetId.startsWith('web-contents:')) {
      const contentsId = Number(targetId.slice('web-contents:'.length));
      const target = Number.isFinite(contentsId)
        ? webContents.fromId(contentsId)
        : undefined;
      if (!target || !this.isExtensionWebContents(target, id)) {
        return {ok: false, message: '该检查视图已经关闭，请稍后重试。'};
      }
      return this.openExtensionDevToolsWindow(
        id,
        targetId,
        `${this.extensionViewLabel(target.getURL())} - 开发者工具`,
        target,
        () => target.openDevTools({mode: 'detach'}),
      );
    }

    if (targetId !== 'service-worker') {
      return {ok: false, message: '无法识别该检查视图。'};
    }
    const manifest: any = extension.manifest;
    if (
      manifest?.manifest_version !== 3 ||
      !manifest?.background?.service_worker
    ) {
      return {ok: false, message: '此扩展没有声明服务工作进程。'};
    }

    try {
      const scope = extension.url || `chrome-extension://${id}/`;
      // 始终使用专用同源宿主，不把 DevTools 停靠到真实 Offscreen/扩展页。
      const owner = await this.ensureExtensionInspectorHost(id);

      // Chromium 有时会让 startWorkerForScope 立即 reject，但后台仍进入
      // starting，并在十余秒后变成 running。以生命周期事件为准，不能以
      // startWorkerForScope 的 Promise 结果作为最终失败依据。
      if (!this.isExtensionWorkerRunning(scope)) {
        const runningPromise = this.waitForExtensionWorkerRunning(scope, 20000);
        void this.view.serviceWorkers.startWorkerForScope(scope).catch(() => {
          tlog(
            `extension service worker start request rejected; waiting for running event extId=${id}`,
          );
        });
        if (!(await runningPromise)) {
          return {
            ok: false,
            message:
              '服务工作进程在 20 秒内未能启动，开发者工具无法打开。请重新加载扩展后重试。',
          };
        }
      }
      return this.openExtensionDevToolsWindow(
        id,
        'service-worker',
        `${extension.name || id} - 服务工作进程`,
        owner,
        () => owner.inspectServiceWorker(),
      );
    } catch (error) {
      console.error('extension service worker inspect failed', id, error);
      return {
        ok: false,
        message: '打开服务工作进程开发者工具失败，请重新加载扩展后重试。',
      };
    }
  }

  /**
   * Proactively start an MV3 extension's background service worker.
   *
   * Electron does not eagerly start the background SW after loadExtension();
   * it only starts when an event is routed to it. But the router drops events
   * when no listener is registered yet, and listeners can only register once
   * the SW runs — so without this the background sits un-started until some
   * later page's content script happens to connect (the ~20s startup delay).
   *
   * Mirrors the upstream electron-chrome-extensions shell, which calls
   * startWorkerForScope() for every MV3 extension right after loading.
   */
  private startBackgroundWorker(
    extension: Electron.Extension,
    extensionSession: Electron.Session = this.view,
  ) {
    try {
      const manifest: any = extension?.manifest;
      if (manifest?.manifest_version !== 3 || !manifest?.background?.service_worker) {
        tlog(
          `startBackgroundWorker: skip ${extension?.id} (mv=${manifest?.manifest_version}, sw=${!!manifest?.background?.service_worker})`,
        );
        return;
      }
      const scope = extension.url || `chrome-extension://${extension.id}/`;
      tlog(`startBackgroundWorker: startWorkerForScope -> ${scope}`);

      // Heartbeat: if these keep ticking during the gap, the main process event
      // loop is alive and we're waiting on Chromium to boot the worker. If they
      // STOP, something is blocking the main thread synchronously.
      let beats = 0;
      const hb = setInterval(() => {
        beats++;
        tlog(`heartbeat ${beats} (waiting for SW ${extension.id})`);
        if (beats >= 20) clearInterval(hb);
      }, 2000);

      const t0 = process.uptime();
      (extensionSession.serviceWorkers as any)
        .startWorkerForScope(scope)
        .then(() => {
          clearInterval(hb);
          tlog(
            `startBackgroundWorker: startWorkerForScope resolved ${extension.id} (waited ${(process.uptime() - t0).toFixed(2)}s)`,
          );
        })
        .catch((err: any) => {
          clearInterval(hb);
          tlog(`startBackgroundWorker: startWorkerForScope REJECTED ${extension.id}`, err);
          console.error('startWorkerForScope failed', extension.id, err);
        });
    } catch (e) {
      console.error(e);
    }
  }

  // Loading extensions in an off the record BrowserContext is not supported.
  public loadExtensions(): Promise<void> {
    if (!process.env.ENABLE_EXTENSIONS) return Promise.resolve();
    if (this.extensionsLoaded) return Promise.resolve();
    // Coalesce concurrent callers (eager main-process load + renderer IPC).
    if (this.extensionsLoading) return this.extensionsLoading;
    this.extensionsLoading = this.doLoadExtensions();
    return this.extensionsLoading;
  }

  // 删除体积超过阈值的扩展 storage.local LevelDB 分区,防止主进程启动读取时
  // 原生内存 OOM(0xE0000008)。详见 doLoadExtensions 内调用点的注释。
  // 仅删可重建的缓存目录(Local Extension Settings/<id>),不动扩展本体与其它数据。
  private async cleanupBloatedExtensionStorage(extDirs: string[]) {
    // 阈值:正常扩展的 storage.local 在 1-25MB;uBlock 含引擎缓存约 23MB。
    // 取 300MB 作为"明显膨胀"线——远高于任何健康扩展,只命中 LevelDB 未压缩失控的情况。
    const BLOAT_LIMIT = 300 * 1024 * 1024;
    const base = getPath('Partitions/view/Local Extension Settings');
    if (!base || !existsSync(base)) return;

    const dirSize = async (p: string): Promise<number> => {
      let total = 0;
      let entries: any[];
      try {
        entries = await promises.readdir(p, {withFileTypes: true});
      } catch {
        return 0;
      }
      for (const e of entries) {
        const full = resolve(p, e.name);
        try {
          if (e.isDirectory()) {
            total += await dirSize(full);
          } else {
            total += (await promises.stat(full)).size;
          }
        } catch {
          // 单个文件 stat 失败忽略
        }
        if (total > BLOAT_LIMIT) return total; // 早停:超阈值即可,不必算全
      }
      return total;
    };

    for (const id of extDirs) {
      // 只处理看起来像扩展 id 的目录(32 位小写字母),跳过 .idea 等。
      if (!/^[a-p]{32}$/.test(id)) continue;
      const storageDir = resolve(base, id);
      if (!existsSync(storageDir)) continue;
      try {
        const size = await dirSize(storageDir);
        if (size > BLOAT_LIMIT) {
          tlog(
            `cleanupBloatedExtensionStorage: ${id} storage=${Math.round(size / 1024 / 1024)}MB ` +
              `> ${Math.round(BLOAT_LIMIT / 1024 / 1024)}MB -> 清除(扩展将重建缓存)`,
          );
          await promises.rm(storageDir, {recursive: true, force: true});
        }
      } catch (e) {
        console.error(`cleanupBloatedExtensionStorage: ${id} 处理失败`, e);
      }
    }
  }

  private async doLoadExtensions() {
    try {
      const context = this.view;

      const extensionsPath = getPath('extensions');
      if (!extensionsPath) return;
      // Dev-only: stage the MV2/MV3 regression-test extensions from extensiontest/
      // into data/extensions/<id>/ so the scan below loads them like any other
      // extension. Gated on ENABLE_TEST_EXTENSIONS so it never clutters normal
      // dev work. Fresh copy each start → source edits picked up, stale SHIM
      // patches cleared. See extensiontest/README.md.
      await this.syncDevTestExtensions();
      tlog('doLoadExtensions: begin, reading', extensionsPath);
      const dirs = await promises.readdir(extensionsPath);
      tlog(`doLoadExtensions: readdir -> ${dirs.length} dir(s): ${dirs.join(', ')}`);

      const disabled =
        Application.instance.settings.object.disabledExtensions || [];

      // 扩展 storage.local 膨胀清理(防 0xE0000008 主进程 OOM)。
      // uBlock 等扩展把编译后的过滤引擎缓存(~100MB)无条件镜像写入 chrome.storage.local
      // (cachestorage.js 的 set() 同时写 IndexedDB + storage.local)。Electron 的扩展
      // storage.local 是 LevelDB,且**不做压缩(compaction)**——每次启动重写大键,旧版本
      // 全部保留,多次启动后 Local Extension Settings/<id> 累积到数 GB。启动时主进程读取
      // 这个多 GB LevelDB → 原生内存分配失败 0xE0000008 → 启动即崩(此为原生内存,
      // --max-old-space-size 无效)。这里在加载扩展前检查每个扩展的 storage 分区大小,
      // 超阈值则删除(等同手动清空:扩展下次启动重建缓存,功能不受损,仅丢可重建的缓存)。
      await this.cleanupBloatedExtensionStorage(dirs);

      for (const dir of dirs) {
        try {
          if (disabled.includes(dir)) {
            tlog(`loadExtension: skip disabled ${dir}`);
            continue;
          }
          const path = resolve(extensionsPath, dir);
          // Skip non-extension entries: IDE/VCS dot-dirs (.idea/.git) and any
          // folder without a manifest.json. Without this, loadExtension throws
          // "清单文件缺失或不可读取" on .idea at every startup, and
          // patchExtensionStorage needlessly scans it for JS entries.
          // manifest.json is the canonical signal that a folder is a Chrome ext.
          if (dir.startsWith('.') || !existsSync(resolve(path, 'manifest.json'))) {
            tlog(`loadExtension: skip non-extension dir ${dir}`);
            continue;
          }
          if (this.hasLoadedExtension(dir)) {
            tlog(`loadExtension: skip already loaded ${dir}`);
            continue;
          }
          tlog(`loadExtension: begin ${dir}`);
          // Prepend the chrome.storage.sync->local shim to JS entries BEFORE
          // load, so every extension context (SW/content/popup) gets it on the
          // native chrome object regardless of preload/sandbox flakiness.
          // Gated on the per-dir success marker: skip the file scan when this
          // extension is already patched at the current shim version, re-patch
          // when the marker is missing/stale (e.g. an extension update).
          if (!(await isExtensionStoragePatched(path))) {
            tlog(`loadExtension: patching storage shim ${dir}`);
            await patchExtensionStorage(path);
          }
          const extension = await context.loadExtension(path, {allowFileAccess: true});
          const mv = (extension?.manifest as any)?.manifest_version;
          tlog(`loadExtension: done ${extension.id} (${extension?.name}, mv=${mv})`);

          this.rememberLoadedExtension(extension);

          // Kick off the MV3 background service worker right away so it doesn't
          // wait ~20s for a lazy trigger.
          this.startBackgroundWorker(extension);
          const extVersion = (extension?.manifest as any)?.version;
          const installDetails = await this.getRuntimeInstallDetails(
            extension.id,
            extVersion,
          );
          // Update detected while the app was closed: Chrome fires BOTH
          // onInstalled(update) and onStartup on the session that picks up the
          // new version.
          if (installDetails) {
            this.notifyRuntimeInstalled(extension, installDetails);
          }
          // Every extension loaded at app start gets onStartup (Chrome fires it
          // when a profile with the extension installed starts). The router's
          // pending-event buffer holds this until the SW/background registers
          // its listener.
          this.chromeExtensions?.notifyRuntimeStartup(extension.id);
          await this.saveRuntimeInstalledState(extension.id, extVersion);

          this.broadcastNormal('load-browserAction', extension);
        } catch (e) {
          console.error(e);
        }
      }

      /*if (session === 'incognito') {
        this.incognitoExtensionsLoaded = true;
      }*/

      this.extensionsLoaded = true;
      tlog('doLoadExtensions: all done, extensionsLoaded=true');
    } catch (e) {
      // e.g. extensions dir missing. Clear the in-flight guard so a later
      // caller (renderer 'load-extensions') can retry.
      console.error(e);
      this.extensionsLoading = null;
    }
  }

  /**
   * Dev-only auto-install of the MV2/MV3 regression-test extensions.
   *
   * Stages `extensiontest/{mv2,mv3}` into `data/extensions/<id>/` by composing
   * the shared source (`extensiontest/src/*`) with each variant's manifest.
   * The IDs are derived from each manifest's fixed `key` via getCrxIdByKey, so
   * they stay stable across restarts. The fresh copy each dev start means edits
   * to `extensiontest/src/` are picked up without manual reinstall, and stale
   * SHIM patches are cleared so patchExtensionStorage re-runs cleanly.
   *
   * Does NOT load the extensions itself — the doLoadExtensions scan loop loads
   * them via the same path as any other extension (SHIM injection, `.crx_storage_patch`
   * marker, etc.), so the test exercises the real load path.
   */
  private async syncDevTestExtensions() {
    if (process.env.NODE_ENV !== 'development' || !process.env.ENABLE_TEST_EXTENSIONS) {
      return;
    }
    const testRoot = resolve(process.cwd(), 'extensiontest');
    const srcDir = resolve(testRoot, 'src');
    const extensionsPath = getPath('extensions');
    if (!extensionsPath || !existsSync(srcDir)) return;

    for (const variant of ['mv2', 'mv3'] as const) {
      try {
        const manifestPath = resolve(testRoot, variant, 'manifest.json');
        if (!existsSync(manifestPath)) {
          tlog(`[test-ext] ${variant}: manifest.json missing, skip`);
          continue;
        }
        const manifest = JSON.parse(await promises.readFile(manifestPath, 'utf8'));
        if (!manifest?.key) {
          tlog(`[test-ext] ${variant}: manifest.key missing, skip`);
          continue;
        }
        const id = getCrxIdByKey(manifest.key);
        const installPath = resolve(extensionsPath, id);
        // Fresh copy: drop any prior install (and its SHIM patches) so source
        // edits and SHIM reversion both take effect.
        try {
          await rf(installPath);
        } catch {
          /* first run: nothing to remove */
        }
        await require('fs-extra').copy(srcDir, installPath);
        await promises.writeFile(
          resolve(installPath, 'manifest.json'),
          JSON.stringify(manifest, null, 2),
        );
        tlog(`[test-ext] staged ${variant} -> ${id}`);
      } catch (e) {
        console.error(`[test-ext] ${variant} stage failed`, e);
      }
    }
  }

  // ===== 「拓展」管理页辅助 =====

  // 读取某个扩展目录的 manifest(用于「已安装但停用」的项,它们不在内存中)。
  private async readManifestForDir(dir: string): Promise<any | null> {
    try {
      const extensionsPath = getPath('extensions');
      const manifestPath = resolve(extensionsPath, dir, 'manifest.json');
      return JSON.parse(await promises.readFile(manifestPath, 'utf8'));
    } catch {
      return null;
    }
  }

  // 解析 chrome i18n 占位符 __MSG_key__。复用运行时 catalog(resolveExtMessage),
  // 与扩展 chrome.i18n.getMessage 共享同一份缓存 + locale 顺序
  // (zh_CN→zh→default_locale→en, 见 i18n.ts localeCandidates),保证管理页列表
  // 名字与扩展运行时本地化结果完全一致,而非各走各的回退顺序。
  private resolveI18n(
    path: string,
    text: string,
    defaultLocale: string,
  ): string {
    return resolveExtMessage(path, { default_locale: defaultLocale }, text);
  }

  // 按 extensionId 解析单个 __MSG_key__ 串(给 renderer 用)。查运行时 catalog
  // 缓存,locale 顺序与扩展 chrome.i18n.getMessage 一致。非 __MSG_ 前缀直接返回。
  private resolveMessage(extensionId: string, text: string): string {
    if (!text || typeof text !== 'string' || !text.startsWith('__MSG_'))
      return text || '';
    try {
      const sessionExts: any =
        (this.view as any).extensions || (this.view as any);
      const extension =
        typeof sessionExts.getExtension === 'function'
          ? sessionExts.getExtension(extensionId)
          : this.extensions.find((x: any) => x.id === extensionId);
      if (!extension || !extension.path) return text;
      return resolveExtMessage(extension.path, extension.manifest, text);
    } catch {}
    return text;
  }

  private pickIcon(manifest: any): string {
    const icons = manifest?.icons || manifest?.browser_action?.default_icon ||
      manifest?.action?.default_icon;
    if (!icons) return '';
    if (typeof icons === 'string') return icons;
    const sizes = ['128', '96', '64', '48', '32', '19', '16'];
    for (const s of sizes) if (icons[s]) return icons[s];
    const vals = Object.values(icons);
    return (vals[vals.length - 1] as string) || '';
  }

  // 从磁盘读取图标并转为 base64 data url。对启用 / 停用的扩展都有效
  // (停用扩展无法通过 chrome-extension:// 协议提供资源)。
  private async readIconDataUrl(path: string, rel: string): Promise<string> {
    if (!rel) return '';
    if (rel.startsWith('data:')) return rel;
    try {
      const file = resolve(path, rel.replace(/^\/+/, ''));
      const buf = await promises.readFile(file);
      const ext = extname(file).slice(1).toLowerCase();
      const mime =
        ext === 'svg'
          ? 'image/svg+xml'
          : ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : ext === 'webp'
          ? 'image/webp'
          : 'image/png';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      return '';
    }
  }

  private async toExtItem(
    id: string,
    manifest: any,
    path: string,
    enabled: boolean,
  ) {
    const mv = manifest?.manifest_version || 2;
    // Electron 已加载扩展的 manifest.name/description 会被本地化成 default_locale
    // (常 en),不再是 __MSG_ 原文 → resolveI18n 看到「非 __MSG_」直接返回英文。
    // 始终从磁盘读原始 manifest 拿 name/description/default_locale,让启用与禁用
    // 两类扩展都走同一份 __MSG_ 原文 + locale 解析(禁用分支本就是磁盘原文)。
    let rawDefaultLocale = manifest?.default_locale || '';
    let rawName: string | undefined = manifest?.name;
    let rawDesc: string | undefined = manifest?.description;
    try {
      const rawMan = JSON.parse(
        await promises.readFile(resolve(path, 'manifest.json'), 'utf8'),
      );
      if (rawMan && typeof rawMan === 'object') {
        if (typeof rawMan.name === 'string') rawName = rawMan.name;
        if (typeof rawMan.description === 'string') rawDesc = rawMan.description;
        if (typeof rawMan.default_locale === 'string')
          rawDefaultLocale = rawMan.default_locale;
      }
    } catch {}
    const icon = await this.readIconDataUrl(path, this.pickIcon(manifest));
    const name = this.resolveI18n(path, rawName || id, rawDefaultLocale);
    const description = this.resolveI18n(path, rawDesc || '', rawDefaultLocale);
    const hasBackground = !!(
      manifest?.background?.service_worker ||
      manifest?.background?.page ||
      (manifest?.background?.scripts && manifest.background.scripts.length)
    );

    // 解析 browser_action / action 的 popup,组装成 chrome-extension:// 完整 URL。
    const popupPath =
      manifest?.browser_action?.default_popup ||
      manifest?.action?.default_popup ||
      '';
    const popup = popupPath
      ? `${EXTENSIONS_PROTOCOL}://${id}/${String(popupPath).replace(/^\/+/, '')}`
      : '';

    // 解析选项页:options_ui.page(MV3 推荐)优先,其次 options_page(MV2)。
    // 组装成 chrome-extension:// 完整 URL,供地址栏扩展列表的「设置」入口跳转。
    const optionsPath =
      manifest?.options_ui?.page || manifest?.options_page || '';
    const optionsUrl = optionsPath
      ? `${EXTENSIONS_PROTOCOL}://${id}/${String(optionsPath).replace(/^\/+/, '')}`
      : '';

    return {
      id,
      name,
      version: manifest?.version || '',
      description,
      path,
      manifestVersion: mv,
      permissions: manifest?.permissions || [],
      hostPermissions: manifest?.host_permissions || [],
      optionalPermissions: manifest?.optional_permissions || [],
      enabled,
      incognitoAllowed: (
        Application.instance.settings.object.incognitoAllowedExtensions || []
      ).includes(id),
      icon,
      homepageUrl: manifest?.homepage_url || '',
      hasBackground,
      popup,
      optionsUrl,
    };
  }

  // 合并「内存中已启用」与「目录中已停用」两类,返回给管理页。
  public async getDetailedExtensions() {
    if (!process.env.ENABLE_EXTENSIONS) return [];
    const tasks: Promise<any>[] = [];
    const seen = new Set<string>();

    for (const ext of this.extensions) {
      if (seen.has(ext.id)) continue;
      seen.add(ext.id);
      tasks.push(this.toExtItem(ext.id, ext.manifest, ext.path, true));
    }

    try {
      const extensionsPath = getPath('extensions');
      const dirs = await promises.readdir(extensionsPath);
      for (const dir of dirs) {
        if (seen.has(dir)) continue;
        const manifest = await this.readManifestForDir(dir);
        if (!manifest) continue;
        tasks.push(
          this.toExtItem(dir, manifest, resolve(extensionsPath, dir), false),
        );
      }
    } catch (e) {
      console.error(e);
    }

    const result = await Promise.all(tasks);
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  // 切换扩展「允许在无痕模式运行」。Chrome 只在存在无痕窗口时启动该扩展的
  // split context；白名单本身持久化，最后一个无痕窗口关闭后 context 中的扩展卸载。
  public setExtensionIncognitoAllowed(id: string, allowed: boolean): boolean {
    if (!process.env.ENABLE_EXTENSIONS) return false;
    const settings = Application.instance.settings;
    const list = new Set(settings.object.incognitoAllowedExtensions || []);
    if (allowed) list.add(id);
    else list.delete(id);
    settings.updateSettings({incognitoAllowedExtensions: [...list]});
    if (Application.instance.windows.list.some((window) => window.incognito)) {
      void this.reloadIncognitoExtensions();
    }
    return true;
  }

  public loadIncognitoExtensions(): Promise<void> {
    if (!process.env.ENABLE_EXTENSIONS) return Promise.resolve();
    return this.queueIncognitoExtensionTask(async () => {
      await this.incognitoDataReady;
      await this.syncIncognitoExtensions();
    });
  }

  public reloadIncognitoExtensions(): Promise<void> {
    return this.loadIncognitoExtensions();
  }

  private queueIncognitoExtensionTask(task: () => Promise<void>): Promise<void> {
    this.incognitoExtensionTask = this.incognitoExtensionTask
      .catch(() => {})
      .then(task);
    return this.incognitoExtensionTask;
  }

  private getIncognitoExtensions(): Electron.Extension[] {
    try {
      return this.viewIncognito.getAllExtensions();
    } catch {
      return [];
    }
  }

  private async syncIncognitoExtensions() {
    if (!Application.instance.windows.list.some((window) => window.incognito)) {
      return;
    }

    const settings = Application.instance.settings.object;
    const disabled = new Set(settings.disabledExtensions || []);
    const allowed = new Set(
      (settings.incognitoAllowedExtensions || []).filter(
        (id) => id && !disabled.has(id),
      ),
    );

    if (!this.chromeExtensionsIncognito && allowed.size > 0) {
      this.chromeExtensionsIncognito = new ElectronChromeExtensions(
        this.buildIncognitoExtensionsOptions(),
      );
      this.attachIncognitoExtensionEvents(this.chromeExtensionsIncognito);
      this.registerExtensionWebRequest(this.chromeExtensionsIncognito);
      Application.instance.windows.list
        .filter((window) => window.incognito)
        .forEach((window) => {
          window.viewManager.views.forEach((view) =>
            view.registerExtensionContext(),
          );
        });
    }

    const loaded = this.getIncognitoExtensions();
    for (const extension of loaded) {
      if (allowed.has(extension.id)) continue;
      try {
        this.viewIncognito.removeExtension(extension.id);
      } catch (error) {
        console.error(`[incognito-ext] failed to unload ${extension.id}`, error);
      }
      this.broadcastIncognito('remove-browserAction', extension.id);
    }

    if (!this.chromeExtensionsIncognito) {
      this.incognitoExtensionsLoaded = false;
      return;
    }

    for (const id of allowed) {
      if (this.viewIncognito.getExtension(id)) continue;
      const path = resolve(getPath('extensions'), id);
      if (!existsSync(resolve(path, 'manifest.json'))) continue;
      try {
        await patchExtensionStorage(path);
        const extension = await this.viewIncognito.loadExtension(path, {
          allowFileAccess: true,
        });
        this.startBackgroundWorker(extension, this.viewIncognito);
        this.chromeExtensionsIncognito.notifyRuntimeStartup(extension.id);
        this.broadcastIncognito('load-browserAction', extension);
      } catch (error) {
        console.error(`[incognito-ext] failed to load ${id}`, error);
      }
    }

    this.incognitoExtensionsLoaded = this.getIncognitoExtensions().length > 0;
    console.log(
      '[incognito-ext] active',
      this.getIncognitoExtensions().length,
      'extension(s)',
    );
  }

  // 把一个 ElectronChromeExtensions 实例的 webRequest dispatcher + DNR enforcer
  // 注册到 adblock 的多实例数组。普通实例与无痕实例各调一次。
  private registerExtensionWebRequest(crx: ElectronChromeExtensions | null) {
    if (!crx) return;
    const webRequestRouter = (crx as any).ctx?.router;
    const webRequestApi = (crx as any).ctx?.webRequest;
    if (webRequestRouter) {
      setWebRequestDispatcher((crx as any).ctx.session, (eventName: string, details: any) => {
        try {
          if (webRequestApi?.dispatchChromeEvent) {
            webRequestApi.dispatchChromeEvent(eventName, details);
          } else {
            webRequestRouter.broadcastEvent(`webRequest.${eventName}`, details);
          }
        } catch (err) {
          console.error('[sessions-service] webRequest dispatch error:', err);
        }
      });
    }
    const dnr = (crx as any).ctx?.declarativeNetRequest;
    if (dnr && typeof dnr.decideBeforeRequest === 'function') {
      setDnrEnforcer((crx as any).ctx.session, dnr);
    }
  }

  // ElectronChromeExtensions 在 vendor 中按 Session 强制单例，不能销毁后重新 new。
  // 因此这里只卸载 session 内全部扩展，保留路由实例供下一次无痕窗口复用。
  private async unloadIncognitoExtensionsImpl() {
    for (const extension of this.getIncognitoExtensions()) {
      try {
        this.viewIncognito.removeExtension(extension.id);
      } catch (error) {
        console.error(`[incognito-ext] failed to unload ${extension.id}`, error);
      }
      this.broadcastIncognito('remove-browserAction', extension.id);
    }
    this.incognitoExtensionsLoaded = false;
  }

  public endIncognitoSession(): Promise<void> {
    const cleanup = this.queueIncognitoExtensionTask(async () => {
      await this.unloadIncognitoExtensionsImpl();
      await this.clearCache('incognito');
    });
    this.incognitoDataReady = cleanup;
    return cleanup;
  }

  private broadcastIncognito(channel: string, ...args: any[]) {
    Application.instance.windows.list
      .filter((window) => window.incognito)
      .forEach((window) => window.send(channel, ...args));
  }

  // 第二个 ElectronChromeExtensions 实例的构造选项(session=viewIncognito)。
  // 回调聚焦无痕:开标签/窗口优先落到无痕窗口;bookmarks/history/management 等
  // 不依赖 session 的实现与第一实例一致。
  private buildIncognitoExtensionsOptions(): any {
    const modulePath = `${app.getAppPath()}/build/crx-preload.bundle.js`;
    const findIncognitoWindow = () =>
      Application.instance.windows.list.find(
        (window) => window.incognito && !window.win.isDestroyed(),
      );
    return {
      modulePath,
      session: this.viewIncognito,
      assignTabDetails(details: chrome.tabs.Tab) {
        details.incognito = true;
      },
      createTab(details: any) {
        const appWin = findIncognitoWindow() || Application.instance.windows.open(true);
        const view = appWin.viewManager.create(
          details,
          true,
          true,
        );
        return [view.webContents, view.window.win];
      },
      selectTab(tab: any, browserWindow: any) {
        const appWin =
          Application.instance.windows.list.find(
            (x) => x.win.id === browserWindow.id,
          ) || findIncognitoWindow();
        appWin?.viewManager.select(tab.id, true, false);
      },
      removeTab(tab: any, browserWindow: any) {
        const appWin =
          Application.instance.windows.list.find(
            (x) => x.win.id === browserWindow.id,
          ) || findIncognitoWindow();
        appWin?.viewManager.removeByTabId(tab.id);
      },
      createWindow(details: any) {
        let appWin: any = Application.instance.windows.list.find(
          (x) => x.incognito && !x.win.isDestroyed(),
        );
        if (!appWin) appWin = Application.instance.windows.open(true);
        const urls = Array.isArray(details.url)
          ? details.url
          : details.url
            ? [details.url]
            : [];
        urls.forEach((u: string, i: number) => {
          appWin.viewManager.create(
            {url: u, active: i === urls.length - 1},
            false,
            true,
          );
        });
        return appWin.win;
      },
      isIncognitoWindow() {
        return true;
      },
      removeWindow(window: Electron.BrowserWindow) {
        if (!window.isDestroyed()) window.close();
      },
      async requestPermissions(extension: any, requested: any) {
        const permissionNames = [
          ...(requested.permissions || []),
          ...(requested.origins || []),
        ];
        if (permissionNames.length === 0) return true;
        const owner =
          Application.instance.windows.current ||
          Application.instance.windows.lastFocused;
        const opts: Electron.MessageBoxOptions = {
          type: 'question',
          title: '扩展权限请求',
          message: `${extension.name} 请求以下权限`,
          detail: permissionNames.join('\n'),
          buttons: ['允许', '拒绝'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        };
        const result = owner?.win
          ? await dialog.showMessageBox(owner.win, opts)
          : await dialog.showMessageBox(opts);
        return result.response === 0;
      },
      bookmarks: createBookmarksImpl(Application.instance.storage),
      history: createHistoryImpl(Application.instance.storage),
      management: {
        setEnabled: (id: string, enabled: boolean) =>
          this.setExtensionEnabled(id, enabled),
        uninstall: (id: string) => this.uninstallExtension(id),
      },
      openSidePanel: (
        extensionId: string,
        tabId: number,
        panelPath: string,
        windowId?: number,
      ) => {
        const w =
          (windowId != null
            ? Application.instance.windows.list.find((x) => x.win.id === windowId)
            : null) ||
          Application.instance.windows.current ||
          Application.instance.windows.lastFocused;
        w?.sidePanels.show(extensionId, tabId, panelPath);
      },
    };
  }

  // 为第二实例注册 browser-action-update 转发,使无痕窗口工具栏也能显示
  // 无痕扩展的 badge/title/popup 变化(与第一实例的转发一致)。
  private attachIncognitoExtensionEvents(crx: ElectronChromeExtensions) {
    (crx as any).on(
      'browser-action-update',
      (extensionId: string, propName: string, value: any, tabId?: number) => {
        let action: BrowserActionChangeType;
        let details: any;
        switch (propName) {
          case 'text':
            action = 'setBadgeText';
            details = {text: value};
            break;
          case 'popup':
            action = 'setPopup';
            details = {popup: value};
            break;
          case 'title':
            action = 'setTitle';
            details = {title: value};
            break;
          case 'color':
            action = 'setBadgeBackgroundColor';
            details = {color: value};
            break;
          case 'textColor':
            action = 'setBadgeTextColor';
            details = {textColor: value};
            break;
          case 'enabled':
            action = 'setEnabled';
            details = {enabled: value};
            break;
          case 'icon':
            this.resolveActionIcon(extensionId, value)
              .then((icon) => {
                if (!icon) return;
                const d: any = {icon};
                if (tabId) d.tabId = tabId;
                this.onIncognitoBrowserActionUpdate(extensionId, 'setIcon', d);
              })
              .catch((err) => tlog('resolveActionIcon failed', err));
            return;
          default:
            return;
        }
        if (tabId) details.tabId = tabId;
        this.onIncognitoBrowserActionUpdate(extensionId, action, details);
      },
    );
  }

  public async setExtensionEnabled(
    id: string,
    enabled: boolean,
    options: {skipRuffleWarning?: boolean} = {},
  ) {
    if (!process.env.ENABLE_EXTENSIONS) return false;
    const settings = Application.instance.settings;
    const disabled = new Set(settings.object.disabledExtensions || []);

    if (
      id === RUFFLE_EXTENSION_ID &&
      !enabled &&
      !options.skipRuffleWarning
    ) {
      if (!(await this.confirmRuffleRemoval('disable'))) return false;
      settings.updateSettings({flashSupport: false});
    }

    if (enabled) {
      disabled.delete(id);
      settings.updateSettings({ disabledExtensions: [...disabled] });
      if (this.hasLoadedExtension(id)) {
        return true;
      }
      try {
        const extensionsPath = getPath('extensions');
        const path = resolve(extensionsPath, id);
        await patchExtensionStorage(path);
        const extension = await this.view.loadExtension(path, {
          allowFileAccess: true,
        });
        this.rememberLoadedExtension(extension);
        this.startBackgroundWorker(extension);
        // Re-enabling is a startup-equivalent, NOT an install (Chrome never
        // fires onInstalled on enable). Fire onStartup; only emit onInstalled
        // if the extension was updated to a new version while disabled.
        const enabledVersion = (extension?.manifest as any)?.version;
        const enabledInstallDetails = await this.getRuntimeInstallDetails(
          extension.id,
          enabledVersion,
        );
        if (enabledInstallDetails) {
          this.notifyRuntimeInstalled(extension, enabledInstallDetails);
        }
        this.chromeExtensions?.notifyRuntimeStartup(extension.id);
        await this.saveRuntimeInstalledState(extension.id, enabledVersion);
        this.broadcastNormal('load-browserAction', extension);
        if (Application.instance.windows.list.some((window) => window.incognito)) {
          await this.reloadIncognitoExtensions();
        }
        if (id === RUFFLE_EXTENSION_ID) {
          settings.updateSettings({flashSupport: true});
        }
        return true;
      } catch (e) {
        console.error(e);
        return false;
      }
    } else {
      disabled.add(id);
      settings.updateSettings({ disabledExtensions: [...disabled] });
      try {
        this.destroyExtensionInspectorHost(id);
        this.extensions = this.extensions.filter((it) => it.id != id);
        await this.view.removeExtension(id);
      } catch (e) {
        console.error(e);
      }
      this.broadcastNormal('remove-browserAction', id);
      if (Application.instance.windows.list.some((window) => window.incognito)) {
        await this.reloadIncognitoExtensions();
      }
      return true;
    }
  }

  // ===== 夜间模式(darknight 扩展随「生效主题切换」联动)=====
  // darknight.crx(即 Dark Reader)在主题发生切换时启用/停用:暗色→安装(幂等)+启用;
  // 浅色→停用(仅 removeExtension + 加入 disabledExtensions,不卸载、保留用户数据)。
  // 扩展 ID 由 crx 内嵌公钥决定,运行时从 bundled crx 解析并缓存,避免硬编码与
  // crx 替换后失配。联动只由 Settings.update() 检测到主题明暗状态变化时触发；
  // 启动、普通设置保存以及用户手动启停扩展时都不校准，保留扩展的独立控制权。
  private darknightIdPromise: Promise<string> | null = null;

  // 解析 bundled darknight.crx 的扩展 ID(缓存)。crx 始终随包发布,任何时刻可读。
  private resolveDarknightId(): Promise<string> {
    if (this.darknightIdPromise) return this.darknightIdPromise;
    this.darknightIdPromise = (async () => {
      const crxPath = resolve(app.getAppPath(), 'static', 'darknight.crx');
      const buf = await promises.readFile(crxPath);
      const info = parseCrx(buf);
      if (!info || !info.id) {
        throw new Error('darknight.crx 解析失败:缺少 crx id');
      }
      return info.id;
    })();
    // 失败则清空缓存,允许下次重试(否则一个 rejected promise 会让后续调用永久失败)。
    this.darknightIdPromise.catch(() => {
      this.darknightIdPromise = null;
    });
    return this.darknightIdPromise;
  }

  // 幂等安装 darknight:已落盘(有 manifest.json)则直接返回 id,否则从 bundled crx 安装。
  // 不改变 enabled/disabled 状态——装载与否由 setExtensionEnabled / doLoadExtensions 负责。
  public async ensureDarknightInstalled(): Promise<string> {
    const id = await this.resolveDarknightId();
    const extensionsPath = getPath('extensions');
    const dest = resolve(extensionsPath, id);
    if (existsSync(resolve(dest, 'manifest.json'))) {
      tlog(`ensureDarknightInstalled: 已安装 ${id}`);
      return id;
    }
    const crxPath = resolve(app.getAppPath(), 'static', 'darknight.crx');
    const buf = await promises.readFile(crxPath);
    const crxInfo = parseCrx(buf);
    tlog(`ensureDarknightInstalled: 安装 ${id}`);
    // force=true:清掉可能的残留半解压目录后再装(installExtensionFromCrxInfo 内部处理)。
    await this.installExtensionFromCrxInfo(crxInfo, true);
    return id;
  }

  // darknight 联动串行化:主题可能在短时间内反复切换(nativeTheme 'updated' 抖动),
  // 用 Promise 链避免并发 install/load 冲突。
  private darknightSyncChain: Promise<void> = Promise.resolve();

  // 按生效主题同步 darknight 启用状态。isDark=true→装+启用;false→停用。
  // reloadOnApply=true 时,仅在 darknight 实际发生启/停切换(状态翻转)后刷新当前网页,
  // 让 Dark Reader 立即生效/还原——否则已打开的页面要到下次导航才会变。
  // fire-and-forget 调用,内部 catch,绝不向调用方抛错(主题切换不应被扩展故障阻塞)。
  public syncDarknightForTheme(
    isDark: boolean,
    reloadOnApply: boolean = false,
  ): Promise<void> {
    this.darknightSyncChain = this.darknightSyncChain
      .then(() => this.doSyncDarknight(isDark, reloadOnApply))
      .catch((e) => tlog('syncDarknightForTheme error', e));
    return this.darknightSyncChain;
  }

  private async doSyncDarknight(isDark: boolean, reloadOnApply: boolean) {
    if (!process.env.ENABLE_EXTENSIONS) return;
    try {
      const id = await this.resolveDarknightId();
      // changed:本次调用是否真的翻转了 darknight 的启停状态。用于决定是否刷新当前页。
      // 幂等调用(状态未变)不会刷新,所以任意设置变更触发的 update() 都是安全的。
      let changed = false;
      if (isDark) {
        const wasLoaded = this.hasLoadedExtension(id);
        // 1) 幂等安装(首次暗色 / 被卸载后重新进入暗色)。
        await this.ensureDarknightInstalled();
        // 2) 若仍未装载(被禁用 / 刚安装未自动装 / 启动期被跳过),启用装载。
        //    ensureDarknightInstalled 在新装时会 loadExtension,此分支主要覆盖
        //    「已落盘但处于 disabledExtensions」的回归暗色场景。
        if (!this.hasLoadedExtension(id)) {
          changed = !!(await this.setExtensionEnabled(id, true));
        } else {
          // 首次安装会在 ensureDarknightInstalled() 内直接装载扩展。
          changed = !wasLoaded;
        }
      } else {
        // 浅色:仅在已装载时停用(setExtensionEnabled 会把 id 加入 disabledExtensions,
        // 下次启动 doLoadExtensions 自动跳过)。
        if (this.hasLoadedExtension(id)) {
          changed = !!(await this.setExtensionEnabled(id, false));
        }
      }
      // 切换刚发生且由用户实时操作触发:刷新当前网页,让 Dark Reader 立即生效/还原。
      if (changed && reloadOnApply) {
        this.reloadCurrentPageForThemeChange();
      }
    } catch (e) {
      console.error('doSyncDarknight 失败', e);
    }
  }

  // 刷新当前窗口的选中网页视图。仅在 darknight 启停切换后调用,确保夜间模式即时生效。
  // 跳过 about:blank 等无意义目标;webui 页(设置等)若恰好是当前页也会刷新。
  private reloadCurrentPageForThemeChange() {
    try {
      const win = Application.instance.windows?.current;
      const view = win?.viewManager?.selected;
      const wc = view?.webContents;
      if (!wc || wc.isDestroyed()) return;
      const u = wc.getURL();
      if (!u || u === 'about:blank') return;
      wc.reload();
    } catch (e) {
      tlog('reloadCurrentPageForThemeChange failed', e);
    }
  }

  // ===== 方案B: SW 生命周期监听 + preload 注入失败检测 =====
  // 挂 running-status-changed 与 console-message 两个监听到指定 session。
  // view 与 viewIncognito 各调一次,共用 handler,确保两个 session 的被动唤醒
  // 都被检测覆盖(原代码只挂了 view,incognito 场景漏检)。
  private attachSWLifecycleListeners(ses: Electron.Session) {
    // Trace the MV3 background service worker lifecycle. This is the key
    // signal for the startup-delay diagnosis: it shows exactly when Chromium
    // moves the worker through starting/running/stopped, vs. when we asked it
    // to (startWorkerForScope) and when its code first logs.
    try {
      (ses.serviceWorkers as any).on(
        'running-status-changed',
        (details: any) => {
          this.onSWRunningStatus(ses, details);
        },
      );
    } catch (e) {
      tlog('failed to attach SW running-status-changed listener', e);
    }

    // Forward extension service-worker console output to the main process
    // stdout. MV3 extensions (e.g. Tampermonkey) run their logic in a service
    // worker whose DevTools aren't reachable here, so this is the only way to
    // see install/runtime errors.
    try {
      ses.serviceWorkers.on(
        'console-message' as any,
        (_event: any, details: any) => {
          this.onSWConsoleMessage(details);
        },
      );
    } catch (e) {
      console.log('Failed to attach service-worker console listener', e);
    }
  }

  private onSWRunningStatus(ses: Electron.Session, details: any) {
    let scope = `versionId=${details?.versionId}`;
    try {
      const sw = (ses.serviceWorkers as any).getWorkerFromVersionID?.(
        details.versionId,
      );
      if (sw?.scope) scope = sw.scope;
    } catch (e) {}
    tlog(`SW running-status-changed: ${details?.runningStatus} ${scope}`);
    // Do not schedule a destructive preload-health timeout here. Electron's
    // service-worker IPC beacon is not guaranteed to reach global ipcMain, so
    // absence of the beacon says nothing about whether the worker API is usable.
    // The preload and source shim repair the namespace in place.

    // When a service worker is terminated (idle timeout / reload / unload), tear
    // down any open "inspect service worker" devtools window pointing at it. The
    // SW is freely recycled after this; leaving its devtools window alive would
    // pin a dead target (stale front-end state + a lingering BrowserWindow) until
    // the user closes it or the extension is reloaded/disabled.
    // The inspector UI currently targets the normal extension session only
    // (inspectExtensionTarget uses this.view). An incognito split-context worker
    // has the same extension id and must not close that unrelated inspector.
    if (ses === this.view && details?.runningStatus === 'stopped') {
      const extId = /^chrome-extension:\/\/([^/]+)\//.exec(scope || '')?.[1];
      if (extId) this.closeExtensionDevToolsWindow(`${extId}:service-worker`);
    }
  }

  /** Close a single inspector devtools window by its `<extId>:<targetKey>` key. */
  private closeExtensionDevToolsWindow(key: string) {
    const win = this.extensionDevToolsWindows.get(key);
    if (!win) return;
    this.extensionDevToolsWindows.delete(key);
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch {}
  }

  private onSWConsoleMessage(details: any) {
    // Drop the crx-preload API-trace spam (console.log(fnName,...) in
    // the extension API preload). It buries the real startup timeline.
    // Keep ALL of our explicit bracketed diagnostics ([crx-preload],
    // [crx-mws], [crx-ee], [ns-cap], [action-cap], ...) — they all begin
    // with '[', whereas the trace spam begins with the fn name
    // ("tabs.query ..."). Without this, SW-side [crx-mws]/[ns-cap] lines
    // were dropped whenever their sourceUrl resolved to the preload
    // bundle, hiding whether injection actually landed in the worker.
    if (
      details.sourceUrl &&
      details.sourceUrl.includes('crx-preload.bundle.js') &&
      !(details.message && details.message.trimStart().startsWith('[')) &&
      !(details.message && details.message.includes('injectExtensionAPIs'))
    ) {
      return;
    }
    console.log(
      `[T ${nowTs()}] [ext-sw][${details.level}] ${details.message} (${details.sourceUrl}:${details.lineNumber})`,
    );
  }

  // 从 scope(chrome-extension://<id>/)解析 extensionId。
  private extIdFromScope(scope: string): string | undefined {
    if (!scope) return undefined;
    const m = /chrome-extension:\/\/([^/]+)/.exec(scope);
    return m?.[1];
  }

  private swContextKey(ses: Electron.Session, extId: string): string {
    return `${ses === this.viewIncognito ? 'incognito' : 'normal'}:${extId}`;
  }

  /** Exact health signal from the service-worker preload IPC event. Unlike
   * serviceWorkers.console-message, this event carries the owning Session and
   * ServiceWorkerMain, so normal/incognito workers with the same extension id
   * cannot acknowledge one another. */
  public onCrxPreloadBeacon(event: any, message: any) {
    if (message !== 'sw-api-ready' || event?.type !== 'service-worker') return;
    const ses = event.session as Electron.Session | undefined;
    const scope = event.serviceWorker?.scope as string | undefined;
    const extId = this.extIdFromScope(scope || '');
    if (!ses || !extId || (ses !== this.view && ses !== this.viewIncognito)) return;
    const key = this.swContextKey(ses, extId);
    tlog(`SW API ready session=${key}`);
  }

  private async reloadExtensionForSession(
    id: string,
    ses: Electron.Session,
  ): Promise<boolean> {
    if (ses === this.viewIncognito) {
      let result = false;
      await this.queueIncognitoExtensionTask(async () => {
        result = await this.reloadExtensionInSession(id, ses);
      });
      return result;
    }
    return this.reloadExtensionInSession(id, ses);
  }

  private async reloadExtensionInSession(
    id: string,
    ses: Electron.Session,
  ): Promise<boolean> {
    if (!process.env.ENABLE_EXTENSIONS) return false;
    const incognito = ses === this.viewIncognito;
    const context = incognito
      ? this.chromeExtensionsIncognito
      : this.chromeExtensions;
    if (incognito && !context) return false;
    try {
      this.destroyExtensionInspectorHost(id);
      const extensionsPath = getPath('extensions');
      const path = resolve(extensionsPath, id);
      try {
        await ses.removeExtension(id);
      } catch {}
      if (incognito) this.broadcastIncognito('remove-browserAction', id);
      else this.broadcastNormal('remove-browserAction', id);
      await patchExtensionStorage(path);
      const extension = await ses.loadExtension(path, {
        allowFileAccess: true,
      });
      if (!incognito) this.rememberLoadedExtension(extension);
      this.startBackgroundWorker(extension, ses);
      // reload == a fresh SW cold start; fire onStartup so extensions that seed
      // EPHEMERAL/session storage there (e.g. dessant search-by-image) re-run
      // it. onInstalled is NOT fired: reload is neither install nor update.
      context?.notifyRuntimeStartup(extension.id);
      if (incognito) this.broadcastIncognito('load-browserAction', extension);
      else this.broadcastNormal('load-browserAction', extension);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  public async reloadExtension(id: string) {
    return this.reloadExtensionForSession(id, this.view);
  }

  async uninstallExtension(
    id: string,
    options: {skipRuffleWarning?: boolean} = {},
  ): Promise<boolean> {
    if (!process.env.ENABLE_EXTENSIONS) return false;
    if (
      id === RUFFLE_EXTENSION_ID &&
      !options.skipRuffleWarning
    ) {
      if (!(await this.confirmRuffleRemoval('uninstall'))) return false;
      Application.instance.settings.updateSettings({flashSupport: false});
    }
    const newtab = Application.instance.settings.object.newtab;
    if (newtab) {
      let tabs = "";
      // let tabs = newtab.split("\n").filter(it => !it.includes(id)).join("\n");
      Application.instance.settings.updateSettings({newtab: tabs});
      Application.instance.windows.broadcast('update-settings', Application.instance.settings.object);
    }

    await this.queueIncognitoExtensionTask(async () => {
      if (this.viewIncognito.getExtension(id)) {
        this.viewIncognito.removeExtension(id);
        this.broadcastIncognito('remove-browserAction', id);
      }
    });

    const extension = this.view.getExtension(id);
    this.extensions = this.extensions.filter(it => it.id != id);
    this.destroyExtensionInspectorHost(id);

    if (extension) {
      await this.view.removeExtension(id);
      await rf(extension.path);
    }

    // 卸载后清理扩展自有的存储数据(chrome.storage.local/sync/managed LevelDB +
    // IndexedDB + localStorage/SW/cache)。removeExtension 已停 SW 并释放文件句柄,
    // 此时删除不会被 Windows 文件锁挡住(卸载前删会因句柄占用而失败)。
    await this.cleanupExtensionData(id);

    // 停用列表中若残留该 id,一并清除。
    const disabled = (Application.instance.settings.object.disabledExtensions || [])
      .filter((x) => x !== id);
    const incognitoAllowedExtensions = (
      Application.instance.settings.object.incognitoAllowedExtensions || []
    ).filter((x) => x !== id);
    Application.instance.settings.updateSettings({
      disabledExtensions: disabled,
      incognitoAllowedExtensions,
    });

    const extensionsPath = getPath('extensions');
    const path = resolve(extensionsPath, id);
    await rf(path);

    this.broadcastNormal('remove-browserAction', id);
    return true;
  }

  // 清理被卸载扩展的自有存储数据。仅由 uninstallExtension 调用;
  // 禁用(setExtensionEnabled)/重载(reloadExtension)路径绝不能调,否则会丢用户数据。
  // 须在 view.removeExtension 之后调用:扩展已从 session 卸载、SW 已停、LevelDB/
  // IndexedDB 文件句柄已释放,promises.rm 在 Windows 上才不会被文件锁挡住。
  private async cleanupExtensionData(id: string) {
    // (1) chrome.storage.local/sync/managed —— 扩展子系统 LevelDB,clearStorageData 清不掉,
    //     每个扩展独立 <id> 子目录,整目录删除安全。
    for (const sub of ['Local Extension Settings', 'Sync Extension Settings', 'Managed Extension Settings']) {
      const dir = getPath('Partitions/view/' + sub);
      if (!dir) continue;
      const target = resolve(dir, id);
      if (existsSync(target)) {
        try {
          await promises.rm(target, {recursive: true, force: true});
          tlog(`cleanupExtensionData: removed ${sub}/${id}`);
        } catch (e) {
          console.error(`cleanupExtensionData: ${sub}/${id} 删除失败`, e);
        }
      }
    }
    // (2) Web 存储(localStorage/IndexedDB/SW/cache/filesystem)按 origin 清。
    //     Local Storage 是所有网站+扩展共享的 LevelDB,不能整目录删,只能这样按 origin 清 key。
    try {
      await this.view.clearStorageData({
        origin: `chrome-extension://${id}`,
        storages: [
          'appcache', 'cookies', 'filesystem', 'indexdb', 'localstorage',
          'shadercache', 'websql', 'serviceworkers', 'cachestorage',
        ],
      });
      tlog(`cleanupExtensionData: clearStorageData for ${id}`);
    } catch (e) {
      console.error(`cleanupExtensionData: clearStorageData ${id} 失败`, e);
    }
    // (3) IndexedDB 残留目录兜底 —— clearStorageData 对 chrome-extension:// origin 的 indexdb
    //     偶有清不干净,直接删按 id 隔离的残留目录(文件名形如 chrome-extension_<id>_0.*)。
    const idbBase = getPath('Partitions/view/IndexedDB');
    if (idbBase && existsSync(idbBase)) {
      for (const suffix of ['_0.indexeddb.leveldb', '_0.indexeddb.blob']) {
        const target = resolve(idbBase, `chrome-extension_${id}${suffix}`);
        if (existsSync(target)) {
          try {
            await promises.rm(target, {recursive: true, force: true});
          } catch (e) {
            console.error(`cleanupExtensionData: IndexedDB ${id} 删除失败`, e);
          }
        }
      }
    }
  }

  // 若扩展声明了 chrome_url_overrides.newtab,把它登记为新标签页地址。
  // (原为 SessionsService 构造函数内的局部函数,提升为方法以便安装/更新链路共用。)
  private saveNewTabUrl(id: string, manifest: any, extension: Electron.Extension) {
    if (extension && manifest.chrome_url_overrides) {
      let newtab = manifest.chrome_url_overrides.newtab;
      if (newtab) {
        newtab = "chrome-extension://" + id + "/" + newtab;
        let tabs0 = Application.instance.settings.object.newtab;
        if (tabs0) {
          let tabs1 = tabs0.split("\n");
          tabs1.unshift(newtab);
          tabs0 = tabs1.join("\n");
        } else {
          tabs0 = newtab;
        }
        //这里加载的url和记忆的不一样，不知道为什么重启软件和这里得到的id和url不一样
        let nowTabUrl = "chrome-extension://" + extension.id + "/" + manifest.chrome_url_overrides.newtab;
        console.log('update-newtab-url', newtab, nowTabUrl);
        Application.instance.settings.updateSettings({newtab: tabs0});
        Application.instance.windows.broadcast('update-newtab-url', tabs0, nowTabUrl);
        Application.instance.tempTabUrl = nowTabUrl;
      }
    }
  }

  // 新安装扩展时,若当前固定到地址栏的扩展不足 3 个,自动把新扩展加入固定列表。
  // 仅安装路径调用;普通启动/刷新/重载都不会补位,地址栏展示完全遵循用户固定状态。
  private pinExtensionOnInstall(extensionId: string) {
    if (!extensionId) return;

    const current = Application.instance.settings.object.pinnedExtensions || [];
    const existing = current.filter(Boolean);

    if (existing.includes(extensionId)) return;
    if (
      existing.length >= SessionsService.DEFAULT_PINNED_EXTENSIONS_COUNT
    ) {
      return;
    }

    Application.instance.settings.updateSettings({
      pinnedExtensions: [...existing, extensionId],
    });
  }

  // 解压 crx(含 publicKey)到 data/extensions/<id>/、修补 storage、加载并启动后台。
  // force=true 时覆盖已存在的安装(用于本地安装 / 商店安装 / 自动更新)。
  // (原为构造函数内的 installItemByCrxInfo 局部函数,提升为公开方法供 extension-updater 复用。)
  public async installExtensionFromCrxInfo(
    crxInfo: any,
    force: Boolean = false,
    pinOnInstall = false,
  ): Promise<Electron.Extension> {
    const extensionsPath = getPath('extensions');
    const path = resolve(extensionsPath, crxInfo.id);
    const manifestPath = resolve(path, 'manifest.json');
    let previousVersion: string | undefined;

    if (await pathExists(path)) {
      if (force) {
        try {
          const previousManifest = JSON.parse(
            await promises.readFile(manifestPath, 'utf8'),
          );
          previousVersion = previousManifest?.version;
        } catch {}
        await deletePath(path);
      } else {
        console.log('Extension is already installed');
        return null;
      }
    }

    await extractZip(crxInfo.zip, path);
    await patchExtensionStorage(path);
    const manifest = JSON.parse(
      await promises.readFile(manifestPath, 'utf8'),
    );
    if (manifest) {
      if (crxInfo.publicKey) {
        manifest.key = crxInfo.publicKey.toString('base64');
        await promises.writeFile(
          manifestPath,
          JSON.stringify(manifest, null, 2),
        );
      }
    }

    const extension = await this.view.loadExtension(path, {allowFileAccess: true});
    console.log(extension);
    if (manifest) {
      this.saveNewTabUrl(crxInfo.id, manifest, extension);
    }
    this.rememberLoadedExtension(extension);
    if (pinOnInstall) {
      this.pinExtensionOnInstall(extension.id);
    }
    this.startBackgroundWorker(extension);
    this.notifyRuntimeInstalled(extension, this.buildInstalledDetails(previousVersion));
    await this.saveRuntimeInstalledState(extension.id, manifest?.version);
    return extension;
  }

  private broadcastInstalledExtension(extension: Electron.Extension) {
    this.broadcastNormal('load-browserAction', extension);
  }

  private notifyRuntimeInstalled(
    extension: Electron.Extension,
    details: chrome.runtime.InstalledDetails,
  ) {
    try {
      this.chromeExtensions?.notifyRuntimeInstalled(extension.id, details);
    } catch (e) {
      console.error('notifyRuntimeInstalled failed', extension?.id, e);
    }
  }

  private createGeneratedManifestKey() {
    const {publicKey} = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'der',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });
    return publicKey.toString('base64');
  }

  private async findManifestRoot(root: string): Promise<string | null> {
    const queue = [root];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;

      const manifestPath = resolve(current, 'manifest.json');
      if (await pathExists(manifestPath)) {
        return current;
      }

      let entries: any[] = [];
      try {
        entries = await promises.readdir(current, {withFileTypes: true});
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === '__MACOSX' || entry.name === '.git') continue;
        queue.push(resolve(current, entry.name));
      }
    }

    return null;
  }

  private async findEmbeddedCrxFile(root: string): Promise<string | null> {
    const queue = [root];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;

      let entries: any[] = [];
      try {
        entries = await promises.readdir(current, {withFileTypes: true});
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = resolve(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__MACOSX' || entry.name === '.git') continue;
          queue.push(fullPath);
          continue;
        }
        if (entry.isFile() && extname(entry.name).toLowerCase() === '.crx') {
          return fullPath;
        }
      }
    }

    return null;
  }

  private async readStoredManifestKeyBySeed(seed: string): Promise<string | null> {
    if (!seed) return null;
    const extensionsPath = getPath('extensions');
    let dirs: string[] = [];
    try {
      dirs = await promises.readdir(extensionsPath);
    } catch {
      return null;
    }

    for (const dir of dirs) {
      const markerPath = resolve(extensionsPath, dir, GENERATED_KEY_SOURCE_FILE);
      if (!(await pathExists(markerPath))) continue;
      try {
        const payload = JSON.parse(await promises.readFile(markerPath, 'utf8'));
        if (payload?.seed !== seed) continue;
        const manifest = await this.readManifestForDir(dir);
        if (manifest?.key) return manifest.key;
      } catch {
        // best-effort
      }
    }

    return null;
  }

  private async installExtensionFromPackageFile(
    filePath: string,
    force: Boolean = false,
    pinOnInstall = false,
  ): Promise<Electron.Extension | null> {
    const ext = extname(filePath).toLowerCase();
    if (ext === '.crx') {
      const crxBuf = await promises.readFile(filePath);
      return this.installExtensionFromCrxInfo(parseCrx(crxBuf), force, pinOnInstall);
    }
    if (ext === '.zip') {
      const zipBuf = await promises.readFile(filePath);
      const zipSeed = createHash('sha256').update(zipBuf).digest('hex');
      return this.installExtensionFromZipBuffer(
        zipBuf,
        force,
        pinOnInstall,
        zipSeed,
      );
    }
    throw new Error(`Unsupported extension package: ${filePath}`);
  }

  private async installExtensionFromZipBuffer(
    zipBuf: Buffer,
    force: Boolean = false,
    pinOnInstall = false,
    sourceSeed?: string,
  ): Promise<Electron.Extension | null> {
    const tempRoot = resolve(
      app.getPath('temp'),
      `rainsee-extension-install-${makeId(10)}`,
    );

    await promises.mkdir(tempRoot, {recursive: true});

    try {
      await extractZip(zipBuf, tempRoot);

      const manifestRoot = await this.findManifestRoot(tempRoot);
      if (manifestRoot) {
        const extension = await this.installExtensionFromDirectorySource(
          manifestRoot,
          force,
          pinOnInstall,
          sourceSeed,
        );
        return extension;
      }

      const embeddedCrx = await this.findEmbeddedCrxFile(tempRoot);
      if (embeddedCrx) {
        const extension = await this.installExtensionFromPackageFile(
          embeddedCrx,
          force,
          pinOnInstall,
        );
        return extension;
      }

      throw new Error('ZIP 中未找到扩展目录或内嵌 crx 文件');
    } finally {
      try {
        await rf(tempRoot);
      } catch (e) {
        console.warn('cleanup temp extension zip failed', e);
      }
    }
  }

  private async installExtensionFromDirectorySource(
    dir: string,
    force: Boolean = false,
    pinOnInstall = false,
    sourceSeed?: string,
  ): Promise<Electron.Extension | null> {
    const manifestPath = resolve(dir, 'manifest.json');
    const manifest = JSON.parse(await promises.readFile(manifestPath, 'utf8'));
    const hadManifestKey = !!manifest?.key;
    const manifestKey =
      manifest?.key ||
      (sourceSeed && (await this.readStoredManifestKeyBySeed(sourceSeed))) ||
      this.createGeneratedManifestKey();
    const extensionId = getCrxIdByKey(manifestKey);
    const extensionsPath = getPath('extensions');
    const installPath = resolve(extensionsPath, extensionId);
    let previousVersion: string | undefined;

    if (await pathExists(installPath)) {
      if (force) {
        try {
          const previousManifest = JSON.parse(
            await promises.readFile(resolve(installPath, 'manifest.json'), 'utf8'),
          );
          previousVersion = previousManifest?.version;
        } catch {}
        await rf(installPath);
      } else {
        console.log('Extension is already installed');
        return null;
      }
    }

    await require('fs-extra').copy(dir, installPath);

    if (!manifest.key) {
      manifest.key = manifestKey;
      await promises.writeFile(
        resolve(installPath, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
      );
    }
    if (!hadManifestKey && sourceSeed) {
      await promises.writeFile(
        resolve(installPath, GENERATED_KEY_SOURCE_FILE),
        JSON.stringify({seed: sourceSeed}, null, 2),
      );
    }

    await patchExtensionStorage(installPath);
    const extension = await this.view.loadExtension(installPath, {
      allowFileAccess: true,
    });
    console.log(extension);
    this.saveNewTabUrl(extension.id, manifest, extension);
    this.rememberLoadedExtension(extension);
    if (pinOnInstall) {
      this.pinExtensionOnInstall(extension.id);
    }
    this.startBackgroundWorker(extension);
    this.notifyRuntimeInstalled(extension, this.buildInstalledDetails(previousVersion));
    await this.saveRuntimeInstalledState(extension.id, manifest?.version);
    return extension;
  }

  public onCreateTab = async (details: chrome.tabs.CreateProperties) => {
    const view = Application.instance.windows.list
      .find((x) => x.win.id === details.windowId)
      .viewManager.create(details, false, true);

    return view.id;
  };

  public onBrowserActionUpdate = (
    extensionId: string,
    action: BrowserActionChangeType,
    details: any,
  ) => {
    Application.instance.windows.list.filter((w) => !w.incognito).forEach((w) => {
      w.send('set-browserAction-info', extensionId, action, details);
    });
  };

  private broadcastNormal(channel: string, ...args: any[]) {
    Application.instance.windows.list
      .filter((window) => !window.incognito)
      .forEach((window) => window.send(channel, ...args));
  }

  private onIncognitoBrowserActionUpdate = (
    extensionId: string,
    action: BrowserActionChangeType,
    details: any,
  ) => {
    Application.instance.windows.list
      .filter((window) => window.incognito)
      .forEach((window) => {
        window.send('set-browserAction-info', extensionId, action, details);
      });
  };

  // Resolve a chrome.action.setIcon details object to a data URL the React
  // toolbar can render. MV3 service workers can't pass ImageData over IPC (the
  // preload drops it), so extensions like Tampermonkey use { path }. The path
  // may be a single string or a size->path map; we pick the largest entry and
  // read it relative to the extension's install dir.
  private resolveActionIcon = async (
    extensionId: string,
    iconDetails: any,
  ): Promise<string | null> => {
    try {
      if (!iconDetails) return null;

      // MV2 path: the preload already converted ImageData to a base64 data URL
      // (imageData2base64). It may arrive as a single string or a size->dataURL
      // map. Use it directly.
      const img = iconDetails.imageData;
      if (typeof img === 'string' && img.startsWith('data:')) {
        return img;
      }
      if (img && typeof img === 'object') {
        const vals = Object.values(img as Record<string, string>).filter(
          (v) => typeof v === 'string' && v.startsWith('data:'),
        );
        if (vals.length) return vals[vals.length - 1];
      }

      let path: string | undefined = iconDetails.path;
      if (path && typeof path === 'object') {
        const entries = Object.entries(path as Record<string, string>);
        if (entries.length === 0) return null;
        // Pick the largest declared size.
        entries.sort((a, b) => parseInt(b[0], 10) - parseInt(a[0], 10));
        path = entries[0][1];
      }
      if (!path || typeof path !== 'string') {
        tlog(
          `resolveActionIcon: no usable path/imageData for ${extensionId}: ${JSON.stringify(
            iconDetails,
          )}`,
        );
        return null;
      }

      // MV3 service workers resolve icon paths against their own base URL before
      // calling setIcon, so `path` often arrives as a full
      // chrome-extension://<id>/images/icon.png URL. Reduce it to a path
      // relative to the extension dir.
      if (/^chrome-extension:\/\//i.test(path)) {
        try {
          path = decodeURIComponent(new url.URL(path).pathname).replace(
            /^\/+/,
            '',
          );
        } catch (e) {
          /* fall through with original */
        }
      }

      const extension = this.view.getExtension(extensionId);
      if (!extension) return null;

      const filePath = resolve(extension.path, path);
      const data = await promises.readFile(filePath);
      const ext = extname(filePath).slice(1).toLowerCase();
      const mime =
        ext === 'svg'
          ? 'image/svg+xml'
          : ext === 'jpg' || ext === 'jpeg'
            ? 'image/jpeg'
            : `image/${ext || 'png'}`;
      return `data:${mime};base64,${data.toString('base64')}`;
    } catch (e) {
      tlog('resolveActionIcon error', e);
      return null;
    }
  };
}
