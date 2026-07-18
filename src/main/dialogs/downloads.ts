import { BrowserWindow } from 'electron';
import { Application } from '../application';
import {
  DIALOG_MARGIN_TOP,
  DIALOG_MARGIN,
  DIALOG_TOP,
} from '~/constants/design';

export const showDownloadsDialog = (
  browserWindow: BrowserWindow,
  x: number,
  y: number,
) => {
  let height = 0;

  const WIDTH = 520;

  const dialog = Application.instance.dialogs.show({
    name: 'downloads-dialog',
    browserWindow,
    getBounds: () => {
      const winBounds = browserWindow.getContentBounds();
      const maxHeight = winBounds.height - DIALOG_TOP - 16;

      height = Math.round(Math.min(winBounds.height, height));

      dialog.browserView.webContents.send(
        `max-height`,
        Math.min(maxHeight, height),
      );

      return {
        x: x - WIDTH + DIALOG_MARGIN,
        y: y - DIALOG_MARGIN_TOP,
        width: WIDTH,
        height: Math.min(maxHeight, height),
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
