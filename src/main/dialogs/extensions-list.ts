import {BrowserWindow, ipcMain} from 'electron';
import {DIALOG_MARGIN_TOP, DIALOG_MARGIN} from '~/constants/design';
import {PersistentDialog} from './dialog';

const WIDTH = 320;
const HEIGHT = 520;

export class ExtensionsListDialog extends PersistentDialog {
  private pos = {x: 0, y: 0};

  public constructor() {
    super({
      name: 'extensions-list',
      bounds: {
        width: WIDTH,
        height: HEIGHT,
      },
    });

    // 渲染层按内容高度回报,动态重排弹窗高度。channel 记入 ipcChannels,销毁时随
    // PersistentDialog.destroy 一并 removeAllListeners,避免弹窗回收后监听器泄漏。
    const resizeChannel = `resize-dialog-${this.id}`;
    this.ipcChannels.push(resizeChannel);
    ipcMain.on(resizeChannel, (e, nextHeight: number) => {
      super.rearrange({height: Math.min(HEIGHT, nextHeight)});
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
    incognito = false,
  ) {
    this.pos = {x, y};

    if (!(await super.show(browserWindow, true))) return;

    browserWindow.removeListener('resize', this.onBoundsUpdate);
    browserWindow.removeListener('move', this.onBoundsUpdate);
    browserWindow.on('resize', this.onBoundsUpdate);
    browserWindow.on('move', this.onBoundsUpdate);

    // 通知渲染层刷新扩展列表与锚点坐标(供点击行打开 popup 时定位)。
    // 附带父窗口的无痕标记:无痕窗口下,列表只展示允许在无痕运行的扩展,
    // 与地址栏 pinned 图标的过滤保持一致,避免给未授权扩展提供入口。
    this.send('visible', true, {x, y, incognito});
  }

  public hide(bringToTop = false, hideVisually = true) {
    super.hide(bringToTop, hideVisually);
    if (this.browserWindow) {
      this.browserWindow.removeListener('resize', this.onBoundsUpdate);
      this.browserWindow.removeListener('move', this.onBoundsUpdate);
    }
  }
}
