import { BrowserWindow } from 'electron';
import { Application } from '../application';
import { DIALOG_MARGIN_TOP, DIALOG_MARGIN } from '~/constants/design';
import { PersistentDialog } from './dialog';
import { ERROR_PROTOCOL } from '~/constants/files';

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
  }

  public rearrange() {
    const { width } = this.browserWindow.getContentBounds();
    super.rearrange({ width, y: this.tab.y });
  }

  public async show(browserWindow: BrowserWindow) {
    super.show(browserWindow, false);

    const appWindow = Application.instance.windows.fromBrowserWindow(
      browserWindow,
    );
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
    });
  }

  public hide(bringToTop = true) {
    super.hide(bringToTop);
  }
}
