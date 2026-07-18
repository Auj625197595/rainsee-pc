import { BrowserWindow } from 'electron';
import { PersistentDialog } from './dialog';

// 侧边栏「缩放模式」悬停浮层。窄轨(62px)常驻在侧边栏位置,鼠标移入窄轨时弹出
// 这个浮层——它是独立 BrowserView(PersistentDialog),才能浮在网页 BrowserView
// 之上(app.html 里的 DOM 在内容区会被网页 BrowserView 遮挡)。
//
// 与 tabgroup-preview 完全同构:payload 由宿主(app.html)构建并经主进程透传,
// 浮层渲染出与固定模式一致的完整侧边栏,交互经 IPC 回传宿主执行。
// payload: { side, groupsCollapsed, pinned, tabs:[...], x, y, width, height }。
export class SidebarPanelDialog extends PersistentDialog {
  // 最近一次定位信息,供 rearrange(窗口尺寸变化时)复用。
  public payload: any = {};

  public constructor() {
    super({
      name: 'sidebar-panel',
      bounds: { height: 400 },
      hideTimeout: 150,
    });
  }

  public rearrange() {
    const p = this.payload;
    if (p && p.x != null) {
      super.rearrange({
        x: p.x,
        y: p.y,
        width: p.width || 260,
        height: p.height || 400,
      });
    }
  }

  public async show(browserWindow: BrowserWindow, payload: any) {
    this.payload = payload || {};
    await super.show(browserWindow, false);
    this.send('visible', true, payload);
  }
}
