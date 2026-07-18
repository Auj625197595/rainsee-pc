/** App-specific implementation details for extensions. */
export interface ChromeExtensionImpl {
  createTab?(
    details: chrome.tabs.CreateProperties,
  ): Promise<[Electron.WebContents, Electron.BaseWindow]>
  selectTab?(tab: Electron.WebContents, window: Electron.BaseWindow): void
  removeTab?(tab: Electron.WebContents, window: Electron.BaseWindow): void

  /**
   * Populate additional details to a tab descriptor which gets passed back to
   * background pages and content scripts.
   */
  assignTabDetails?(details: chrome.tabs.Tab, tab: Electron.WebContents): void

  createWindow?(details: chrome.windows.CreateData): Promise<Electron.BaseWindow>
  removeWindow?(window: Electron.BaseWindow): void
  /** Return the host window's intrinsic incognito mode when known. */
  isIncognitoWindow?(window: Electron.BaseWindow): boolean | undefined

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
  closeSidePanel?(extensionId?: string): void
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
