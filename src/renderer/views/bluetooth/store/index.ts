import { makeObservable, observable } from 'mobx';
import { ipcRenderer } from 'electron';

import { getDomain } from '~/utils';
import { DialogStore } from '~/models/dialog-store';
import { IBluetoothDevice } from '~/interfaces';

export class Store extends DialogStore {
  public devices: IBluetoothDevice[] = [];

  public domain = '';

  public selectedId: string | null = null;

  public constructor() {
    super({ hideOnBlur: false });

    makeObservable(this, {
      devices: observable,
      domain: observable,
      selectedId: observable,
    });

    // 主进程在扫描持续触发时重发完整列表(update-tab-info),整体替换设备;
    // selectedId 不重置,避免扫描推送打断用户已选中的项。
    ipcRenderer.on(
      'update-tab-info',
      (
        _e,
        _tabId: number,
        data: { url: string; devices?: IBluetoothDevice[] },
      ) => {
        if (!data) return;
        this.domain = getDomain(data.url);
        this.devices = data.devices || [];
      },
    );
  }
}

const store = new Store();

export default store;

export const selectDevice = (deviceId: string) => {
  store.selectedId = deviceId;
};

// 扫描推送可能带来更完整的列表;若已选设备消失(信号丢失)自动清空选中。
export const ensureSelectionValid = () => {
  if (
    store.selectedId &&
    !store.devices.some((d) => d.deviceId === store.selectedId)
  ) {
    store.selectedId = null;
  }
};

export const submit = () => {
  store.send('result', store.selectedId || '');
};

export const cancel = () => {
  store.send('result', '');
};
