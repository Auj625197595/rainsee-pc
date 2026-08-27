import { ipcRenderer } from 'electron';
import { observable, computed, makeObservable } from 'mobx';
import { parse } from 'url';
import { WEBUI_BASE_URL, WEBUI_PROTOCOL } from '~/constants/files';
import { DialogStore } from '~/models/dialog-store';
import type { ITabMemorySnapshot } from '~/interfaces/memory';

export class Store extends DialogStore {
  private timeout: any;
  private timeout1: any;

  // Observable

  public title = '';

  public url = '';

  public thumbnail = '';

  public favicon = '';

  public x = 0;

  public xTransition = false;

  public tabId = -1;

  public memory: ITabMemorySnapshot = {
    available: false,
    pid: 0,
    memoryBytes: 0,
    privateBytes: 0,
    sharedTabCount: 0,
  };

  // Computed

  public get domain() {
    const parsed = parse(this.url);
    if (
      WEBUI_BASE_URL.startsWith(WEBUI_PROTOCOL) &&
      this.url.startsWith(WEBUI_BASE_URL)
    ) {
      return parsed.protocol + '//' + parsed.hostname;
    }

    if (parsed.protocol === 'file:') {
      return 'local or shared file';
    }

    return parsed.hostname;
  }

  // 卡片副标题:普通网页展示完整 URL(贴合视觉稿),
  // 内部页/本地文件回退到 domain 的友好文案。
  public get displayUrl() {
    if (
      WEBUI_BASE_URL.startsWith(WEBUI_PROTOCOL) &&
      this.url.startsWith(WEBUI_BASE_URL)
    ) {
      return this.domain;
    }

    const parsed = parse(this.url);
    if (parsed.protocol === 'file:') {
      return this.domain;
    }

    return this.url || this.domain;
  }

  constructor() {
    super({ visibilityWrapper: false, persistent: true });

    makeObservable(this, {
      title: observable,
      url: observable,
      thumbnail: observable,
      favicon: observable,
      x: observable,
      xTransition: observable,
      tabId: observable,
      memory: observable,
      domain: computed,
      displayUrl: computed,
    });

    ipcRenderer.on('visible', (e, visible, tab) => {
      clearTimeout(this.timeout);
      clearTimeout(this.timeout1);

      if (!visible) {
        this.visible = false;
      }

      if (visible) {
        this.timeout1 = setTimeout(() => {
          this.xTransition = true;
        }, 80);
      } else if (!visible) {
        this.timeout = setTimeout(() => {
          this.xTransition = false;
        }, 100);
      }

      if (tab) {
        this.title = tab.title;
        this.url = tab.url;
        this.thumbnail = tab.thumbnail || '';
        this.favicon = tab.favicon || '';
        this.x = tab.x;
        this.tabId = tab.id;
        this.memory = tab.memory || this.memory;

        if (visible && this.title !== '' && this.url !== '') {
          this.visible = visible;
        }
      }
    });
  }

  public pointerEnter() {
    this.send('preview-pointer-enter');
  }

  public pointerLeave() {
    this.send('preview-pointer-leave');
  }

  public openMemoryPanel() {
    ipcRenderer.send('preview-open-memory-panel', { tabId: this.tabId });
  }
}

export default new Store();
