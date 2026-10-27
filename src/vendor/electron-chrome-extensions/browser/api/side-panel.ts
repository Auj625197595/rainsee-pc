import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

// chrome.sidePanel (MV3). The host owns a right-docked BrowserView "side panel"
// container (mirroring the AI/subscribe panels); this API stores per-tab/global
// options + per-extension behavior and asks the host to show the panel via
// impl.openSidePanel. openPanelOnActionClick is consulted by
// BrowserActionAPI.activateClick (through ctx.sidePanel) to divert an action
// click to the panel instead of onClicked/popup.
//
// Path resolution on open: per-tab override (enabled !== false) > global
// override > manifest `side_panel.default_path`. A tab/global with enabled:false
// resolves to no panel (open is a no-op).

interface PanelOptions {
  path?: string
  enabled?: boolean
}

interface PanelBehavior {
  openPanelOnActionClick?: boolean
}

export class SidePanelAPI {
  // Chrome stores side-panel options per extension. Keeping only one global
  // value lets one extension's setOptions({enabled:false}) disable every other
  // extension's panel.
  private tabOptions = new Map<string, Map<number, PanelOptions>>()
  private globalOptions = new Map<string, PanelOptions>()
  // per-extension behavior (openPanelOnActionClick). Defaults to false.
  private behaviors = new Map<string, PanelBehavior>()

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('sidePanel.setOptions', this.setOptions, { permission: 'sidePanel' })
    handle('sidePanel.setPanelBehavior', this.setPanelBehavior, { permission: 'sidePanel' })
    handle('sidePanel.open', this.open, { permission: 'sidePanel' })
    handle('sidePanel.getOptions', this.getOptions, { permission: 'sidePanel' })
    handle('sidePanel.getPanelBehavior', this.getPanelBehaviorHandler, { permission: 'sidePanel' })
    handle('sidePanel.close', this.close, { permission: 'sidePanel' })
  }

  private getExtension(extensionId: string): any {
    const se = (this.ctx.session as any).extensions || this.ctx.session
    return typeof se.getExtension === 'function' ? se.getExtension(extensionId) : undefined
  }

  private manifestDefaultPath(extensionId: string): string | undefined {
    const ext = this.getExtension(extensionId)
    const p = ext?.manifest?.side_panel?.default_path
    return typeof p === 'string' && p ? p : undefined
  }

  // Resolve the effective panel HTML path for a tab. Returns undefined when the
  // panel is disabled for that context or no path is configured.
  private resolvePath(extensionId: string, tabId?: number): string | undefined {
    const manifestPath = this.manifestDefaultPath(extensionId)
    const extensionTabOptions = this.tabOptions.get(extensionId)
    if (typeof tabId === 'number' && extensionTabOptions?.has(tabId)) {
      const o = extensionTabOptions.get(tabId)!
      if (o.enabled === false) return undefined
      return o.path || manifestPath
    }
    const globalOptions = this.globalOptions.get(extensionId)
    if (globalOptions?.enabled === false) return undefined
    return globalOptions?.path || manifestPath
  }

  private setOptions = (
    { extension }: ExtensionEvent,
    options: PanelOptions & { tabId?: number } = {},
  ) => {
    const o: PanelOptions = { path: options.path, enabled: options.enabled }
    if (options && typeof options.tabId === 'number') {
      let extensionTabOptions = this.tabOptions.get(extension.id)
      if (!extensionTabOptions) {
        extensionTabOptions = new Map<number, PanelOptions>()
        this.tabOptions.set(extension.id, extensionTabOptions)
      }
      extensionTabOptions.set(options.tabId, o)
    } else {
      this.globalOptions.set(extension.id, o)
    }
  }

  private setPanelBehavior = (
    { extension }: ExtensionEvent,
    behavior: PanelBehavior = {},
  ) => {
    this.behaviors.set(extension.id, { openPanelOnActionClick: !!behavior.openPanelOnActionClick })
  }

  private open = (
    event: ExtensionEvent,
    details: { windowId?: number; tabId?: number } = {},
  ) => {
    const requestedTabId = typeof details?.tabId === 'number' ? details.tabId : undefined
    const windowId = typeof details?.windowId === 'number' ? details.windowId : undefined

    // Chrome resolves an omitted tabId to the active tab in the requested
    // window (or the caller's current window). Passing -1 to the host makes
    // SidePanelManager silently ignore the request, so resolve it here before
    // applying per-tab options and opening the panel.
    let tabId = requestedTabId
    let resolvedWindowId = windowId
    if (typeof tabId !== 'number') {
      const win = windowId === -2
        ? this.ctx.store.getCurrentWindow(event)
        : typeof windowId === 'number'
          ? this.ctx.store.getWindowById(windowId)
          : this.ctx.store.getCurrentWindow(event)
      tabId = win ? this.ctx.store.getActiveTabFromWindow(win)?.id : undefined
      // Keep tab and window resolution tied to the same store snapshot. The
      // host has a separate focus tracker, so forwarding -2/undefined here
      // could show the panel in a different window than the resolved tab.
      if (win) resolvedWindowId = win.id
    }

    this.openFor(event.extension.id, tabId, resolvedWindowId)
  }

  // chrome.sidePanel.close (Chrome 141+). Chrome requires windowId or tabId;
  // either way it closes this extension's panel in the resolved window.
  private close = (
    event: ExtensionEvent,
    details: { windowId?: number; tabId?: number } = {},
  ) => {
    let windowId: number | undefined
    if (typeof details?.tabId === 'number') {
      const tab = this.ctx.store.getTabById(details.tabId)
      windowId = tab ? this.ctx.store.tabToWindow.get(tab)?.id : undefined
    } else if (typeof details?.windowId === 'number' && details.windowId !== -2) {
      windowId = details.windowId
    } else {
      windowId = this.ctx.store.getCurrentWindow(event)?.id
    }
    const closeSidePanel = this.ctx.store.impl.closeSidePanel
    if (typeof closeSidePanel !== 'function') return
    closeSidePanel(event.extension.id, windowId)
  }

  private getOptions = (
    { extension }: ExtensionEvent,
    details: { tabId?: number } = {},
  ) => {
    const path = this.resolvePath(extension.id, details?.tabId)
    return { path, enabled: path !== undefined }
  }

  private getPanelBehaviorHandler = ({ extension }: ExtensionEvent) => {
    return this.behaviors.get(extension.id) || { openPanelOnActionClick: false }
  }

  // ---- public surface for BrowserActionAPI (reached via ctx.sidePanel) ----

  /** True if the extension declares side_panel.default_path in its manifest. */
  hasPanel(extensionId: string): boolean {
    return !!this.manifestDefaultPath(extensionId)
  }

  /** Current openPanelOnActionClick setting for the extension. */
  getPanelBehavior(extensionId: string): PanelBehavior {
    return this.behaviors.get(extensionId) || { openPanelOnActionClick: false }
  }

  /** Called from BrowserActionAPI.activateClick when openPanelOnActionClick is on. */
  openFromAction(extensionId: string, tabId: number, windowId?: number): void {
    this.openFor(extensionId, tabId, windowId)
  }

  /**
   * Host notification: the extension's panel became visible / hidden. Fires
   * chrome.sidePanel.onOpened / onClosed so extensions that track panel state
   * (and toggle via close()) stay in sync with closes from the host UI.
   */
  notifyPanelState(
    opened: boolean,
    extensionId: string,
    info: { windowId: number; tabId?: number; path: string },
  ) {
    this.ctx.router.sendEvent(extensionId, opened ? 'sidePanel.onOpened' : 'sidePanel.onClosed', info)
  }

  private openFor(extensionId: string, tabId: number | undefined, windowId?: number) {
    const path = this.resolvePath(extensionId, tabId)
    if (!path) return
    const openSidePanel = this.ctx.store.impl.openSidePanel
    if (typeof openSidePanel !== 'function') return
    openSidePanel(extensionId, typeof tabId === 'number' ? tabId : -1, path, windowId)
  }
}
