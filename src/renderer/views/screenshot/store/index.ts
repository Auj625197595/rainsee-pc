import { ipcRenderer } from 'electron';
import { makeObservable, observable } from 'mobx';
import { DialogStore } from '~/models/dialog-store';

// 浮层模式:idle=待框选, fullpage=长截图结果预览
export type Mode = 'idle' | 'fullpage';
export type CaptureSource = 'page' | 'desktop';

export class Store extends DialogStore {
  // 当前页快照(dataURL),铺满浮层做 1:1 背景
  public snapshot = '';
  // 长截图结果(dataURL)
  public longshot = '';
  public mode: Mode = 'idle';
  // 长截图进行中
  public capturing = false;
  // 操作提示(已保存/已复制/失败)
  public hint = '';
  public source: CaptureSource = 'page';

  public constructor() {
    // hideOnBlur=false:保存时原生对话框会让窗口失焦,不能因此关闭浮层
    super({ persistent: true, visibilityWrapper: false, hideOnBlur: false });

    makeObservable(this, {
      snapshot: observable,
      longshot: observable,
      mode: observable,
      capturing: observable,
      hint: observable,
      source: observable,
    });

    ipcRenderer.on('visible', (e, flag, data) => {
      this.visible = flag;
      console.warn(
        '[ss-r] visible flag=',
        flag,
        'snapshot.len=',
        data?.snapshot?.length,
      );
      if (!flag) return;
      this.reset();
      if (data) {
        this.snapshot = data.snapshot || '';
        this.source = data.source === 'desktop' ? 'desktop' : 'page';
      }
    });

    ipcRenderer.on('screenshot-save-result', (e, data) => {
      console.warn('[ss-r] save-result', data);
      if (data && data.canceled) return;
      this.setHint(data && data.ok ? '已保存' : '保存失败');
    });

    ipcRenderer.on('screenshot-copy-result', (e, data) => {
      console.warn('[ss-r] copy-result', data);
      this.setHint(data && data.ok ? '已复制到剪贴板' : '复制失败');
    });

    ipcRenderer.on('screenshot-longshot-result', (e, data) => {
      console.warn(
        '[ss-r] longshot-result ok=',
        data?.ok,
        'len=',
        data?.dataURL?.length,
      );
      this.capturing = false;
      if (data && data.ok) {
        this.longshot = data.dataURL;
        this.mode = 'fullpage';
      } else {
        this.setHint('长截图失败');
      }
    });
  }

  public reset() {
    this.snapshot = '';
    this.longshot = '';
    this.mode = 'idle';
    this.capturing = false;
    this.hint = '';
    this.source = 'page';
  }

  private hintTimer: any = null;

  public setHint(text: string) {
    this.hint = text;
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => {
      this.hint = '';
    }, 1600);
  }

  public save(dataURL: string) {
    this.send('screenshot-save', dataURL);
  }

  public copy(dataURL: string) {
    this.send('screenshot-copy', dataURL);
  }

  public searchImage(dataURL: string) {
    this.send('screenshot-search', dataURL);
  }

  // 开源版：截图「问 AI」通道已移除。

  public longCapture() {
    if (this.capturing) return;
    this.capturing = true;
    this.send('screenshot-longshot');
  }

  public activateDesktopDisplay() {
    if (this.source === 'desktop') this.send('screenshot-activate');
  }

  public desktopSnapshotPainted() {
    if (this.source !== 'desktop') return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.send('screenshot-render-ready'));
    });
  }
}

export default new Store();
