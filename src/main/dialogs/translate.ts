import {BrowserWindow, ipcMain} from 'electron';
import {DIALOG_MARGIN_TOP, DIALOG_MARGIN} from '~/constants/design';
import {PersistentDialog} from './dialog';

const WIDTH = 300;
const HEIGHT = 388;
const HOVER_HIDE_DELAY = 160;

// 地址栏「翻译」图标下方的语言选择弹窗。独立 BrowserView,覆盖网页内容之上。
// 持久弹窗,用户打开时才创建。open 携带 {active,target}
// 让弹窗渲染当前态(已翻译时多出「显示原文」按钮)。
export class TranslateDialog extends PersistentDialog {
  private pos = {x: 0, y: 0};
  private hoverHideTimer: NodeJS.Timeout | null = null;

  public constructor() {
    super({
      name: 'translate',
      bounds: {width: WIDTH, height: HEIGHT},
    });

    const enterChannel = `translate-popup-hover-enter-${this.id}`;
    const leaveChannel = `translate-popup-hover-leave-${this.id}`;
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
      x: this.pos.x - DIALOG_MARGIN,
      y: this.pos.y - DIALOG_MARGIN_TOP,
      width: WIDTH + 2 * DIALOG_MARGIN,
      height: HEIGHT + 2 * DIALOG_MARGIN,
    });
  }

  private onBoundsUpdate = () => this.hide();

  public async open(browserWindow: BrowserWindow, x: number, y: number, data?: any) {
    this.cancelHoverHide();
    this.pos = {x, y};

    if (!(await super.show(browserWindow, true))) return;

    browserWindow.removeListener('resize', this.onBoundsUpdate);
    browserWindow.removeListener('move', this.onBoundsUpdate);
    browserWindow.on('resize', this.onBoundsUpdate);
    browserWindow.on('move', this.onBoundsUpdate);

    this.send('visible', true, data);
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
