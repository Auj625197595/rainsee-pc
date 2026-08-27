import {BrowserWindow} from 'electron';
import {DIALOG_MARGIN_TOP, DIALOG_MARGIN} from '~/constants/design';
import {PersistentDialog} from './dialog';

const WIDTH = 340;
const HEIGHT = 286;

// PWA 安装与小号快捷方式共用的确认弹窗。独立 BrowserView 浮层,
// 显示图标 + 名称 + 发布者 + 添加位置(桌面/开始菜单)+ 确认/取消。
// open 携带 {name,publisher,iconUrl,startUrl,themeColor,installed} 渲染当前态。
export class InstallAppDialog extends PersistentDialog {
  private pos = {x: 0, y: 0};

  public constructor() {
    super({
      name: 'install-app',
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

    if (!(await super.show(browserWindow, true))) return;

    browserWindow.removeListener('resize', this.onBoundsUpdate);
    browserWindow.removeListener('move', this.onBoundsUpdate);
    browserWindow.on('resize', this.onBoundsUpdate);
    browserWindow.on('move', this.onBoundsUpdate);

    this.send('visible', true, data);
  }

  // QuickMenu/profile actions have no address-bar element to anchor to. Use
  // BrowserView coordinates (relative to the content area), not screen-space
  // BrowserWindow bounds, and center the complete dialog including margins.
  public openCentered(browserWindow: BrowserWindow, data?: any) {
    const {width} = browserWindow.getContentBounds();
    const x = Math.max(DIALOG_MARGIN, Math.round((width - WIDTH) / 2));
    return this.open(browserWindow, x, 90, data);
  }

  public hide(bringToTop = false) {
    super.hide(bringToTop);
    if (this.browserWindow) {
      this.browserWindow.removeListener('resize', this.onBoundsUpdate);
      this.browserWindow.removeListener('move', this.onBoundsUpdate);
    }
  }
}
