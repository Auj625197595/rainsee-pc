import { ExtensionContext } from '../context'

// chrome.topSites. Replaces the previous noop (which returned []). Pulls the
// host's browsing history via impl.history.search and ranks by visitCount —
// the same signal Chrome's "most visited" grid uses. Returns the top 20.
export class TopSitesAPI {
  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('topSites.get', this.get)
  }

  private get = async (): Promise<chrome.topSites.MostVisitedURL[]> => {
    const history = this.ctx.store.impl.history
    if (!history || typeof history.search !== 'function') return []
    try {
      const items = await history.search({ text: '', maxResults: 500 } as any)
      return items
        .slice()
        .sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0))
        .slice(0, 20)
        .map((item) => ({ title: item.title || '', url: item.url || '' }))
    } catch {
      return []
    }
  }
}
