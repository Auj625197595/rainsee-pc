import {observable, computed, makeObservable, makeAutoObservable} from 'mobx';

import {TabsStore} from './tabs';
import {TabGroupsStore} from './tab-groups';
import {AddTabStore} from './add-tab';
import {ipcRenderer} from 'electron';
import * as remote from '@electron/remote';
import {ExtensionsStore} from './extensions';
import {SettingsStore} from './settings';
import {getTargetWindowId, isImmersiveHeaderWindow} from '../utils/windows';
import {StartupTabsStore} from './startup-tabs';
import {getTheme} from '~/utils/themes';
import {AutoFillStore} from './autofill';
import {IDownloadItem, BrowserActionChangeType} from '~/interfaces';
import {IBrowserAction} from '../models';
import {IURLSegment} from '~/interfaces/urls';
import {BookmarkBarStore} from './bookmark-bar';
import {getWebUIURL} from "~/common/webui";
import {initImmersiveMirror, initImmersiveSyncSource} from './immersive-sync';

export class Store {
  public settings = new SettingsStore(this);
  public addTab = new AddTabStore();
  public tabs = new TabsStore();
  public extensions = new ExtensionsStore();
  public startupTabs = new StartupTabsStore(this);
  public tabGroups = new TabGroupsStore(this);
  public autoFill = new AutoFillStore();
  public bookmarksBar = new BookmarkBarStore(this);

  public inputRef: HTMLInputElement;

  public adblockBtnRef: HTMLDivElement;

  public canOpenSearch = false;

  public mouse = {
    x: 0,
    y: 0,
  };

  public windowId = getTargetWindowId();

  public barHideTimer = 0;

  public isIncognito = ipcRenderer.sendSync(`is-incognito-${this.windowId}`);

  // 本窗口是否由标签撕离生成:若是则跳过默认新标签页,等待主进程 tab-adopt。
  public isPendingDetach = ipcRenderer.sendSync(
    `is-pending-detach-${this.windowId}`,
  );

  // Observable
  public addressbarTextVisible = true;

  public addressbarFocused = false;

  // 空白新标签页加载完成后,页面 autofocus 会抢走地址栏焦点。主进程 view-loaded
  // 事件回传时据此重新聚焦(一次性:addTab 置位、view-loaded 消费)。
  public expectingNewTabFocus = false;

  public addressbarEditing = false;

  // gosearch 等程序化聚焦时置位:下一次地址栏 onFocus 应弹出联想面板。
  // 用于区分新标签页的程序化聚焦(不弹)与 gosearch(弹)。
  public addressbarShowSuggestionsOnFocus = false;

  // 紧凑标题栏里由「新标签搜索」按钮唤起的一次性搜索会话:
  // 地址栏与联想面板沿用同一套 UI,但提交结果应在新标签页打开。
  public addressbarOpenInNewTab = false;

  public isAlwaysOnTop = false;

  public isFullscreen = false;

  public isHTMLFullscreen = false;

  public titlebarVisible = false;

  public updateAvailable = false;

  public updateVersion = '';

  public updateNotes = '';

  public navigationState = {
    canGoBack: false,
    canGoForward: false,
  };

  public downloadsButtonVisible = false;

  public downloadNotification = false;

  public downloads: IDownloadItem[] = [];

  public isBookmarked = false;

  public zoomFactor = 1;
  public mouseUpped = false;

  public dialogsVisibility: { [key: string]: boolean } = {
    menu: false,
    'add-bookmark': false,
    'show-block': false,
    'show-video': false,
    zoom: false,
    'extension-popup': false,
    'downloads-dialog': false,
    'extensions-list': false,
  };

  // Computed

  public get downloadProgress() {
    const downloading = this.downloads.filter(
      (x) => !x.completed && !x.canceled && !x.paused,
    );

    if (downloading.length === 0) return 0;

    const {totalBytes} = downloading.reduce((prev, cur) => ({
      totalBytes: prev.totalBytes + cur.totalBytes,
    }));

    const {receivedBytes} = downloading.reduce((prev, cur) => ({
      receivedBytes: prev.receivedBytes + cur.receivedBytes,
    }));

    return receivedBytes / totalBytes;
  }

  public get isCompact() {
    return this.settings.object.topBarVariant === 'compact';
  }

  public get tabsLayout() {
    return this.settings.object.tabsLayout || 'top';
  }

  public get isSidebar() {
    return this.tabsLayout === 'left' || this.tabsLayout === 'right';
  }

  public get theme() {
    // 无痕窗口的整窗 UI(标题栏/工具栏/地址栏图标/标签)与 ThemeProvider 一样强制走深色主题。
    // 否则直接读 store.theme['toolbar.lightForeground'] 配色、并显式 autoInvert={false} 的图标
    // (前进/后退/刷新、主页、盾牌、翻译等)会按用户真实(浅色)主题算出近黑/灰色,在黑底上看不见。
    return getTheme(this.isIncognito ? 'wexond-dark' : this.settings.object.theme);
  }

  public get addressbarValue() {
    const tab = this.tabs.selectedTab;
    if (tab?.addressbarValue != null) return tab?.addressbarValue;
    else if (tab && !tab?.url?.startsWith(getWebUIURL("newtab")))
      return tab.url[tab.url.length - 1] === '/'
        ? tab.url.slice(0, -1)
        : tab.url;
    return '';
  }

  public get addressbarUrlSegments() {
    let capturedText = '';
    let grayOutCaptured = false;
    let hostnameCaptured = false;
    let protocolCaptured = false;
    const segments: IURLSegment[] = [];

    const url = this.addressbarValue;

    const whitelistedProtocols = ['https', 'http', 'ftp', 'yjllq'];

    for (let i = 0; i < url.length; i++) {
      const protocol = whitelistedProtocols.find(
        (x) => `${x}:/` === capturedText,
      );
      if (url[i] === '/' && protocol && !protocolCaptured) {
        segments.push({
          value: `${protocol}://`,
          grayOut: true,
        });

        protocolCaptured = true;
        capturedText = '';
      } else if (
        url[i] === '/' &&
        !hostnameCaptured &&
        (protocolCaptured ||
          !whitelistedProtocols.find((x) => `${x}:` === capturedText))
      ) {
        segments.push({
          value: capturedText,
          grayOut: false,
        });

        hostnameCaptured = true;
        capturedText = url[i];
        grayOutCaptured = true;
      } else {
        capturedText += url[i];
      }

      if (i === url.length - 1) {
        segments.push({
          value: capturedText,
          grayOut: grayOutCaptured,
        });
      }
    }

    return segments;
  }

  public focusAddressBar(tab = this.tabs.selectedTab) {
    if (!tab || tab !== this.tabs.selectedTab || !this.inputRef) return false;

    this.addressbarTextVisible = false;
    this.addressbarFocused = true;
    tab.addressbarFocused = true;

    remote.getCurrentWebContents().focus();
    this.inputRef.focus();

    const selectionRange = tab.addressbarSelectionRange || [];
    const start =
      typeof selectionRange[0] === 'number' ? selectionRange[0] : 0;
    const end =
      typeof selectionRange[1] === 'number' ? selectionRange[1] : start;
    try {
      this.inputRef.setSelectionRange(start, end);
    } catch {
      // Input may be temporarily unavailable during tab/layout switches.
    }

    return true;
  }

  public scheduleAddressBarFocus(
    tab = this.tabs.selectedTab,
    delays: number[] = [0],
  ) {
    delays.forEach((delay) => {
      setTimeout(() => {
        if (this.tabs.selectedTab === tab) {
          this.focusAddressBar(tab);
        }
      }, delay);
    });
  }

  public constructor() {
    makeObservable(this, {
      addressbarTextVisible: observable,
      addressbarFocused: observable,
      addressbarEditing: observable,
      addressbarOpenInNewTab: observable,
      isAlwaysOnTop: observable,
      isFullscreen: observable,
      isHTMLFullscreen: observable,
      titlebarVisible: observable,
      updateAvailable: observable,
      updateVersion: observable,
      updateNotes: observable,
      navigationState: observable,
      downloadsButtonVisible: observable,
      downloadNotification: observable,
      downloads: observable,
      isBookmarked: observable,
      zoomFactor: observable,
      dialogsVisibility: observable,
      addressbarUrlSegments: computed,
      addressbarValue: computed,
      theme: computed,
      isCompact: computed,
      tabsLayout: computed,
      isSidebar: computed,
      downloadProgress: computed,
    });

    ipcRenderer.on('update-navigation-state', (e, data) => {
      this.navigationState = data;
    });

    ipcRenderer.on('fullscreen', (e, fullscreen: boolean) => {
      this.isFullscreen = fullscreen;
    });

    ipcRenderer.on('html-fullscreen', (e, fullscreen: boolean) => {
      this.isHTMLFullscreen = fullscreen;
    });

    ipcRenderer.on('update-available', (e, data) => {
      this.updateAvailable = true;
      if (data) {
        this.updateVersion = data.version || '';
        this.updateNotes = data.notes || '';
      }
    });

    ipcRenderer.on('download-started', (e, item) => {
      this.downloads.push(item);
      this.downloadsButtonVisible = true;
    });

    ipcRenderer.on('download-removed', (e, id: string) => {
      const downloads = this.downloads.filter((x) => x.id !== id);
      this.downloadsButtonVisible = downloads.length > 0;
      this.downloads = downloads;
    });

    ipcRenderer.on('download-progress', (e, item: IDownloadItem) => {
      const index = this.downloads.findIndex((x) => x.id === item.id);
      if (index === -1) return;
      this.downloads[index] = {
        ...this.downloads[index],
        ...item,
      };
    });

    ipcRenderer.on('is-bookmarked', (e, flag) => {
      this.isBookmarked = flag;
    });

    ipcRenderer.on(
      'download-completed',
      (e, id: string, downloadNotification: boolean) => {
        const i = this.downloads.find((x) => x.id === id);
        if (!i) return;
        i.completed = true;

        if (downloadNotification) {
          this.downloadNotification = true;
        }
      },
    );

    ipcRenderer.on('download-paused', (e, id: string) => {
      const i = this.downloads.find((x) => x.id === id);
      if (!i) return;
      i.paused = true;
    });

    ipcRenderer.on('download-canceled', (e, id: string) => {
      const i = this.downloads.find((x) => x.id === id);
      if (!i) return;
      i.completed = false;
      i.canceled = true;
    });

    ipcRenderer.on('find', () => {
      if (isImmersiveHeaderWindow()) return;
      const tab = this.tabs.selectedTab;
      if (tab) {
        ipcRenderer.send(`find-show-${this.windowId}`, tab.id);
      }
    });

    ipcRenderer.on('dialog-visibility-change', (e, name, state) => {
      this.dialogsVisibility[name] = state;
    });

    // 空白新标签页首次加载完成(did-finish-load)回传:页面 autofocus 会从地址栏
    // 抢走焦点,据此夺回。仅当仍是那次空白新建的选中标签时生效,延后一个事件循环
    // 让页面 autofocus 先发生,再聚焦地址栏。
    ipcRenderer.on(`view-loaded-${this.windowId}`, (e, viewId: number) => {
      const tab = this.tabs.getTabById(viewId);
      if (
        this.expectingNewTabFocus &&
        tab &&
        tab === this.tabs.selectedTab
      ) {
        this.expectingNewTabFocus = false;
        setTimeout(() => {
          if (this.tabs.selectedTab !== tab || !this.inputRef) return;
          // 页面 autofocus 把物理键盘焦点交给了 BrowserView:先经主进程把它拉回
          // 主窗口 webContents,再聚焦地址栏,否则光标在但输入落空。
          ipcRenderer.invoke(`focus-main-window-${this.windowId}`).then(() => {
            if (this.tabs.selectedTab === tab) this.focusAddressBar(tab);
          });
        }, 0);
      }
    });

    ipcRenderer.on(`addressbar-update-input`, (e, data) => {
      const tab = this.tabs.getTabById(data.id);
      //console.log(`addressbar-update-input`, data, tab, tab.isSelected);

      this.addressbarEditing = false;
      // 「新标签搜索」只对当前这次联想会话生效;弹窗关闭后立即恢复普通地址栏行为。
      this.addressbarOpenInNewTab = false;

      if (tab) {
        tab.addressbarValue = data.text;
        tab.addressbarSelectionRange = [data.selectionStart, data.selectionEnd];

        if (tab.isSelected && this.inputRef) {
          this.inputRef.value = data.text;
          this.inputRef.setSelectionRange(
            data.selectionStart,
            data.selectionEnd,
          );

          if (data.focus) {
            // gosearch:聚焦后弹出联想面板(展示历史搜索词)。
            if (data.showSuggestions) {
              this.addressbarShowSuggestionsOnFocus = true;
            }
            this.focusAddressBar(tab);
            this.scheduleAddressBarFocus(tab, [0, 80]);
          } else if(data.enter) {
            this.mouseUpped = false;
            const blurNow = () => {
              this.inputRef.blur();
              window.getSelection().removeAllRanges();
              this.addressbarTextVisible = true;
              this.addressbarFocused = false;
              const {selectedTab} = this.tabs;
              if (selectedTab) {
                selectedTab.addressbarFocused = false;
              }
            }
            setTimeout(()=>{
              blurNow();
            }, 500);
            setTimeout(()=>{
              blurNow();
            }, 1000);
          }

          if (data.escape) {
            this.addressbarFocused = false;
            this.tabs.selectedTab.addressbarValue = null;

            requestAnimationFrame(() => {
              this.inputRef.select();
            });
          }
        }
      }
    });

    // 「新标签页搜索」结果:在当前窗口新建标签页打开(由 search 弹窗经主进程转发而来)。
    ipcRenderer.on('search-open-new-tab', (e, url: string) => {
      if (isImmersiveHeaderWindow()) return;
      this.tabs.addTab({ url, active: true });
    });

    if (process.env.ENABLE_EXTENSIONS) {
      ipcRenderer.on(
        'set-browserAction-info',
        async (e, extensionId, action: BrowserActionChangeType, details) => {
          console.log(
            '[set-browserAction-info]',
            extensionId,
            action,
            JSON.stringify(details),
            'defaults:',
            this.extensions.defaultBrowserActions.length,
            'tabActions:',
            this.extensions.browserActions.length,
          );
          if (
            this.extensions.defaultBrowserActions.filter(
              (x) => x.extensionId === extensionId,
            ).length === 0
          ) {
            this.extensions.load();
          }

          const handler = (item: IBrowserAction) => {
            if (action === 'setBadgeText') {
              ipcRenderer.send(
                'crx-badge-debug',
                `RENDERER setBadgeText ext=${extensionId} text=${JSON.stringify(details.text)} tabId=${details.tabId}`,
              );
              item.badgeText = details.text;
            } else if (action === 'setPopup') {
              item.popup = details.popup;
            } else if (action === 'setTitle') {
              item.title = details.title;
            } else if (action === 'setIcon') {
              if (details.icon) item.icon = details.icon;
            } else if (action === 'setBadgeBackgroundColor') {
              const c = details.color;
              let resolved: string | undefined;
              if (Array.isArray(c)) {
                resolved = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${
                  c[3] != null ? c[3] / 255 : 1
                })`;
              } else if (c) {
                resolved = c;
              }
              ipcRenderer.send(
                'crx-badge-debug',
                `RENDERER setBadgeBackgroundColor ext=${extensionId} raw=${JSON.stringify(
                  c,
                )} resolved=${resolved} tabId=${details.tabId}`,
              );
              if (resolved) item.badgeBackgroundColor = resolved;
            } else if (action === 'setBadgeTextColor') {
              // Mirror setBadgeBackgroundColor: accept a [r,g,b,a] array OR a
              // CSS color string.
              const c = details.textColor;
              let resolved: string | undefined;
              if (Array.isArray(c)) {
                resolved = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${
                  c[3] != null ? c[3] / 255 : 1
                })`;
              } else if (c) {
                resolved = c;
              }
              if (resolved) item.badgeTextColor = resolved;
            } else if (action === 'setEnabled') {
              (item as any).enabled = details.enabled !== false;
            }
          };

          if (details.tabId) {
            const matched = this.extensions.browserActions.filter(
              (x) => x.extensionId === extensionId && x.tabId === details.tabId,
            );
            ipcRenderer.send(
              'crx-badge-debug',
              `RENDERER per-tab action=${action} tabId=${details.tabId} selected=${this.tabs.selectedTabId} matched=${matched.length} allTabIds=[${this.extensions.browserActions
                .filter((x) => x.extensionId === extensionId)
                .map((x) => x.tabId)
                .join(',')}]`,
            );
            matched.forEach(handler);
          } else {
            const md = this.extensions.defaultBrowserActions.filter(
              (x) => x.extensionId === extensionId,
            );
            const mt = this.extensions.browserActions.filter(
              (x) => x.extensionId === extensionId,
            );
            console.log(
              '[set-browserAction-info] global matched defaults',
              md.length,
              'tabActions',
              mt.length,
            );
            ipcRenderer.send(
              'crx-badge-debug',
              `RENDERER global action=${action} defaults=${md.length} tabActions=${mt.length}`,
            );
            md.forEach(handler);
            mt.forEach(handler);
          }
        },
      );
      ipcRenderer.send('load-extensions');
    }

    ipcRenderer.on("show-adblock-rule", (e, fullscreen: boolean) => {
      console.log("show-adblock-rule-2", this.adblockBtnRef);
      if (this.adblockBtnRef) {
        this.adblockBtnRef.click();
      }
    });

    if (!isImmersiveHeaderWindow()) {
      ipcRenderer.send('update-check');
    }

    // 沉浸悬浮头部标签同步:overlay 作为主渲染进程标签状态的实时镜像;
    // 主渲染进程作为快照来源 + 遥控指令执行者(单一数据源)。
    if (isImmersiveHeaderWindow()) {
      initImmersiveMirror(this);
    } else {
      initImmersiveSyncSource(this);
    }
  }
}

export default new Store();
