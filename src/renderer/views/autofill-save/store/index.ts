import { ipcRenderer } from 'electron';
import { action, makeObservable, observable } from 'mobx';

import { IAutofillSavePromptData } from '~/interfaces';
import { DialogStore } from '~/models/dialog-store';

export class Store extends DialogStore {
  public data: IAutofillSavePromptData | null = null;

  public holderName = '';

  public nickname = '';

  public constructor() {
    super({ hideOnBlur: false });

    makeObservable(this, {
      data: observable,
      holderName: observable,
      nickname: observable,
      present: action,
    });

    ipcRenderer.on('autofill-save-present', (_e, data: IAutofillSavePromptData) => {
      this.present(data);
    });
  }

  public present(data: IAutofillSavePromptData) {
    this.data = data;
    this.holderName = data?.card?.holderName || '';
    this.nickname = '';
  }

  public save() {
    if (!this.data) return;
    ipcRenderer.send(`autofill-save-confirm-${this.windowId}`, this.data.id, {
      holderName: this.holderName,
      nickname: this.nickname,
    });
  }

  public dismiss() {
    if (!this.data) return;
    ipcRenderer.send(`autofill-save-hide-${this.windowId}`, this.data.id);
  }
}

export default new Store();
