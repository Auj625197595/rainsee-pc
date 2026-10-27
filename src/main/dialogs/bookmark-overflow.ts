import { BrowserWindow, screen } from 'electron';
import { PersistentDialog } from './dialog';
import { IBookmark } from '~/interfaces';

// 书签栏「更多按钮」多列溢出菜单的几何参数。
// 列宽对齐搜索引擎下拉(240),向左生长:第 1 列紧贴更多按钮(最右),填满后向左开新列。
const COL_WIDTH = 240;
const ROW_HEIGHT = 30;
const COL_GAP = 6;
const PADDING = 8;
// 菜单底边距窗口底部至少留这么多,避免贴边
const BOTTOM_RESERVE = 12;

interface ILayout {
  cols: number; // 实际渲染列数
  rowsPerCol: number; // 每列可放行数(由屏幕高度决定)
  overflow: boolean; // 最左列是否需要内部滚动(总项数超过 屏幕宽×高 容量)
  totalW: number; // 内容总宽(含内边距)
  viewH: number; // 内容总高
}

export interface BookmarkOverflowOpenOptions {
  align?: 'start' | 'end';
  rootFolderId?: string;
  barFolderAnchors?: BookmarkBarFolderAnchor[];
  barDropAnchors?: BookmarkBarDropAnchor[];
  barRect?: { left: number; right: number; top: number; bottom: number };
  barFolderId?: string;
  externalDragId?: string;
  externalDragPoint?: { x: number; y: number };
  // 根列表末尾追加的固定项(如「其他书签」「移动书签」静态文件夹),不参与排序/拖拽。
  tailItems?: IBookmark[];
  // 悬停唤起模式:指针离开该矩形(及其与面板之间的间隙)且不在面板内时自动关闭;
  // 浮层盖住锚点按钮,点击锚点区域打开 anchorClickUrl。
  hoverAnchor?: { left: number; right: number; top: number; bottom: number };
  anchorClickUrl?: string;
}

export interface BookmarkBarFolderAnchor {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface BookmarkBarDropAnchor extends BookmarkBarFolderAnchor {
  index: number;
  parentId: string;
  isFolder?: boolean;
}

// 按「向左生长」算多列布局。
// anchorX/anchorY = 菜单右边界(紧贴更多按钮左侧)/顶边的窗口坐标;
// winH = 窗口内容区高度,用以夹可用高度。
export function computeLayout(
  n: number,
  anchorX: number,
  anchorY: number,
  winH: number,
): ILayout {
  const count = Math.max(1, n); // 空列表也按 1 列占位(渲染端显示「空」)
  const availH = Math.max(
    ROW_HEIGHT + 2 * PADDING,
    winH - anchorY - BOTTOM_RESERVE,
  );
  const rowsPerCol = Math.max(1, Math.floor((availH - 2 * PADDING) / ROW_HEIGHT));
  // 向左可用宽度 = 锚点(菜单右边)到窗口左边的距离
  const availW = Math.max(COL_WIDTH + 2 * PADDING, anchorX);
  const maxCols = Math.max(
    1,
    Math.floor((availW + COL_GAP) / (COL_WIDTH + COL_GAP)),
  );
  const needCols = Math.ceil(count / rowsPerCol);
  const cols = Math.min(needCols, maxCols);
  const overflow = needCols > maxCols; // 装不下 → 最左列滚动
  const totalW = cols * COL_WIDTH + (cols - 1) * COL_GAP + 2 * PADDING;
  // 单列无需为潜在行数预留高度，应随实际条目数收紧；多列保持满列高度，
  // 使列间行高一致。溢出时则保留可用满高以提供内部滚动空间。
  const contentRows = cols === 1 ? count : rowsPerCol;
  const contentH = contentRows * ROW_HEIGHT + 2 * PADDING;
  // 溢出时满高(给最左列滚动空间);否则收紧到实际内容高,不留大段空白。
  const viewH = overflow ? availH : contentH;
  return { cols, rowsPerCol, overflow, totalW, viewH };
}

// 书签栏文件夹/「更多按钮」共用的书签浮层。全屏透明 Backdrop + absolute 定位
// 的 Panel,点窗口任意非菜单区域即关闭(modal)。
export class BookmarkOverflowDialog extends PersistentDialog {
  // 更多菜单以右边界为锚点向左生长；文件夹菜单以左边界为锚点向右展开。
  protected anchorX = 0;
  protected anchorTop = 0;
  protected openOptions: BookmarkOverflowOpenOptions = {};
  protected layout: ILayout = {
    cols: 1,
    rowsPerCol: 1,
    overflow: false,
    totalW: 0,
    viewH: 0,
  };
  private currentItems: IBookmark[] = [];
  private allItems: IBookmark[] = [];
  private rootFolderId = '';
  private barFolderAnchors: BookmarkBarFolderAnchor[] = [];

  public constructor() {
    // hideTimeout:关闭时渲染页先清空内容,留几帧让空白帧合成后再摘 BrowserView;
    // 否则重新挂载时 Chromium 会先显示摘除前的旧帧(上一次的书签列表)。
    super({ name: 'bookmark-overflow', hideTimeout: 80 });
    // 全屏 Backdrop 必须透明,否则白屏盖住整个窗口
    this.browserView.setBackgroundColor('#00000000');
  }

  // 重新计算布局并定位。open(首次显示)共用。
  protected relayout(items: IBookmark[], browserWindow: BrowserWindow) {
    const winBounds = browserWindow.getContentBounds();
    this.layout = computeLayout(
      items.length + (this.openOptions.tailItems?.length || 0),
      this.openOptions.align === 'start'
        ? winBounds.width - this.anchorX
        : this.anchorX,
      this.anchorTop,
      winBounds.height,
    );
    if (this.openOptions.align === 'start') {
      this.anchorX = Math.max(
        0,
        Math.min(this.anchorX, winBounds.width - this.layout.totalW),
      );
    }
    // BV 全屏:透明 Backdrop 覆盖整个窗口内容区,捕获任意处点击关闭(modal 行为)。
    // 实际菜单 Panel 由渲染页 absolute 定位到锚点(见 sendData)。
    super.rearrange({
      x: 0,
      y: 0,
      width: winBounds.width,
      height: winBounds.height,
    });
  }

  // 把当前 layout + items + Panel 锚点推给渲染页。
  private sendData() {
    const panelX =
      this.openOptions.align === 'start'
        ? this.anchorX
        : this.anchorX - this.layout.totalW;
    const payload = {
      items: this.currentItems,
      allItems: this.allItems,
      cols: this.layout.cols,
      rowsPerCol: this.layout.rowsPerCol,
      overflow: this.layout.overflow,
      reverseColumns: this.openOptions.align !== 'start',
      // Panel 左上角窗口坐标 + 尺寸(渲染页 absolute 定位)
      panelX,
      panelY: this.anchorTop,
      panelW: this.layout.totalW,
      panelH: this.layout.viewH,
      rootFolderId: this.rootFolderId,
      barFolderAnchors: this.barFolderAnchors,
      barDropAnchors: this.openOptions.barDropAnchors || [],
      barRect: this.openOptions.barRect,
      barFolderId: this.openOptions.barFolderId || '',
      externalDragId: this.openOptions.externalDragId || '',
      externalDragPoint: this.openOptions.externalDragPoint,
      tailItems: this.openOptions.tailItems || [],
      hoverAnchor: this.openOptions.hoverAnchor,
      anchorClickUrl: this.openOptions.anchorClickUrl || '',
      // 悬停模式下冷创建可能耗时较久,渲染页据此判断指针是否早已离开锚点。
      cursorPoint: this.openOptions.hoverAnchor
        ? this.getCursorPoint()
        : undefined,
    };
    console.log('[bookmark-drag-trace] popup sendData', {
      rootFolderId: payload.rootFolderId,
      externalDragId: payload.externalDragId,
      externalDragPoint: payload.externalDragPoint,
      hasBarRect: !!payload.barRect,
      dropAnchorCount: payload.barDropAnchors.length,
      panel: { x: payload.panelX, y: payload.panelY, w: payload.panelW, h: payload.panelH },
    });
    this.send('data', payload);
  }

  private getCursorPoint() {
    try {
      if (!this.browserWindow || this.browserWindow.isDestroyed()) return undefined;
      const bounds = this.browserWindow.getContentBounds();
      const cursor = screen.getCursorScreenPoint();
      return { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
    } catch {
      return undefined;
    }
  }

  private onBoundsUpdate = () => this.hide();

  public async open(
    browserWindow: BrowserWindow,
    anchorX: number,
    anchorY: number,
    items: IBookmark[],
    allItems: IBookmark[],
    options: BookmarkOverflowOpenOptions = {},
  ) {
    this.anchorX = anchorX;
    this.anchorTop = anchorY;
    this.openOptions = options;
    this.currentItems = items;
    this.allItems = allItems;
    this.rootFolderId = options.rootFolderId || '';
    this.barFolderAnchors = options.barFolderAnchors || [];

    // focus=false:不抢焦点。鼠标交互不依赖 focus。
    if (!(await super.show(browserWindow, false))) return;

    this.relayout(items, browserWindow);

    browserWindow.removeListener('resize', this.onBoundsUpdate);
    browserWindow.removeListener('move', this.onBoundsUpdate);
    browserWindow.on('resize', this.onBoundsUpdate);
    browserWindow.on('move', this.onBoundsUpdate);

    this.sendData();
  }

  public hide(bringToTop = false, hideVisually = true) {
    if (this.browserWindow) {
      this.browserWindow.removeListener('resize', this.onBoundsUpdate);
      this.browserWindow.removeListener('move', this.onBoundsUpdate);
    }
    super.hide(bringToTop, hideVisually);
  }
}
