import {BrowserWindow} from 'electron';
import {DIALOG_MARGIN_TOP, DIALOG_MARGIN} from '~/constants/design';
import {PersistentDialog} from './dialog';

const WIDTH = 340;
const HEIGHT = 286;

// 地址栏 PWA 安装图标下方的安装确认弹窗(Edge 风格)。独立 BrowserView 浮层,
// 显示应用图标 + 名称 + 发布者 + 安装选项(桌面/开始菜单快捷方式)+ 安装/取消。
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

    // waitForLoad 动态:已加载(条件预热过或上次未销毁)则秒开;未加载则等 dom-ready
    // 避免白屏闪现。
    await super.show(browserWindow, true, this.isLoaded ? false : true);

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
