import { BrowserView, app } from 'electron';
import * as path from 'path';

import { AppWindow } from '../windows';
import { Application } from '../application';
import { postBodyToLoadOptions } from '../utils/post-body';

// 单个标签页对应的扩展 sidePanel 面板。封装一个 BrowserView,加载
// chrome-extension://<id>/<path>。复用 extension session(与 chromeExtensions
// 同一个 persist:view)+ crx-preload preload,让面板内 chrome.* 可用。
// 结构复刻 AiPanel,去掉 AI 业务逻辑。
export class SidePanelView {
  public browserView: BrowserView;
  public bounds: any = null;
  public visible = false;
  private currentUrl = '';

  public constructor(
    public window: AppWindow,
    public tabId: number,
    public extensionId: string,
  ) {
    this.browserView = new BrowserView({
      webPreferences: {
        // extension session:chrome-extension:// 资源可加载 + chrome.* 可用。
        session: Application.instance.sessions.view,
        // crx-preload 注入 electron bridge + chrome.* shims(同 popup.ts)。
        // sandbox:false 走 classic preload 路径(WebPreferences),不依赖
        // binding.startupData(sandboxed renderer 会 null 跳过)。
        preload: path.join(app.getAppPath(), 'build', 'crx-preload.bundle.js'),
        nodeIntegration: false,
        contextIsolation: false,
        sandbox: false,
        javascript: true,
      },
    });
    this.browserView.setBackgroundColor('#ffffff');
    this.setupListeners();
  }

  public get webContents() {
    return this.browserView.webContents;
  }

  private setupListeners() {
    const wc = this.webContents;
    // 面板内 window.open / target=_blank → 交给主浏览器开新标签。
    wc.setWindowOpenHandler((details) => {
      if (details.url && details.url !== 'about:blank') {
        const loadOptions = postBodyToLoadOptions(details.postBody);
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

  // 加载(或重载)扩展面板页面。url 变化时才 loadURL,避免重复加载。
  public async load(extensionId: string, panelPath: string) {
    const url = `chrome-extension://${extensionId}/${panelPath.replace(/^\//, '')}`;
    this.extensionId = extensionId;
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
    try {
      if (!this.webContents.isDestroyed()) {
        (this.webContents as any).destroy();
      }
    } catch (e) {
      // ignore
    }
    this.browserView = null;
  }
}
