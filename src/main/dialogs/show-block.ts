import {BrowserWindow, ipcMain} from 'electron';
import {PersistentDialog} from './dialog';
import {DIALOG_MARGIN_TOP, DIALOG_MARGIN} from '~/constants/design';

const WIDTH = 396;
const HEIGHT = 360;

export class ShowBlockDialog extends PersistentDialog {
  private pos = {x: 0, y: 0};

  public constructor() {
    super({
      name: 'show-block',
      bounds: {
        width: WIDTH,
        height: HEIGHT,
      },
    });

    // 渲染层测量到真实内容高度后回报，重排弹窗
    const resizeChannel = `resize-dialog-${this.id}`;
    this.ipcChannels.push(resizeChannel);
    ipcMain.on(resizeChannel, (e, nextHeight: number) => {
      super.rearrange({height: nextHeight});
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

  public async open(
    browserWindow: BrowserWindow,
    x: number,
    y: number,
    data: {
      data: {url: string; filter: string}[];
      count: number;
      domain?: string;
      siteEnabled?: boolean;
    },
  ) {
    this.pos = {x, y};

    if (!(await super.show(browserWindow, true))) return;

    // 窗口移动/缩放时关闭弹窗（与原动态弹窗 onWindowBoundsUpdate 行为一致）
    browserWindow.removeListener('resize', this.onBoundsUpdate);
    browserWindow.removeListener('move', this.onBoundsUpdate);
    browserWindow.on('resize', this.onBoundsUpdate);
    browserWindow.on('move', this.onBoundsUpdate);

    // 数据随后下发：弹窗已可见，内容再渲染
    this.send('visible', true, data);
  }

  public hide(bringToTop = false, hideVisually = true) {
    super.hide(bringToTop, hideVisually);
    if (this.browserWindow) {
      this.browserWindow.removeListener('resize', this.onBoundsUpdate);
      this.browserWindow.removeListener('move', this.onBoundsUpdate);
    }
  }
}
