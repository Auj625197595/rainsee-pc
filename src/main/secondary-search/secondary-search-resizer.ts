import { BrowserView, ipcMain } from 'electron';

import { AppWindow } from '../windows';
import type { SecondarySearchPanelManager } from './secondary-search-manager';

// 贴在双引擎搜索面板左缘的细长拖拽条。原生 BrowserView 会遮挡 React chrome 的
// 鼠标事件,这里用一个独立 nodeIntegration 视图捕获拖拽,回传新宽度。复刻 AiResizer。
export class SecondarySearchResizer {
  public browserView: BrowserView | null = null;
  public bounds: any = null;
  private attached = false;
  private channel: string;

  public constructor(
    private window: AppWindow,
    private manager: SecondarySearchPanelManager,
  ) {
    this.channel = `secondary-search-resizer-drag-${window.win.id}`;

    // ipcMain handler 构造时注册(轻量);BrowserView 延迟到 ensureView() 创建,
    // 避免启动即加载一个 resizer 进程。handler 不访问 browserView,无需判空。
    // 用 contentBounds.x + width - screenX(非 width - screenX),否则窗口不在
    // 屏幕最左(副屏/贴靠右半)时 screenX 偏移会让面板宽度算错。对齐 SidebarResizer。
    ipcMain.on(this.channel, (e, screenX: number) => {
      const b = this.window.win.getContentBounds();
      this.manager.setWidth(b.x + b.width - screenX);
    });
  }

  // 懒创建 BrowserView:面板首次显示(attach)时才构造 + loadURL;之后常驻到窗口关闭
  // (detach 只 removeBrowserView 不销毁,便于面板反复显隐复用)。
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

  // 内联 HTML:整条都是拖拽热区,按下后跟随鼠标移动用 screenX 回传。
  private html(): string {
    const body = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;height:100%;width:100%;overflow:hidden;
        cursor:ew-resize;background:transparent;}
      #h{height:100%;width:100%;}
      #h:hover{background:rgba(79,124,255,0.35);}
    </style></head><body><div id="h"></div>
    <script>
      const {ipcRenderer}=require('electron');
      let dragging=false;
      const send=(x)=>ipcRenderer.send('${this.channel}',Math.round(x));
      document.addEventListener('mousedown',(e)=>{dragging=true;e.preventDefault();});
      window.addEventListener('mousemove',(e)=>{if(dragging)send(e.screenX);});
      window.addEventListener('mouseup',()=>{dragging=false;});
      window.addEventListener('mouseleave',()=>{/*keep dragging across the gap*/});
    </script></body></html>`;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(body);
  }

  public attach() {
    this.ensureView();
    if (!this.browserView) return;
    if (this.attached) {
      // 重新置顶,确保在面板之上可点
      this.window.win.removeBrowserView(this.browserView);
    }
    this.window.win.addBrowserView(this.browserView);
    this.attached = true;
  }

  public detach() {
    if (!this.attached || !this.browserView) return;
    this.window.win.removeBrowserView(this.browserView);
    this.attached = false;
  }

  public setBounds(b: { x: number; y: number; width: number; height: number }) {
    this.bounds = b;
    if (this.browserView) this.browserView.setBounds(b);
  }

  public destroy() {
    try {
      ipcMain.removeAllListeners(this.channel);
      if (
        this.browserView &&
        !this.browserView.webContents.isDestroyed()
      ) {
        (this.browserView.webContents as any).destroy();
      }
    } catch (e) {
      // ignore
    }
    this.browserView = null;
  }
}
