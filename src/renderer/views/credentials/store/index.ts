import { ipcRenderer } from 'electron';
import * as React from 'react';
import { action, makeObservable, observable } from 'mobx';

import { Textfield } from '~/renderer/components/Textfield';
import { PasswordInput } from '~/renderer/components/PasswordInput';
import { IFormFillData } from '~/interfaces';
import { DialogStore } from '~/models/dialog-store';

export class Store extends DialogStore {
  // Keep the dialog in its list/hidden state until the main process sends a
  // prompt payload. The initializer also creates the runtime field that
  // MobX expects when applying the observable annotation below.
  public content: 'save' | 'update' | 'list' = 'list';

  public list: IFormFillData[] = [];

  public usernameRef = React.createRef<Textfield>();

  public passwordRef = React.createRef<PasswordInput>();

  public oldUsername: string;

  public url = '';

  public credentialId = '';

  public sourceWebContentsId = 0;

  private applyFieldValues(username: string, password: string, attempt = 0) {
    if (this.usernameRef.current && this.passwordRef.current) {
      this.usernameRef.current.value = username;
      this.passwordRef.current.value = password;
      return;
    }
    if (attempt < 10) {
      setTimeout(() => this.applyFieldValues(username, password, attempt + 1), 16);
    }
  }

  public constructor() {
    super({ hideOnBlur: false });

    makeObservable(this, {
      content: observable,
      list: observable,
      remove: action,
    });

    ipcRenderer.on('credentials-update', (e, data) => {
      const {
        username,
        password,
        content,
        list,
        url,
        credentialId,
        sourceWebContentsId,
      } = data;

      if (content !== 'list') {
        this.applyFieldValues(username || '', password || '');
        this.oldUsername = username;
        this.url = url || '';
        this.credentialId = credentialId || '';
        this.sourceWebContentsId = Number(sourceWebContentsId) || 0;
      } else {
        this.list = list;
      }

      this.content = content;
    });
  }

  public remove(data: IFormFillData) {
    this.list = this.list.filter((r) => r._id !== data._id);
    ipcRenderer.send(`credentials-remove-${this.windowId}`, data);
  }
}

export default new Store();
