import { ipcRenderer } from 'electron';
import { makeObservable, observable, runInAction } from 'mobx';

import { IFormFillMenuItem } from '~/interfaces';
import { DialogStore } from '~/models/dialog-store';

export class Store extends DialogStore {
  @observable
  public items: IFormFillMenuItem[] = [];

  public constructor() {
    super({ persistent: true, visibilityWrapper: false });
    makeObservable(this);

    ipcRenderer.on('visible', (_event, visible: boolean, items) => {
      runInAction(() => {
        if (visible && Array.isArray(items)) this.items = items;
        this.visible = visible;
      });
    });
  }

  public async fill(item: IFormFillMenuItem) {
    if (!item._id) return;
    const request = ipcRenderer.invoke(
      `autofill-fill-${this.windowId}`,
      item._id,
    );
    this.hide();
    await request;
  }

  public notifyEnter() {
    this.send('autofill-popup-hover-enter');
  }

  public notifyLeave() {
    this.send('autofill-popup-hover-leave');
  }
}

export default new Store();
