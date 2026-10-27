import { makeObservable, observable } from 'mobx';
import { ipcRenderer } from 'electron';
import { getDomain } from '~/utils';
import { DialogStore } from '~/models/dialog-store';
import { IDisplayCaptureSource } from '~/interfaces';

class Store extends DialogStore {
  domain = ''; sources: IDisplayCaptureSource[] = []; selectedId: string | null = null;
  videoRequested = true; audioRequested = false; audioAvailable = false; shareAudio = false;
  constructor() {
    super({ hideOnBlur: false });
    makeObservable(this, { domain: observable, sources: observable, selectedId: observable, videoRequested: observable, audioRequested: observable, audioAvailable: observable, shareAudio: observable });
    ipcRenderer.on('update-tab-info', (_e, _id, data) => {
      // 扩展 chooseDesktopMedia 传的是扩展名而非 URL,原样展示。
      const url = data?.url || '';
      this.domain = url.includes('://') ? getDomain(url) : url; this.sources = Array.isArray(data?.sources) ? data.sources : [];
      this.videoRequested = data?.videoRequested !== false; this.audioRequested = data?.audioRequested === true;
      this.audioAvailable = data?.audioAvailable === true;
      if (!this.audioAvailable) this.shareAudio = false;
      if (this.selectedId && !this.sources.some((s) => s.id === this.selectedId)) this.selectedId = null;
    });
  }
}
const store = new Store(); export default store;
export const selectSource = (id: string) => { store.selectedId = id; };
export const toggleAudio = () => { if (store.audioAvailable) store.shareAudio = !store.shareAudio; };
export const submit = () => store.send('result', store.selectedId ? {id: store.selectedId, shareAudio: store.shareAudio} : null);
export const cancel = () => store.send('result', null);
