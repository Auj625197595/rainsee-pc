import { ipcRenderer } from 'electron';
import { makeObservable, observable } from 'mobx';
import { DialogStore } from '~/models/dialog-store';
import { IDownloadPromptData, IDownloadPromptResult } from '~/interfaces';

export class Store extends DialogStore {
  @observable public data: IDownloadPromptData = {
    fileName: '',
    directory: '',
    source: '',
    url: '',
    downloaders: [],
  };

  public constructor() {
    super({ persistent: true, visibilityWrapper: false, hideOnBlur: false });
    makeObservable(this);

    ipcRenderer.on(
      'visible',
      (_event, visible: boolean, data?: IDownloadPromptData) => {
        if (visible && data) this.data = data;
        this.visible = visible;
      },
    );
  }

  public selectDirectory() {
    return this.invoke('download-prompt-select-directory');
  }

  public submit(result: IDownloadPromptResult) {
    return this.invoke('download-prompt-submit', result);
  }
}

export default new Store();
