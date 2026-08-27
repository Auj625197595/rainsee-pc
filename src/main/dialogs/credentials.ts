import { VIEW_Y_OFFSET } from '~/constants/design';
import { PersistentDialog } from './dialog';

const WIDTH = 350;
const HEIGHT = 271;

export class CredentialsDialog extends PersistentDialog {
  private rendererReady = false;
  private pendingPayload: any = null;

  public constructor() {
    super({
      name: 'credentials',
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

  public present(payload: any) {
    this.pendingPayload = payload;
    if (this.rendererReady) this.flushPayload();
  }

  private flushPayload() {
    if (!this.pendingPayload || this.webContents.isDestroyed()) return;
    const payload = this.pendingPayload;
    this.pendingPayload = null;
    this.send('credentials-update', payload);
  }

  public rearrange() {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return;
    const { width } = this.browserWindow.getContentBounds();
    super.rearrange({
      x: width - WIDTH,
      y: VIEW_Y_OFFSET,
    });
  }
}
