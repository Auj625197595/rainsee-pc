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
  // per-tab options overrides (tabId -> {path, enabled}); globalOptions when no tabId.
  private tabOptions = new Map<number, PanelOptions>()
  private globalOptions: PanelOptions = {}
  // per-extension behavior (openPanelOnActionClick). Defaults to false.
  private behaviors = new Map<string, PanelBehavior>()

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('sidePanel.setOptions', this.setOptions, { permission: 'sidePanel' })
    handle('sidePanel.setPanelBehavior', this.setPanelBehavior, { permission: 'sidePanel' })
    handle('sidePanel.open', this.open, { permission: 'sidePanel' })
    handle('sidePanel.getOptions', this.getOptions, { permission: 'sidePanel' })
    handle('sidePanel.getPanelBehavior', this.getPanelBehaviorHandler, { permission: 'sidePanel' })
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
    if (typeof tabId === 'number' && this.tabOptions.has(tabId)) {
      const o = this.tabOptions.get(tabId)!
      if (o.enabled === false) return undefined
      return o.path || manifestPath
    }
    if (this.globalOptions.enabled === false) return undefined
    return this.globalOptions.path || manifestPath
  }

  private setOptions = (
    _event: ExtensionEvent,
    options: PanelOptions & { tabId?: number } = {},
  ) => {
    const o: PanelOptions = { path: options.path, enabled: options.enabled }
    if (options && typeof options.tabId === 'number') {
      this.tabOptions.set(options.tabId, o)
    } else {
      this.globalOptions = o
    }
  }

  private setPanelBehavior = (
    { extension }: ExtensionEvent,
    behavior: PanelBehavior = {},
  ) => {
    this.behaviors.set(extension.id, { openPanelOnActionClick: !!behavior.openPanelOnActionClick })
  }

  private open = (
    { extension }: ExtensionEvent,
    details: { windowId?: number; tabId?: number } = {},
  ) => {
    this.openFor(extension.id, details.tabId, details.windowId)
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

  private openFor(extensionId: string, tabId: number | undefined, windowId?: number) {
    const path = this.resolvePath(extensionId, tabId)
    if (!path) return
    const openSidePanel = this.ctx.store.impl.openSidePanel
    if (typeof openSidePanel !== 'function') return
    openSidePanel(extensionId, typeof tabId === 'number' ? tabId : -1, path, windowId)
  }
}
