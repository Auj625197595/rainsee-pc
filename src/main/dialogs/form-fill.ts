import { BrowserWindow, ipcMain } from 'electron';
import { DIALOG_MARGIN, DIALOG_MARGIN_TOP } from '~/constants/design';
import { IFormFillMenuItem } from '~/interfaces';
import { PersistentDialog } from './dialog';

const WIDTH = 310;
const HEIGHT = 216;
const HOVER_HIDE_DELAY = 160;

export class FormFillDialog extends PersistentDialog {
  private pos = { x: 0, y: 0 };
  private hoverHideTimer: NodeJS.Timeout | null = null;

  public constructor() {
    super({
      name: 'form-fill',
      bounds: { width: WIDTH, height: HEIGHT },
    });

    const enterChannel = `autofill-popup-hover-enter-${this.id}`;
    const leaveChannel = `autofill-popup-hover-leave-${this.id}`;
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
    super.rearrange({
      x: this.pos.x - WIDTH + DIALOG_MARGIN,
      y: this.pos.y - DIALOG_MARGIN_TOP,
      width: WIDTH,
      height: HEIGHT,
    });
  }

  private onBoundsUpdate = () => this.hide();

  public async open(
    browserWindow: BrowserWindow,
    x: number,
    y: number,
    items: IFormFillMenuItem[],
  ) {
    this.cancelHoverHide();
    this.pos = { x, y };

    if (!(await super.show(browserWindow, true))) return;

    browserWindow.removeListener('resize', this.onBoundsUpdate);
    browserWindow.removeListener('move', this.onBoundsUpdate);
    browserWindow.on('resize', this.onBoundsUpdate);
    browserWindow.on('move', this.onBoundsUpdate);

    this.send('visible', true, items);
  }

  public hide(bringToTop = false, hideVisually = true) {
    this.cancelHoverHide();
    super.hide(bringToTop, hideVisually);
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
