import { makeObservable, observable } from 'mobx';
import { ipcRenderer } from 'electron';
import { getDomain } from '~/utils';
import { DialogStore } from '~/models/dialog-store';
import { IHidDevice } from '~/interfaces';

export class Store extends DialogStore {
  public devices: IHidDevice[] = [];
  public domain = '';
  public selectedId: string | null = null;
  public deviceType: 'hid' | 'usb' | 'serial' = 'hid';

  public constructor() {
    super({ hideOnBlur: false });
    makeObservable(this, {
      devices: observable,
      domain: observable,
      selectedId: observable,
      deviceType: observable,
    });
    ipcRenderer.on('update-tab-info', (_e, _tabId, data: { url: string; devices?: IHidDevice[]; deviceType?: 'hid' | 'usb' | 'serial' }) => {
      if (!data) return;
      this.domain = getDomain(data.url);
      this.devices = Array.isArray(data.devices)
        ? data.devices.map((device) => ({ ...device, deviceId: String(device.deviceId) }))
        : [];
      this.deviceType = data.deviceType || 'hid';
      if (this.selectedId && !this.devices.some((d) => d.deviceId === this.selectedId)) {
        this.selectedId = null;
      }
    });
  }
}

const store = new Store();
export default store;

export const selectDevice = (deviceId: string) => {
  store.selectedId = String(deviceId);
};

export const submit = () => store.send('result', store.selectedId || '');
export const cancel = () => store.send('result', '');
