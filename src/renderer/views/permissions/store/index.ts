import { makeObservable, observable } from 'mobx';
import { ipcRenderer } from 'electron';

import { getDomain } from '~/utils';
import { DialogStore } from '~/models/dialog-store';
import { getWebUIURL } from '~/common/webui';
import { EXTERNAL_NAVIGATION_PERMISSION } from '~/utils/permissions';

export class Store extends DialogStore {
  public permissions: string[] = [];

  public domain = '';

  public remember = false;

  public requestName = '';

  public targetUrl = '';

  public targetDomain = '';

  public constructor() {
    super({ hideOnBlur: false });

    makeObservable(this, {
      permissions: observable,
      domain: observable,
      remember: observable,
      requestName: observable,
      targetUrl: observable,
      targetDomain: observable,
    });

    ipcRenderer.on('update-tab-info', (e, tabId, { url, name, details }) => {
      this.domain = getDomain(url);
      this.permissions = [];
      this.remember = false;
      this.requestName = name || '';
      this.targetUrl = details?.targetUrl || '';
      this.targetDomain = getDomain(this.targetUrl);

      console.log('[permissions][dialog] update-tab-info received', {
        tabId,
        url,
        domain: this.domain,
        name,
        details,
      });

      if (
        name === 'notifications' ||
        name === 'geolocation' ||
        name === 'sensors'
      ) {
        this.permissions.push(name);
      } else if (name === 'media') {
        const mediaTypes = Array.isArray(details?.mediaTypes)
          ? details.mediaTypes
          : [];

        if (mediaTypes.includes('audio')) {
          this.permissions.push('microphone');
        }

        if (mediaTypes.includes('video')) {
          this.permissions.push('camera');
        }
      }

      if (this.permissions.length === 0 && name) {
        this.permissions.push(name);
      }

      console.log('[permissions][dialog] mapped permissions', {
        tabId,
        url,
        domain: this.domain,
        name,
        details,
        permissions: [...this.permissions],
      });
    });
  }
}

const store = new Store();

export default store;

export const sendResult = (allowed: boolean) => {
  store.send('result', {
    allowed,
    remember: store.remember,
  });
};

export const toggleRemember = () => {
  store.remember = !store.remember;
};

export const openSettings = () => {
  const site = store.domain ? `&site=${encodeURIComponent(store.domain)}` : '';
  ipcRenderer.send(`add-tab-${store.windowId}`, {
    url: `${getWebUIURL('settings')}?section=permissions${site}`,
    active: true,
  });
  store.send('result', {
    allowed: false,
    remember: false,
  });
};

export const isExternalNavigationRequest = () =>
  store.requestName === EXTERNAL_NAVIGATION_PERMISSION;
