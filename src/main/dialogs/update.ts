import { BrowserWindow, ipcMain } from 'electron';
import { PersistentDialog } from './dialog';
import { DIALOG_MARGIN_TOP, DIALOG_MARGIN } from '~/constants/design';

const WIDTH = 420;
const HEIGHT = 460;

export class UpdateDialog extends PersistentDialog {
  private pos = { x: 0, y: 0 };

  public constructor() {
    super({
      name: 'update',
      bounds: {
        width: WIDTH,
        height: HEIGHT,
      },
    });

    // 渲染层测量到真实内容高度后回报，重排弹窗
    const resizeChannel = `resize-dialog-${this.id}`;
    this.ipcChannels.push(resizeChannel);
    ipcMain.on(resizeChannel, (e, nextHeight: number) => {
      super.rearrange({ height: nextHeight });
    });
  }

  public rearrange() {
    super.rearrange({
      x: this.pos.x - WIDTH + DIALOG_MARGIN,
      y: this.pos.y - DIALOG_MARGIN_TOP,
      width: WIDTH,
    });
  }

  private onBoundsUpdate = () => this.hide();

  public async open(browserWindow: BrowserWindow, x: number, y: number) {
    this.pos = { x, y };

    if (!(await super.show(browserWindow, true))) return;

    browserWindow.removeListener('resize', this.onBoundsUpdate);
    browserWindow.removeListener('move', this.onBoundsUpdate);
    browserWindow.on('resize', this.onBoundsUpdate);
    browserWindow.on('move', this.onBoundsUpdate);

    this.send('visible', true);
  }

  public hide(bringToTop = false, hideVisually = true) {
    super.hide(bringToTop, hideVisually);
    if (this.browserWindow) {
      this.browserWindow.removeListener('resize', this.onBoundsUpdate);
      this.browserWindow.removeListener('move', this.onBoundsUpdate);
    }
  }
}
