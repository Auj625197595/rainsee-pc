import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

// chrome.search. No manifest permission required. query() opens the given text
// in a new tab via the host's createTab impl, using a default search URL. The
// host's own default search engine would be the ideal source, but it lives in
// renderer settings; Google is used as a portable default and can be wired to
// the app setting later.
const DEFAULT_SEARCH_URL = 'https://www.google.com/search?q='

export class SearchAPI {
  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('search.query', this.query)
    handle('search.queryInTab', this.query)
  }

  private query = async (
    _event: ExtensionEvent,
    queryInfo: { text?: string; disposition?: string; tabId?: number } = {},
  ): Promise<void> => {
    const text = (queryInfo && queryInfo.text) || ''
    if (!text) return
    const url = DEFAULT_SEARCH_URL + encodeURIComponent(text)
    const createTab = this.ctx.store.impl.createTab
    if (typeof createTab !== 'function') return
    const active = queryInfo.disposition !== 'NEW_BACKGROUND_TAB'
    await createTab({ url, active })
  }
}
