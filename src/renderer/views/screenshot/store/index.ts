import { ipcRenderer } from 'electron';
import { makeObservable, observable } from 'mobx';
import { createLocaleTranslator } from '~/common/i18n';
import { DialogStore } from '~/models/dialog-store';

// 浮层模式:idle=待框选, fullpage=长截图结果预览
export type Mode = 'idle' | 'fullpage';
export type CaptureSource = 'page' | 'desktop';

export class Store extends DialogStore {
  // 当前页快照(dataURL),铺满浮层做 1:1 背景
  public snapshot = '';
  // 桌面截图快照(原始像素解码而来),与 snapshot 二选一
  public snapshotBitmap: ImageBitmap | null = null;
  // 每次 visible 自增,丢弃过期的异步解码结果
  private snapshotToken = 0;
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
      snapshotBitmap: observable.ref,
      longshot: observable,
      mode: observable,
      capturing: observable,
      hint: observable,
      source: observable,
    });

    ipcRenderer.on('visible', (e, flag, data) => {
      this.visible = flag;
      this.visibleAt = performance.now();
      this.snapshotToken += 1;
      if (!flag) return;
      this.reset();
      if (!data) return;
      this.source = data.source === 'desktop' ? 'desktop' : 'page';
      if (data.bitmap && data.width > 0 && data.height > 0) {
        void this.decodeBitmap(data.bitmap, data.width, data.height);
      } else {
        this.snapshot = data.snapshot || '';
      }
    });

    ipcRenderer.on('screenshot-save-result', (e, data) => {
      console.warn('[ss-r] save-result', data);
      if (data && data.canceled) return;
      this.setHint(
      data && data.ok
        ? createLocaleTranslator(this.settings.language)('shotSaved')
        : createLocaleTranslator(this.settings.language)('shotSaveFailed'),
    );
    });

    ipcRenderer.on('screenshot-copy-result', (e, data) => {
      console.warn('[ss-r] copy-result', data);
      this.setHint(
      data && data.ok
        ? createLocaleTranslator(this.settings.language)('shotCopied')
        : createLocaleTranslator(this.settings.language)('shotCopyFailed'),
    );
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
        this.setHint(createLocaleTranslator(this.settings.language)('shotLongFailed'));
      }
    });
  }

  // 桌面截图:主进程直接发 BGRA 原始像素(省掉主线程 PNG 编码 ~360ms),
  // 这里转成 RGBA 并解码为 ImageBitmap。
  private async decodeBitmap(raw: Uint8Array, width: number, height: number) {
    const token = this.snapshotToken;
    const decodeStart = performance.now();
    const length = width * height * 4;
    if (raw.byteLength < length) {
      console.error('[ss-r] bitmap too small', raw.byteLength, width, height);
      return;
    }
    // Uint32Array 需要 4 字节对齐;IPC 收到的视图一般从 0 开始,不对齐时复制一份。
    const bytes =
      raw.byteOffset % 4 === 0 ? raw : new Uint8Array(raw.subarray(0, length));
    const pixels = new Uint32Array(bytes.buffer, bytes.byteOffset, width * height);
    // 小端 BGRA -> RGBA:交换 R/B 两个字节,G/A 不动
    for (let i = 0; i < pixels.length; i += 1) {
      const v = pixels[i];
      pixels[i] = (v & 0xff00ff00) | ((v & 0xff) << 16) | ((v >>> 16) & 0xff);
    }
    const imageData = new ImageData(
      new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, length),
      width,
      height,
    );
    const bitmap = await createImageBitmap(imageData);
    if (token !== this.snapshotToken) {
      bitmap.close();
      return;
    }
    console.warn(
      `[ss-perf-r] bitmap decoded ${Math.round(performance.now() - decodeStart)}ms +${Math.round(performance.now() - this.visibleAt)}ms`,
    );
    this.setSnapshotBitmap(bitmap);
  }

  private setSnapshotBitmap(bitmap: ImageBitmap | null) {
    if (this.snapshotBitmap && this.snapshotBitmap !== bitmap) {
      this.snapshotBitmap.close();
    }
    this.snapshotBitmap = bitmap;
  }

  public get hasSnapshot() {
    return !!this.snapshotBitmap || !!this.snapshot;
  }

  // 统一取快照绘制源:桌面截图是 ImageBitmap,页面截图是 PNG dataURL
  public async loadSnapshot(): Promise<{
    image: CanvasImageSource;
    width: number;
    height: number;
  } | null> {
    const bitmap = this.snapshotBitmap;
    if (bitmap) return { image: bitmap, width: bitmap.width, height: bitmap.height };
    if (!this.snapshot) return null;
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = this.snapshot;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight };
  }

  public reset() {
    this.setSnapshotBitmap(null);
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

  public askAI(dataURL: string) {
    this.send('screenshot-ai', dataURL);
  }

  public longCapture() {
    if (this.capturing) return;
    this.capturing = true;
    this.send('screenshot-longshot');
  }

  public activateDesktopDisplay() {
    if (this.source === 'desktop') this.send('screenshot-activate');
  }

  // 收到 visible 的时间戳,用于诊断 IPC→图片解码→绘制 各段耗时
  private visibleAt = 0;

  public desktopSnapshotPainted() {
    if (this.source !== 'desktop') return;
    const loadedAt = performance.now();
    requestAnimationFrame(() => {
      const raf1 = performance.now();
      requestAnimationFrame(() => {
        const raf2 = performance.now();
        console.warn(
          `[ss-perf-r] snapshot drawn +${Math.round(loadedAt - this.visibleAt)}ms raf1 +${Math.round(raf1 - this.visibleAt)}ms raf2 +${Math.round(raf2 - this.visibleAt)}ms`,
        );
        this.send('screenshot-render-ready');
      });
    });
  }
}

export default new Store();
