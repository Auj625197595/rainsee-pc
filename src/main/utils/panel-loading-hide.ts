import { BrowserView, BrowserWindow } from 'electron';

import { isDarkThemeActive } from './theme';

/**
 * 侧边面板(BrowserView)「加载延迟显示」控制器。
 *
 * 暗色模式下,面板内容页主帧导航期间把 BrowserView 从窗口移除,露出主窗口深色背景,
 * 直到页面 did-finish-load 再挂回——消除面板内容页 FOUC 白闪(页面自身默认白 body、
 * 或 SPA 应用深色主题前的白底)。亮色模式不隐藏(白底与页面一致)。
 *
 * 用法:
 *  - 面板 setupListeners 里:did-start-navigation(主帧 http/https)→ hide();
 *    did-finish-load / did-stop-loading / did-fail-load → show()。
 *  - 面板暴露 get isLoadingHidden() = this.ctrl.isHidden,供 manager 的 addBrowserView 守卫。
 *  - manager 在 addBrowserView(panel.browserView) 前判断 !panel.isLoadingHidden。
 *
 * getView / isActivelyShown / onShown 用闭包传入,适配不同面板的「当前是否该可见」判定
 * 与挂回副作用(重新 addBrowserView 后需 fixBounds 重新定位)。
 */
export class PanelLoadingHide {
  private hidden = false;
  private timer: any = null;
  private readonly timeoutMs: number;

  constructor(
    private win: BrowserWindow,
    private getView: () => BrowserView | null,
    private isActivelyShown: () => boolean,
    private onShown: () => void,
    timeoutMs = 8000,
  ) {
    this.timeoutMs = timeoutMs;
  }

  get isHidden() {
    return this.hidden;
  }

  /** 主帧真实导航开始:暗色模式下移除面板视图。非暗色 / 已隐藏 / 未活动显示时为空操作。 */
  hide() {
    if (!isDarkThemeActive()) return;
    if (this.hidden) return;
    this.hidden = true;
    const v = this.getView();
    // 仅当该面板当前应当可见(visibleTabId === tabId)才移除;后台/已收起的视图本就未挂载。
    if (v && this.isActivelyShown()) {
      try {
        this.win.removeBrowserView(v);
      } catch {}
    }
    if (this.timer) clearTimeout(this.timer);
    // 兜底:极慢页或一直 pending,did-finish-load 迟迟不来,定时器强制挂回避免永久空白。
    this.timer = setTimeout(() => this.show(), this.timeoutMs);
  }

  /** 加载完成(或停止/失败/兜底):挂回面板视图(若仍活动显示)。幂等。 */
  show() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.hidden) return;
    this.hidden = false;
    const v = this.getView();
    if (v && this.isActivelyShown()) {
      try {
        this.win.addBrowserView(v);
        this.onShown();
      } catch {}
    }
  }

  dispose() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.hidden = false;
  }
}
