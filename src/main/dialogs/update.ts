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
    ipcMain.on(`resize-dialog-${this.id}`, (e, nextHeight: number) => {
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

    // 弹窗已在启动时预加载，waitForLoad=false：立即 addBrowserView+定位，秒开
    await super.show(browserWindow, true, false);

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
