import { BrowserWindow } from 'electron';
import { PersistentDialog, getAppContentBounds } from './dialog';
import { Application } from '../application';
import { isValidThumbKey, loadTabThumbnail } from '../services/tab-thumbnails';

// 标签组总览:点击标签栏分组芯片后,在网页内容区把该组的每个标签页铺成一张卡片。
// 必须是独立 BrowserView(PersistentDialog)才能盖住网页 BrowserView;尺寸恒等于
// 内容区矩形。payload 由宿主(app.html)构建:{focusGroupId, selectedTabId,
// palette, groups:[{id, name, color, pinned, count, containsActive}], tabs:[...]}。
// 缩略图只有主进程拿得到(View.thumbnail),在这里补进 payload。
export class TabGroupOverviewDialog extends PersistentDialog {
  public payload: any = {};

  private watchedWindow: BrowserWindow | null = null;
  private resizeTimer: NodeJS.Timeout | null = null;

  // 本次打开期间已下发给渲染层的缩略图(tabId → dataURL)。缩略图是数百 KB 的
  // dataURL,刷新(标题/图标变化)时只增量下发变化的那几张,渲染层自行合并缓存。
  private sentThumbnails = new Map<number, string>();

  // 本次打开期间读过的磁盘预览图(thumbKey → dataURL,'' = 磁盘没有),避免每次
  // 刷新都重读文件。
  private diskThumbnails = new Map<string, string>();

  // 磁盘读取是异步的:只让最后一次 show/refresh 的结果下发,防止旧 payload 覆盖新的。
  private payloadSeq = 0;

  public constructor() {
    super({
      name: 'tabgroup-overview',
      bounds: { height: 400 },
      // 渲染层淡出 140ms,留足时间再摘 BrowserView。
      hideTimeout: 160,
    });
  }

  public rearrange() {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return;
    const area = getAppContentBounds(
      this.browserWindow,
      Application.instance.windows.fromBrowserWindow(this.browserWindow),
    );
    super.rearrange({
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
    });
  }

  private get viewManager() {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return null;
    return Application.instance.windows.fromBrowserWindow(this.browserWindow)
      ?.viewManager;
  }

  // 每张标签卡片的预览图。背景标签的截图在切走时缓存(ViewManager.select);
  // 没有内存截图的(重启后未加载的占位标签、崩溃丢弃的标签)按 thumbKey 读磁盘
  // 副本(services/tab-thumbnails);两者都没有时渲染层退回大图标占位。
  // 背景图取当前选中标签的截图。
  private async withThumbnails(payload: any) {
    const views = this.viewManager?.views;
    const thumbnails: { [tabId: number]: string } = {};
    const offer = (id: number, thumb: string) => {
      if (this.sentThumbnails.get(id) !== thumb) {
        this.sentThumbnails.set(id, thumb);
        thumbnails[id] = thumb;
      }
    };
    const take = (id: number) => {
      const thumb = views?.get(id)?.thumbnail;
      if (!thumb) return false;
      offer(id, thumb);
      return true;
    };

    const tabs: any[] = Array.isArray(payload?.tabs) ? payload.tabs : [];
    const fromDisk: any[] = [];
    for (const tab of tabs) {
      if (tab?.id == null) continue;
      if (!take(tab.id) && isValidThumbKey(tab.thumbKey)) fromDisk.push(tab);
    }
    await Promise.all(
      fromDisk.map(async (tab) => {
        let thumb = this.diskThumbnails.get(tab.thumbKey);
        if (thumb === undefined) {
          thumb = await loadTabThumbnail(tab.thumbKey);
          this.diskThumbnails.set(tab.thumbKey, thumb);
        }
        if (thumb) offer(tab.id, thumb);
      }),
    );

    const backdropId =
      payload?.selectedTabId != null && take(payload.selectedTabId)
        ? payload.selectedTabId
        : -1;

    return { ...payload, backdropId, thumbnails };
  }

  private notifyOwner(browserWindow: BrowserWindow, visible: boolean) {
    if (!browserWindow || browserWindow.isDestroyed()) return;
    // AppWindow.send 同时投递主渲染进程与沉浸头部镜像,两边都要同步开关态。
    Application.instance.windows
      .fromBrowserWindow(browserWindow)
      ?.send('tabgroup-overview-visibility', visible);
  }

  public async show(browserWindow: BrowserWindow, payload: any) {
    // 单例弹窗跨窗口复用:在别的窗口仍可见时,基类 show 会因 visible 直接返回而
    // 不挂到新窗口。先从旧窗口同步摘下。
    const previous = this.browserWindow;
    if (this.visible && previous && previous !== browserWindow) {
      if (!previous.isDestroyed()) previous.removeBrowserView(this.browserView);
      this.visible = false;
      this.unwatchResize();
      this.notifyOwner(previous, false);
    }

    const freshOpen = !this.visible;
    if (freshOpen) {
      this.sentThumbnails.clear();
      this.diskThumbnails.clear();
    }

    const seq = ++this.payloadSeq;
    this.browserWindow = browserWindow;
    const nextPayload = await this.withThumbnails(payload || {});
    // 读盘期间被收起或又来了新的 show/refresh:放弃这次结果。
    if (seq !== this.payloadSeq) return;
    this.payload = nextPayload;
    if (!(await super.show(browserWindow, true))) return;
    this.watchResize(browserWindow);
    this.send('visible', true, { ...this.payload, freshOpen });
    this.notifyOwner(browserWindow, true);

    // 当前标签可能从未截图或截图已过时:先用缓存秒开,再抓一帧补刷。
    // capturePage 抓的是网页自身表面,不受上方总览 BrowserView 遮挡影响。
    const selected = this.viewManager?.selected;
    if (!selected) return;
    const before = selected.thumbnail;
    await selected.captureThumbnail();
    if (this.visible && selected.thumbnail && selected.thumbnail !== before) {
      this.refresh(this.payload);
    }
  }

  public async refresh(payload: any) {
    if (!this.visible) return;
    const seq = ++this.payloadSeq;
    const nextPayload = await this.withThumbnails(payload || {});
    if (seq !== this.payloadSeq || !this.visible) return;
    this.payload = nextPayload;
    this.rearrange();
    this.send('visible', true, { ...this.payload, freshOpen: false });
  }

  public hide(bringToTop = false, hideVisually = true) {
    // 作废在途的 show/refresh(它们还在读盘),防止收起后又被重新打开。
    this.payloadSeq++;
    const wasVisible = this.visible;
    const owner = this.browserWindow;
    this.unwatchResize();
    super.hide(bringToTop, hideVisually);
    if (wasVisible) this.notifyOwner(owner, false);
  }

  public destroy() {
    this.unwatchResize();
    this.sentThumbnails.clear();
    this.diskThumbnails.clear();
    super.destroy();
  }

  // 窗口缩放/最大化时内容区矩形随之变化。ViewManager.fixBounds 是异步测量,
  // 稍等一拍再读 contentBounds,避免拿到旧矩形。
  private onWindowResize = () => {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      if (this.visible) this.rearrange();
    }, 60);
  };

  private onWindowClosed = () => this.unwatchResize();

  private watchResize(browserWindow: BrowserWindow) {
    if (this.watchedWindow === browserWindow) return;
    this.unwatchResize();
    this.watchedWindow = browserWindow;
    browserWindow.on('resize', this.onWindowResize);
    browserWindow.once('closed', this.onWindowClosed);
  }

  private unwatchResize() {
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    const win = this.watchedWindow;
    this.watchedWindow = null;
    if (!win || win.isDestroyed()) return;
    win.removeListener('resize', this.onWindowResize);
    win.removeListener('closed', this.onWindowClosed);
  }
}
