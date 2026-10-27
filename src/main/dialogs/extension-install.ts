import { BrowserWindow, ipcMain } from 'electron';
import { DIALOG_MARGIN, DIALOG_MARGIN_TOP } from '~/constants/design';
import {
  ExtensionInstallDecision,
  IExtensionInstallDialogData,
  IExtensionInstallPreview,
} from '~/interfaces';
import { PersistentDialog, getAppContentBounds } from './dialog';
import { Application } from '../application';

// 内容宽度(不含 DialogStyle 的阴影外边距)。高度由渲染层按内容回报。
const CONFIRM_WIDTH = 400;
const INSTALLED_WIDTH = 340;
const INITIAL_HEIGHT = 240;
const MAX_HEIGHT = 560;
// 安装完成气泡无操作时自动收起,与 Chrome 的提示气泡一致不常驻。
const INSTALLED_AUTO_HIDE_MS = 10_000;

interface IConfirmRequest {
  browserWindow: BrowserWindow;
  preview: IExtensionInstallPreview;
  resolve: (decision: ExtensionInstallDecision) => void;
}

// 下载 .crx 完成后的「添加扩展程序」确认弹窗 + 安装完成气泡(Chrome 风格)。
// 同一 BrowserView 两种模式:confirm 串行排队,结果经 Promise 回给安装流程;
// installed 为一次性提示,锚定工具栏扩展按钮,点外部/超时收起。
export class ExtensionInstallDialog extends PersistentDialog {
  private queue: IConfirmRequest[] = [];
  private current: IConfirmRequest | null = null;
  private mode: 'confirm' | 'installed' = 'confirm';
  private contentHeight = INITIAL_HEIGHT;
  // installed 模式锚点:扩展图标中心 x、底边 y(窗口内容坐标)。
  private anchor = { x: 0, y: 0 };
  private autoHideTimer: NodeJS.Timeout | null = null;

  public constructor() {
    super({
      name: 'extension-install',
      bounds: {
        width: CONFIRM_WIDTH + 2 * DIALOG_MARGIN,
        height: INITIAL_HEIGHT,
      },
    });

    const resizeChannel = `resize-dialog-${this.id}`;
    const resultChannel = `extension-install-result-${this.id}`;
    this.ipcChannels.push(resizeChannel, resultChannel);

    ipcMain.on(resizeChannel, (_e, height: number) => {
      if (!Number.isFinite(height) || height <= 0) return;
      this.contentHeight = Math.min(MAX_HEIGHT, Math.ceil(height));
      this.rearrange();
    });

    // 渲染层「添加扩展程序」/「替换」/「取消」/Esc/关闭按钮。installed 模式只会发 false(关闭)。
    ipcMain.on(resultChannel, (_e, decision: ExtensionInstallDecision) => {
      if (this.mode === 'confirm') {
        this.finishCurrent(decision === 'replace' ? 'replace' : !!decision);
      } else {
        this.closeInstalled();
      }
    });
  }

  public confirm(
    browserWindow: BrowserWindow,
    preview: IExtensionInstallPreview,
  ): Promise<ExtensionInstallDecision> {
    return new Promise((resolve) => {
      this.queue.push({ browserWindow, preview, resolve });
      void this.showNext();
    });
  }

  public async showInstalled(
    browserWindow: BrowserWindow,
    preview: IExtensionInstallPreview,
    anchorX: number,
    anchorY: number,
  ) {
    // 确认流程优先:还有待确认的安装时不弹完成气泡,避免顶掉确认框。
    if (this.current || this.queue.length) return;
    if (browserWindow.isDestroyed()) return;

    this.clearAutoHide();
    this.mode = 'installed';
    this.anchor = { x: anchorX, y: anchorY };
    this.contentHeight = 170;
    if (!(await super.show(browserWindow, true))) return;
    // show 等冷加载期间确认框可能已插队。
    if (this.mode !== 'installed') return;
    this.attachWindowListeners(browserWindow);
    this.rearrange();
    const data: IExtensionInstallDialogData = { mode: 'installed', preview };
    this.send('visible', true, { ...data, arrowRight: this.arrowRight() });
    this.autoHideTimer = setTimeout(
      () => this.closeInstalled(),
      INSTALLED_AUTO_HIDE_MS,
    );
  }

  public rearrange() {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return;
    // 渲染层回报的高度已包含卡片外边距(及气泡箭头留白)。
    const viewHeight = this.contentHeight;
    const { width: winWidth } = this.browserWindow.getContentBounds();

    if (this.mode === 'installed') {
      const viewWidth = INSTALLED_WIDTH + 2 * DIALOG_MARGIN;
      super.rearrange({
        x: this.installedX(viewWidth, winWidth),
        // 气泡卡片 margin-top 为 10px 箭头留白,箭头尖正好落在锚点下方。
        y: Math.max(0, Math.round(this.anchor.y + 2)),
        width: viewWidth,
        height: viewHeight,
      });
      return;
    }

    // 确认框:水平居中,紧贴工具栏下沿(Chrome 的 tab-modal 位置)。
    const viewWidth = CONFIRM_WIDTH + 2 * DIALOG_MARGIN;
    const appWindow = Application.instance.windows.list.find(
      (w) => w?.win === this.browserWindow,
    );
    const content = getAppContentBounds(this.browserWindow, appWindow);
    super.rearrange({
      x: Math.max(0, Math.round((winWidth - viewWidth) / 2)),
      y: Math.max(0, Math.round(content.y + 8 - DIALOG_MARGIN_TOP)),
      width: viewWidth,
      height: viewHeight,
    });
  }

  // 外部关闭(点网页/切标签触发 hideAllPersistent)不等于用户取消:确认框保持
  // tab-modal 语义,等内容 view 重新挂到顶层后再把弹窗提回最上层。
  public hide(bringToTop = false, hideVisually = true) {
    if (this.current && this.mode === 'confirm') {
      const win = this.current.browserWindow;
      if (win.isDestroyed()) {
        this.finishCurrent(false);
        return;
      }
      setTimeout(() => {
        if (this.current && this.visible && !win.isDestroyed()) {
          this.bringToTop();
          this.webContents.focus();
        }
      }, 0);
      return;
    }
    this.clearAutoHide();
    this.detachWindowListeners();
    super.hide(bringToTop, hideVisually);
  }

  private installedX(viewWidth: number, winWidth: number) {
    // 气泡右侧对齐图标,箭头指向图标中心;窗口过窄时夹紧在可视区内。
    const preferred = Math.round(this.anchor.x + 28 - viewWidth + DIALOG_MARGIN);
    return Math.max(0, Math.min(preferred, winWidth - viewWidth));
  }

  // 箭头相对气泡内容右边缘的距离(px),供渲染层定位小三角。
  private arrowRight() {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return 28;
    const viewWidth = INSTALLED_WIDTH + 2 * DIALOG_MARGIN;
    const { width: winWidth } = this.browserWindow.getContentBounds();
    const x = this.installedX(viewWidth, winWidth);
    const contentRight = x + viewWidth - DIALOG_MARGIN;
    return Math.max(16, Math.min(INSTALLED_WIDTH - 16, contentRight - this.anchor.x));
  }

  private closeInstalled() {
    if (this.mode !== 'installed') return;
    this.clearAutoHide();
    this.detachWindowListeners();
    super.hide(false, true);
  }

  private clearAutoHide() {
    if (this.autoHideTimer) clearTimeout(this.autoHideTimer);
    this.autoHideTimer = null;
  }

  private onWindowResize = () => {
    if (this.mode === 'installed') this.closeInstalled();
    else this.rearrange();
  };

  private onWindowClosed = () => {
    if (this.current) this.finishCurrent(false);
  };

  private attachWindowListeners(win: BrowserWindow) {
    this.detachWindowListeners();
    win.on('resize', this.onWindowResize);
    win.once('closed', this.onWindowClosed);
  }

  private detachWindowListeners() {
    const win = this.browserWindow;
    if (!win || win.isDestroyed()) return;
    win.removeListener('resize', this.onWindowResize);
    win.removeListener('closed', this.onWindowClosed);
  }

  private async showNext() {
    if (this.current) return;
    const next = this.queue.shift();
    if (!next) return;
    if (next.browserWindow.isDestroyed()) {
      next.resolve(false);
      void this.showNext();
      return;
    }

    // 若完成气泡还开着,直接切换为确认模式。
    this.clearAutoHide();
    this.current = next;
    this.mode = 'confirm';
    this.contentHeight = INITIAL_HEIGHT;
    try {
      if (!(await super.show(next.browserWindow, true))) {
        this.finishCurrent(false);
        return;
      }
      this.attachWindowListeners(next.browserWindow);
      this.rearrange();
      const data: IExtensionInstallDialogData = {
        mode: 'confirm',
        preview: next.preview,
      };
      this.send('visible', true, data);
    } catch {
      this.finishCurrent(false);
    }
  }

  private finishCurrent(decision: ExtensionInstallDecision) {
    const current = this.current;
    if (!current) return;
    this.current = null;
    this.detachWindowListeners();
    super.hide(false, true);
    current.resolve(decision);
    setTimeout(() => void this.showNext(), 0);
  }
}
