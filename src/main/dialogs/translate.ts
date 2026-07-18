import {BrowserWindow} from 'electron';
import {DIALOG_MARGIN_TOP, DIALOG_MARGIN} from '~/constants/design';
import {PersistentDialog} from './dialog';

const WIDTH = 220;
const HEIGHT = 300;

// 地址栏「翻译」图标下方的语言选择弹窗。独立 BrowserView,覆盖网页内容之上。
// 持久弹窗(启动预热),show 时 waitForLoad=false 立即定位。open 携带 {active,target}
// 让弹窗渲染当前态(已翻译时多出「显示原文」按钮)。
export class TranslateDialog extends PersistentDialog {
  private pos = {x: 0, y: 0};

  public constructor() {
    super({
      name: 'translate',
      bounds: {width: WIDTH, height: HEIGHT},
    });
  }

  public rearrange() {
    super.rearrange({
      x: this.pos.x - DIALOG_MARGIN,
      y: this.pos.y - DIALOG_MARGIN_TOP,
      width: WIDTH + 2 * DIALOG_MARGIN,
      height: HEIGHT + 2 * DIALOG_MARGIN,
    });
  }

  private onBoundsUpdate = () => this.hide();

  public async open(browserWindow: BrowserWindow, x: number, y: number, data?: any) {
    this.pos = {x, y};

    // 已预加载,waitForLoad=false:立即 addBrowserView + 定位,秒开
    await super.show(browserWindow, true, false);

    browserWindow.removeListener('resize', this.onBoundsUpdate);
    browserWindow.removeListener('move', this.onBoundsUpdate);
    browserWindow.on('resize', this.onBoundsUpdate);
    browserWindow.on('move', this.onBoundsUpdate);

    this.send('visible', true, data);
  }

  public hide(bringToTop = false) {
    super.hide(bringToTop);
    if (this.browserWindow) {
      this.browserWindow.removeListener('resize', this.onBoundsUpdate);
      this.browserWindow.removeListener('move', this.onBoundsUpdate);
    }
  }
}
