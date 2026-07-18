import { ipcRenderer } from 'electron';
import { observable, makeObservable, toJS } from 'mobx';
import { DialogStore } from '~/models/dialog-store';
import { IBookmark } from '~/interfaces';

// 主进程 relayout 后下发的布局数据。渲染页据此切列渲染 + 定位 Panel。
export interface OverflowPayload {
  items: IBookmark[];
  cols: number;
  rowsPerCol: number;
  overflow: boolean; // 最左(末)列是否需要内部滚动
  panelX: number; // Panel 左上角窗口坐标 + 尺寸(absolute 定位)
  panelY: number;
  panelW: number;
  panelH: number;
}

export class Store extends DialogStore {
  public items: IBookmark[] = [];
  public cols = 1;
  public rowsPerCol = 1;
  public overflow = false;
  public panelX = 0;
  public panelY = 0;
  public panelW = 0;
  public panelH = 0;

  public constructor() {
    // persistent:常驻复用秒开。
    // hideOnBlur:false:全屏 Backdrop 已捕获点击关闭,blur 关闭多余。
    // 关闭统一靠 Backdrop 点击 / 切标签(hideAllPersistent)/ 窗口 resize/move / Esc。
    // visibilityWrapper:false:自己监听 'visible'(主进程 hide 时下发 false)。
    super({ persistent: true, hideOnBlur: false, visibilityWrapper: false });

    makeObservable(this, {
      items: observable,
      cols: observable,
      rowsPerCol: observable,
      overflow: observable,
      panelX: observable,
      panelY: observable,
      panelW: observable,
      panelH: observable,
    });

    ipcRenderer.on('visible', (e, flag: boolean) => {
      this.visible = flag;
    });

    ipcRenderer.on('data', (e, p: OverflowPayload) => {
      this.items = p.items || [];
      this.cols = p.cols;
      this.rowsPerCol = p.rowsPerCol;
      this.overflow = p.overflow;
      this.panelX = p.panelX;
      this.panelY = p.panelY;
      this.panelW = p.panelW;
      this.panelH = p.panelH;
      this.visible = true;
    });

    // Esc 关闭浮层
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeAll();
    });
  }

  // 打开网页书签:新建标签 + 关闭浮层。
  public openBookmark(url: string) {
    if (!url) return;
    ipcRenderer.send(`add-tab-${this.windowId}`, { url, active: true });
    this.closeAll();
  }

  // 右键书签项 → 复用书签栏的「编辑/删除」原生菜单。
  // 主进程用 ipcMain.handle 注册,故须用 invoke;toJS 拍平 mobx proxy。
  public showContextMenu(item: IBookmark) {
    ipcRenderer.invoke(
      `show-bookmarks-bar-context-menu-${this.windowId}`,
      toJS(item),
    );
  }

  // 文件夹 → 弹原生单列子菜单(最初的子文件夹样子)。
  // rect 必须在组件同步 handler 里取(getBoundingClientRect)再传入。
  private folderTimer: number | undefined;

  // 悬停:短暂延迟后弹子菜单(主进程同 folderId 已开则保持,不重复弹)。
  public hoverFolder(folderId: string, rect: DOMRect) {
    if (this.folderTimer) window.clearTimeout(this.folderTimer);
    this.folderTimer = window.setTimeout(() => {
      this.folderTimer = undefined;
      ipcRenderer.send(
        `bookmark-overflow-folder-hover-${this.windowId}`,
        folderId,
        Math.floor(rect.right),
        Math.floor(rect.top),
      );
    }, 150);
  }

  // 点击文件夹:主进程 toggle(已开则关,未开则弹)。绕过 hover 延迟,立即生效。
  public clickFolder(folderId: string, rect: DOMRect) {
    if (this.folderTimer) {
      window.clearTimeout(this.folderTimer);
      this.folderTimer = undefined;
    }
    ipcRenderer.send(
      `bookmark-overflow-folder-click-${this.windowId}`,
      folderId,
      Math.floor(rect.right),
      Math.floor(rect.top),
    );
  }

  public leaveFolder() {
    if (this.folderTimer) {
      window.clearTimeout(this.folderTimer);
      this.folderTimer = undefined;
    }
  }

  // 全屏 Backdrop 点击 → 关闭浮层。箭头函数:作为 onClick 引用时 this 绑定实例。
  public backdropClick = () => {
    this.closeAll();
  };

  private closeAll() {
    ipcRenderer.send(`bookmark-overflow-close-all-${this.windowId}`);
  }
}

export default new Store();
