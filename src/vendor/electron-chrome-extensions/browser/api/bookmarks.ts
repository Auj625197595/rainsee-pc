import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

/**
 * chrome.bookmarks implementation.
 *
 * The vendored layer is intentionally app-agnostic: it registers the API
 * handlers, gates them behind the `bookmarks` manifest permission, delegates
 * the actual data access to the host-provided `impl.bookmarks`, and broadcasts
 * the bookmark events. Mapping between the host's bookmark model and the Chrome
 * `BookmarkTreeNode` shape lives in the host (see sessions-service.ts).
 */
export class BookmarksAPI {
  private get impl() {
    return this.ctx.store.impl.bookmarks
  }

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    const opts = { permission: 'bookmarks' as chrome.runtime.ManifestPermissions }

    handle('bookmarks.get', this.get.bind(this), opts)
    handle('bookmarks.getChildren', this.getChildren.bind(this), opts)
    handle('bookmarks.getRecent', this.getRecent.bind(this), opts)
    handle('bookmarks.getTree', this.getTree.bind(this), opts)
    handle('bookmarks.getSubTree', this.getSubTree.bind(this), opts)
    handle('bookmarks.search', this.search.bind(this), opts)
    handle('bookmarks.create', this.create.bind(this), opts)
    handle('bookmarks.move', this.move.bind(this), opts)
    handle('bookmarks.update', this.update.bind(this), opts)
    handle('bookmarks.remove', this.remove.bind(this), opts)
    handle('bookmarks.removeTree', this.removeTree.bind(this), opts)
  }

  private requireImpl() {
    if (!this.impl) {
      throw new Error('chrome.bookmarks is not implemented')
    }
    return this.impl
  }

  private async get(_event: ExtensionEvent, idOrIdList: string | string[]) {
    const idList = Array.isArray(idOrIdList) ? idOrIdList : [idOrIdList]
    return this.requireImpl().get(idList)
  }

  private async getChildren(_event: ExtensionEvent, id: string) {
    return this.requireImpl().getChildren(id)
  }

  private async getRecent(_event: ExtensionEvent, numberOfItems: number) {
    return this.requireImpl().getRecent(numberOfItems)
  }

  private async getTree(_event: ExtensionEvent) {
    return this.requireImpl().getTree()
  }

  private async getSubTree(_event: ExtensionEvent, id: string) {
    return this.requireImpl().getSubTree(id)
  }

  private async search(
    _event: ExtensionEvent,
    query: string | chrome.bookmarks.BookmarkSearchQuery,
  ) {
    return this.requireImpl().search(query)
  }

  private async create(_event: ExtensionEvent, bookmark: chrome.bookmarks.BookmarkCreateArg) {
    // Events are broadcast by the host at the storage mutation point so that
    // both API- and UI-initiated changes notify exactly once.
    return this.requireImpl().create(bookmark || {})
  }

  private async move(
    _event: ExtensionEvent,
    id: string,
    destination: chrome.bookmarks.BookmarkDestinationArg,
  ) {
    return this.requireImpl().move(id, destination || {})
  }

  private async update(
    _event: ExtensionEvent,
    id: string,
    changes: chrome.bookmarks.BookmarkChangesArg,
  ) {
    return this.requireImpl().update(id, changes || {})
  }

  private async remove(_event: ExtensionEvent, id: string) {
    await this.requireImpl().remove(id)
  }

  private async removeTree(_event: ExtensionEvent, id: string) {
    await this.requireImpl().removeTree(id)
  }

  // ---- Events ----
  // These are public so the host can also fire them for changes that originate
  // in the browser UI (not just from extension API calls).

  onCreated = (bookmark: chrome.bookmarks.BookmarkTreeNode) => {
    this.ctx.router.broadcastEvent('bookmarks.onCreated', bookmark.id, bookmark)
  }

  onChanged = (id: string, changeInfo: chrome.bookmarks.BookmarkChangeInfo) => {
    this.ctx.router.broadcastEvent('bookmarks.onChanged', id, changeInfo)
  }

  onMoved = (id: string, moveInfo: chrome.bookmarks.BookmarkMoveInfo) => {
    this.ctx.router.broadcastEvent('bookmarks.onMoved', id, moveInfo)
  }

  onRemoved = (id: string, removeInfo: chrome.bookmarks.BookmarkRemoveInfo) => {
    this.ctx.router.broadcastEvent('bookmarks.onRemoved', id, removeInfo)
  }

  onChildrenReordered = (id: string, reorderInfo: chrome.bookmarks.BookmarkReorderInfo) => {
    this.ctx.router.broadcastEvent('bookmarks.onChildrenReordered', id, reorderInfo)
  }
}
