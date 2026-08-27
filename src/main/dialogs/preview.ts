import { BrowserWindow, ipcMain } from 'electron';
import { Application } from '../application';
import { DIALOG_MARGIN_TOP, DIALOG_MARGIN } from '~/constants/design';
import { PersistentDialog } from './dialog';
import { ERROR_PROTOCOL } from '~/constants/files';
import { getTabMemorySnapshot } from '../services/memory-report';

const HEIGHT = 300;

export class PreviewDialog extends PersistentDialog {
  public visible = false;
  public tab: { id?: number; x?: number; y?: number } = {};

  constructor() {
    super({
      name: 'preview',
      bounds: {
        height: HEIGHT,
      },
      hideTimeout: 150,
    });

    const enterChannel = `preview-pointer-enter-${this.id}`;
    const leaveChannel = `preview-pointer-leave-${this.id}`;
    this.ipcChannels.push(enterChannel, leaveChannel);
    ipcMain.on(enterChannel, () => this.cancelScheduledHide());
    ipcMain.on(leaveChannel, () => this.scheduleHide());
  }

  private scheduledHide: NodeJS.Timeout | null = null;

  public cancelScheduledHide() {
    if (this.scheduledHide) {
      clearTimeout(this.scheduledHide);
      this.scheduledHide = null;
    }
  }

  public scheduleHide() {
    this.cancelScheduledHide();
    this.scheduledHide = setTimeout(() => {
      this.scheduledHide = null;
      this.hide();
    }, 180);
  }

  public rearrange() {
    const { width } = this.browserWindow.getContentBounds();
    super.rearrange({ width, y: this.tab.y });
  }

  public async show(browserWindow: BrowserWindow) {
    this.cancelScheduledHide();
    if (!(await super.show(browserWindow, false))) return;

    const appWindow =
      Application.instance.windows.fromBrowserWindow(browserWindow);
    const view = appWindow?.viewManager.views.get(this.tab.id);

    // 标签撕离/合并迁移的瞬间,该 view 可能已不在本窗口,跳过预览避免崩溃。
    if (!view) {
      this.hide();
      return;
    }

    const { id, url, title, errorURL } = view;

    // 当前选中的标签可实时抓取最新快照;背景标签使用切走时缓存的缩略图。
    if (view.isSelected) {
      await view.captureThumbnail();
    }

    this.send('visible', true, {
      id,
      url: url.startsWith(`${ERROR_PROTOCOL}://`) ? errorURL : url,
      title,
      thumbnail: view.thumbnail,
      favicon: view.favicon,
      x: this.tab.x - 8,
      memory: getTabMemorySnapshot(id),
    });
  }

  public hide(bringToTop = true) {
    this.cancelScheduledHide();
    super.hide(bringToTop);
  }
}
