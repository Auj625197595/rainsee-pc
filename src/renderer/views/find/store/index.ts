import * as React from 'react';

import { makeObservable, observable } from 'mobx';
import { ipcRenderer } from 'electron';
import { DialogStore } from '~/models/dialog-store';
import { callViewMethod } from '~/utils/view';

interface IFindInfo {
  occurrences: string;
  text: string;
}

const defaultFindInfo = {
  occurrences: '0/0',
  text: '',
};

export class Store extends DialogStore {
  public findInputRef = React.createRef<HTMLInputElement>();

  // Observable
  public tabId = -1;

  public tabsFindInfo = new Map<number, IFindInfo>();

  public findInfo = defaultFindInfo;

  public constructor() {
    super({ hideOnBlur: false });

    makeObservable(this, {
      tabId: observable,
      tabsFindInfo: observable,
      findInfo: observable,
    });

    this.init();

    this.onUpdateTabInfo = (tabId, info) => {
      this.tabId = tabId;
      this.findInfo = info;
    };

    this.onHide = () => {
      callViewMethod(this.tabId, 'stopFindInPage', 'clearSelection');
      this.findInfo = defaultFindInfo;
      this.sendInfo();
      ipcRenderer.send(`window-focus-${this.windowId}`);
    };
  }

  public async init() {
    if (this.findInputRef && this.findInputRef.current) {
      this.findInputRef.current.focus();
    }

    ipcRenderer.on(
      'found-in-page',
      (e, { activeMatchOrdinal, matches }: Electron.FoundInPageResult) => {
        this.findInfo.occurrences = `${activeMatchOrdinal}/${matches}`;
        this.sendInfo();
      },
    );

    // Ctrl+F 再次按下(搜索框已开启)时主进程发来此消息:重新聚焦输入框并选中文本。
    ipcRenderer.on('refocus-find-input', () => {
      const input = this.findInputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  public sendInfo() {
    this.send('update-tab-info', this.tabId, { ...this.findInfo });
  }
}

export default new Store();
