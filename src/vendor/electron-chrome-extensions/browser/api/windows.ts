import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'
import debug from 'debug'

const d = debug('electron-chrome-extensions:windows')

const getWindowState = (win: Electron.BaseWindow): chrome.windows.Window['state'] => {
  if (win.isMaximized()) return 'maximized'
  if (win.isMinimized()) return 'minimized'
  if (win.isFullScreen()) return 'fullscreen'
  return 'normal'
}

export class WindowsAPI {
  static WINDOW_ID_NONE = -1
  static WINDOW_ID_CURRENT = -2

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('windows.get', this.get.bind(this))
    handle('windows.getCurrent', this.getCurrent.bind(this))
    handle('windows.getLastFocused', this.getLastFocused.bind(this))
    handle('windows.getAll', this.getAll.bind(this))
    handle('windows.create', this.create.bind(this))
    handle('windows.update', this.update.bind(this))
    handle('windows.remove', this.remove.bind(this))

    this.ctx.store.on('window-added', this.observeWindow.bind(this))
  }

  private observeWindow(window: Electron.BrowserWindow) {
    const windowId = window.id

    window.on('focus', () => {
      this.onFocusChanged(windowId)
    })

    window.on('resized', () => {
      this.onBoundsChanged(windowId)
    })

    window.once('closed', () => {
      this.ctx.store.windowDetailsCache.delete(windowId)
      this.ctx.store.removeWindow(window)
      this.onRemoved(windowId)
    })

    this.onCreated(windowId)

    d(`Observing window[${windowId}]`)
  }

  private createWindowDetails(win: Electron.BaseWindow) {
    const details: Partial<chrome.windows.Window> = {
      id: win.id,
      focused: win.isFocused(),
      top: win.getPosition()[1],
      left: win.getPosition()[0],
      width: win.getSize()[0],
      height: win.getSize()[1],
      tabs: Array.from(this.ctx.store.tabs)
        .filter((tab) => {
          const ownerWindow = this.ctx.store.tabToWindow.get(tab)
          return ownerWindow?.isDestroyed() ? false : ownerWindow?.id === win.id
        })
        .map((tab) => this.ctx.store.tabDetailsCache.get(tab.id) as chrome.tabs.Tab)
        .filter(Boolean),
      incognito: this.computeIncognito(win, undefined),
      type: 'normal', // TODO
      state: getWindowState(win),
      alwaysOnTop: win.isAlwaysOnTop(),
      sessionId: 'default', // TODO
    }

    this.ctx.store.windowDetailsCache.set(win.id, details)
    return details
  }

  private getWindowDetails(win: Electron.BaseWindow) {
    if (this.ctx.store.windowDetailsCache.has(win.id)) {
      const cached = this.ctx.store.windowDetailsCache.get(win.id)
      // incognito is intrinsic to the window, not derivable from current tab
      // membership (an incognito window with zero tabs must still report
      // incognito:true). Refresh it live, sticky-once-true: the cached value is
      // carried as `prior` so once any tab in the window was observed incognito
      // the flag stays true until the window is closed.
      if (cached) cached.incognito = this.computeIncognito(win, cached.incognito)
      return cached
    }
    const details = this.createWindowDetails(win)
    return details
  }

  /**
   * Derive a window's incognito flag. Chrome treats incognito as an intrinsic
   * property of the window itself, independent of how many (if any) tabs it
   * currently holds. We approximate that with a sticky signal: the window is
   * incognito if its session is off-the-record, OR it was previously observed
   * to hold an incognito tab, OR any of its current tabs is incognito. The
   * `prior` argument carries the previously-cached value so the flag never
   * flips back to false once it has been true (matches Chrome, where emptying an
   * incognito window does not make it non-incognito).
   */
  private computeIncognito(win: Electron.BaseWindow, prior: boolean | undefined): boolean {
    const hostValue = this.ctx.store.impl.isIncognitoWindow?.(win)
    if (typeof hostValue === 'boolean') return hostValue
    if (!this.ctx.session.isPersistent()) return true
    if (prior) return true
    return Array.from(this.ctx.store.tabs).some((tab) => {
      const ownerWindow = this.ctx.store.tabToWindow.get(tab)
      return (
        !ownerWindow?.isDestroyed() &&
        ownerWindow?.id === win.id &&
        !!this.ctx.store.tabDetailsCache.get(tab.id)?.incognito
      )
    })
  }

  private getWindowFromId(event: ExtensionEvent, id: number) {
    if (id === WindowsAPI.WINDOW_ID_CURRENT) {
      return this.ctx.store.getCurrentWindow(event)
    } else {
      return this.ctx.store.getWindowById(id)
    }
  }

  private get(event: ExtensionEvent, windowId: number) {
    const win = this.getWindowFromId(event, windowId)
    if (!win) return { id: WindowsAPI.WINDOW_ID_NONE }
    return this.getWindowDetails(win)
  }

  private getCurrent(event: ExtensionEvent) {
    const win = this.ctx.store.getCurrentWindow(event)
    return win ? this.getWindowDetails(win) : null
  }

  private getLastFocused(event: ExtensionEvent) {
    const win = this.ctx.store.getLastFocusedWindow()
    return win ? this.getWindowDetails(win) : null
  }

  private getAll(event: ExtensionEvent) {
    return Array.from(this.ctx.store.windows).map(this.getWindowDetails.bind(this))
  }

  private async create(event: ExtensionEvent, details: chrome.windows.CreateData) {
    const win = await this.ctx.store.createWindow(event, details)
    return this.getWindowDetails(win)
  }

  private async update(
    event: ExtensionEvent,
    windowId: number,
    updateProperties: chrome.windows.UpdateInfo = {},
  ) {
    const win = this.getWindowFromId(event, windowId)
    if (!win) return

    const props = updateProperties

    if (props.state) {
      switch (props.state) {
        case 'maximized':
          win.maximize()
          break
        case 'minimized':
          win.minimize()
          break
        case 'normal': {
          if (win.isMinimized() || win.isMaximized()) {
            win.restore()
          }
          break
        }
      }
    }

    // Bounds + focus. All Electron-native (BaseWindow.getPosition/getSize/
    // setBounds/focus/flashFrame). Only adjust dimensions that were provided.
    if (
      typeof props.left === 'number' ||
      typeof props.top === 'number' ||
      typeof props.width === 'number' ||
      typeof props.height === 'number'
    ) {
      const [curX, curY] = win.getPosition()
      const [curW, curH] = win.getSize()
      const x = typeof props.left === 'number' ? props.left : curX
      const y = typeof props.top === 'number' ? props.top : curY
      const w = typeof props.width === 'number' ? props.width : curW
      const h = typeof props.height === 'number' ? props.height : curH
      try {
        win.setBounds({ x, y, width: w, height: h })
      } catch (e) {
        /* setBounds not supported on this window type */
      }
    }
    if (typeof props.focused === 'boolean' && props.focused) {
      try {
        win.focus()
      } catch {}
    }
    if (props.drawAttention) {
      try {
        win.flashFrame(true)
        setTimeout(() => {
          try {
            win.flashFrame(false)
          } catch {}
        }, 3000)
      } catch {}
    }

    return this.createWindowDetails(win)
  }

  private async remove(event: ExtensionEvent, windowId: number = WindowsAPI.WINDOW_ID_CURRENT) {
    const win = this.getWindowFromId(event, windowId)
    if (!win) return
    const removedWindowId = win.id
    await this.ctx.store.removeWindow(win)
    this.onRemoved(removedWindowId)
  }

  onCreated(windowId: number) {
    const window = this.ctx.store.getWindowById(windowId)
    if (!window) return
    const windowDetails = this.getWindowDetails(window)
    this.ctx.router.broadcastEvent('windows.onCreated', windowDetails)
  }

  onRemoved(windowId: number) {
    this.ctx.router.broadcastEvent('windows.onRemoved', windowId)
  }

  onFocusChanged(windowId: number) {
    if (this.ctx.store.lastFocusedWindowId === windowId) return

    this.ctx.store.lastFocusedWindowId = windowId
    this.ctx.router.broadcastEvent('windows.onFocusChanged', windowId)
  }

  onBoundsChanged(windowId: number) {
    const window = this.ctx.store.getWindowById(windowId)
    if (!window) return
    const windowDetails = this.createWindowDetails(window)
    this.ctx.router.broadcastEvent('windows.onBoundsChanged', windowDetails)
  }
}
