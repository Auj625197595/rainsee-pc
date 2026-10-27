import { BrowserWindow, ipcMain } from 'electron';
import { PersistentDialog, getAppContentBounds } from './dialog';
import { Application } from '../application';

// 图片上传处理弹窗:居中盖在网页内容区上。payload 由 services/image-upload 下发,
// 渲染层处理完通过 image-upload-result 回传。被动隐藏(点回网页/切标签)时
// 通知 service 把挂起请求按取消结束,防止 preload 一直等待。
const WIDTH = 780;
const HEIGHT = 560;

export class ImageUploadDialog extends PersistentDialog {
  private requestId = -1;
  private watchedWindow: BrowserWindow | null = null;
  private contentHeight = HEIGHT;

  public constructor() {
    super({
      name: 'image-upload',
      bounds: { width: WIDTH, height: HEIGHT },
    });

    const resizeChannel = `resize-dialog-${this.id}`;
    this.ipcChannels.push(resizeChannel);
    ipcMain.on(resizeChannel, (_e, nextHeight: number) => {
      if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
      this.contentHeight = Math.ceil(nextHeight);
      this.rearrange();
    });
  }

  public rearrange() {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return;
    const area = getAppContentBounds(
      this.browserWindow,
      Application.instance.windows.fromBrowserWindow(this.browserWindow),
    );
    const width = Math.min(WIDTH, Math.max(320, area.width - 24));
    const height = Math.min(this.contentHeight, Math.max(240, area.height - 24));
    super.rearrange({
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + Math.max(12, (area.height - height) / 2)),
      width,
      height,
    });
  }

  public async open(browserWindow: BrowserWindow, payload: any) {
    // 跨窗口复用:旧窗口仍挂着时先摘下。
    const previous = this.browserWindow;
    if (this.visible && previous && previous !== browserWindow) {
      if (!previous.isDestroyed()) previous.removeBrowserView(this.browserView);
      this.visible = false;
    }
    this.requestId = payload?.requestId ?? -1;
    this.browserWindow = browserWindow;
    if (!(await super.show(browserWindow, true))) {
      throw new Error('image-upload dialog show aborted');
    }
    this.watch(browserWindow);
    this.rearrange();
    this.send('visible', true, payload);
  }

  public hide(bringToTop = false, hideVisually = true) {
    const wasVisible = this.visible;
    const requestId = this.requestId;
    this.unwatch();
    super.hide(bringToTop, hideVisually);
    if (wasVisible && requestId >= 0) {
      this.requestId = -1;
      // 结果已回传时 service 会忽略这条(requestId 不再匹配)。
      ipcMain.emit('image-upload-dismissed', {}, requestId);
    }
  }

  public destroy() {
    this.unwatch();
    super.destroy();
  }

  private onWindowResize = () => {
    if (this.visible) this.rearrange();
  };

  private watch(browserWindow: BrowserWindow) {
    if (this.watchedWindow === browserWindow) return;
    this.unwatch();
    this.watchedWindow = browserWindow;
    browserWindow.on('resize', this.onWindowResize);
  }

  private unwatch() {
    if (this.watchedWindow && !this.watchedWindow.isDestroyed()) {
      this.watchedWindow.removeListener('resize', this.onWindowResize);
    }
    this.watchedWindow = null;
  }
}
