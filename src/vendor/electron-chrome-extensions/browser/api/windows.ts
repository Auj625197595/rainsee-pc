import { BrowserWindow } from 'electron'
import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'
import debug from 'debug'
import { normalizeWindowCreateData } from './window-create'

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
    let boundsChangedTimer: ReturnType<typeof setTimeout> | undefined

    window.on('focus', () => {
      this.onFocusChanged(windowId)
    })
    // Chrome reports WINDOW_ID_NONE when focus leaves every browser window.
    // Defer so a blur→focus hop between two browser windows only reports the
    // newly focused window.
    window.on('blur', () => {
      setTimeout(() => {
        // Any app window counts: extension popups/dialogs are separate
        // BrowserWindows here but belong to the browser window in Chrome, so
        // focusing one must not report WINDOW_ID_NONE.
        if (!BrowserWindow.getFocusedWindow()) {
          this.onFocusChanged(WindowsAPI.WINDOW_ID_NONE)
        }
      }, 50)
    })

    window.on('resized', () => {
      if (boundsChangedTimer) clearTimeout(boundsChangedTimer)
      boundsChangedTimer = setTimeout(() => {
        boundsChangedTimer = undefined
        if (!window.isDestroyed()) this.onBoundsChanged(windowId)
      }, 100)
      boundsChangedTimer.unref?.()
    })

    window.once('closed', () => {
      if (boundsChangedTimer) clearTimeout(boundsChangedTimer)
      this.ctx.store.windowDetailsCache.delete(windowId)
      this.ctx.store.removeWindow(window)
      this.onRemoved(windowId)
    })

    this.onCreated(windowId)

    d(`Observing window[${windowId}]`)
  }

  private createWindowDetails(win: Electron.BaseWindow) {
    const windowType = (win as any).__crxWindowType
    const priorIncognito = this.ctx.store.windowDetailsCache.get(win.id)?.incognito
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
      incognito: this.computeIncognito(win, priorIncognito),
      type:
        windowType === 'popup' || windowType === 'panel'
          ? windowType
          : 'normal',
      state: getWindowState(win),
      alwaysOnTop: win.isAlwaysOnTop(),
      sessionId: 'default', // TODO
    }

    this.ctx.store.windowDetailsCache.set(win.id, details)
    return details
  }

  private getWindowDetails(win: Electron.BaseWindow) {
    // Window bounds, focus, state and tab membership all change independently.
    // Rebuild the descriptor so windows.create/get/getAll never return the
    // partial snapshot cached when the first tab registered the window.
    return this.createWindowDetails(win)
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
    if (!win) throw new Error(`No window with id: ${windowId}.`)
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
    const normalized = normalizeWindowCreateData(event, details)
    if (normalized.setSelfAsOpener) {
      const opener = this.ctx.store.getActiveTabOfCurrentWindow(event)
      if (opener) (normalized as any).__openerTabId = opener.id
    }
    const win = await this.ctx.store.createWindow(event, normalized)
    return this.getWindowDetails(win)
  }

  private async update(
    event: ExtensionEvent,
    windowId: number,
    updateProperties: chrome.windows.UpdateInfo = {},
  ) {
    const win = this.getWindowFromId(event, windowId)
    if (!win) throw new Error(`No window with id: ${windowId}.`)

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
          if (win.isFullScreen()) {
            win.setFullScreen(false)
          }
          break
        }
        case 'fullscreen':
          win.setFullScreen(true)
          break
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
    if (typeof props.focused === 'boolean') {
      try {
        if (props.focused) {
          win.focus()
        } else {
          // Let the window manager choose the next focused window. Explicitly
          // focusing an arbitrary tracked window does not match Chrome and can
          // interrupt a different application the user is working in.
          win.blur()
        }
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
    if (!win) throw new Error(`No window with id: ${windowId}.`)
    await this.ctx.store.removeWindow(win)
    // observeWindow emits onRemoved when the native window actually closes.
    // Emitting here as well delivered the event twice for API-initiated closes.
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

  // Track the last *reported* focus separately: store.addWindow's own focus
  // listener updates lastFocusedWindowId before this one runs, so comparing
  // against it suppressed every onFocusChanged. lastFocusedWindowId keeps the
  // last real window (Chrome's getLastFocused never returns WINDOW_ID_NONE).
  private reportedFocusWindowId: number | undefined

  onFocusChanged(windowId: number) {
    if (this.reportedFocusWindowId === windowId) return
    this.reportedFocusWindowId = windowId

    if (windowId !== WindowsAPI.WINDOW_ID_NONE) {
      this.ctx.store.lastFocusedWindowId = windowId
    }
    this.ctx.router.broadcastEvent('windows.onFocusChanged', windowId)
  }

  onBoundsChanged(windowId: number) {
    const window = this.ctx.store.getWindowById(windowId)
    if (!window) return
    const windowDetails = this.createWindowDetails(window)
    this.ctx.router.broadcastEvent('windows.onBoundsChanged', windowDetails)
  }
}
