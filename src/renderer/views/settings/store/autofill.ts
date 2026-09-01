import { observable, action, makeObservable } from 'mobx';

import { IFormFillData } from '~/interfaces';
import { PreloadDatabase } from '~/preloads/models/database';
import {ipcRenderer} from '~/common/renderer-ipc';

export class AutoFillStore {
  public db = new PreloadDatabase<IFormFillData>('formfill');

  @observable
  public credentials: IFormFillData[] = [];

  @observable
  public addresses: IFormFillData[] = [];

  @observable
  public menuVisible = false;

  @observable
  public menuTop = 0;

  @observable
  public menuLeft = 0;

  @observable
  public selectedItem: IFormFillData = null;

  public constructor() {
    makeObservable(this);

    this.load();

    ipcRenderer.on('credentials-insert', (_event, data) => {
      this.credentials.push(data);
    });
    ipcRenderer.on('credentials-update', (_event, data) => {
      const { _id, fields } = data;
      const item = this.credentials.find((r) => r._id === _id);
      if (item) Object.assign(item, data, { fields: { ...fields } });
    });
    ipcRenderer.on('credentials-remove', (_event, data) => {
      const {_id} = data;
      this.credentials = this.credentials.filter((r) => r._id !== _id);
    });
    ipcRenderer.on('credentials-reload', () => this.load());
  }

  @action
  public async load() {
    const items = await this.db.get({});

    this.credentials = items.filter((r) => r.type === 'password');
    this.addresses = items.filter((r) => r.type === 'address');
  }

  public async removeItem(data: IFormFillData) {
    await this.db.remove({ _id: data._id });

    if (data.type === 'password') {
      this.credentials = this.credentials.filter((r) => r._id !== data._id);
    } else {
      this.addresses = this.addresses.filter((r) => r._id !== data._id);
    }
  }
}
