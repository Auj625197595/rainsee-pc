import {
  BrowserView,
  WebContentsView,
  app,
  webFrameMain,
  dialog,
} from 'electron';
import type {LoadURLOptions, WebContents} from 'electron';
import {parse as parseUrl} from 'url';
import {hasSameHostname, hostMatches} from '~/utils/url';
import {
  EXTERNAL_NAVIGATION_PERMISSION,
  IGNORE_CERTIFICATE_ERRORS_PERMISSION,
  OPEN_LINKS_IN_NEW_PAGE_PERMISSION,
  OPEN_POPUPS_IN_NEW_TAB_PERMISSION,
} from '~/utils/permissions';
import {
  allowCertificateErrorHost,
  getCertificateErrorHost,
  isCertificateErrorAllowed,
} from './services/certificate-error-permissions';
import {getViewMenu} from './menus/view';
import {AppWindow} from './windows';
import {
  IHistoryItem,
  IBookmark,
  IFormFillData,
  IPermissionRecord,
  IBluetoothDevice,
  IBluetoothRequestInfo,
  IHidRequestInfo,
  IDisplayCaptureRequestInfo,
} from '~/interfaces';
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
import {TrackedIpcMain} from './services/tracked-ipc';
import {
  ChromeAppVersion,
  ChromeUserAgent,
  DefaultUserAgent,
  getUserAgentForURL,
  isGoogleURL,
} from './user-agent';
import {getNativeWebUIURL, getWebUIURL} from "~/common/webui-main";
import {getInternalFlagsRedirectTarget} from '~/common/internal-flags';
import {cleanHeaders, getVideoPlayCode, hookClickCode, VideoRequest, watchVideoCode} from "~/main/services/supervideo-video";
import {isVideoPlayerWhitelistedHost} from "~/main/services/video-player-whitelist";
import {injectCosmeticForHost} from "~/main/services/adblock";
import {refreshMediaPlayer} from "~/main/windows/media-player";
// 开源版：云同步模块已移除。
import {execFile} from "child_process";
import {randomUUID} from 'crypto';
import {existsSync} from "fs";
import {tlog} from "./timing";
import {injectDarkReader, injectDarkReaderIntoFrame} from './utils/web-dark-mode-inject';
import {injectSearchAnnotator} from "./services/search-annotator";
import {detectTranslateState, runTranslate, revertTranslate} from "./services/translate";
import {getActiveEngine} from "./services/translate/registry";
import {detectPwaState, PwaManifest, isUrlInstalled} from "./services/pwa";
import {
  resolveBestFavicon,
  fetchFaviconFromPage,
  ResolvedFavicon,
} from "./services/favicon";
import {resolveExtensionIconDataUrl} from "./services/chrome-extension-resources";
// 开源版：AI 面板图床上传能力已移除。
import {buildGestureCode} from "./services/gesture-subframe";
import {buildGestureConfig} from "./menus/gesture-actions";
import {getMainTranslator} from "./i18n";

// 手势配置快照:绑定按当前设置解析,标签按当前语言即时翻译(不缓存翻译器)。
const viewGestureConfig = () => buildGestureConfig(
  Application.instance.settings.object,
  getMainTranslator(Application.instance.settings.object.language),
);
import {NativeRightGesture} from './services/native-right-gesture';
import type {NativeRightGestureVisualUpdate} from './services/native-right-gesture';
import {detectFlashRequirement} from './services/flash';
// 开源版：Chrome 主题新标签页注入已随云端 NTP 一并移除。
import {beginPageClose, expirePageClose} from './page-close-guard';
import {requestCredentialPrompt} from './services/credential-prompt';
import {
  ViewSecurityKind,
  createViewWebPreferences,
  getViewPreloadFilename,
  getViewSecurityKind,
  isBuiltinPdfViewerUrl,
  isPdfUrl,
  isCrossViewSecurityNavigation,
  logSandboxedTabsMode,
} from './view-web-preferences';
import {requestPermission} from './dialogs/permissions';
import {requestBluetoothDevice, cancelBluetoothRequest} from './dialogs/bluetooth';
import {cancelHidRequest} from './dialogs/hid';
import {cancelDisplayCaptureRequest} from './dialogs/display-capture';
import {showPageToast} from './menus/common-actions';
import {getExternalNavigationDetails} from './services/external-navigation';
import {getNavigationContext} from './utils/navigation-context';
import {
  getGreasyforkDisplayUrl,
  getGreasyforkMirrorUrl,
  isGreasyforkUrl,
} from './services/google-connectivity';

const MAX_VIDEO_RECORDS = 512;

interface IAuthInfo {
  url: string;
  credentials?: Array<{
    id: string;
    username: string;
  }>;
}

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

      const releaseDetached = (items) => {
        for (let i = items.length - 1; i >= 0; i--) {
          const node = items[i] && items[i].node;
          if (node && node.isConnected) continue;
          if (node) delete node.__rainseeBlankHandled;
          items.splice(i, 1);
        }
      };

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
        // Dynamic pages replace rows and dialogs frequently. Detached nodes no
        // longer need restoration and must not remain strongly referenced.
        releaseDetached(touchedAnchors);
        releaseDetached(touchedForms);
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
  public browserView: BrowserView | WebContentsView;

  private contentViewBacked = false;

  private nativeRightGesture!: NativeRightGesture;

  /**
   * 页面侧手势绘制是否可用。主帧手势代码注入成功(dom-ready)后为 true:
   * 轨迹/标签由页面 canvas 自绘,主进程只识别不再画 overlay 窗口。
   * 主帧真实导航开始即置 false,加载期间由 overlay BrowserWindow 兜底绘制。
   */
  private pageGestureDrawing = false;

  /** 本轮手势起点是否落在页面自绘模式。手势中途页面就绪也不切换,避免轨迹冻结。 */
  private gestureStartedOnPage = false;

  // 由 setWindowOpenHandler.createWindow 收养的原生目标。目标既可能由
  // WebContentsView 承载，也可能由官方 createWindow 示例使用的 BrowserView 承载。
  private nativeWindowOpenTarget = false;
  // PDF compatibility is fixed at WebContents creation time. A PDF View must
  // be replaced before it is reused for a normal document, because Electron
  // cannot toggle sandbox on an existing WebContents.
  private pdfCompat = false;
  private pendingPdfReplacement: {url: string; loadOptions?: LoadURLOptions} | null = null;

  // 只处理 `window.open('about:blank')` 后的第二次脚本导航。直接
  // `window.open(url)` 已由 Chromium/Electron 的 createWindow 完整建立原生
  // WindowProxy，必须保持原生链路，不能错误地套上覆盖页。
  private nativeWindowOpenStartedBlank = false;

  // about:blank 子页的第二次导航使用普通 BrowserView 作为同一标签内的覆盖页，
  // 避免触发原生 WindowProxy 生命周期与导航控制器重入。
  private windowOpenNavigationOverlay?: View;

  private windowOpenNavigationOwner?: View;

  private windowOpenNavigationPending = false;

  // 标签模型的 id 始终绑定最初的 WebContents。覆盖页的 WebContents 仅作为
  // 组合 View 的当前内容，不能改变 renderer 侧 tab id。
  private tabId = 0;

  private pageCloseRequested = false;

  private destroying = false;

  public popupCloseToken = '';

  public isNewTab = false;
  public homeUrl: string;
  public readonly securityKind: ViewSecurityKind;
  public favicon = '';
  // 当前已选 favicon 候选的评分。DOM 探测(did-finish-load)若发现更高分候选
  // (且超过阈值)则覆盖,保证最终用上页面声明的高清图标而非首个低清候选。
  public faviconScore = 0;
  public incognito = false;

  // 扩展系统注册守卫:chromeExtensions.addTab 必须在 load()(acquire 后)首次调用,
  // 不能在构造时(预热 View 停在 about:blank 时)调用——否则 about:blank 会被
  // store.addTab 设为窗口 active tab,污染扩展系统的 onActivated/active 标签语义。
  private extensionsRegistered = false;

  // 每次显式 load 都递增；扩展主页等待完成时只恢复仍属于同一次导航的标签。
  private loadSequence = 0;

  private pendingCrossSecurityNavigation?: {
    url: string;
    loadOptions?: LoadURLOptions;
    stopCurrent: boolean;
  };

  // bejson 快捷格式化请求的代际令牌,避免旧页面加载完成后覆盖新导航。
  private bejsonRequestSequence = 0;
  private bejsonLoadCleanup?: () => void;

  // 标签悬停预览缩略图(data URL)。在标签被切走前抓取当前页面快照缓存,
  // 供悬停卡片展示。背景标签的 BrowserView 已从窗口移除无法实时抓取,
  // 故采用「切走即缓存」策略;当前选中标签则在悬停时实时抓取。
  public thumbnail = '';

  public errorURL = '';

  // Certificate recovery is bounded: the user authorizes the HTTPS retry,
  // then at most one automatic HTTP downgrade is allowed. Public loads reset
  // these markers; internal retries use webContents.loadURL directly.
  private certificateRecoveryUrl = '';
  private certificateIgnoreRetried = false;
  private certificateDowngradeRetried = false;

  private hasError = false;

  // renderer 崩溃后改载本地错误页。若错误页自身也崩溃则不再递归重载，
  // 避免在系统内存耗尽等场景里形成崩溃循环。
  private rendererCrashPageLoading = false;

  // 前台 renderer 崩溃先重载原 URL 一次；该次重载完成前再次崩溃才进入错误页。
  private rendererCrashRetryPending = false;

  private rendererCrashRetryUrl = '';

  public window: AppWindow;

  // 网页翻译状态(主进程为单一可信源:微软翻译引擎跑在主进程,经 executeJavaScript
  // 驱动页面侧引导收集/回填文本节点。active/target 必须由 View 自己记住)。
  public translateActive = false;
  public translateTarget = 'zh-CN';
  // 最近一次检测到的页面语言主语种子(如 'en'/'zh'),用于点击翻译图标时判定
  // "默认目标是否与页面同源"——同源则不自动开译(无意义),让用户在弹窗里选目标。
  public translateDetectedLang = '';
  // 翻译驱动循环的代际令牌:每次 driveTranslate 自增,旧循环在下个 await 点见
  // gen 不匹配即自取消(切语言/关翻译/导航离开时避免新旧回填竞态)。
  private translateGen = 0;
  // 当前驱动循环的 AbortController:切引擎/切语言/关翻译时 abort 在途 fetch,
  // 省自定义 LLM 的 token(translateGen 仅在 chunk 边界取消,在途 HTTP 需 signal 中止)。
  private translateAbort?: AbortController;
  // 同一 WebContents 只允许一轮翻译驱动在外层运行;新导航会取消旧请求,
  // 但要等旧 runTranslate 收尾后再启动下一轮,避免 executeJavaScript 重叠。
  private translateRunPromise: Promise<void> | null = null;
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
  // 深色背景,直到网页暗色样式确认就绪后再挂回,避免网页 FOUC(页面自身白 body)闪一下。
  // isLoadingHidden 供 view-manager.select() 据此跳过 addBrowserView。详见 hideForLoading。
  private loadingHidden = false;

  // 网页暗色模式(浏览器实现)进行中的 Promise。dom-ready 触发注入时挂值,
  // 所有正常显示路径都经过它,确保暗化 CSS 已生效再显示,消除快速页白闪。
  // null 表示无需暗化(非 browser 模式/浅色/非网页)或已完成消费。
  private webDarkModeInjectPromise: Promise<void> | null = null;
  // 主框架真实导航代际。重定向/连续导航时,旧文档的异步注入不得把新文档提前挂回。
  private webDarkModeNavigationId = 0;
  private loadingHideTimer: any = null;

  public lastHistoryId: string;

  public bookmark: IBookmark;

  public findInfo = {
    occurrences: '0/0',
    text: '',
  };

  public requestedAuth: IAuthInfo;
  public requestedPermission: any;
  // Web Bluetooth chooser:数据由 dialogs/bluetooth.ts 挂载,tabAssociation 推送用。
  public requestedBluetooth: IBluetoothRequestInfo | null = null;
  // WebHID chooser request data is associated with the logical tab.
  public requestedHid: IHidRequestInfo | null = null;
  public requestedDisplayCapture: IDisplayCaptureRequestInfo | null = null;
  // 进行中的 select-bluetooth-device 请求:持续触发时只更新列表,完成时调 Chromium callback。
  private bluetoothChooser: {
    callback: Function;
    update: (devices: IBluetoothDevice[]) => void;
  } | null = null;
  public openLinksInNewPageEnabled = false;

  // null 表示当前网站没有覆盖规则，应跟随全局设置。
  private openPopupsInNewTabOverride: boolean | null = null;

  private openPopupsInNewTabOverrideHost = '';

  private externalNavigationRuleHost = '';
  private externalNavigationRule: 1 | 2 | 3 = 1;
  private externalNavigationPromptPending = false;

  // The next Greasy Fork navigation that was already checked by load(). This
  // prevents its did-start-navigation event from starting a second check.
  private approvedGreasyforkNavigationUrl = '';

  // Chromium caps a redirect chain at 20 hops. The session webRequest path is
  // normally responsible for that limit; keep an equivalent guard for the
  // synchronous View fallback, which supersedes a navigation with loadURL().
  private extensionDnrRedirectUrls = new Set<string>();
  private extensionDnrRedirectCount = 0;
  private extensionDnrRedirectLastTarget = '';
  private extensionDnrRedirectLastAt = 0;

  private historyQueue = new Queue();

  private ipc = new TrackedIpcMain();

  private lastUrl = '';
  public videoUrls: string[] = [];
  public netVideoUrls: VideoRequest[] = [];
  public requestRecord: Map<string, Record<string, string>> = new Map();
  public get framesCache(): Array<{
    frameProcessId: number;
    frameRoutingId: number;
  }> {
    const contents = this.browserView?.webContents;
    if (!contents || contents.isDestroyed()) return [];
    try {
      return contents.mainFrame.framesInSubtree
        .filter((frame) => !!frame.parent && !frame.isDestroyed())
        .map((frame) => ({
          frameProcessId: frame.processId,
          frameRoutingId: frame.routingId,
        }));
    } catch {
      return [];
    }
  }
  private autofillCredentialsCache: Promise<IFormFillData[]> | null = null;
  private autofillCaptureFrames = new Map<
    string,
    {processId: number; routingId: number; origin: string; createdAt: number}
  >();
  private autofillCaptureTokens = new Map<string, string>();
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
      groupId: Application.instance.sessions?.getTabGroupId(this.id, this.incognito) ?? -1,
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
    return getInternalFlagsRedirectTarget(url, getWebUIURL('flags'));
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

  /** Redirect Greasy Fork only after the current Google reachability check. */
  private handleGreasyforkNavigation(
    url: string,
    openInNewTab = false,
    active = true,
  ) {
    if (!isGreasyforkUrl(url)) return false;

    queueMicrotask(() => {
      if (openInNewTab) {
        this.window.viewManager.create(
          {url, active, incognito: this.incognito} as any,
          true,
        );
        return;
      }
      this.load(url);
    });
    return true;
  }

  // 内嵌页面框架的「跳出」判断:http(s) 目标应在浏览器开新标签,
  // 而非在内部页面框架里继续加载。
  private shouldBreakOutNewTabFrame(url: string): boolean {
    if (!url) return false;
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Apply installed extensions' DNR decision to a main-frame navigation.
   * This is a generic extension-platform fallback: no extension id, userscript
   * suffix or vendor install page is encoded here.
   */
  private handleExtensionDnrNavigation(
    url: string,
    method = 'GET',
    loadOptions?: LoadURLOptions,
  ) {
    if (!/^(https?|ftp):\/\//i.test(url || '')) return false;

    const now = Date.now();
    if (
      now - this.extensionDnrRedirectLastAt > 10_000 ||
      (this.extensionDnrRedirectLastTarget &&
        url !== this.extensionDnrRedirectLastTarget &&
        !this.extensionDnrRedirectUrls.has(url))
    ) {
      this.extensionDnrRedirectUrls.clear();
      this.extensionDnrRedirectCount = 0;
      this.extensionDnrRedirectLastTarget = '';
    }

    const verdict = Application.instance.sessions?.decideExtensionNavigation(
      url,
      this.webContents,
      method,
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
    if (
      this.extensionDnrRedirectCount >= 20 ||
      this.extensionDnrRedirectUrls.has(target)
    ) {
      tlog(
        `[crx-dnr] redirect chain stopped tab=${this.id} count=${this.extensionDnrRedirectCount} url=${url} target=${target}`,
      );
      this.extensionDnrRedirectUrls.clear();
      this.extensionDnrRedirectCount = 0;
      this.extensionDnrRedirectLastTarget = '';
      return false;
    }
    this.extensionDnrRedirectUrls.add(url);
    this.extensionDnrRedirectUrls.add(target);
    this.extensionDnrRedirectCount++;
    this.extensionDnrRedirectLastTarget = target;
    this.extensionDnrRedirectLastAt = now;
    tlog(
      `[crx-dnr] redirected main-frame navigation tab=${this.id} ${url} -> ${target}`,
    );
    const loadTarget = () => {
      if (this.webContents.isDestroyed()) return;
      this.webContents.loadURL(target, loadOptions).catch((error) => {
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

  /** Open the same native page context menu for text selected by the panel. */
  public showSelectionContextMenu(selectionText: string) {
    const menu = getViewMenu(
      this.window,
      {
        selectionText: String(selectionText || ''),
        linkURL: '',
        srcURL: '',
        hasImageContents: false,
        isEditable: false,
        x: 0,
        y: 0,
      } as any,
      this.webContents,
      this.incognito,
    );
    menu.popup();
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

  public async syncOpenPopupsInNewTabRule(rawUrl?: string) {
    const host = this.getOpenLinksInNewPageHost(rawUrl);

    if (!host) {
      this.openPopupsInNewTabOverride = null;
      this.openPopupsInNewTabOverrideHost = '';
      return;
    }

    if (host !== this.openPopupsInNewTabOverrideHost) {
      this.openPopupsInNewTabOverride = null;
      this.openPopupsInNewTabOverrideHost = host;
    }

    try {
      const record = await Application.instance.storage.findOne<IPermissionRecord>({
        scope: 'permissions',
        query: {
          url: host,
          permission: OPEN_POPUPS_IN_NEW_TAB_PERMISSION,
        },
      });

      // 查询期间可能已经开始下一次跨站导航，旧网站的结果不能覆盖新网站的缓存。
      if (this.openPopupsInNewTabOverrideHost !== host) return;

      this.openPopupsInNewTabOverride = record
        ? record.type === 1
        : null;
    } catch {
      if (this.openPopupsInNewTabOverrideHost === host) {
        this.openPopupsInNewTabOverride = null;
      }
    }
  }

  private shouldOpenPopupInNewTab() {
    const currentHost = this.getOpenLinksInNewPageHost();
    const websiteOverride =
      currentHost === this.openPopupsInNewTabOverrideHost
        ? this.openPopupsInNewTabOverride
        : null;

    return websiteOverride === null
      ? Application.instance.settings.object.openPopupsInNewTab
      : websiteOverride;
  }

  public async syncExternalNavigationRule(rawUrl = this.webContents.getURL()) {
    const host = this.getOpenLinksInNewPageHost(rawUrl);
    if (!host) {
      this.externalNavigationRuleHost = '';
      this.externalNavigationRule = 1;
      return;
    }

    this.externalNavigationRuleHost = host;
    this.externalNavigationRule = 1;
    try {
      const record = await Application.instance.storage.findOne<IPermissionRecord>({
        scope: 'permissions',
        query: {
          url: host,
          permission: EXTERNAL_NAVIGATION_PERMISSION,
          mediaTypes: '',
        },
      });
      if (this.externalNavigationRuleHost !== host) return;
      this.externalNavigationRule =
        record?.type === 2 || record?.type === 3 ? record.type : 1;
    } catch {
      if (this.externalNavigationRuleHost === host) {
        this.externalNavigationRule = 1;
      }
    }
  }

  private handleExternalNavigation(nextUrl: string) {
    const navigation = getExternalNavigationDetails(
      this.webContents.getURL(),
      nextUrl,
    );
    if (!navigation) return false;

    // 规则尚未加载或来源已变化时遵循安卓端默认值：允许。
    if (
      this.externalNavigationRuleHost !== navigation.sourceHost ||
      this.externalNavigationRule === 1
    ) {
      return false;
    }

    if (this.externalNavigationRule === 2) {
      const t = getMainTranslator(Application.instance.settings.object.language);
      showPageToast(
        this.webContents,
        t('vwPermBlockedNotice'),
      );
      return true;
    }

    if (this.externalNavigationPromptPending) return true;
    this.externalNavigationPromptPending = true;
    const sourceUrl = navigation.sourceUrl;
    const sourceHost = navigation.sourceHost;

    void requestPermission(
      this.window.win,
      EXTERNAL_NAVIGATION_PERMISSION,
      sourceUrl,
      {targetUrl: navigation.targetUrl},
      this.id,
    )
      .then((response) => {
        if (!response.allowed || this.webContents.isDestroyed()) return;
        let currentHost = '';
        try {
          currentHost = new URL(this.webContents.getURL()).hostname;
        } catch {}
        // 询问期间若用户已经离开来源网站，不再执行过期跳转。
        if (currentHost !== sourceHost) return;
        this.load(navigation.targetUrl);
      })
      .catch(() => undefined)
      .finally(() => {
        this.externalNavigationPromptPending = false;
      });
    return true;
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
        const t = getMainTranslator(Application.instance.settings.object.language);
        const result = await dialog.showMessageBox(this.window.win, {
          type: 'info',
          title: t('vwFlashTitle'),
          message: t('vwFlashDetected'),
          detail: t('vwFlashConfirmReload'),
          buttons: [t('vwConfirmReload'), t('settings'), t('vwLater')],
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
    opts: {
      warm?: boolean;
      loadOptions?: LoadURLOptions;
      deferLoad?: boolean;
      adoptedBrowserView?: BrowserView;
      adoptedContentView?: WebContentsView;
      adoptedWebContents?: WebContents;
      /** Use the Electron 43 PDF-compatible non-sandboxed renderer. */
      pdfCompat?: boolean;
    } = {},
  ) {
    this.securityKind = getViewSecurityKind(url);
    this.pdfCompat = opts.pdfCompat === true;
    logSandboxedTabsMode();
    const preload = `${app.getAppPath()}/build/${getViewPreloadFilename(
      this.securityKind,
    )}`;
    const viewSession = incognito
      ? Application.instance.sessions.viewIncognito
      : Application.instance.sessions.view;
    console.log('[PDF Drag-Drop] View constructor called with URL:', url);
    console.log('[PDF Drag-Drop] URL is file://', url.startsWith('file:///'));
    console.log('[PDF Drag-Drop] URL extension:', url.slice(url.lastIndexOf('.')).toLowerCase());
    console.log(preload);
    if (opts.adoptedContentView) {
      // Electron createWindow 回调中创建的视图必须由同一个 View 接管，不能
      // 重新创建 WebContents，否则 window.open 返回的 WindowProxy 会失效。
      this.browserView = opts.adoptedContentView;
      this.contentViewBacked = true;
      this.nativeWindowOpenTarget = true;
    } else if (opts.adoptedBrowserView) {
      // Electron 的 createWindow 官方路径：BrowserView 必须接收完整 options，
      // 才能接管 options.webContents 并保持 WindowProxy 与目标一致。
      this.browserView = opts.adoptedBrowserView;
      this.nativeWindowOpenTarget = true;
    } else if (opts.adoptedWebContents) {
      // window.open 已由 Chromium 创建了带真实 opener/WindowProxy 的
      // WebContents。WebContentsView 可以直接收养它，保证脚本写入对象和标签
      // 内容区展示对象是同一个；BrowserView 无法收养已有 WebContents。
      this.browserView = new WebContentsView({
        webContents: opts.adoptedWebContents,
      });
      this.contentViewBacked = true;
      this.nativeWindowOpenTarget = true;
    } else {
      this.browserView = new BrowserView({
        webPreferences: createViewWebPreferences(
          viewSession,
          preload,
          incognito,
          this.securityKind,
          opts.pdfCompat === true,
        ),
      });
    }
    this.tabId = this.browserView.webContents.id;
    this.browserView.webContents.once('destroyed', () => this.ipc.dispose());
    require("@electron/remote/main").enable(this.browserView.webContents);

    // 在 webContents 上打 incognito 标记:供 is-newtab-incognito / newtab-search 同步判定,
    // 避免「按 webContents 遍历 viewManager 查 view.incognito」在 view 尚未注册时落空
    // (偶发把无痕 newtab 误判为普通 → 渲染需登录的 pcapp iframe → 主页空白、搜索无反应)。
    try {
      (this.browserView.webContents as any).__rainseeIncognito = incognito;
    } catch {}

    // 网页绘制前的底色跟随主题:暗色给 #1c1c1c,消除点击链接在新标签页打开时的白闪。
    // setBackgroundColor 设的颜色在 webContents 生命周期内对所有后续导航生效,
    // 故构造时设一次即覆盖「新标签打开」与「标签内跳转」两类闪屏。
    this.browserView.setBackgroundColor(getViewBackgroundColor());

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
    const handleFileNavigation = (e: any, url: string) => {
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
      const navigation = getNavigationContext(e, url);
      if (!navigation.isMainFrame) return;
      this.syncUserAgentForURL(navigation.url);
      handleFileNavigation(e, navigation.url);
    });

    this.browserView.webContents.on('did-start-navigation', (e, url, isInPlace, isMainFrame) => {
      // did-start-navigation 没有 preventDefault,要用 stop() 中止导航。
      // 但绝不能在回调里同步 stop()——会触发 Chromium CHECK 硬崩主进程
      // (见上方 crx-dnr 重定向的同款注释)。必须等事件回栈后,在微任务里中止原请求、再开 koodoreader。
      const navigation = getNavigationContext(e, url, isInPlace, isMainFrame);
      if (navigation.isMainFrame && !navigation.isSameDocument && navigation.url.startsWith('file:///')) {
        const path = filePathFromFileUrl(navigation.url);
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

    try {
      const preferences = (this.browserView.webContents as any)
        .getLastWebPreferences?.();
      console.log(
        `[view-security] view=${this.browserView.webContents.id} kind=${
          this.securityKind
        } pdfCompat=${opts.pdfCompat === true} sandbox=${!!preferences?.sandbox} contextIsolation=${!!preferences?.contextIsolation}`,
      );
    } catch {
      // Diagnostics must not affect view construction.
    }

    // 注:chromeExtensions.addTab 不在构造时调用——预热 View(warm 模式)停在 about:blank,
    // 此时注册会被 store.addTab 设为窗口 active tab,污染扩展系统的 onActivated/active 标签。
    // 注册推迟到 load()(acquire 后首次),由 this.extensionsRegistered 守卫。
    this.incognito = incognito;

    (this.webContents as any).windowId = window.win.id;

    this.window = window;
    this.homeUrl = url;

    this.nativeRightGesture = new NativeRightGesture(
      () => viewGestureConfig(),
      (actionId) => {
        if (!this.destroying && this.isSelected) {
          Application.instance.dispatchGesture(actionId, this.webContents.id);
        }
      },
    );
    this.browserView.webContents.on('before-mouse-event', (event, mouse) => {
      const update = this.handleNativeRightMouseEvent(event, mouse);
      if (update) {
        // 页面自绘期 update 为 null 或 reset(销毁兜底窗口),overlay 只在
        // 页面未加载好/加载隐藏期间承载绘制。
        this.window.updateRightGestureOverlay(
          update,
          this.bounds || this.window.viewManager.contentBounds || {x: 0, y: 0},
        );
      }
    });
    this.browserView.webContents.on('blur', () =>
      this.nativeRightGesture.reset(true),
    );

    this.webContents.on('render-process-gone', (_event, details: any) => {
      const reason = details?.reason || 'unknown';
      const exitCode = details?.exitCode;

      // 正常退出不属于页面故障；BrowserView 主动销毁时也不应创建恢复页面。
      if (reason === 'clean-exit' || this.webContents.isDestroyed()) return;

      let failedUrl = '';
      try {
        failedUrl = this.webContents.getURL() || this.errorURL || this.homeUrl || '';
      } catch {
        failedUrl = this.errorURL || this.homeUrl || '';
      }

      console.error(
        `[tab-crash] view=${this.id} reason=${reason} exitCode=${exitCode ?? '?'} url=${failedUrl || '(empty)'}`,
      );

      const tab = this.windowOpenNavigationOwner || this;
      // 后台崩溃标签转换为启动恢复同款 discarded 占位标签。延后到当前
      // render-process-gone 回调栈退出后销毁，避免 Chromium 生命周期重入。
      if (!tab.isSelected) {
        setTimeout(() => {
          if (tab.window.viewManager.discardCrashedView(tab.id, failedUrl)) return;
          // 用户恰好在回调排队期间切回此标签，转走前台恢复路径。
          tab.recoverForegroundRendererCrash(failedUrl, reason, exitCode);
        }, 0);
        return;
      }

      tab.recoverForegroundRendererCrash(failedUrl, reason, exitCode);
    });

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

    this.ipc.handle(`get-error-url-${this.id}`, async (e) => {
      return this.errorURL;
    });
    this.ipc.handle(`reload-error-url-${this.id}`, async (e) => {
      const t = getMainTranslator(Application.instance.settings.object.language);
      if (e.sender.id !== this.webContents.id) {
        return {error: t('vwNoReloadPermission')};
      }

      const targetUrl = this.errorURL;
      if (!targetUrl || targetUrl.startsWith(`${ERROR_PROTOCOL}://`)) {
        return {error: t('vwNoRetryUrl')};
      }

      // 崩溃恢复页中的 renderer 内导航可能失效，由主进程重新导航。
      this.load(targetUrl);
      return {success: true};
    });
    this.ipc.handle(`ignore-certificate-error-${this.id}`, async (e) => {
      const t = getMainTranslator(Application.instance.settings.object.language);
      if (e.sender.id !== this.webContents.id) {
        return {error: t('vwNoCertIgnore')};
      }

      return this.advanceCertificateRecovery(this.errorURL);
    });
    this.ipc.on(`supervideo-video-created-${this.id}`, async (e, data) => {
      console.log("supervideo-video-created", data);
      this.addVideoUrl(data.url);
    });
    this.ipc.on(`show-full-video-dialog-${this.id}`, async (e) => {
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
    this.ipc.on(`show-float-video-dialog-${this.id}`, async (e) => {
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
            const t = getMainTranslator(Application.instance.settings.object.language);
            reject(new Error(t('vwPotPlayerNotFound')));
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

    this.ipc.on(`show-other-video-dialog-${this.id}`, async (e) => {
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
          const t = getMainTranslator(Application.instance.settings.object.language);
          dialog.showMessageBox({
            type: 'warning',
            title: t('vwFriendlyNotice'),
            message: t('vwPotPlayerMissing'),
            buttons: [t('confirm')]
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
      const nativeSuppression =
        this.nativeRightGesture.consumeContextMenuSuppression();
      const windowSuppression =
        this.window.consumeRightGestureContextMenuSuppression();
      if (nativeSuppression || windowSuppression) {
        e.preventDefault();
        console.log(
          `[right-gesture] suppressed web context menu wc=${this.webContents.id}`,
        );
        return;
      }
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

    this.webContents.on(
      'will-navigate',
      (e, nextUrl, _isInPlace, isMainFrame) => {
        // Electron's legacy will-navigate signature includes isMainFrame as the
        // fourth argument. A few Chromium paths can surface a subframe
        // navigation here (notably extension iframes such as Bitwarden's inline
        // autofill menu). Cross-security rerouting is only valid for the tab's
        // main document; routing a child frame would replace the whole tab.
        const navigation = getNavigationContext(e, nextUrl, _isInPlace, isMainFrame);
        if (!navigation.isMainFrame) return;
        if (this.openCrossSecurityNavigation(navigation.url)) {
          e.preventDefault();
        } else if (this.handleGreasyforkNavigation(navigation.url)) {
          e.preventDefault();
        } else if (this.handleKtllqNavigation(navigation.url)) {
          e.preventDefault();
        } else if (this.handleInternalFlagsNavigation(navigation.url)) {
          e.preventDefault();
        } else if (this.handleExternalNavigation(navigation.url)) {
          e.preventDefault();
        } else if (this.shouldDivertNativeWindowOpenNavigation(navigation.url)) {
          e.preventDefault();
          const targetUrl = navigation.url;
          // 先让 Chromium 完整退出 will-navigate 回调，再建立覆盖 BrowserView。
          // 在该回调里同步创建/加载视图会造成导航控制器重入。
          queueMicrotask(() => this.openWindowOpenNavigationOverlay(targetUrl));
        }
      },
    );

    this.webContents.on('will-redirect', (e, nextUrl) => {
      // Redirects can originate from subframes as well. They must never be
      // promoted to a top-level security-container navigation.
      const navigation = getNavigationContext(e, nextUrl);
      if (!navigation.isMainFrame) return;
      if (this.openCrossSecurityNavigation(navigation.url)) {
        e.preventDefault();
      } else if (this.handleGreasyforkNavigation(navigation.url)) {
        e.preventDefault();
      } else if (this.handleKtllqNavigation(navigation.url)) {
        e.preventDefault();
      } else if (this.handleInternalFlagsNavigation(navigation.url)) {
        e.preventDefault();
      } else if (this.handleExtensionDnrNavigation(navigation.url)) {
        e.preventDefault();
      } else if (this.handleExternalNavigation(navigation.url)) {
        e.preventDefault();
      }
    });

    // 子框架里的内部协议链接不会触发 will-navigate/will-redirect(二者只对主框架生效),
    // 需用 will-frame-navigate 兜底。仅处理子框架,主框架仍走上面的 will-navigate,
    // 避免重复处理同一条导航。
    this.webContents.on('will-frame-navigate', (e: any) => {
      if (e.isMainFrame) return;
      if (this.handleKtllqNavigation(e.url)) {
        e.preventDefault();
        return;
      }

      // 只处理新标签页壳直接嵌入的首页 iframe。首页自身的跨站导航应在浏览器
      // 新标签打开，但首页内 widget 的二级 iframe 必须保留在原位置加载。
      const isHomepageFrame = e.frame?.parent === this.webContents.mainFrame;
      if (
        this.isNewTab &&
        isHomepageFrame &&
        this.shouldBreakOutNewTabFrame(e.url)
      ) {
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
      this.autofillCredentialsCache = null;
      // 登录成功时子 frame 的 pagehide/console-message 可能晚于主 frame 的
      // did-navigate。只延迟清理导航前已有 token，给凭证上报留出短暂窗口，
      // 且不会误删新页面随后创建的 token。
      const staleCaptureTokens = new Set(this.autofillCaptureFrames.keys());
      setTimeout(() => {
        for (const token of staleCaptureTokens) {
          this.autofillCaptureFrames.delete(token);
        }
        for (const [frameKey, token] of this.autofillCaptureTokens) {
          if (staleCaptureTokens.has(token)) {
            this.autofillCaptureTokens.delete(frameKey);
          }
        }
      }, 5000);
      this.requestRecord.clear();
      this.syncOpenPopupsInNewTabRule(url).catch(() => undefined);
      this.syncExternalNavigationRule(url).catch(() => undefined);
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
    this.webContents.on('did-create-window', (popupWindow, details) => {
      const targetUrl = details.url || 'about:blank';
      if (
        details.disposition !== 'new-window' ||
        !/^about:blank(?:[?#]|$)/i.test(targetUrl) ||
        this.shouldOpenPopupInNewTab()
      ) return;
      Application.instance.nativeBlankPopups.manage(
        this.webContents,
        popupWindow,
        (url) => {
          if (!this.window.win.isDestroyed()) {
            this.window.viewManager.create({url, active: true});
          }
        },
      );
    });
    this.webContents.setWindowOpenHandler((details) => {
      // Chromium 对空字符串 window.open() 的实际目标是 about:blank。后续的
      // 分支、后台 load 以及 ViewManager 必须使用同一个归一化 URL，不能一处
      // 当空串、一处当 about:blank。
      const targetUrl = details.url || 'about:blank';
      const initiatingFrame = (details as any).initiatingFrame;
      const isSubframeRequest =
        !!initiatingFrame && initiatingFrame !== this.webContents.mainFrame;
      if (this.isCrossSecurityNavigation(targetUrl) && !isSubframeRequest) {
        queueMicrotask(() => {
          if (!this.window.win.isDestroyed()) {
            this.window.viewManager.create({url: targetUrl, active: true});
          }
        });
        return {action: 'deny'};
      }
      if (
        this.handleGreasyforkNavigation(
          targetUrl,
          true,
          details.disposition !== 'background-tab',
        )
      ) {
        return {action: 'deny'};
      }
      if (this.handleKtllqNavigation(targetUrl, true)) {
        return {action: 'deny'};
      }
      if (this.handleInternalFlagsNavigation(targetUrl, true)) {
        return {action: 'deny'};
      }

      // 开发环境的 WebUI 运行在 localhost，window.open 创建的原生子页面会
      // 落到宿主窗口的 session，而不是承载扩展的 view session，因而无法解析
      // chrome-extension:// 资源并报 ERR_BLOCKED_BY_CLIENT。内部扩展管理页直接
      // 通过 ViewManager 建标签，确保选项页使用已注册扩展协议的 session。
      if (
        this.webContents.getURL().startsWith(WEBUI_BASE_URL) &&
        targetUrl.startsWith('chrome-extension://')
      ) {
        queueMicrotask(() => {
          if (!this.window.win.isDestroyed()) {
            this.window.viewManager.create({url: targetUrl, active: true});
          }
        });
        return {action: 'deny'};
      }

      // Chromium 已经完成窗口特征判定。只信任 disposition，避免把 popup=no
      // 等 Chromium 判为标签页的请求再次误判成独立窗口。
      const isBlankTarget = /^about:blank(?:[?#]|$)/i.test(targetUrl);
      const popupInNewTab =
        details.disposition === 'new-window' && this.shouldOpenPopupInNewTab();

      if (details.disposition === 'new-window' && !popupInNewTab) {
        console.log(
          `[window-open] native-window disposition=${details.disposition} frame=${details.frameName || '<blank>'} features=${details.features || '<none>'}`,
        );
        return isBlankTarget
          ? {
              action: 'allow',
              overrideBrowserWindowOptions: {
                webPreferences: {
                  additionalArguments: ['--rainsee-native-blank-popup-base'],
                },
              },
            }
          : {action: 'allow'};
      }

      // 只有 Chromium 明确标记的前/后台标签请求才进入应用标签系统。default、
      // other 以及未来新增的 disposition 交回 Electron，避免误建空白标签。
      if (
        details.disposition !== 'foreground-tab' &&
        details.disposition !== 'background-tab' &&
        !popupInNewTab
      ) {
        console.log(
          `[window-open] native-default disposition=${details.disposition} frame=${details.frameName || '<blank>'}`,
        );
        return {action: 'allow'};
      }

      const name = details.frameName;
      // 所有应用内新标签都由 Chromium 创建并维护目标 browsing context。
      // 具名 target 的后续调用会复用原生 WindowProxy；应用层按名称复用标签后
      // deny 请求会返回 null，并可能将 about:blank 错装载到已有远程会话。
      // WebContentsView 只负责把原生子 WebContents 呈现为应用标签，不重建导航。
      const openerTabId = this.id;
      const active = details.disposition !== 'background-tab';
      return {
        action: 'allow',
        // 标签页具有独立生命周期；关闭来源标签后，新标签仍应保留。
        outlivesOpener: true,
        // Electron creates options.webContents before createWindow runs. If
        // these preferences are not overridden here, the adopted target uses
        // Electron's sandboxed defaults and never loads view-preload, leaving
        // USER_SCRIPT worlds without the runtime messaging relay.
        overrideBrowserWindowOptions: {
          webPreferences: createViewWebPreferences(
            viewSession,
            preload,
            incognito,
            getViewSecurityKind(targetUrl),
            isPdfUrl(targetUrl),
          ),
        },
        createWindow: (options) => {
          if (isBlankTarget) {
            const childWebContents = this.window.viewManager.findWindowOpenTarget(
              this.webContents.mainFrame,
            );
            if (!childWebContents) {
              throw new Error('window.open child WebContents was not created');
            }
            const created = this.window.viewManager.createWindowOpenTarget(
              details,
              childWebContents,
              active,
              openerTabId,
            );
            console.log(
              `[window-open] native-backed-tab disposition=${details.disposition} frame=${name || '<blank>'} view=${created.id}`,
            );
            return created.webContents;
          }

          // Electron 官方 createWindow 示例要求 BrowserView 接收完整 options。
          // 其中的 options.webContents 是原生 window.open 已创建的目标；只传
          // webPreferences 会返回另一个 WebContents，触发 Invalid webContents
          // 并使标签永久 loading。
          const childView = new BrowserView(options as any);
          const expectedWebContents = (options as any).webContents as
            | WebContents
            | undefined;
          if (
            expectedWebContents &&
            childView.webContents.id !== expectedWebContents.id
          ) {
            childView.webContents.destroy();
            throw new Error(
              'window.open BrowserView did not adopt Electron target WebContents',
            );
          }
          const created = this.window.viewManager.createWindowOpenTarget(
            details,
            childView,
            active,
            openerTabId,
          );
          // Electron 对 background-tab 可以延迟创建 options.webContents；官方示例
          // 也要求此分支自行加载 URL。前台标签由原生 window.open 流程继续导航。
          if (details.disposition === 'background-tab') {
            created.load(targetUrl);
          }
          console.log(
            `[window-open] native-backed-tab disposition=${details.disposition} frame=${name || '<blank>'} view=${created.id}`,
          );
          return created.webContents;
        },
      };
    });

    // 父页通过 WindowProxy.close() 关闭子页时不会经过子页 preload，Electron
    // 会直接在目标 WebContents 上发出 close；统一转到标签关闭入口。
    (this.webContents as any).on('close', (event: Electron.Event) => {
      // View.destroy() 主动销毁 WebContents 时必须放行，否则目标标签会从 UI
      // 消失但 WebContents 仍存活，WindowProxy.closed 也会一直是 false。
      if (this.destroying) return;
      // WebContentsView 收养的 window.open 子 WebContents 仍保留原生 window
      // 生命周期；若不阻止默认动作，window.close() 会继续关闭宿主
      // BrowserWindow。应用标签统一由 remove-tab 路径负责销毁。
      event.preventDefault();
      this.requestCloseFromPage();
    });

    this.webContents.addListener('did-stop-loading', () => {
      tlog(`view ${this.id}: did-stop-loading url=${this.webContents.getURL()}`);
      // 加载停止不能绕过暗色注入门控,否则慢页会先显示白色内容再变黑。
      // 长连接等没有 did-finish-load 的页面仍会在注入 Promise 完成后正常显示。
      this.showAfterWebDarkModeReady();
      this.updateNavigationState();
      this.emitEvent('loading', false);
      this.updateURL(this.webContents.getURL());
    });

    this.webContents.addListener('did-start-loading', () => {
      tlog(`view ${this.id}: did-start-loading`);
      // renderer 崩溃恢复页仍应在地址栏保留原网址。用户从恢复页重试时，
      // loadURL Promise 已完成、rendererCrashPageLoading 为 false，再正常清除错误态。
      if (!this.rendererCrashPageLoading) this.hasError = false;
      this.updateNavigationState();
      this.emitEvent('loading', true);
      this.updateURL(this.webContents.getURL());
      this.webContents
        .executeJavaScript(hookClickCode, true)
        .catch(() => undefined);
    });

    this.webContents.addListener('did-start-navigation', async (e, ...args) => {
      // Electron 43 exposes navigation metadata on the event object. The
      // deprecated positional arguments are inconsistent for extension
      // subframes in some Chromium paths (Bitwarden's menu iframe was reported
      // as a main frame), so prefer the structured fields whenever present.
      const navigation = getNavigationContext(e, args[0], args[1], args[2]);
      const navigationUrl = navigation.url;
      const navigationIsInPlace = navigation.isSameDocument;
      const navigationIsMainFrame = navigation.isMainFrame;

      tlog(`view ${this.id}: did-start-navigation url=${navigationUrl}`);
      // did-start-navigation is emitted for every frame. The rest of this
      // listener updates tab-level state (favicon, loading, translation and
      // dark-mode lifecycle), so subframes must not enter it at all.
      if (!navigationIsMainFrame) return;
      if (
        !navigationIsInPlace &&
        this.pdfCompat &&
        !isPdfUrl(navigationUrl) &&
        !isBuiltinPdfViewerUrl(navigationUrl)
      ) {
        this.replacePdfView(navigationUrl);
        return;
      }
      if (
        !navigationIsInPlace &&
        this.openCrossSecurityNavigation(navigationUrl, undefined, true)
      ) {
        this.updateNavigationState();
        this.favicon = '';
        this.faviconScore = 0;
        if (this.translateActive) {
          this.translateActive = false;
          this.emitEvent('translate-state', false, '');
        }
        // Keep tab-side navigation state in sync even though this navigation
        // is discarded and replaced by a new security container.
        this.emitEvent('load-commit', ...args);
        return;
      }
      if (!navigationIsInPlace) {
        this.syncUserAgentForURL(navigationUrl);
      }
      this.updateNavigationState();

      this.favicon = '';
      this.faviconScore = 0;

      this.emitEvent('load-commit', ...args);
      this.updateURL(this.webContents.getURL());

      // 暗色模式:主帧真实导航开始即隐藏内容 view,直到暗色样式就绪再挂回。
      // args: [url, isInPlace, isMainFrame, ...]
      if (!navigationIsInPlace) {
        // 导航可能正是手势触发的。停止轨迹但保留一次菜单抑制，避免新文档
        // 在 mouseUp 后收到旧手势产生的 contextMenu。
        this.nativeRightGesture.reset(true);
        // 旧文档的手势绘制代码随文档一起消亡;新文档 dom-ready 前由 overlay 兜底。
        this.pageGestureDrawing = false;
        this.webDarkModeNavigationId++;
        this.webDarkModeInjectPromise = null;
        this.hideForLoading(navigationUrl);
      }

      // 主帧开始导航:先清掉翻译状态,等 did-finish-load 重新探测,避免上一页图标残留。
      if (!navigationIsInPlace) this.flashProbeGen++;
      this.emitEvent('can-translate', false, '');
      // 切语言触发的 reload:消耗标记,保持 active;真正跳转则关闭翻译。
      if (this.translateReloadingForLang) {
        this.translateReloadingForLang = false;
      } else if (this.translateActive) {
        // 同 URL reload 或同文档(SPA isInPlace)导航:保留翻译态,让 did-finish-load
        // (reload 完成)重驱动接管。仅真正跳转到不同页才关闭翻译。
        // 否则站点一 reload 就把 translateActive 置 false,did-finish-load 不会再驱动,
        // 翻译永远跑不完(zhso.org 这类会 reload 的站点)。
        const newUrl = navigationUrl;
        let curUrl = '';
        try { curUrl = this.webContents.getURL(); } catch {}
        const isSameUrl = !!newUrl && !!curUrl && newUrl === curUrl;
        console.log(`[translate] did-start-navigation | url=${newUrl} isInPlace=${navigationIsInPlace} curUrl=${curUrl} sameUrl=${isSameUrl} → ${isSameUrl || navigationIsInPlace ? '保留翻译态' : '关闭翻译'}`);
        if (!isSameUrl && !navigationIsInPlace) {
          this.translateActive = false;
          this.emitEvent('translate-state', false, '');
        }
      }
      // PWA:清掉上一页的可安装/已安装态。不在此 bump pwaGen——主帧 did-start-navigation
      // 可能在同一页内多次触发(reload / SPA history / 重定向),bump 会误判在途探测为
      // 过期。仅 did-finish-load 启动新探测时 bump(见下),完成时按"不同站点才丢弃"判定。
      this.canInstallPwa = false;
      this.pwaManifest = null;
      this.pwaInstalled = false;
      this.emitEvent('pwa-installable', false, null, false);
    });

    // `will-navigate` only fires for renderer-initiated navigations (link
    // clicks, in-page JS). Address-bar input and other host-side `loadURL`
    // calls go straight to `did-start-navigation`, so we also intercept
    // internal flags navigations here.
    this.webContents.on(
      'did-start-navigation',
      (e, url, isInPlace, isMainFrame) => {
        const navigation = getNavigationContext(e, url, isInPlace, isMainFrame);
        if (!navigation.isMainFrame || navigation.isSameDocument) return;
        if (this.approvedGreasyforkNavigationUrl === navigation.url) {
          this.approvedGreasyforkNavigationUrl = '';
          return;
        }
        if (this.handleGreasyforkNavigation(navigation.url)) return;
        if (!this.getInternalFlagsTarget(navigation.url)) return;
        this.handleInternalFlagsNavigation(navigation.url);
      },
    );

    // Resolve extension DNR redirects at the navigation boundary. This event
    // covers both renderer-initiated navigations and direct webContents.loadURL
    // calls (for example chrome.tabs.update). Keeping DNR handling here avoids
    // applying the same initial redirect again from will-navigate. The
    // will-redirect handler remains active for later server redirects, which
    // may not emit another did-start-navigation event.
    this.webContents.on(
      'did-start-navigation',
      (e, url, isInPlace, isMainFrame) => {
        const navigation = getNavigationContext(e, url, isInPlace, isMainFrame);
        if (!navigation.isMainFrame || navigation.isSameDocument) return;
        this.handleExtensionDnrNavigation(navigation.url);
      },
    );

    this.webContents.on(
      'dom-ready',
      () => {
        // 主帧手势尽早在 DOM 就绪后挂载,避免等待整页资源加载完才能使用。
        this.injectMainFrameGesture();
        // 网页暗色模式(浏览器实现):触发 Dark Reader 暗化并暂存 Promise。完成前
        // BrowserView 保持分离,确保暗化 CSS 已生效再显示(消除白闪)。暗色下 view 此时
        // 仍处于 loadingHidden。非 browser 模式/浅色/非网页时为立即 resolve 的 no-op。
        const navigationId = this.webDarkModeNavigationId;
        const promise = this.injectWebDarkMode();
        this.webDarkModeInjectPromise = promise;
        this.showAfterWebDarkModeReady(navigationId, promise);
      },
    );

    this.webContents.on(
      'did-finish-load',
      () => {
        this.window.syncImmersivePageIndicator();
        // Only the active real page can release startup network work. Waiting
        // for did-finish-load keeps cloud requests away from the page's own
        // critical resources; the Application-level timeout handles slow or
        // purely local sessions.
        try {
          const readyUrl = this.webContents.getURL();
          const isActiveView = this.window.viewManager?.selectedId === this.id;
          if (isActiveView && /^https?:/i.test(readyUrl)) {
            Application.instance.notifyFirstRealTabReady(readyUrl);
          }
          if (isActiveView && readyUrl && readyUrl !== 'about:blank') {
            this.window.viewManager.ensureWarmView();
          }
        } catch (e) {}
        const tab = this.windowOpenNavigationOwner || this;
        if (
          tab.rendererCrashRetryPending &&
          this.webContents.getURL() === tab.rendererCrashRetryUrl
        ) {
          tab.rendererCrashRetryPending = false;
          tab.rendererCrashRetryUrl = '';
        }
        // 页面加载完成仍走同一门控;dom-ready 启动的注入完成后才会挂回。
        this.showAfterWebDarkModeReady();
        const pageUrl = this.webContents.getURL();
        if (/^https?:/i.test(pageUrl)) this.resetCertificateRecovery();
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
        this.webContents.executeJavaScript(watchVideoCode, true).catch(e => {
          console.log("executeJavaScript2", e);
        });
        injectSearchAnnotator(this.webContents).catch(e => {
          console.log("injectSearchAnnotator", e);
        });
        this.syncOpenLinksInNewPageRule().catch(() => undefined);
        this.syncOpenPopupsInNewTabRule().catch(() => undefined);
        this.syncExternalNavigationRule(pageUrl).catch(() => undefined);
        // 检测页面语言:与 App 语言不一致则上报,地址栏显示翻译图标。
        detectTranslateState(this.webContents).then(({canTranslate, lang}) => {
          this.translateDetectedLang = lang || '';
          console.log(`[translate] detect | canTranslate=${canTranslate} lang='${lang}' stored='${this.translateDetectedLang}'`);
          this.emitEvent('can-translate', canTranslate, lang);
        }).catch((e) => console.log('[translate] detect 抛错', e));
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
        // 扩展页(chrome-extension://)无 http(s) favicon 候选:page-favicon-updated 已
        // 短路、DOM 探测也取不到,直接读扩展 manifest 图标作 data URL 设为 favicon。
        // 标签页 / 侧栏 / 最近关闭 / 新加书签(add-bookmark 取 view.favicon)全部自动受益。
        if (this.webContents.getURL().startsWith('chrome-extension://')) {
          const capturedUrl = this.webContents.getURL();
          let extensionId = '';
          try {
            extensionId = new URL(capturedUrl).hostname;
          } catch {
            extensionId = '';
          }
          if (extensionId) {
            resolveExtensionIconDataUrl(extensionId)
              .then((dataUrl) => {
                if (!dataUrl) return;
                if (this.webContents.isDestroyed()) return;
                // 读盘期间可能已导航到别处,只在本扩展页仍活跃时回写,防图标错挂。
                if (this.webContents.getURL() !== capturedUrl) return;
                this.applyFavicon({dataUrl, score: 1000});
              })
              .catch(() => undefined);
          }
        }
        // 翻译已开启(导航到新页 / 回到已翻译页):新文档已丢页面侧引导,按当前 target 重跑。
        if (this.translateActive) {
          console.log(`[translate] did-finish-load 重驱动(translateActive=true target=${this.translateTarget})`);
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
                viewGestureConfig(),
              );
              frame.executeJavaScript(gCode, true).catch(() => undefined);
            } catch (_) {}
            this.injectAutofillPickerIntoFrame(frame).catch(() => undefined);
            // 跨域 iframe 不运行 view-preload,也不会被顶层 Dark Reader 实例处理。
            // frame-created 已尽早注入;此处在框架完整加载后兜底重试。
            this.injectWebDarkModeIntoFrame(frame);
          }
        }
      },
    );
    this.webContents.on('frame-created', (event, details) => {
      console.log('frame-created', details.frame.url);
      details.frame.executeJavaScript(this.getExtensionFrameTabBridgeCode(), true).catch(() => undefined);
      details.frame
        .executeJavaScript(hookClickCode, true)
        .catch(() => undefined);
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
          buildGestureCode(viewGestureConfig()),
          true,
        ).catch(() => undefined);
      } catch (_) {}
      // frame-created 同时覆盖主框架和子框架;主框架由 dom-ready 的显示门控处理。
      if (details.frame.parent) this.injectWebDarkModeIntoFrame(details.frame);
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
      const capturePrefix = '__rainsee_password_capture__:';
      if (message.startsWith(capturePrefix)) {
        const separator = message.indexOf(':', capturePrefix.length);
        if (separator < 0) return;
        const token = message.slice(capturePrefix.length, separator);
        const frameIdentity = this.autofillCaptureFrames.get(token);
        if (!frameIdentity) return;
        const frame = webFrameMain.fromId(
          frameIdentity.processId,
          frameIdentity.routingId,
        );
        if (frame && !frame.parent) return;
        if (!frame && Date.now() - frameIdentity.createdAt > 10_000) return;
        try {
          const payload = JSON.parse(message.slice(separator + 1));
          const capturedUrl = new URL(payload?.url || '');
          if (
            !/^https?:$/.test(capturedUrl.protocol) ||
            capturedUrl.origin !== frameIdentity.origin ||
            typeof payload.username !== 'string' ||
            typeof payload.password !== 'string' ||
            !payload.password
          ) {
            console.log('[autofill-capture] rejected payload', {
              expectedOrigin: frameIdentity.origin,
              capturedOrigin: capturedUrl.origin,
              hasUsername: typeof payload.username === 'string',
              hasPassword:
                typeof payload.password === 'string' && !!payload.password,
            });
            return;
          }
          console.log('[autofill-capture] accepted', {
            hostname: capturedUrl.hostname,
            liveFrame: !!frame,
            hasUsername: !!payload.username,
            passwordLength: payload.password.length,
          });
          void requestCredentialPrompt({
            username: payload.username,
            password: payload.password,
            url: capturedUrl.href,
            sourceWebContentsId: this.webContents.id,
            strictHost: true,
          });
        } catch (error) {
          console.log('[autofill-capture] rejected', String(error));
          // 页面 console 内容不可信，解析或来源校验失败时直接忽略。
        }
        return;
      }
      if (message.startsWith('__gesture_inj_err__:')) {
        console.log('[gesture-inject] ERR ' + message);
        return;
      }
      const prefix = '__gesture_fire__:';
      const leftPrefix = '__left_gesture_fire__:';
      if (message.startsWith(leftPrefix)) {
        const leftCfg = viewGestureConfig();
        if (!leftCfg.leftEnabled) return;
        try {
          const payload = JSON.parse(message.slice(leftPrefix.length));
          if (!payload || typeof payload.actionId !== 'string' || typeof payload.url !== 'string') return;
          if (!Object.values(leftCfg.leftMap || {}).includes(payload.actionId)) return;
          Application.instance.dispatchLeftGesture(payload, this.id);
        } catch (_) {
          // 页面内容不是受信任来源,解析失败时忽略。
        }
        return;
      }
      if (!message.startsWith(prefix)) return;
      const actionId = message.slice(prefix.length).trim();
      if (!actionId) return;
      // 值域校验:仅接受当前配置里真实绑定的 actionId,防伪造。
      const cfg = viewGestureConfig();
      const rightEnabled = cfg.enabled && cfg.map && Object.values(cfg.map).includes(actionId);
      const sideEnabled = cfg.sideButtons && Object.values(cfg.sideButtons).includes(actionId);
      if (!rightEnabled && !sideEnabled) return;
      Application.instance.dispatchGesture(actionId, this.id);
    });

    this.webContents.addListener(
      'did-fail-load',
      (e, errorCode, errorDescription, validatedURL, isMainFrame) => {
        // ignore -3 (ABORTED) - An operation was aborted (due to user action).
        if (!isMainFrame) return;
        if (errorCode === -3) {
          // 新导航会先取消旧导航。此时不能把刚隐藏的新文档提前挂回;若只是用户
          // 主动停止且没有后续加载,下个任务检查到 idle 后再恢复原页面。
          setTimeout(() => {
            if (!this.webContents.isDestroyed() && !this.webContents.isLoading()) {
              this.showAfterLoading();
            }
          }, 0);
          return;
        }

        // 真正加载失败:挂回内容 view,避免错误页加载期间标签保持空白。
        this.showAfterLoading();
        if (isMainFrame) {
          // Guard against an infinite recursion: if loading the error page
          // itself fails, did-fail-load fires again with the whole
          // `yjllq-error://...` URL as the new validatedURL. Re-encoding it
          // each time doubles the URL length until it blows up. When the
          // failed URL is already the error page, stop instead of re-wrapping.
          if (validatedURL && validatedURL.startsWith(`${ERROR_PROTOCOL}://`)) {
            return;
          }

          this.errorURL = validatedURL;

          if (this.shouldAutoDowngradeCertificateRecovery(validatedURL)) {
            const recovery = this.advanceCertificateRecovery(validatedURL);
            if (recovery.retryUrl) {
              console.warn('[certificate-recovery] retrying navigation', {
                errorCode,
                ignoreRetried: this.certificateIgnoreRetried,
                downgradeRetried: this.certificateDowngradeRetried,
                retryUrl: recovery.retryUrl,
              });
              this.retryCertificateRecovery(recovery.retryUrl);
              return;
            }
          }

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
        // 扩展页(chrome-extension://)的 favicon 由 did-finish-load 的扩展图标分支
        // 负责。Electron 给的候选都是 chrome-extension://(被 resolveBestFavicon 过滤)
        // 或无效,这里走完必然落入 else 分支清空 favicon,反而覆盖已设好的扩展图标。直接跳过。
        if (this.webContents.getURL().startsWith('chrome-extension://')) {
          return;
        }
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
        if (isCertificateErrorAllowed(url)) {
          event.preventDefault();
          callback(true);
          return;
        }

        callback(false);
      },
    );

    // Web Bluetooth:Electron 默认不弹设备选择窗口(等同用户取消),拦截后自管
    // chooser 弹窗。事件会随扫描持续触发(deviceList 累积),首次弹窗、后续只更新列表。
    this.webContents.addListener(
      'select-bluetooth-device',
      (
        event: Electron.Event,
        deviceList: Electron.BluetoothDevice[],
        callback: (deviceId: string) => void,
      ) => {
        event.preventDefault();

        const devices: IBluetoothDevice[] = deviceList.map((device) => ({
          deviceId: device.deviceId,
          deviceName: device.deviceName,
        }));

        const requestTab = this.windowOpenNavigationOwner || this;
        console.log('[bluetooth] chooser event', {
          webContentsId: this.webContents.id,
          requestTabId: requestTab.id,
          selectedId: this.window?.viewManager?.selectedId,
          deviceCount: devices.length,
        });

        if (this.bluetoothChooser) {
          // 持续扫描:仅推送新列表。刷新 callback 引用以防 Chromium 换发。
          this.bluetoothChooser.callback = callback;
          this.bluetoothChooser.update(devices);
          return;
        }

        // window.open about:blank 的二次导航会由一个未注册到 ViewManager 的覆盖
        // View 承载。chooser 必须关联其根标签,否则即使页面可见,overlay.id 也不等于
        // selectedId,请求会被误判为后台标签并立即取消。
        // 后台标签不展示交互弹窗,直接取消(与权限处理策略一致)。
        if (this.window?.viewManager?.selectedId !== requestTab.id) {
          console.log('[bluetooth] chooser cancelled for background tab');
          callback('');
          return;
        }

        const handle = requestBluetoothDevice(
          this.window.win,
          requestTab.id,
          this.webContents.getURL(),
          devices,
        );

        this.bluetoothChooser = {callback, update: handle.update};

        handle.promise.then((deviceId: string) => {
          const cb = this.bluetoothChooser?.callback;
          this.bluetoothChooser = null;
          if (!this.webContents.isDestroyed()) {
            try {
              cb?.(deviceId);
            } catch {
              // Chromium 侧 chooser 已失效(如导航取消),忽略。
            }
          }
        });
      },
    );

    this.webContents.addListener('media-started-playing', () => {
      this.emitEvent('media-playing', true);
    });

    this.webContents.addListener('media-paused', () => {
      this.emitEvent('media-paused', true);
    });

    // 注意:这里曾经开启 browserView.setAutoResize({width:true, height:true})。
    // 必须保持关闭:它会随「窗口」尺寸变化直接改写 view 的原生 bounds,绕过
    // ViewManager.fixBounds 布局链。最大化/最小化/还原时 Windows 会带出过渡
    // 尺寸(如还原态窗口大小、含边框误差的 1721x785),autoResize 把这些瞬态
    // 原样传导给页面 → 最小化再还原会触发多余的 onresize(真 Chrome 不会),
    // 且与 fixBounds 的异步 setBounds 穿插后会把真实 bounds 与 View.bounds 账本
    // 脱钩,fixBounds 同值守卫读账本误判「无变化」而永不纠正(实测卡死在
    // 903x770)。布局唯一写入方 = fixBounds(anchor 测量)。
    if (this.browserView instanceof BrowserView) {
      this.browserView.setAutoResize({
        width: false,
        height: false,
        horizontal: false,
        vertical: false,
      });
    }

    // warm 模式:不加载目标 URL,BrowserView 默认停在 about:blank,等待 acquireView
    // 领养后调用 load(url)。非 warm:立即加载(等价原构造函数末尾的 loadURL 流程)。
    if (!opts.warm && !opts.deferLoad) {
      this.load(url, opts.loadOptions);
    }
  }

  // 加载目标 URL 并完成扩展注册——构造函数里所有 url 无关初始化已在构造期完成,
  // 这里只做:url→homeUrl、首次注册扩展 tab、isNewTab 判定、两类特殊导航拦截、loadURL。
  // 预热 View 被 acquireView 领养时调用;非 warm View 在构造末尾自调一次。
  // addTab 必须在 loadURL 之前,保证扩展(uBlock 等)能拦截 acquire 后的首个网络请求。
  public registerExtensionContext() {
    // window.open 覆盖页只是宿主标签的第二个呈现层，不能再作为独立扩展 tab
    // 注册。否则扩展会同时看到 about:blank 底页和覆盖页两个 tab，而 renderer
    // 只有一个逻辑标签 id，activeTab、browser action 与 onRemoved 都会失配。
    // 覆盖页仍使用同一 session/preload；根标签负责唯一的扩展 tab 身份。
    if (this.windowOpenNavigationOwner) return;

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

  private resetCertificateRecovery() {
    this.certificateRecoveryUrl = '';
    this.certificateIgnoreRetried = false;
    this.certificateDowngradeRetried = false;
  }

  private toHttpUrl(url: URL) {
    const downgraded = new URL(url.toString());
    downgraded.protocol = 'http:';
    return downgraded.toString();
  }

  private enableCertificateErrorBypass(host: string) {
    allowCertificateErrorHost(host);
    if (this.incognito) return;

    void Application.instance.storage
      .findOne<IPermissionRecord>({
        scope: 'permissions',
        query: {
          url: host,
          permission: IGNORE_CERTIFICATE_ERRORS_PERMISSION,
          mediaTypes: '',
        },
      })
      .then((existing) => {
        if (existing?._id) {
          return Application.instance.storage.update({
            scope: 'permissions',
            query: {_id: existing._id},
            value: {type: 1, mediaTypes: ''},
          });
        }

        return Application.instance.storage.insert({
          scope: 'permissions',
          item: {
            url: host,
            permission: IGNORE_CERTIFICATE_ERRORS_PERMISSION,
            type: 1,
            mediaTypes: '',
          },
        });
      })
      .catch((error) => {
        console.error('[certificate-recovery] failed to persist permission', error);
      });
  }

  private advanceCertificateRecovery(url: string) {
    const t = getMainTranslator(Application.instance.settings.object.language);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return {error: t('vwNoDomain')};
    }
    if (parsed.protocol !== 'https:') {
      return {error: t('vwNoDowngrade')};
    }

    const recoveryUrl = parsed.toString();
    if (!this.certificateRecoveryUrl) {
      this.certificateRecoveryUrl = recoveryUrl;
    }

    if (!this.certificateIgnoreRetried) {
      const host = getCertificateErrorHost(recoveryUrl);
      if (!host) return {error: t('vwNoDomain')};
      this.certificateIgnoreRetried = true;
      this.enableCertificateErrorBypass(host);
      return {success: true, retryUrl: recoveryUrl};
    }

    if (!this.certificateDowngradeRetried) {
      this.certificateDowngradeRetried = true;
      return {success: true, retryUrl: this.toHttpUrl(parsed)};
    }

    return {error: t('vwCertRecoverFailed')};
  }

  private shouldAutoDowngradeCertificateRecovery(url: string) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return false;
    } catch {
      return false;
    }

    return (
      this.certificateIgnoreRetried && !this.certificateDowngradeRetried
    );
  }

  private retryCertificateRecovery(url: string) {
    setTimeout(() => {
      if (this.webContents.isDestroyed()) return;
      this.webContents.loadURL(url).catch((error) => {
        tlog(
          `view ${this.id}: certificate recovery loadURL rejected ${url}`,
          error && error.code,
        );
      });
    }, 0);
  }

  public load(url: string, loadOptions?: LoadURLOptions) {
    if (this.pdfCompat && !isPdfUrl(url)) {
      this.replacePdfView(url, loadOptions);
      return;
    }
    if (this.openCrossSecurityNavigation(url, loadOptions)) return;
    this.resetCertificateRecovery();
    const sequence = ++this.loadSequence;
    this.homeUrl = url;

    this.registerExtensionContext();

    const extensionReady = Application.instance.sessions
      ?.waitForExtensionNewTabReady(url, this.incognito);
    if (extensionReady) {
      this.isNewTab = true;
      const fallback = getNativeWebUIURL('newtab');
      tlog(
        `view ${this.id}: extension newtab unavailable, replacing with ${fallback}`,
      );
      let fallbackViewId = 0;
      queueMicrotask(() => {
        if (
          sequence !== this.loadSequence ||
          this.homeUrl !== url ||
          this.webContents.isDestroyed() ||
          this.window.viewManager.getById(this.id) !== this
        ) return;
        const fallbackView = this.window.viewManager.create(
          {url: fallback, active: true, incognito: this.incognito} as any,
          true,
        );
        fallbackViewId = fallbackView.id;
        this.window.viewManager.removeByTabId(this.id);
      });
      void extensionReady.then((ready) => {
        if (!ready || !fallbackViewId || this.window.win.isDestroyed()) return;
        const fallbackView = this.window.viewManager.getById(fallbackViewId);
        if (!fallbackView || fallbackView.homeUrl !== fallback) return;
        const currentUrl = fallbackView.webContents.getURL();
        if (
          currentUrl &&
          currentUrl !== 'about:blank' &&
          !currentUrl.startsWith(fallback)
        ) {
          return;
        }
        const active =
          fallbackView.window.viewManager.selectedId === fallbackViewId;
        tlog(
          `view ${fallbackViewId}: extension newtab ready, replacing with ${url}`,
        );
        this.window.viewManager.create(
          {
            url,
            active,
            incognito: this.incognito,
            ...(loadOptions ? {loadOptions} : {}),
          } as any,
          true,
        );
        this.window.viewManager.removeByTabId(fallbackViewId);
      });
      return;
    }

    if (url.startsWith(getWebUIURL('newtab'))) this.isNewTab = true;

    this.loadResolvedUrl(url, loadOptions);
  }

  /** Replace a non-sandboxed PDF View before loading a regular document. */
  private replacePdfView(url: string, loadOptions?: LoadURLOptions) {
    if (this.pendingPdfReplacement?.url === url) return;
    const request = {url, loadOptions};
    this.pendingPdfReplacement = request;
    setImmediate(() => {
      if (this.pendingPdfReplacement !== request) return;
      this.pendingPdfReplacement = null;
      const manager = this.window.viewManager;
      if (
        this.destroying ||
        this.window.win.isDestroyed() ||
        manager.getById(this.id) !== this
      ) {
        // A PDF overlay is not registered as a top-level tab. Recreate the
        // overlay through its owner so a popup cannot carry sandbox:false
        // into a regular document.
        const owner = this.windowOpenNavigationOwner;
        if (owner && !owner.destroying) {
          owner.closeWindowOpenNavigationOverlay(this);
          owner.openWindowOpenNavigationOverlay(request.url);
        }
        return;
      }
      const active = manager.selectedId === this.id;
      const contents = this.browserView?.webContents;
      if (contents && !contents.isDestroyed()) contents.stop();
      manager.create(
        {
          url: request.url,
          active,
          incognito: this.incognito,
          ...(request.loadOptions ? {loadOptions: request.loadOptions} : {}),
        } as any,
        false,
      );
      manager.removeByTabId(this.id);
    });
  }

  /** 导航到 bejson 并把剪贴板 JSON 注入 CodeMirror 后触发格式化。 */
  public loadClipboardInBejson(content: string) {
    if (this.webContents.isDestroyed() || typeof content !== 'string') return;

    this.bejsonLoadCleanup?.();
    const requestSequence = ++this.bejsonRequestSequence;
    const targetUrl = 'https://www.bejson.com/';
    const inject = () => {
      if (
        requestSequence !== this.bejsonRequestSequence ||
        this.webContents.isDestroyed()
      ) {
        return;
      }

      const script = `(() => {
        if (!/(^|\\.)bejson\\.com$/i.test(location.hostname)) return false;
        const value = ${JSON.stringify(content)};
        let attempts = 0;
        const apply = () => {
          if (++attempts > 80) return true;
          const editor = document.querySelector('.CodeMirror');
          const instance = editor && editor.CodeMirror;
          let filled = false;
          if (instance && typeof instance.setValue === 'function') {
            instance.setValue(value);
            if (typeof instance.focus === 'function') instance.focus();
            filled = true;
          } else {
            const textarea = document.querySelector('.CodeMirror textarea');
            if (textarea) {
              textarea.value = value;
              textarea.dispatchEvent(new Event('input', { bubbles: true }));
              filled = true;
            }
          }
          if (!filled) return false;
          const button = document.querySelector('[onclick*="formatJson"]');
          if (button && typeof button.click === 'function') {
            button.click();
            return true;
          }
          return false;
        };
        if (apply()) return true;
        const timer = setInterval(() => {
          if (apply()) clearInterval(timer);
        }, 250);
        setTimeout(() => clearInterval(timer), 20000);
        return true;
      })()`;
      this.webContents.executeJavaScript(script, true).catch(() => undefined);
    };

    const onFinished = () => {
      if (requestSequence !== this.bejsonRequestSequence) return;
      let currentUrl = '';
      try {
        currentUrl = this.webContents.getURL();
      } catch {
        return;
      }
      if (/^https:\/\/(?:www\.)?bejson\.com(?:\/|$)/i.test(currentUrl)) {
        this.bejsonLoadCleanup?.();
        inject();
      }
    };
    this.webContents.on('did-finish-load', onFinished);
    const timeout = setTimeout(() => {
      if (requestSequence === this.bejsonRequestSequence) this.bejsonLoadCleanup?.();
    }, 20000);
    let cleanup: (() => void) | undefined;
    cleanup = () => {
      clearTimeout(timeout);
      this.webContents.removeListener('did-finish-load', onFinished);
      if (this.bejsonLoadCleanup === cleanup) this.bejsonLoadCleanup = undefined;
    };
    this.bejsonLoadCleanup = cleanup;
    this.load(targetUrl);
  }

  private loadResolvedUrl(
    url: string,
    loadOptions?: LoadURLOptions,
    sequence = this.loadSequence,
    greasyforkChecked = false,
  ) {
    if (this.openCrossSecurityNavigation(url, loadOptions)) return;
    if (isGreasyforkUrl(url) && !greasyforkChecked) {
      void Application.instance.googleConnectivity
        .getIsCanGoogle()
        .then((isCanGoogle) => {
          if (sequence !== this.loadSequence || this.webContents.isDestroyed()) return;
          this.loadResolvedUrl(
            isCanGoogle ? url : getGreasyforkMirrorUrl(url),
            loadOptions,
            sequence,
            true,
          );
        });
      return;
    }

    this.syncUserAgentForURL(url);
    const navigationMethod =
      loadOptions && Object.prototype.hasOwnProperty.call(loadOptions, 'postData')
        ? 'POST'
        : 'GET';
    if (
      !this.handleKtllqNavigation(url) &&
      !this.handleInternalFlagsNavigation(url) &&
      !this.handleExtensionDnrNavigation(url, navigationMethod, loadOptions)
    ) {
      if (isGreasyforkUrl(url)) {
        this.approvedGreasyforkNavigationUrl = url;
      }
      tlog(`view ${this.id}: loadURL(${url})`);
      this.webContents
        .loadURL(url, loadOptions)
        .then(() => tlog(`view ${this.id}: loadURL resolved ${url}`))
        .catch((err) =>
          tlog(`view ${this.id}: loadURL rejected ${url}`, err && err.code),
        );
    }
  }

  public get webContents(): WebContents {
    return this.windowOpenNavigationOverlay?.webContents || this.browserView.webContents;
  }

  private isCrossSecurityNavigation(url: string) {
    return isCrossViewSecurityNavigation(this.securityKind, url);
  }

  private openCrossSecurityNavigation(
    url: string,
    loadOptions?: LoadURLOptions,
    stopCurrent = false,
  ) {
    if (!url || !this.isCrossSecurityNavigation(url)) return false;
    const pending = this.pendingCrossSecurityNavigation;
    if (pending && pending.url === url) {
      pending.stopCurrent = pending.stopCurrent || stopCurrent;
      return true;
    }
    const request = {url, loadOptions, stopCurrent};
    this.pendingCrossSecurityNavigation = request;
    setImmediate(() => {
      if (this.pendingCrossSecurityNavigation !== request) return;
      this.pendingCrossSecurityNavigation = undefined;
      if (
        this.window.win.isDestroyed() ||
        this.window.viewManager.getById(this.id) !== this
      ) return;
      const contents = this.browserView?.webContents;
      if (request.stopCurrent && contents && !contents.isDestroyed()) {
        contents.stop();
      }
      this.window.viewManager.create({
        url: request.url,
        active: this.window.viewManager.selectedId === this.id,
        ...(request.loadOptions ? {loadOptions: request.loadOptions} : {}),
      } as any);
    });
    console.log(
      `[view-security] reroute kind=${this.securityKind} targetKind=${
        getViewSecurityKind(url)
      }`,
    );
    return true;
  }

  /** Google 登录页保留 Electron 默认 UA；其余页面继续使用 Chrome UA。 */
  private syncUserAgentForURL(url: string) {
    const userAgent = getUserAgentForURL(DefaultUserAgent, url);
    if (this.webContents.userAgent !== userAgent) {
      this.webContents.userAgent = userAgent;
    }
  }

  /** 当前标签能接收任意一个内部 WebContents 的 IPC/关闭事件。 */
  public containsWebContents(webContentsId: number) {
    return (
      this.tabId === webContentsId ||
      this.windowOpenNavigationOverlay?.containsWebContents(webContentsId) === true
    );
  }

  /** 仅 about:blank 子页启用第二次导航覆盖保护。 */
  public setWindowOpenStartedBlank(startedBlank: boolean) {
    this.nativeWindowOpenStartedBlank = startedBlank;
  }

  /** 将原生 window.open 子页的导航切换为普通 BrowserView 覆盖层。 */
  private shouldDivertNativeWindowOpenNavigation(url: string) {
    return (
      this.nativeWindowOpenTarget &&
      this.nativeWindowOpenStartedBlank &&
      !this.windowOpenNavigationOwner &&
      !this.destroying &&
      !this.windowOpenNavigationPending &&
      !!url &&
      !/^about:blank(?:[?#]|$)/i.test(url)
    );
  }

  private openWindowOpenNavigationOverlay(url: string) {
    if (this.destroying || this.window.win.isDestroyed()) return;

    // 原生底页连续发起导航时，已有覆盖页只按普通标签继续加载；不再创建第三个
    // WebContents，也不允许原生底页离开 about:blank。
    if (this.windowOpenNavigationOverlay) {
      this.windowOpenNavigationOverlay.load(url);
      return;
    }

    this.windowOpenNavigationPending = true;
    try {
      const overlay = new View(this.window, url, this.incognito, {
        deferLoad: true,
        pdfCompat: isPdfUrl(url),
      });
      overlay.windowOpenNavigationOwner = this;
      this.windowOpenNavigationOverlay = overlay;

      const bounds = this.bounds || this.window.viewManager.contentBounds;
      if (bounds) overlay.setBounds(bounds);

      // 先完成 owner 关联再 load，确保加载、关闭、标题等事件都回送到原标签 id。
      overlay.load(url);
      if (this.isSelected && !overlay.isLoadingHidden) {
        overlay.attachToWindow();
        overlay.webContents.focus();
      }
      console.log(
        `[window-open-overlay] created tab=${this.id} base=${this.tabId} overlay=${overlay.tabId} url=${url}`,
      );
    } catch (error) {
      console.error(`[window-open-overlay] create failed tab=${this.id} url=${url}`, error);
    } finally {
      this.windowOpenNavigationPending = false;
    }
  }

  /** 覆盖页退出时恢复仍保持 about:blank 的原生底页。 */
  private closeWindowOpenNavigationOverlay(overlay: View) {
    if (this.windowOpenNavigationOverlay !== overlay) return;
    this.windowOpenNavigationOverlay = undefined;
    overlay.windowOpenNavigationOwner = undefined;
    overlay.destroy();

    if (!this.destroying && this.isSelected && !this.window.win.isDestroyed()) {
      try {
        this.browserView.webContents.focus();
      } catch {}
    }
    this.updateNavigationState();
    this.updateURL(this.browserView.webContents.getURL());
    this.window.updateTitle();
    this.emitEvent('title-updated', this.browserView.webContents.getTitle());
    console.log(`[window-open-overlay] closed tab=${this.id} base=${this.tabId}`);
  }

  /** 当前可见标签的 renderer 崩溃恢复：首次重载，重载期再次崩溃才显示错误页。 */
  private recoverForegroundRendererCrash(
    failedUrl: string,
    reason: string,
    exitCode: unknown,
  ) {
    if (!failedUrl || this.webContents.isDestroyed()) return;

    if (
      this.rendererCrashPageLoading ||
      failedUrl.startsWith(`${ERROR_PROTOCOL}://${NETWORK_ERROR_HOST}/renderer-crash`)
    ) {
      console.error(`[tab-crash] recovery page also crashed, view=${this.id}`);
      return;
    }

    if (!this.rendererCrashRetryPending) {
      this.rendererCrashRetryPending = true;
      this.rendererCrashRetryUrl = failedUrl;
      this.errorURL = failedUrl;
      this.hasError = false;
      this.showAfterLoading();
      this.updateURL(failedUrl);
      console.warn(`[tab-crash] retrying once view=${this.id} url=${failedUrl}`);

      // 不在 render-process-gone 回调栈里同步重载，避免原生层重入。
      setTimeout(() => {
        if (
          this.webContents.isDestroyed() ||
          !this.rendererCrashRetryPending ||
          this.rendererCrashRetryUrl !== failedUrl
        ) {
          return;
        }
        this.webContents.loadURL(failedUrl).catch((error) => {
          console.error(`[tab-crash] retry rejected view=${this.id} url=${failedUrl}`, error);
        });
      }, 0);
      return;
    }

    this.rendererCrashRetryPending = false;
    this.rendererCrashRetryUrl = '';
    this.rendererCrashPageLoading = true;
    this.errorURL = failedUrl;
    this.hasError = true;
    this.showAfterLoading();
    this.updateURL(failedUrl);

    const crashTime = new Date().toISOString();
    const recoveryUrl =
      `${ERROR_PROTOCOL}://${NETWORK_ERROR_HOST}/renderer-crash` +
      `?kind=renderer-crash&reason=${encodeURIComponent(reason)}` +
      `&exitCode=${encodeURIComponent(String(exitCode ?? ''))}` +
      `&time=${encodeURIComponent(crashTime)}` +
      `&appVersion=${encodeURIComponent(app.getVersion())}` +
      `&electronVersion=${encodeURIComponent(process.versions.electron || '')}` +
      `&chromeVersion=${encodeURIComponent(process.versions.chrome || '')}` +
      `&validatedURL=${encodeURIComponent(failedUrl)}`;

    setTimeout(() => {
      if (this.webContents.isDestroyed()) return;
      this.webContents
        .loadURL(recoveryUrl)
        .then(() => {
          this.rendererCrashPageLoading = false;
        })
        .catch((error) => {
          this.rendererCrashPageLoading = false;
          console.error(`[tab-crash] failed to load recovery page, view=${this.id}`, error);
        });
    }, 0);
  }

  /** ViewManager 改用它同步组合 View 的两个 BrowserView 尺寸。 */
  public setBounds(bounds: Electron.Rectangle) {
    // [RSZ] 排查日志(临时):页面 view 尺寸的每次真实变更 + 调用方栈,
    // 用于定位最小化/还原时的意外 resize 来源(栈截断防刷屏)。
    try {
      const stack = (new Error().stack || '')
        .split('\n')
        .slice(2, 6)
        .join(' | ')
        .slice(0, 300);
      const prev = this.bounds
        ? `${this.bounds.width}x${this.bounds.height}@${this.bounds.x},${this.bounds.y}`
        : 'null';
      console.log(
        `[RSZ] view#${this.id} setBounds ${prev} -> ` +
          `${bounds.width}x${bounds.height}@${bounds.x},${bounds.y} via ${stack}`,
      );
    } catch {}
    this.browserView.setBounds(bounds);
    this.bounds = bounds;
    this.windowOpenNavigationOverlay?.setBounds(bounds);
  }

  /** 将网页 window.close() 归一为关闭当前标签，并屏蔽原生子窗口的宿主连带关闭。 */
  public requestCloseFromPage() {
    if (this.windowOpenNavigationOwner) {
      this.windowOpenNavigationOwner.closeWindowOpenNavigationOverlay(this);
      return;
    }
    if (
      this.pageCloseRequested ||
      this.destroying ||
      this.window.win.isDestroyed()
    )
      return;
    this.pageCloseRequested = true;
    this.window.send('remove-tab', this.id);
  }

  /** 物理 WebContents 发起关闭时，覆盖页只退出到原生底页。 */
  public requestCloseFromWebContents(webContentsId: number) {
    const overlay = this.windowOpenNavigationOverlay;
    if (overlay?.containsWebContents(webContentsId)) {
      overlay.requestCloseFromPage();
      return;
    }
    this.requestCloseFromPage();
  }

  public attachToWindow() {
    // Electron may keep a BrowserView's Page Visibility state as "hidden"
    // even while it is the selected tab. Keep the active view's animation
    // frames and timers running; detachFromWindow restores throttling as soon
    // as the tab becomes background content.
    if (this.contentViewBacked) {
      this.window.win.contentView.addChildView(this.browserView as WebContentsView);
    } else {
      this.window.win.addBrowserView(this.browserView as BrowserView);
    }
    // addBrowserView 的后添加项位于顶层，正好覆盖原生 about:blank 底页。
    if (!this.windowOpenNavigationOverlay?.isLoadingHidden) {
      this.windowOpenNavigationOverlay?.attachToWindow();
    }
  }

  public detachFromWindow() {
    this.nativeRightGesture?.reset(true);
    this.windowOpenNavigationOverlay?.detachFromWindow();
    if (this.contentViewBacked) {
      this.window.win.contentView.removeChildView(this.browserView as WebContentsView);
    } else {
      this.window.win.removeBrowserView(this.browserView as BrowserView);
    }
  }

  public get url() {
    return this.webContents.getURL();
  }

  public get title() {
    return this.webContents.getTitle();
  }

  public get id() {
    return this.tabId;
  }

  public get isSelected() {
    const tab = this.windowOpenNavigationOwner || this;
    return tab.id === this.window.viewManager.selectedId;
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
    if (this.webContents.isDestroyed()) return;

    const tab = this.windowOpenNavigationOwner || this;
    if (this.window.viewManager.selectedId === tab.id) {
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
   * showAfterWebDarkModeReady 在暗色样式确认就绪后挂回;did-fail-load 与 8s 定时器
   * 是兜底,避免异常页面永久不可见。
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
    if (!this.loadingHidden) {
      this.loadingHidden = true;
      // 已是活动标签(标签内跳转)立即分离;新建标签尚未挂载,select 的守卫会拦截挂载。
      if (this.window?.viewManager?.selectedId === this.id) {
        try {
          this.detachFromWindow();
        } catch {}
      }
    }
    // 重定向/连续导航也必须重新计时,防止上一文档的兜底在新文档注入期间触发。
    if (this.loadingHideTimer) clearTimeout(this.loadingHideTimer);
    // 兜底:极慢页、注入异常或一直 pending 的导航,8s 后强制挂回避免永久空白。
    this.loadingHideTimer = setTimeout(() => {
      this.showAfterLoading();
    }, 8000);
  }

  /**
   * 当前导航的暗色注入完成后再显示。promise/id 参数由 dom-ready 固定为同一快照,
   * 防止重定向后旧 Promise resolve 把新文档提前显示。
   */
  private showAfterWebDarkModeReady(
    navigationId = this.webDarkModeNavigationId,
    promise = this.webDarkModeInjectPromise,
  ) {
    if (!this.loadingHidden) return;
    if (!promise) return;
    promise
      .catch(() => undefined)
      .then(() => {
        if (navigationId !== this.webDarkModeNavigationId) return;
        if (promise !== this.webDarkModeInjectPromise) return;
        this.webDarkModeInjectPromise = null;
        this.showAfterLoading();
      });
  }

  private showAfterLoading() {
    if (this.loadingHideTimer) {
      clearTimeout(this.loadingHideTimer);
      this.loadingHideTimer = null;
    }
    if (!this.loadingHidden) return;
    this.loadingHidden = false;
    // 仅当仍是当前活动标签才挂回;否则保持分离,切回时 select 会按正常流程挂载。
    if (this.isSelected && this.browserView) {
      const b = this.window.viewManager.contentBounds || this.bounds;
      if (b) {
        try {
          this.browserView.setBounds(b);
        } catch {}
      }
      try {
        this.attachToWindow();
        this.browserView.webContents.focus();
      } catch {}
    }
  }

  /** 加载隐藏中:select() 据此跳过 addBrowserView,避免露出加载中的网页。 */
  public get isLoadingHidden() {
    return this.loadingHidden;
  }

  public handleNativeRightMouseEvent(
    event: Electron.Event,
    mouse: Electron.MouseInputEvent,
    offset?: {x: number; y: number},
  ): NativeRightGestureVisualUpdate | null {
    if (this.destroying || !this.isSelected) {
      this.nativeRightGesture.reset();
      return {phase: 'reset', x: mouse.x, y: mouse.y};
    }
    const update = this.nativeRightGesture.handle(event, {
      ...mouse,
      x: mouse.x - (offset?.x || 0),
      y: mouse.y - (offset?.y || 0),
    });
    if (update) {
      // 绘制路径由手势起点决定:中途页面就绪也不切换,否则新注入的页面代码
      // 没有本轮 tracking 状态,轨迹会冻结在注入瞬间。
      if (update.phase === 'start') {
        this.gestureStartedOnPage = this.pageGestureDrawing && !this.isLoadingHidden;
      }
      if (this.gestureStartedOnPage) {
        // 页面已注入手势绘制代码:轨迹/标签由页面 canvas 自绘,主进程不画 overlay。
        // 终止相位转 reset 转发,销毁加载期间可能创建的兜底窗口。
        if (update.phase === 'end' || update.phase === 'reset') {
          return {phase: 'reset', x: mouse.x, y: mouse.y};
        }
        return null;
      }
    }
    return update;
  }

  public destroy() {
    if (this.destroying || !this.browserView) return;
    this.destroying = true;
    // 蓝牙 chooser 进行中:先取消弹窗侧请求(settle 幂等)。webContents 即将销毁,
    // Chromium callback 不再安全调用。
    if (this.bluetoothChooser) {
      this.bluetoothChooser = null;
      this.requestedBluetooth = null;
      cancelBluetoothRequest();
    }
    const hadHidRequest = !!this.requestedHid;
    const hadDisplayCaptureRequest = !!this.requestedDisplayCapture;
    this.requestedHid = null;
    if (hadHidRequest) cancelHidRequest();
    this.requestedDisplayCapture = null;
    if (hadDisplayCaptureRequest) cancelDisplayCaptureRequest();
    this.ipc.dispose();
    this.translateAbort?.abort();
    this.translateAbort = undefined;
    this.requestRecord.clear();
    this.netVideoUrls = [];
    this.videoUrls = [];
    this.videoMeta.clear();
    this.autofillCredentialsCache = null;
    this.autofillCaptureFrames.clear();
    this.autofillCaptureTokens.clear();
    this.nativeRightGesture.reset();
    const overlay = this.windowOpenNavigationOverlay;
    this.windowOpenNavigationOverlay = undefined;
    if (overlay) {
      overlay.windowOpenNavigationOwner = undefined;
      overlay.destroy();
    }
    const tabId = this.id;
    const guardHostClose =
      this.contentViewBacked && !this.window.win.isDestroyed();
    if (this.loadingHideTimer) {
      clearTimeout(this.loadingHideTimer);
      this.loadingHideTimer = null;
    }
    this.loadingHidden = false;
    try {
      this.detachFromWindow();
    } catch {}
    if (guardHostClose) beginPageClose(this.window.win, tabId);
    try {
      (this.browserView.webContents as any).destroy();
    } finally {
      if (guardHostClose) expirePageClose(this.window.win, tabId);
    }
    this.browserView = null;
  }

  public async updateCredentials() {
    if (
      !process.env.ENABLE_AUTOFILL ||
      this.browserView.webContents.isDestroyed()
    )
      return;

    // 钥匙图标:同时检查顶层页和已加载 frame 的实际 host。跨域 SSO
    // 的凭证属于 frame 站点，不能只按顶层页面域名判断。
    const all = await this.getAutofillCredentials();
    const hosts = new Set<string>();
    if (this.hostname) hosts.add(this.hostname);
    for (const item of this.framesCache) {
      const frame = webFrameMain.fromId(item.frameProcessId, item.frameRoutingId);
      if (!frame) continue;
      try {
        const url = new URL(frame.url || '');
        if (/^https?:$/.test(url.protocol)) hosts.add(url.hostname);
      } catch {}
    }
    const has = all.some(
      (record) =>
        !!record?.url &&
        Array.from(hosts).some((host) => hostMatches(record.url, host)),
    );

    this.emitEvent('credentials', has);
  }

  // 凭证保存/删除后刷新跨域 iframe 中的选择器。跨域 frame 的注入脚本不走
  // view-preload，若不重新注入，它会一直闭包持有旧密码，表现为“更新后仍填旧值”。
  public async refreshAutofillPickers(credentials?: IFormFillData[]) {
    if (!process.env.ENABLE_AUTOFILL || this.webContents.isDestroyed()) return;
    this.autofillCredentialsCache = credentials
      ? Promise.resolve(credentials)
      : null;
    const currentCredentials = await this.getAutofillCredentials();
    const seenFrames = new Set<string>();
    await Promise.all(
      this.framesCache.map(async (item) => {
        const frameKey = `${item.frameProcessId}:${item.frameRoutingId}`;
        if (seenFrames.has(frameKey)) return;
        seenFrames.add(frameKey);
        const frame = webFrameMain.fromId(item.frameProcessId, item.frameRoutingId);
        if (frame) {
          try {
            await this.injectAutofillPickerIntoFrame(frame, currentCredentials);
          } catch {
            // 导航时 framesCache 可能短暂包含已销毁的旧 frame。
          }
        }
      }),
    );
  }

  private async injectAutofillPickerIntoFrame(
    frame: Electron.WebFrameMain,
    credentials?: IFormFillData[],
  ): Promise<void> {
    if (!process.env.ENABLE_AUTOFILL || !Application.instance.settings.object.autofill) {
      return;
    }

    let hostname = '';
    let origin = '';
    try {
      const frameUrl = new URL(frame.url || '');
      if (!/^https?:$/.test(frameUrl.protocol)) return;
      hostname = frameUrl.hostname;
      origin = frameUrl.origin;
    } catch {
      return;
    }

    const all = credentials || (await this.getAutofillCredentials());
    const matched = all
      .filter((item) => item.url && hostMatches(item.url, hostname))
      .sort(
        (left, right) =>
          Number(!hasSameHostname(left.url, hostname)) -
          Number(!hasSameHostname(right.url, hostname)),
      );
    // 即使本站尚无记录也要注入监听器，首次登录提交后才能弹出保存提示。

    const frameProcessId = frame.processId;
    const frameRoutingId = frame.routingId;
    const frameKey = `${frameProcessId}:${frameRoutingId}`;
    let captureToken = this.autofillCaptureTokens.get(frameKey);
    if (!captureToken) {
      captureToken = randomUUID();
      this.autofillCaptureTokens.set(frameKey, captureToken);
      this.autofillCaptureFrames.set(captureToken, {
        processId: frameProcessId,
        routingId: frameRoutingId,
        origin,
        createdAt: Date.now(),
      });
    }
    const {buildAutofillPickerCode} = await import(
      /* webpackChunkName: "on-demand-autofill-picker" */
      './services/autofill-picker'
    );
    if (this.webContents.isDestroyed()) return;
    const currentFrame = webFrameMain.fromId(frameProcessId, frameRoutingId);
    if (!currentFrame) return;
    await currentFrame.executeJavaScript(
      buildAutofillPickerCode(matched, {
        captureToken,
        fillSingleImmediately: true,
      }),
      true,
    );
  }

  private getAutofillCredentials() {
    if (!this.autofillCredentialsCache) {
      this.autofillCredentialsCache = Application.instance.storage.find<IFormFillData>({
        scope: 'formfill',
        query: {type: 'password'},
      });
    }
    return this.autofillCredentialsCache;
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

    const tab = this.windowOpenNavigationOwner || this;
    const reportedUrl =
      this.hasError || tab.hasError ? tab.errorURL || this.errorURL : url;
    const displayUrl = getGreasyforkDisplayUrl(reportedUrl);
    this.emitEvent(
      'url-updated',
      displayUrl,
    );

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
          buildGestureCode(viewGestureConfig()),
          true,
        ).catch((_: unknown): void => undefined);
        // 注入已受理:主帧手势代码与文档共存,页面从此自绘轨迹。
        this.pageGestureDrawing = true;
      }
    } catch (_) {
      // 导航切换中 / frame 暂不可用:忽略,交给后续事件兜底
    }
  }

  // 「网页暗色模式 - 浏览器实现」:仅在 webDarkMode==='browser' 且暗色生效主题下,
  // 向 http(s)/file 页面经 executeJavaScript 注入 Dark Reader 引擎(注入脚本自带「暗站门控」:
  // 页面根/body 背景已是暗色则跳过 enable,避免对暗色站点反相导致黑变白)。
  // executeJavaScript 不受页面 CSP 约束(同 translate)。系统页(webui yjllq:// /
  // dev localhost:4444、chrome-extension://、about:)跳过。返回 Promise:供 dom-ready 触发后
  // 正常显示路径会等待注入 Promise,驱动脚本确认首批暗色样式落盘后再显示,
  // 消除快速页白闪(FOUC)。非 browser 模式或浅色主题:立即 resolve(no-op),页面保持原样。
  private async injectWebDarkMode(): Promise<void> {
    const wc = this.webContents;
    if (!wc || wc.isDestroyed()) return;
    const settings = Application.instance.settings?.object as any;
    if (!settings || settings.webDarkMode !== 'browser') return;
    if (!isDarkThemeActive()) return;
    let url = '';
    try {
      url = wc.getURL();
    } catch {
      return;
    }
    // 仅作用于 http(s)/file 页面:排除系统页(webui——prod 为 yjllq:// 已被 scheme 排除,
    // dev 为 http://localhost:4444/ 需显式排除,否则设置/书签等系统页会被错误暗化;
    // chrome-extension://、about: 等也被 scheme 排除)。file://(本地 HTML)算"网页",需暗化。
    if (!/^(https?|file):/i.test(url)) return;
    if (url.startsWith(WEBUI_BASE_URL)) return;
    try {
      await injectDarkReader(wc);
    } catch (e) {
      tlog('injectWebDarkMode failed', e);
    }
  }

  private injectWebDarkModeIntoFrame(frame: Electron.WebFrameMain) {
    const settings = Application.instance.settings?.object as any;
    if (!settings || settings.webDarkMode !== 'browser') return;
    if (!isDarkThemeActive()) return;

    let topUrl = '';
    let frameUrl = '';
    try {
      topUrl = this.webContents.getURL();
      frameUrl = frame.url || '';
    } catch {
      return;
    }
    if (!/^(https?|file):/i.test(topUrl) || topUrl.startsWith(WEBUI_BASE_URL)) return;
    if (frameUrl && !/^(https?|file|about):/i.test(frameUrl)) return;
    injectDarkReaderIntoFrame(frame).catch(() => undefined);
  }

  // 配置变更时把最新手势配置重新注入所有已缓存的帧(顶层 + 子帧)。
  // 配置是注入期快照,热更新只能重注入。脚本内版本戳令旧监听器失效,故同帧多次
  // 注入安全(仅最新一份生效)。
  public reinjectGesture() {
    try {
      const code = buildGestureCode(viewGestureConfig());
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

  // 开启翻译:设 active、驱动当前翻译引擎(微软/雨见/自定义,见 registry)。
  // persist=true 时把本站加入"始终显示翻译图标"列表(菜单/右键手动开启时传 true;
  // 图标点击/弹窗切语言等不必持久化)。
  public startTranslation(persist = false) {
    if (this.webContents.isDestroyed()) {
      console.log('[translate] startTranslation ABORT: webContents destroyed');
      return;
    }
    if (!this.translateTarget) this.translateTarget = 'zh-CN';
    console.log(`[translate] startTranslation | target=${this.translateTarget} persist=${persist} pageLang=${this.translateDetectedLang || '(unknown)'}`);
    this.translateActive = true;
    this.emitEvent('translate-state', true, this.translateTarget);
    if (persist) this.persistAutoTranslateSite();
    this.driveTranslate();
  }

  // 驱动一次"收集 → 主进程翻译 → 回填"循环。新驱动会取消旧请求并排队等待旧任务收尾。
  // 取消条件:webContents 销毁 / 有更新的循环接管(gen 不匹配) / 翻译已关闭。
  // translateAbort 同时中止在途 fetch(切引擎/语言时省自定义 LLM 的 token)。
  private driveTranslate() {
    const gen = ++this.translateGen;
    console.log(
      `[translate-diag] view=${this.id} stage=drive-queued gen=${gen}` +
      ` hasPrevious=${!!this.translateRunPromise} active=${this.translateActive}`,
    );
    if (this.translateAbort) {
      this.translateAbort.abort();
    }
    const abort = new AbortController();
    this.translateAbort = abort;
    const wc = this.webContents;
    const previous = this.translateRunPromise || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        if (wc.isDestroyed() || gen !== this.translateGen || !this.translateActive) return;
        const engine = getActiveEngine();
        console.log(`[translate-diag] view=${this.id} stage=drive-start gen=${gen} engine=${engine.id} target=${this.translateTarget} url=${(() => { try { return wc.getURL(); } catch { return '(destroyed)'; } })()}`);
        try {
          const result = await runTranslate(
            engine,
            wc,
            this.translateTarget,
            () => wc.isDestroyed() || gen !== this.translateGen || !this.translateActive,
            abort.signal,
          );
          console.log(`[translate] ${engine.id} result`, result, 'target=', this.translateTarget);
        } catch (e) {
          console.log(`[translate] ${engine.id} failed`, e);
        }
      });
    this.translateRunPromise = next;
    void next.finally(() => {
      if (this.translateRunPromise === next) this.translateRunPromise = null;
    });
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
    if (this.webContents.isDestroyed()) {
      console.log(`[translate] changeTranslationTarget ABORT: destroyed (code=${target})`);
      return;
    }
    console.log(`[translate] changeTranslationTarget | code=${target} active=${this.translateActive} prevTarget=${this.translateTarget}`);
    this.translateTarget = target || 'zh-CN';
    if (!this.translateActive) {
      this.startTranslation();
      return;
    }
    // 原地切语言:先还原成原文(revert 用旧引导的 reg),再重跑(重注入新引导、重新 collect)。
    // driveTranslate 自增 translateGen,旧循环随即自取消,避免新旧译文交错。
    this.translateGen++;
    if (this.translateAbort) this.translateAbort.abort();
    const wc = this.webContents;
    revertTranslate(wc)
      .catch(() => undefined)
      .finally(() => this.driveTranslate());
  }

  // 关闭翻译:清 active,原地还原文本节点为原文并移除状态条(不 reload,保留滚动/输入态)。
  public stopTranslation() {
    if (this.webContents.isDestroyed()) return;
    this.translateActive = false;
    this.emitEvent('translate-state', false, '');
    if (this.translateAbort) {
      this.translateAbort.abort();
      this.translateAbort = undefined;
    }
    revertTranslate(this.webContents).catch(() => undefined);
  }

  // 安装完成后调用:标记本站已安装并广播,地址栏图标转"已安装"态。
  public markPwaInstalled() {
    this.pwaInstalled = true;
    this.emitEvent('pwa-installed', true);
  }

  public emitEvent(event: TabEvent, ...args: any[]) {
    const tab = this.windowOpenNavigationOwner || this;
    this.window.send('tab-event', event, tab.id, args);
    // 嗅探到新视频时，若智能播放器窗口开着且正看本 tab，实时刷新其资源列表
    if (event === 'supervideo-video') {
      try {
        refreshMediaPlayer(tab.id);
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
    if (this.rememberVideoUrl(url, matched)) {
      this.emitEvent('supervideo-video', this.videoUrls);
    }
  }

  public addNetVideoRequest(videoRequest: VideoRequest) {
    const existingIndex = this.netVideoUrls.findIndex(
      (item) => item.url === videoRequest.url,
    );
    if (existingIndex >= 0) {
      this.netVideoUrls.splice(existingIndex, 1);
    }
    this.netVideoUrls.push(videoRequest);
    while (this.netVideoUrls.length > MAX_VIDEO_RECORDS) {
      this.netVideoUrls.shift();
    }
    // 网络嗅探到的直链(m3u8/mp4 等)也直接纳入资源列表，
    // 不再依赖页面 <video> 是否暴露 src(很多站点走 blob/MSE)。
    let changed = false;
    if (!videoRequest.url.startsWith("blob:")) {
      changed = this.rememberVideoUrl(videoRequest.url, videoRequest);
    }
    let replacedBlob = false;
    for (let i = 0; i < this.videoUrls.length; i++) {
      let url = this.videoUrls[i];
      if (url.startsWith("blob:")) {
        const host = new URL(url.replace("blob:", "")).hostname;
        //console.log("addNetVideoRequest", url, host, videoRequest);
        if (videoRequest.referrer && new URL(videoRequest.referrer).hostname == host) {
          this.videoUrls[i] = videoRequest.url;
          replacedBlob = true;
        }
        if (videoRequest.requestHeaders && videoRequest.requestHeaders["Origin"]
          && new URL(videoRequest.requestHeaders["Origin"]).hostname == host) {
          this.videoUrls[i] = videoRequest.url;
          replacedBlob = true;
        }
        if (videoRequest.frameUrl && new URL(videoRequest.frameUrl).hostname == host) {
          this.videoUrls[i] = videoRequest.url;
          replacedBlob = true;
        }
      }
    }
    if (replacedBlob) {
      this.rememberVideoUrl(videoRequest.url, videoRequest);
      changed = true;
    }
    if (changed) {
      this.emitEvent('supervideo-video', this.videoUrls);
    }
  }

  // URL 列表和元信息共享同一套最近使用顺序。再次观察到正在播放的
  // URL 时把它移到末尾，淘汰 URL 时同步淘汰 metadata。
  private rememberVideoUrl(url: string, source?: VideoRequest) {
    if (!url) return false;
    const existed = this.videoUrls.includes(url);
    if (existed) {
      this.videoUrls = this.videoUrls.filter((item) => item !== url);
    }
    this.videoUrls.push(url);
    this.rememberVideoMeta(url, source);

    while (this.videoUrls.length > MAX_VIDEO_RECORDS) {
      const evicted = this.videoUrls.shift();
      if (evicted) this.videoMeta.delete(evicted);
    }
    return !existed;
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
    if (existing) this.videoMeta.delete(url);
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
