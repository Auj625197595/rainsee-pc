import { ipcMain, BrowserWindow, clipboard, MenuItem } from 'electron';
import {
  DIALOG_MIN_HEIGHT,
  DIALOG_MARGIN_TOP,
  DIALOG_MARGIN,
  TOOLBAR_HEIGHT,
} from '~/constants/design';
import { PersistentDialog } from './dialog';
import { Application } from '../application';
import { getMainTranslator } from '../i18n';
import { getViewMenu } from '../menus/extension-popup';

const WIDTH = 800;
const HEIGHT = 80;
const DEFAULT_SEARCH_BOX_HEIGHT = TOOLBAR_HEIGHT - 1;

export class SearchDialog extends PersistentDialog {
  private isPreviewVisible = false;
  private baseHeight = HEIGHT;
  private pendingTabRequests = new Map<
    string,
    {
      senderId: number;
      resolve: (tabs: any[]) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private bridgeResultHandlers = new Map<
    string,
    { callback: (payload: any) => void; timer: NodeJS.Timeout }
  >();
  private bridgeActionHandlers = new Map<
    string,
    { resolve: (payload: any) => void; timer: NodeJS.Timeout }
  >();

  public data: {
    text: string;
    x: number;
    y: number;
    width: number;
    cursorPos?: number;
    selectAll?: boolean;
    suppressAutocomplete?: boolean;
    anchorHeight?: number;
    origin?: 'newtab';
    engineKeyword?: string;
    searchMode?: string;
    searchType?: string;
    immersive?: boolean;
    immersiveHeaderBottom?: number;
    // 弹窗弹出时读取的剪贴板纯文本,作为置顶「前往/搜索」建议项下发。
    clipboard?: string;
    // 「新标签页搜索」气泡透传:为 true 时结果在新标签页打开。
    // hide() 时复位,避免 Ctrl+L 等直接 .show() 的入口继承上一次气泡状态。
    openInNewTab?: boolean;
  } = {
    text: '',
    x: 0,
    y: 0,
    width: 200,
    clipboard: '',
    openInNewTab: false,
  };

  public constructor() {
    super({
      name: 'search',
      bounds: {
        width: WIDTH,
        height: HEIGHT,
        y: 48,
      },

      devtools: false,
    });

    const heightChannel = `height-${this.id}`;
    const updateInputChannel = `addressbar-update-input-${this.id}`;
    const tabResponseChannel = 'search-tabs-response';
    const bridgeResultChannel = 'pc-search-bridge-result';
    const bridgeActionResultChannel = 'pc-search-bridge-action-result';
    const immersivePreviewChannel = `immersive-addressbar-preview-${this.id}`;
    const openNewTabChannel = `search-open-new-tab-${this.id}`;
    const openMultiTabsChannel = `search-open-multi-tabs-${this.id}`;
    const selectTabChannel = 'search-select-tab';
    this.ipcChannels.push(
      heightChannel,
      updateInputChannel,
      tabResponseChannel,
      bridgeResultChannel,
      bridgeActionResultChannel,
      immersivePreviewChannel,
      openNewTabChannel,
      openMultiTabsChannel,
      selectTabChannel,
    );

    ipcMain.on(heightChannel, (e, height) => {
      super.rearrange({
        height: this.isPreviewVisible
          ? Math.max(DIALOG_MIN_HEIGHT, this.baseHeight + height)
          : this.baseHeight + height,
      });
    });

    ipcMain.on(updateInputChannel, (e, data) => {
      const appWindow = this.browserWindow
        ? Application.instance.windows.fromBrowserWindow(this.browserWindow)
        : undefined;
      if (appWindow) appWindow.send('addressbar-update-input', data);
      else this.browserWindow?.webContents.send('addressbar-update-input', data);
    });

    ipcMain.on(tabResponseChannel, (event, payload) => {
      const requestId = String(payload?.requestId || '');
      const pending = this.pendingTabRequests.get(requestId);
      if (!pending || event.sender.id !== pending.senderId) return;
      clearTimeout(pending.timer);
      this.pendingTabRequests.delete(requestId);
      pending.resolve(Array.isArray(payload.tabs) ? payload.tabs : []);
    });

    ipcMain.on(bridgeResultChannel, (event, payload) => {
      if (event.sender !== this.webContents) return;
      const bridgeId = String(payload?.bridgeId || '');
      const pending = this.bridgeResultHandlers.get(bridgeId);
      if (!pending) return;
      pending.callback(payload);
      if (Number(payload?.revision) >= 1) {
        clearTimeout(pending.timer);
        this.bridgeResultHandlers.delete(bridgeId);
      }
    });

    ipcMain.on(bridgeActionResultChannel, (event, payload) => {
      if (event.sender !== this.webContents) return;
      const bridgeId = String(payload?.bridgeId || '');
      const pending = this.bridgeActionHandlers.get(bridgeId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.bridgeActionHandlers.delete(bridgeId);
      pending.resolve(payload);
    });

    ipcMain.on(immersivePreviewChannel, (_e, data) => {
      if (!this.data.immersive || !this.browserWindow) return;
      const appWindow = Application.instance.windows.fromBrowserWindow(
        this.browserWindow,
      );
      appWindow?.send('immersive-addressbar-preview', data);
    });

    // 「新标签页搜索」:在所属应用窗口里新建标签页打开结果,而非加载到当前页。
    ipcMain.on(openNewTabChannel, (e, data) => {
      if (this.browserWindow && !this.browserWindow.isDestroyed()) {
        this.browserWindow.webContents.send('search-open-new-tab', data);
      }
    });

    ipcMain.on(openMultiTabsChannel, (e, query: string) => {
      if (this.browserWindow && !this.browserWindow.isDestroyed()) {
        this.browserWindow.webContents.send('search-open-multi-tabs', query);
      }
    });

    // 地址栏建议点击「跳转」到已打开的标签页:交给所属窗口的标签 Store 选中。
    // 不能直接调用 viewManager.select():那会绕过 renderer 的 selectedTabId 等状态，
    // 且内存节省后的占位标签尚无 BrowserView，findByBrowserView 无法定位。
    ipcMain.on(selectTabChannel, (e, tabId: number) => {
      const { windows } = Application.instance;
      const dialogWindow = this.browserWindow
        ? windows.fromBrowserWindow(this.browserWindow)
        : undefined;
      const appWindow = windows.findByBrowserView(tabId) || dialogWindow;
      if (!appWindow) return;
      appWindow.webContents.send('search-select-tab', tabId);
      if (!appWindow.win.isDestroyed()) {
        appWindow.win.focus();
      }
    });

    // 搜索弹窗的输入框默认不会弹出右键菜单(Electron 不自动显示),
    // 复用 extension-popup 的 getViewMenu:输入框命中 isEditable,展示标准的
    // 撤销/剪切/复制/粘贴/全选编辑菜单,与网页、扩展弹窗等其余界面一致。
    this.webContents.on('context-menu', (_e, params) => {
      const t = getMainTranslator(
        Application.instance.settings?.object?.language,
      );
      const menu = getViewMenu(params, this.webContents);

      if (params.isEditable) {
        const pasteIndex = menu.items.findIndex(
          (item) => item.label === t('menuPaste'),
        );
        menu.insert(
          pasteIndex >= 0 ? pasteIndex + 1 : menu.items.length,
          new MenuItem({
            label: t('ctxPasteSearch'),
            enabled: !!clipboard.readText().trim(),
            click: () => this.webContents.send('search-paste-and-search'),
          }),
        );
      }

      menu.popup();
    });
  }

  public rearrange() {
    const anchorHeight = Number(this.data.anchorHeight);
    const headerBottom = Number(this.data.immersiveHeaderBottom);
    const y =
      this.data.immersive && Number.isFinite(anchorHeight)
        ? Math.max(
            this.data.y + anchorHeight,
            Number.isFinite(headerBottom) ? headerBottom : 0,
          ) + DIALOG_MARGIN_TOP
        : this.data.y - DIALOG_MARGIN_TOP;

    super.rearrange({
      x: this.data.x - DIALOG_MARGIN,
      y,
      width: this.data.width + 2 * DIALOG_MARGIN,
    });
  }

  private onResize = () => {
    this.hide();
  };

  public async show(browserWindow: BrowserWindow) {
    const anchorHeight = Number(this.data.anchorHeight);
    this.baseHeight = this.data.immersive
      ? Math.max(
          1,
          HEIGHT -
            (Number.isFinite(anchorHeight)
              ? Math.max(0, anchorHeight)
              : DEFAULT_SEARCH_BOX_HEIGHT),
        )
      : Number.isFinite(anchorHeight)
      ? HEIGHT + Math.max(0, anchorHeight - DEFAULT_SEARCH_BOX_HEIGHT)
      : HEIGHT;
    const appWindow = Application.instance.windows.fromBrowserWindow(
      browserWindow,
    );

    appWindow?.send(
      'immersive-header-search-active',
      !!this.data.immersive,
    );

    // 弹窗弹出时读一次剪贴板,随 visible 下发,渲染进程把它作为置顶建议项。
    this.data.clipboard = clipboard.readText();

    if (!(await super.show(browserWindow, true))) return;

    browserWindow.once('resize', this.onResize);

    this.send('visible', true, {
      id:
        appWindow?.viewManager.selectedId ||
        Application.instance.windows.current.viewManager.selectedId,
      ...this.data,
    });

    void this.requestTabs(browserWindow).then((tabs) => {
      this.send('search-tabs', tabs);
    });
  }

  public requestTabs(browserWindow: BrowserWindow): Promise<any[]> {
    const appWindow = Application.instance.windows.fromBrowserWindow(
      browserWindow,
    );
    if (!appWindow) return Promise.resolve([]);

    const requestId = `search-tabs-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingTabRequests.delete(requestId);
        resolve([]);
      }, 1200);
      this.pendingTabRequests.set(requestId, {
        senderId: appWindow.webContents.id,
        resolve,
        timer,
      });
      appWindow.send('search-tabs-request', requestId);
    });
  }

  public requestBridgeSuggestions(
    payload: any,
    callback: (result: any) => void,
  ) {
    const bridgeId = String(payload?.bridgeId || '');
    if (!bridgeId) return;

    const existing = this.bridgeResultHandlers.get(bridgeId);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.bridgeResultHandlers.delete(bridgeId);
    }, 5000);
    this.bridgeResultHandlers.set(bridgeId, { callback, timer });
    this.send('pc-search-bridge-query', payload);
  }

  public requestBridgeAction(payload: any): Promise<any> {
    const bridgeId = String(payload?.bridgeId || '');
    if (!bridgeId) return Promise.resolve({ ok: false });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.bridgeActionHandlers.delete(bridgeId);
        resolve({ bridgeId, ok: false });
      }, 1500);
      this.bridgeActionHandlers.set(bridgeId, { resolve, timer });
      this.send('pc-search-bridge-action', payload);
    });
  }

  public hide(bringToTop = false) {
    const wasImmersive = !!this.data.immersive;
    const appWindow = this.browserWindow
      ? Application.instance.windows.fromBrowserWindow(this.browserWindow)
      : undefined;
    super.hide(bringToTop);
    if (wasImmersive) {
      appWindow?.send('immersive-header-search-active', false);
    }
    // 复位「新标签页搜索」标记:该模式只在被气泡显式唤起时生效,关闭后即回归常态。
    this.data.openInNewTab = false;
    this.data.suppressAutocomplete = undefined;
    this.data.anchorHeight = undefined;
    this.data.origin = undefined;
    this.data.engineKeyword = undefined;
    this.data.searchMode = undefined;
    this.data.searchType = undefined;
    this.data.immersive = false;
    this.data.immersiveHeaderBottom = undefined;
    this.baseHeight = HEIGHT;
    if (this.browserWindow) {
      this.browserWindow.removeListener('resize', this.onResize);
    }
  }
}
