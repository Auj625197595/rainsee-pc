import { BrowserWindow, ipcMain } from 'electron';
import { DIALOG_MARGIN, DIALOG_MARGIN_TOP } from '~/constants/design';
import { PersistentDialog } from './dialog';

const WIDTH = 360;
const HEIGHT = 560;
const HOVER_HIDE_DELAY = 180;

// 地址栏历史/书签悬停列表。使用独立 BrowserView,避免弹窗进入网页区域后被内容页盖住。
export class HistoryBookmarksDialog extends PersistentDialog {
  private pos = { x: 0, y: 0 };
  private hoverHideTimer: NodeJS.Timeout | null = null;

  public constructor() {
    super({
      name: 'history-bookmarks-popup',
      bounds: { width: WIDTH, height: HEIGHT },
    });
    const enterChannel = `history-bookmarks-popup-hover-enter-${this.id}`;
    const leaveChannel = `history-bookmarks-popup-hover-leave-${this.id}`;
    this.ipcChannels.push(enterChannel, leaveChannel);
    ipcMain.on(enterChannel, this.cancelHoverHide);
    ipcMain.on(leaveChannel, this.scheduleHoverHide);
  }

  public cancelHoverHide = () => {
    if (this.hoverHideTimer) {
      clearTimeout(this.hoverHideTimer);
      this.hoverHideTimer = null;
    }
  };

  public scheduleHoverHide = () => {
    this.cancelHoverHide();
    if (!this.visible) return;
    this.hoverHideTimer = setTimeout(() => {
      this.hoverHideTimer = null;
      this.hide();
    }, HOVER_HIDE_DELAY);
  };

  public rearrange() {
    const win = this.browserWindow;
    const bounds = win?.getContentBounds();
    const maxX = Math.max(0, (bounds?.width || WIDTH) - WIDTH - DIALOG_MARGIN);
    const maxY = Math.max(
      0,
      (bounds?.height || HEIGHT) - HEIGHT - DIALOG_MARGIN,
    );
    const x = Math.max(0, Math.min(this.pos.x - WIDTH - DIALOG_MARGIN, maxX));
    const y = Math.max(0, Math.min(this.pos.y - DIALOG_MARGIN_TOP, maxY));
    super.rearrange({
      x,
      y,
      width: WIDTH + DIALOG_MARGIN * 2,
      height: HEIGHT + DIALOG_MARGIN + DIALOG_MARGIN_TOP,
    });
  }

  private onBoundsUpdate = () => this.hide();

  public async open(
    browserWindow: BrowserWindow,
    x: number,
    y: number,
    kind: 'history' | 'bookmarks',
  ) {
    this.cancelHoverHide();
    this.pos = { x, y };
    if (!(await super.show(browserWindow, true))) return;
    browserWindow.removeListener('resize', this.onBoundsUpdate);
    browserWindow.removeListener('move', this.onBoundsUpdate);
    browserWindow.on('resize', this.onBoundsUpdate);
    browserWindow.on('move', this.onBoundsUpdate);
    this.send('visible', true, { kind });
  }

  public hide(bringToTop = false) {
    this.cancelHoverHide();
    super.hide(bringToTop);
    if (this.browserWindow) {
      this.browserWindow.removeListener('resize', this.onBoundsUpdate);
      this.browserWindow.removeListener('move', this.onBoundsUpdate);
    }
  }

  public destroy() {
    this.cancelHoverHide();
    super.destroy();
  }
}
