import {BrowserWindow} from 'electron';
import {DIALOG_MARGIN_TOP, DIALOG_MARGIN} from '~/constants/design';
import {PersistentDialog} from './dialog';

const WIDTH = 380;
// 期望高度（内容较多时的上限）；实际高度会按窗口可用空间收敛，保证不被窗口裁切。
const MAX_HEIGHT = 760;
// 收敛后保留的底部留白
const BOTTOM_GAP = 16;

export class MenuDialog extends PersistentDialog {
  private pos = {x: 0, y: 0};

  public constructor() {
    super({
      name: 'menu',
      bounds: {
        width: WIDTH,
        height: MAX_HEIGHT,
      },
    });
  }

  // 弹窗高度 = min(期望上限, 按钮下方到窗口底部的可用空间)。
  // 每次重排都按「当前窗口尺寸」重新计算，避免沿用上一次(小窗口)的高度。
  private clampHeight() {
    const top = this.pos.y - DIALOG_MARGIN_TOP;
    let available = MAX_HEIGHT;
    if (this.browserWindow) {
      const winBounds = this.browserWindow.getContentBounds();
      available = winBounds.height - top - BOTTOM_GAP;
    }
    return Math.max(320, Math.min(MAX_HEIGHT, available));
  }

  public rearrange() {
    super.rearrange({
      x: this.pos.x - WIDTH + DIALOG_MARGIN,
      y: this.pos.y - DIALOG_MARGIN_TOP,
      width: WIDTH,
      height: this.clampHeight(),
    });
  }

  private onBoundsUpdate = () => this.hide();

  public async open(browserWindow: BrowserWindow, x: number, y: number) {
    this.pos = {x, y};

    if (!(await super.show(browserWindow, true))) return;

    browserWindow.removeListener('resize', this.onBoundsUpdate);
    browserWindow.removeListener('move', this.onBoundsUpdate);
    browserWindow.on('resize', this.onBoundsUpdate);
    browserWindow.on('move', this.onBoundsUpdate);

    // 通知渲染层刷新每次显示需更新的状态（alwaysOnTop / updateAvailable）
    this.send('visible', true, {
      alwaysOnTop: browserWindow.isAlwaysOnTop(),
    });
  }

  public hide(bringToTop = false, hideVisually = true) {
    super.hide(bringToTop, hideVisually);
    if (this.browserWindow) {
      this.browserWindow.removeListener('resize', this.onBoundsUpdate);
      this.browserWindow.removeListener('move', this.onBoundsUpdate);
    }
  }
}
