import { EventEmitter } from 'node:events'
import { app, BrowserWindow, Session, screen } from 'electron'
import { join } from 'node:path'
import debug from 'debug'

const d = debug('electron-chrome-extensions:popup')

export interface PopupAnchorRect {
  x: number
  y: number
  width: number
  height: number
}

interface PopupViewOptions {
  extensionId: string
  session: Session
  parent: Electron.BaseWindow
  url: string
  anchorRect: PopupAnchorRect
  alignment?: string
  /**
   * Snapshot of the host's real tab list, handed to the popup so chrome.tabs
   * .query can resolve the active site even when crx-preload is skipped.
   *
   * MV2 page_action popups reach this PopupView via activateClick (the renderer
   * routes them through dispatchActionClick because the toolbar model has no
   * `popup` for page_action). Electron can co-site that popup with the
   * extension's persistent background page; the shared sandboxed renderer then
   * boots with `binding.startupData === null`, the session's frame-type
   * crx-preload is silently dropped, and without the electron bridge the SHIM's
   * tabs.query falls back to globalThis.__crxTabs. If nobody injects it the
   * popup sees "no active tab". Injected via executeJavaScript + the URL hash
   * (see load), both of which survive the sandboxed renderer. Optional — older
   * call sites don't pass it.
   */
  tabs?: any[]
}

const supportsPreferredSize = () => {
  const major = parseInt(process.versions.electron.split('.').shift() || '', 10)
  return major >= 12
}

export class PopupView extends EventEmitter {
  static POSITION_PADDING = 5

  static BOUNDS = {
    minWidth: 200,
    minHeight: 150,
    maxWidth: 800,
    maxHeight: 600,
  }

  browserWindow?: BrowserWindow
  parent?: Electron.BaseWindow
  extensionId: string

  private anchorRect: PopupAnchorRect
  private destroyed: boolean = false
  private hidden: boolean = true
  private alignment?: string
  private devToolsOpened: boolean = false
  private bridgeRecovered: boolean = false
  private session: Session
  private url: string
  /** Host tab snapshot injected into the popup (see load). */
  private tabs: any[]
  private lastWidth = -1
  private lastHeight = -1

  /** Preferred size changes are only received in Electron v12+ */
  private usingPreferredSize = supportsPreferredSize()
  /** True once Chromium has supplied a content preferred size for this load. */
  private preferredSizeReceived = false

  private readyPromise: Promise<void>

  constructor(opts: PopupViewOptions) {
    super()

    this.parent = opts.parent
    this.extensionId = opts.extensionId
    this.anchorRect = opts.anchorRect
    this.alignment = opts.alignment
    this.session = opts.session
    this.url = opts.url
    this.tabs = (opts.tabs || []).map((tab) => ({
      ...tab,
      // Chrome always exposes groupId on tabs.Tab; ungrouped tabs use -1.
      groupId: typeof tab?.groupId === 'number' ? tab.groupId : -1,
    }))
    this.readyPromise = this.spawn()
  }

  private spawn(): Promise<void> {
    this.preferredSizeReceived = false
    this.lastWidth = -1
    this.lastHeight = -1
    this.browserWindow = new BrowserWindow({
      show: false,
      frame: false,
      parent: this.parent,
      movable: false,
      maximizable: false,
      minimizable: false,
      // https://github.com/electron/electron/issues/47579
      fullscreenable: false,
      resizable: false,
      skipTaskbar: true,
      backgroundColor: '#ffffff',
      roundedCorners: false,
      webPreferences: {
        session: this.session,
        // Use the same classic preload as the host popup. The session-registered
        // extension preload can be skipped when Electron co-sites a popup with a
        // sandboxed extension process; webPreferences.preload survives that path
        // and is idempotent with the session preload.
        preload: join(app.getAppPath(), 'build', 'crx-preload.bundle.js'),
        // sandbox MUST stay false here. With sandbox:true on Electron 42 the
        // sandboxed renderer bootstrap can come up with `binding.startupData`
        // === null, so the session's registered crx-preload (frame type) is
        // silently skipped (`sandboxed_renderer.bundle.js script failed to run`
        // / "Cannot destructure property 'preloadScripts' of binding.startupData
        // as it is null"). Without crx-preload the page gets Electron's NATIVE
        // chrome object, whose chrome.storage has only `local` (no `sync`/
        // `managed`) -> extensions like Immersive Translate throw '"sync" is not
        // available in this instance of Chrome'. Running unsandboxed lets
        // crx-preload run and apply the storage factory that maps sync->local.
        // Every other extension context in this app (view.ts, extension-popup,
        // dialogs/popup) is already sandbox:false for the same reason.
        sandbox: false,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        // contextIsolation MUST stay false here, matching the app's own popup
        // (src/main/dialogs/popup.ts) and every other extension page context.
        // With contextIsolation:true on Electron 42 the popup renderer
        // intermittently boots sandboxed with `binding.startupData === null`
        // ("sandboxed_renderer.bundle.js script failed to run"), so crx-preload's
        // `contextBridge.executeInMainWorld` injection is silently skipped and
        // the page gets the NATIVE `chrome` — missing our overrides AND whole
        // namespaces (e.g. chrome.permissions), which crashes extension popups
        // (dessant search-by-image's commons-ui: "Cannot read properties of
        // undefined (reading 'contains')" from chrome.permissions.contains).
        // With contextIsolation:false the preload takes the non-isolated branch
        // and runs mainWorldScript() DIRECTLY in the shared world (capturing the
        // electronContext closure for IPC), which injects chrome.* reliably.
        contextIsolation: false,
        enablePreferredSizeMode: true,
      },
    })

    const untypedWebContents = this.browserWindow.webContents as any
    untypedWebContents.on('preferred-size-changed', this.updatePreferredSize)

    this.browserWindow.webContents.on('devtools-opened', this.onDevToolsOpened)
    this.browserWindow.webContents.on('devtools-closed', this.onDevToolsClosed)
    this.browserWindow.webContents.on('devtools-closed', this.maybeClose)
    this.browserWindow.on('blur', this.maybeClose)
    this.browserWindow.on('closed', this.destroy)
    this.parent.once('closed', this.destroy)
    this.browserWindow.webContents.on('render-process-gone', (_event, details) => {
      if (this.destroyed || this.bridgeRecovered) return
      if (details.reason === 'clean-exit') return
      this.bridgeRecovered = true
      d(`popup renderer gone (${details.reason}); rebuilding window once`)
      const dead = this.browserWindow
      this.browserWindow = undefined
      if (dead && !dead.isDestroyed()) {
        dead.off('closed', this.destroy)
        dead.destroy()
      }
      setTimeout(() => {
        if (this.destroyed) return
        this.readyPromise = this.spawn()
      }, 50)
    })
    return this.load(this.url)
  }

  private show() {
    this.hidden = false
    this.browserWindow?.show()
  }

  private async load(url: string): Promise<void> {
    const win = this.browserWindow!

    // Inject the host's real tab list so chrome.tabs.query({active:true}) can
    // resolve the current site even when crx-preload is skipped. This PopupView
    // is the one MV2 page_action popups open into (via activateClick); Electron
    // can co-site it with the extension's persistent background page, and that
    // sandboxed renderer drops the frame-type crx-preload (binding.startupData
    // === null) → no electron bridge → the SHIM's tabs.query falls back to
    // globalThis.__crxTabs. Without this injection the popup reports "no active
    // tab". Mirrors src/main/dialogs/popup.ts. executeJavaScript is a main-
    // process API that survives the sandbox; the URL hash is available before
    // any script runs. __crxTabs is additive and only read as a fallback.
    const injectTabs = (when: string) => {
      if (this.destroyed || !this.browserWindow) return
      const wc = this.browserWindow.webContents
      if (!wc || wc.isDestroyed()) return
      if (!this.tabs.length) return
      d(`injectTabs(${when}) n=${this.tabs.length}`)
      const payload = JSON.stringify(this.tabs)
      const code = `try{globalThis.__crxTabs=${payload};try{localStorage.setItem('__crxTabs_lsinjected',${payload});localStorage.setItem('__crxTabs_lsinjected_at',String(Date.now()))}catch(_){}}catch(e){}`
      wc.executeJavaScript(code, true).catch(() => undefined)
    }
    win.webContents.once('dom-ready', () => injectTabs('dom-ready'))
    win.webContents.once('did-finish-load', () => injectTabs('did-finish-load'))

    // PRIMARY channel: append a transient snapshot to the URL hash. It is
    // available before any script runs (no main→renderer IPC), even when the
    // sandbox delays executeJavaScript. The first injected SHIM caches a valid
    // `crxbridge=` payload and removes only that segment with replaceState
    // before extension hash routers initialize.
    let loadUrl = url
    if (this.tabs.length && url.indexOf('crxbridge=') === -1) {
      const sep = url.indexOf('#') === -1 ? '#' : '&'
      loadUrl = url + sep + 'crxbridge=' + encodeURIComponent(JSON.stringify(this.tabs))
    }

    try {
      await win.webContents.loadURL(loadUrl)
    } catch (e) {
      console.error(e)
    }

    if (this.destroyed) return

    // The direct Electron bridge can be absent while the source shim still
    // supplies a complete API through its service-worker proxy. Rebuild only
    // when the extension identity or a required API surface is incomplete.
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
          };
        })()`,
        true,
      )
      if (
        !this.bridgeRecovered &&
        (!bridgeState ||
          bridgeState.runtimeId !== this.extensionId ||
          !bridgeState.tabsQuery ||
          !bridgeState.storageReady)
      ) {
        this.bridgeRecovered = true
        d(`popup bridge unhealthy after load; rebuilding once (${url})`)
        const dead = this.browserWindow
        this.browserWindow = undefined
        if (dead && !dead.isDestroyed()) {
          dead.off('closed', this.destroy)
          dead.destroy()
        }
        setTimeout(() => {
          if (this.destroyed) return
          this.readyPromise = this.spawn()
        }, 50)
        return
      }
    } catch (e: any) {
      d(`popup bridge probe error: ${e && e.message}`)
    }

    if (this.destroyed) return

    if (this.usingPreferredSize) {
      // A preferred-size event may have arrived before loadURL resolved. Do
      // not reset that valid size to the minimum: fluid popup pages (such as
      // FlowPick) use their current viewport to decide whether to apply their
      // desktop width, so this reset can permanently collapse them.
      if (!this.preferredSizeReceived) {
        this.setSize({ width: PopupView.BOUNDS.minWidth, height: PopupView.BOUNDS.minHeight })
        this.updatePosition()
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

    d(`destroying ${this.extensionId}`)

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

  setSize(rect: Partial<Electron.Rectangle>) {
    if (!this.browserWindow || !this.parent) return

    // Chromium may report a transient zero dimension while an extension page
    // is reflowing. Keep the current content size instead of collapsing the
    // visible popup to its minimum width/height.
    const widthInput =
      rect.width && rect.width > 0 ? rect.width : this.lastWidth > 0 ? this.lastWidth : 0
    const heightInput =
      rect.height && rect.height > 0 ? rect.height : this.lastHeight > 0 ? this.lastHeight : 0
    const width = Math.floor(
      Math.min(PopupView.BOUNDS.maxWidth, Math.max(widthInput || 0, PopupView.BOUNDS.minWidth)),
    )

    const height = Math.floor(
      Math.min(PopupView.BOUNDS.maxHeight, Math.max(heightInput || 0, PopupView.BOUNDS.minHeight)),
    )

    const size = { width, height }
    this.lastWidth = width
    this.lastHeight = height
    d(`setSize`, size)

    this.emit('will-resize', size)

    this.browserWindow?.setBounds({
      ...this.browserWindow.getBounds(),
      ...size,
    })

    this.emit('resized')
  }

  private maybeClose = () => {
    // Keep open if webContents is being inspected
    if (!this.browserWindow?.isDestroyed() && this.browserWindow?.webContents.isDevToolsOpened()) {
      d('preventing close due to DevTools being open')
      return
    }

    // Match Chrome's transient action-popup lifecycle. Focus moving outside
    // the application must close the popup as well.
    this.destroy()
  }

  private updatePosition() {
    if (!this.browserWindow || !this.parent) return

    const winBounds = this.parent.getBounds()
    const winContentBounds = this.parent.getContentBounds()
    const nativeTitlebarHeight = winBounds.height - winContentBounds.height

    const viewBounds = this.browserWindow.getBounds()

    let x = winBounds.x + this.anchorRect.x + this.anchorRect.width - viewBounds.width
    let y =
      winBounds.y +
      nativeTitlebarHeight +
      this.anchorRect.y +
      this.anchorRect.height +
      PopupView.POSITION_PADDING

    // If aligned to a differently then we need to offset the popup position
    if (this.alignment?.includes('right')) x = winBounds.x + this.anchorRect.x
    if (this.alignment?.includes('top'))
      y =
        winBounds.y +
        nativeTitlebarHeight -
        viewBounds.height +
        this.anchorRect.y -
        PopupView.POSITION_PADDING

    // Convert to ints
    x = Math.floor(x)
    y = Math.floor(y)

    const position = { x, y }
    d(`updatePosition`, position)

    this.emit('will-move', position)

    this.browserWindow.setBounds({
      ...this.browserWindow.getBounds(),
      ...position,
    })

    this.emit('moved')
  }

  /** Backwards compat for Electron <12 */
  private async queryPreferredSize() {
    if (this.usingPreferredSize || this.destroyed) return

    const rect = await this.browserWindow!.webContents.executeJavaScript(
      `((${() => {
        const rect = document.body.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      }})())`,
    )

    if (this.destroyed) return

    this.setSize({ width: rect.width, height: rect.height })
    this.updatePosition()
  }

  private updatePreferredSize = (event: Electron.Event, size: Electron.Size) => {
    d('updatePreferredSize', size)
    this.usingPreferredSize = true
    this.preferredSizeReceived = true

    // While DevTools is open the window is intentionally enlarged for
    // inspection; don't let the content's preferred size shrink it back.
    if (this.devToolsOpened) {
      if (this.hidden) this.show()
      return
    }

    this.setSize(size)
    this.updatePosition()

    // Wait to reveal popup until it's sized and positioned correctly
    if (this.hidden) this.show()
  }

  /**
   * Enlarge the popup window when DevTools is opened (via right-click "检查").
   * The popup is normally clamped to its content's preferred size, leaving no
   * room once DevTools docks inside this frameless window.
   *
   * 弹窗创建时为 resizable:false / movable:false。Windows 下 Electron 会直接忽略
   * 对“不可缩放/不可移动”窗口的 setBounds 尺寸/位置变更,因此必须先解锁;且不能在
   * setBounds 之后同步锁回(会把窗口瞬间夹回旧尺寸 → 表现为“没放大”),要等
   * devtools-closed 再恢复锁定。
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

    let x = Math.max(workArea.x, Math.min(current.x, workArea.x + workArea.width - width))
    let y = Math.max(workArea.y, Math.min(current.y, workArea.y + workArea.height - height))

    this.browserWindow.setResizable(true)
    this.browserWindow.setMovable(true)
    this.browserWindow.setMinimumSize(width, height)
    this.browserWindow.setBounds({ x, y, width, height })

    d('onDevToolsOpened set bounds', this.browserWindow.getBounds())
  }

  /** Restore the popup's locked, content-sized state after inspection ends. */
  private onDevToolsClosed = () => {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return
    this.devToolsOpened = false
    this.browserWindow.setMinimumSize(PopupView.BOUNDS.minWidth, PopupView.BOUNDS.minHeight)
    this.browserWindow.setResizable(false)
    this.browserWindow.setMovable(false)
  }
}
