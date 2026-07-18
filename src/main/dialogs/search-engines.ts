import { BrowserWindow } from 'electron';
import { DIALOG_MARGIN_TOP, DIALOG_MARGIN } from '~/constants/design';
import { PersistentDialog } from './dialog';
import { Application } from '../application';

const WIDTH = 240;
const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 34;
const V_PADDING = 12;
const MAX_HEIGHT = 420;

// 地址栏左侧「搜索引擎切换」下拉。独立 BrowserView,覆盖在网页内容之上。
// 持久弹窗(启动预热),show 时 waitForLoad=false 立即定位,避免每次重载的延迟。
export class SearchEnginesDialog extends PersistentDialog {
  private pos = { x: 0, y: 0 };

  public constructor() {
    super({
      name: 'search-engines',
      bounds: { width: WIDTH, height: MAX_HEIGHT },
    });
  }

  // 高度随引擎数自适应,封顶后内部滚动;再夹到窗口可用空间内。
  private clampHeight() {
    const count =
      Application.instance.settings.object.searchEngines?.length || 0;
    let height =
      count * ROW_HEIGHT + HEADER_HEIGHT + V_PADDING + 2 * DIALOG_MARGIN;
    if (this.browserWindow) {
      const win = this.browserWindow.getContentBounds();
      const available = win.height - (this.pos.y - DIALOG_MARGIN_TOP) - 16;
      height = Math.min(height, available);
    }
    return Math.max(80, Math.min(MAX_HEIGHT + 2 * DIALOG_MARGIN, height));
  }

  public rearrange() {
    super.rearrange({
      x: this.pos.x - DIALOG_MARGIN,
      y: this.pos.y - DIALOG_MARGIN_TOP,
      width: WIDTH + 2 * DIALOG_MARGIN,
      height: this.clampHeight(),
    });
  }

  private onBoundsUpdate = () => this.hide();

  public async open(browserWindow: BrowserWindow, x: number, y: number) {
    this.pos = { x, y };

    // waitForLoad 动态:已加载(hover 预加载过或上次未销毁)则秒开;未加载(销毁重建后
    // 首次,且没 hover 预加载)则等 dom-ready 避免白屏闪现。
    await super.show(browserWindow, true, this.isLoaded ? false : true);

    browserWindow.removeListener('resize', this.onBoundsUpdate);
    browserWindow.removeListener('move', this.onBoundsUpdate);
    browserWindow.on('resize', this.onBoundsUpdate);
    browserWindow.on('move', this.onBoundsUpdate);

    this.send('visible', true);
  }

  public hide(bringToTop = false) {
    super.hide(bringToTop);
    if (this.browserWindow) {
      this.browserWindow.removeListener('resize', this.onBoundsUpdate);
      this.browserWindow.removeListener('move', this.onBoundsUpdate);
    }
  }
}
