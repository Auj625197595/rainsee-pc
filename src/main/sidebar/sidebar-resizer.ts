import {BrowserView, ipcMain} from 'electron';

import {AppWindow} from '../windows';
import {Application} from '../application';

// 标签页侧边栏与网页内容之间的拖拽条。
//
// 原生 BrowserView(网页内容)会遮挡 React chrome 的鼠标事件——向宽处拖动侧
// 边栏时鼠标会进入网页区域,renderer 收不到 mousemove。因此像「雨见AI」面板
// 那样,用一个独立的 nodeIntegration 视图捕获整段拖拽,回传鼠标屏幕坐标,由主
// 进程换算成新的侧边栏宽度。
//
// 与 AI/订阅/sidePanel 三个 resizer 同构:它们贴在「面板与网页」之间;本 resizer
// 贴在「侧边栏与网页」之间。区别在于宽度最终写入 settings.sidebarWidth(走统一
// 设置通道持久化),而非各自独立的 json 文件。
// 可点击区域比可见竖线宽，鼠标不必精确压在 2px 线上也能开始拖拽。
export const SIDEBAR_RESIZER_WIDTH = 8;

// 侧边栏宽度上下限。下限保证favicon+标题可读;上限避免占满大半窗口。
const MIN_WIDTH = 180;
const MAX_WIDTH = 560;
// 给网页内容至少留这么多 px。
const MIN_CONTENT = 360;
// 双击重置回的默认宽度(与 DEFAULT_SETTINGS.sidebarWidth 一致)。
const DEFAULT_WIDTH = 240;

export class SidebarResizer {
  public browserView: BrowserView | null = null;
  public bounds: any = null;
  private attached = false;
  private startChannel: string;
  private moveChannel: string;
  private endChannel: string;
  private resetChannel: string;
  // 最近一次拖拽算出的宽度,mouseup 时落盘。
  private lastWidth: number | null = null;

  public constructor(private window: AppWindow) {
    const id = window.win.id;
    this.startChannel = `sidebar-resizer-start-${id}`;
    this.moveChannel = `sidebar-resizer-move-${id}`;
    this.endChannel = `sidebar-resizer-end-${id}`;
    this.resetChannel = `sidebar-resizer-reset-${id}`;

    // BrowserView 延迟到 ensureView() 创建(attach 时),避免启动即加载 resizer 进程。
    // 4 个 ipcMain handler 都不访问 browserView(只回算宽度 + updateSettings),无需判空。

    // 拖拽态单独通知 renderer，关闭侧栏宽度过渡，避免视觉位置持续落后鼠标。
    ipcMain.on(this.startChannel, () => {
      this.lastWidth = null;
      this.window.viewManager.beginSidebarResize();
      this.window.send('sidebar-resize-state', true);
    });

    // 拖拽中:按「鼠标屏幕X − 窗口内容左缘」(左栏)或「窗口内容右缘 − 鼠标X」
    // (右栏)换算宽度,实时下发给 renderer 即时改变 sidebarWidth,不落盘。
    // 注意用 getContentBounds().x 做屏幕坐标基准,窗口不在屏幕左缘时也正确
    // (ai-resizer 用 width-screenX 仅在窗口贴左时成立)。
    ipcMain.on(this.moveChannel, (e, screenX: number) => {
      const width = this.computeWidth(screenX);
      if (width === this.lastWidth) return;
      this.lastWidth = width;
      this.window.viewManager.resizeSidebarLive(width);
      this.window.send('sidebar-width-live', width);
    });

    // 松手:把最终宽度写回 settings(走统一队列,广播+落盘一次)。
    ipcMain.on(this.endChannel, () => {
      this.window.viewManager.endSidebarResize();
      this.window.send('sidebar-resize-state', false);
      if (this.lastWidth != null) {
        Application.instance.settings.updateSettings({
          sidebarWidth: this.lastWidth,
        });
        this.lastWidth = null;
      }
    });

    // 双击:重置为默认宽度。
    ipcMain.on(this.resetChannel, () => {
      this.lastWidth = DEFAULT_WIDTH;
      this.window.send('sidebar-width-live', DEFAULT_WIDTH);
      Application.instance.settings.updateSettings({
        sidebarWidth: DEFAULT_WIDTH,
      });
    });
  }

  // 懒创建 BrowserView:侧边栏首次显示(attach)时才构造 + loadURL;之后常驻到窗口关闭
  // (detach 只 removeBrowserView 不销毁,便于侧边栏反复显隐复用)。
  private ensureView() {
    if (this.browserView) return;
    const view = new BrowserView({
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      },
    });
    view.setBackgroundColor('#00000000');
    view.webContents.loadURL(this.html());
    this.browserView = view;
  }

  private get side(): 'left' | 'right' | 'top' {
    return Application.instance.settings.object.tabsLayout as any;
  }

  private computeWidth(screenX: number): number {
    const b = this.window.win.getContentBounds();
    const maxEff = Math.max(
      MIN_WIDTH,
      Math.min(MAX_WIDTH, b.width - MIN_CONTENT),
    );
    let w: number;
    if (this.side === 'right') {
      w = b.x + b.width - screenX;
    } else {
      w = screenX - b.x;
    }
    return Math.round(Math.max(MIN_WIDTH, Math.min(maxEff, w)));
  }

  // 内联 HTML:整条都是透明拖拽热区；hover/拖拽时只在中央显示细竖线。
  // Pointer Capture 很重要：按下后即使光标进入相邻的网页 BrowserView，移动与
  // 松手事件仍回到本视图，避免快速拖动时调宽中断或最终宽度没有落盘。
  private html(): string {
    const body = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;height:100%;width:100%;overflow:hidden;
        cursor:ew-resize;background:transparent;}
      #h{position:relative;height:100%;width:100%;touch-action:none;}
      #h::after{content:"";position:absolute;top:0;bottom:0;left:50%;
        width:2px;transform:translateX(-50%) scaleX(0);transform-origin:center;
        border-radius:2px;background:rgba(76,104,255,.88);opacity:0;
        box-shadow:0 0 0 1px rgba(255,255,255,.24),0 0 8px rgba(76,104,255,.34);
        transition:opacity .12s ease,transform .12s ease;pointer-events:none;}
      #h:hover::after,#h.dragging::after{opacity:1;transform:translateX(-50%) scaleX(1);}
    </style></head><body><div id="h"></div>
    <script>
      const {ipcRenderer}=require('electron');
      let dragging=false;
      let pointerId=null;
      let pendingScreenX=null;
      let moveFrame=0;
      const handle=document.getElementById('h');
      const flushMove=()=>{
        moveFrame=0;
        if(pendingScreenX==null)return;
        ipcRenderer.send('${this.moveChannel}',pendingScreenX);
        pendingScreenX=null;
      };
      const queueMove=(screenX)=>{
        pendingScreenX=Math.round(screenX);
        if(!moveFrame)moveFrame=requestAnimationFrame(flushMove);
      };
      const finish=()=>{
        if(!dragging)return;
        if(moveFrame){cancelAnimationFrame(moveFrame);moveFrame=0;}
        flushMove();
        dragging=false;
        handle.classList.remove('dragging');
        ipcRenderer.send('${this.endChannel}');
      };
      handle.addEventListener('pointerdown',(e)=>{
        if(e.button!==0)return;
        dragging=true;
        pointerId=e.pointerId;
        handle.classList.add('dragging');
        handle.setPointerCapture(pointerId);
        ipcRenderer.send('${this.startChannel}');
        e.preventDefault();
      });
      handle.addEventListener('pointermove',(e)=>{
        if(dragging)queueMove(e.screenX);
      });
      handle.addEventListener('pointerup',(e)=>{
        if(pointerId===e.pointerId&&handle.hasPointerCapture(pointerId)){
          handle.releasePointerCapture(pointerId);
        }
        pointerId=null;
        finish();
      });
      handle.addEventListener('pointercancel',()=>{pointerId=null;finish();});
      handle.addEventListener('lostpointercapture',()=>{pointerId=null;finish();});
      handle.addEventListener('dblclick',()=>{
        ipcRenderer.send('${this.resetChannel}');
      });
    </script></body></html>`;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(body);
  }

  public attach() {
    this.ensureView();
    if (!this.browserView) return;
    if (this.attached) return;
    this.window.win.addBrowserView(this.browserView);
    this.attached = true;
  }

  // 新选中的网页 BrowserView 会被 add 到最上层；把跨在边界中央的拖拽条重新
  // 提到网页之上，随后弹窗仍可按原有流程继续置顶。
  public bringToTop() {
    if (!this.attached || !this.browserView) return;
    this.window.win.removeBrowserView(this.browserView);
    this.window.win.addBrowserView(this.browserView);
  }

  public detach() {
    if (!this.attached || !this.browserView) return;
    this.window.win.removeBrowserView(this.browserView);
    this.attached = false;
  }

  public setBounds(b: {x: number; y: number; width: number; height: number}) {
    if (
      this.bounds &&
      this.bounds.x === b.x &&
      this.bounds.y === b.y &&
      this.bounds.width === b.width &&
      this.bounds.height === b.height
    ) {
      return;
    }
    this.bounds = b;
    if (this.browserView) this.browserView.setBounds(b);
  }

  public destroy() {
    try {
      ipcMain.removeAllListeners(this.startChannel);
      ipcMain.removeAllListeners(this.moveChannel);
      ipcMain.removeAllListeners(this.endChannel);
      ipcMain.removeAllListeners(this.resetChannel);
      if (this.browserView && !this.browserView.webContents.isDestroyed()) {
        (this.browserView.webContents as any).destroy();
      }
    } catch (e) {
      // ignore
    }
    this.browserView = null;
  }
}
