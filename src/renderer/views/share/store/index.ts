import { ipcRenderer } from 'electron';
import { makeObservable, observable } from 'mobx';
import { DialogStore } from '~/models/dialog-store';

export class Store extends DialogStore {
  public url = '';
  public title = '';

  public loading = true;
  public qrUrl = '';
  public qrError = false;
  public shortUrl = '';
  public shortError = false;
  public copied = false;
  public downloading = false;
  public downloadHint = '';

  public constructor() {
    super({ persistent: true, visibilityWrapper: false });

    makeObservable(this, {
      url: observable,
      title: observable,
      loading: observable,
      qrUrl: observable,
      qrError: observable,
      shortUrl: observable,
      shortError: observable,
      copied: observable,
      downloading: observable,
      downloadHint: observable,
    });

    // 持久弹窗:每次显示通过 'visible' 下发当前页 url/title
    ipcRenderer.on('visible', (e, flag, data) => {
      this.visible = flag;
      if (!flag || !data) return;
      this.reset();
      this.url = data.url || '';
      this.title = data.title || '';
      if (this.url) {
        this.send('share-generate', this.url);
      } else {
        this.loading = false;
        this.qrError = true;
        this.shortError = true;
      }
    });

    // 主进程回推二维码图片地址 + 短链结果
    ipcRenderer.on('share-result', (e, data) => {
      this.loading = false;
      this.qrUrl = data.qrUrl || '';
      this.qrError = !!data.qrError;
      this.shortUrl = data.shortUrl || '';
      this.shortError = !!data.shortError;
    });

    // 二维码下载结果
    ipcRenderer.on('share-download-result', (e, data) => {
      this.downloading = false;
      if (data && data.canceled) return;
      this.setDownloadHint(data && data.ok ? '已保存二维码' : '保存失败');
    });
  }

  public reset() {
    this.loading = true;
    this.qrUrl = '';
    this.qrError = false;
    this.shortUrl = '';
    this.shortError = false;
    this.copied = false;
    this.downloading = false;
    this.downloadHint = '';
  }

  private hintTimer: any = null;

  public setDownloadHint(text: string) {
    this.downloadHint = text;
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => {
      this.downloadHint = '';
    }, 1800);
  }

  public downloadQr() {
    if (this.downloading || !this.qrUrl) return;
    this.downloading = true;
    this.send('share-download-qr', this.qrUrl);
  }

  private copiedTimer: any = null;

  public markCopied() {
    this.copied = true;
    clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => {
      this.copied = false;
    }, 1600);
  }
}

export default new Store();
