import { existsSync, readFileSync, writeFileSync } from 'fs';

import { getPath } from '~/utils';
import { AppWindow } from '../windows';
import { SecondarySearchPanel } from './secondary-search-panel';
import { SecondarySearchResizer } from './secondary-search-resizer';
import { extractSearchQuery } from '~/utils/url';

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const MAX_WIDTH = 720;

// 面板宽度持久化(跨会话记忆,独立文件避免与其他面板配置冲突)。
const widthPath = () => getPath('dual-search-panel.json');

// 「搜索页面 ↔ 面板」绑定关系:每个发起过搜索的标签持有自己的面板,二者同生共灭。
//  - 搜索触发 → 为该标签建面板并显示;
//  - 切到「有面板」的标签 → 显示它的面板;切到「无面板」的标签 → 收起;
//    切回仍在搜索的标签 → 面板恢复(关键:无论当前是否可见都重新评估);
//  - 某标签主帧导航离开搜索结果页(点结果进详情/输入新网址)→ 销毁该标签面板(绑定解除,
//    切回也不再显示);
//  - 点告知条 ✕ / 关标签 → 销毁该标签面板;
//  - 面板与主网页之间的分割线可拖拽调宽,位置持久化(复刻雨见 AI);
//  - 与 AI/订阅/sidePanel 同侧互斥。
export class SecondarySearchPanelManager {
  private panels = new Map<number, SecondarySearchPanel>();
  // 每个被搜索标签的导航监听器(用于判定「是否还在搜索结果页」)。
  private watchers = new Map<
    number,
    { primaryEngineUrl: string; fn: (...args: any[]) => void }
  >();
  private resizer: SecondarySearchResizer;
  public width = DEFAULT_WIDTH;
  public visibleTabId = 0;

  public constructor(private window: AppWindow) {
    this.loadWidth();
    this.resizer = new SecondarySearchResizer(window, this);
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

  // 拖拽分割线时调用:钳制 + 持久化 + 重排。
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

  // fixBounds 计算分割线位置时取用。
  public get resizerView() {
    return this.resizer;
  }

  // 显示/更新某标签的面板(搜索触发)。
  public show(opts: {
    url: string;
    engineName: string;
    primaryEngineUrl: string;
    viewId: number;
  }) {
    // 互斥:收起同侧其它面板。
    this.window.sidePanels?.hideCurrent();

    const tabId = opts.viewId;
    let panel = this.panels.get(tabId);
    if (!panel) {
      panel = new SecondarySearchPanel(this.window, tabId);
      this.panels.set(tabId, panel);
    }
    // 切走其它已显示标签的面板(保留对象,便于切回恢复)
    if (this.visibleTabId && this.visibleTabId !== tabId) {
      this.detach(this.visibleTabId);
    }
    this.visibleTabId = tabId;
    this.window.win.addBrowserView(panel.headerView);
    // 暗色模式加载延迟显示中:内容视图跳过挂载,等 did-finish-load 由面板自行挂回。
    if (!panel.isLoadingHidden) {
      this.window.win.addBrowserView(panel.browserView);
    }
    panel.visible = true;
    void panel.load(opts.url, opts.engineName);
    this.resizer.attach();
    // (重)挂该标签的导航监听(重搜时用新主引擎 URL)
    this.attachNavWatcher(tabId, opts.primaryEngineUrl);
    this.window.viewManager.fixBounds();
    this.notify(true);
  }

  // 从窗口移除某标签的面板视图,但保留对象与监听(切标签用,便于切回恢复)。
  private detach(tabId: number) {
    const panel = this.panels.get(tabId);
    if (panel) {
      this.window.win.removeBrowserView(panel.headerView);
      this.window.win.removeBrowserView(panel.browserView);
      panel.markDismissed();
    }
  }

  // 彻底销毁某标签的面板 + 监听(绑定解除:导航离开 / 点 ✕ / 关标签)。
  private destroyPanel(tabId: number) {
    const panel = this.panels.get(tabId);
    if (panel) {
      this.window.win.removeBrowserView(panel.headerView);
      this.window.win.removeBrowserView(panel.browserView);
      panel.destroy();
      this.panels.delete(tabId);
    }
    this.detachNavWatcher(tabId);
    if (this.visibleTabId === tabId) {
      this.visibleTabId = 0;
      this.resizer.detach();
      this.window.viewManager.fixBounds();
      this.notify(false);
    }
  }

  // 互斥/临时收起:仅从窗口移除视图,保留对象与监听(切回该标签可恢复)。
  // 供其它面板 show() 互斥调用——开 AI 等面板只是临时让位,不应解除搜索绑定。
  public hideCurrent() {
    if (!this.visibleTabId) return;
    this.detach(this.visibleTabId);
    this.visibleTabId = 0;
    this.resizer.detach();
    this.window.viewManager.fixBounds();
    this.notify(false);
  }

  // 告知条 ✕:用户主动放弃,彻底销毁(切回不再恢复,直到再次搜索)。
  public dismissCurrent() {
    if (!this.visibleTabId) return;
    this.destroyPanel(this.visibleTabId);
  }

  // 切标签:无脑按「新激活标签是否有面板」重新评估(不再因当前不可见就早退——
  // 那是旧的 bug:切走再切回永远恢复不了)。但若其它右侧面板(AI/订阅/sidePanel)
  // 正显示,则不抢回双引擎面板,避免叠加。
  public onTabActivated(tabId: number) {
    // 先把当前可见的(若不同标签)收起,保留其对象
    if (this.visibleTabId && this.visibleTabId !== tabId) {
      this.detach(this.visibleTabId);
      this.visibleTabId = 0;
      this.resizer.detach();
    }
    const othersVisible = !!this.window.sidePanels?.isVisible;
    if (!othersVisible && this.panels.has(tabId)) {
      this.visibleTabId = tabId;
      const panel = this.panels.get(tabId)!;
      this.window.win.addBrowserView(panel.headerView);
      // 暗色模式加载延迟显示中:内容视图跳过挂载,等 did-finish-load 由面板自行挂回。
      if (!panel.isLoadingHidden) {
        this.window.win.addBrowserView(panel.browserView);
      }
      panel.visible = true;
      this.resizer.attach();
      this.window.viewManager.fixBounds();
      this.notify(true);
    } else {
      this.window.viewManager.fixBounds();
      this.notify(this.visibleTabId !== 0);
    }
  }

  // 关标签:销毁其面板(若它是唯一可见的,会顺带收起)。
  public onTabRemoved(tabId: number) {
    if (!this.panels.has(tabId)) return;
    this.destroyPanel(tabId);
  }

  public get currentPanel(): SecondarySearchPanel | null {
    return this.visibleTabId ? this.panels.get(this.visibleTabId) : null;
  }

  // 挂「某标签」主帧导航监听:仍在主引擎搜索结果页(含换词重搜)→ 保留;
  // 已离开 → 销毁该标签面板(绑定解除)。
  private attachNavWatcher(tabId: number, primaryEngineUrl: string) {
    this.detachNavWatcher(tabId);
    const view = this.window.viewManager.views.get(tabId);
    const wc = view?.webContents;
    if (!wc || wc.isDestroyed()) return;

    const fn = (
      _e: any,
      url: string,
      isInPlace: boolean,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame || isInPlace) return;
      if (!url) return;
      // 仍是主引擎搜索结果页 → 保留(副引擎内容由搜索触发 IPC 更新)。
      if (extractSearchQuery(primaryEngineUrl, url)) {
        return;
      }
      // 已离开搜索结果页 → 销毁该标签面板,绑定解除。
      this.destroyPanel(tabId);
    };
    wc.on('did-start-navigation', fn);
    this.watchers.set(tabId, { primaryEngineUrl, fn });
  }

  private detachNavWatcher(tabId: number) {
    const w = this.watchers.get(tabId);
    if (!w) return;
    try {
      const view = this.window.viewManager.views.get(tabId);
      const wc = view?.webContents;
      if (wc && !wc.isDestroyed()) {
        wc.removeListener('did-start-navigation', w.fn);
      }
    } catch (e) {
      // ignore
    }
    this.watchers.delete(tabId);
  }

  private notify(visible: boolean) {
    this.window.send('secondary-search-visibility', visible);
  }

  public destroy() {
    for (const tabId of [...this.panels.keys()]) {
      this.detachNavWatcher(tabId);
      this.panels.get(tabId)?.destroy();
    }
    this.panels.clear();
    this.resizer.destroy();
    this.visibleTabId = 0;
  }
}
