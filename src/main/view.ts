import {BrowserView, app, ipcMain, webFrameMain, dialog} from 'electron';
import type {LoadURLOptions} from 'electron';
import {parse as parseUrl} from 'url';
import {hostMatches} from '~/utils/url';
import {OPEN_LINKS_IN_NEW_PAGE_PERMISSION} from '~/utils/permissions';
import {getViewMenu} from './menus/view';
import {AppWindow} from './windows';
import {IHistoryItem, IBookmark, IPermissionRecord} from '~/interfaces';
import {
  ERROR_PROTOCOL,
  NETWORK_ERROR_HOST,
  WEBUI_BASE_URL,
  buildKoodoReaderUrl,
  filePathFromFileUrl,
} from '~/constants/files';
import {
  ZOOM_FACTOR_MIN,
  ZOOM_FACTOR_MAX,
  ZOOM_FACTOR_INCREMENT,
} from '~/constants/web-contents';
import {TabEvent} from '~/interfaces/tabs';
import {Queue} from '~/utils/queue';
import {Application} from './application';
import {getViewBackgroundColor, isDarkThemeActive} from './utils/theme';
import {postBodyToLoadOptions} from './utils/post-body';
import {ChromeAppVersion, ChromeUserAgent} from './user-agent';
import {getWebUIURL} from "~/common/webui-main";
import {cleanHeaders, getVideoPlayCode, hookClickCode, VideoRequest, watchVideoCode} from "~/main/services/supervideo-video";
import {isVideoPlayerWhitelistedHost} from "~/main/services/video-player-whitelist";
import {injectCosmeticForHost} from "~/main/services/adblock";
import {refreshMediaPlayer} from "~/main/windows/media-player";
import {execFile} from "child_process";
import {existsSync} from "fs";
import {tlog} from "./timing";
import {injectSearchAnnotator} from "./services/search-annotator";
import {detectTranslateState, runMsTranslate, revertMsTranslate} from "./services/translate";
import {detectPwaState, PwaManifest, isUrlInstalled} from "./services/pwa";
import {
  resolveBestFavicon,
  fetchFaviconFromPage,
  ResolvedFavicon,
} from "./services/favicon";
import {buildGestureCode} from "./services/gesture-subframe";
import {buildGestureConfig} from "./menus/gesture-actions";
import {detectFlashRequirement} from './services/flash';

interface IAuthInfo {
  url: string;
}

// 仅在当前进程生命周期内有效。用户必须在证书错误页主动确认后，
// 对应 host 的证书错误才会被放行。
const certificateErrorAllowedHosts = new Set<string>();

const getCertificateErrorHost = (url: string) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch (_) {
    return '';
  }
};

const buildOpenLinksInNewPageCode = (enabled: boolean) => `
  (() => {
    try {
      const key = '__rainseeOpenLinksInNewPage';
      const previous = window[key];
      if (previous && typeof previous.cleanup === 'function') {
        previous.cleanup();
      }

      if (!${enabled ? 'true' : 'false'}) {
        try {
          delete window[key];
        } catch (_) {
          window[key] = undefined;
        }
        return true;
      }

      const touchedAnchors = [];
      const touchedForms = [];

      const saveAnchor = (anchor) => {
        if (!anchor || anchor.__rainseeBlankHandled) return;
        anchor.__rainseeBlankHandled = true;
        touchedAnchors.push({
          node: anchor,
          hadTarget: anchor.hasAttribute('target'),
          target: anchor.getAttribute('target'),
        });
      };

      const saveForm = (form) => {
        if (!form || form.__rainseeBlankHandled) return;
        form.__rainseeBlankHandled = true;
        touchedForms.push({
          node: form,
          hadTarget: form.hasAttribute('target'),
          target: form.getAttribute('target'),
          hadAction: form.hasAttribute('action'),
          action: form.getAttribute('action'),
        });
      };

      const isPostForm = (dom) => {
        if (!dom) return false;
        if (dom.method && dom.method.toLowerCase() === 'post') {
          return true;
        }
        const forms = typeof dom.querySelectorAll === 'function'
          ? dom.querySelectorAll('form')
          : [];
        for (let i = 0; i < forms.length; i++) {
          if (forms[i].method && forms[i].method.toLowerCase() === 'post') {
            return true;
          }
        }
        return false;
      };

      const inCanBlank = (dom) => {
        const rawHref = dom && typeof dom.getAttribute === 'function'
          ? dom.getAttribute('href')
          : '';
        return !!(
          dom &&
          dom.href &&
          dom.href.indexOf('http') === 0 &&
          rawHref &&
          rawHref.indexOf('#') !== 0 &&
          !/^javascript:/i.test(rawHref)
        );
      };

      const updatePostForm = (form) => {
        try {
          if (!form || !form.method || form.method.toLowerCase() !== 'post') {
            return;
          }
          saveForm(form);

          const action = form.getAttribute('action');
          const method = form.getAttribute('method');
          if (!method || method.toLowerCase() !== 'post') {
            return;
          }

          if (!action) {
            const currentUrl = location.origin + location.pathname + location.search;
            const separator = currentUrl.indexOf('?') !== -1 ? '&' : '?';
            if (currentUrl.indexOf('yujianmothed=post') === -1) {
              form.setAttribute('action', currentUrl + separator + 'yujianmothed=post');
            }
          } else {
            const separator = action.indexOf('?') !== -1 ? '&' : '?';
            if (action.indexOf('yujianmothed=post') === -1) {
              form.setAttribute('action', action + separator + 'yujianmothed=post');
            }
          }
          form.setAttribute('target', '_blank');
        } catch (_) {}
      };

      const setTarget = (dom) => {
        if (!inCanBlank(dom)) {
          return;
        }
        saveAnchor(dom);
        dom.setAttribute('target', '_blank');
      };

      const touchDescendantAnchors = (node) => {
        if (!node || typeof node.querySelectorAll !== 'function') return;
        const children = node.querySelectorAll('a[href]');
        for (let i = 0; i < children.length; i++) {
          setTarget(children[i]);
        }
      };

      const onMouseDown = (event) => {
        try {
          const form =
            event.target &&
            typeof event.target.closest === 'function'
              ? event.target.closest('form')
              : null;
          if (form && !(form.action && form.action.toLowerCase().indexOf('javascript:') > -1)) {
            updatePostForm(form);
          }
        } catch (_) {}

        const levels = [];
        let current = event.target;
        for (let i = 0; current && i < 5; i++) {
          levels.push(current);
          current = current.parentNode;
        }

        for (let i = 0; i < levels.length; i++) {
          setTarget(levels[i]);
          touchDescendantAnchors(levels[i]);
          if (isPostForm(levels[i])) {
            const forms = levels[i].querySelectorAll
              ? levels[i].querySelectorAll('form')
              : [];
            for (let j = 0; j < forms.length; j++) {
              updatePostForm(forms[j]);
            }
          }
        }
      };

      const root = document.body || document.documentElement || document;
      root.addEventListener('mousedown', onMouseDown, true);

      touchDescendantAnchors(document);
      const forms = document.getElementsByTagName('form');
      for (let i = 0; i < forms.length; i++) {
        if (forms[i].action && forms[i].action.toLowerCase().indexOf('javascript:') > -1) {
          continue;
        }
        updatePostForm(forms[i]);
      }

      window[key] = {
        cleanup() {
          root.removeEventListener('mousedown', onMouseDown, true);

          for (let i = 0; i < touchedAnchors.length; i++) {
            const item = touchedAnchors[i];
            if (!item.node) continue;
            delete item.node.__rainseeBlankHandled;
            if (item.hadTarget && item.target != null) {
              item.node.setAttribute('target', item.target);
            } else {
              item.node.removeAttribute('target');
            }
          }

          for (let i = 0; i < touchedForms.length; i++) {
            const item = touchedForms[i];
            if (!item.node) continue;
            delete item.node.__rainseeBlankHandled;
            if (item.hadTarget && item.target != null) {
              item.node.setAttribute('target', item.target);
            } else {
              item.node.removeAttribute('target');
            }
            if (item.hadAction && item.action != null) {
              item.node.setAttribute('action', item.action);
            } else {
              item.node.removeAttribute('action');
            }
          }
        },
      };
    } catch (_) {}

    return true;
  })();
`;

export class View {
  public browserView: BrowserView;

  public isNewTab = false;
  public homeUrl: string;
  public favicon = '';
  // 当前已选 favicon 候选的评分。DOM 探测(did-finish-load)若发现更高分候选
  // (且超过阈值)则覆盖,保证最终用上页面声明的高清图标而非首个低清候选。
  public faviconScore = 0;
  public incognito = false;

  // 扩展系统注册守卫:chromeExtensions.addTab 必须在 load()(acquire 后)首次调用,
  // 不能在构造时(预热 View 停在 about:blank 时)调用——否则 about:blank 会被
  // store.addTab 设为窗口 active tab,污染扩展系统的 onActivated/active 标签语义。
  private extensionsRegistered = false;

  // 标签悬停预览缩略图(data URL)。在标签被切走前抓取当前页面快照缓存,
  // 供悬停卡片展示。背景标签的 BrowserView 已从窗口移除无法实时抓取,
  // 故采用「切走即缓存」策略;当前选中标签则在悬停时实时抓取。
  public thumbnail = '';

  public errorURL = '';

  private hasError = false;

  public window: AppWindow;

  // 网页翻译状态(主进程为单一可信源:微软翻译引擎跑在主进程,经 executeJavaScript
  // 驱动页面侧引导收集/回填文本节点。active/target 必须由 View 自己记住)。
  public translateActive = false;
  public translateTarget = 'zh-CN';
  // 翻译驱动循环的代际令牌:每次 driveTranslate 自增,旧循环在下个 await 点见
  // gen 不匹配即自取消(切语言/关翻译/导航离开时避免新旧回填竞态)。
  private translateGen = 0;
  // 切语言触发的 reload 标记:did-start-navigation 见此标记则保持 active。
  // (新版切语言已改为原地 revert+重译,不再 reload;此标记保留为兼容,did-start-navigation
  // 里的判断维持原样,真正跳转仍会正确关闭翻译。)
  private translateReloadingForLang = false;

  // PWA 安装性:页面满足 manifest + Service Worker 安装条件时为 true,地址栏显示安装图标。
  public canInstallPwa = false;
  // 探测到的 PWA manifest 快照(name/startUrl/icon/themeColor...),供安装弹窗与独立窗口使用。
  public pwaManifest: PwaManifest | null = null;
  // 本站(origin)是否已安装为 PWA(读 userData/installed-pwas.json)。已安装时图标呈"已安装"态。
  public pwaInstalled = false;
  // 探测代际令牌:导航离开时自增,丢弃过期的探测结果(SW 轮询最多 4s,期间可能已切页)。
  private pwaGen = 0;
  // Flash 探测代际令牌：页面切换时使旧的异步探测/安装结果失效，防止刷新到新页面。
  private flashProbeGen = 0;

  public bounds: any;

  // 暗色模式加载隐藏:主帧真实导航期间把 BrowserView 从窗口分离,内容区露出主窗口
  // 深色背景,直到 did-finish-load 再挂回,避免网页 FOUC(页面自身白 body)闪一下。
  // isLoadingHidden 供 view-manager.select() 据此跳过 addBrowserView。详见 hideForLoading。
  private loadingHidden = false;
  private loadingHideTimer: any = null;

  public lastHistoryId: string;

  public bookmark: IBookmark;

  public findInfo = {
    occurrences: '0/0',
    text: '',
  };

  public requestedAuth: IAuthInfo;
  public requestedPermission: any;
  public openLinksInNewPageEnabled = false;

  private historyQueue = new Queue();

  private lastUrl = '';
  public videoUrls: string[] = [];
  public netVideoUrls: VideoRequest[] = [];
  public requestRecord: Map<string, Record<string, string>> = new Map();
  public framesCache: any[] = [];
  // 每个最终播放 url 的嗅探元信息(嗅探时间/请求头/响应头/类型)，
  // 供智能播放器窗口展示与播放/下载时复用请求头。key 为 videoUrls 里的 url。
  public videoMeta: Map<string, VideoRequest> = new Map();

  private getExtensionFrameTabBridgeCode() {
    const selectedId = this.window.viewManager.selectedId;
    const tab = {
      id: this.id,
      index: -1,
      windowId: this.window.win.id,
      active: this.id === selectedId,
      selected: this.id === selectedId,
      highlighted: this.id === selectedId,
      url: this.url,
      title: this.title,
      incognito: !!this.incognito,
      pinned: false,
      status: this.webContents.isLoading() ? 'loading' : 'complete',
    };
    const tabs = JSON.stringify([tab]);
    return `
      (() => {
        try {
          if (location.protocol !== 'chrome-extension:') return true;
          const tabs = ${tabs};
          const current = tabs[0];
          globalThis.__crxTabs = tabs;
          const c = globalThis.chrome || (globalThis.chrome = {});
          const t = c.tabs || (c.tabs = {});
          const nativeGetCurrent = typeof t.getCurrent === 'function' ? t.getCurrent.bind(t) : null;
          const nativeQuery = typeof t.query === 'function' ? t.query.bind(t) : null;
          const matches = (info, tab) => {
            info = info || {};
            if (info.active !== undefined && !!info.active !== !!tab.active) return false;
            if (info.currentWindow && tab.windowId !== current.windowId) return false;
            if (info.windowId !== undefined && info.windowId >= 0 && info.windowId !== tab.windowId) return false;
            return true;
          };
          const fallbackCurrent = () => ({ ...current });
          const fallbackQuery = (info) => tabs.filter((tab) => matches(info, tab)).map((tab, index) => ({ ...tab, index }));
          t.getCurrent = function(callback) {
            const p = nativeGetCurrent
              ? Promise.resolve().then(() => nativeGetCurrent()).then((result) => result || fallbackCurrent()).catch(() => fallbackCurrent())
              : Promise.resolve(fallbackCurrent());
            if (typeof callback === 'function') {
              p.then((result) => callback(result));
              return undefined;
            }
            return p;
          };
          t.query = function(info, callback) {
            const p = nativeQuery
              ? Promise.resolve().then(() => nativeQuery(info || {})).then((result) => Array.isArray(result) && result.length ? result : fallbackQuery(info)).catch(() => fallbackQuery(info))
              : Promise.resolve(fallbackQuery(info));
            if (typeof callback === 'function') {
              p.then((result) => callback(result));
              return undefined;
            }
            return p;
          };
          const extId = (c.runtime && c.runtime.id) || (location.hostname || '').split('/')[0];
          let portSeq = 0;
          const listeners = () => ({
            _items: [],
            addListener(fn) { if (typeof fn === 'function' && this._items.indexOf(fn) < 0) this._items.push(fn); },
            removeListener(fn) { const i = this._items.indexOf(fn); if (i >= 0) this._items.splice(i, 1); },
            hasListener(fn) { return this._items.indexOf(fn) >= 0; },
            emit(...args) { for (const fn of this._items.slice()) { try { fn(...args); } catch (_) {} } },
          });
          const ports = new Map();
          if (!globalThis.__crxRainseeTabsConnectListener) {
            globalThis.__crxRainseeTabsConnectListener = true;
            window.addEventListener('message', (ev) => {
              const d = ev && ev.data;
              if (!d) return;
              const entry = d.connId && ports.get(d.connId);
              if (!entry) return;
              if (d.__crxTabsPortIn) {
                entry.onMessage.emit(d.message, entry.port);
              } else if (d.__crxTabsPortDisIn) {
                ports.delete(d.connId);
                entry.onDisconnect.emit(entry.port);
              }
            });
          }
          t.connect = function(tabIdArg, connectInfo) {
            const hasTabId = typeof tabIdArg === 'number';
            const tabId = hasTabId ? tabIdArg : current.id;
            const info = hasTabId ? (connectInfo || {}) : (tabIdArg || {});
            const name = (info && info.name) || (typeof info === 'string' ? info : '');
            const frameId = info && typeof info.frameId === 'number' ? info.frameId : undefined;
            const connId = 'iftab-' + Date.now() + '-' + (++portSeq);
            const onMessage = listeners();
            const onDisconnect = listeners();
            const port = {
              name,
              sender: { id: extId },
              onMessage,
              onDisconnect,
              postMessage(message) {
                try { window.parent.postMessage({ __crxTabsPortOut: true, connId, message }, '*'); } catch (_) {}
              },
              disconnect() {
                ports.delete(connId);
                try { window.parent.postMessage({ __crxTabsPortDisOut: true, connId }, '*'); } catch (_) {}
                try { onDisconnect.emit(port); } catch (_) {}
              },
            };
            ports.set(connId, { port, onMessage, onDisconnect });
            try {
              window.parent.postMessage({
                __crxTabsConnect: true,
                connId,
                extId,
                tabId,
                info: { name, frameId },
              }, '*');
            } catch (_) {
              setTimeout(() => port.disconnect(), 0);
            }
            return port;
          };
          try { Object.defineProperty(t.getCurrent, '__crxRainseeFrameTab', { value: true, configurable: true }); } catch (_) {}
          try { Object.defineProperty(t.query, '__crxRainseeFrameTab', { value: true, configurable: true }); } catch (_) {}
          try { Object.defineProperty(t.connect, '__crxRainseeFrameTab', { value: true, configurable: true }); } catch (_) {}
        } catch (_) {}
        return true;
      })();
    `;
  }

  private handleKtllqNavigation(url: string, openInNewTab = false) {
    if (!url || !url.startsWith('ktllq://')) {
      return false;
    }

    const lowerUrl = url.toLowerCase();
    let targetUrl = '';

    if (lowerUrl.includes('bookmarks')) {
      targetUrl = getWebUIURL('bookmarks');
    } else if (lowerUrl.includes('history')) {
      targetUrl = getWebUIURL('history');
    } else if (lowerUrl.includes('downloads')) {
      queueMicrotask(() => {
        this.window.send('show-download-dialog');
      });
      return true;
    } else if (lowerUrl.includes('gosearch')) {
      // ktllq://gosearch:不跳转,仅聚焦当前标签页地址栏并弹出联想面板。
      // 不带入当前 url(text 置空),空地址栏会展示历史搜索词。
      queueMicrotask(() => {
        this.window.send('addressbar-update-input', {
          id: this.id,
          text: '',
          selectionStart: 0,
          selectionEnd: 0,
          focus: true,
          showSuggestions: true,
        });
      });
      return true;
    } else if (lowerUrl.includes('settings')) {
      targetUrl = getWebUIURL('settings');
    } else if (lowerUrl.includes('extensions')) {
      targetUrl = getWebUIURL('extensions');
    } else if (lowerUrl.includes('flags')) {
      targetUrl = getWebUIURL('flags');
    } else if (lowerUrl.includes('aihelp')) {
      targetUrl = 'https://a.yjllq.com';
    } else if (lowerUrl.includes('youhui')) {
      targetUrl = 'https://third.yjllq.com/h5/pages/youhui/youhui?lang=zh';
    } else if (lowerUrl.includes('fanyi')) {
      targetUrl = 'https://third.yjllq.com/h5/pages/translate/translate?lang=zh';
    } else if (lowerUrl.includes('news')) {
      targetUrl = 'https://third.yjllq.com/h5/pages/news/news?lang=zh';
    } else if (lowerUrl.includes('gaoji')) {
      targetUrl = 'https://club.yujianpay.com/index.php/archives/90/';
    } else if (lowerUrl.includes('jingxuan')) {
      targetUrl = 'https://api.yjllq.com/index.php/api/Index/choice';
    } else if (lowerUrl.includes('extension')) {
      targetUrl = 'https://third.yjllq.com/h5/pages/scripts/scripts?lang=zh';
    }

    if (!targetUrl) {
      console.log('Unhandled ktllq protocol url:', url);
      return true;
    }

    queueMicrotask(() => {
      if (openInNewTab) {
        this.window.viewManager.create(
          {
            url: targetUrl,
            active: true,
            incognito: this.incognito,
          } as any,
          true,
        );
        return;
      }

      this.webContents.loadURL(targetUrl).catch((error) => {
        console.log('Failed to handle ktllq protocol url:', url, error);
      });
    });

    return true;
  }

  private getInternalFlagsTarget(url: string): string {
    if (!url) return '';
    const match = /^(chrome:\/\/flags|yjllq:\/\/flags)([/?#].*)?$/i.exec(url);
    if (match) {
      return `${getWebUIURL('flags')}${match[2] || ''}`;
    }
    return '';
  }

  private handleInternalFlagsNavigation(url: string, openInNewTab = false) {
    const targetUrl = this.getInternalFlagsTarget(url);
    if (!targetUrl) return false;

    queueMicrotask(() => {
      if (openInNewTab) {
        this.window.viewManager.create(
          {
            url: targetUrl,
            active: true,
            incognito: this.incognito,
          } as any,
          true,
        );
        return;
      }

      this.webContents.loadURL(targetUrl).catch((error) => {
        console.log('Failed to handle internal flags url:', url, error);
      });
    });

    return true;
  }

  // 新标签页内嵌 iframe 的「跳出」判断:仅当目标是 http(s)、且主域不是
  // pcapp.rainsee.cn 时返回 true(应在浏览器开新标签,而非在 iframe 内加载)。
  private shouldBreakOutNewTabFrame(url: string): boolean {
    if (!url) return false;
    let host = '';
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      host = u.hostname;
    } catch {
      return false;
    }
    return !hostMatches('pcapp.rainsee.cn', host);
  }

  /**
   * Apply installed extensions' DNR decision to a main-frame navigation.
   * This is a generic extension-platform fallback: no extension id, userscript
   * suffix or vendor install page is encoded here.
   */
  private handleExtensionDnrNavigation(url: string) {
    if (!/^(https?|ftp):\/\//i.test(url || '')) return false;

    const verdict = Application.instance.sessions?.decideExtensionNavigation(
      url,
      this.webContents,
    );
    if (!verdict || verdict.action === 'none' || verdict.action === 'allow') {
      return false;
    }

    if (verdict.action === 'block') {
      tlog(`[crx-dnr] blocked main-frame navigation tab=${this.id} url=${url}`);
      // Let the request reach the session.webRequest DNR enforcer, which cancels
      // it synchronously with {cancel:true}. That preserves Chromium's blocked
      // navigation/error semantics. Replacing it with about:blank incorrectly
      // emitted ERR_ABORTED followed by a successful blank-page navigation.
      return false;
    }

    const target = verdict.redirectUrl;
    if (!target || target === url) return false;
    tlog(
      `[crx-dnr] redirected main-frame navigation tab=${this.id} ${url} -> ${target}`,
    );
    const loadTarget = () => {
      if (this.webContents.isDestroyed()) return;
      this.webContents.loadURL(target).catch((error) => {
        console.log('[crx-dnr] failed to load redirected navigation:', target, error);
      });
    };
    queueMicrotask(() => {
      if (this.webContents.isDestroyed()) return;
      // Do NOT call webContents.stop() here. A microtask still runs BEFORE the
      // navigation controller yields back from did-start-navigation, so the
      // in-flight navigation is still being set up — and calling stop() at that
      // instant deterministically crashes the main process with an
      // ACCESS_VIOLATION inside electron.exe (repro on every .user.js install).
      // loadURL(target) supersedes the in-flight request on its own; the
      // superseded request's ERR_ABORTED is the normal "navigation replaced"
      // signal that did-fail-load already handles. (The pre-DNR userscript
      // redirect relied on loadURL alone for exactly this reason.)
      loadTarget();
    });
    return true;
  }

  private getOpenLinksInNewPageHost(rawUrl = this.webContents.getURL()) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return '';
      }
      return parsed.hostname || '';
    } catch {
      return '';
    }
  }

  private applyOpenLinksInNewPageBehavior() {
    const code = buildOpenLinksInNewPageCode(this.openLinksInNewPageEnabled);

    this.webContents.executeJavaScript(code, true).catch(() => undefined);

    for (const frameInfo of this.framesCache) {
      const frame = webFrameMain.fromId(
        frameInfo.frameProcessId,
        frameInfo.frameRoutingId,
      );
      if (frame) {
        frame.executeJavaScript(code, true).catch(() => undefined);
      }
    }
  }

  public canToggleOpenLinksInNewPage() {
    return this.getOpenLinksInNewPageHost() !== '';
  }

  public async syncOpenLinksInNewPageRule() {
    const host = this.getOpenLinksInNewPageHost();

    if (!host) {
      this.openLinksInNewPageEnabled = false;
      return;
    }

    try {
      const record = await Application.instance.storage.findOne<IPermissionRecord>({
        scope: 'permissions',
        query: {
          url: host,
          permission: OPEN_LINKS_IN_NEW_PAGE_PERMISSION,
        },
      });

      this.openLinksInNewPageEnabled = record?.type === 1;
    } catch {
      this.openLinksInNewPageEnabled = false;
    }

    this.applyOpenLinksInNewPageBehavior();
  }

  public async setOpenLinksInNewPageRule(enabled: boolean) {
    const host = this.getOpenLinksInNewPageHost();
    if (!host) return;

    const existing = await Application.instance.storage.findOne<IPermissionRecord>({
      scope: 'permissions',
      query: {
        url: host,
        permission: OPEN_LINKS_IN_NEW_PAGE_PERMISSION,
      },
    });

    if (existing?._id) {
      await Application.instance.storage.update({
        scope: 'permissions',
        query: {_id: existing._id},
        value: {
          type: enabled ? 1 : 2,
          mediaTypes: existing.mediaTypes || '',
        },
      });
    } else {
      await Application.instance.storage.insert({
        scope: 'permissions',
        item: {
          url: host,
          permission: OPEN_LINKS_IN_NEW_PAGE_PERMISSION,
          type: enabled ? 1 : 2,
          mediaTypes: '',
        },
      });
    }

    await this.syncOpenLinksInNewPageRule();
  }

  private async detectAndInstallFlashSupport(pageUrl: string, probeGen: number) {
    // Electron 不支持在 off-the-record BrowserContext 中加载扩展，隐身标签跳过。
    if (
      this.incognito ||
      !process.env.ENABLE_EXTENSIONS ||
      Application.instance.settings.object.flashSupport === false ||
      !/^https?:\/\//i.test(pageUrl)
    ) {
      return;
    }

    // 首次在 did-finish-load 立即检查；再延迟一次覆盖 React/Vue 等框架在 load 后
    // 异步挂载播放器的页面。每次都核对代际和 URL，绝不作用到用户随后打开的新页面。
    const delays = [0, 1500];
    for (const delay of delays) {
      if (delay) {
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, delay));
      }
      if (
        this.webContents.isDestroyed() ||
        Application.instance.settings.object.flashSupport === false ||
        probeGen !== this.flashProbeGen ||
        this.webContents.getURL() !== pageUrl
      ) {
        return;
      }

      const needsFlash = await detectFlashRequirement(this.webContents);
      if (!needsFlash) continue;

      const installedNow = await Application.instance.sessions.ensureRuffleExtensionInstalled();
      const pageStillCurrent =
        !this.webContents.isDestroyed() &&
        probeGen === this.flashProbeGen &&
        this.webContents.getURL() === pageUrl;
      if (
        installedNow &&
        pageStillCurrent &&
        Application.instance.sessions.claimRuffleInstallNotice()
      ) {
        const result = await dialog.showMessageBox(this.window.win, {
          type: 'info',
          title: 'Flash 支持',
          message: '检测到网页正在使用 Flash，Flash 兼容插件已安装。',
          detail: '点击“确认并刷新”让兼容插件在当前页面生效。',
          buttons: ['确认并刷新', '设置', '稍后'],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });
        if (
          result.response === 0 &&
          !this.webContents.isDestroyed() &&
          probeGen === this.flashProbeGen &&
          this.webContents.getURL() === pageUrl
        ) {
          this.webContents.reload();
        } else if (result.response === 1 && !this.window.win.isDestroyed()) {
          this.window.viewManager.create({
            url: `${getWebUIURL('settings')}?section=system`,
            active: true,
          });
        }
      }
      return;
    }
  }

  public constructor(
    window: AppWindow,
    url: string,
    incognito: boolean,
    opts: { warm?: boolean; loadOptions?: LoadURLOptions } = {},
  ) {
    const preload = `${app.getAppPath()}/build/view-preload.bundle.js`;
    console.log('[PDF Drag-Drop] View constructor called with URL:', url);
    console.log('[PDF Drag-Drop] URL is file://', url.startsWith('file:///'));
    console.log('[PDF Drag-Drop] URL extension:', url.slice(url.lastIndexOf('.')).toLowerCase());
    console.log(preload);
    this.browserView = new BrowserView({
      webPreferences: {
        session: incognito ? Application.instance.sessions.viewIncognito : Application.instance.sessions.view,
        preload: preload,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        allowRunningInsecureContent: true,
        contextIsolation: false,
        sandbox: false,
        enableRemoteModule: false,
        partition: incognito ? 'persist:view_incognito' : 'persist:view',
        plugins: true,
        nativeWindowOpen: true,
        webSecurity: true,
        javascript: true,
        worldSafeExecuteJavaScript: true,
      },
    });
    require("@electron/remote/main").enable(this.browserView.webContents);

    // 网页绘制前的底色跟随主题:暗色给 #1c1c1c,消除点击链接在新标签页打开时的白闪。
    // setBackgroundColor 设的颜色在 webContents 生命周期内对所有后续导航生效,
    // 故构造时设一次即覆盖「新标签打开」与「标签内跳转」两类闪屏。
    this.browserView.setBackgroundColor(
      incognito ? '#202124' : getViewBackgroundColor(),
    );

    // 如果初始 URL 是 koodoreader 支持的电子书文件,直接重定向到 koodoreader
    if (url && url.startsWith('file:///')) {
      const path = filePathFromFileUrl(url);
      const koodoUrl = buildKoodoReaderUrl(path);
      if (koodoUrl) {
        console.log('[file-nav] initial URL redirects to koodoreader:', koodoUrl);
        this.homeUrl = koodoUrl;
      }
    }

    // 拦截 BrowserView 上的文件导航(koodoreader 支持的格式重定向到阅读器)
    const handleFileNavigation = (e: any, url: string, isMainFrame: boolean) => {
      if (!isMainFrame) return;
      if (url.startsWith('file:///')) {
        const path = filePathFromFileUrl(url);
        const koodoUrl = buildKoodoReaderUrl(path);
        if (koodoUrl) {
          console.log('[file-nav] redirecting to koodoreader:', koodoUrl);
          e.preventDefault();
          queueMicrotask(() => {
            this.window.viewManager.create({ url: koodoUrl, active: true });
          });
        }
      }
    };

    this.browserView.webContents.on('will-navigate', (e, url) => {
      handleFileNavigation(e, url, true);
    });

    this.browserView.webContents.on('did-start-navigation', (e, url, isInPlace, isMainFrame) => {
      // did-start-navigation 没有 preventDefault,要用 stop() 中止导航。
      // 但绝不能在回调里同步 stop()——会触发 Chromium CHECK 硬崩主进程
      // (见上方 crx-dnr 重定向的同款注释)。必须等事件回栈后,在微任务里中止原请求、再开 koodoreader。
      if (isMainFrame && !isInPlace && url.startsWith('file:///')) {
        const path = filePathFromFileUrl(url);
        const koodoUrl = buildKoodoReaderUrl(path);
        if (koodoUrl) {
          console.log('[file-nav] did-start-navigation stopping, opening koodoreader:', koodoUrl);
          queueMicrotask(() => {
            if (this.webContents.isDestroyed()) return;
            this.webContents.stop();
            this.window.viewManager.create({ url: koodoUrl, active: true });
          });
        }
      }
    });

    // 注:chromeExtensions.addTab 不在构造时调用——预热 View(warm 模式)停在 about:blank,
    // 此时注册会被 store.addTab 设为窗口 active tab,污染扩展系统的 onActivated/active 标签。
    // 注册推迟到 load()(acquire 后首次),由 this.extensionsRegistered 守卫。
    this.incognito = incognito;

    (this.webContents as any).windowId = window.win.id;

    this.window = window;
    this.homeUrl = url;

    // 内容 view 获得焦点(用户点回网页,或切标签/新标签聚焦内容)时,关闭所有仍
    // 可见的持久弹窗。弹窗自身渲染层的 window blur 自动关闭在本环境偶发不触发,
    // 会卡在「关不掉」的状态;改以内容 view 获焦作为「用户已离开浮层」的可靠
    // 信号来关闭它们(与 view-manager.select() 里的关闭互为兜底)。
    this.webContents.on('focus', () => {
      const keepOpen = Application.instance.dialogs.persistentDialogs.some(
        (dialog) =>
          dialog.name === 'sidebar-panel' &&
          dialog.visible &&
          dialog.browserWindow === this.window.win,
      )
        ? ['sidebar-panel']
        : [];
      Application.instance.dialogs.hideAllPersistent(this.window.win, keepOpen);
      this.window.send('clear-tab-hover');
    });

    ipcMain.handle(`get-error-url-${this.id}`, async (e) => {
      return this.errorURL;
    });
    ipcMain.handle(`ignore-certificate-error-${this.id}`, async (e) => {
      if (e.sender.id !== this.webContents.id) {
        return {error: '无权忽略该证书错误'};
      }

      const host = getCertificateErrorHost(this.errorURL);
      if (!host) {
        return {error: '无法获取当前域名'};
      }

      certificateErrorAllowedHosts.add(host);
      return {success: true};
    });
    ipcMain.on(`supervideo-video-created-${this.id}`, async (e, data) => {
      console.log("supervideo-video-created", data);
      this.addVideoUrl(data.url);
    });
    ipcMain.on(`show-full-video-dialog-${this.id}`, async (e) => {
      const inject = getVideoPlayCode("full");
      this.webContents.executeJavaScript(inject, true);
      for (let item of this.framesCache) {
        const {frameProcessId, frameRoutingId} = item;
        const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
        if (frame) {
          frame.executeJavaScript(inject, true);
        }
      }
    });
    ipcMain.on(`show-float-video-dialog-${this.id}`, async (e) => {
      const inject = getVideoPlayCode("float");
      this.webContents.executeJavaScript(inject, true);
      for (let item of this.framesCache) {
        const {frameProcessId, frameRoutingId} = item;
        const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
        if (frame) {
          frame.executeJavaScript(inject, true);
        }
      }
    });

    function getPotPlayerInstallPath(x64: boolean) {
      const regKey = 'HKLM\\SOFTWARE\\DAUM\\PotPlayer' + (x64 ? '64' : '');
      return new Promise((resolve, reject) => {
        execFile('reg', ['query', regKey, '/v', 'ProgramPath'], (error, stdout, stderr) => {
          if (error) {
            console.error(`查询注册表时发生错误: ${error.message}`);
            reject(error);
            return;
          }
          if (stderr) {
            console.error(`注册表查询错误: ${stderr}`);
            reject(new Error(stderr));
            return;
          }
          // 解析注册表查询结果，提取Potplayer的安装路径
          const match = stdout.match(/ProgramPath\s+REG_SZ\s+(.+)/i);
          if (!match || match.length < 2) {
            reject(new Error('未找到PotPlayer的安装路径'));
            return;
          }
          const installPath = match[1];
          console.log("PotPlayer installPath: ", installPath)
          resolve(installPath);
        });
      });
    }

    function callPotPlayer(path: string, url: string, headers?: Record<string, string>) {
      // 直接用 execFile 传 argv,不走 shell:既避免把嗅探到的 url/headers 拼进命令行
      // 造成命令注入,也消除"浏览器进程派生 cmd.exe 执行外部程序"的启发式特征。
      const args: string[] = [url];
      if (headers) {
        //有些网站带UA也无法播放
        const hd = Object.keys(headers).map(it => `${it}: ${headers[it]}`)
          .filter(it => !it.includes('"')
            && !it.startsWith("Accept")
            && !it.startsWith("User-Agent")
            && !it.toLowerCase().startsWith("sec-"))
          .join("\r\n");
        if (hd) {
          args.push(`/headers=${hd}`);
        }
        console.log("headers", hd ? `/headers=${hd}` : "");
      }
      execFile(path, args, (error, stdout, stderr) => {
        if (error) {
          console.error(`调用PotPlayer时发生错误: ${error.message}`);
          alert(`调用PotPlayer时发生错误: ${error.message}`)
          return;
        }
        if (stderr) {
          console.error(`PotPlayer输出错误: ${stderr}`);
          return;
        }
        console.log('PotPlayer已成功启动');
      });
    }

    ipcMain.on(`show-other-video-dialog-${this.id}`, async (e) => {
      //暂停播放
      const inject = getVideoPlayCode("other");
      this.webContents.executeJavaScript(inject, true);
      for (let item of this.framesCache) {
        const {frameProcessId, frameRoutingId} = item;
        const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
        if (frame) {
          frame.executeJavaScript(inject, true);
        }
      }
      const url = this.videoUrls[0];
      let headers = {};
      for (let netVideoUrl of this.netVideoUrls) {
        if (netVideoUrl.url == url) {
          headers = netVideoUrl.requestHeaders;
          break
        }
      }
      //调用PotPlayer打开指定的视频文件
      const callDefaultPath = () => {
        const path = 'C:\\Program Files\\Potplayer\\PotPlayer.exe';
        if (existsSync(path)) {
          callPotPlayer(path, url, headers);
        } else {
          dialog.showMessageBox({
            type: 'warning',
            title: '温馨提示',
            message: '请确认你有安装PotPlayer，安装后才能唤起播放视频',
            buttons: ['确定']
          });
        }
      };
      const callX86 = () => {
        getPotPlayerInstallPath(false)
          .then((path: string) => {
            if (existsSync(path)) {
              callPotPlayer(path, url, headers);
            } else {
              callDefaultPath();
            }
          }).then(err => {
          callDefaultPath();
        });
      };
      getPotPlayerInstallPath(true)
        .then((path: string) => {
          if (existsSync(path)) {
            callPotPlayer(path, url, headers);
          } else {
            callX86();
          }
        }).then(err => {
        callX86();
      });
    });

    this.webContents.on('context-menu', (e, params) => {
      const menu = getViewMenu(this.window, params, this.webContents, this.incognito);
      menu.popup();
    });

    this.webContents.addListener('found-in-page', (e, result) => {
      Application.instance.dialogs
        .getDynamic('find')
        .browserView.webContents.send('found-in-page', result);
    });

    this.webContents.addListener('page-title-updated', (e, title) => {
      this.window.updateTitle();
      this.updateData();

      this.emitEvent('title-updated', title);
      this.updateURL(this.webContents.getURL());
    });

    this.webContents.on('will-navigate', (e, nextUrl) => {
      if (this.handleKtllqNavigation(nextUrl)) {
        e.preventDefault();
      } else if (this.handleInternalFlagsNavigation(nextUrl)) {
        e.preventDefault();
      } else if (this.handleExtensionDnrNavigation(nextUrl)) {
        e.preventDefault();
      }
    });

    this.webContents.on('will-redirect', (e, nextUrl) => {
      if (this.handleKtllqNavigation(nextUrl)) {
        e.preventDefault();
      } else if (this.handleInternalFlagsNavigation(nextUrl)) {
        e.preventDefault();
      } else if (this.handleExtensionDnrNavigation(nextUrl)) {
        e.preventDefault();
      }
    });

    // 子框架(如新标签页内嵌的 pcapp.rainsee.cn iframe)里的 ktllq:// 链接不会
    // 触发 will-navigate/will-redirect(二者只对主框架生效),需用 will-frame-navigate
    // 兜底。仅处理子框架,主框架仍走上面的 will-navigate,避免重复触发(gocamera 会弹两次文件框)。
    this.webContents.on('will-frame-navigate', (e: any) => {
      if (e.isMainFrame) return;
      if (this.handleKtllqNavigation(e.url)) {
        e.preventDefault();
        return;
      }

      // 新标签页内嵌 pcapp.rainsee.cn iframe:若 iframe 内跳转到非 pcapp 主域的
      // http(s) 链接(如点了某个站点),不在 iframe 里加载,改为在浏览器开新标签。
      // 仅限新标签页生效,避免影响普通网页里正常的跨域 iframe(广告/嵌入/OAuth 等)。
      if (this.isNewTab && this.shouldBreakOutNewTabFrame(e.url)) {
        e.preventDefault();
        const targetUrl = e.url;
        queueMicrotask(() => {
          this.window.viewManager.create(
            {url: targetUrl, active: true, incognito: this.incognito} as any,
            true,
          );
        });
      }
    });

    this.webContents.addListener('did-navigate', async (e, url) => {
      tlog(`view ${this.id}: did-navigate url=${url}`);
      this.emitEvent('did-navigate', url);
      this.videoUrls = [];
      this.netVideoUrls = [];
      this.videoMeta.clear();
      this.framesCache = [];
      this.requestRecord.clear();
      await this.addHistoryItem(url);
      this.updateURL(url);
      this.emitEvent('supervideo-video', this.videoUrls);
    });

    this.webContents.addListener(
      'did-navigate-in-page',
      async (e, url, isMainFrame) => {
        if (isMainFrame) {
          this.emitEvent('did-navigate', url);

          await this.addHistoryItem(url, true);
          this.updateURL(url);
          injectSearchAnnotator(this.webContents).catch(() => undefined);
        }
      },
    );
    this.webContents.setWindowOpenHandler((details) => {
      console.log("setWindowOpenHandler", details);
      if (this.handleKtllqNavigation(details.url, true)) {
        return {action: 'deny'};
      }
      if (this.handleInternalFlagsNavigation(details.url, true)) {
        return {action: 'deny'};
      }
      switch (details.disposition) {
        case 'foreground-tab':
        case 'background-tab':
        case 'new-window': {
          // setWindowOpenHandler doesn't yet support creating BrowserViews
          // instead of BrowserWindows. For now, we're opting to break
          // window.open until a fix is available.
          // https://github.com/electron/electron/issues/33383
          if (details.url != null && details.url != "" && details.url != "about:blank") {
            // 表单 POST target=_blank:details.postBody 仅此场景存在(见 Electron 文档)。
            // 同步提取字节(microtask 执行时原 details 可能已被 Electron 回收),否则新
            // 标签会丢失 POST 请求体→服务端按 GET 解析→表单参数全部丢失。
            const loadOptions = postBodyToLoadOptions(details.postBody);
            queueMicrotask(() => {
              this.window.viewManager.create(
                {
                  url: details.url,
                  active: true,
                  incognito: this.incognito,
                  loadOptions,
                } as any,
                true,
                true,
                this.id,
              );
            });
          }
          return {action: 'deny'}
        }
        default:
          return {action: 'allow'}
      }
    });

    // 兜底：页面若重新定义 window.close，绕过 view-preload 的改写，Electron
    // 仍会先在该 WebContents 上发出 close。此时移除当前标签；去重标记避免
    // 与扩展 store 在 destroyed 后的清理路径重复触发。
    let pageCloseRequested = false;
    (this.webContents as any).on('close', () => {
      if (pageCloseRequested) return;
      pageCloseRequested = true;
      if (!this.window.win.isDestroyed()) {
        this.window.send('remove-tab', this.id);
      }
    });

    this.webContents.addListener('did-stop-loading', () => {
      tlog(`view ${this.id}: did-stop-loading url=${this.webContents.getURL()}`);
      // 加载停止:挂回加载隐藏中的内容 view(did-finish-load 未到的兜底,如长连接 pending 页)。
      this.showAfterLoading();
      this.updateNavigationState();
      this.emitEvent('loading', false);
      this.updateURL(this.webContents.getURL());
    });

    this.webContents.addListener('did-start-loading', () => {
      tlog(`view ${this.id}: did-start-loading`);
      this.hasError = false;
      this.updateNavigationState();
      this.emitEvent('loading', true);
      this.updateURL(this.webContents.getURL());
      this.webContents.executeJavaScript(hookClickCode, true);
    });

    this.webContents.addListener('did-start-navigation', async (e, ...args) => {
      tlog(`view ${this.id}: did-start-navigation url=${args[0]}`);
      this.updateNavigationState();

      this.favicon = '';
      this.faviconScore = 0;

      this.emitEvent('load-commit', ...args);
      this.updateURL(this.webContents.getURL());

      // 暗色模式:主帧真实导航开始即隐藏内容 view,直到 did-finish-load 再挂回(消除 FOUC 白闪)。
      // args: [url, isInPlace, isMainFrame, ...]
      if (args[2] && !args[1]) this.hideForLoading(args[0]);

      // 主帧开始导航:先清掉翻译状态,等 did-finish-load 重新探测,避免上一页图标残留。
      if (args[2]) {
        if (!args[1]) this.flashProbeGen++;
        this.emitEvent('can-translate', false, '');
        // 切语言触发的 reload:消耗标记,保持 active;真正跳转则关闭翻译。
        // (不比较 URL:翻译组件会给 URL 加 #googtrans 哈希,reload 后 URL 已与起始不同。)
        if (this.translateReloadingForLang) {
          this.translateReloadingForLang = false;
        } else if (this.translateActive) {
          this.translateActive = false;
          this.emitEvent('translate-state', false, '');
        }
        // PWA:清掉上一页的可安装/已安装态。不在此 bump pwaGen——主帧 did-start-navigation
        // 可能在同一页内多次触发(reload / SPA history / 重定向),bump 会误判在途探测为
        // 过期。仅 did-finish-load 启动新探测时 bump(见下),完成时按"不同站点才丢弃"判定。
        this.canInstallPwa = false;
        this.pwaManifest = null;
        this.pwaInstalled = false;
        this.emitEvent('pwa-installable', false, null, false);
      }
    });

    // `will-navigate` only fires for renderer-initiated navigations (link
    // clicks, in-page JS). Address-bar input and other host-side `loadURL`
    // calls go straight to `did-start-navigation`, so we also intercept
    // internal flags navigations here.
    this.webContents.on(
      'did-start-navigation',
      (e, url, isInPlace, isMainFrame) => {
        if (!isMainFrame || isInPlace) return;
        if (!this.getInternalFlagsTarget(url)) return;
        this.handleInternalFlagsNavigation(url);
      },
    );

    // Direct webContents.loadURL calls (for example chrome.tabs.update) bypass
    // View.load and renderer will-navigate. Re-evaluate the same extension DNR
    // rules here; a redirecting load supersedes the in-flight original request.
    this.webContents.on(
      'did-start-navigation',
      (e, url, isInPlace, isMainFrame) => {
        if (!isMainFrame || isInPlace) return;
        this.handleExtensionDnrNavigation(url);
      },
    );

    this.webContents.on(
      'dom-ready',
      () => {
        // 主帧手势尽早在 DOM 就绪后挂载,避免等待整页资源加载完才能使用。
        this.injectMainFrameGesture();
      },
    );

    this.webContents.on(
      'did-finish-load',
      () => {
        // 页面加载完成:挂回加载隐藏中的内容 view(主显示触发点)。
        this.showAfterLoading();
        const pageUrl = this.webContents.getURL();
        // about:blank / 空 URL(预热 View 静默态、真实标签重定向过渡态)跳过:
        // 否则 injectCosmeticForHost('')、detectTranslateState、detectPwaState、
        // fetchFaviconFromPage 会跑空(不崩但浪费 CPU、可能 favicon 闪烁)。
        if (!pageUrl || pageUrl === 'about:blank') return;
        this.detectAndInstallFlashSupport(pageUrl, this.flashProbeGen).catch(() => undefined);
        // did-finish-load 再补一次,覆盖极慢页/重定向场景,版本戳会让旧监听器失效。
        this.injectMainFrameGesture();
        if (pageUrl && pageUrl.startsWith("http://localhost:") || pageUrl.startsWith("file://") || pageUrl.startsWith("yjllq://")) {
          return
        }
        // 复用用户"标记广告"生成的隐藏规则(cosmetic), 注入匹配本域名的 CSS
        try {
          injectCosmeticForHost(this.webContents, this.hostname);
        } catch (e) {
          console.log("injectCosmeticForHost", e);
        }
        this.webContents.executeJavaScript(`Object.defineProperty(navigator, 'userAgent', { value: '${ChromeUserAgent}' });Object.defineProperty(navigator, 'appVersion', { value: '${ChromeAppVersion}' });true`)
          .catch(e => {
            console.log("executeJavaScript1", e);
          });
        this.webContents.executeJavaScript(watchVideoCode, true).catch(e => {
          console.log("executeJavaScript2", e);
        });
        injectSearchAnnotator(this.webContents).catch(e => {
          console.log("injectSearchAnnotator", e);
        });
        this.syncOpenLinksInNewPageRule().catch(() => undefined);
        // 检测页面语言:与 App 语言不一致则上报,地址栏显示翻译图标。
        detectTranslateState(this.webContents).then(({canTranslate, lang}) => {
          this.emitEvent('can-translate', canTranslate, lang);
        }).catch(() => undefined);
        // 检测 PWA 安装性:满足 manifest + SW 条件则上报,地址栏显示安装图标。
        // (SW 轮询最长 4s;期间可能发生同页 reload/SPA/重定向,故仅在"导航到不同站点"
        // 时才丢弃过期结果——同站结果总是采用,更新的同站探测会自然覆盖。)
        const pwaGen = ++this.pwaGen;
        const detectUrl = this.webContents.getURL();
        detectPwaState(this.webContents).then(({canInstall, manifest}) => {
          if (this.webContents.isDestroyed()) return;
          const curUrl = this.webContents.getURL();
          let sameOrigin = false;
          try {
            sameOrigin = new URL(curUrl).origin === new URL(detectUrl).origin;
          } catch {
            sameOrigin = curUrl === detectUrl;
          }
          // 仅当"有更新的探测启动(gen 不匹配)"且"已导航到不同站点"才丢弃。
          // 同站(SPA/reload/重定向/about:blank 闪动)一律采用,避免误清导致图标不出现。
          if (pwaGen !== this.pwaGen && !sameOrigin) {
            console.log('[pwa] stale result discarded', detectUrl, '→', curUrl, 'gen', pwaGen, 'cur', this.pwaGen);
            return;
          }
          this.canInstallPwa = canInstall;
          this.pwaManifest = manifest;
          this.pwaInstalled = isUrlInstalled(manifest?.startUrl || curUrl);
          console.log('[pwa] emit pwa-installable', curUrl, 'canInstall=' + canInstall, 'installed=' + this.pwaInstalled, 'gen', pwaGen, 'cur', this.pwaGen);
          this.emitEvent('pwa-installable', canInstall, manifest, this.pwaInstalled);
        }).catch(() => undefined);
        // Favicon DOM 探测:补充/覆盖 page-favicon-updated。抓取页面 <link> 声明的
        // 高清图标(apple-touch-icon / svg),若比当前已选候选更优则覆盖。
        fetchFaviconFromPage(this.webContents, Application.instance.storage)
          .then((resolved) => {
            if (resolved) this.applyFavicon(resolved);
          })
          .catch(() => undefined);
        // 翻译已开启(导航到新页 / 回到已翻译页):新文档已丢页面侧引导,按当前 target 重跑。
        if (this.translateActive) {
          this.emitEvent('translate-state', true, this.translateTarget);
          this.driveTranslate();
        }
      },
    );

    this.webContents.on(
      'did-frame-finish-load',
      (event: Event,
       isMainFrame: boolean,
       frameProcessId: number,
       frameRoutingId: number) => {
        console.log("did-frame-finish-load", isMainFrame, frameProcessId, frameRoutingId);
        if (!isMainFrame) {
          const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
          if (frame) {
            this.framesCache.push({
              frameProcessId, frameRoutingId
            });
            try {
              frame.executeJavaScript(`Object.defineProperty(navigator, 'userAgent', { value: '${ChromeUserAgent}' });Object.defineProperty(navigator, 'appVersion', { value: '${ChromeAppVersion}' });true`).catch(e => {
                console.log("executeJavaScript1", e);
              });
            } catch (e) {
              console.log("executeJavaScript2", e);
            }
            try {
              frame.executeJavaScript(watchVideoCode, true).catch(e => {
                console.log("executeJavaScript", e);
              });
            } catch (e) {
              console.log("executeJavaScript", e);
            }
            try {
              frame.executeJavaScript(this.getExtensionFrameTabBridgeCode(), true).catch(e => {
                console.log("executeExtensionFrameTabBridge", e);
              });
            } catch (e) {
              console.log("executeExtensionFrameTabBridge", e);
            }
            frame.executeJavaScript(hookClickCode, true).catch(e => {
              console.log("executeJavaScript", e);
            });
            frame
              .executeJavaScript(
                buildOpenLinksInNewPageCode(this.openLinksInNewPageEnabled),
                true,
              )
              .catch(() => undefined);
            // 鼠标手势:跨源子帧在此注入(view-preload 进不去),命中后 postMessage 顶层。
            try {
              const gCode = buildGestureCode(
                buildGestureConfig(Application.instance.settings.object),
              );
              frame.executeJavaScript(gCode, true).catch(() => undefined);
            } catch (_) {}
          }
        }
      },
    );
    this.webContents.on('frame-created', (event, details) => {
      console.log('frame-created', details.frame.url);
      details.frame.executeJavaScript(this.getExtensionFrameTabBridgeCode(), true).catch(() => undefined);
      details.frame.executeJavaScript(hookClickCode, true);
      details.frame
        .executeJavaScript(
          buildOpenLinksInNewPageCode(this.openLinksInNewPageEnabled),
          true,
        )
        .catch(() => undefined);
      // frame-created 在文档极早期触发,补 about:blank / srcdoc 等 did-frame-finish-load
      // 未覆盖的帧。版本戳保证后续正式注入令本次失效,不会重触发。
      try {
        details.frame.executeJavaScript(
          buildGestureCode(buildGestureConfig(Application.instance.settings.object)),
          true,
        ).catch(() => undefined);
      } catch (_) {}
    });

    // 注入脚本无 ipcRenderer,经 console.log 作信号通道回传命中的手势。拦截前缀并分发。
    // console-message 对所有帧(含跨源子帧)和所有协议(含 chrome-extension://)都触发,
    // 是不依赖 preload 的唯一通用回传通道。logger.ts 按 sourceId 跳过 chrome-extension
    // 的"渲染层日志记录",但事件本身照发,这里照收。
    this.webContents.on('console-message', (...args: any[]) => {
      // Electron 30+: (event, details{level,message,...}); 旧版 (event, level, message, ...)
      const details = args.length >= 2 && typeof args[1] === 'object' && args[1] !== null ? args[1] : null;
      const message = details ? details.message : args[2];
      if (typeof message !== 'string') return;
      if (message.startsWith('__gesture_inj_err__:')) {
        console.log('[gesture-inject] ERR ' + message);
        return;
      }
      const prefix = '__gesture_fire__:';
      if (!message.startsWith(prefix)) return;
      const actionId = message.slice(prefix.length).trim();
      if (!actionId) return;
      // 值域校验:仅接受当前配置里真实绑定的 actionId,防伪造。
      const cfg = buildGestureConfig(Application.instance.settings.object);
      if (!cfg.enabled) return;
      if (!cfg.map || !Object.values(cfg.map).includes(actionId)) return;
      Application.instance.dispatchGesture(actionId, this.id);
    });

    this.webContents.addListener(
      'did-fail-load',
      (e, errorCode, errorDescription, validatedURL, isMainFrame) => {
        // 加载失败:挂回内容 view,避免错误页加载期间标签保持空白。
        this.showAfterLoading();
        // ignore -3 (ABORTED) - An operation was aborted (due to user action).
        if (isMainFrame && errorCode !== -3) {
          // Guard against an infinite recursion: if loading the error page
          // itself fails, did-fail-load fires again with the whole
          // `yjllq-error://...` URL as the new validatedURL. Re-encoding it
          // each time doubles the URL length until it blows up. When the
          // failed URL is already the error page, stop instead of re-wrapping.
          if (validatedURL && validatedURL.startsWith(`${ERROR_PROTOCOL}://`)) {
            return;
          }

          this.errorURL = validatedURL;

          this.hasError = true;

          this.webContents.loadURL(
            `${ERROR_PROTOCOL}://${NETWORK_ERROR_HOST}/${errorCode}?code=${errorCode}&description=` + encodeURIComponent(errorDescription) + `&validatedURL=` + encodeURIComponent(validatedURL),
          );
        }
      },
    );

    this.webContents.addListener(
      'page-favicon-updated',
      async (e, favicons) => {
        // 遍历 Electron 给的全部候选,按质量评分挑最优下载(不再盲取 favicons[0])。
        // 失败也不立刻放弃——留给 did-finish-load 的 DOM 探测兜底。
        console.log(
          `[favicon] page-favicon-updated (view ${this.id}): electron gave ${favicons?.length || 0}`,
          favicons,
        );
        const best = await resolveBestFavicon(
          favicons.map((url: string) => ({url})),
          Application.instance.storage,
          this.webContents.getURL(),
        );

        if (best) {
          console.log(
            `[favicon] electron→resolved score=${best.score} (view ${this.id})`,
          );
          this.applyFavicon(best);
        } else {
          // Electron 候选全失败:清空但不 emit,DOM 探测拿到后再补发。
          this.favicon = '';
          this.faviconScore = 0;
          this.updateData();
        }
      },
    );

    this.webContents.addListener('zoom-changed', (e, zoomDirection) => {
      const newZoomFactor =
        this.webContents.zoomFactor +
        (zoomDirection === 'in'
          ? ZOOM_FACTOR_INCREMENT
          : -ZOOM_FACTOR_INCREMENT);

      if (
        newZoomFactor <= ZOOM_FACTOR_MAX &&
        newZoomFactor >= ZOOM_FACTOR_MIN
      ) {
        this.webContents.zoomFactor = newZoomFactor;
        this.emitEvent('zoom-updated', this.webContents.zoomFactor);
        this.window.viewManager.emitZoomUpdate();
      } else {
        e.preventDefault();
      }
    });

    this.webContents.addListener(
      'certificate-error',
      (
        event: Electron.Event,
        url: string,
        error: string,
        certificate: Electron.Certificate,
        callback: Function,
      ) => {
        console.log(certificate, error, url);
        const host = getCertificateErrorHost(url);
        if (host && certificateErrorAllowedHosts.has(host)) {
          event.preventDefault();
          callback(true);
          return;
        }

        callback(false);
      },
    );

    this.webContents.addListener('media-started-playing', () => {
      this.emitEvent('media-playing', true);
    });

    this.webContents.addListener('media-paused', () => {
      this.emitEvent('media-paused', true);
    });

    this.browserView.setAutoResize({
      width: true,
      height: true,
      horizontal: false,
      vertical: false,
    });

    // warm 模式:不加载目标 URL,BrowserView 默认停在 about:blank,等待 acquireView
    // 领养后调用 load(url)。非 warm:立即加载(等价原构造函数末尾的 loadURL 流程)。
    if (!opts.warm) {
      this.load(url, opts.loadOptions);
    }
  }

  // 加载目标 URL 并完成扩展注册——构造函数里所有 url 无关初始化已在构造期完成,
  // 这里只做:url→homeUrl、首次注册扩展 tab、isNewTab 判定、两类特殊导航拦截、loadURL。
  // 预热 View 被 acquireView 领养时调用;非 warm View 在构造末尾自调一次。
  // addTab 必须在 loadURL 之前,保证扩展(uBlock 等)能拦截 acquire 后的首个网络请求。
  public registerExtensionContext() {
    if (!this.extensionsRegistered) {
      // 按 incognito 选扩展实例:无痕 view 注册到 chromeExtensionsIncognito(第二实例,
      // session=viewIncognito),普通 view 注册到 chromeExtensions。无白名单时第二实例
      // 为 null,无痕 view 不注册(行为同现状)。tabs.onActivated 不在这里触发——新建 view
      // 未必是活动 tab(后台打开的链接、中键新建等),Chrome 规范下后台 tab 不应触发 onActivated。
      // 活动 tab 的 onActivated 由两条标准路径覆盖:store.addTab 内首个 tab 的
      // setActiveTab → active-tab-changed,以及 renderer 切换标签时的 view-select IPC。
      const sessions = Application.instance.sessions;
      const crx = this.incognito
        ? sessions.chromeExtensionsIncognito
        : sessions.chromeExtensions;
      if (crx) {
        try {
          crx.addTab(this.webContents, this.window.win);
          this.extensionsRegistered = true;
        } catch (e) {
          console.log(
            `[view] chromeExtensions.addTab failed wcId=${this.webContents.id} err=${e && e.message}`,
          );
        }
      }
    }
  }

  public load(url: string, loadOptions?: LoadURLOptions) {
    this.homeUrl = url;

    this.registerExtensionContext();

    if (url.startsWith(getWebUIURL('newtab'))) this.isNewTab = true;

    if (
      !this.handleKtllqNavigation(url) &&
      !this.handleInternalFlagsNavigation(url) &&
      !this.handleExtensionDnrNavigation(url)
    ) {
      tlog(`view ${this.id}: loadURL(${url})`);
      this.webContents
        .loadURL(url, loadOptions)
        .then(() => tlog(`view ${this.id}: loadURL resolved ${url}`))
        .catch((err) =>
          tlog(`view ${this.id}: loadURL rejected ${url}`, err && err.code),
        );
    }
  }

  public get webContents() {
    return this.browserView.webContents;
  }

  public get url() {
    return this.webContents.getURL();
  }

  public get title() {
    return this.webContents.getTitle();
  }

  public get id() {
    return this.webContents.id;
  }

  public get isSelected() {
    return this.id === this.window.viewManager.selectedId;
  }

  // 抓取当前页面快照并缩放为缩略图,缓存到 this.thumbnail。
  // 须在 BrowserView 仍挂载于窗口时调用,否则抓取到空白帧。
  public async captureThumbnail() {
    try {
      const wc = this.webContents;
      if (!wc || wc.isDestroyed() || wc.isLoading()) return;

      const image = await wc.capturePage();
      if (image.isEmpty()) return;

      const { width } = image.getSize();
      // 卡片图区宽约 296px(320 - 2*12),取 2x 清晰度封顶 592。
      const target = Math.min(width, 592);
      const resized = image.resize({ width: target, quality: 'good' });
      this.thumbnail = resized.toDataURL();
    } catch (e) {
      // 抓取失败保持旧缩略图,不抛出影响切标签流程。
    }
  }

  public updateNavigationState() {
    if (this.browserView.webContents.isDestroyed()) return;

    if (this.window.viewManager.selectedId === this.id) {
      this.window.send('update-navigation-state', {
        canGoBack: this.webContents.canGoBack(),
        canGoForward: this.webContents.canGoForward(),
      });
    }
  }

  /**
   * 暗色模式下,主帧真实导航(http/https/file)开始时把内容 BrowserView 从窗口分离:
   * 加载期间内容区露出主窗口深色背景(app.html 的 --startup-bg),消除网页 FOUC——
   * 页面自身 <body> 的默认白底、或 SPA 在挂载/应用深色主题前的白闪。
   * showAfterLoading 在 did-finish-load / did-stop-loading / did-fail-load / 8s 兜底定时器 挂回。
   *
   * 仅暗色模式生效(亮色白底与最终页面一致,无需隐藏)。webui/错误页/about:blank 不隐藏
   * (自带深色壳或加载极快)。后台标签本就未挂载——标记隐藏态,由 select 的守卫拦截挂载,
   * 加载完成若仍非活动标签则不挂回(切回时 select 正常处理)。
   */
  private hideForLoading(url: string) {
    if (!isDarkThemeActive()) return;
    if (
      !url ||
      url === 'about:blank' ||
      !(url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://'))
    ) {
      return;
    }
    if (this.loadingHidden) return;
    this.loadingHidden = true;
    // 已是活动标签(标签内跳转)立即分离;新建标签尚未挂载,select 的守卫会拦截挂载。
    if (this.window?.viewManager?.selectedId === this.id) {
      try {
        this.window.win.removeBrowserView(this.browserView);
      } catch {}
    }
    if (this.loadingHideTimer) clearTimeout(this.loadingHideTimer);
    // 兜底:极慢页或一直 pending 的导航,did-finish-load 迟迟不来,8s 强制挂回避免永久空白。
    this.loadingHideTimer = setTimeout(() => this.showAfterLoading(), 8000);
  }

  private showAfterLoading() {
    if (this.loadingHideTimer) {
      clearTimeout(this.loadingHideTimer);
      this.loadingHideTimer = null;
    }
    if (!this.loadingHidden) return;
    this.loadingHidden = false;
    // 仅当仍是当前活动标签才挂回;否则保持分离,切回时 select 会按正常流程挂载。
    if (this.window?.viewManager?.selectedId === this.id && this.browserView) {
      const b = this.window.viewManager.contentBounds || this.bounds;
      if (b) {
        try {
          this.browserView.setBounds(b);
        } catch {}
      }
      try {
        this.window.win.addBrowserView(this.browserView);
        this.browserView.webContents.focus();
      } catch {}
    }
  }

  /** 加载隐藏中:select() 据此跳过 addBrowserView,避免露出加载中的网页。 */
  public get isLoadingHidden() {
    return this.loadingHidden;
  }

  public destroy() {
    if (this.loadingHideTimer) {
      clearTimeout(this.loadingHideTimer);
      this.loadingHideTimer = null;
    }
    this.loadingHidden = false;
    (this.browserView.webContents as any).destroy();
    this.browserView = null;
  }

  public async updateCredentials() {
    if (
      !process.env.ENABLE_AUTOFILL ||
      this.browserView.webContents.isDestroyed()
    )
      return;

    // 钥匙图标:域名级匹配,本站任一账号即点亮(与填充逻辑一致)
    const all = await Application.instance.storage.find<any>({
      scope: 'formfill',
      query: {type: 'password'},
    });
    const host = this.hostname;
    const has =
      !!host && all.some((r: any) => r && r.url && hostMatches(r.url, host));

    this.emitEvent('credentials', has);
  }

  public async addHistoryItem(url: string, inPage = false) {
    if (
      url !== this.lastUrl &&
      !url.startsWith(WEBUI_BASE_URL) &&
      !url.startsWith(`${ERROR_PROTOCOL}://`) &&
      !this.incognito
    ) {
      const historyItem: IHistoryItem = {
        title: this.title,
        url,
        favicon: this.favicon,
        date: new Date().getTime(),
      };

      await this.historyQueue.enqueue(async () => {
        this.lastHistoryId = (
          await Application.instance.storage.insert<IHistoryItem>({
            scope: 'history',
            item: historyItem,
          })
        )._id;

        historyItem._id = this.lastHistoryId;

        Application.instance.storage.addHistory(historyItem);

        // 通知扩展(chrome.history.onVisited)浏览器记录了一次访问
        if (process.env.ENABLE_EXTENSIONS) {
          Application.instance.sessions?.chromeExtensions?.notifyHistoryVisited({
            id: this.lastHistoryId || historyItem.url,
            url: historyItem.url,
            title: historyItem.title || '',
            lastVisitTime: historyItem.date,
            visitCount: 1,
            typedCount: 0,
          });
        }

      });
    } else if (!inPage) {
      await this.historyQueue.enqueue(async () => {
        this.lastHistoryId = '';
      });
    }
  }

  public updateURL = (url: string) => {
    if (this.lastUrl === url) return;

    this.emitEvent('url-updated', this.hasError ? this.errorURL : url);

    this.lastUrl = url;

    this.isNewTab = url.startsWith(getWebUIURL("newtab"));

    this.updateData();

    if (process.env.ENABLE_AUTOFILL) this.updateCredentials();

    this.updateBookmark();
  };

  public updateBookmark() {
    // 移动设备书签下的项不算「已收藏」，查找时直接排除
    this.bookmark = Application.instance.storage.bookmarks.find(
      (x) =>
        x.url === this.url &&
        !Application.instance.storage.isUnderMobileFolder(x),
    );

    if (!this.isSelected) return;

    this.window.send('is-bookmarked', !!this.bookmark);
  }

  public async updateData() {
    if (!this.incognito) {
      const id = this.lastHistoryId;
      if (id) {
        const {title, url, favicon} = this;

        this.historyQueue.enqueue(async () => {
          await Application.instance.storage.update({
            scope: 'history',
            query: {
              _id: id,
            },
            value: {
              title,
              url,
              favicon,
            },
            multi: false,
          });

          const item = Application.instance.storage.history.find(
            (x) => x._id === id,
          );

          if (item) {
            item.title = title;
            item.url = url;
            item.favicon = favicon;
          }
        });
      }
    }
  }

  public send(channel: string, ...args: any[]) {
    this.webContents.send(channel, ...args);
  }

  // 主帧手势需用 WebFrameMain 注入:
  // 1. 主帧不会走 did-frame-finish-load;
  // 2. chrome-extension 沙箱页上 webContents.executeJavaScript 可能挂死。
  // dom-ready 先注入保证页面未完全加载时也可用,did-finish-load 再补一次兜底。
  private injectMainFrameGesture(): void {
    try {
      const mainFrame = (this.webContents as any).mainFrame;
      if (mainFrame && typeof mainFrame.executeJavaScript === 'function') {
        mainFrame.executeJavaScript(
          buildGestureCode(buildGestureConfig(Application.instance.settings.object)),
          true,
        ).catch((_: unknown): void => undefined);
      }
    } catch (_) {
      // 导航切换中 / frame 暂不可用:忽略,交给后续事件兜底
    }
  }

  // 配置变更时把最新手势配置重新注入所有已缓存的帧(顶层 + 子帧)。
  // 配置是注入期快照,热更新只能重注入。脚本内版本戳令旧监听器失效,故同帧多次
  // 注入安全(仅最新一份生效)。
  public reinjectGesture() {
    try {
      const code = buildGestureCode(buildGestureConfig(Application.instance.settings.object));
      // 主帧
      this.injectMainFrameGesture();
      // 子帧
      for (const item of this.framesCache) {
        const frame = webFrameMain.fromId(item.frameProcessId, item.frameRoutingId);
        if (frame) frame.executeJavaScript(code, true).catch(() => undefined);
      }
    } catch (_) {
      // 视图销毁中 / 帧已失效:忽略
    }
  }

  // 暂停原网页(含所有子 frame)中正在播放的视频。
  // 打开智能播放器窗口时调用，避免页面与播放器双重发声。
  public pausePageVideos() {
    try {
      const inject = getVideoPlayCode("other");
      this.webContents.executeJavaScript(inject, true).catch(() => undefined);
      for (let item of this.framesCache) {
        const {frameProcessId, frameRoutingId} = item;
        const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
        if (frame) {
          frame.executeJavaScript(inject, true).catch(() => undefined);
        }
      }
    } catch (e) {
    }
  }

  public get hostname() {
    return parseUrl(this.url).hostname;
  }

  // 开启翻译:设 active、驱动微软翻译引擎。persist=true 时把本站加入"始终显示翻译图标"
  // 列表(菜单/右键手动开启时传 true;图标点击/弹窗切语言等不必持久化)。
  public startTranslation(persist = false) {
    if (this.webContents.isDestroyed()) return;
    if (!this.translateTarget) this.translateTarget = 'zh-CN';
    this.translateActive = true;
    this.emitEvent('translate-state', true, this.translateTarget);
    if (persist) this.persistAutoTranslateSite();
    this.driveTranslate();
  }

  // 驱动一次"收集 → 主进程翻译 → 回填"循环。fire-and-forget,靠 translateGen 自取消。
  // 取消条件:webContents 销毁 / 有更新的循环接管(gen 不匹配) / 翻译已关闭。
  private driveTranslate() {
    const gen = ++this.translateGen;
    const wc = this.webContents;
    runMsTranslate(wc, this.translateTarget, () =>
      wc.isDestroyed() || gen !== this.translateGen || !this.translateActive,
    )
      .then((r) => console.log('[translate] ms result', r, 'target=', this.translateTarget))
      .catch((e) => console.log('[translate] ms failed', e));
  }

  // 把当前站点(可注册域名,取最后两段)加入 autoTranslateSites 并持久化。
  // 已存在则跳过。settings 变更会广播到渲染层,地址栏据此始终显示翻译图标。
  private persistAutoTranslateSite() {
    try {
      const host = parseUrl(this.webContents.getURL()).hostname || '';
      const parts = host.split('.');
      const domain = parts.length >= 2 ? parts.slice(-2).join('.') : host;
      if (!domain) return;
      const settings = Application.instance.settings;
      const list = Array.isArray(settings.object.autoTranslateSites)
        ? settings.object.autoTranslateSites.slice()
        : [];
      if (!list.includes(domain)) {
        list.push(domain);
        settings.updateSettings({autoTranslateSites: list});
      }
    } catch (e) {
      console.log('[translate] persistAutoTranslateSite failed', e);
    }
  }

  // 切换目标语言:未开启则直接开启;已开启则原地还原原文,再按新 target 重新收集+翻译(不 reload)。
  public changeTranslationTarget(target: string) {
    if (this.webContents.isDestroyed()) return;
    this.translateTarget = target || 'zh-CN';
    if (!this.translateActive) {
      this.startTranslation();
      return;
    }
    // 原地切语言:先还原成原文(revert 用旧引导的 reg),再重跑(重注入新引导、重新 collect)。
    // driveTranslate 自增 translateGen,旧循环随即自取消,避免新旧译文交错。
    const wc = this.webContents;
    revertMsTranslate(wc)
      .catch(() => undefined)
      .finally(() => this.driveTranslate());
  }

  // 关闭翻译:清 active,原地还原文本节点为原文并移除状态条(不 reload,保留滚动/输入态)。
  public stopTranslation() {
    if (this.webContents.isDestroyed()) return;
    this.translateActive = false;
    this.emitEvent('translate-state', false, '');
    revertMsTranslate(this.webContents).catch(() => undefined);
  }

  // 安装完成后调用:标记本站已安装并广播,地址栏图标转"已安装"态。
  public markPwaInstalled() {
    this.pwaInstalled = true;
    this.emitEvent('pwa-installed', true);
  }

  public emitEvent(event: TabEvent, ...args: any[]) {
    this.window.send('tab-event', event, this.id, args);
    // 嗅探到新视频时，若智能播放器窗口开着且正看本 tab，实时刷新其资源列表
    if (event === 'supervideo-video') {
      try {
        refreshMediaPlayer(this.id);
      } catch (e) {
      }
    }
  }

  // 应用已下载的 favicon:比较评分决定是否采用。
  // - 当前 favicon 为空(page-favicon-updated 失败 / 未触发)→ 直接采用(兜底)。
  // - 当前已有 favicon → 仅当新候选明显更优(超 50 分阈值)才换,防抖动。
  // page-favicon-updated 的主进程下载 与 did-finish-load 的页面脚本下载 都走这里。
  private applyFavicon(resolved: ResolvedFavicon) {
    if (this.webContents.isDestroyed()) return;

    const wasEmpty = !this.favicon;
    const shouldApply = wasEmpty || resolved.score > this.faviconScore + 50;
    console.log(
      `[favicon] apply (view ${this.id}): wasEmpty=${wasEmpty} current=${this.faviconScore} new=${resolved.score} → ${shouldApply ? (wasEmpty ? 'FALLBACK' : 'OVERRIDE') : 'KEEP'}`,
    );
    if (!shouldApply) return;

    this.favicon = resolved.dataUrl;
    this.faviconScore = resolved.score;
    this.updateData();
    this.emitEvent('favicon-updated', resolved.dataUrl);
  }

  public addVideoUrl(url: string) {
    // 智能播放器白名单：当前页 host 命中则不收录（页面 <video> 探测路径，避免地址栏弹图标）。
    if (isVideoPlayerWhitelistedHost(this.hostname)) {
      return;
    }
    let matched: VideoRequest | undefined;
    if (url.startsWith("blob:")) {
      const host = new URL(url.replace("blob:", "")).hostname;
      //console.log("addVideoUrl", url, host, this.netVideoUrls);
      for (let netVideoUrl of this.netVideoUrls) {
        if (netVideoUrl.referrer && new URL(netVideoUrl.referrer).hostname == host) {
          url = netVideoUrl.url;
          matched = netVideoUrl;
        }
      }
      //Origin优先级更高
      for (let netVideoUrl of this.netVideoUrls) {
        if (netVideoUrl.requestHeaders && netVideoUrl.requestHeaders["Origin"]
          && new URL(netVideoUrl.requestHeaders["Origin"]).hostname == host) {
          url = netVideoUrl.url;
          matched = netVideoUrl;
        }
      }
      for (let netVideoUrl of this.netVideoUrls) {
        if (netVideoUrl.frameUrl && new URL(netVideoUrl.frameUrl).hostname == host) {
          url = netVideoUrl.url;
          matched = netVideoUrl;
        }
      }
    }
    this.rememberVideoMeta(url, matched);
    if (!this.videoUrls.includes(url)) {
      this.videoUrls.push(url);
      this.emitEvent('supervideo-video', this.videoUrls);
    }
  }

  public addNetVideoRequest(videoRequest: VideoRequest) {
    this.netVideoUrls.push(videoRequest);
    // 网络嗅探到的直链(m3u8/mp4 等)也直接纳入资源列表，
    // 不再依赖页面 <video> 是否暴露 src(很多站点走 blob/MSE)。
    let changed = false;
    if (!videoRequest.url.startsWith("blob:") && !this.videoUrls.includes(videoRequest.url)) {
      this.videoUrls.push(videoRequest.url);
      this.rememberVideoMeta(videoRequest.url, videoRequest);
      changed = true;
    }
    for (let i = 0; i < this.videoUrls.length; i++) {
      let url = this.videoUrls[i];
      if (url.startsWith("blob:")) {
        const host = new URL(url.replace("blob:", "")).hostname;
        //console.log("addNetVideoRequest", url, host, videoRequest);
        if (videoRequest.referrer && new URL(videoRequest.referrer).hostname == host) {
          this.videoUrls[i] = videoRequest.url;
          this.rememberVideoMeta(videoRequest.url, videoRequest);
          changed = true;
        }
        if (videoRequest.requestHeaders && videoRequest.requestHeaders["Origin"]
          && new URL(videoRequest.requestHeaders["Origin"]).hostname == host) {
          this.videoUrls[i] = videoRequest.url;
          this.rememberVideoMeta(videoRequest.url, videoRequest);
          changed = true;
        }
        if (videoRequest.frameUrl && new URL(videoRequest.frameUrl).hostname == host) {
          this.videoUrls[i] = videoRequest.url;
          this.rememberVideoMeta(videoRequest.url, videoRequest);
          changed = true;
        }
      }
    }
    if (changed) {
      this.emitEvent('supervideo-video', this.videoUrls);
    }
  }

  // 记录/合并某个最终 url 的嗅探元信息。已存在则补全缺失字段，保留最早的 addedAt。
  private rememberVideoMeta(url: string, source?: VideoRequest) {
    if (!url || url.startsWith("blob:")) return;
    const existing = this.videoMeta.get(url);
    const base: VideoRequest = existing || {
      url,
      referrer: source?.referrer || this.url,
      addedAt: source?.addedAt || Date.now(),
    };
    if (source) {
      base.requestHeaders = base.requestHeaders || source.requestHeaders;
      base.responseHeaders = base.responseHeaders || source.responseHeaders;
      base.contentType = base.contentType || source.contentType;
      base.mediaType = base.mediaType || source.mediaType;
      base.referrer = base.referrer || source.referrer;
      base.frameUrl = base.frameUrl || source.frameUrl;
      if (!base.addedAt) base.addedAt = source.addedAt || Date.now();
    }
    if (!base.addedAt) base.addedAt = Date.now();
    this.videoMeta.set(url, base);
  }

  // 组装智能播放器窗口需要的富资源列表，按嗅探时间倒序(最新在前)。
  public getVideoItems(): VideoRequest[] {
    const items: VideoRequest[] = [];
    for (const url of this.videoUrls) {
      if (!url || url.startsWith("blob:")) continue;
      const meta = this.videoMeta.get(url);
      let host = "";
      try {
        host = new URL(url).hostname;
      } catch (e) {
      }
      const lower = url.toLowerCase();
      const mediaType = meta?.mediaType
        || (lower.includes(".m3u8") ? "hls" : (lower.includes(".mp4") ? "mp4" : "other"));
      items.push({
        url,
        referrer: meta?.referrer || this.url,
        frameUrl: meta?.frameUrl,
        requestHeaders: meta?.requestHeaders,
        responseHeaders: meta?.responseHeaders,
        contentType: meta?.contentType,
        mediaType,
        addedAt: meta?.addedAt || 0,
        // @ts-ignore 附带 host 方便渲染层展示
        host,
      } as VideoRequest);
    }
    items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    return items;
  }

  // 取某个 url 在播放/下载时应携带的请求头(已清理逐跳/请求态头)。
  public getPlaybackHeaders(url: string): Record<string, string> {
    const meta = this.videoMeta.get(url);
    let headers = meta?.requestHeaders;
    if (!headers) {
      for (const net of this.netVideoUrls) {
        if (net.url === url && net.requestHeaders) {
          headers = net.requestHeaders;
          break;
        }
      }
    }
    return cleanHeaders(headers);
  }
}
