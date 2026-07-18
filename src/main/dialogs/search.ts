import { ipcMain, BrowserWindow, clipboard } from 'electron';
import {
  DIALOG_MIN_HEIGHT,
  DIALOG_MARGIN_TOP,
  DIALOG_MARGIN,
  TOOLBAR_HEIGHT,
} from '~/constants/design';
import { PersistentDialog } from './dialog';
import { Application } from '../application';
import { getViewMenu } from '../menus/extension-popup';

const WIDTH = 800;
const HEIGHT = 80;
const DEFAULT_SEARCH_BOX_HEIGHT = TOOLBAR_HEIGHT - 1;

export class SearchDialog extends PersistentDialog {
  private isPreviewVisible = false;
  private baseHeight = HEIGHT;

  public data: {
    text: string;
    x: number;
    y: number;
    width: number;
    cursorPos?: number;
    selectAll?: boolean;
    anchorHeight?: number;
    origin?: 'newtab';
    engineKeyword?: string;
    searchMode?: string;
    searchType?: string;
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

    ipcMain.on(`height-${this.id}`, (e, height) => {
      super.rearrange({
        height: this.isPreviewVisible
          ? Math.max(DIALOG_MIN_HEIGHT, this.baseHeight + height)
          : this.baseHeight + height,
      });
    });

    ipcMain.on(`addressbar-update-input-${this.id}`, (e, data) => {
      this.browserWindow.webContents.send('addressbar-update-input', data);
    });

    // 「新标签页搜索」:在所属应用窗口里新建标签页打开结果,而非加载到当前页。
    ipcMain.on(`search-open-new-tab-${this.id}`, (e, url: string) => {
      if (this.browserWindow && !this.browserWindow.isDestroyed()) {
        this.browserWindow.webContents.send('search-open-new-tab', url);
      }
    });

    // 地址栏建议点击「跳转」到已打开的标签页:定位其所属窗口并选中、聚焦。
    ipcMain.on('search-select-tab', (e, tabId: number) => {
      const appWindow = Application.instance.windows.findByBrowserView(tabId);
      if (!appWindow) return;
      appWindow.viewManager.select(tabId);
      if (!appWindow.win.isDestroyed()) {
        appWindow.win.focus();
      }
    });

    // 搜索弹窗的输入框默认不会弹出右键菜单(Electron 不自动显示),
    // 复用 extension-popup 的 getViewMenu:输入框命中 isEditable,展示标准的
    // 撤销/剪切/复制/粘贴/全选编辑菜单,与网页、扩展弹窗等其余界面一致。
    this.webContents.on('context-menu', (_e, params) => {
      getViewMenu(params, this.webContents).popup();
    });
  }

  public rearrange() {
    super.rearrange({
      x: this.data.x - DIALOG_MARGIN,
      y: this.data.y - DIALOG_MARGIN_TOP,
      width: this.data.width + 2 * DIALOG_MARGIN,
    });
  }

  private onResize = () => {
    this.hide();
  };

  public async show(browserWindow: BrowserWindow) {
    const anchorHeight = Number(this.data.anchorHeight);
    this.baseHeight = Number.isFinite(anchorHeight)
      ? HEIGHT + Math.max(0, anchorHeight - DEFAULT_SEARCH_BOX_HEIGHT)
      : HEIGHT;
    const appWindow = Application.instance.windows.fromBrowserWindow(
      browserWindow,
    );

    // 弹窗弹出时读一次剪贴板,随 visible 下发,渲染进程把它作为置顶建议项。
    this.data.clipboard = clipboard.readText();

    super.show(browserWindow, true, false);

    browserWindow.once('resize', this.onResize);

    this.send('visible', true, {
      id:
        appWindow?.viewManager.selectedId ||
        Application.instance.windows.current.viewManager.selectedId,
      ...this.data,
    });

    ipcMain.once('get-search-tabs', (e, tabs) => {
      this.send('search-tabs', tabs);
    });

    browserWindow.webContents.send('get-search-tabs');
  }

  public hide(bringToTop = false) {
    super.hide(bringToTop);
    // 复位「新标签页搜索」标记:该模式只在被气泡显式唤起时生效,关闭后即回归常态。
    this.data.openInNewTab = false;
    this.data.anchorHeight = undefined;
    this.data.origin = undefined;
    this.data.engineKeyword = undefined;
    this.data.searchMode = undefined;
    this.data.searchType = undefined;
    this.baseHeight = HEIGHT;
    if (this.browserWindow) {
      this.browserWindow.removeListener('resize', this.onResize);
    }
  }
}
