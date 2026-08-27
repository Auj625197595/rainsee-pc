import { ipcRenderer } from 'electron';

import { DialogStore } from '~/models/dialog-store';
import { getWebUIURL } from '~/common/webui';

export interface ClearDialogData {
  url: string;
  incognito: boolean;
}

type OpenListener = (data: ClearDialogData) => void;

const DEFAULT_ITEMS = {
  cache: true,
  cookies: false,
  history: true,
  searchHistory: false,
};

export class Store extends DialogStore {
  private data: ClearDialogData = { url: '', incognito: false };
  private openListeners = new Set<OpenListener>();

  public constructor() {
    super({ persistent: true, visibilityWrapper: false });

    ipcRenderer.on('visible', (e, flag, data: ClearDialogData) => {
      this.visible = flag;
      if (!flag) return;
      this.data = {
        url: String(data?.url || ''),
        incognito: !!data?.incognito,
      };
      for (const listener of this.openListeners) listener(this.data);
    });
  }

  public subscribeOpen(listener: OpenListener) {
    this.openListeners.add(listener);
    if (this.visible) listener(this.data);
    return () => {
      this.openListeners.delete(listener);
    };
  }

  private get items() {
    const items = this.settings.clearBrowsingData || DEFAULT_ITEMS;
    // MobX 会把 settings 深度转成 observable Proxy；Electron IPC 无法直接
    // structured-clone Proxy，必须转成普通对象再发送。
    return {
      cache: !!items.cache,
      cookies: !!items.cookies,
      history: !!items.history,
      searchHistory: !!items.searchHistory,
    };
  }

  public clearCurrent(data: ClearDialogData) {
    return ipcRenderer.invoke('clear-site-browsing-data', {
      ...data,
      items: this.items,
    });
  }

  public clearAll() {
    return ipcRenderer.invoke('clear-browsing-data-now', { items: this.items });
  }

  public openSettings() {
    ipcRenderer.send(`add-tab-${this.windowId}`, {
      url: `${getWebUIURL(
        'settings',
      )}?section=web-browsing&dialog=browsing-data`,
      active: true,
    });
    this.hide();
  }
}

export default new Store();
