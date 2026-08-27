import { app, ipcMain, nativeTheme, dialog } from 'electron';

import {
  DEFAULT_SETTINGS,
  DEFAULT_SEARCH_ENGINES,
  MAX_M3U8_DOWNLOAD_THREADS,
  MAX_CUSTOM_CHROME_CSS_LENGTH,
  MIN_M3U8_DOWNLOAD_THREADS,
  normalizeTabHoverActivationBehavior,
  normalizeTabHoverActivationDelay,
} from '~/constants';

import { promises } from 'fs';
import { readFileSync } from 'fs';

import { getPath, makeId } from '~/utils';
import { EventEmitter } from 'events';
import {
  runAdblockService,
  stopAdblockService,
  applyDnrRequestHeaders,
  applyDnrResponseHeaders,
  dispatchWebReqToExtensions,
  stripThirdPartySetCookies,
} from '../services/adblock';
import { Application } from '../application';
import { WEBUI_BASE_URL } from '~/constants/files';
import {
  EfficiencySearchMode,
  ISearchEngine,
  ISettings,
  TabCloseSelectionBehavior,
  TabHoverActivationBehavior,
  TabOverflowBehavior,
  TabWheelBehavior,
} from '~/interfaces';
import { dirname, resolve } from 'path';
import { deletePath, pathExists, readFileAsText } from '~/utils/files';
import {
  ChromeUserAgent,
  DefaultUserAgent,
  isGoogleURL,
} from '~/main/user-agent';
import IpcMainEvent = Electron.IpcMainEvent;
import {
  filterVideo,
  recordUrlRequest,
  stripEdgeCspHeaders,
} from '~/main/services/supervideo-video';
import { tlog } from '~/main/timing';
import {
  discoverDownloaderPath,
  DOWNLOADER_PRESETS,
} from '../services/external-downloader';
import { migrationGate } from '../data-location';
import { isHeavyUI } from '../utils/hardware-profile';
import { getViewBackgroundColor } from '../utils/theme';
import { normalizeChromeTheme } from '~/common/chrome-theme';
import { normalizeBookmarkBarDisplay } from '~/common/bookmark-bar';
import { sanitizeChromePanelValues } from '~/common/chrome-style-panel';
import {
  activeProfileName,
  readDataLocationPointer,
  SYSTEM_USERDATA,
} from '../bootstrap-paths';

const isSamePath = (left: string, right: string): boolean => {
  const normalize = (value: string) => {
    const resolved = resolve(value).replace(/\\/g, '/');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
};

const getSettingsMirrorPath = (): string | null => {
  if (activeProfileName) return null;
  const current = app.getPath('userData');
  const pointer = readDataLocationPointer();
  if (
    typeof pointer.current !== 'string' ||
    !isSamePath(pointer.current, current) ||
    isSamePath(current, SYSTEM_USERDATA)
  ) {
    return null;
  }
  return resolve(SYSTEM_USERDATA, 'settings.json');
};

const getSystemDownloadsPath = (): string => {
  try {
    return app.getPath('downloads');
  } catch {
    return '';
  }
};

const normalizeCustomChromeCss = (value: unknown): string => {
  if (typeof value !== 'string') return DEFAULT_SETTINGS.customChromeCss;
  return value.slice(0, MAX_CUSTOM_CHROME_CSS_LENGTH);
};

// 壳层可视化调控面板:只保留 schema 内合法键(键/类型/范围全在共享模块校验)。
const normalizeChromeStylePanel = (
  value: unknown,
): ISettings['chromeStylePanel'] => sanitizeChromePanelValues(value);

const getTabHoverActivationBehavior = (
  value: unknown,
  legacyValue?: unknown,
): TabHoverActivationBehavior => {
  if (
    value === 'off' ||
    value === 'activate' ||
    value === 'activate-and-switch'
  ) {
    return value;
  }
  // 旧开关开启时只在后台恢复，迁移后保持这个既有行为。
  if (typeof legacyValue === 'boolean') {
    return legacyValue ? 'activate' : 'off';
  }
  return normalizeTabHoverActivationBehavior(value);
};

const normalizeM3u8DownloadThreads = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.m3u8DownloadThreads;
  }
  return Math.max(
    MIN_M3U8_DOWNLOAD_THREADS,
    Math.min(MAX_M3U8_DOWNLOAD_THREADS, Math.round(value)),
  );
};

const EFFICIENCY_SEARCH_MODES = new Set<EfficiencySearchMode>([
  'normal',
  'dual',
  'multi-tab',
]);

const normalizeEfficiencySearchMode = (value: unknown): EfficiencySearchMode =>
  EFFICIENCY_SEARCH_MODES.has(value as EfficiencySearchMode)
    ? (value as EfficiencySearchMode)
    : DEFAULT_SETTINGS.efficiencySearchMode;

const normalizeTabOverflowBehavior = (value: unknown): TabOverflowBehavior =>
  value === 'shrink' || value === 'scroll'
    ? value
    : DEFAULT_SETTINGS.tabOverflowBehavior;

const normalizeTabWheelBehavior = (value: unknown): TabWheelBehavior =>
  value === 'auto' || value === 'always-switch'
    ? value
    : DEFAULT_SETTINGS.tabWheelBehavior;

const normalizeTabCloseSelectionBehavior = (
  value: unknown,
): TabCloseSelectionBehavior =>
  value === 'left' || value === 'right' || value === 'recent'
    ? value
    : DEFAULT_SETTINGS.tabCloseSelectionBehavior;

const normalizeMultiSearchEngineKeywords = (
  value: unknown,
  engines: ISearchEngine[],
): string[] => {
  const validKeywords = new Set(
    (engines || []).map((engine) => engine?.keyword).filter(Boolean),
  );
  const selected = Array.isArray(value)
    ? Array.from(
        new Set(
          value.filter(
            (keyword): keyword is string =>
              typeof keyword === 'string' && validKeywords.has(keyword),
          ),
        ),
      )
    : [];
  if (selected.length >= 2) return selected;

  const defaults = DEFAULT_SETTINGS.efficiencySearchEngineKeywords.filter(
    (keyword) => validKeywords.has(keyword),
  );
  return defaults.length >= 2
    ? defaults
    : Array.from(validKeywords).slice(0, 2);
};

const TRANSLATE_ENGINES = new Set(['microsoft', 'custom-llm']);

const normalizeTranslateEngine = (
  value: unknown,
): 'microsoft' | 'custom-llm' =>
  TRANSLATE_ENGINES.has(value as string)
    ? (value as 'microsoft' | 'custom-llm')
    : DEFAULT_SETTINGS.translateEngine;

// 自定义 LLM 配置守卫:对象形状校验 + baseUrl trim/补尾斜杠规整为不带尾斜杠 +
// /v\d 后缀(custom-llm.ts normalizeBaseUrl 复算,这里只做基本卫生)。apiType 白名单。
const normalizeCustomLlmConfig = (
  value: unknown,
): ISettings['customLlmConfig'] => {
  const base = DEFAULT_SETTINGS.customLlmConfig;
  if (!value || typeof value !== 'object') return { ...base };
  const v = value as Record<string, unknown>;
  const apiType = v.apiType === 'responses' ? 'responses' : 'chat';
  const baseUrl =
    typeof v.baseUrl === 'string' && v.baseUrl.trim()
      ? v.baseUrl.trim().replace(/\/+$/, '')
      : base.baseUrl.replace(/\/+$/, '');
  return {
    baseUrl,
    apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
    model:
      typeof v.model === 'string' && v.model.trim()
        ? v.model.trim()
        : base.model,
    apiType,
    systemPrompt: typeof v.systemPrompt === 'string' ? v.systemPrompt : '',
  };
};

const normalizePersistSessionCookieHosts = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const hosts = new Set<string>();
  value.forEach((item) => {
    if (typeof item !== 'string') return;
    let host = item.trim().toLowerCase();
    if (!host) return;
    try {
      host = new URL(host.includes('://') ? host : `https://${host}`).hostname;
    } catch {
      return;
    }
    host = host.replace(/^\.+|\.+$/g, '');
    if (
      host.length <= 253 &&
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) &&
      host.includes('.')
    ) {
      hosts.add(host);
    }
  });
  return Array.from(hosts).slice(0, 100);
};

const normalizeBrowsingDataSettings = (
  value: unknown,
  fallback: ISettings['clearBrowsingData'],
): ISettings['clearBrowsingData'] => {
  const items =
    value && typeof value === 'object'
      ? (value as Partial<ISettings['clearBrowsingData']>)
      : {};
  return {
    cache: typeof items.cache === 'boolean' ? items.cache : fallback.cache,
    cookies:
      typeof items.cookies === 'boolean' ? items.cookies : fallback.cookies,
    history:
      typeof items.history === 'boolean' ? items.history : fallback.history,
    searchHistory:
      typeof items.searchHistory === 'boolean'
        ? items.searchHistory
        : fallback.searchHistory,
  };
};

const normalizeClearOnExitSettings = (
  value: unknown,
  fallback: ISettings['clearOnExit'],
): ISettings['clearOnExit'] => {
  const items =
    value && typeof value === 'object'
      ? (value as Partial<ISettings['clearOnExit']>)
      : {};
  return {
    cache: typeof items.cache === 'boolean' ? items.cache : fallback.cache,
    cookies:
      typeof items.cookies === 'boolean' ? items.cookies : fallback.cookies,
    history:
      typeof items.history === 'boolean' ? items.history : fallback.history,
    searchHistory:
      typeof items.searchHistory === 'boolean'
        ? items.searchHistory
        : fallback.searchHistory,
  };
};

export class Settings extends EventEmitter {
  // webRequest 每个事件在 Electron 中只有一个监听槽位。配置未影响拦截器时
  // 不重复重挂，避免云同步连续更新期间反复重建监听和广告引擎。
  private networkInterceptorSignature: string | null = null;

  private startupHeavyWorkAllowed = false;
  // DEFAULT_SETTINGS is shared with sandboxed renderer bundles, where Electron is
  // unavailable and downloadsPath is intentionally empty. The main process owns
  // the effective path and can reliably resolve the operating-system default.
  public object: ISettings = {
    ...DEFAULT_SETTINGS,
    downloadsPath: getSystemDownloadsPath(),
  };

  private queue: string[] = [];

  private loaded = false;

  // 网页暗色模式联动基线(仅本次运行中真翻转才联动,普通设置保存/扩展手动启停/
  // 重启都不做全局校准,保留用户对扩展的独立控制权):
  // - lastDarknightEnabledState:darknight(Dark Reader)是否应运行
  //   (webDarkMode==='extension' && 暗色生效主题)。
  // - lastWebDarkMode / lastDarkThemeState:用于判定切换实现方式 / 主题翻转后是否需要
  //   刷新当前页,让新机制(拓展/脚本/无)立即生效。
  private lastDarknightEnabledState: boolean | null = null;
  private lastWebDarkMode: 'extension' | 'browser' | 'off' | null = null;
  private lastDarkThemeState: boolean | null = null;

  public crxListenerMap = new Map<string, any[]>();

  public constructor() {
    super();

    // Koodo Reader is served from our trusted yjllq:// origin and the view
    // preload deliberately exposes a small Electron bridge so external books
    // can be read through fs/path. Once Koodo detects that bridge it uses its
    // desktop code path, whose synchronous IPC calls must always receive a
    // synchronous reply. Without these listeners sendSync blocks the renderer
    // indefinitely (the page previously stopped at "system-color" and stayed
    // blank before React could mount).
    ipcMain.on('system-color', (e) => {
      e.returnValue = nativeTheme.shouldUseDarkColors;
    });
    ipcMain.on('storage-location', (e) => {
      e.returnValue = app.getPath('userData');
    });
    ipcMain.on('url-window-status', (e) => {
      // Rainsee embeds the reader in a normal tab rather than Koodo's separate
      // URL helper window, so its URL-window-only presentation is never active.
      e.returnValue = false;
    });

    ipcMain.on(
      'save-settings',
      (e, { settings }: { settings: string; incognito: boolean }) => {
        const nextSettings = JSON.parse(settings) as Partial<ISettings>;

        // downloadsPath is changed only through downloads-path-change below.
        // Renderer stores submit a full snapshot and may briefly hold startup
        // defaults, so accepting this field here can overwrite a path the user
        // has just selected with an older value.
        delete nextSettings.downloadsPath;
        // Theme snapshots are rebuilt from installed manifests in the main process.
        delete nextSettings.activeChromeTheme;
        // These settings are updated through the restricted patch IPC below.
        // A stale renderer's full startup snapshot must never reset browser-data
        // preferences that were already loaded from the user's data directory.
        delete nextSettings.clearBrowsingData;
        delete nextSettings.clearOnExit;
        delete nextSettings.persistSessionCookies;
        delete nextSettings.persistSessionCookieHosts;
        this.updateSettings(nextSettings);
      },
    );

    // 可视化调控面板的即时预览:设置页拖动滑条时高频推送面板值,主窗口外壳
    // 直接换 <style> 内容实时看效果,不等 save-settings 的持久化往返。
    // 只广播不落盘 —— 落盘仍走 save-settings(松手后防抖触发)。
    ipcMain.on(
      'chrome-style-preview',
      (_e, values: unknown) => {
        const payload = sanitizeChromePanelValues(values);
        Application.instance.dialogs?.sendToAll(
          'chrome-style-preview',
          payload,
        );
        for (const window of Application.instance.windows?.list || []) {
          window.send('chrome-style-preview', payload);
        }
      },
    );

    ipcMain.on('save-web-browsing-settings', (_e, raw: unknown) => {
      if (!raw || typeof raw !== 'object') return;

      const patch = raw as Partial<ISettings>;
      const next: Partial<ISettings> = {};
      if (typeof patch.persistSessionCookies === 'boolean') {
        next.persistSessionCookies = patch.persistSessionCookies;
      }
      if (
        Object.prototype.hasOwnProperty.call(patch, 'persistSessionCookieHosts')
      ) {
        next.persistSessionCookieHosts = normalizePersistSessionCookieHosts(
          patch.persistSessionCookieHosts,
        );
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'clearBrowsingData')) {
        next.clearBrowsingData = normalizeBrowsingDataSettings(
          patch.clearBrowsingData,
          this.object.clearBrowsingData,
        );
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'clearOnExit')) {
        next.clearOnExit = normalizeClearOnExitSettings(
          patch.clearOnExit,
          this.object.clearOnExit,
        );
      }
      if (Object.keys(next).length > 0) {
        this.updateSettings(next);
        Application.instance.sessions
          ?.reconcilePersistedSessionCookies()
          .catch((error) =>
            console.error('[cookies] reconcile settings failed', error),
          );
      }
    });

    // sendSync 必须同步返回:ipcRenderer.sendSync 不会等待 async handler 的微任务,
    // 若此处 await,this.object 在 await 之后的微任务里才赋给 returnValue,而 sendSync
    // 早已同步返回 undefined → 设置页/dialog 初始化时 window.settings 为空,
    // downloadsPath 等字段显示为默认/空(重启后"恢复默认"现象)。
    // 直接同步返回 this.object:已加载则返回真实值;若 load() 尚未完成则返回
    // DEFAULT_SETTINGS,随后 load() 完成时的 update() 广播会补救已存在的窗口。
    ipcMain.on('get-settings-sync', (e) => {
      e.returnValue = this.object;
    });

    ipcMain.on('get-settings', async (e) => {
      await this.onLoad();
      this.update();
      e.sender.send('update-settings', this.object);
    });

    ipcMain.on('downloads-path-change', async () => {
      // Do not let a late settings.json read replace a directory selected while
      // the application is still starting.
      await this.onLoad();

      const { canceled, filePaths } = await dialog.showOpenDialog({
        defaultPath: this.object.downloadsPath || getSystemDownloadsPath(),
        properties: ['openDirectory'],
      });

      if (canceled || !filePaths[0]) return;

      this.updateSettings({ downloadsPath: filePaths[0] });
    });

    // 外部下载器:选择可执行文件路径(用户手动指定)。
    ipcMain.on('downloader-path-change', async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: '选择下载器可执行文件',
        defaultPath: this.object.downloaderPath || undefined,
        properties: ['openFile'],
      });

      if (canceled) return;

      this.updateSettings({ downloaderPath: filePaths[0] });
    });

    // 外部下载器:按预置类型从注册表自动发现路径(IDM 等有注册表项的)。
    // 迅雷走 thunder:// 协议无需路径;aria2/custom 无注册表项;找不到则弹提示。
    ipcMain.on('downloader-path-autodetect', async () => {
      const type = this.object.downloaderType;
      const path = await discoverDownloaderPath(type);
      if (path) {
        this.updateSettings({ downloaderPath: path });
      } else {
        const name = DOWNLOADER_PRESETS[type]?.name ?? '外部下载器';
        dialog.showMessageBox({
          type: 'warning',
          title: '温馨提示',
          message: `未检测到${name}的安装路径,请手动选择可执行文件。`,
          buttons: ['确定'],
        });
      }
    });

    nativeTheme.on('updated', () => {
      this.update();
    });
    ipcMain.handle(
      'hiker-crx-msg',
      async (event, extensionId, fnName, ...args) => {
        try {
          const extensions = Application.instance.sessions.extensions;
          const ext = (extensions || []).find((it) => it.id == extensionId);
          if (ext && ext.manifest && ext.manifest.commands) {
            const commands = [];
            for (let key of Object.keys(ext.manifest.commands)) {
              commands.push({
                name: key,
                description: ext.manifest.commands[key].description,
                shortcut: (ext.manifest.commands[key].suggested_key || {})
                  .default,
              });
            }
            return commands;
          }
          const extensionsPath = getPath('extensions');
          const path = resolve(extensionsPath, extensionId);
          const manifestPath = resolve(path, 'manifest.json');
          const manifest = JSON.parse(
            await promises.readFile(manifestPath, 'utf8'),
          );
          if (manifest && manifest.commands) {
            const commands = [];
            for (let key of Object.keys(manifest.commands)) {
              commands.push({
                name: key,
                description: manifest.commands[key].description,
                shortcut: (manifest.commands[key].suggested_key || {}).default,
              });
            }
            return commands;
          }
        } catch (e) {
          console.log(e);
        }
        return [];
      },
    );

    // ipcMain.on('xiu-crx-add-listener', async (event: IpcMainEvent, extensionId, name, ...opts) => {
    //   if (this.crxListenerMap.has(name)) {
    //     this.crxListenerMap.get(name).push([extensionId, ...opts]);
    //   } else {
    //     this.crxListenerMap.set(name, [extensionId, ...opts]);
    //   }
    //   const contexts = [
    //     Application.instance.sessions.view,
    //     Application.instance.sessions.viewIncognito,
    //   ];
    //   contexts.forEach((e) => {
    //     if (name == "xiu.onBeforeRequest") {
    //       e.webRequest.onBeforeSendHeaders(opts[0], (details: Electron.OnBeforeSendHeadersListenerDetails, callback: any) => {
    //         callback({});
    //         if (this.crxListenerMap.has(name)) {
    //           let arr = this.crxListenerMap.get(name);
    //           arr = arr.filter(it => it[0] == extensionId);
    //           if(arr.length == 0) {
    //             return
    //           }
    //         }
    //         event.sender.send("crx-" + name, details);
    //       });
    //     } else if (name == "xiu.onBeforeRedirect") {
    //       e.webRequest.onBeforeRedirect(opts[0], (details: Electron.OnBeforeRedirectListenerDetails) => {
    //         if (this.crxListenerMap.has(name)) {
    //           let arr = this.crxListenerMap.get(name);
    //           arr = arr.filter(it => it[0] == extensionId);
    //           if(arr.length == 0) {
    //             return
    //           }
    //         }
    //         event.sender.send("crx-" + name, details);
    //       });
    //     } else if (name == "xiu.onBeforeSendHeaders") {
    //       e.webRequest.onBeforeSendHeaders(opts[0], (details: Electron.OnBeforeSendHeadersListenerDetails, callback: any) => {
    //         callback({});
    //         if (this.crxListenerMap.has(name)) {
    //           let arr = this.crxListenerMap.get(name);
    //           arr = arr.filter(it => it[0] == extensionId);
    //           if(arr.length == 0) {
    //             return
    //           }
    //         }
    //         event.sender.send("crx-" + name, details);
    //       });
    //     } else if (name == "xiu.onResponseStarted") {
    //       e.webRequest.onResponseStarted(opts[0], (details: Electron.OnResponseStartedListenerDetails) => {
    //         if (this.crxListenerMap.has(name)) {
    //           let arr = this.crxListenerMap.get(name);
    //           arr = arr.filter(it => it[0] == extensionId);
    //           if(arr.length == 0) {
    //             return
    //           }
    //         }
    //         event.sender.send("crx-" + name, details);
    //       });
    //     }
    //   });
    // });
    //
    // ipcMain.on('xiu-crx-remove-listener', async (e, extensionId, name, ...opts) => {
    //   if (this.crxListenerMap.has(name)) {
    //     let arr = this.crxListenerMap.get(name);
    //     arr = arr.filter(it => it[0] != extensionId);
    //     this.crxListenerMap.set(name, arr);
    //   }
    // });

    this.load();
  }

  private onLoad = async (): Promise<void> => {
    return new Promise((resolve) => {
      if (!this.loaded) {
        this.once('load', () => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  };

  /** 等待 settings 加载完成(已加载则立即 resolve)。供外部在依赖磁盘值时调用。 */
  public ready = () => this.onLoad();

  public update = () => {
    let themeSource = 'system';

    if (this.object.themeAuto) {
      this.object.theme = nativeTheme.shouldUseDarkColors
        ? 'wexond-dark'
        : 'wexond-light';
    } else {
      themeSource = this.object.theme === 'wexond-dark' ? 'dark' : 'light';
    }

    const isDarkTheme = this.object.theme === 'wexond-dark';
    // 网页暗色模式实现:'extension'(Dark Reader) | 'browser'(浏览器预注入脚本) | 'off'(不变色)。
    // 未知/缺失值归一化为 'browser'(默认),兼容旧 settings.json 无此字段的存量用户。
    const rawWebDarkMode = (this.object as any).webDarkMode;
    const webDarkMode: 'extension' | 'browser' | 'off' =
      rawWebDarkMode === 'extension' || rawWebDarkMode === 'off'
        ? rawWebDarkMode
        : 'browser';
    // darknight 仅在 extension 模式且暗色生效主题下运行。
    const darknightDesired = webDarkMode === 'extension' && isDarkTheme;
    let darknightChanged = false;
    let webDarkModeChanged = false;
    let themeChanged = false;
    // nativeTheme 可能在 settings.json 尚未加载时先发出 updated。此时不能用
    // DEFAULT_SETTINGS 建立基线，否则磁盘设置加载会被误判成一次用户切换。
    if (this.loaded) {
      darknightChanged =
        this.lastDarknightEnabledState !== null &&
        this.lastDarknightEnabledState !== darknightDesired;
      webDarkModeChanged =
        this.lastWebDarkMode !== null && this.lastWebDarkMode !== webDarkMode;
      themeChanged =
        this.lastDarkThemeState !== null &&
        this.lastDarkThemeState !== isDarkTheme;
      this.lastDarknightEnabledState = darknightDesired;
      this.lastWebDarkMode = webDarkMode;
      this.lastDarkThemeState = isDarkTheme;
    }

    if (themeSource !== nativeTheme.themeSource) {
      nativeTheme.themeSource = themeSource as any;
    }

    Application.instance.dialogs?.sendToAll('update-settings', this.object);

    for (const window of Application.instance.windows?.list || []) {
      window.updateTrafficLightPosition(this.object.tabsLayout);
      window.send('update-settings', this.object);

      window.viewManager.views.forEach(async (v) => {
        if (!v.browserView || v.browserView.webContents.isDestroyed()) return;
        // 主题切换时同步内容 view 的底色,避免切到暗色后已开的标签仍白闪。
        v.browserView.setBackgroundColor(getViewBackgroundColor());
        if (v.webContents.getURL().startsWith(WEBUI_BASE_URL)) {
          v.webContents.send('update-settings', this.object);
        }
      });

      // 离开双列模式时立即收起已打开的副引擎侧边栏。
      if (this.object.efficiencySearchMode !== 'dual') {
        window.secondarySearchPanels?.hideCurrent();
      }
    }

    // sessions 在 onReady 中才创建,而 Settings 在更早的构造阶段就会
    // load()→addToQueue()→update()。此时 sessions 仍是 undefined,若直接访问
    // sessions.view 会抛异常,导致 save() 不被调用、队列头永久卡死,从此所有
    // 设置都无法持久化。这里在 sessions 未就绪时跳过其网络拦截装配——它会在
    // sessions 创建后的下一次设置变更(update())中重新执行。
    const sessions = Application.instance.sessions;
    if (!sessions) return;

    // 网页暗色模式联动:darknight 仅在其期望运行状态真翻转时同步(避免覆盖用户在
    // 扩展管理页的手动启停);reload 仅在「实现方式改变(暗色下)」或「主题翻转(非 off)」
    // 时刷新当前页,让新机制(拓展/脚本/无)立即生效。两种触发相互独立,可同时发生。
    if (darknightChanged) {
      sessions.syncDarknightForTheme(darknightDesired).catch(() => {});
    }
    const needReload =
      (webDarkModeChanged && isDarkTheme) ||
      (themeChanged && webDarkMode !== 'off');
    if (needReload) {
      sessions.reloadCurrentPage();
    }

    const contexts = [sessions.view, sessions.viewIncognito];
    const incognitoBlockThirdPartyCookies =
      this.object.incognitoBlockThirdPartyCookies !== false;
    const networkInterceptorSignature = JSON.stringify({
      shield: !!this.object.shield,
      incognitoBlockThirdPartyCookies,
    });
    if (this.networkInterceptorSignature === networkInterceptorSignature)
      return;
    this.networkInterceptorSignature = networkInterceptorSignature;
    contexts.forEach((e) => {
      e.webRequest.onBeforeSendHeaders(
        { urls: ['<all_urls>'] },
        (
          details: Electron.OnBeforeSendHeadersListenerDetails,
          callback: any,
        ) => {
          if (details.url.startsWith('chrome-extension://')) {
            tlog(
              `webRequest.onBeforeSendHeaders chrome-extension: ${details.resourceType} ${details.url}`,
            );
          }
          const obj: { requestHeaders?: Record<string, string> } = {};
          try {
            const { object: settings } = Application.instance.settings;
            if (settings.doNotTrack) {
              details.requestHeaders['DNT'] = '1';
              obj.requestHeaders = details.requestHeaders;
            }
            const ua = details.requestHeaders['User-Agent'];
            if (isGoogleURL(details.url)) {
              // Google 登录会校验请求 UA；这里必须保留 Electron 的默认 UA，不能
              // 跟随普通网页的 Chrome UA 伪装。
              details.requestHeaders['User-Agent'] = DefaultUserAgent;
              obj.requestHeaders = details.requestHeaders;
            } else if (ua && ua.includes('Electron')) {
              details.requestHeaders['User-Agent'] = ChromeUserAgent;
              obj.requestHeaders = details.requestHeaders;
            }
            recordUrlRequest(details);
            // Electron permits one onBeforeSendHeaders listener per session.
            // This host listener therefore owns the slot when settings are
            // active; mirror the event to Chrome extensions after host header
            // adjustments so webRequest observers keep receiving it.
            dispatchWebReqToExtensions('onBeforeSendHeaders', details, e);
            // This listener owns Electron's single onBeforeSendHeaders slot.
            // Enforce extension DNR modifyHeaders here as well; otherwise the
            // vendor listener is replaced and per-tab Referer/Cookie rules are
            // stored but never applied.
            const dnrHeaders = applyDnrRequestHeaders(details, e);
            if (dnrHeaders) obj.requestHeaders = dnrHeaders;
          } catch (err) {
            console.log(err);
          }
          // callback MUST always run, even if the logic above throws — otherwise
          // the request hangs until Chromium's ~30s webRequest timeout.
          callback(obj);
        },
      );

      console.log('onHeadersReceived register');
      e.webRequest.onHeadersReceived(
        { urls: ['<all_urls>'] },
        (details, callback) => {
          //   console.log("onHeadersReceived callback", details.url);
          if (details.url.startsWith('chrome-extension://')) {
            tlog(
              `webRequest.onHeadersReceived chrome-extension: ${details.statusCode} ${details.url}`,
            );
          }
          // 本监听器在屏蔽关闭/引擎未初始化时是 session 上唯一的 onHeadersReceived
          // (Electron 单监听器,后注册者覆盖)。settings 的 onHeadersReceived 还需把事件
          // 转发给扩展(IDM 等依赖它检测视频媒体);屏蔽开启时则由 adblock.ts hookEngine
          // 的包装器转发; onResponseStarted 由 vendor 的原生监听器负责。
          try {
            dispatchWebReqToExtensions('onHeadersReceived', details, e);
          } catch (err) {
            console.log('[settings] dispatchWebReqToExtensions error', err);
          }
          let dnrHeaders: Record<string, string[]> | undefined;
          try {
            dnrHeaders = applyDnrResponseHeaders(details, e);
          } catch (err) {
            console.log('[settings] DNR response-headers error', err);
          }
          const responseHeaders = stripEdgeCspHeaders(
            details.url,
            dnrHeaders || details.responseHeaders,
          );
          try {
            filterVideo(details);
          } catch (err) {
            console.log(err);
          }
          if (incognitoBlockThirdPartyCookies && e === sessions.viewIncognito) {
            stripThirdPartySetCookies(details, responseHeaders, e);
          }
          callback(responseHeaders ? { responseHeaders } : {});
        },
      );
      if (this.startupHeavyWorkAllowed) {
        if (this.object.shield) {
          runAdblockService(e);
        } else {
          stopAdblockService(e);
        }
      }
    });
  };

  // 主窗口 app.html 的启动外观参数(骨架屏主题/布局)。构造 BrowserWindow 时
  // 通过 URL query 注入,让 head 内联脚本零 IPC 立即着色,替代原先的
  // sendSync('get-settings-sync')(冷启动时主进程繁忙,同步应答会推迟 dom_ready)。
  // 直接同步读 settings.json:this.object 在首窗构造时可能尚未 load()(load 在
  // ready 后),用默认值会让暗色用户的骨架屏闪白;读盘一次数百微秒,且
  // getStartupBackgroundColor 已是同一模式。
  public getStartupLook(): Record<string, string | number | boolean> {
    let persisted: Partial<ISettings> = {};
    try {
      persisted = JSON.parse(readFileSync(getPath('settings.json'), 'utf8'));
    } catch (e) {
      // 首次启动无文件等场景,全部走默认值。
    }
    const o = {...this.object, ...persisted};
    const hasPersistedBookmarksBarDisplay = Object.prototype.hasOwnProperty.call(
      persisted,
      'bookmarksBarDisplay',
    );
    const hasPersistedLegacyBookmarksBar = Object.prototype.hasOwnProperty.call(
      persisted,
      'bookmarksBar',
    );
    const persistedBookmarksBarDisplay = hasPersistedBookmarksBarDisplay
      ? o.bookmarksBarDisplay
      : hasPersistedLegacyBookmarksBar
        ? persisted.bookmarksBar === false
          ? 'never'
          : 'always'
        : o.bookmarksBarDisplay;
    const look: Record<string, string | number | boolean> = {
      themeAuto: o.themeAuto !== false,
      theme: o.theme === 'wexond-dark' ? 'dark' : 'light',
      tabsLayout:
        o.tabsLayout === 'left' || o.tabsLayout === 'right'
          ? o.tabsLayout
          : 'top',
      sidebarPinned: o.sidebarPinned !== false,
      topBarVariant:
        o.topBarVariant === 'compact' || o.topBarVariant === 'default'
          ? o.topBarVariant
          : 'default',
      bookmarksBar:
        persistedBookmarksBarDisplay === 'always' ||
        (persistedBookmarksBarDisplay == null && o.bookmarksBar !== false),
    };
    if (typeof o.sidebarWidth === 'number' && Number.isFinite(o.sidebarWidth)) {
      look.sidebarWidth = Math.max(180, o.sidebarWidth);
    }
    return look;
  }

  public startDeferredNetworkServices() {
    if (this.startupHeavyWorkAllowed) return;
    this.startupHeavyWorkAllowed = true;
    const sessions = Application.instance.sessions;
    if (!sessions) return;
    for (const targetSession of [sessions.view, sessions.viewIncognito]) {
      if (this.object.shield) {
        void runAdblockService(targetSession);
      } else {
        void stopAdblockService(targetSession);
      }
    }
  }

  private async load() {
    // 等待数据迁移(若有)完成并切换好 userData,再读 settings.json。无 pending 时
    // gate 立即 resolve,不增加启动延迟。
    try {
      await migrationGate.promise;
    } catch {
      // gate 不会 reject(失败也 resolve),这里仅兜底。
    }

    try {
      const file = await promises.readFile(getPath('settings.json'), 'utf8');
      const json = JSON.parse(file);
      json.tabOverflowBehavior = normalizeTabOverflowBehavior(
        json.tabOverflowBehavior,
      );
      json.tabWheelBehavior = normalizeTabWheelBehavior(json.tabWheelBehavior);
      json.tabCloseSelectionBehavior = normalizeTabCloseSelectionBehavior(
        json.tabCloseSelectionBehavior,
      );
      json.tabHoverActivationBehavior = getTabHoverActivationBehavior(
        json.tabHoverActivationBehavior,
        json.activateTabOnHover,
      );
      delete json.activateTabOnHover;
      json.tabHoverActivationDelay = normalizeTabHoverActivationDelay(
        json.tabHoverActivationDelay,
      );

      if (typeof json.version === 'string') {
        // Migrate from 3.1.0
        Application.instance.storage.remove({
          scope: 'startupTabs',
          query: {},
          multi: true,
        });
      }

      if (typeof json.version === 'string' || json.version === 1) {
        json.searchEngines = DEFAULT_SEARCH_ENGINES;
      }

      // version < 3: 搜索引擎列表大幅扩充且默认引擎改为百度。重置为内置默认
      // (百度 index 0),随后启动时的云端同步会按 keyword 校准/覆盖。老用户此前
      // 默认是 Bing,这里统一切到百度。
      if (
        typeof json.version === 'string' ||
        (typeof json.version === 'number' && json.version < 3)
      ) {
        json.searchEngines = DEFAULT_SEARCH_ENGINES;
        json.searchEngine = 0;
      }

      if (json.themeAuto === undefined) {
        json.themeAuto = true;
      }

      if (typeof json.closeTabOnDoubleClick !== 'boolean') {
        json.closeTabOnDoubleClick = DEFAULT_SETTINGS.closeTabOnDoubleClick;
      }
      if (typeof json.closeTabOnRightClick !== 'boolean') {
        json.closeTabOnRightClick = DEFAULT_SETTINGS.closeTabOnRightClick;
      }
      if (
        json.tabCloseButtonDisplay !== 'always' &&
        json.tabCloseButtonDisplay !== 'hover' &&
        json.tabCloseButtonDisplay !== 'never'
      ) {
        // 旧设置中的 true 表示仅悬停时显示，false 表示始终显示。
        json.tabCloseButtonDisplay =
          json.hideTabCloseButtons === true
            ? 'hover'
            : DEFAULT_SETTINGS.tabCloseButtonDisplay;
      }
      delete json.hideTabCloseButtons;
      if (typeof json.immersivePageIndicator !== 'boolean') {
        json.immersivePageIndicator = DEFAULT_SETTINGS.immersivePageIndicator;
      }

      json.bookmarksBarDisplay = normalizeBookmarkBarDisplay(
        json.bookmarksBarDisplay,
        json.bookmarksBar,
      );
      json.bookmarksBar = json.bookmarksBarDisplay !== 'never';

      if (json.overlayBookmarks !== undefined) {
        delete json.overlayBookmarks;
      }

      if (json.darkTheme !== undefined) {
        delete json.darkTheme;
      }

      if (!json.newtab) {
        json.newtab = DEFAULT_SETTINGS.newtab;
      }

      if (!json.startupBehavior || !json.startupBehavior.type) {
        json.startupBehavior = DEFAULT_SETTINGS.startupBehavior;
      } else if (typeof json.startupBehavior.url !== 'string') {
        // url 可选；非字符串(老配置/被篡改)统一兜底为 undefined
        json.startupBehavior.url = undefined;
      }

      // shortcuts:快捷键自定义覆盖。老配置或被手工篡改的配置可能缺失或类型错误,
      // 统一兜底为空对象(等价于"全部使用注册表默认值")。
      if (!json.shortcuts || typeof json.shortcuts !== 'object') {
        json.shortcuts = {};
      }

      // extensionShortcuts:扩展命令(chrome.commands)改键覆盖。同 shortcuts,兜底为空对象。
      if (
        !json.extensionShortcuts ||
        typeof json.extensionShortcuts !== 'object'
      ) {
        json.extensionShortcuts = {};
      }

      // 鼠标右键手势:开关/轨迹颜色/动作覆盖。老配置缺失时回默认。
      if (typeof json.mouseGesturesEnabled !== 'boolean') {
        json.mouseGesturesEnabled = DEFAULT_SETTINGS.mouseGesturesEnabled;
      }
      if (
        typeof json.mouseGestureColor !== 'string' ||
        !json.mouseGestureColor
      ) {
        json.mouseGestureColor = DEFAULT_SETTINGS.mouseGestureColor;
      }
      if (!json.mouseGestures || typeof json.mouseGestures !== 'object') {
        json.mouseGestures = {};
      }
      if (typeof json.mouseLeftGesturesEnabled !== 'boolean') {
        json.mouseLeftGesturesEnabled =
          DEFAULT_SETTINGS.mouseLeftGesturesEnabled;
      }
      if (
        typeof json.mouseLeftGestureThreshold !== 'number' ||
        !Number.isFinite(json.mouseLeftGestureThreshold)
      ) {
        json.mouseLeftGestureThreshold =
          DEFAULT_SETTINGS.mouseLeftGestureThreshold;
      }
      json.mouseLeftGestureThreshold = Math.max(
        8,
        Math.min(200, Math.round(json.mouseLeftGestureThreshold)),
      );
      if (typeof json.mouseLeftGestureOpenInBackground !== 'boolean') {
        json.mouseLeftGestureOpenInBackground =
          DEFAULT_SETTINGS.mouseLeftGestureOpenInBackground;
      }
      if (
        !json.mouseLeftGestures ||
        typeof json.mouseLeftGestures !== 'object'
      ) {
        json.mouseLeftGestures = { ...DEFAULT_SETTINGS.mouseLeftGestures };
      }
      if (!json.mouseSideButtons || typeof json.mouseSideButtons !== 'object') {
        json.mouseSideButtons = { ...DEFAULT_SETTINGS.mouseSideButtons };
      }
      // 划词翻译:开关/目标语言。老配置缺失或类型错误时回默认。
      if (typeof json.selectionPanelEnabled !== 'boolean') {
        json.selectionPanelEnabled = DEFAULT_SETTINGS.selectionPanelEnabled;
      }
      if (typeof json.selectionWordCountEnabled !== 'boolean') {
        json.selectionWordCountEnabled =
          DEFAULT_SETTINGS.selectionWordCountEnabled;
      }
      if (typeof json.openPopupsInNewTab !== 'boolean') {
        json.openPopupsInNewTab = DEFAULT_SETTINGS.openPopupsInNewTab;
      }
      if (typeof json.selectionTranslateEnabled !== 'boolean') {
        json.selectionTranslateEnabled =
          DEFAULT_SETTINGS.selectionTranslateEnabled;
      }
      if (
        typeof json.selectionTranslateTarget !== 'string' ||
        !json.selectionTranslateTarget
      ) {
        json.selectionTranslateTarget =
          DEFAULT_SETTINGS.selectionTranslateTarget;
      }
      json.translateEngine = normalizeTranslateEngine(json.translateEngine);
      json.customLlmConfig = normalizeCustomLlmConfig(json.customLlmConfig);

      // 效率搜索:旧双引擎开关统一迁移为默认双列模式;多标签引擎独立保存。
      json.efficiencySearchMode = normalizeEfficiencySearchMode(
        json.efficiencySearchMode,
      );
      delete json.dualEngineSearch;
      json.efficiencySearchEngineKeywords = normalizeMultiSearchEngineKeywords(
        json.efficiencySearchEngineKeywords,
        json.searchEngines || DEFAULT_SEARCH_ENGINES,
      );
      if (typeof json.secondarySearchEngine !== 'number') {
        json.secondarySearchEngine = DEFAULT_SETTINGS.secondarySearchEngine;
      }

      // flagsSelections:内置 flags 页的用户覆盖。老配置缺失或类型错误时回默认。
      if (!json.flagsSelections || typeof json.flagsSelections !== 'object') {
        json.flagsSelections = {};
      }

      // hardwareAcceleration:硬件加速开关。用户显式设置过则遵从;缺失/类型错误时
      // 按机器档位给默认——RAM≤8GB 默认关(与 index.ts 的 app.disableHardwareAcceleration
      // 决策同源,保证设置页开关显示与实际行为一致)。>8GB 默认开。
      if (typeof json.hardwareAcceleration !== 'boolean') {
        json.hardwareAcceleration = isHeavyUI();
      }

      // Flash 兼容支持:存量配置缺失时默认开启，保持升级前“需要时自动提供兼容”的行为。
      if (typeof json.flashSupport !== 'boolean') {
        json.flashSupport = DEFAULT_SETTINGS.flashSupport;
      }

      // Some packaged builds persisted the renderer fallback ('') because the
      // shared defaults cannot access Electron there. Repair only missing/empty
      // values; a non-empty user-selected directory must always win.
      if (
        typeof json.downloadsPath !== 'string' ||
        !json.downloadsPath.trim()
      ) {
        json.downloadsPath = getSystemDownloadsPath();
      }
      json.m3u8DownloadThreads = normalizeM3u8DownloadThreads(
        json.m3u8DownloadThreads,
      );

      // 外部下载器:开关/类型/路径/参数/自动接管。老配置缺失或类型错误时回默认。
      if (typeof json.downloaderEnabled !== 'boolean') {
        json.downloaderEnabled = DEFAULT_SETTINGS.downloaderEnabled;
      }
      if (typeof json.downloaderAutoIntercept !== 'boolean') {
        json.downloaderAutoIntercept = DEFAULT_SETTINGS.downloaderAutoIntercept;
      }
      if (typeof json.downloaderType !== 'string' || !json.downloaderType) {
        json.downloaderType = DEFAULT_SETTINGS.downloaderType;
      }
      if (typeof json.downloaderPath !== 'string') {
        json.downloaderPath = '';
      }
      if (typeof json.downloaderArgs !== 'string') {
        json.downloaderArgs = '';
      }

      // 壳层 CSS 只接受字符串，防止手工损坏的配置在 renderer 中生成异常节点。
      json.customChromeCss = normalizeCustomChromeCss(json.customChromeCss);
      // 可视化调控面板:共享 schema 校验后只留合法键值。
      json.chromeStylePanel = normalizeChromeStylePanel(json.chromeStylePanel);

      // Never trust the cached snapshot: rebuild it from the installed manifest.
      try {
        const activeThemeId = json.activeChromeTheme?.id;
        if (/^[a-p]{32}$/.test(activeThemeId || '')) {
          const themeManifest = JSON.parse(
            await promises.readFile(
              resolve(getPath('extensions'), activeThemeId, 'manifest.json'),
              'utf8',
            ),
          );
          json.activeChromeTheme = normalizeChromeTheme(
            activeThemeId,
            themeManifest?.name ||
              json.activeChromeTheme?.name ||
              activeThemeId,
            themeManifest?.theme,
          );
        } else {
          json.activeChromeTheme = null;
        }
      } catch {
        json.activeChromeTheme = null;
      }

      // 手动清理:设置弹窗与工具栏入口共用这 4 个勾选项。
      const cbd = json.clearBrowsingData;
      json.clearBrowsingData = {
        cache: typeof cbd?.cache === 'boolean' ? cbd.cache : true,
        cookies: typeof cbd?.cookies === 'boolean' ? cbd.cookies : false,
        history: typeof cbd?.history === 'boolean' ? cbd.history : true,
        searchHistory:
          typeof cbd?.searchHistory === 'boolean' ? cbd.searchHistory : false,
      };

      // 退出时自动清理:4 个子项,老配置缺失/类型错误/非对象时按默认补全。
      const coe = json.clearOnExit;
      json.clearOnExit = {
        cache: typeof coe?.cache === 'boolean' ? coe.cache : false,
        cookies: typeof coe?.cookies === 'boolean' ? coe.cookies : false,
        history: typeof coe?.history === 'boolean' ? coe.history : false,
        searchHistory:
          typeof coe?.searchHistory === 'boolean' ? coe.searchHistory : false,
      };

      // 会话 Cookie 持久化:老配置缺失/类型错误时回默认(关)。
      if (typeof json.persistSessionCookies !== 'boolean') {
        json.persistSessionCookies = DEFAULT_SETTINGS.persistSessionCookies;
      }
      json.persistSessionCookieHosts = normalizePersistSessionCookieHosts(
        json.persistSessionCookieHosts,
      );

      this.object = {
        ...this.object,
        ...json,
        version: DEFAULT_SETTINGS.version,
      };

      this.loaded = true;

      this.addToQueue();
      this.emit('load');
    } catch (e) {
      // 首次启动/无 settings.json:this.object 仍是 DEFAULT_SETTINGS。按机器档位
      // 校正硬件加速默认(与 index.ts 同源),使设置页开关显示与实际生效一致。
      this.object = {
        ...this.object,
        hardwareAcceleration: isHeavyUI(),
      };
      this.loaded = true;
      this.emit('load');
    }

    this.update();
  }

  private async save() {
    try {
      const content = JSON.stringify({
        ...this.object,
        version: DEFAULT_SETTINGS.version,
      });
      await promises.writeFile(getPath('settings.json'), content);

      const mirrorPath = getSettingsMirrorPath();
      if (mirrorPath) {
        try {
          await promises.mkdir(dirname(mirrorPath), { recursive: true });
          await promises.writeFile(mirrorPath, content);
        } catch (error) {
          // 主数据目录已经成功保存；镜像会在下次保存和下次启动时重试修复。
          console.error('[settings] 保存 settings.json 镜像失败:', error);
        }
      }

      if (this.queue.length >= 3) {
        for (let i = this.queue.length - 1; i > 0; i--) {
          this.removeAllListeners(this.queue[i]);
          this.queue.splice(i, 1);
        }
      } else {
        this.queue.splice(0, 1);
      }

      if (this.queue[0]) {
        this.emit(this.queue[0]);
      }
    } catch (e) {
      console.error(e);
    }
  }

  public async addToQueue() {
    const id = makeId(32);

    this.queue.push(id);

    // update() 广播设置并装配网络拦截;它可能抛异常。务必不能让它阻断后续的
    // save() 调度,否则队列头会永久卡死,导致所有设置无法落盘。
    try {
      this.update();
    } catch (e) {
      console.error('settings.update() failed', e);
    }

    if (this.queue.length === 1) {
      this.save();
    } else {
      this.once(id, () => {
        this.save();
      });
    }
  }

  public updateSettings(settings: Partial<ISettings>) {
    const nextSettings = { ...settings };
    delete (nextSettings as any).dualEngineSearch;
    if (
      Object.prototype.hasOwnProperty.call(nextSettings, 'bookmarksBarDisplay')
    ) {
      nextSettings.bookmarksBarDisplay = normalizeBookmarkBarDisplay(
        nextSettings.bookmarksBarDisplay,
        nextSettings.bookmarksBar,
      );
      nextSettings.bookmarksBar = nextSettings.bookmarksBarDisplay !== 'never';
    } else if (
      Object.prototype.hasOwnProperty.call(nextSettings, 'bookmarksBar')
    ) {
      nextSettings.bookmarksBarDisplay = nextSettings.bookmarksBar
        ? 'always'
        : 'never';
    }
    if (
      Object.prototype.hasOwnProperty.call(nextSettings, 'efficiencySearchMode')
    ) {
      nextSettings.efficiencySearchMode = normalizeEfficiencySearchMode(
        nextSettings.efficiencySearchMode,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(
        nextSettings,
        'efficiencySearchEngineKeywords',
      ) ||
      Object.prototype.hasOwnProperty.call(nextSettings, 'searchEngines')
    ) {
      nextSettings.efficiencySearchEngineKeywords =
        normalizeMultiSearchEngineKeywords(
          nextSettings.efficiencySearchEngineKeywords ||
            this.object.efficiencySearchEngineKeywords,
          nextSettings.searchEngines || this.object.searchEngines,
        );
    }
    if (Object.prototype.hasOwnProperty.call(nextSettings, 'customChromeCss')) {
      nextSettings.customChromeCss = normalizeCustomChromeCss(
        nextSettings.customChromeCss,
      );
    }
    if (Object.prototype.hasOwnProperty.call(nextSettings, 'chromeStylePanel')) {
      nextSettings.chromeStylePanel = normalizeChromeStylePanel(
        nextSettings.chromeStylePanel,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(nextSettings, 'tabOverflowBehavior')
    ) {
      nextSettings.tabOverflowBehavior = normalizeTabOverflowBehavior(
        nextSettings.tabOverflowBehavior,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(nextSettings, 'tabWheelBehavior')
    ) {
      nextSettings.tabWheelBehavior = normalizeTabWheelBehavior(
        nextSettings.tabWheelBehavior,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(
        nextSettings,
        'tabCloseSelectionBehavior',
      )
    ) {
      nextSettings.tabCloseSelectionBehavior =
        normalizeTabCloseSelectionBehavior(
          nextSettings.tabCloseSelectionBehavior,
        );
    }
    if (
      Object.prototype.hasOwnProperty.call(
        nextSettings,
        'tabHoverActivationBehavior',
      )
    ) {
      nextSettings.tabHoverActivationBehavior =
        normalizeTabHoverActivationBehavior(
          nextSettings.tabHoverActivationBehavior,
        );
    }
    if (
      Object.prototype.hasOwnProperty.call(
        nextSettings,
        'tabHoverActivationDelay',
      )
    ) {
      nextSettings.tabHoverActivationDelay = normalizeTabHoverActivationDelay(
        nextSettings.tabHoverActivationDelay,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(nextSettings, 'm3u8DownloadThreads')
    ) {
      nextSettings.m3u8DownloadThreads = normalizeM3u8DownloadThreads(
        nextSettings.m3u8DownloadThreads,
      );
    }
    if (Object.prototype.hasOwnProperty.call(nextSettings, 'translateEngine')) {
      nextSettings.translateEngine = normalizeTranslateEngine(
        nextSettings.translateEngine,
      );
    }
    if (Object.prototype.hasOwnProperty.call(nextSettings, 'customLlmConfig')) {
      nextSettings.customLlmConfig = normalizeCustomLlmConfig(
        nextSettings.customLlmConfig,
      );
    }
    this.object = { ...this.object, ...nextSettings };

    this.addToQueue();
  }
}
