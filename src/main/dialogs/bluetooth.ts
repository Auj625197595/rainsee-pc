import { BrowserWindow } from 'electron';
import { Application } from '../application';
import { IBluetoothDevice } from '~/interfaces';
import { getAppContentBounds } from './dialog';

const DIALOG_WIDTH = 396;
const DIALOG_HEIGHT = 340;

export interface IBluetoothChooserHandle {
  // resolve 选中的 deviceId,''表示用户取消/请求失效。
  promise: Promise<string>;
  // select-bluetooth-device 持续触发(新设备发现)时推送累积列表。
  update: (devices: IBluetoothDevice[]) => void;
}

// 蓝牙选择是用户交互式 chooser,同一时刻全局只允许一个;并发请求直接取消,
// 避免两个弹窗争抢同一动态弹窗槽位(动态弹窗按 name 查重会复用同一实例)。
let pendingFinish: (() => void) | null = null;

export const requestBluetoothDevice = (
  browserWindow: BrowserWindow,
  tabId: number,
  url: string,
  initialDevices: IBluetoothDevice[],
): IBluetoothChooserHandle => {
  let resolvePromise: (deviceId: string) => void;
  const promise = new Promise<string>((resolve) => {
    resolvePromise = resolve;
  });

  let settled = false;
  let dialog: any = null;
  let tab: any = null;

  if (pendingFinish) {
    // 已有请求进行中:直接取消本次(与 Chrome 单窗口单 chooser 行为一致)。
    console.log('[bluetooth] concurrent chooser cancelled');
    resolvePromise('');
    return { promise, update: () => {} };
  }

  const finish = (deviceId = '', hide = true) => {
    if (settled) return;
    settled = true;
    if (pendingFinish === finish) pendingFinish = null;
    if (tab) tab.requestedBluetooth = null;
    if (hide) dialog?.hide();
    resolvePromise(deviceId);
  };
  pendingFinish = finish;

  const appWindow =
    Application.instance.windows.fromBrowserWindow(browserWindow);
  tab = appWindow?.viewManager?.getById(tabId);
  if (!tab) {
    console.log('[bluetooth] chooser tab not found', { tabId });
    finish('', false);
    return { promise, update: () => {} };
  }

  // 数据挂在 tab 上:tabAssociation.getTabInfo 与切标签回来的恢复推送都读这里。
  tab.requestedBluetooth = { url, devices: initialDevices };

  dialog = Application.instance.dialogs.show({
    name: 'bluetooth',
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
      getTabInfo: (id: number) =>
        appWindow.viewManager.getById(id)?.requestedBluetooth,
    },
    onWindowBoundsUpdate: (disposition) => {
      if (disposition === 'resize') dialog.rearrange();
    },
    // 切标签/关标签/关窗口导致弹窗消失 = 用户取消。hide=false:onHide 本就由
    // dialog.hide() 内部触发,再传 true 会重入 hide(与 permissions.ts 同款守卫)。
    onHide: () => finish('', false),
  });

  if (!dialog) {
    console.log('[bluetooth] chooser dialog reused without handle', { tabId });
    finish('', false);
    return { promise, update: () => {} };
  }

  console.log('[bluetooth] chooser dialog opened', {
    tabId,
    dialogId: dialog.id,
    deviceCount: initialDevices.length,
  });

  dialog.on('result', (_e: any, deviceId: string) => {
    finish(typeof deviceId === 'string' ? deviceId : '');
  });

  return {
    promise,
    update: (devices: IBluetoothDevice[]) => {
      if (settled || !tab.requestedBluetooth) return;
      tab.requestedBluetooth = { ...tab.requestedBluetooth, devices };
      // 复用动态弹窗的 tabAssociation 推送通道,渲染端整体替换列表。
      dialog?._sendTabInfo(tabId);
    },
  };
};

// View 销毁(tab 关闭/窗口关闭)时取消进行中的请求。webContents 将亡,
// Chromium callback 不可再调,由调用方(View)决定是否安全调用回调。
export const cancelBluetoothRequest = () => {
  if (pendingFinish) pendingFinish();
};
