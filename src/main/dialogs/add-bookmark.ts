import {BrowserWindow, ipcMain} from 'electron';
import {Application} from '../application';
import {DIALOG_MARGIN_TOP, DIALOG_MARGIN} from '~/constants/design';
import {PersistentDialog} from './dialog';
import {IBookmark} from '~/interfaces';
import {isSameBookmarkUrl} from '~/utils/url';

const WIDTH = 436;
const HEIGHT = 408;

export class AddBookmarkDialog extends PersistentDialog {
  private pos = {x: 0, y: 0};

  public constructor() {
    super({
      name: 'add-bookmark',
      bounds: {
        width: WIDTH,
        height: HEIGHT,
      },
    });

    // 渲染层根据折叠/展开测量到的高度回报，重排弹窗
    const resizeChannel = `resize-dialog-${this.id}`;
    this.ipcChannels.push(resizeChannel);
    ipcMain.on(resizeChannel, (e, nextHeight: number) => {
      super.rearrange({height: nextHeight});
    });
  }

  public rearrange() {
    super.rearrange({
      x: this.pos.x - WIDTH + DIALOG_MARGIN,
      y: this.pos.y - DIALOG_MARGIN_TOP,
      width: WIDTH,
    });
  }

  private onBoundsUpdate = () => this.hide();

  public async open(
    browserWindow: BrowserWindow,
    x: number,
    y: number,
    data?: {
      url: string;
      title: string;
      bookmark?: IBookmark;
      favicon?: string;
      folderId?: string;
    },
  ) {
    this.pos = {x, y};

    if (!data) {
      const {
        url,
        title,
        bookmark,
        favicon,
      } = Application.instance.windows.current.viewManager.selected;
      data = {url, title, bookmark, favicon};
    }

    // 地址栏星标(view.updateBookmark)有意把移动域排除在「已收藏」外。同 URL
    // 已存在于移动设备目录时回退找到那条记录,让弹窗进编辑模式而不是重复新建
    // (否则会移动域一条 + 桌面书签栏一条)。
    if (!data.bookmark && data.url) {
      data.bookmark = Application.instance.storage.bookmarks.find(
        (x) =>
          isSameBookmarkUrl(x.url, data.url) &&
          Application.instance.storage.isUnderMobileFolder(x),
      );
    }

    if (!(await super.show(browserWindow, true))) return;

    browserWindow.removeListener('resize', this.onBoundsUpdate);
    browserWindow.removeListener('move', this.onBoundsUpdate);
    browserWindow.on('resize', this.onBoundsUpdate);
    browserWindow.on('move', this.onBoundsUpdate);

    // 数据随后下发：弹窗已可见，内容再渲染
    this.send('visible', true, data);
  }

  public hide(bringToTop = false, hideVisually = true) {
    super.hide(bringToTop, hideVisually);
    if (this.browserWindow) {
      this.browserWindow.removeListener('resize', this.onBoundsUpdate);
      this.browserWindow.removeListener('move', this.onBoundsUpdate);
    }
  }
}
