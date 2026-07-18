import {BrowserWindow, ipcMain} from 'electron';
import {Application} from '../application';
import {DIALOG_MARGIN_TOP, DIALOG_MARGIN} from '~/constants/design';
import {PersistentDialog} from './dialog';
import {IBookmark} from '~/interfaces';

const WIDTH = 436;
const HEIGHT = 344;

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
    ipcMain.on(`resize-dialog-${this.id}`, (e, nextHeight: number) => {
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

    // 弹窗已在启动时预加载，waitForLoad=false：立即 addBrowserView+定位，秒开
    await super.show(browserWindow, true, false);

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
