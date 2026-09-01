import {action, observable, computed, makeObservable, makeAutoObservable, reaction} from 'mobx';
import { createLocaleTranslator } from '~/common/i18n';

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
import {IDownloadItem, BrowserActionChangeType, IWorkspace, IWorkspaceSnapshot} from '~/interfaces';
import {IBrowserAction} from '../models';
import {IURLSegment} from '~/interfaces/urls';
import {BookmarkBarStore} from './bookmark-bar';
import {getWebUIURL} from "~/common/webui";
import {initImmersiveMirror, initImmersiveSyncSource} from './immersive-sync';
import {mergeChromeTheme, mixCssColors} from '~/common/chrome-theme';
import {notifyDualEngineSearch} from '../utils/dual-engine';

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

  // 外部请求打开的初始 URL(「在新窗口打开链接」等)。startup-tabs 优先开它。
  public initialUrl = ipcRenderer.sendSync(
    `get-initial-url-${this.windowId}`,
  );

  public restoreSessionWithInitialUrl = ipcRenderer.sendSync(
    `restore-session-with-initial-url-${this.windowId}`,
  );

  public workspaceContext: IWorkspace | null = ipcRenderer.sendSync(
    `get-workspace-context-${this.windowId}`,
  );

  public workspaceReady = false;

  // Observable
  public addressbarTextVisible = true;

  public addressbarFocused = false;

  // 空白新标签页加载完成后,页面 autofocus 会抢走地址栏焦点。主进程 view-loaded
  // 事件回传时据此重新聚焦(一次性:addTab 置位、view-loaded 消费)。
  public expectingNewTabFocus = false;

  public addressbarEditing = false;

  // 沉浸模式下搜索弹窗位于主窗口,地址栏视觉层位于悬浮窗;两者共享一次输入会话。
  public immersiveSearchActive = false;

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

  // 「正在清理浏览数据」全屏覆盖层,仅 exit 模式(关闭最后一个窗口的退出清理)使用。
  // 清理完成后由主进程销毁窗口,覆盖层随窗口一起消失;phase 用于显示当前阶段文案。
  public clearExitOverlay: {
    visible: boolean;
    mode: 'exit' | 'manual';
    phase: 'history' | 'searchHistory' | 'cache' | 'cookies' | 'finalize';
    percent: number;
    done: boolean;
  } = {
    visible: false,
    mode: 'exit',
    phase: 'history',
    percent: 0,
    done: false,
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

  // 沉浸头部是主窗口状态的镜像，不能自行改动会话数据；无痕和工作区也不应写入
  // 普通 startupTabs/tabGroups 数据库。将这条策略收口，避免各 Store 漏加守卫。
  public get canPersistNormalSession() {
    return (
      !isImmersiveHeaderWindow() &&
      !this.isIncognito &&
      !this.workspaceContext
    );
  }

  public get theme() {
    // 无痕窗口的整窗 UI(标题栏/工具栏/地址栏图标/标签)与 ThemeProvider 一样强制走深色主题。
    // 否则直接读 store.theme['toolbar.lightForeground'] 配色、并显式 autoInvert={false} 的图标
    // (前进/后退/刷新、主页、盾牌、翻译等)会按用户真实(浅色)主题算出近黑/灰色,在黑底上看不见。
    const base = getTheme(
      this.isIncognito
        ? 'wexond-dark'
        : this.settings.object.activeChromeTheme
        ? 'wexond-light'
        : this.settings.object.theme,
    );
    const merged = this.isIncognito
      ? base
      : mergeChromeTheme(base, this.settings.object.activeChromeTheme);
    if (!this.workspaceContext?.color || this.isIncognito) return merged;

    const accent = this.workspaceContext.color;
    return {
      ...merged,
      accentColor: accent,
      'titlebar.backgroundColor': mixCssColors(merged['titlebar.backgroundColor'], accent, merged.dark ? 0.28 : 0.16),
      'toolbar.backgroundColor': mixCssColors(merged['toolbar.backgroundColor'], accent, merged.dark ? 0.24 : 0.12),
      'toolbar.bottomLine.backgroundColor': mixCssColors(merged['toolbar.bottomLine.backgroundColor'], accent, merged.dark ? 0.32 : 0.2),
      'tab.selected.backgroundColor': mixCssColors(merged['tab.selected.backgroundColor'] || merged['toolbar.backgroundColor'], accent, merged.dark ? 0.3 : 0.16),
      'sidebar.backgroundColor': mixCssColors(merged['sidebar.backgroundColor'] || merged['titlebar.backgroundColor'], accent, merged.dark ? 0.22 : 0.12),
      'sidebar.tab.selectedBackgroundColor': mixCssColors(merged['sidebar.tab.selectedBackgroundColor'] || merged['toolbar.backgroundColor'], accent, merged.dark ? 0.3 : 0.16),
    };
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
      immersiveSearchActive: observable,
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
      clearExitOverlay: observable,
      workspaceContext: observable,
      workspaceReady: observable,
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

    ipcRenderer.on('workspace-context-updated', (_e, context: IWorkspace) => {
      if (context?.id === this.workspaceContext?.id) this.workspaceContext = context;
    });

    ipcRenderer.on('workspace-snapshot-request', (_e, requestId: string) => {
      ipcRenderer.send('workspace-snapshot-response', {
        requestId,
        snapshot: this.getWorkspaceSnapshot(),
      });
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

    // 「正在清理浏览数据」覆盖层:主进程驱动显示/进度/隐藏。
    ipcRenderer.on('clear-overlay-show', (e, data: {mode: 'exit' | 'manual'}) => {
      this.clearExitOverlay = {
        visible: true,
        mode: (data && data.mode) || 'exit',
        phase: 'history',
        percent: 0,
        done: false,
      };
    });

    ipcRenderer.on('clear-progress', (e, p: any) => {
      if (!p) return;
      this.clearExitOverlay = {
        ...this.clearExitOverlay,
        phase: p.phase || this.clearExitOverlay.phase,
        percent: typeof p.percent === 'number' ? p.percent : this.clearExitOverlay.percent,
        done: !!p.done,
      };
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

    ipcRenderer.on('immersive-header-search-active', (_e, active: boolean) => {
      this.immersiveSearchActive = !!active;
      if (this.immersiveSearchActive) {
        this.addressbarTextVisible = false;
        this.addressbarFocused = true;
        this.addressbarEditing = true;
        if (this.tabs.selectedTab) this.tabs.selectedTab.addressbarFocused = true;
      }
    });

    ipcRenderer.on('immersive-addressbar-preview', (_e, data) => {
      const tab = this.tabs.getTabById(data?.id);
      if (!tab) return;

      tab.addressbarValue = data.text || '';
      tab.addressbarSelectionRange = [data.selectionStart, data.selectionEnd];
      if (tab.isSelected && this.inputRef) {
        this.inputRef.value = tab.addressbarValue;
        const start = Number.isFinite(data.selectionStart)
          ? data.selectionStart
          : tab.addressbarValue.length;
        const end = Number.isFinite(data.selectionEnd)
          ? data.selectionEnd
          : start;
        this.inputRef.setSelectionRange(start, end);
      }
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
      this.immersiveSearchActive = false;
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
              // 沉浸头部可能在延迟执行前收起并卸载 AddressBar。
              // ref 已被 React 置空时只同步状态，不再操作失效的 DOM 节点。
              const input = this.inputRef;
              if (input) input.blur();
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
              if (this.inputRef) this.inputRef.select();
            });
          }
        }
      }
    });

    // 搜索弹层请求新建结果标签。双列模式要等标签建成后再绑定副面板，
    // 否则 selectedId 仍可能指向发起搜索的旧标签。
    ipcRenderer.on('search-open-new-tab', async (e, data: string | {
      url: string;
      dualQuery?: string;
    }) => {
      if (isImmersiveHeaderWindow()) return;
      const url = typeof data === 'string' ? data : data?.url;
      if (!url) return;
      const tab = await this.tabs.addTab({url, active: true});
      if (typeof data !== 'string' && data.dualQuery && tab) {
        notifyDualEngineSearch(data.dualQuery, tab.id);
      }
    });

    ipcRenderer.on('search-open-multi-tabs', (e, query: string) => {
      if (isImmersiveHeaderWindow()) return;
      this.openMultiSearchTabs(query);
    });

    ipcRenderer.on('pc-search-bridge-dual', (_e, data) => {
      if (isImmersiveHeaderWindow()) return;
      if (typeof data?.query !== 'string') return;
      notifyDualEngineSearch(data.query, Number(data.viewId) || undefined);
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

    if (this.workspaceContext && !isImmersiveHeaderWindow()) {
      reaction(
        () => this.workspaceReady ? JSON.stringify(this.getWorkspaceSnapshot()) : '',
        (snapshot) => {
          if (!snapshot) return;
          this.syncWorkspaceSnapshot(JSON.parse(snapshot) as IWorkspaceSnapshot);
        },
        { delay: 300 },
      );
      window.addEventListener('beforeunload', () => {
        this.syncWorkspaceSnapshot(this.getWorkspaceSnapshot());
      });
    }
  }

  private syncWorkspaceSnapshot(snapshot: IWorkspaceSnapshot) {
    if (!this.workspaceReady || !this.workspaceContext) return;
    // 标签水合前或关闭最后一个标签的瞬间可能出现空列表；浏览器会补出新标签页，
    // 因此不能用该短暂状态覆盖一个已有标签的工作区文档。
    if (!snapshot.tabs.length && this.workspaceContext.tabs.length) return;
    ipcRenderer.send('workspace-session-sync', {
      workspaceId: this.workspaceContext.id,
      snapshot,
    });
  }

  public getWorkspaceSnapshot(): IWorkspaceSnapshot {
    const groups = this.tabGroups.list.map((group) => ({
      key: group.workspaceKey || `group-${group.id}`,
      name: group.name,
      color: group.color,
      isPinned: group.isPinned,
    }));
    const groupKeys = new Map(this.tabGroups.list.map((group) => [group.id, group.workspaceKey || `group-${group.id}`]));
    const tabs = this.tabs.list
      .filter((tab) => !tab.isClosing)
      .map((tab, order) => ({
        key: tab.workspaceKey || `tab-${tab.id}`,
        url: tab.url,
        title: tab.title,
        favicon: tab.favicon,
        order,
        pinned: tab.isPinned,
        active: tab.isSelected,
        groupKey: groupKeys.get(tab.tabGroupId),
      }));
    return { tabs, groups };
  }

  public activateWorkspaceSync() {
    this.workspaceReady = true;
  }

  public async openMultiSearchTabs(query: string) {
    const value = (query || '').trim();
    if (!value) return;

    const configured = new Set(
      this.settings.object.efficiencySearchEngineKeywords || [],
    );
    let engines = (this.settings.object.searchEngines || []).filter(
      (engine) =>
        !!engine?.keyword && !!engine?.url && configured.has(engine.keyword),
    );

    // 被删除或损坏的配置不能让多开搜索静默失效。
    if (engines.length < 2) {
      engines = (this.settings.object.searchEngines || [])
        .filter((engine) => !!engine?.url)
        .slice(0, 2);
    }
    if (engines.length === 0) return;

    for (let index = 0; index < engines.length; index++) {
      const url = engines[index].url.replace(
        '%s',
        encodeURIComponent(value),
      );
      await this.tabs.addTab({url, active: index === 0});
    }
  }
}

const store = new Store();

export default store;

// 默认导出完成后再进入 TabsStore。外部页面立即开始加载;设置到达后仍由
// SettingsStore 按“分组 -> 会话标签”顺序完成正常恢复。
if (store.initialUrl) {
  void store.startupTabs.loadInitialUrl().catch((error) => {
    // load() 会继续走正常会话恢复,这里仅避免模块初始化产生未处理 Promise。
    console.error('[startup-tabs] failed to preload initial URL', error);
  });
}
