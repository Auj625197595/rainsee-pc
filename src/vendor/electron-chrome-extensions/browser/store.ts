import { BrowserWindow, webContents } from 'electron'
import { EventEmitter } from 'node:events'
import { ContextMenuType } from './api/common'
import { ChromeExtensionImpl } from './impl'
import { ExtensionEvent } from './router'

export class ExtensionStore extends EventEmitter {
  /** Tabs observed by the extensions system. */
  tabs = new Set<Electron.WebContents>()

  /** Windows observed by the extensions system. */
  windows = new Set<Electron.BaseWindow>()

  lastFocusedWindowId?: number

  /**
   * Map of tabs to their parent window.
   *
   * It's not possible to access the parent of a BrowserView so we must manage
   * this ourselves.
   */
  tabToWindow = new WeakMap<Electron.WebContents, Electron.BaseWindow>()

  /** Map of windows to their active tab. */
  private windowToActiveTab = new WeakMap<Electron.BaseWindow, Electron.WebContents>()

  tabDetailsCache = new Map<number, Partial<chrome.tabs.Tab>>()
  windowDetailsCache = new Map<number, Partial<chrome.windows.Window>>()

  urlOverrides: Record<string, string> = {}

  constructor(public impl: ChromeExtensionImpl) {
    super()
  }

  getWindowById(windowId: number) {
    return Array.from(this.windows).find(
      (window) => !window.isDestroyed() && window.id === windowId,
    )
  }

  getLastFocusedWindow() {
    return this.lastFocusedWindowId ? this.getWindowById(this.lastFocusedWindowId) : null
  }

  getCurrentWindow(event?: ExtensionEvent) {
    const eventWindow = this.getWindowFromEvent(event)
    return eventWindow || this.getLastFocusedWindow()
  }

  private isWebContentsLike(sender: any): sender is Electron.WebContents {
    return (
      !!sender &&
      typeof sender.id === 'number' &&
      typeof sender.isDestroyed === 'function' &&
      typeof sender.getURL === 'function' &&
      typeof sender.getType === 'function' &&
      typeof sender.getOwnerBrowserWindow === 'function'
    )
  }

  /**
   * Resolve Chrome's "current window" for an extension API caller.
   *
   * Action popups/options are extension pages, not browser tabs. Electron hosts
   * an action popup in its own child BrowserWindow, so BrowserWindow.fromWebContents
   * points at the popup window rather than the app window that owns the active
   * tab. Chrome APIs still treat the parent app window as current for popup
   * calls such as tabs.query({ active: true, currentWindow: true }) and
   * tabs.sendMessage() with an omitted tab id.
   */
  getWindowFromEvent(event?: ExtensionEvent): Electron.BaseWindow | undefined {
    const sender = (event as any)?.sender
    if (!sender || typeof sender.isDestroyed !== 'function') return undefined
    if (sender.isDestroyed()) return undefined
    if (!this.isWebContentsLike(sender)) return undefined

    const tabWindow = this.tabToWindow.get(sender)
    if (tabWindow && !tabWindow.isDestroyed()) return tabWindow

    const senderWindow = BrowserWindow.fromWebContents(sender)
    if (!senderWindow || senderWindow.isDestroyed()) return undefined
    if (this.windows.has(senderWindow)) return senderWindow

    const parentWindow =
      typeof (senderWindow as any).getParentWindow === 'function'
        ? (senderWindow as any).getParentWindow()
        : undefined
    if (parentWindow && !parentWindow.isDestroyed() && this.windows.has(parentWindow)) {
      return parentWindow
    }

    return undefined
  }

  addWindow(window: Electron.BaseWindow) {
    if (this.windows.has(window)) return

    this.windows.add(window)

    // Track focus so chrome.tabs.query({lastFocusedWindow:true}) /
    // chrome.windows.getLastFocused() return the actually-focused browser
    // window, matching Chrome's semantics. Without this, lastFocusedWindowId
    // was set once (first window) and never updated — once that window was
    // closed/rebuilt the query silently returned an empty list, breaking any
    // extension popup that resolves the active tab via lastFocusedWindow
    // (e.g. Dark Reader fell back to "page_protected" on every site).
    // Popups (PopupView) are NOT registered via addWindow, so focusing an
    // extension popup does NOT steal lastFocused — same as Chrome.
    try {
      window.on('focus', () => {
        this.lastFocusedWindowId = window.id
      })
    } catch {
      /* BaseWindow.focus may be unavailable in rare host setups — best-effort */
    }

    if (typeof this.lastFocusedWindowId !== 'number') {
      this.lastFocusedWindowId = window.id
    }

    this.emit('window-added', window)
  }

  async createWindow(event: ExtensionEvent, details: chrome.windows.CreateData) {
    if (typeof this.impl.createWindow !== 'function') {
      throw new Error('createWindow is not implemented')
    }

    const win = await this.impl.createWindow(details)

    this.addWindow(win)

    return win
  }

  async removeWindow(window: Electron.BaseWindow) {
    if (!this.windows.has(window)) return

    this.windows.delete(window)

    // If the removed window was the last-focused one, re-elect a surviving
    // window so getLastFocusedWindow() never returns a stale/destroyed id
    // (which would make tabs.query({lastFocusedWindow:true}) return empty).
    if (this.lastFocusedWindowId === window.id) {
      const remaining = Array.from(this.windows).filter((w) => !w.isDestroyed())
      this.lastFocusedWindowId = remaining.length ? remaining[remaining.length - 1].id : undefined
    }

    if (typeof this.impl.removeWindow === 'function') {
      await this.impl.removeWindow(window)
    } else {
      window.destroy()
    }
  }

  getTabById(tabId: number) {
    return Array.from(this.tabs).find((tab) => !tab.isDestroyed() && tab.id === tabId)
  }

  addTab(tab: Electron.WebContents, window: Electron.BaseWindow) {
    if (this.tabs.has(tab)) return

    this.tabs.add(tab)
    this.tabToWindow.set(tab, window)
    this.addWindow(window)

    // Use the explicit windowToActiveTab record, NOT getActiveTabFromWebContents:
    // the latter's self-heal fallback elects this very tab (just added to
    // this.tabs) and commits it, so it would falsely report an existing active
    // tab and suppress the initial setActiveTab → active-tab-changed broadcast.
    if (!this.windowToActiveTab.has(window)) {
      this.setActiveTab(tab)
    }

    this.emit('tab-added', tab)
  }

  removeTab(tab: Electron.WebContents) {
    if (!this.tabs.has(tab)) return

    const tabId = tab.id
    const win = this.tabToWindow.get(tab)!

    const wasActive = this.windowToActiveTab.get(win) === tab

    this.tabs.delete(tab)
    this.tabToWindow.delete(tab)

    // If the active tab was removed, elect a surviving sibling so the window
    // always keeps exactly one active tab. Emit so the tabs API can refresh its
    // cached `active` flags and broadcast chrome.tabs.onActivated.
    if (wasActive) {
      this.windowToActiveTab.delete(win)
      const next = this.getActiveTabFromWindow(win)
      if (next) {
        this.emit('active-tab-changed', next, win)
      }
    }

    // Clear window if it has no remaining tabs
    const windowHasTabs = Array.from(this.tabs).find((tab) => this.tabToWindow.get(tab) === win)
    if (!windowHasTabs) {
      this.windows.delete(win)
    }

    if (typeof this.impl.removeTab === 'function') {
      this.impl.removeTab(tab, win)
    }

    this.emit('tab-removed', tabId)
  }

  async createTab(details: chrome.tabs.CreateProperties) {
    if (typeof this.impl.createTab !== 'function') {
      throw new Error('createTab is not implemented')
    }

    // Fallback to current window
    if (!details.windowId) {
      details.windowId = this.lastFocusedWindowId
    }

    const result = await this.impl.createTab(details)

    if (!Array.isArray(result)) {
      throw new Error('createTab must return an array of [tab, window]')
    }

    const [tab, window] = result

    if (typeof tab !== 'object' || !webContents.fromId(tab.id)) {
      throw new Error('createTab must return a WebContents')
    } else if (typeof window !== 'object') {
      throw new Error('createTab must return a BrowserWindow')
    }

    this.addTab(tab, window)

    return tab
  }

  /** All live tabs that belong to the given window. */
  getTabsInWindow(win: Electron.BaseWindow) {
    return Array.from(this.tabs).filter(
      (tab) => !tab.isDestroyed() && this.tabToWindow.get(tab) === win,
    )
  }

  // 可视标签栏顺序(每窗口),由宿主 UI(renderer 才是顺序的权威来源;主进程并不
  // 知道拖拽重排后的顺序)通过 setTabOrder 推送。chrome.tabs.Tab.index 据此给出
  // 准确值。未推送时退化为 store 内同窗口 tab 的插入顺序(非负,仍可用)。
  private tabOrderByWindow = new Map<number, number[]>()

  /** 宿主推送某窗口的可视标签顺序(tabId = webContents.id 数组)。 */
  setTabOrder(windowId: number, orderedTabIds: number[]) {
    this.tabOrderByWindow.set(windowId, Array.isArray(orderedTabIds) ? orderedTabIds.slice() : [])
  }

  /** tab 在所属窗口标签栏里的位置(0-based)。优先用宿主推送的可视顺序;未推送时
   *  退化为插入顺序;都拿不到返回 -1。 */
  getTabIndex(tab: Electron.WebContents): number {
    const win = this.tabToWindow.get(tab)
    if (win && !win.isDestroyed()) {
      const order = this.tabOrderByWindow.get(win.id)
      if (order && order.length) {
        const i = order.indexOf(tab.id)
        if (i >= 0) return i
      }
      const sibs = this.getTabsInWindow(win)
      const i = sibs.findIndex((t) => t.id === tab.id)
      if (i >= 0) return i
    }
    return -1
  }

  getActiveTabFromWindow(win: Electron.BaseWindow): Electron.WebContents | undefined {
    if (!win || win.isDestroyed()) return undefined

    const recorded = this.windowToActiveTab.get(win)
    if (recorded && !recorded.isDestroyed() && this.tabs.has(recorded)) {
      return recorded
    }

    // Self-heal: the recorded active tab was closed/destroyed (or none was ever
    // set). A window must always expose an active tab as long as it has any, so
    // elect its first live tab and commit it. This keeps `chrome.tabs.query({
    // active: true })` working after the active tab is closed, when the host
    // re-selects a neighbour without routing back through the extension system.
    const elected = this.getTabsInWindow(win)[0]
    if (elected) {
      this.windowToActiveTab.set(win, elected)
      return elected
    }

    this.windowToActiveTab.delete(win)
    return undefined
  }

  getActiveTabFromWebContents(wc: Electron.WebContents): Electron.WebContents | undefined {
    const win = this.tabToWindow.get(wc) || BrowserWindow.fromWebContents(wc)
    const activeTab = win ? this.getActiveTabFromWindow(win) : undefined
    return activeTab
  }

  getActiveTabOfCurrentWindow(event?: ExtensionEvent) {
    const win = this.getCurrentWindow(event)
    return win ? this.getActiveTabFromWindow(win) : undefined
  }

  setActiveTab(tab: Electron.WebContents) {
    const win = this.tabToWindow.get(tab)
    if (!win) {
      throw new Error('Active tab has no parent window')
    }

    // Compare against the explicit record, NOT getActiveTabFromWebContents:
    // its self-heal fallback may have already committed this tab on a prior
    // query, masking the change and skipping the active-tab-changed broadcast.
    const prevActiveTab = this.windowToActiveTab.get(win)

    this.windowToActiveTab.set(win, tab)

    if (tab.id !== prevActiveTab?.id) {
      this.emit('active-tab-changed', tab, win)

      if (typeof this.impl.selectTab === 'function') {
        this.impl.selectTab(tab, win)
      }
    }
  }

  buildMenuItems(extensionId: string, menuType: ContextMenuType): Electron.MenuItem[] {
    // This function is overwritten by ContextMenusAPI
    return []
  }

  async requestPermissions(
    extension: Electron.Extension,
    permissions: chrome.permissions.Permissions,
  ) {
    if (typeof this.impl.requestPermissions !== 'function') {
      // Optional permissions must never be granted without an explicit host
      // decision. Embedders that support prompts provide this hook.
      return false
    }
    const result: unknown = await this.impl.requestPermissions(extension, permissions)
    return typeof result === 'boolean' ? result : false
  }
}
