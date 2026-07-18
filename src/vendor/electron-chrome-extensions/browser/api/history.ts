import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

/**
 * chrome.history implementation.
 *
 * Like BookmarksAPI, this layer is app-agnostic: it registers handlers, gates
 * them behind the `history` manifest permission, delegates to the
 * host-provided `impl.history`, and broadcasts history events. The host owns
 * the data and the mapping to the Chrome `HistoryItem` shape.
 */
export class HistoryAPI {
  private get impl() {
    return this.ctx.store.impl.history
  }

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    const opts = { permission: 'history' as chrome.runtime.ManifestPermissions }

    handle('history.search', this.search.bind(this), opts)
    handle('history.getVisits', this.getVisits.bind(this), opts)
    handle('history.addUrl', this.addUrl.bind(this), opts)
    handle('history.deleteUrl', this.deleteUrl.bind(this), opts)
    handle('history.deleteRange', this.deleteRange.bind(this), opts)
    handle('history.deleteAll', this.deleteAll.bind(this), opts)
  }

  private requireImpl() {
    if (!this.impl) {
      throw new Error('chrome.history is not implemented')
    }
    return this.impl
  }

  private async search(_event: ExtensionEvent, query: chrome.history.HistoryQuery) {
    return this.requireImpl().search(query || ({ text: '' } as chrome.history.HistoryQuery))
  }

  private async getVisits(_event: ExtensionEvent, details: chrome.history.Url) {
    return this.requireImpl().getVisits(details)
  }

  private async addUrl(_event: ExtensionEvent, details: chrome.history.Url) {
    await this.requireImpl().addUrl(details)
  }

  private async deleteUrl(_event: ExtensionEvent, details: chrome.history.Url) {
    await this.requireImpl().deleteUrl(details)
    this.onVisitRemoved({ allHistory: false, urls: [details.url] })
  }

  private async deleteRange(_event: ExtensionEvent, range: chrome.history.Range) {
    await this.requireImpl().deleteRange(range)
    // Chrome reports a range deletion as a non-allHistory removal without
    // enumerating the affected urls.
    this.onVisitRemoved({ allHistory: false, urls: [] })
  }

  private async deleteAll(_event: ExtensionEvent) {
    await this.requireImpl().deleteAll()
    this.onVisitRemoved({ allHistory: true, urls: [] })
  }

  // ---- Events ----
  // Public so the host can fire onVisited as the browser records page visits.

  onVisited = (result: chrome.history.HistoryItem) => {
    this.ctx.router.broadcastEvent('history.onVisited', result)
  }

  onVisitRemoved = (removed: chrome.history.RemovedResult) => {
    this.ctx.router.broadcastEvent('history.onVisitRemoved', removed)
  }
}
