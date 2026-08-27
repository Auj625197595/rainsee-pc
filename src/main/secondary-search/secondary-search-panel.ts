import { BrowserView } from 'electron';

import { AppWindow } from '../windows';
import { Application } from '../application';
import { MobileUserAgent } from '../user-agent';
import { getViewBackgroundColor } from '../utils/theme';
import { PanelLoadingHide } from '../utils/panel-loading-hide';
import { getViewMenu } from '../menus/view';
import { injectPanelThemeMode } from '../utils/night-mode-inject';
import { windowOpenToLoadOptions } from '../utils/window-open';

// 双引擎搜索侧边栏顶部告知条高度(px)。其下才是副引擎结果页。
export const SECONDARY_SEARCH_HEADER_HEIGHT = 36;

// 单个标签页对应的「双引擎搜索」面板。封装两个 BrowserView:
//  - headerView:本地 data: HTML 告知条(「双引擎搜索 · {名}」+ 设置图标 + 关闭),
//    nodeIntegration 以便按钮直接 ipcRenderer.send(参照 side-panel-resizer)。
//  - browserView(content):加载副引擎搜索结果页,采用移动端 UA,拿移动版页面。
// 结构复刻 SubscribePanel(普通网页面板),去掉订阅业务逻辑;UA 是本功能新增点。
export class SecondarySearchPanel {
  public browserView: BrowserView; // content:副引擎结果页
  public headerView: BrowserView; // 顶部告知条
  public bounds: any = null;
  public headerBounds: any = null;
  public visible = false;
  private currentUrl = '';
  // 暗色模式加载延迟显示:副引擎结果页加载期间移除内容视图,did-finish-load 再挂回(消除白闪)。
  private loadingHide: PanelLoadingHide;

  public constructor(public window: AppWindow, public tabId: number) {
    // content:副引擎结果页(移动端 UA)
    this.browserView = new BrowserView({
      webPreferences: {
        session: Application.instance.sessions.view,
        nodeIntegration: false,
        contextIsolation: false,
        sandbox: false,
        javascript: true,
        plugins: true,
      },
    });
    // 底色跟随主题:暗色给深色底,加载延迟显示期间与短暂挂载间隙都不露白。
    this.browserView.setBackgroundColor(getViewBackgroundColor());
    // 移动端 UA:让秘塔/百度等返回移动版结果页。
    this.browserView.webContents.userAgent = MobileUserAgent;

    // header:本地告知条(nodeIntegration,按钮直接发 IPC)
    this.headerView = new BrowserView({
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      },
    });
    this.headerView.setBackgroundColor(getViewBackgroundColor());

    this.loadingHide = new PanelLoadingHide(
      this.window.win,
      () => this.browserView,
      () => this.window.secondarySearchPanels?.visibleTabId === this.tabId,
      () => this.window.viewManager.fixBounds(),
    );
    this.setupListeners();
  }

  /** 加载延迟显示中:供 SecondarySearchPanelManager 的 addBrowserView 守卫。 */
  public get isLoadingHidden() {
    return this.loadingHide.isHidden;
  }

  public get webContents() {
    return this.browserView.webContents;
  }

  private setupListeners() {
    const wc = this.webContents;

    // 右键菜单:与普通网页一致(后退/前进/复制/搜索/打开链接等)。
    wc.on('context-menu', (_e, params) => {
      const menu = getViewMenu(this.window, params, wc, false);
      menu.popup();
    });

    // 主题模式注入:DOM 就绪与加载完成各注入一次(metaso 随主题切深/浅色,其他仅夜间注入)。
    wc.addListener('dom-ready', () => injectPanelThemeMode(wc));

    // 加载完成后重定义 navigator.userAgent/appVersion,防 JS 侧 UA 检测(参照 view.ts)。
    wc.on('did-finish-load', () => {
      // 结果页加载完成:挂回加载延迟显示中的内容视图(主显示触发点)。
      this.loadingHide.show();
      injectPanelThemeMode(wc);
      try {
        wc.executeJavaScript(
          `Object.defineProperty(navigator,'userAgent',{get:()=>${JSON.stringify(
            MobileUserAgent,
          )}});Object.defineProperty(navigator,'appVersion',{get:()=>${JSON.stringify(
            MobileUserAgent.replace(/^Mozilla\//, ''),
          )}});`,
        ).catch(() => undefined);
      } catch (e) {
        // ignore
      }
    });

    wc.addListener('did-stop-loading', () => {
      // 加载停止:挂回(did-finish-load 未到的兜底)。
      this.loadingHide.show();
    });
    // 主帧真实导航开始:暗色模式下移除内容视图,露出深色背景,直到加载完成再挂回。
    wc.on('did-start-navigation', (_e, url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) return;
      if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) return;
      this.loadingHide.hide();
    });
    wc.addListener('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
      // 主帧真实加载失败:挂回,避免面板保持空白(忽略 -3 ABORTED)。
      if (isMainFrame && code !== -3) this.loadingHide.show();
    });

    // 面板内 window.open / target=_blank → 交给主浏览器开新标签。
    wc.setWindowOpenHandler((details) => {
      if (details.url && details.url !== 'about:blank') {
        const loadOptions = windowOpenToLoadOptions(details);
        queueMicrotask(() => {
          this.window.viewManager.create(
            { url: details.url, active: true, loadOptions } as any,
            true,
          );
        });
      }
      return { action: 'deny' };
    });
  }

  // 是否深色主题(决定告知条配色)。
  private get isDark() {
    return Application.instance.settings.object.theme === 'wexond-dark';
  }

  // 生成告知条 HTML(烘焙当前主题色 + 引擎名 + windowId)。
  private headerHtml(engineName: string): string {
    const winId = this.window.win.id;
    const dark = this.isDark;
    const bg = dark ? '#1f2430' : '#ffffff';
    const fg = dark ? '#e5e7eb' : '#1f2937';
    const sub = dark ? '#9aa4b2' : '#6b7280';
    const border = dark ? '#2d3340' : '#eceef2';
    const hover = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
    const accent = '#4f7cff';
    const body = `<!doctype html><html><head><meta charset="utf-8"><style>
      *{margin:0;padding:0;box-sizing:border-box;}
      html,body{height:36px;background:${bg};color:${fg};
        font:12px/1 -apple-system,"Microsoft YaHei",sans-serif;
        -webkit-user-select:none;user-select:none;overflow:hidden;}
      .bar{display:flex;align-items:center;height:36px;padding:0 8px 0 12px;
        border-bottom:1px solid ${border};}
      .logo{width:14px;height:14px;margin-right:7px;flex:0 0 auto;border-radius:3px;
        background:linear-gradient(135deg,${accent},#16a34a);}
      .t{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;
        text-overflow:ellipsis;font-weight:600;}
      .t .name{color:${sub};font-weight:400;margin-left:2px;}
      .btn{flex:0 0 auto;width:26px;height:26px;border:none;border-radius:6px;
        background:transparent;color:${sub};cursor:pointer;display:inline-flex;
        align-items:center;justify-content:center;}
      .btn:hover{background:${hover};color:${fg};}
      .btn svg{width:15px;height:15px;}
    </style></head><body>
      <div class="bar">
        <div class="logo"></div>
        <div class="t">双引擎搜索<span class="name"> · ${engineName.replace(/</g, '&lt;')}</span></div>
        <button class="btn" id="settings" title="双引擎搜索设置">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
        <button class="btn" id="close" title="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <script>
        const {ipcRenderer}=require('electron');
        document.getElementById('settings').addEventListener('click',()=>{
          ipcRenderer.send('dual-engine-open-settings-${winId}');
        });
        document.getElementById('close').addEventListener('click',()=>{
          ipcRenderer.send('dual-engine-hide-${winId}');
        });
      </script>
    </body></html>`;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(body);
  }

  // 加载(或重载)副引擎结果页 + 刷新告知条引擎名。
  public async load(url: string, engineName: string) {
    // 告知条每次都刷新(引擎名/主题可能变),data: URL 不同即重载,开销极小。
    try {
      await this.headerView.webContents.loadURL(this.headerHtml(engineName));
    } catch (e) {
      // ignore
    }
    if (url === this.currentUrl) return;
    this.currentUrl = url;
    try {
      await this.webContents.loadURL(url);
    } catch (e) {
      // ignore load failure
    }
  }

  public markDismissed() {
    this.visible = false;
  }

  public destroy() {
    this.loadingHide.dispose();
    const safe = (v: BrowserView | null) => {
      if (!v) return;
      try {
        if (!v.webContents.isDestroyed()) {
          (v.webContents as any).destroy();
        }
      } catch (e) {
        // ignore
      }
    };
    safe(this.browserView);
    safe(this.headerView);
    this.browserView = null;
    this.headerView = null;
  }
}
