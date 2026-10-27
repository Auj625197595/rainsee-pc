import { EventEmitter } from 'node:events'
import { ExtensionRouter } from './router'
import { ExtensionStore } from './store'

export interface DynamicContentScriptRegistry {
  token(frame: Electron.WebFrameMain): number
  mark(extensionId: string, frame: Electron.WebFrameMain, expectedToken?: number): void
  clearExtension(extensionId: string): void
  clearFrame(frame: Electron.WebFrameMain): void
  has(extensionId: string, frame: Electron.WebFrameMain): boolean
}

export interface PreloadIsolatedScript {
  code: string
  worldId: number
}

/** Shared context for extensions in a session. */
export interface ExtensionContext {
  emit: (typeof EventEmitter)['prototype']['emit']
  dynamicContentScripts: DynamicContentScriptRegistry
  router: ExtensionRouter
  session: Electron.Session
  store: ExtensionStore
  /**
   * Absolute path to the crx-preload bundle, resolved before APIs are created.
   * APIs that spin up their own hidden extension-page renderer (e.g.
   * OffscreenAPI) set it as `webPreferences.preload` alongside the session
   * preload, which co-sited/sandboxed renderers can skip.
   */
  preloadPath: string
  /** Runtime view of required and user-granted extension permissions. */
  permissions?: {
    hasPermission(extensionId: string, permission: string): boolean
    hasOrigin(extensionId: string, urlOrPattern: string): boolean
    onChanged(listener: (extensionId: string) => void): () => void
  }
  tabs?: {
    onUpdated(tabId: number): void
  }
  tabGroups?: {
    getTabGroupId(tabId: number): number
  }
  userScripts?: {
    getDocumentStartScripts(
      frame: Electron.WebFrameMain | null | undefined,
      currentUrl?: string,
    ): PreloadIsolatedScript[]
    getDocumentStartMainScripts?(
      frame: Electron.WebFrameMain | null | undefined,
      currentUrl?: string,
    ): string[]
  }
  webRequest?: {
    dispatchChromeEvent(eventName: string, details: any): void
  }
  /** Coordinates MV3 worker cold starts and capability readiness. */
  messaging?: {
    acquireServiceWorker(extensionId: string, timeoutMs?: number): Promise<(() => void) | undefined>
    markServiceWorkerReady(
      serviceWorker: any,
      details?: any,
    ): void
  }
  /** Optional host-level last-resort recovery after a proven readiness timeout. */
  recoverServiceWorker?: (
    extensionId: string,
    timeoutMs?: number,
    provenFailure?: boolean,
  ) => Promise<(() => void) | undefined>
  /** Lazy compatibility fallback for extensions whose native offscreen binding has no loader. */
  offscreen?: {
    ensureDocument(extensionId: string): Promise<boolean>
    /** The live offscreen document (any URL the extension chose), if one exists. */
    getDocument(extensionId: string): { url: string; webContents: Electron.WebContents } | undefined
  }
  /**
   * The SidePanelAPI instance, assigned by ElectronChromeExtensions after the
   * api object is built. Lets BrowserActionAPI.activateClick consult sidePanel
   * behavior (openPanelOnActionClick) so an action click opens the side panel
   * instead of firing onClicked. Structural type avoids an import cycle
   * (side-panel.ts imports this context).
   */
  sidePanel?: {
    getPanelBehavior(extensionId: string): { openPanelOnActionClick?: boolean }
    hasPanel(extensionId: string): boolean
    openFromAction(extensionId: string, tabId: number, windowId?: number): void
    notifyPanelState(
      opened: boolean,
      extensionId: string,
      info: { windowId: number; tabId?: number; path: string },
    ): void
  }
  /**
   * The DeclarativeNetRequestAPI instance, assigned in its constructor. Lets
   * WebRequestAPI consult DNR rules synchronously inside its existing session
   * webRequest callbacks (no separate network hook). Structural type avoids an
   * import cycle (declarative-net-request.ts imports this context).
   */
  declarativeNetRequest?: {
    /** Whether any block/allow/redirect rules are active for onBeforeRequest. */
    hasRules?(): boolean
    hasHeaderRules(kind: 'request' | 'response'): boolean
    matchBeforeRequest(details: {
      url: string
      resourceType?: string
      method?: string
      referrer?: string
      initiator?: string
      webContentsId?: number
      tabId?: number
    }): { cancel?: boolean; redirectUrl?: string } | undefined
    /** Like matchBeforeRequest but distinguishes an explicit `allow`. */
    decideBeforeRequest(details: {
      url: string
      resourceType?: string
      method?: string
      referrer?: string
      initiator?: string
    }): {
      action: 'block' | 'redirect' | 'upgradeScheme' | 'allow' | 'none'
      redirectUrl?: string
    }
    matchHeaders(
      details: {
        url: string
        resourceType?: string
        method?: string
        referrer?: string
        initiator?: string
        webContentsId?: number
        tabId?: number
      },
      kind: 'request' | 'response',
      headers: Array<{ name: string; value?: string }>,
    ): Array<{ name: string; value?: string }> | undefined
  }
}
