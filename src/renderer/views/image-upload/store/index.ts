import { ipcRenderer } from 'electron';
import { action, makeObservable, observable, runInAction } from 'mobx';
import { DialogStore } from '~/models/dialog-store';
import {
  CropRect,
  ProcessMode,
  ProcessOutput,
  processImage,
  renameForType,
} from '../utils/process';

export interface UploadItem {
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
  url: string;
  width: number;
  height: number;
  // 每张图独立的裁剪框(源图像素坐标)。
  crop: CropRect | null;
  result: (ProcessOutput & { url: string }) | null;
  error: string;
}

export type CropAspect = 'free' | 'original' | '1:1' | '4:3' | '3:4' | '16:9';

// 图片上传处理弹窗 store。数据由主进程 'visible' 下发;处理结果经
// image-upload-result 回传主进程,再由主进程转给网页 preload 写回 input。
export class Store extends DialogStore {
  public requestId = -1;
  public host = '';
  // 本地压缩模式(超级拖拽面板「压缩」):无网页上传请求,主按钮为保存。
  public standalone = false;
  public accept = '';
  public items: UploadItem[] = [];
  public current = 0;
  public mode: ProcessMode = 'lossless';
  public targetKB = 500;
  public maxEdge = 0;
  public cropCompress = false;
  public cropAspect: CropAspect = 'free';
  public rememberSite = false;
  public processing = false;
  public submitting = false;
  public downloading = false;

  private runSeq = 0;
  private debounce: number | null = null;

  public constructor() {
    super({ persistent: true, visibilityWrapper: false, hideOnBlur: false });
    makeObservable(this, {
      requestId: observable,
      host: observable,
      standalone: observable,
      accept: observable,
      items: observable.shallow,
      current: observable,
      mode: observable,
      targetKB: observable,
      maxEdge: observable,
      cropCompress: observable,
      cropAspect: observable,
      rememberSite: observable,
      processing: observable,
      submitting: observable,
      downloading: observable,
      setMode: action,
      setCurrent: action,
      setCrop: action,
      setRememberSite: action,
    });

    // 渲染层主动 hide(提交/取消)时主进程不会再回发 visible=false,这里自行清理。
    this.onHide = () => this.reset();

    ipcRenderer.on('visible', (_e, flag: boolean, data: any) => {
      runInAction(() => {
        this.visible = flag;
      });
      if (!flag) {
        this.reset();
        return;
      }
      if (data) this.load(data);
    });
  }

  private reset() {
    this.runSeq++;
    for (const item of this.items) {
      URL.revokeObjectURL(item.url);
      if (item.result) URL.revokeObjectURL(item.result.url);
    }
    runInAction(() => {
      this.items = [];
      this.requestId = -1;
      this.submitting = false;
      this.processing = false;
    });
  }

  private async load(data: any) {
    this.reset();
    const s = this.settings;
    const files: any[] = Array.isArray(data.files) ? data.files : [];
    const items: UploadItem[] = [];
    for (const f of files) {
      const blob = new Blob([f.bytes], { type: f.type });
      const item: UploadItem = {
        name: f.name,
        type: f.type,
        lastModified: f.lastModified || Date.now(),
        blob,
        url: URL.createObjectURL(blob),
        width: 0,
        height: 0,
        crop: null,
        result: null,
        error: '',
      };
      try {
        const bmp = await createImageBitmap(blob);
        item.width = bmp.width;
        item.height = bmp.height;
        bmp.close();
      } catch {
        item.error = 'decode';
      }
      items.push(item);
    }
    runInAction(() => {
      this.requestId = data.requestId;
      this.host = data.host || '';
      this.standalone = !!data.standalone;
      this.accept = data.accept || '';
      this.items = items;
      this.current = 0;
      this.mode = (s.imageUploadDefaultMode as ProcessMode) || 'lossless';
      // 「直接上传」是一次性动作而非可选中的状态,不能作为默认模式。
      if (this.mode === 'original') this.mode = 'lossless';
      this.targetKB = s.imageUploadTargetKB || 500;
      this.maxEdge = s.imageUploadMaxEdge || 0;
      this.cropCompress = false;
      this.cropAspect = 'free';
      this.rememberSite = false;
    });
    this.run();
  }

  public get item(): UploadItem | undefined {
    return this.items[this.current];
  }

  public setMode(mode: ProcessMode) {
    this.mode = mode;
    if (mode === 'crop') {
      this.items.forEach((it) => {
        if (!it.crop && it.width) {
          it.crop = { x: 0, y: 0, width: it.width, height: it.height };
        }
      });
    }
    this.schedule(0);
  }

  public setRememberSite(value: boolean) {
    this.rememberSite = value;
  }

  public setCurrent(index: number) {
    this.current = index;
  }

  public setCrop(index: number, crop: CropRect) {
    const item = this.items[index];
    if (!item) return;
    item.crop = crop;
    this.items = this.items.slice();
    this.schedule(250);
  }

  public setOption(patch: Partial<Pick<Store, 'targetKB' | 'maxEdge' | 'cropCompress' | 'cropAspect'>>) {
    runInAction(() => Object.assign(this, patch));
    this.schedule(300);
  }

  private schedule(delay: number) {
    if (this.debounce) window.clearTimeout(this.debounce);
    this.debounce = window.setTimeout(() => {
      this.debounce = null;
      this.run();
    }, delay);
  }

  // 按当前模式重算所有图片。旧一轮被新一轮打断时丢弃结果。
  public async run() {
    const seq = ++this.runSeq;
    runInAction(() => {
      this.processing = true;
    });
    const options = {
      mode: this.mode,
      targetKB: this.targetKB,
      maxEdge: this.maxEdge,
      cropCompress: this.cropCompress,
      accept: this.accept,
    };
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (item.error === 'decode') continue;
      try {
        const out = await processImage(item.blob, item.type, {
          ...options,
          crop: item.crop,
        });
        if (seq !== this.runSeq) return;
        if (item.result) URL.revokeObjectURL(item.result.url);
        item.result = {
          ...out,
          url: out.untouched ? item.url : URL.createObjectURL(out.blob),
        };
        item.error = '';
      } catch (err) {
        if (seq !== this.runSeq) return;
        item.result = null;
        item.error = String((err as Error)?.message || err);
      }
      runInAction(() => {
        this.items = this.items.slice();
      });
    }
    if (seq === this.runSeq) {
      runInAction(() => {
        this.processing = false;
      });
    }
  }

  public get totalBefore() {
    return this.items.reduce((n, it) => n + it.blob.size, 0);
  }

  public get totalAfter() {
    return this.items.reduce((n, it) => n + (it.result?.blob.size ?? it.blob.size), 0);
  }

  public async submit() {
    if (this.requestId < 0 || this.submitting) return;
    if (this.standalone) {
      // 本地压缩:主按钮=保存到下载目录,保存后关闭。
      runInAction(() => {
        this.submitting = true;
      });
      try {
        await this.download();
      } finally {
        this.requestId = -1;
        this.hide();
      }
      return;
    }
    if (this.mode === 'original') {
      this.finish({ action: 'original' });
      return;
    }
    runInAction(() => {
      this.submitting = true;
    });
    const files = await this.collectFiles();
    this.finish({ action: 'upload', files });
  }

  // 点击「直接上传」卡片:跳过处理,原图直接交回网页。
  public uploadOriginal() {
    if (this.requestId < 0 || this.submitting || this.standalone) return;
    this.finish({ action: 'original' });
  }

  // 把当前处理结果交给浏览器下载,弹窗保持打开,用户仍可继续上传。
  public async download() {
    if (this.downloading || !this.items.length) return;
    runInAction(() => {
      this.downloading = true;
    });
    try {
      const files = await this.collectFiles();
      await ipcRenderer.invoke('image-upload-download', files);
    } finally {
      runInAction(() => {
        this.downloading = false;
      });
    }
  }

  private async waitProcessed() {
    if (this.processing) {
      // 等这一轮算完再提交。
      if (this.debounce) {
        window.clearTimeout(this.debounce);
        this.debounce = null;
        await this.run();
      } else {
        await new Promise<void>((resolve) => {
          const check = () => (this.processing ? setTimeout(check, 50) : resolve());
          check();
        });
      }
    }
  }

  // 按当前模式取出每张图的结果("直接上传"模式下就是原图)。
  private async collectFiles() {
    if (this.mode !== 'original') await this.waitProcessed();
    return Promise.all(
      this.items.map(async (it) => {
        const res = this.mode === 'original' ? null : it.result;
        const blob = res && !res.untouched ? res.blob : it.blob;
        const type = res && !res.untouched ? res.type : it.type;
        return {
          name: renameForType(it.name, type),
          type,
          lastModified: it.lastModified,
          bytes: new Uint8Array(await blob.arrayBuffer()),
        };
      }),
    );
  }

  public cancel() {
    this.finish({ action: 'cancel' });
  }

  private finish(result: any) {
    const id = this.requestId;
    if (id < 0) return;
    if (this.standalone) {
      this.requestId = -1;
      this.hide();
      return;
    }
    ipcRenderer.send('image-upload-result', id, {
      ...result,
      // 取消不算"本站直接上传"的意愿。
      rememberSite: result.action !== 'cancel' && this.rememberSite,
    });
    this.requestId = -1;
    this.hide();
  }

  public openSettings() {
    const id = this.requestId;
    this.requestId = -1;
    ipcRenderer.send('image-upload-open-settings', id);
    this.hide();
  }

  public disable() {
    const id = this.requestId;
    this.requestId = -1;
    ipcRenderer.send('image-upload-disable', id);
    this.hide();
  }
}

export default new Store();
