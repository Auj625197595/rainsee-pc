import {observable, action, computed, makeObservable, runInAction} from 'mobx';

export interface ImageItem {
  url: string;
  width: number;
  height: number;
  alt: string;
  type: string; // img | picture | link | poster | background
}

interface CollectedPayload {
  images: ImageItem[];
  initialPreviewUrl?: string;
  pageUrl: string;
  referrer: string;
  referer: string;
  cookies: string;
  userAgent: string;
}

export type ViewMode = 'grid' | 'list' | 'strip';

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname || 'image';
  } catch {
    return 'image';
  }
};

const extOf = (url: string): string => {
  const m = url
    .split('?')[0]
    .split('#')[0]
    .match(/\.([a-z0-9]{2,4})$/i);
  return m ? m[1].toLowerCase() : 'jpg';
};

export class Store {
  @observable public images: ImageItem[] = [];
  @observable public viewMode: ViewMode = 'grid';
  @observable public selected = new Set<string>();
  @observable public loading = true;
  @observable public error = false;
  @observable public previewIndex = -1;

  // ZIP 打包进度
  @observable public zipping = false;
  @observable public zipDone = 0;
  @observable public zipTotal = 0;

  // 页面右下角瞬时提示
  @observable public toast = '';
  private toastTimer: any = null;

  // 防盗链头(下载时原样带回主进程)
  public pageUrl = '';
  public referer = '';
  public cookies = '';
  public userAgent = '';

  @computed get count() {
    return this.images.length;
  }
  @computed get selectedCount() {
    return this.selected.size;
  }
  @computed get allSelected() {
    return this.images.length > 0 && this.selected.size === this.images.length;
  }
  @computed get previewItem(): ImageItem | null {
    return this.previewIndex >= 0 ? this.images[this.previewIndex] : null;
  }

  public constructor() {
    makeObservable(this);
    this.boot();
  }

  private boot() {
    // ZIP 进度回调(view-preload 把 main 的 image-viewer-zip-progress 转发到这里)。
    (window as any).imageViewerZipProgress = (data: {done: number; total: number}) => {
      runInAction(() => {
        this.zipDone = data.done;
        this.zipTotal = data.total;
      });
    };

    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const inv = (window as any).ipcInvoke;
    if (!id || typeof inv !== 'function') {
      this.loading = false;
      this.error = true;
      return;
    }
    inv('image-viewer-get', id)
      .then((data: CollectedPayload | null) => this.setPayload(data))
      .catch(() => {
        runInAction(() => {
          this.loading = false;
          this.error = true;
        });
      });
  }

  @action public setPayload(data: CollectedPayload | null) {
    if (!data || !Array.isArray(data.images) || data.images.length === 0) {
      this.loading = false;
      this.error = true;
      return;
    }
    this.images = data.images;
    if (data.initialPreviewUrl) {
      const initialIndex = data.images.findIndex(
        (item) => item.url === data.initialPreviewUrl,
      );
      this.previewIndex = initialIndex;
    }
    this.pageUrl = data.pageUrl || '';
    this.referer = data.referer || data.pageUrl || '';
    this.cookies = data.cookies || '';
    this.userAgent = data.userAgent || '';
    this.loading = false;
  }

  @action public setView(v: ViewMode) {
    this.viewMode = v;
  }

  @action public toggleSelect(url: string) {
    if (this.selected.has(url)) this.selected.delete(url);
    else this.selected.add(url);
  }

  @action public selectAll() {
    this.selected = new Set(this.images.map((i) => i.url));
  }

  @action public clearSelection() {
    this.selected = new Set();
  }

  @action public toggleSelectAll() {
    if (this.allSelected) this.clearSelection();
    else this.selectAll();
  }

  @action public openPreview(idx: number) {
    this.previewIndex = idx;
  }
  @action public closePreview() {
    this.previewIndex = -1;
  }
  @action public previewNext() {
    if (this.previewIndex < this.images.length - 1) this.previewIndex++;
  }
  @action public previewPrev() {
    if (this.previewIndex > 0) this.previewIndex--;
  }

  @action public showToast(msg: string) {
    this.toast = msg;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      runInAction(() => {
        this.toast = '';
      });
    }, 2400);
  }

  private dlHeaders() {
    const h: Record<string, string> = {};
    if (this.referer) h['Referer'] = this.referer;
    if (this.cookies) h['Cookie'] = this.cookies;
    if (this.userAgent) h['User-Agent'] = this.userAgent;
    return h;
  }

  // 逐张下载选中图片(复用 MediaDownloadManager → 原生下载面板)。
  public downloadSelected() {
    const targets = this.images.filter((i) => this.selected.has(i.url));
    if (!targets.length) return;
    const inv = (window as any).ipcInvoke;
    if (typeof inv !== 'function') {
      this.showToast('下载不可用');
      return;
    }
    const ts = Date.now();
    targets.forEach((item, idx) => {
      inv('media-download', {
        url: item.url,
        mediaType: 'other',
        headers: this.dlHeaders(),
        fileName: `${hostOf(item.url)}-${ts}-${idx + 1}.${extOf(item.url)}`,
      }).catch(() => undefined);
    });
    this.showToast(`已添加 ${targets.length} 个到下载面板`);
  }

  public downloadOne(item: ImageItem) {
    const inv = (window as any).ipcInvoke;
    if (typeof inv !== 'function') {
      this.showToast('下载不可用');
      return;
    }
    inv('media-download', {
      url: item.url,
      mediaType: 'other',
      headers: this.dlHeaders(),
      fileName: `${hostOf(item.url)}-${Date.now()}.${extOf(item.url)}`,
    }).catch(() => undefined);
    this.showToast('已添加到下载面板');
  }

  // 打包选中图片为 zip(主进程逐张拉取 + jszip)。
  public async downloadZip() {
    const targets = this.images.filter((i) => this.selected.has(i.url));
    if (!targets.length) return;
    const inv = (window as any).ipcInvoke;
    if (typeof inv !== 'function') {
      this.showToast('下载不可用');
      return;
    }
    runInAction(() => {
      this.zipping = true;
      this.zipDone = 0;
      this.zipTotal = targets.length;
    });
    try {
      // 元数据转纯对象(MobX observable 不可直接过 IPC)。
      const payload = targets.map((t) => ({
        url: t.url,
        width: t.width,
        height: t.height,
        alt: t.alt,
        type: t.type,
      }));
      const res = await inv('image-viewer-pack-zip', {
        images: payload,
        referer: this.referer,
        cookie: this.cookies,
        userAgent: this.userAgent,
      });
      runInAction(() => {
        this.zipping = false;
      });
      if (res && res.ok) {
        this.showToast(`已打包 ${res.count} 张到下载目录`);
      } else {
        this.showToast('打包失败:' + (res && res.error ? res.error : ''));
      }
    } catch (e) {
      runInAction(() => {
        this.zipping = false;
      });
      this.showToast('打包失败');
    }
  }
}

export default new Store();
