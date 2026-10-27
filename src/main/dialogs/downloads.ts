import { BrowserWindow } from 'electron';
import { Application } from '../application';
import { DIALOG_MARGIN_TOP, DIALOG_MARGIN } from '~/constants/design';

const WIDTH = 380;
// 弹窗整体(含外边距)的高度上限,避免下载记录多时铺满整个窗口。
const MAX_HEIGHT = 560;
// 弹窗底部与窗口底边保留的间距。
const BOTTOM_GAP = 8;

export const showDownloadsDialog = (
  browserWindow: BrowserWindow,
  x: number,
  y: number,
) => {
  let height = 0;

  const dialog = Application.instance.dialogs.show({
    name: 'downloads-dialog',
    browserWindow,
    getBounds: () => {
      const winBounds = browserWindow.getContentBounds();
      const top = y - DIALOG_MARGIN_TOP;
      const available = Math.max(
        0,
        Math.min(MAX_HEIGHT, winBounds.height - top - BOTTOM_GAP),
      );

      // 下发的是「可用高度上限」,而不是当前高度。之前回传当前高度会把渲染层
      // 钉死在旧尺寸上,新增下载后只能每轮挤出外边距那点空间,表现为高度异常。
      dialog.browserView.webContents.send('max-height', available);

      return {
        x: Math.max(0, x - WIDTH + DIALOG_MARGIN),
        y: top,
        width: WIDTH,
        height: Math.round(Math.min(available, height)),
      };
    },
    onWindowBoundsUpdate: () => dialog.hide(),
  });

  if (!dialog) return;

  dialog.on('height', (e, h) => {
    height = h;
    dialog.rearrange();
  });
};
