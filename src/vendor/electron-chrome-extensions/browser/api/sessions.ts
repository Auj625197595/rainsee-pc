import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

// chrome.sessions. Gated on the "sessions" permission. A lightweight, in-memory
// "recently closed" list is maintained by observing the store's tab-removed
// signal (the store caches each tab's url/title, so we snapshot those on
// removal). restore() re-opens the url via impl.createTab. Cross-device sync
// (getDevices) is not available — returns []. This is enough for extensions
// that surface a "recently closed" menu or restore-on-restart UX.
interface ClosedEntry {
  lastModified: number
  tab?: { url?: string; title?: string }
}

const MAX_ENTRIES = 25

export class SessionsAPI {
  private recentlyClosed: ClosedEntry[] = []

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('sessions.getRecentlyClosed', this.getRecentlyClosed, { permission: 'sessions' })
    handle('sessions.restore', this.restore, { permission: 'sessions' })
    handle('sessions.getDevices', this.getDevices, { permission: 'sessions' })

    this.ctx.store.on('tab-removed', (tabId: number) => {
      const details = this.ctx.store.tabDetailsCache.get(tabId)
      if (!details || !details.url) return
      this.push({ lastModified: Date.now(), tab: { url: details.url, title: details.title } })
    })
  }

  private push(entry: ClosedEntry) {
    this.recentlyClosed.unshift(entry)
    if (this.recentlyClosed.length > MAX_ENTRIES) this.recentlyClosed.length = MAX_ENTRIES
    this.ctx.router.broadcastEvent('sessions.onChanged')
  }

  private getRecentlyClosed = (
    _event: ExtensionEvent,
    filter: { maxResults?: number } = {},
  ): chrome.sessions.Session[] => {
    const max = (filter && filter.maxResults) || 10
    return this.recentlyClosed.slice(0, max).map((entry) => ({
      lastModified: entry.lastModified,
      tab: entry.tab ? { url: entry.tab.url, title: entry.tab.title } : undefined,
    })) as chrome.sessions.Session[]
  }

  private restore = async (
    _event: ExtensionEvent,
    sessionId?: string,
  ): Promise<chrome.sessions.Session | undefined> => {
    let entry: ClosedEntry | undefined
    if (typeof sessionId === 'string') {
      const m = sessionId.match(/^tab(\d+)$/)
      if (m) entry = this.recentlyClosed[Number(m[1])]
    } else {
      entry = this.recentlyClosed[0]
    }
    if (!entry || !entry.tab || !entry.tab.url) return undefined
    const createTab = this.ctx.store.impl.createTab
    if (typeof createTab !== 'function') return undefined
    await createTab({ url: entry.tab.url, active: true })
    const idx = this.recentlyClosed.indexOf(entry)
    if (idx >= 0) this.recentlyClosed.splice(idx, 1)
    this.ctx.router.broadcastEvent('sessions.onChanged')
    return {
      lastModified: entry.lastModified,
      tab: { url: entry.tab.url, title: entry.tab.title },
    } as chrome.sessions.Session
  }

  private getDevices = (): chrome.sessions.Device[] => []
}
