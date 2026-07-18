import {app, ipcMain, nativeTheme, dialog} from 'electron';

import {DEFAULT_SETTINGS, DEFAULT_SEARCH_ENGINES} from '~/constants';

import {promises} from 'fs';

import {getPath, makeId} from '~/utils';
import {EventEmitter} from 'events';
import {
  runAdblockService,
  stopAdblockService,
  dispatchWebReqToExtensions,
  stripThirdPartySetCookies,
} from '../services/adblock';
import {Application} from '../application';
import {WEBUI_BASE_URL} from '~/constants/files';
import {ISettings} from '~/interfaces';
import {resolve} from "path";
import {deletePath, pathExists, readFileAsText} from "~/utils/files";
import {ChromeUserAgent} from "~/main/user-agent";
import IpcMainEvent = Electron.IpcMainEvent;
import {filterVideo, recordUrlRequest, stripEdgeCspHeaders} from "~/main/services/supervideo-video";
import {tlog} from "~/main/timing";
import {discoverDownloaderPath, DOWNLOADER_PRESETS} from "../services/external-downloader";
import {migrationGate} from "../data-location";
import {isHeavyUI} from "../utils/hardware-profile";
import {getViewBackgroundColor} from "../utils/theme";

export class Settings extends EventEmitter {
  public object = DEFAULT_SETTINGS;

  private queue: string[] = [];

  private loaded = false;

  // 仅记录本次运行中最近一次「生效主题」。夜间模式扩展只在主题真的发生
  // 明暗切换时联动；普通设置保存、扩展手动启停和应用重启都不做全局校准。
  private lastDarknightThemeState: boolean | null = null;

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
      (e, {settings}: { settings: string; incognito: boolean }) => {
        this.updateSettings(JSON.parse(settings));
      },
    );

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
      const {canceled, filePaths} = await dialog.showOpenDialog({
        defaultPath: this.object.downloadsPath,
        properties: ['openDirectory'],
      });

      if (canceled) return;

      this.object.downloadsPath = filePaths[0];

      this.addToQueue();
    });

    // 外部下载器:选择可执行文件路径(用户手动指定)。
    ipcMain.on('downloader-path-change', async () => {
      const {canceled, filePaths} = await dialog.showOpenDialog({
        title: '选择下载器可执行文件',
        defaultPath: this.object.downloaderPath || undefined,
        properties: ['openFile'],
      });

      if (canceled) return;

      this.updateSettings({downloaderPath: filePaths[0]});
    });

    // 外部下载器:按预置类型从注册表自动发现路径(IDM 等有注册表项的)。
    // 迅雷走 thunder:// 协议无需路径;aria2/custom 无注册表项;找不到则弹提示。
    ipcMain.on('downloader-path-autodetect', async () => {
      const type = this.object.downloaderType;
      const path = await discoverDownloaderPath(type);
      if (path) {
        this.updateSettings({downloaderPath: path});
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
    ipcMain.handle('hiker-crx-msg', async (event, extensionId, fnName, ...args) => {
      try {
        const extensions = Application.instance.sessions.extensions;
        const ext = (extensions || []).find(it => it.id == extensionId);
        if (ext && ext.manifest && ext.manifest.commands) {
          const commands = [];
          for (let key of Object.keys(ext.manifest.commands)) {
            commands.push({
              name: key,
              description: ext.manifest.commands[key].description,
              shortcut: (ext.manifest.commands[key].suggested_key || {}).default
            })
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
              shortcut: (manifest.commands[key].suggested_key || {}).default
            })
          }
          return commands;
        }
      } catch (e) {
        console.log(e);
      }
      return [];
    });

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
    let darknightThemeChanged = false;
    // nativeTheme 可能在 settings.json 尚未加载时先发出 updated。此时不能用
    // DEFAULT_SETTINGS 建立基线，否则磁盘设置加载会被误判成一次用户切换。
    if (this.loaded) {
      darknightThemeChanged =
        this.lastDarknightThemeState !== null &&
        this.lastDarknightThemeState !== isDarkTheme;
      this.lastDarknightThemeState = isDarkTheme;
    }

    if (themeSource !== nativeTheme.themeSource) {
      nativeTheme.themeSource = themeSource as any;
    }

    Application.instance.dialogs?.sendToAll('update-settings', this.object);

    for (const window of Application.instance.windows?.list || []) {
      window.send('update-settings', this.object);

      window.viewManager.views.forEach(async (v) => {
        if (!v.browserView || v.browserView.webContents.isDestroyed()) return;
        // 主题切换时同步内容 view 的底色,避免切到暗色后已开的标签仍白闪。
        v.browserView.setBackgroundColor(getViewBackgroundColor());
        if (v.webContents.getURL().startsWith(WEBUI_BASE_URL)) {
          v.webContents.send('update-settings', this.object);
        }
      });

      // 双引擎搜索:总开关关闭时,立即收起所有窗口已打开的副引擎侧边栏。
      // (开启后显示由搜索触发 IPC 负责;这里只处理「开着时被关掉」的收尾。)
      if (!this.object.dualEngineSearch) {
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

    // 夜间模式只跟随「本次运行中发生的主题切换」联动一次。不能在每次 update()
    // 都按当前主题强制对齐，否则用户从扩展管理页手动禁用 darknight 后，
    // disabledExtensions 的保存会立刻把它重新启用。
    if (darknightThemeChanged) {
      sessions.syncDarknightForTheme(isDarkTheme, true).catch(() => {});
    }

    const contexts = [sessions.view, sessions.viewIncognito];
    const incognitoBlockThirdPartyCookies =
      this.object.incognitoBlockThirdPartyCookies !== false;
      console.log("onHeadersReceived register-3");
    contexts.forEach((e) => {
      e.webRequest.onBeforeSendHeaders({urls: ['<all_urls>']}, (details: Electron.OnBeforeSendHeadersListenerDetails, callback: any) => {
        if (details.url.startsWith('chrome-extension://')) {
          tlog(`webRequest.onBeforeSendHeaders chrome-extension: ${details.resourceType} ${details.url}`);
        }
        const obj: { requestHeaders?: Record<string, string> } = {};
        try {
          const {object: settings} = Application.instance.settings;
          if (settings.doNotTrack) {
            details.requestHeaders['DNT'] = '1';
            obj.requestHeaders = details.requestHeaders;
          }
          const ua = details.requestHeaders["User-Agent"];
          if (ua && ua.includes("Electron")) {
            details.requestHeaders["User-Agent"] = ChromeUserAgent;
            obj.requestHeaders = details.requestHeaders;
          }
          const al = details.requestHeaders["Accept-Language"];
          if (al == "zh-CN") {
            details.requestHeaders["Accept-Language"] = "zh-CN,zh;q=0.9";
            obj.requestHeaders = details.requestHeaders;
          }
          recordUrlRequest(details);
        } catch (err) {
          console.log(err);
        }
        // callback MUST always run, even if the logic above throws — otherwise
        // the request hangs until Chromium's ~30s webRequest timeout.
        callback(obj);
      });

      console.log("onHeadersReceived register");
      e.webRequest.onHeadersReceived({urls: ['<all_urls>']}, (details,callback) => {
      //   console.log("onHeadersReceived callback", details.url);
        if (details.url.startsWith('chrome-extension://')) {
          tlog(`webRequest.onHeadersReceived chrome-extension: ${details.statusCode} ${details.url}`);
        }
        // 本监听器在屏蔽关闭/引擎未初始化时是 session 上唯一的 onHeadersReceived
        // (Electron 单监听器,后注册者覆盖)。settings 的 onHeadersReceived 还需把事件
        // 转发给扩展(IDM 等依赖它检测视频媒体);屏蔽开启时则由 adblock.ts hookEngine
        // 的包装器转发,二者互斥(单监听器),不会重复分发。
        try {
          dispatchWebReqToExtensions('onHeadersReceived', details, e);
        } catch (err) {
          console.log('[settings] dispatchWebReqToExtensions error', err);
        }
        const responseHeaders = stripEdgeCspHeaders(
          details.url,
          details.responseHeaders,
        );
        try {
          filterVideo(details);
        } catch (err) {
          console.log(err);
        }
        if (incognitoBlockThirdPartyCookies && e === sessions.viewIncognito) {
          stripThirdPartySetCookies(details, responseHeaders, e);
        }
        callback(responseHeaders ? {responseHeaders} : {});
      });
      if (this.object.shield) {
        runAdblockService(e);
      } else {
        stopAdblockService(e);
      }
    });
  };

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
      if (!json.extensionShortcuts || typeof json.extensionShortcuts !== 'object') {
        json.extensionShortcuts = {};
      }

      // 鼠标右键手势:开关/轨迹颜色/动作覆盖。老配置缺失时回默认。
      if (typeof json.mouseGesturesEnabled !== 'boolean') {
        json.mouseGesturesEnabled = DEFAULT_SETTINGS.mouseGesturesEnabled;
      }
      if (typeof json.mouseGestureColor !== 'string' || !json.mouseGestureColor) {
        json.mouseGestureColor = DEFAULT_SETTINGS.mouseGestureColor;
      }
      if (!json.mouseGestures || typeof json.mouseGestures !== 'object') {
        json.mouseGestures = {};
      }

      // 划词翻译:开关/目标语言。老配置缺失或类型错误时回默认。
      if (typeof json.selectionTranslateEnabled !== 'boolean') {
        json.selectionTranslateEnabled = DEFAULT_SETTINGS.selectionTranslateEnabled;
      }
      if (typeof json.selectionTranslateTarget !== 'string' || !json.selectionTranslateTarget) {
        json.selectionTranslateTarget = DEFAULT_SETTINGS.selectionTranslateTarget;
      }

      // 双引擎搜索:总开关 + 副引擎下标。老配置缺失或类型错误时回默认。
      if (typeof json.dualEngineSearch !== 'boolean') {
        json.dualEngineSearch = DEFAULT_SETTINGS.dualEngineSearch;
      }
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
      await promises.writeFile(
        getPath('settings.json'),
        JSON.stringify({...this.object, version: DEFAULT_SETTINGS.version}),
      );

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
    this.object = {...this.object, ...settings};

    this.addToQueue();
  }
}
