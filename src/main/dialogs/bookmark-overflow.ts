import { BrowserWindow } from 'electron';
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
  const contentH = rowsPerCol * ROW_HEIGHT + 2 * PADDING;
  // 溢出时满高(给最左列滚动空间);否则收紧到实际内容高,不留大段空白。
  const viewH = overflow ? availH : contentH;
  return { cols, rowsPerCol, overflow, totalW, viewH };
}

// 书签栏「更多按钮」多列溢出菜单浮层。全屏透明 Backdrop + absolute 定位的 Panel,
// 点窗口任意非菜单区域即关闭(modal)。子文件夹不再用二级浮层,而是沿用最初的
// 原生单列菜单(createDropdown + popup),由 messaging 的 folder-menu IPC 触发。
export class BookmarkOverflowDialog extends PersistentDialog {
  // 菜单右边界(紧贴更多按钮)的窗口坐标。布局固定「右边贴锚点、向左生长」。
  protected anchorRight = 0;
  protected anchorTop = 0;
  protected layout: ILayout = {
    cols: 1,
    rowsPerCol: 1,
    overflow: false,
    totalW: 0,
    viewH: 0,
  };
  private currentItems: IBookmark[] = [];

  public constructor() {
    super({ name: 'bookmark-overflow' });
    // 全屏 Backdrop 必须透明,否则白屏盖住整个窗口
    this.browserView.setBackgroundColor('#00000000');
  }

  // 重新计算布局并定位。open(首次显示)共用。
  protected relayout(items: IBookmark[], browserWindow: BrowserWindow) {
    const winBounds = browserWindow.getContentBounds();
    this.layout = computeLayout(
      items.length,
      this.anchorRight,
      this.anchorTop,
      winBounds.height,
    );
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
    this.send('data', {
      items: this.currentItems,
      cols: this.layout.cols,
      rowsPerCol: this.layout.rowsPerCol,
      overflow: this.layout.overflow,
      // Panel 左上角窗口坐标 + 尺寸(渲染页 absolute 定位)
      panelX: this.anchorRight - this.layout.totalW,
      panelY: this.anchorTop,
      panelW: this.layout.totalW,
      panelH: this.layout.viewH,
    });
  }

  private onBoundsUpdate = () => this.hide();

  public async open(
    browserWindow: BrowserWindow,
    anchorX: number,
    anchorY: number,
    items: IBookmark[],
  ) {
    this.anchorRight = anchorX;
    this.anchorTop = anchorY;
    this.currentItems = items;

    // waitForLoad=true:首次(未预热完)时等渲染页 dom-ready 再 addBrowserView 显示,
    // 避免白屏 + send('data') 时 store 还没注册监听导致 items 丢失(只剩空面板);
    // 已预热(loaded=true)时 show 会跳过等待,照样秒开。
    // focus=false:不抢焦点。鼠标交互不依赖 focus。
    await super.show(browserWindow, false, true);

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
