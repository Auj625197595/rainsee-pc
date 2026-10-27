import { BrowserWindow } from 'electron';
import { Application } from '../application';
import { IHidDevice } from '~/interfaces';
import { getAppContentBounds } from './dialog';

const DIALOG_WIDTH = 512;
const DIALOG_HEIGHT = 440;

export interface IHidChooserHandle {
  promise: Promise<string>;
  update: (devices: IHidDevice[]) => void;
}

let pendingFinish: (() => void) | null = null;

export const requestHidDevice = (
  browserWindow: BrowserWindow,
  tabId: number,
  url: string,
  initialDevices: IHidDevice[],
  deviceType: 'hid' | 'usb' | 'serial' = 'hid',
): IHidChooserHandle => {
  let resolvePromise!: (deviceId: string) => void;
  const promise = new Promise<string>((resolve) => {
    resolvePromise = resolve;
  });
  let settled = false;
  let dialog: any = null;
  let tab: any = null;

  if (pendingFinish) {
    resolvePromise('');
    return { promise, update: () => {} };
  }

  const finish = (deviceId = '', hide = true) => {
    if (settled) return;
    settled = true;
    if (pendingFinish === finish) pendingFinish = null;
    if (tab) tab.requestedHid = null;
    if (hide) dialog?.hide();
    resolvePromise(deviceId);
  };
  pendingFinish = finish;

  const appWindow = Application.instance.windows.fromBrowserWindow(browserWindow);
  tab = appWindow?.viewManager?.getById(tabId);
  if (!tab) {
    finish('', false);
    return { promise, update: () => {} };
  }

  tab.requestedHid = { url, devices: initialDevices, deviceType };
  dialog = Application.instance.dialogs.show({
    name: 'hid',
    browserWindow,
    getBounds: () => {
      const area = getAppContentBounds(browserWindow, appWindow);
      return {
        width: DIALOG_WIDTH,
        height: DIALOG_HEIGHT,
        x: area.x,
        y: area.y,
      };
    },
    tabAssociation: {
      tabId,
      getTabInfo: (id: number) => appWindow.viewManager.getById(id)?.requestedHid,
    },
    onWindowBoundsUpdate: (disposition) => {
      if (disposition === 'resize') dialog.rearrange();
    },
    onHide: () => finish('', false),
  });

  if (!dialog) {
    finish('', false);
    return { promise, update: () => {} };
  }

  dialog.on('result', (_e: any, deviceId: string) => {
    finish(typeof deviceId === 'string' ? deviceId : '');
  });

  return {
    promise,
    update: (devices: IHidDevice[]) => {
      if (settled || !tab.requestedHid) return;
      tab.requestedHid = { ...tab.requestedHid, devices };
      dialog?._sendTabInfo(tabId);
    },
  };
};

export const cancelHidRequest = () => {
  if (pendingFinish) pendingFinish();
};
