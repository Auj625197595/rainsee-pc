import { existsSync, readFileSync, writeFileSync } from 'fs';

import { getPath } from '~/utils';
import { AppWindow } from '../windows';
import { SidePanelView } from './side-panel-view';
import { SidePanelResizer } from './side-panel-resizer';

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const MAX_WIDTH = 720;

// 面板宽度持久化(独立文件,避免与其他面板配置冲突)。
const widthPath = () => getPath('side-panel.json');

// 每个窗口一个:管理「每标签一个」的扩展 sidePanel 侧边面板,负责显隐、切标签
// 联动、宽度。结构复刻 AiPanelManager,与 AI/订阅面板互斥(同侧只能一个)。
export class SidePanelManager {
  private panels = new Map<number, SidePanelView>();
  private resizer: SidePanelResizer;
  public width = DEFAULT_WIDTH;
  // 当前可见面板所属的标签 id(0 表示无)
  public visibleTabId = 0;

  public constructor(private window: AppWindow) {
    this.loadWidth();
    this.resizer = new SidePanelResizer(window, this);
  }

  private loadWidth() {
    try {
      if (existsSync(widthPath())) {
        const w = JSON.parse(readFileSync(widthPath(), 'utf8'))?.width;
        if (typeof w === 'number') this.width = this.clamp(w);
      }
    } catch (e) {
      // ignore
    }
  }

  private clamp(w: number) {
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(w)));
  }

  public setWidth(w: number) {
    this.width = this.clamp(w);
    try {
      writeFileSync(widthPath(), JSON.stringify({ width: this.width }));
    } catch (e) {
      // ignore
    }
    this.window.viewManager.fixBounds();
  }

  public get isVisible() {
    return this.visibleTabId !== 0;
  }

  // 显示指定标签的扩展面板(没有则创建),加载 chrome-extension:// URL。
  public show(extensionId: string, tabId: number, panelPath: string) {
    if (!this.window.viewManager.views.get(tabId)) return;
    // 与双引擎面板互斥:打开 sidePanel 时收起它。
    this.window.secondarySearchPanels?.hideCurrent();
    // 隐藏其它已显示的面板视图
    if (this.visibleTabId && this.visibleTabId !== tabId) {
      this.detach(this.visibleTabId);
    }
    let panel = this.panels.get(tabId);
    if (!panel) {
      panel = new SidePanelView(this.window, tabId, extensionId);
      this.panels.set(tabId, panel);
    }
    this.visibleTabId = tabId;
    this.window.win.addBrowserView(panel.headerView);
    this.window.win.addBrowserView(panel.browserView);
    this.resizer.attach();
    panel.visible = true;
    void panel.load(extensionId, panelPath);
    this.window.viewManager.fixBounds();
    this.notify(true);
  }

  public hideCurrent() {
    if (!this.visibleTabId) return;
    this.detach(this.visibleTabId);
    this.visibleTabId = 0;
    this.window.viewManager.fixBounds();
    this.notify(false);
  }

  private detach(tabId: number) {
    const panel = this.panels.get(tabId);
    if (panel && panel.browserView) {
      this.window.win.removeBrowserView(panel.headerView);
      this.window.win.removeBrowserView(panel.browserView);
      panel.markDismissed();
    }
    this.resizer.detach();
  }

  // 切换标签时调用:新标签若曾开过 sidePanel 则恢复其面板,否则收起。
  public onTabActivated(tabId: number) {
    if (!this.isVisible) return;
    const prev = this.visibleTabId;
    if (prev && prev !== tabId) this.detach(prev);
    if (this.panels.has(tabId)) {
      this.visibleTabId = tabId;
      const panel = this.panels.get(tabId)!;
      this.window.win.addBrowserView(panel.headerView);
      this.window.win.addBrowserView(panel.browserView);
      this.resizer.attach();
      panel.visible = true;
      this.window.viewManager.fixBounds();
      this.notify(true);
    } else {
      this.visibleTabId = 0;
      this.notify(false);
    }
  }

  // 标签关闭时销毁其面板。
  public onTabRemoved(tabId: number) {
    const panel = this.panels.get(tabId);
    if (!panel) return;
    if (this.visibleTabId === tabId) {
      this.window.win.removeBrowserView(panel.headerView);
      this.window.win.removeBrowserView(panel.browserView);
      this.resizer.detach();
      this.visibleTabId = 0;
      this.notify(false);
    }
    panel.destroy();
    this.panels.delete(tabId);
  }

  // 当前可见面板的 BrowserView(供 fixBounds 计算时取用)。
  public get currentPanel(): SidePanelView | null {
    return this.visibleTabId ? this.panels.get(this.visibleTabId) : null;
  }

  public get resizerView() {
    return this.resizer;
  }

  private notify(visible: boolean) {
    this.window.send('side-panel-visibility', visible);
  }

  public destroy() {
    for (const panel of this.panels.values()) panel.destroy();
    this.panels.clear();
    this.resizer.destroy();
    this.visibleTabId = 0;
  }
}
