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
// 持久弹窗,首次点击时创建并在隐藏后自动回收。
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

    if (!(await super.show(browserWindow, true))) return;

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
