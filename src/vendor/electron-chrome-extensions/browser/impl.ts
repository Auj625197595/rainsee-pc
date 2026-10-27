/** App-specific implementation details for extensions. */
export interface ChromeExtensionImpl {
  createTab?(
    details: chrome.tabs.CreateProperties,
  ): Promise<[Electron.WebContents, Electron.BaseWindow]>
  selectTab?(tab: Electron.WebContents, window: Electron.BaseWindow): void
  removeTab?(tab: Electron.WebContents, window: Electron.BaseWindow): void
  /** Reorder a tab within its window's tab strip (0-based, already clamped). */
  moveTab?(tab: Electron.WebContents, window: Electron.BaseWindow, index: number): void

  /**
   * Populate additional details to a tab descriptor which gets passed back to
   * background pages and content scripts.
   */
  assignTabDetails?(details: chrome.tabs.Tab, tab: Electron.WebContents): void

  /** Resolve an internal/overlay WebContents to its stable Chrome tab id. */
  resolveTabId?(webContentsId: number): number | undefined

  createWindow?(details: chrome.windows.CreateData): Promise<Electron.BaseWindow>
  removeWindow?(window: Electron.BaseWindow): void
  /** Return the host window's intrinsic incognito mode when known. */
  isIncognitoWindow?(window: Electron.BaseWindow): boolean | undefined

  /**
   * Per-extension notification policy. 'block' drops notifications (and
   * reports permission level 'denied'); 'hide-name' shows them without the
   * extension name. Defaults to 'allow'.
   */
  getNotificationMode?(extensionId: string): 'allow' | 'block' | 'hide-name' | undefined

  requestPermissions?(
    extension: Electron.Extension,
    permissions: chrome.permissions.Permissions,
  ): Promise<boolean>

  /**
   * chrome.bookmarks backing store. The host app owns the bookmark data and is
   * responsible for converting it to/from the Chrome `BookmarkTreeNode` shape.
   * Each callback returns Chrome-shaped data so the vendored API layer stays
   * app-agnostic. Omit to leave `chrome.bookmarks` unimplemented.
   */
  bookmarks?: BookmarksImpl

  /**
   * chrome.history backing store. The host app owns the history data and is
   * responsible for converting it to/from the Chrome `HistoryItem` shape.
   * Omit to leave `chrome.history` unimplemented.
   */
  history?: HistoryImpl

  /**
   * Host-owned proxy preference coordinator. A browser can have multiple
   * proxy writers (profile settings, policy and extensions), so the extension
   * layer must not write Session.setProxy directly when this hook is present.
   */
  proxy?: ProxyImpl

  /**
   * chrome.management enable/disable + uninstall hooks. The host owns the
   * installed-extension lifecycle (persisting disabled state, removing from
   * disk). Omit to leave `setEnabled`/`uninstall` as no-ops.
   */
  management?: ManagementImpl

  /**
   * chrome.sidePanel host hook: display the extension's side panel for the
   * given tab. The host owns the panel container (a BrowserView docked in the
   * main window, like the AI/subscribe panels). Omit to leave
   * chrome.sidePanel.open as a no-op. `path` is the resolved panel HTML path
   * (per-tab override > global > manifest side_panel.default_path).
   */
  openSidePanel?(extensionId: string, tabId: number, path: string, windowId?: number): void
  /** chrome.sidePanel.close: hide the extension's panel in the given window. */
  closeSidePanel?(extensionId: string, windowId?: number): void
  /**
   * chrome.desktopCapture.chooseDesktopMedia host hook: show the browser's
   * screen/window picker and resolve with the desktopCapturer source the user
   * picked (or null when cancelled). `tabId` is the tab the picker should be
   * associated with, when the caller is known. Omit to make every
   * chooseDesktopMedia call resolve as cancelled.
   */
  chooseDesktopMedia?(details: {
    extensionId: string
    extensionName: string
    sources: string[]
    tabId?: number
  }): Promise<{ id: string; name: string; shareAudio: boolean } | null>
  /** Dismiss the picker opened by chooseDesktopMedia, if it is still showing. */
  cancelChooseDesktopMedia?(): void
  /**
   * Host hook for Chrome-owned extension resources such as
   * `chrome-extension://<id>/_favicon/?pageUrl=...`.
   * Return a replacement URL (typically a data URL) to keep the request
   * Chrome-compatible without requiring the vendor layer to know app details.
   */
  resolveChromeExtensionResourceUrl?(url: string): string | undefined
  /**
   * Host network fallback, evaluated synchronously in onBeforeRequest after
   * extension DNR decisions. Return a replacement URL to redirect the request
   * (Chromium performs a 307 internal redirect, preserving method and body).
   */
  resolveHostRequestRedirect?(url: string): string | undefined
}

export type ProxyLevelOfControl =
  | 'not_controllable'
  | 'controlled_by_other_extensions'
  | 'controllable_by_this_extension'
  | 'controlled_by_this_extension'

export interface ProxySettingSnapshot {
  value: any
  levelOfControl: ProxyLevelOfControl
}

export interface ProxyImpl {
  set(extensionId: string, value: any, config: Electron.ProxyConfig): Promise<void>
  clear(extensionId: string): Promise<void>
  get(extensionId: string): Promise<ProxySettingSnapshot>
  release(extensionId: string): Promise<void>
  onChanged?(listener: () => void): () => void
}

export interface ManagementImpl {
  setEnabled(id: string, enabled: boolean): Promise<boolean>
  uninstall(id: string): Promise<void>
}

export interface BookmarksImpl {
  /** Return the whole hierarchy rooted at the (synthetic) root node. */
  getTree(): Promise<chrome.bookmarks.BookmarkTreeNode[]>
  /** Return the nodes for the given id(s), preserving order. */
  get(idList: string[]): Promise<chrome.bookmarks.BookmarkTreeNode[]>
  /** Return the direct children of the folder with the given id. */
  getChildren(id: string): Promise<chrome.bookmarks.BookmarkTreeNode[]>
  /** Return the subtree rooted at the given id. */
  getSubTree(id: string): Promise<chrome.bookmarks.BookmarkTreeNode[]>
  /** Return the most recently added bookmarks (excluding folders). */
  getRecent(count: number): Promise<chrome.bookmarks.BookmarkTreeNode[]>
  /** Match bookmarks by free-text query or by url/title fields. */
  search(
    query: string | chrome.bookmarks.BookmarkSearchQuery,
  ): Promise<chrome.bookmarks.BookmarkTreeNode[]>
  create(bookmark: chrome.bookmarks.BookmarkCreateArg): Promise<chrome.bookmarks.BookmarkTreeNode>
  move(
    id: string,
    destination: chrome.bookmarks.BookmarkDestinationArg,
  ): Promise<chrome.bookmarks.BookmarkTreeNode>
  update(
    id: string,
    changes: chrome.bookmarks.BookmarkChangesArg,
  ): Promise<chrome.bookmarks.BookmarkTreeNode>
  /** Remove a single bookmark or empty folder. */
  remove(id: string): Promise<void>
  /** Recursively remove a folder and its contents. */
  removeTree(id: string): Promise<void>
}

export interface HistoryImpl {
  search(query: chrome.history.HistoryQuery): Promise<chrome.history.HistoryItem[]>
  getVisits(details: chrome.history.Url): Promise<chrome.history.VisitItem[]>
  addUrl(details: chrome.history.Url): Promise<void>
  deleteUrl(details: chrome.history.Url): Promise<void>
  deleteRange(range: chrome.history.Range): Promise<void>
  deleteAll(): Promise<void>
}
