import {BrowserWindow, ipcRenderer, screen, Session, app} from 'electron'
import * as path from 'path'
import {getViewMenu} from "~/main/menus/extension-popup";
import {Application} from "~/main/application";
import {postBodyToLoadOptions} from "~/main/utils/post-body";

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
    minWidth: 200,
    minHeight: 150,
    maxWidth: 800,
    maxHeight: 600,
  }

  /** preferred-size-changed 在布局稳定前会密集连发(异步数据/滚动条进出/子像素取整
   *  都会触发)。去抖窗口,期间连发全部合并,只留首帧 + 停顿后的尾沿各一次。 */
  static readonly PREFERRED_SIZE_DEBOUNCE_MS = 80
  /** 两次真正 applyPreferredSize 之间的最小间隔(节流)。preferred-size-changed 可达每帧
   *  一次,逐帧 setSize+定位既是闪动本身,也扰动页面布局。节流把 apply 频率压到人眼不敏感
   *  以下,停顿后的尾沿去抖仍会补上最终值。 */
  static readonly APPLY_MIN_INTERVAL_MS = 120
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
    this.tabs = opts.tabs || []

    this.readyPromise = this.spawn()
  }

  /**
   * Build the popup BrowserWindow, wire its events, and load the URL.
   * Extracted from the constructor so a crashed renderer can be recovered by
   * tearing the window down and calling spawn() again (see render-process-gone).
   */
  private spawn(): Promise<void> {
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
            const loadOptions = postBodyToLoadOptions(details.postBody);
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

    // PRIMARY channel: append the tab snapshot to the URL hash. The hash is part
    // of the page load itself (available before any script runs, no main→renderer
    // IPC), so it survives the sandboxed-renderer state that breaks both the
    // session preload AND executeJavaScript. The SHIM parses `crxbridge=` out of
    // location.hash at startup and sets globalThis.__crxTabs. executeJavaScript
    // (above) is the belt-and-suspenders backup. AdGuard's popup doesn't read
    // location.hash (verified), so appending is safe.
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

    // Bridge recovery. When the popup renderer gets co-sited with a sandboxed
    // host process (e.g. a running MV3 service worker of the same chrome-
    // extension:// origin), the frame-type crx-preload registered on the session
    // is silently skipped (`binding.startupData === null` → "sandboxed_renderer
    // .bundle.js script failed to run"), so `globalThis.electron` (the IPC bridge
    // crx-preload installs) never lands. Every chrome.* call in the popup then
    // either throws or falls back to Electron's NATIVE impl (tabs.query returns
    // the wrong registry, storage.sync is missing, …) — e.g. the AdGuard popup
    // sits forever on "Loading" because tabs.query({active:true}) can't resolve
    // the current site. The SHIM (prepended to every ext JS file) still runs, so
    // probe the bridge AND the SHIM's yujianobjtest marker: if the SHIM ran but
    // electron is undefined, crx-preload was skipped. Rebuild the window ONCE to
    // force a fresh renderer process (new negotiation → proper startupData →
    // crx-preload runs). reload() is useless here — it reuses the same broken
    // process. Mirrors the vendor popup (browser/popup.ts) recovery.
    try {
      const bridgeState = await win.webContents.executeJavaScript(
        `(() => ({ electronType: typeof globalThis.electron, shim: globalThis.yujianobjtest ?? null }))()`,
        true,
      )
      console.log(
        `[crx-popup] bridge probe electronType=${bridgeState && bridgeState.electronType} shim=${bridgeState && bridgeState.shim}`,
      )
      if (
        !this.bridgeRecovered &&
        (!bridgeState || bridgeState.electronType === 'undefined')
      ) {
        this.bridgeRecovered = true
        console.log('[crx-popup] bridge missing after load; rebuilding popup once')
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
      // preferred-size-changed 通常在 loadURL resolve 前就已到达并完成首次定尺/显示。
      // 此时再重置到最小尺寸会产生一次 350→200→365 的明显闪动,还会重新触发滚动条
      // reflow。仅在尚未收到任何尺寸时设置隐藏窗口的初始值。
      if (this.lastWidth < 0) {
        this.setSize({ width: PopupView.BOUNDS.minWidth, height: PopupView.BOUNDS.minHeight })
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
  
  lastWidth = -1;
  lastHeight = -1;

  /** 去抖句柄 + 最近一次测量值,供 preferred-size-changed 合并连发。 */
  private preferredSizeTimer: ReturnType<typeof setTimeout> | null = null
  private pendingPreferredSize: Electron.Size | null = null
  /** 同一次 popup 展示过程中只增不减的 preferred size。关闭后 PopupView 实例销毁,
   *  下次打开重新测量。这样 248↔263 或其他 reflow 循环只会采用其中的最大值。 */
  private maxPreferredWidth = 0
  private maxPreferredHeight = 0
  /** 上一次 applyPreferredSize 真正生效的时刻,用于节流。 */
  private lastApplyAt = 0

  setSize(rect: Partial<Electron.Rectangle>): boolean {
    if (!this.browserWindow || !this.parent) return false

    // 向上取整(ceil)：preferred-size-changed 常给出小数尺寸，向下取整会让内容区比
    // 真实内容小不到 1px，触发滚动条并连带挤出另一方向，表现为水平/垂直都显示不全。
    const width = Math.ceil(
      Math.min(PopupView.BOUNDS.maxWidth, Math.max(rect.width || 0, PopupView.BOUNDS.minWidth))
    )

    const height = Math.ceil(
      Math.min(PopupView.BOUNDS.maxHeight, Math.max(rect.height || 0, PopupView.BOUNDS.minHeight))
    )

    // preferred size 已经向上取整,此处只过滤完全相同的尺寸。不能忽略 1px 差异:
    // 内容区少 1px 也可能触发滚动条,而历史最大值随后不会再次产生同一尺寸事件。
    // 返回是否真的改了尺寸,调用方据此决定是否重新定位。
    if (width === this.lastWidth && height === this.lastHeight) {
      return false
    }
    this.lastWidth = width
    this.lastHeight = height

    debug(`setSize`, { width, height })

    // 必须用 setContentSize 设置“内容区(网页)”尺寸而非整窗 setBounds，否则 Windows
    // 下 frameless 窗口的非客户区(不可见缩放边框)会被算进去，导致弹窗宽高偏大、不精准。
    this.browserWindow.setContentSize(width, height)
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
    this.browserWindow.setResizable(false)
    this.browserWindow.setMovable(false)
  }

  private maybeClose = () => {
    // Keep open if webContents is being inspected
    if (!this.browserWindow?.isDestroyed() && this.browserWindow?.webContents.isDevToolsOpened()) {
      debug('preventing close due to DevTools being open')
      return
    }

    // For extension popups with a login form, the user may need to access a
    // program outside of the app. Closing the popup would then add
    // inconvenience.
    if (!BrowserWindow.getFocusedWindow()) {
      debug('preventing close due to focus residing outside of the app')
      return
    }

    this.destroy()
  }

  private updatePosition() {
    if (!this.browserWindow || !this.parent) return

    // 尚未确定尺寸时不应定位(弹窗此时也隐藏);避免拿到 -1 的占位值。
    if (this.lastWidth < 0 || this.lastHeight < 0) return

    // anchorRect 来自渲染进程的 getBoundingClientRect，坐标基于父窗口的网页内容区，
    // 因此这里统一用 content bounds 计算与定位，避免把窗口不可见边框算进去导致偏移。
    const winBounds = this.parent.getContentBounds()

    // 直接用最近一次 setContentSize 写入的 lastWidth/lastHeight,而不是回读
    // getContentBounds():frameless 不可缩放窗口在 Windows 上反复读内容边界会因
    // 不可见缩放边框/滚动条核算而逐帧漂移(日志里 x 每步 +14 的横向闪动来源)。
    const width = this.lastWidth
    const height = this.lastHeight

    // TODO: support more orientations than just top-right
    let x = winBounds.x + this.anchorRect.x + this.anchorRect.width - width
    let y = winBounds.y + this.anchorRect.y + this.anchorRect.height + PopupView.POSITION_PADDING

    // Convert to ints
    x = Math.floor(x)
    y = Math.floor(y)

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

    const changed = this.setSize({ width: rect.width, height: rect.height })
    if (changed) this.updatePosition()
  }

  private updatePreferredSize = (_event: Electron.Event, size: Electron.Size) => {
    this.usingPreferredSize = true

    // While DevTools is open the window is intentionally enlarged for
    // inspection; don't let the content's preferred size shrink it back.
    if (this.devToolsOpened) {
      if (this.hidden) this.show()
      return
    }

    const previousMaxWidth = this.maxPreferredWidth
    const previousMaxHeight = this.maxPreferredHeight
    if (size.width > 0) this.maxPreferredWidth = Math.max(this.maxPreferredWidth, size.width)
    if (size.height > 0) this.maxPreferredHeight = Math.max(this.maxPreferredHeight, size.height)
    const maxChanged =
      this.maxPreferredWidth !== previousMaxWidth ||
      this.maxPreferredHeight !== previousMaxHeight
    if (maxChanged) {
      debug('updatePreferredSize max', {
        width: this.maxPreferredWidth,
        height: this.maxPreferredHeight,
      })
    }
    // 没有刷新历史最大值时窗口目标尺寸必然不变。不要让 248↔263 中较小的一侧
    // 持续重置 debounce 或进入 setSize,达到最大值后整个反馈链立即静默。
    if (!maxChanged) return

    this.pendingPreferredSize = size

    // 首帧:窗口尚未确定尺寸,立即应用让弹窗尽快显示,节流/锁均不生效。
    if (this.lastWidth < 0) {
      this.applyPreferredSize()
      this.schedulePreferredSizeTail()
      return
    }

    const now = Date.now()

    if (now - this.lastApplyAt < PopupView.APPLY_MIN_INTERVAL_MS) {
      // 节流:距上次 apply 太近,只更新 pending,靠 tail 兜底。
      this.schedulePreferredSizeTail()
      return
    }

    this.applyPreferredSize()
    this.schedulePreferredSizeTail()
  }

  /** 尾沿去抖:停顿后补一次最终值。 */
  private schedulePreferredSizeTail() {
    if (this.preferredSizeTimer) clearTimeout(this.preferredSizeTimer)
    this.preferredSizeTimer = setTimeout(() => {
      this.preferredSizeTimer = null
      this.applyPreferredSize()
    }, PopupView.PREFERRED_SIZE_DEBOUNCE_MS)
  }

  private applyPreferredSize() {
    if (this.destroyed || !this.browserWindow) return
    const size = this.pendingPreferredSize
    if (!size) return

    const now = Date.now()
    // Chrome 让扩展 popup 按其 HTML 声明的 preferred size 显示,宿主不额外加
    // padding。之前硬加固定宽度会在按内容定宽的 popup(Dark Reader/uBlock/油猴等)
    // 右侧产生永久白边。width:0 时退回 lastWidth,避免基于 0 重复累加。高度保持
    // 内容历史最大值。
    const width = this.maxPreferredWidth > 0 ? this.maxPreferredWidth : this.lastWidth
    const height = this.maxPreferredHeight > 0 ? this.maxPreferredHeight : this.lastHeight

    const changed = this.setSize({ width, height })
    // 仅在窗口尺寸真正变化时重新定位;尺寸未变却重新定位正是横向漂移的来源。
    if (changed) this.updatePosition()
    this.lastApplyAt = now

    // Wait to reveal popup until it's sized and positioned correctly
    if (this.hidden) this.show()
  }
}
