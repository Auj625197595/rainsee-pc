import {BrowserWindow, ipcRenderer, screen, Session, app} from 'electron'
import * as path from 'path'
import {getViewMenu} from "~/main/menus/extension-popup";
import {Application} from "~/main/application";
import {windowOpenToLoadOptions} from "~/main/utils/window-open";

// const debug = require('debug')('electron-chrome-extensions:popup')
const debug = console.log;

export interface PopupAnchorRect {
  x: number
  y: number
  width: number
  height: number
}

interface PopupViewOptions {
  extensionId: string
  session: Session
  parent: BrowserWindow
  url: string
  /**
   * Snapshot of the host's real tab list, handed to the popup so chrome.tabs
   * .query can resolve the active site even when crx-preload is skipped (see
   * injectTabs). Optional — older call sites don't pass it.
   */
  tabs?: any[]
  anchorRect: PopupAnchorRect
}

const supportsPreferredSize = () => {
  const major = parseInt(process.versions.electron.split('.').shift() || '', 10)
  return major >= 12
}

export class PopupView {
  static POSITION_PADDING = 5

  static BOUNDS = {
    // Chromium's ExtensionViewHost auto-resize bounds.
    minWidth: 25,
    minHeight: 25,
    maxWidth: 800,
    maxHeight: 600,
  }

  /** 合并同一轮 DOM/layout 产生的 preferred-size 连发。窗口保持旧尺寸（首次则保持隐藏），
   *  直到最新尺寸稳定，再一次性提交 bounds。 */
  static readonly PREFERRED_SIZE_SETTLE_MS = 60
  /** 动画或轮询页面可能持续改变布局，不能让 debounce 导致 popup 永远不显示/不更新。 */
  static readonly PREFERRED_SIZE_MAX_WAIT_MS = 180
  /**
   * setContentBounds 会改变页面可用宽度；部分扩展会因此在两个 preferred size
   * 间来回报告。检测到 A -> B -> A 后先锁定在较大尺寸，截断这个反馈环。
   */
  static readonly PREFERRED_SIZE_OSCILLATION_LOCK_MS = 1000
  /** 锁定期间仍允许真实内容明显扩展，不把正常交互当成抖动。 */
  static readonly PREFERRED_SIZE_LOCK_BREAK_THRESHOLD_PX = 80
  /** 部分 sandbox 异常的扩展既不发 preferred-size-changed，executeJavaScript 也不返回。
   *  dom-ready 后用独立的 CDP 测量兜底，保证窗口一定能显示。 */
  static readonly INITIAL_SIZE_FALLBACK_MS = 220
  static readonly FALLBACK_MEASURE_TIMEOUT_MS = 300
  static readonly FALLBACK_SIZE = { width: 400, height: 300 }
  static readonly FALLBACK_SIZE_MESSAGE = '[rainsee-popup-size]'
  browserWindow?: BrowserWindow
  parent?: BrowserWindow
  extensionId: string

  private anchorRect: PopupAnchorRect
  private destroyed: boolean = false
  private hidden: boolean = true
  private devToolsOpened: boolean = false
  private crashRecovered: boolean = false
  /** True until the popup window has actually been show()n. Exposed so the
   *  toggle path (app.ts showExtensionPopup) can avoid tearing down a popup
   *  that is still mid-load — a slow-loading popup (uBlock popup-fenix) would
   *  otherwise be toggle-closed on every re-click before it ever appears. */
  get isHidden() {
    return this.hidden
  }
  /** 加载卡死判定:仍在隐藏(未 show)且超过 5s。toggle 路径据此让再次点击销毁并重开
   *  卡死的 popup——否则一个永远到不了 did-finish-load 的 popup 会卡在 isHidden 守卫后,
   *  再点也无反应、永远打不开。 */
  private createdAt = Date.now()
  get isStalled() {
    return this.hidden && Date.now() - this.createdAt > 5000
  }
  /** Set once the popup has been rebuilt to recover a missing electron bridge
   *  (see load()). Distinct from crashRecovered so the two recovery paths don't
   *  short-circuit each other, but both are once-only to avoid rebuild loops. */
  private bridgeRecovered: boolean = false

  /** Saved so the window can be torn down and rebuilt on a renderer crash. */
  private session: Session
  private url: string
  /** Host tab snapshot injected into the popup (see injectTabs). */
  private tabs: any[]

  /** Preferred size changes are only received in Electron v12+ */
  private usingPreferredSize = supportsPreferredSize()

  private readyPromise: Promise<void>

  constructor(opts: PopupViewOptions) {
    this.parent = opts.parent
    this.extensionId = opts.extensionId
    this.anchorRect = opts.anchorRect
    this.session = opts.session
    this.url = opts.url
    this.tabs = (opts.tabs || []).map((tab) => ({
      ...tab,
      // Chrome always exposes groupId on tabs.Tab; ungrouped tabs use -1.
      groupId: typeof tab?.groupId === 'number' ? tab.groupId : -1,
    }))

    this.readyPromise = this.spawn()
  }

  /**
   * Build the popup BrowserWindow, wire its events, and load the URL.
   * Extracted from the constructor so a crashed renderer can be recovered by
   * tearing the window down and calling spawn() again (see render-process-gone).
   */
  private spawn(): Promise<void> {
    this.resetPreferredSizeState()
    this.browserWindow = new BrowserWindow({
      show: false,
      frame: false,
      parent: this.parent,
      movable: false,
      maximizable: false,
      minimizable: false,
      resizable: false,
      skipTaskbar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        session: this.session,
        // Classic preload crx-preload directly. The session-registered
        // crx-mv2-preload (frame type) is delivered via binding.startupData
        // .preloadScripts, which is silently dropped when this renderer is
        // co-sited with a sandboxed host process (binding.startupData === null
        // → "sandboxed_renderer.bundle.js script failed to run"), leaving the
        // popup without the electron IPC bridge → tabs.query/storage/etc. fall
        // back to broken native impls. The classic webPreferences.preload is
        // delivered via WebPreferences (a different path) and survives that
        // case. crx-preload is idempotent (preload.ts __crxApisInjected guard),
        // so when BOTH paths land the inject still runs once. Path matches the
        // session registration in sessions-service.ts / browser/index.ts.
        preload: path.join(app.getAppPath(), 'build', 'crx-preload.bundle.js'),
        sandbox: false,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        contextIsolation: false,
        plugins: true,
        enableWebSQL: true,
        webSecurity: false,
        allowRunningInsecureContent: true,
        enablePreferredSizeMode: true,
      },
    })

    const untypedWebContents = this.browserWindow.webContents as any
    untypedWebContents.on('preferred-size-changed', this.updatePreferredSize)
    require("@electron/remote/main").enable(this.browserWindow.webContents);

    this.browserWindow.webContents.on('devtools-closed', this.onDevToolsClosed)
    this.browserWindow.webContents.on('devtools-closed', this.maybeClose)
    this.browserWindow.webContents.on('devtools-opened', this.onDevToolsOpened)
    this.browserWindow.on('blur', this.maybeClose)
    this.browserWindow.on('closed', this.destroy)
    this.parent.once('closed', this.destroy)

    // 关键兜底:在 MV3 service worker 被主动拉起并保活期间,Chromium 会把同源
    // (chrome-extension://<id>)的 popup frame 与正在运行的 SW 共置到同一个渲染
    // 进程。该进程是 SW 宿主、以 sandbox 方式启动,frame 类型的 startupData
    // (preloadScripts)未投递 → sandbox bundle 解构崩溃(白色小方块):
    //   "Cannot destructure property 'preloadScripts' of 'binding.startupData'"
    // 此时 reload() 无效——它复用同一个坏掉的崩溃进程。正确做法是销毁窗口、
    // 整体重建:新的 WebContents 会重新协商进程,拿到带完整 startupData 的 frame
    // 进程。仅重建一次,避免崩溃循环。
    this.browserWindow.webContents.on('render-process-gone', (_e, details) => {
      if (this.destroyed || this.crashRecovered) return
      if (details.reason === 'clean-exit') return
      this.crashRecovered = true
      debug(`popup renderer gone (${details.reason}); rebuilding window once`)

      const dead = this.browserWindow
      this.browserWindow = undefined
      if (dead && !dead.isDestroyed()) {
        dead.off('closed', this.destroy)
        dead.destroy()
      }

      // 给 Chromium 一拍回收崩溃进程,再重建,确保拿到新进程而非旧的崩溃宿主。
      setTimeout(() => {
        if (this.destroyed) return
        this.readyPromise = this.spawn()
      }, 50)
    })

    this.browserWindow.webContents.on('context-menu', (e, params) => {
      const menu = getViewMenu(params, this.browserWindow.webContents);
      menu.popup();
    });
    this.browserWindow.webContents.setWindowOpenHandler((details) => {
      switch (details.disposition) {
        case 'foreground-tab':
        case 'background-tab':
        case 'new-window': {
          // setWindowOpenHandler doesn't yet support creating BrowserViews
          // instead of BrowserWindows. For now, we're opting to break
          // window.open until a fix is available.
          // https://github.com/electron/electron/issues/33383
          if(details.url && details.url != "about:blank") {
            const loadOptions = windowOpenToLoadOptions(details);
            queueMicrotask(() => {
              Application.instance.windows.current.viewManager.create(
                {
                  url: details.url,
                  active: true,
                  loadOptions,
                } as any,
                true,
              );
            });
          }
          return {action: 'deny'}
        }
        default:
          return {action: 'allow'}
      }
    });
    return this.load(this.url)
  }

  private show() {
    if (this.initialSizeFallbackTimer) {
      clearTimeout(this.initialSizeFallbackTimer)
      this.initialSizeFallbackTimer = null
    }
    this.hidden = false
    this.browserWindow?.show()
    console.log(`[crx-popup] show() ${this.extensionId}`)
  }

  private async load(url: string): Promise<void> {
    const win = this.browserWindow!

    // DIAGNOSTIC: print the popup webContents' ACTUAL runtime webPreferences
    // and the session's registered preload scripts. The page keeps coming up
    // sandboxed ("sandboxed_renderer ... binding.startupData null") even though
    // this window is created with sandbox:false / contextIsolation:false, so we
    // need to see what Electron actually applied vs. what we asked for.
    try {
      const wc: any = win.webContents
      const wp = wc.getLastWebPreferences ? wc.getLastWebPreferences() : undefined
      const sess: any = wc.session
      const regs =
        sess && sess.getPreloadScripts
          ? sess.getPreloadScripts().map((p: any) => `${p.type}:${p.id}`)
          : 'n/a'
      console.log(
        `[crx-popup] load url=${url} sandbox=${wp && wp.sandbox} contextIsolation=${
          wp && wp.contextIsolation
        } nodeIntegration=${wp && wp.nodeIntegration} preloads=${JSON.stringify(regs)}`,
      )
    } catch (e: any) {
      console.log(`[crx-popup] diag error: ${e && e.message}`)
    }

    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (
        typeof message === 'string' &&
        message.startsWith(PopupView.FALLBACK_SIZE_MESSAGE)
      ) {
        this.onFallbackSizeMessage(message)
        return
      }
      if (
        typeof message === 'string' &&
        (message.includes('[crx-preload]') ||
          message.includes('[crx-shim]') ||
          message.includes('[commons-ui]'))
      ) {
        console.log(
          `[crx-popup-console][${level}] ${message} (${sourceId || '<no-source>'}:${line})`,
        )
      }
    })

    // Inject the host's real tab list so chrome.tabs.query({active:true}) can
    // resolve the current site even when crx-preload is skipped (sandboxed popup
    // renderer, binding.startupData===null → no electron bridge → the SHIM's
    // tabs.query would otherwise fall back to Electron's native registry, which
    // is empty/wrong for this app's BrowserView tabs → AdGuard popup stuck on
    // "Loading"). webContents.executeJavaScript is a MAIN-PROCESS API that
    // survives the sandbox (no preload/startupData dependency). The SHIM's
    // tabs.query reads globalThis.__crxTabs when the bridge is absent (polls
    // until this lands). Inject on dom-ready (earliest) AND did-finish-load
    // (covers rebuild/reload); __crxTabs is additive.
    const injectTabs = (when: string) => {
      if (this.destroyed) { console.log(`[crx-popup] injectTabs(${when}) skip: destroyed`); return }
      if (!this.browserWindow) { console.log(`[crx-popup] injectTabs(${when}) skip: no window`); return }
      console.log(`[crx-popup] injectTabs(${when}) n=${this.tabs.length}`)
      const wc = this.browserWindow.webContents
      if (!wc || wc.isDestroyed()) { console.log(`[crx-popup] injectTabs(${when}) skip: wc gone`); return }
      if (!this.tabs.length) {
        const clearCode = `try{try{delete globalThis.__crxTabs}catch(_){}try{localStorage.removeItem('__crxTabs_lsinjected');localStorage.removeItem('__crxTabs_lsinjected_at')}catch(_){}}catch(e){}`
        wc.executeJavaScript(clearCode, true).catch(() => undefined)
        return
      }
      // __crxProbe is a fixed marker to prove executeJavaScript itself lands in
      // the SHIM's world (independent of tabs payload). The SHIM reports it.
      // Also mirror to localStorage: this inject runs in the MAIN frame only, but
      // omega's popup lives in a CHILD iframe that can be site-isolated into a
      // separate process (window.top access throws cross-origin there). Same-origin
      // extension pages share localStorage across processes, so the child's SHIM
      // reads it as a robust fallback (see getCT in extension-storage-patch.ts).
      const payload = JSON.stringify(this.tabs)
      const code = `try{globalThis.__crxProbe=1;globalThis.__crxTabs=${payload};try{localStorage.setItem('__crxTabs_lsinjected',${payload});localStorage.setItem('__crxTabs_lsinjected_at',String(Date.now()))}catch(_){}}catch(e){}`
      wc.executeJavaScript(code, true)
        .then(() => console.log(`[crx-popup] injectTabs(${when}) injected ok`))
        .catch((e: any) => console.log(`[crx-popup] injectTabs(${when}) error: ${e && e.message}`))
    }
    win.webContents.once('dom-ready', () => {
      console.log(`[crx-popup] dom-ready`)
      this.domReady = true
      this.scheduleInitialSizeFallback()
      // CDP remains functional in the sandbox failure mode where insertCSS and
      // executeJavaScript can hang. The media query automatically restores the
      // native scrollbar at either Chrome size limit.
      void this.installRootScrollbarGuardWithDebugger(win).catch((error) => {
        debug('[crx-popup] failed to install scrollbar guard', error)
      })
      injectTabs('dom-ready')
    })
    win.webContents.once('did-finish-load', () => {
      console.log(`[crx-popup] did-finish-load`)
      injectTabs('did-finish-load')
    })
    // Diagnose popup load stalls: uBlock's popup-fenix.html has been observed to
    // send the mainFrame request but never reach dom-ready (no <script> sub-
    // resources fetched, no [crx-shim] output) -> loadURL never resolves -> the
    // popup never shows. did-fail-load reveals a hard navigation failure; the
    // load-state log reveals whether the navigation stalled mid-flight.
    win.webContents.once('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
      console.log(`[crx-popup] did-fail-load errorCode=${errorCode} desc=${errorDescription} url=${validatedURL}`)
    })
    win.webContents.once('did-start-loading', () => console.log(`[crx-popup] did-start-loading`))
    win.webContents.once('did-stop-loading', () => console.log(`[crx-popup] did-stop-loading`))

    // PRIMARY channel: append a transient tab snapshot to the URL hash. The
    // fragment is available before any script runs (no main→renderer IPC), so
    // it survives the sandboxed-renderer state that breaks both the session
    // preload and executeJavaScript. The first injected SHIM synchronously
    // caches a valid `crxbridge=` payload, then removes only that segment with
    // history.replaceState before extension hash routers initialize.
    let loadUrl = url
    if (this.tabs.length && url.indexOf('crxbridge=') === -1) {
      const sep = url.indexOf('#') === -1 ? '#' : '&'
      loadUrl = url + sep + 'crxbridge=' + encodeURIComponent(JSON.stringify(this.tabs))
      console.log(`[crx-popup] url hash appended n=${this.tabs.length} len=${loadUrl.length}`)
    }

    try {
      // 给 loadURL 一个兜底超时:uBlock popup-fenix 曾出现 did-start-loading 后永远到不了
      // did-finish-load(webRequest onHeadersReceived 不回调),loadURL 的 await 永久挂起、
      // show() 永不执行、popup 永远打不开。12s 仍未完成则视为卡死,放行继续(配合 isStalled
      // 让用户能再点重开),不再永久占用。
      await Promise.race([
        win.webContents.loadURL(loadUrl),
        new Promise((_r, reject) =>
          setTimeout(() => reject(new Error('POPUP_LOAD_STALL')), 12000),
        ),
      ])
    } catch (e: any) {
      // ERR_FAILED (-2) is EXPECTED, not a real load failure: it fires whenever
      // the popup is torn down while loadURL is still pending. That happens on
      // every toggle — clicking the action while the popup is open/loading
      // closes it via showExtensionPopup's toggle path, aborting the in-flight
      // navigation — and on crash/bridge-recovery respawns. It is caught,
      // non-fatal, and not extension-specific (seen with uBlock on rapid
      // double-clicks). Downgrade just that case to a concise log so it stops
      // printing a scary full-stack [error]; any other load error stays real.
      if (e && (e.code === 'ERR_FAILED' || e.errno === -2)) {
        debug(`[crx-popup] loadURL rejected (destroyed=${this.destroyed}): ${e.message || e}`)
      } else if (e && e.message === 'POPUP_LOAD_STALL') {
        console.log(`[crx-popup] loadURL STALLED >12s (no did-finish-load); proceeding best-effort`)
      } else {
        console.error(e)
      }
    }

    if (this.destroyed) return

    // A direct Electron invoke bridge may be absent when startupData is dropped,
    // while the source shim still provides a complete API through its service-
    // worker proxy. Treat that fallback as healthy. Rebuild only when the popup
    // has the wrong runtime identity or is missing an API surface it declared it
    // needs; otherwise every healthy shim-backed popup would rebuild once.
    try {
      const bridgeState = await win.webContents.executeJavaScript(
        `(() => {
          const e = globalThis.electron;
          const c = globalThis.chrome;
          let manifest;
          try { manifest = c?.runtime?.getManifest?.(); } catch {}
          const permissions = manifest?.permissions || [];
          const needsStorage = permissions.includes('storage');
          const needsSessionStorage = needsStorage && manifest?.manifest_version === 3;
          return {
            electronInvoke: typeof e?.invokeExtensionRaw === 'function' || typeof e?.invokeExtension === 'function',
            runtimeId: c?.runtime?.id || '',
            tabsQuery: typeof c?.tabs?.query === 'function',
            storageReady: !needsStorage || (
              typeof c?.storage?.local?.get === 'function' &&
              (!needsSessionStorage || typeof c?.storage?.session?.get === 'function')
            ),
            shim: globalThis.yujianobjtest ?? null,
          };
        })()`,
        true,
      )
      console.log(
        `[crx-popup] bridge probe ${JSON.stringify(bridgeState)}`,
      )
      if (
        !this.bridgeRecovered &&
        (!bridgeState ||
          bridgeState.runtimeId !== this.extensionId ||
          !bridgeState.tabsQuery ||
          !bridgeState.storageReady)
      ) {
        this.bridgeRecovered = true
        console.log('[crx-popup] bridge unhealthy after load; rebuilding popup once')
        const dead = this.browserWindow
        this.browserWindow = undefined
        if (dead && !dead.isDestroyed()) {
          dead.off('closed', this.destroy)
          dead.destroy()
        }
        // Give Chromium a tick to recycle the bad process before respawning, so
        // the new window negotiates a fresh renderer instead of reusing it.
        setTimeout(() => {
          if (this.destroyed) return
          this.readyPromise = this.spawn()
        }, 50)
        return
      }
    } catch (e: any) {
      console.log(`[crx-popup] bridge probe error: ${e && e.message}`)
    }

    if (this.destroyed) return

    if (this.usingPreferredSize) {
      // Empty documents may not emit preferred-size-changed. Keep that edge
      // case usable without disturbing a real measurement already in flight.
      if (
        this.lastWidth < 0 &&
        !this.pendingPreferredSize &&
        !this.applyingPreferredSize
      ) {
        this.setSize({ width: PopupView.BOUNDS.minWidth, height: PopupView.BOUNDS.minHeight })
        this.show()
      }
    } else {
      // Set large initial size to avoid overflow
      this.setSize({ width: PopupView.BOUNDS.maxWidth, height: PopupView.BOUNDS.maxHeight })

      // Wait for content and layout to load
      await new Promise((resolve) => setTimeout(resolve, 100))
      if (this.destroyed) return

      await this.queryPreferredSize()
      if (this.destroyed) return

      this.show()
    }
  }

  destroy = () => {
    if (this.destroyed) return

    this.destroyed = true

    if (this.preferredSizeTimer) {
      clearTimeout(this.preferredSizeTimer)
      this.preferredSizeTimer = null
    }
    if (this.initialSizeFallbackTimer) {
      clearTimeout(this.initialSizeFallbackTimer)
      this.initialSizeFallbackTimer = null
    }

    debug(`destroying ${this.extensionId}`)

    if (this.parent) {
      if (!this.parent.isDestroyed()) {
        this.parent.off('closed', this.destroy)
      }
      this.parent = undefined
    }

    if (this.browserWindow) {
      if (!this.browserWindow.isDestroyed()) {
        const { webContents } = this.browserWindow

        if (!webContents.isDestroyed() && webContents.isDevToolsOpened()) {
          webContents.closeDevTools()
        }

        this.browserWindow.off('closed', this.destroy)
        this.browserWindow.destroy()
      }

      this.browserWindow = undefined
    }
  }

  isDestroyed() {
    return this.destroyed
  }

  /** Resolves when the popup finishes loading. */
  whenReady() {
    return this.readyPromise
  }
  
  lastWidth = -1
  lastHeight = -1

  private preferredSizeTimer: ReturnType<typeof setTimeout> | null = null
  private initialSizeFallbackTimer: ReturnType<typeof setTimeout> | null = null
  private pendingPreferredSize: Electron.Size | null = null
  private preferredSizeBatchStartedAt = 0
  private applyingPreferredSize = false
  private domReady = false
  private sizingGeneration = 0
  private appliedPreferredSizeHistory: Electron.Size[] = []
  private preferredSizeOscillationLockUntil = 0

  private resetPreferredSizeState() {
    if (this.preferredSizeTimer) clearTimeout(this.preferredSizeTimer)
    if (this.initialSizeFallbackTimer) clearTimeout(this.initialSizeFallbackTimer)
    this.preferredSizeTimer = null
    this.initialSizeFallbackTimer = null
    this.pendingPreferredSize = null
    this.preferredSizeBatchStartedAt = 0
    this.applyingPreferredSize = false
    this.domReady = false
    this.lastWidth = -1
    this.lastHeight = -1
    this.appliedPreferredSizeHistory = []
    this.preferredSizeOscillationLockUntil = 0
    this.hidden = true
    this.sizingGeneration += 1
  }

  setSize(rect: Partial<Electron.Rectangle>): boolean {
    if (!this.browserWindow || !this.parent) return false

    // 向上取整(ceil)：preferred-size-changed 常给出小数尺寸，向下取整会让内容区比
    // 真实内容小不到 1px，触发滚动条并连带挤出另一方向，表现为水平/垂直都显示不全。
    // Windows/Chromium 在窗口重新布局时偶尔会发出 0 宽度的瞬时测量；已有有效尺寸
    // 时保留它，不能让这个无效值把 popup 收缩到最小宽度。
    const widthInput = rect.width && rect.width > 0 ? rect.width : this.lastWidth > 0 ? this.lastWidth : 0
    const heightInput = rect.height && rect.height > 0 ? rect.height : this.lastHeight > 0 ? this.lastHeight : 0
    const width = Math.ceil(
      Math.min(PopupView.BOUNDS.maxWidth, Math.max(widthInput, PopupView.BOUNDS.minWidth))
    )

    const height = Math.ceil(
      Math.min(PopupView.BOUNDS.maxHeight, Math.max(heightInput, PopupView.BOUNDS.minHeight))
    )

    // preferred size 已经向上取整,此处只过滤完全相同的尺寸。不能忽略 1px 差异:
    // 内容区少 1px 也可能触发滚动条。返回是否真的提交了新 bounds。
    if (width === this.lastWidth && height === this.lastHeight) {
      return false
    }
    debug(`setSize`, { width, height })

    this.lastWidth = width
    this.lastHeight = height

    // 尺寸和锚点一次提交。先 setContentSize 再 setContentBounds 会产生两个原生
    // geometry 变更，页面会在中间尺寸完成一次 layout，正是 scrollbar 闪现和
    // preferred-size 回弹的来源。
    this.updatePosition()
    return true
  }

  /**
   * Enlarge the popup window when DevTools is opened (via the "检查" context
   * menu). The popup is normally clamped to its content's preferred size, which
   * leaves no room once DevTools docks inside this frameless window.
   */
  private onDevToolsOpened = () => {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return

    this.devToolsOpened = true

    const DEVTOOLS_WIDTH = 1000
    const DEVTOOLS_HEIGHT = 720

    const current = this.browserWindow.getBounds()
    const { workArea } = screen.getDisplayMatching(current)

    const width = Math.min(DEVTOOLS_WIDTH, workArea.width)
    const height = Math.min(DEVTOOLS_HEIGHT, workArea.height)

    // Keep the enlarged window fully within the screen's work area.
    let x = Math.max(workArea.x, Math.min(current.x, workArea.x + workArea.width - width))
    let y = Math.max(workArea.y, Math.min(current.y, workArea.y + workArea.height - height))

    // 弹窗创建时为 resizable:false / movable:false。Windows 下 Electron 会直接忽略
    // 对“不可缩放/不可移动”窗口的 setBounds 尺寸/位置变更。必须先解锁;且不能在
    // setBounds 之后立刻锁回——同步锁回会把窗口瞬间夹回旧尺寸,表现为“没放大”。
    // 因此 DevTools 打开期间保持可缩放,等 devtools-closed 再恢复锁定。
    this.browserWindow.setResizable(true)
    this.browserWindow.setMovable(true)
    this.browserWindow.setMinimumSize(width, height)
    this.browserWindow.setBounds({ x, y, width, height })

    debug('onDevToolsOpened set bounds', this.browserWindow.getBounds())
  }

  /** Restore the popup's locked, content-sized state after inspection ends. */
  private onDevToolsClosed = () => {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return
    this.devToolsOpened = false
    this.browserWindow.setMinimumSize(PopupView.BOUNDS.minWidth, PopupView.BOUNDS.minHeight)
    this.updatePosition()
    this.browserWindow.setResizable(false)
    this.browserWindow.setMovable(false)
  }

  private maybeClose = () => {
    // Keep open if webContents is being inspected
    if (!this.browserWindow?.isDestroyed() && this.browserWindow?.webContents.isDevToolsOpened()) {
      debug('preventing close due to DevTools being open')
      return
    }

    // Chrome action popups are transient: any focus loss closes the popup,
    // including focus moving to another application. Keeping an unfocused
    // popup alive leaves login UIs on their pre-login route even after the
    // background has persisted the authenticated account.
    this.destroy()
  }

  private updatePosition() {
    if (!this.browserWindow || !this.parent) return

    // 尚未确定尺寸时不应定位(弹窗此时也隐藏);避免拿到 -1 的占位值。
    if (this.lastWidth < 0 || this.lastHeight < 0) return

    // anchorRect 来自渲染进程的 getBoundingClientRect，坐标基于父窗口的网页内容区。
    // 保持 content bounds 原点与 Chromium action popup 一致；Windows 在窗口切换/隐藏
    // 期间偶尔会返回无效的 content bounds，此时才回退到 window bounds，避免弹窗落到屏幕外。
    const contentBounds = this.parent.getContentBounds()
    const windowBounds = this.parent.getBounds()
    const isValidBounds = (bounds: Electron.Rectangle) =>
      Number.isFinite(bounds.x) &&
      Number.isFinite(bounds.y) &&
      Number.isFinite(bounds.width) &&
      Number.isFinite(bounds.height) &&
      bounds.width > 0 &&
      bounds.height > 0 &&
      Math.abs(bounds.x) < 10_000_000 &&
      Math.abs(bounds.y) < 10_000_000
    const windowBoundsValid = isValidBounds(windowBounds)
    // A stale Windows content rectangle can still be finite (for example
    // -20321,-21310), so finite/range checks alone are insufficient. Content
    // and window origins should differ only by the native frame thickness.
    const contentBoundsUsable =
      isValidBounds(contentBounds) &&
      (!windowBoundsValid ||
        (Math.abs(contentBounds.x - windowBounds.x) < 4096 &&
          Math.abs(contentBounds.y - windowBounds.y) < 4096))
    const winBounds = contentBoundsUsable
      ? contentBounds
      : windowBoundsValid
        ? windowBounds
        : {x: 0, y: 0, width: 1, height: 1}

    // 直接用最近一次计算出的 lastWidth/lastHeight,而不是回读 getContentBounds():
    // frameless 不可缩放窗口在 Windows 上反复读内容边界会因
    // 不可见缩放边框/滚动条核算而逐帧漂移(日志里 x 每步 +14 的横向闪动来源)。
    const width = this.lastWidth
    const height = this.lastHeight

    // TODO: support more orientations than just top-right
    let x = winBounds.x + this.anchorRect.x + this.anchorRect.width - width
    let y = winBounds.y + this.anchorRect.y + this.anchorRect.height + PopupView.POSITION_PADDING

    // Convert to ints
    x = Math.floor(x)
    y = Math.floor(y)

    // Chrome keeps action popups inside the display work area. Besides matching
    // that behavior, clamping protects against stale renderer coordinates and
    // transient invalid parent bounds during window state restoration.
    try {
      const {workArea} = screen.getDisplayMatching({
        x: winBounds.x,
        y: winBounds.y,
        width: Math.max(1, winBounds.width),
        height: Math.max(1, winBounds.height),
      })
      const maxX = Math.max(workArea.x, workArea.x + workArea.width - width)
      const maxY = Math.max(workArea.y, workArea.y + workArea.height - height)
      x = Math.max(workArea.x, Math.min(x, maxX))
      y = Math.max(workArea.y, Math.min(y, maxY))
    } catch {
      // Keep the calculated position if display metrics are unavailable.
    }

    debug(`updatePosition`, { x, y })

    this.browserWindow.setContentBounds({ x, y, width, height })
  }

  /** Backwards compat for Electron <12 */
  private async queryPreferredSize() {
    if (this.usingPreferredSize || this.destroyed) return

    const rect = await this.browserWindow!.webContents.executeJavaScript(
      `((${() => {
        const rect = document.body.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      }})())`
    )

    if (this.destroyed) return

    this.setSize({ width: rect.width, height: rect.height })
  }

  private scheduleInitialSizeFallback() {
    if (this.initialSizeFallbackTimer) clearTimeout(this.initialSizeFallbackTimer)
    this.initialSizeFallbackTimer = setTimeout(() => {
      this.initialSizeFallbackTimer = null
      void this.showUsingFallbackSize()
    }, PopupView.INITIAL_SIZE_FALLBACK_MS)
  }

  private async showUsingFallbackSize() {
    if (this.destroyed || !this.hidden || !this.browserWindow) return
    const generation = this.sizingGeneration
    const win = this.browserWindow

    if (this.lastWidth > 0 && this.lastHeight > 0) {
      this.show()
      return
    }

    let size: Electron.Size = PopupView.FALLBACK_SIZE
    try {
      size = await Promise.race([
        this.measurePreferredSizeWithDebugger(win),
        new Promise<Electron.Size>((_resolve, reject) => {
          setTimeout(
            () => reject(new Error('popup preferred-size fallback timed out')),
            PopupView.FALLBACK_MEASURE_TIMEOUT_MS,
          )
        }),
      ])
    } catch (error) {
      debug('[crx-popup] preferred-size fallback failed', error)
    }

    if (
      this.destroyed ||
      !this.hidden ||
      generation !== this.sizingGeneration ||
      this.browserWindow !== win ||
      win.isDestroyed()
    ) {
      return
    }

    if (this.preferredSizeTimer) {
      clearTimeout(this.preferredSizeTimer)
      this.preferredSizeTimer = null
    }
    this.pendingPreferredSize = null
    this.preferredSizeBatchStartedAt = 0
    debug('[crx-popup] showing with measured fallback size', size)
    this.setSize(size)
    this.show()
  }

  /**
   * Measure through CDP rather than executeJavaScript. The latter shares the
   * broken renderer bridge in the sandbox failure mode that needs this fallback.
   */
  private async installRootScrollbarGuardWithDebugger(win: BrowserWindow) {
    const debuggerApi = win.webContents.debugger
    let attachedHere = false

    try {
      if (!debuggerApi.isAttached()) {
        debuggerApi.attach('1.3')
        attachedHere = true
      }
      await debuggerApi.sendCommand('Runtime.evaluate', {
        expression: `(() => {
          if (document.getElementById('rainsee-popup-scrollbar-guard')) return;
          const style = document.createElement('style');
          style.id = 'rainsee-popup-scrollbar-guard';
          style.textContent = '@media (max-width: 799px) and (max-height: 599px) { :root { scrollbar-width: none !important; } :root::-webkit-scrollbar { width: 0 !important; height: 0 !important; } }';
          (document.head || document.documentElement).appendChild(style);
        })()`,
      })
    } finally {
      if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach()
    }
  }

  private async measurePreferredSizeWithDebugger(win: BrowserWindow): Promise<Electron.Size> {
    const debuggerApi = win.webContents.debugger
    let attachedHere = false

    try {
      if (!debuggerApi.isAttached()) {
        debuggerApi.attach('1.3')
        attachedHere = true
      }

      const response: any = await debuggerApi.sendCommand('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const root = document.documentElement;
          const body = document.body;
          if (!root || !body) return { width: 0, height: 0 };
          const existing = globalThis.__rainseePopupAutosize;
          if (existing) return existing.measure();

          const marker = ${JSON.stringify(PopupView.FALLBACK_SIZE_MESSAGE)};
          let mutationObserver;
          let resizeObserver;
          let timer = 0;
          let measuring = false;
          let lastSize = '';

          const observe = () => {
            mutationObserver.observe(root, {
              subtree: true,
              childList: true,
              characterData: true,
              attributes: true,
              attributeFilter: ['class', 'style', 'hidden', 'open'],
            });
            resizeObserver.observe(body);
          };

          const measure = () => {
            if (measuring) return null;
            measuring = true;
            mutationObserver?.disconnect();
            resizeObserver?.disconnect();
            const rootStyle = root.getAttribute('style');
            const bodyStyle = body.getAttribute('style');
            const computed = getComputedStyle(body);
            const number = (value) => {
              const parsed = parseFloat(value);
              return Number.isFinite(parsed) ? parsed : 0;
            };
            const marginWidth = number(computed.marginLeft) + number(computed.marginRight);
            const marginHeight = number(computed.marginTop) + number(computed.marginBottom);

            try {
              for (const element of [root, body]) {
                element.style.setProperty('width', 'max-content', 'important');
                element.style.setProperty('height', 'max-content', 'important');
                element.style.setProperty('min-width', '0', 'important');
                element.style.setProperty('min-height', '0', 'important');
                element.style.setProperty('overflow', 'hidden', 'important');
              }
              const rect = body.getBoundingClientRect();
              return {
                width: Math.max(body.scrollWidth, body.offsetWidth, rect.width) + marginWidth,
                height: Math.max(body.scrollHeight, body.offsetHeight, rect.height) + marginHeight,
              };
            } finally {
              if (rootStyle === null) root.removeAttribute('style');
              else root.setAttribute('style', rootStyle);
              if (bodyStyle === null) body.removeAttribute('style');
              else body.setAttribute('style', bodyStyle);
              void root.offsetWidth;
              measuring = false;
              requestAnimationFrame(observe);
            }
          };

          const report = () => {
            timer = 0;
            const size = measure();
            if (!size) return;
            const serialized = JSON.stringify(size);
            if (serialized === lastSize) return;
            lastSize = serialized;
            console.debug(marker + serialized);
          };
          const schedule = (delay = 40) => {
            clearTimeout(timer);
            timer = setTimeout(report, delay);
          };
          const scheduleInteraction = () => {
            schedule(0);
            setTimeout(schedule, 100);
            setTimeout(schedule, 300);
          };

          mutationObserver = new MutationObserver(() => schedule());
          resizeObserver = new ResizeObserver(() => schedule());
          document.addEventListener('click', scheduleInteraction, true);
          document.addEventListener('input', scheduleInteraction, true);
          document.addEventListener('change', scheduleInteraction, true);
          document.addEventListener('transitionend', () => schedule(0), true);
          document.addEventListener('animationend', () => schedule(0), true);
          window.addEventListener('load', () => schedule(0), { once: true });
          document.fonts?.ready.then(() => schedule(0));

          const initialSize = measure();
          lastSize = JSON.stringify(initialSize);
          globalThis.__rainseePopupAutosize = { measure, schedule };
          return initialSize;
        })()`,
      })

      const value = response?.result?.value
      if (
        !value ||
        !Number.isFinite(value.width) ||
        !Number.isFinite(value.height) ||
        value.width < 0 ||
        value.height < 0
      ) {
        throw new Error('popup preferred-size fallback returned invalid bounds')
      }
      return { width: value.width, height: value.height }
    } finally {
      if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach()
    }
  }

  private updatePreferredSize = (_event: Electron.Event, size: Electron.Size) => {
    this.usingPreferredSize = true
    debug('[crx-popup] preferred-size-changed', size)

    // While DevTools is open the window is intentionally enlarged for
    // inspection; don't let the content's preferred size shrink it back.
    if (this.devToolsOpened) {
      if (this.hidden) this.show()
      return
    }

    this.queuePreferredSize(size)
  }

  private onFallbackSizeMessage(message: string) {
    try {
      const size = JSON.parse(message.slice(PopupView.FALLBACK_SIZE_MESSAGE.length))
      if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) return
      debug('[crx-popup] observed fallback size', size)
      this.queuePreferredSize(size)
    } catch (error) {
      debug('[crx-popup] invalid fallback size message', error)
    }
  }

  private queuePreferredSize(size: Electron.Size) {
    if (this.devToolsOpened) return

    // A preferred-size-changed event with a zero dimension is a transient
    // Chromium measurement during reflow (the FlowPick popup emits width=0
    // immediately after its valid 500px measurement). Preserve the last valid
    // dimension so it cannot collapse an already visible popup.
    const widthValid = Number.isFinite(size.width) && size.width > 0
    const heightValid = Number.isFinite(size.height) && size.height > 0
    if (
      !widthValid &&
      this.lastWidth <= 0 &&
      !heightValid &&
      this.lastHeight <= 0
    ) {
      // Do not turn an entirely invalid initial measurement into a minimum
      // popup; a later event or the DOM/CDP fallback will establish its size.
      return
    }
    const preferredSize = {
      width:
        widthValid
          ? size.width
          : this.lastWidth > 0
            ? this.lastWidth
            : 0,
      height:
        heightValid
          ? size.height
          : this.lastHeight > 0
            ? this.lastHeight
            : 0,
    }
    const width = this.clampWidth(preferredSize.width)
    const height = this.clampHeight(preferredSize.height)
    const now = Date.now()

    if (now < this.preferredSizeOscillationLockUntil) {
      // The size that won the oscillation is still being reported. It proves
      // the page is continuing the old feedback loop, so drop any pending
      // smaller measurement before it can be applied at the lock boundary.
      if (width === this.lastWidth && height === this.lastHeight) {
        this.pendingPreferredSize = null
        this.preferredSizeBatchStartedAt = 0
        if (this.preferredSizeTimer) {
          clearTimeout(this.preferredSizeTimer)
          this.preferredSizeTimer = null
        }
        return
      }

      const widthDelta = Math.abs(width - this.lastWidth)
      const heightDelta = Math.abs(height - this.lastHeight)
      if (
        widthDelta < PopupView.PREFERRED_SIZE_LOCK_BREAK_THRESHOLD_PX &&
        heightDelta < PopupView.PREFERRED_SIZE_LOCK_BREAK_THRESHOLD_PX
      ) {
        // A smaller report may be a real later shrink. Keep it pending, but
        // apply it only if the competing size does not return before the lock
        // expires.
        this.pendingPreferredSize = preferredSize
        this.preferredSizeBatchStartedAt = now
        this.schedulePreferredSizeAfterOscillationLock()
        return
      }

      this.preferredSizeOscillationLockUntil = 0
    }

    // A scrollbar appearing at the Chrome limit may change the reported raw
    // preferred size, but not the clamped window bounds. Do not feed that
    // layout-only change back into BrowserWindow.
    if (
      !this.pendingPreferredSize &&
      width === this.lastWidth &&
      height === this.lastHeight
    ) {
      return
    }

    if (!this.preferredSizeBatchStartedAt) this.preferredSizeBatchStartedAt = Date.now()
    this.pendingPreferredSize = preferredSize
    if (this.domReady) this.schedulePreferredSize()
  }

  private clampWidth(width: number) {
    return Math.ceil(
      Math.min(PopupView.BOUNDS.maxWidth, Math.max(width, PopupView.BOUNDS.minWidth)),
    )
  }

  private clampHeight(height: number) {
    return Math.ceil(
      Math.min(PopupView.BOUNDS.maxHeight, Math.max(height, PopupView.BOUNDS.minHeight)),
    )
  }

  private schedulePreferredSize() {
    if (this.preferredSizeTimer) clearTimeout(this.preferredSizeTimer)
    const elapsed = this.preferredSizeBatchStartedAt
      ? Date.now() - this.preferredSizeBatchStartedAt
      : 0
    const delay = Math.max(
      0,
      Math.min(
        PopupView.PREFERRED_SIZE_SETTLE_MS,
        PopupView.PREFERRED_SIZE_MAX_WAIT_MS - elapsed,
      ),
    )
    this.preferredSizeTimer = setTimeout(() => {
      this.preferredSizeTimer = null
      void this.applyPreferredSize()
    }, delay)
  }

  private schedulePreferredSizeAfterOscillationLock() {
    if (this.preferredSizeTimer) clearTimeout(this.preferredSizeTimer)
    const delay = Math.max(0, this.preferredSizeOscillationLockUntil - Date.now())
    this.preferredSizeTimer = setTimeout(() => {
      this.preferredSizeTimer = null
      void this.applyPreferredSize()
    }, delay)
  }

  private hasPreferredSizeOscillation(size: Electron.Size) {
    if (this.appliedPreferredSizeHistory.length < 2) return false

    const previous = this.appliedPreferredSizeHistory[this.appliedPreferredSizeHistory.length - 1]
    const beforePrevious = this.appliedPreferredSizeHistory[this.appliedPreferredSizeHistory.length - 2]
    const returnsToPrevious =
      size.width === beforePrevious.width && size.height === beforePrevious.height
    const differsFromCurrent = size.width !== previous.width || size.height !== previous.height

    return returnsToPrevious && differsFromCurrent
  }

  private recordAppliedPreferredSize() {
    this.appliedPreferredSizeHistory.push({
      width: this.lastWidth,
      height: this.lastHeight,
    })
    if (this.appliedPreferredSizeHistory.length > 3) {
      this.appliedPreferredSizeHistory.shift()
    }
  }

  private async applyPreferredSize() {
    if (this.applyingPreferredSize || this.destroyed || !this.browserWindow) return
    const generation = this.sizingGeneration
    const win = this.browserWindow
    this.applyingPreferredSize = true

    try {
      // CSS changes and async page work can report a newer preferred size while
      // the scrollbar mode is being switched. Always commit only the newest
      // candidate, never an intermediate viewport-dependent measurement.
      while (
        this.pendingPreferredSize &&
        !this.destroyed &&
        generation === this.sizingGeneration &&
        this.browserWindow === win
      ) {
        const size = this.pendingPreferredSize
        this.pendingPreferredSize = null
        const clampedSize = {
          width: this.clampWidth(size.width),
          height: this.clampHeight(size.height),
        }

        if (this.hasPreferredSizeOscillation(clampedSize)) {
          const previous = this.appliedPreferredSizeHistory[
            this.appliedPreferredSizeHistory.length - 1
          ]
          const lockedSize = {
            width: Math.max(clampedSize.width, previous.width),
            height: Math.max(clampedSize.height, previous.height),
          }
          this.setSize(lockedSize)
          this.appliedPreferredSizeHistory = [
            { width: this.lastWidth, height: this.lastHeight },
          ]
          this.preferredSizeOscillationLockUntil =
            Date.now() + PopupView.PREFERRED_SIZE_OSCILLATION_LOCK_MS
          debug('[crx-popup] preferred-size oscillation locked', lockedSize)
        } else if (this.setSize(clampedSize)) {
          this.recordAppliedPreferredSize()
        }
        this.preferredSizeBatchStartedAt = 0
      }

      // Wait to reveal the popup until both scrollbar mode and final content
      // bounds have been committed.
      if (
        generation === this.sizingGeneration &&
        this.browserWindow === win &&
        this.hidden &&
        this.lastWidth > 0 &&
        this.lastHeight > 0
      ) {
        this.show()
      }
    } finally {
      if (generation === this.sizingGeneration) {
        this.applyingPreferredSize = false
        if (this.pendingPreferredSize && !this.preferredSizeTimer) {
          this.schedulePreferredSize()
        }
      }
    }
  }
}
