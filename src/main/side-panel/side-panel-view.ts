import { BrowserView, app, ipcMain } from 'electron';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

import { AppWindow } from '../windows';
import { Application } from '../application';
import { windowOpenToLoadOptions } from '../utils/window-open';
import {getMainTranslator} from '../i18n';
import type {Translator} from '~/common/i18n';

export const SIDE_PANEL_HEADER_HEIGHT = 48;

// 单个标签页对应的扩展 sidePanel 面板。封装一个 BrowserView,加载
// chrome-extension://<id>/<path>。复用 extension session(与 chromeExtensions
// 同一个 persist:view)+ crx-preload preload,让面板内 chrome.* 可用。
// 结构复刻 AiPanel,去掉 AI 业务逻辑。
export class SidePanelView {
  public browserView: BrowserView;
  public headerView: BrowserView;
  public bounds: any = null;
  public headerBounds: any = null;
  public visible = false;
  private currentUrl = '';
  private closeChannel: string;
  private pinChannel: string;

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

    this.headerView = new BrowserView({
      webPreferences: {
        session: Application.instance.sessions.view,
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      },
    });
    this.headerView.setBackgroundColor(this.isDark ? '#202124' : '#ffffff');

    this.closeChannel = `side-panel-close-${window.win.id}-${tabId}`;
    this.pinChannel = `side-panel-pin-${window.win.id}-${tabId}`;
    ipcMain.on(this.closeChannel, this.onHeaderClose);
    ipcMain.on(this.pinChannel, this.onHeaderPin);
    this.setupListeners();
  }

  public get webContents() {
    return this.browserView.webContents;
  }

  private get isDark() {
    return Application.instance.settings.object.theme === 'wexond-dark';
  }

  private onHeaderClose = () => {
    if (this.window.sidePanels?.visibleTabId === this.tabId) {
      this.window.sidePanels.hideCurrent();
    }
  };

  private onHeaderPin = () => {
    const settings = Application.instance.settings;
    const pinned = settings.object.pinnedExtensions || [];
    const isPinned = pinned.includes(this.extensionId);
    const next = isPinned
      ? pinned.filter((id) => id !== this.extensionId)
      : [...pinned, this.extensionId];
    settings.updateSettings({ pinnedExtensions: next });
    this.sendPinState(!isPinned);
  };

  private sendPinState(pinned?: boolean) {
    if (this.headerView.webContents.isDestroyed()) return;
    const isPinned =
      pinned ??
      (Application.instance.settings.object.pinnedExtensions || []).includes(
        this.extensionId,
      );
    this.headerView.webContents.send('side-panel-pin-state', { pinned: isPinned });
  }

  private getExtensionInfo(extensionId: string, t: Translator) {
    const extension = Application.instance.sessions.view.getExtension(extensionId);
    const manifest: any = extension?.manifest || {};
    const iconValue = manifest.action?.default_icon || manifest.icons;
    let iconPath = '';
    if (typeof iconValue === 'string') {
      iconPath = iconValue;
    } else if (iconValue && typeof iconValue === 'object') {
      const sizes = Object.keys(iconValue)
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      const preferred = sizes.find((size) => size >= 20) || sizes[sizes.length - 1];
      if (preferred) iconPath = iconValue[String(preferred)] || '';
    }
    let iconUrl = '';
    if (iconPath && extension?.path) {
      const root = path.resolve(extension.path);
      const candidate = path.resolve(root, String(iconPath).replace(/^[\\/]+/, ''));
      const relative = path.relative(root, candidate);
      if (
        relative &&
        !relative.startsWith('..') &&
        !path.isAbsolute(relative) &&
        existsSync(candidate)
      ) {
        const mimeTypes: Record<string, string> = {
          '.gif': 'image/gif',
          '.ico': 'image/x-icon',
          '.jpeg': 'image/jpeg',
          '.jpg': 'image/jpeg',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.webp': 'image/webp',
        };
        const mime = mimeTypes[path.extname(candidate).toLowerCase()];
        if (mime) {
          try {
            iconUrl = `data:${mime};base64,${readFileSync(candidate).toString('base64')}`;
          } catch {
            // 图标读取失败时使用首字母占位，不影响面板本身。
          }
        }
      }
    }
    return {
      name: extension?.name || manifest.name || t('spnlExtFallback'),
      iconUrl,
    };
  }

  private escapeHtml(value: string) {
    return String(value).replace(/[&<>"']/g, (char) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return entities[char];
    });
  }

  private headerHtml(extensionId: string): string {
    const t = getMainTranslator(
      Application.instance.settings?.object?.language,
    );
    const { name, iconUrl } = this.getExtensionInfo(extensionId, t);
    const dark = this.isDark;
    const bg = dark ? '#202124' : '#ffffff';
    const fg = dark ? '#e8eaed' : '#202124';
    const muted = dark ? '#bdc1c6' : '#5f6368';
    const border = dark ? '#3c4043' : '#dadce0';
    const hover = dark ? 'rgba(232,234,237,.08)' : 'rgba(60,64,67,.08)';
    const active = dark ? 'rgba(138,180,248,.16)' : '#e8f0fe';
    const activeFg = dark ? '#8ab4f8' : '#1a73e8';
    const icon = iconUrl
      ? `<img class="extension-icon" src="${this.escapeHtml(iconUrl)}" alt="">`
      : '<div class="extension-fallback" aria-hidden="true">E</div>';
    const body = `<!doctype html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box;}
      html,body{margin:0;width:100%;height:${SIDE_PANEL_HEADER_HEIGHT}px;overflow:hidden;
        background:${bg};color:${fg};font:13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",
        "Microsoft YaHei",sans-serif;-webkit-user-select:none;user-select:none;}
      .bar{height:${SIDE_PANEL_HEADER_HEIGHT}px;display:flex;align-items:center;padding:0 8px 0 16px;
        border-bottom:1px solid ${border};}
      .identity{display:flex;align-items:center;gap:10px;min-width:0;flex:1 1 auto;}
      .extension-icon,.extension-fallback{width:20px;height:20px;flex:0 0 20px;}
      .extension-icon{object-fit:contain;}
      .extension-fallback{display:flex;align-items:center;justify-content:center;border-radius:4px;
        background:${active};color:${activeFg};font-size:11px;font-weight:700;}
      .title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;}
      .actions{display:flex;align-items:center;gap:2px;margin-left:8px;}
      .btn{width:32px;height:32px;border:0;border-radius:50%;padding:0;background:transparent;
        color:${muted};display:flex;align-items:center;justify-content:center;cursor:pointer;}
      .btn:hover{background:${hover};color:${fg};}
      .btn:focus-visible{outline:2px solid ${activeFg};outline-offset:-2px;}
      .btn.active{background:${active};color:${activeFg};}
      .btn svg{width:18px;height:18px;}
    </style></head><body><div class="bar">
      <div class="identity">${icon}<div class="title" title="${this.escapeHtml(name)}">${this.escapeHtml(name)}</div></div>
      <div class="actions">
        <button class="btn" id="pin" type="button" title="${this.escapeHtml(t('spnlPinToToolbar'))}" aria-label="${this.escapeHtml(t('spnlPinToToolbar'))}" aria-pressed="false">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 3a1 1 0 0 1 .8 1.6L15.75 6H17a1 1 0 0 1 .8 1.6L15 11.33V14l1.7 1.7A1 1 0 0 1 16 17h-3v4a1 1 0 1 1-2 0v-4H8a1 1 0 0 1-.7-1.7L9 13.58v-2.25L6.2 7.6A1 1 0 0 1 7 6h1.25L7.2 4.6A1 1 0 0 1 8 3h8Zm-2 4H10l1 1.33V14h2V8.33L14 7Z"/></svg>
        </button>
        <button class="btn" id="close" type="button" title="${this.escapeHtml(t('spnlClose'))}" aria-label="${this.escapeHtml(t('spnlClose'))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>
    </div><script>
      const {ipcRenderer}=require('electron');
      const pin=document.getElementById('pin');
      const pinLabels={pinned:${JSON.stringify(t('spnlUnpinFromToolbar'))},unpinned:${JSON.stringify(t('spnlPinToToolbar'))}};
      const renderPin=(state)=>{
        const pinned=!!state?.pinned;
        pin.classList.toggle('active',pinned);
        pin.setAttribute('aria-pressed',String(pinned));
        pin.title=pinned?pinLabels.pinned:pinLabels.unpinned;
        pin.setAttribute('aria-label',pin.title);
      };
      pin.addEventListener('click',()=>ipcRenderer.send('${this.pinChannel}'));
      document.getElementById('close').addEventListener('click',()=>ipcRenderer.send('${this.closeChannel}'));
      ipcRenderer.on('side-panel-pin-state',(_event,state)=>renderPin(state));
    </script></body></html>`;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(body);
  }

  private async loadHeader(extensionId: string) {
    this.headerView.setBackgroundColor(this.isDark ? '#202124' : '#ffffff');
    try {
      await this.headerView.webContents.loadURL(this.headerHtml(extensionId));
      this.sendPinState();
    } catch {
      // 窗口关闭或快速切换面板时，data URL 加载可能被中断。
    }
  }

  private setupListeners() {
    const wc = this.webContents;
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

  // 加载(或重载)扩展面板页面。url 变化时才 loadURL,避免重复加载。
  public async load(extensionId: string, panelPath: string) {
    const url = `chrome-extension://${extensionId}/${panelPath.replace(/^\//, '')}`;
    this.extensionId = extensionId;
    void this.loadHeader(extensionId);
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
    ipcMain.removeListener(this.closeChannel, this.onHeaderClose);
    ipcMain.removeListener(this.pinChannel, this.onHeaderPin);
    const destroyView = (view: BrowserView | null) => {
      if (!view) return;
      try {
        if (!view.webContents.isDestroyed()) {
          (view.webContents as any).destroy();
        }
      } catch (e) {
        // ignore
      }
    };
    destroyView(this.browserView);
    destroyView(this.headerView);
    this.browserView = null;
    this.headerView = null;
  }
}
