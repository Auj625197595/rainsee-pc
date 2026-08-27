import { makeObservable, observable } from 'mobx';
import { DialogStore } from '~/models/dialog-store';

export interface AuthCredentialOption {
  id: string;
  username: string;
}

export class Store extends DialogStore {
  public url = '';
  public credentials: AuthCredentialOption[] = [];

  public constructor() {
    super({ hideOnBlur: false, visibilityWrapper: false });

    makeObservable(this, {
      url: observable,
      credentials: observable,
    });

    this.onUpdateTabInfo = (tabId, auth) => {
      this.url = auth?.url || '';
      this.credentials = Array.isArray(auth?.credentials)
        ? auth.credentials
        : [];
    };
  }

  public getPassword(credentialId: string) {
    return this.invoke('auth-get-password', credentialId) as Promise<{
      username: string;
      password: string;
    } | null>;
  }
}

export default new Store();
