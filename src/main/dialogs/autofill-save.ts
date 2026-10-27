import { VIEW_Y_OFFSET } from '~/constants/design';
import { PersistentDialog, getAppContentBounds } from './dialog';
import { Application } from '../application';
import type { IAutofillSavePromptData } from '~/interfaces';

const WIDTH = 350;
const HEIGHT = 300;

// 「保存地址？」「保存银行卡？」提示框。结构同 CredentialsDialog:渲染页就绪前缓存载荷。
export class AutofillSaveDialog extends PersistentDialog {
  private rendererReady = false;
  private pendingPayload: IAutofillSavePromptData | null = null;

  public constructor() {
    super({
      name: 'autofill-save',
      bounds: {
        height: HEIGHT,
        width: WIDTH,
        y: VIEW_Y_OFFSET,
      },
    });
    this.webContents.once('did-finish-load', () => {
      this.rendererReady = true;
      if (this.pendingPayload) this.flushPayload();
    });
  }

  public present(payload: IAutofillSavePromptData) {
    this.pendingPayload = payload;
    if (this.rendererReady) this.flushPayload();
  }

  private flushPayload() {
    if (!this.pendingPayload || this.webContents.isDestroyed()) return;
    const payload = this.pendingPayload;
    this.pendingPayload = null;
    this.send('autofill-save-present', payload);
  }

  public rearrange() {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return;
    const area = getAppContentBounds(
      this.browserWindow,
      Application.instance.windows.fromBrowserWindow(this.browserWindow),
    );
    super.rearrange({
      x: area.x + area.width - WIDTH,
      y: area.y,
    });
  }
}
