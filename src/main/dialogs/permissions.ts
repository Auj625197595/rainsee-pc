import { VIEW_Y_OFFSET } from '~/constants/design';
import { BrowserWindow, ipcMain } from 'electron';
import { Application } from '../application';

const DIALOG_WIDTH = 396;
const DIALOG_HEIGHT = 248;

export const requestPermission = (
  browserWindow: BrowserWindow,
  name: string,
  url: string,
  details: any,
  tabId: number,
): Promise<{ allowed: boolean; remember: boolean }> => {
  return new Promise((resolve, reject) => {
    if (
      name === 'unknown' ||
      (name === 'media' && details.mediaTypes.length === 0) ||
      name === 'midiSysex'
    ) {
      return reject('Unknown permission');
    }

    const appWindow = Application.instance.windows.fromBrowserWindow(
      browserWindow,
    );

    appWindow.viewManager.selected.requestedPermission = { name, url, details };

    const dialog = Application.instance.dialogs.show({
      name: 'permissions',
      browserWindow,
      getBounds: () => ({
        width: DIALOG_WIDTH,
        height: DIALOG_HEIGHT,
        x: 0,
        y: VIEW_Y_OFFSET,
      }),
      tabAssociation: {
        tabId,
        getTabInfo: (tabId) => {
          const tab = appWindow.viewManager.views.get(tabId);
          return tab.requestedPermission;
        },
      },
      onWindowBoundsUpdate: (disposition) => {
        if (disposition === 'resize') dialog.rearrange();
      },
    });

    if (!dialog) return;

    ipcMain.on(`resize-dialog-${dialog.id}`, (e, nextHeight: number) => {
      dialog.rearrange({
        height: nextHeight,
      });
    });

    dialog.on('result', (e, result) => {
      if (typeof result === 'boolean') {
        resolve({ allowed: result, remember: true });
      } else {
        resolve({
          allowed: Boolean(result?.allowed),
          remember: Boolean(result?.remember),
        });
      }
      ipcMain.removeAllListeners(`resize-dialog-${dialog.id}`);
      dialog.hide();
    });
  });
};
