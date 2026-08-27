import { BrowserWindow } from 'electron';

import { DIALOG_MARGIN, DIALOG_MARGIN_TOP } from '~/constants/design';
import { PersistentDialog } from './dialog';

const WIDTH = 316;
const HEIGHT = 190;

export interface ClearBrowsingDataDialogPayload {
  url: string;
  incognito: boolean;
}

// 工具栏清理入口使用独立 BrowserView,确保弹层不会被网页内容层遮挡。
export class ClearBrowsingDataDialog extends PersistentDialog {
  private pos = { x: 0, y: 0 };

  public constructor() {
    super({
      name: 'clear-browsing-data',
      bounds: { width: WIDTH, height: HEIGHT },
    });
  }

  public rearrange() {
    super.rearrange({
      x: this.pos.x - WIDTH - DIALOG_MARGIN,
      y: this.pos.y - DIALOG_MARGIN_TOP,
      width: WIDTH + 2 * DIALOG_MARGIN,
      height: HEIGHT + 2 * DIALOG_MARGIN,
    });
  }

  private onBoundsUpdate = () => this.hide();

  public async open(
    browserWindow: BrowserWindow,
    x: number,
    y: number,
    data: ClearBrowsingDataDialogPayload,
  ) {
    this.pos = { x, y };
    if (!(await super.show(browserWindow, true))) return;

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
