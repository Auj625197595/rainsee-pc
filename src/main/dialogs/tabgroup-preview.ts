import { BrowserWindow } from 'electron';
import { PersistentDialog } from './dialog';

// 标签组悬停列表弹窗。必须是独立 BrowserView(PersistentDialog),才能浮在网页
// BrowserView 之上——app.html 里的 DOM(哪怕 portal 到 body)在内容区会被网页
// BrowserView 遮挡。payload 由宿主(app.html)构建并经主进程透传:{groupId,
// groupName, groupColor, tabs:[{id,title,favicon,selected}], x, y, width, height}。
export class TabGroupPreviewDialog extends PersistentDialog {
  // 最近一次定位信息,供 rearrange(窗口尺寸变化时)复用。
  public payload: any = {};

  public constructor() {
    super({
      name: 'tabgroup-preview',
      bounds: { height: 200 },
      hideTimeout: 150,
    });
  }

  public rearrange() {
    const p = this.payload;
    if (p && p.x != null) {
      super.rearrange({
        x: p.x,
        y: p.y,
        width: p.width || 280,
        height: p.height || 200,
      });
    }
  }

  public async show(browserWindow: BrowserWindow, payload: any) {
    this.payload = payload || {};
    await super.show(browserWindow, false);
    this.send('visible', true, payload);
  }
}
