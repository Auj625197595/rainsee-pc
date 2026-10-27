import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'
import debug from 'debug'

const d = debug('electron-chrome-extensions:declarativeContent')

// chrome.declarativeContent (MV3/MV2). Extensions typically disable their
// action globally (chrome.action.disable()) and register onPageChanged rules
// whose ShowAction/ShowPageAction re-enable it on matching pages. Without this
// API the SW threw on `new chrome.declarativeContent.PageStateMatcher` during
// top-level eval and the action stayed disabled forever (click = nothing).
//
// Rules live in memory per extension (background scripts re-register them on
// every start, as Chrome's docs recommend). They are evaluated against each
// tab's committed URL on navigation; a match sets a per-tab enabled override
// on the action, a non-match drops that override so the extension's own
// global/per-tab state applies again.
//
// Supported: PageStateMatcher.pageUrl (full UrlFilter). `css` / `isBookmarked`
// need page/bookmark observation we don't do; they're treated as satisfied so
// the action stays usable rather than stuck disabled. SetIcon /
// RequestContentScript actions are accepted but ignored.

interface UrlFilter {
  hostContains?: string
  hostEquals?: string
  hostPrefix?: string
  hostSuffix?: string
  pathContains?: string
  pathEquals?: string
  pathPrefix?: string
  pathSuffix?: string
  queryContains?: string
  queryEquals?: string
  queryPrefix?: string
  querySuffix?: string
  urlContains?: string
  urlEquals?: string
  urlMatches?: string
  originAndPathMatches?: string
  urlPrefix?: string
  urlSuffix?: string
  schemes?: string[]
  ports?: (number | number[])[]
}

interface Rule {
  id?: string
  priority?: number
  tags?: string[]
  conditions: any[]
  actions: any[]
}

/** Structural view of BrowserActionAPI (avoids an import cycle). */
export interface DeclarativeContentActionSink {
  setDeclarativeTabEnabled(extensionId: string, tabId: number, enabled: boolean | undefined): void
}

const SHOW_ACTIONS = new Set([
  'declarativeContent.ShowAction',
  'declarativeContent.ShowPageAction',
])

const matchesUrlFilter = (filter: UrlFilter | undefined, rawUrl: string): boolean => {
  if (!filter || typeof filter !== 'object') return true
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  // Chrome matches against the canonical URL without the fragment.
  const full = url.href.replace(/#.*$/, '')
  const host = url.hostname
  const path = url.pathname
  const query = url.search.replace(/^\?/, '')
  const originAndPath = `${url.protocol}//${url.host}${url.pathname}`

  const str = (v: unknown) => typeof v === 'string'
  if (str(filter.hostContains) && !`.${host}`.includes(filter.hostContains!)) return false
  if (str(filter.hostEquals) && host !== filter.hostEquals) return false
  if (str(filter.hostPrefix) && !host.startsWith(filter.hostPrefix!)) return false
  if (str(filter.hostSuffix) && !host.endsWith(filter.hostSuffix!)) return false
  if (str(filter.pathContains) && !path.includes(filter.pathContains!)) return false
  if (str(filter.pathEquals) && path !== filter.pathEquals) return false
  if (str(filter.pathPrefix) && !path.startsWith(filter.pathPrefix!)) return false
  if (str(filter.pathSuffix) && !path.endsWith(filter.pathSuffix!)) return false
  if (str(filter.queryContains) && !query.includes(filter.queryContains!)) return false
  if (str(filter.queryEquals) && query !== filter.queryEquals) return false
  if (str(filter.queryPrefix) && !query.startsWith(filter.queryPrefix!)) return false
  if (str(filter.querySuffix) && !query.endsWith(filter.querySuffix!)) return false
  if (str(filter.urlContains) && !full.includes(filter.urlContains!)) return false
  if (str(filter.urlEquals) && full !== filter.urlEquals) return false
  if (str(filter.urlPrefix) && !full.startsWith(filter.urlPrefix!)) return false
  if (str(filter.urlSuffix) && !full.endsWith(filter.urlSuffix!)) return false
  if (str(filter.urlMatches)) {
    try {
      if (!new RegExp(filter.urlMatches!).test(full)) return false
    } catch {
      return false
    }
  }
  if (str(filter.originAndPathMatches)) {
    try {
      if (!new RegExp(filter.originAndPathMatches!).test(originAndPath)) return false
    } catch {
      return false
    }
  }
  if (Array.isArray(filter.schemes) && filter.schemes.length > 0) {
    if (!filter.schemes.includes(url.protocol.replace(/:$/, ''))) return false
  }
  if (Array.isArray(filter.ports) && filter.ports.length > 0) {
    const port = url.port
      ? Number(url.port)
      : url.protocol === 'https:'
        ? 443
        : url.protocol === 'http:'
          ? 80
          : url.protocol === 'ftp:'
            ? 21
            : -1
    const ok = filter.ports.some((p) =>
      Array.isArray(p) ? port >= p[0] && port <= p[1] : port === p,
    )
    if (!ok) return false
  }
  return true
}

const conditionMatches = (condition: any, url: string): boolean => {
  if (!condition || condition.instanceType !== 'declarativeContent.PageStateMatcher') return false
  return matchesUrlFilter(condition.pageUrl, url)
}

export class DeclarativeContentAPI {
  private rules = new Map</* extensionId */ string, Rule[]>()
  // Tabs whose action we enabled, so a later non-match only clears overrides
  // this API set (not the extension's own action.enable/disable(tabId)).
  private shown = new Map</* extensionId */ string, Set<number>>()
  private ruleCounter = 0

  constructor(
    private ctx: ExtensionContext,
    private actions: DeclarativeContentActionSink,
  ) {
    const handle = this.ctx.router.apiHandler()
    const opts = { permission: 'declarativeContent' as chrome.runtime.ManifestPermissions }
    handle('declarativeContent.addRules', this.addRules, opts)
    handle('declarativeContent.removeRules', this.removeRules, opts)
    handle('declarativeContent.getRules', this.getRules, opts)

    this.ctx.store.on('tab-added', (tab: Electron.WebContents) => this.observeTab(tab))
    for (const tab of this.ctx.store.tabs) this.observeTab(tab)

    this.ctx.store.on('tab-removed', (tabId: number) => {
      for (const set of this.shown.values()) set.delete(tabId)
    })

    const sessionExtensions = (this.ctx.session as any).extensions || this.ctx.session
    sessionExtensions.on?.('extension-unloaded', (_event: any, extension: Electron.Extension) => {
      this.rules.delete(extension.id)
      this.shown.delete(extension.id)
    })
  }

  private observeTab(tab: Electron.WebContents) {
    if ((tab as any).__crxDeclContentObserved) return
    ;(tab as any).__crxDeclContentObserved = true
    const evaluate = () => {
      if (tab.isDestroyed()) return
      for (const extensionId of this.rules.keys()) this.evaluateTab(extensionId, tab)
    }
    tab.on('did-navigate', evaluate)
    tab.on('did-navigate-in-page', (_e: any, _url: string, isMainFrame: boolean) => {
      if (isMainFrame) evaluate()
    })
    // The host renderer may register a tab's toolbar entry after the first
    // commit; re-sending on load end keeps it in sync.
    tab.on('did-stop-loading', evaluate)
  }

  private evaluateTab(extensionId: string, tab: Electron.WebContents) {
    const rules = this.rules.get(extensionId) || []
    let url = ''
    try {
      url = tab.getURL()
    } catch {
      return
    }
    const show = rules.some(
      (rule) =>
        Array.isArray(rule.actions) &&
        rule.actions.some((a) => a && SHOW_ACTIONS.has(a.instanceType)) &&
        Array.isArray(rule.conditions) &&
        rule.conditions.some((c) => conditionMatches(c, url)),
    )
    let shown = this.shown.get(extensionId)
    if (!shown) this.shown.set(extensionId, (shown = new Set()))
    if (show) {
      shown.add(tab.id)
      this.actions.setDeclarativeTabEnabled(extensionId, tab.id, true)
    } else if (shown.has(tab.id)) {
      shown.delete(tab.id)
      this.actions.setDeclarativeTabEnabled(extensionId, tab.id, undefined)
    }
  }

  private evaluateAllTabs(extensionId: string) {
    for (const tab of this.ctx.store.tabs) {
      if (!tab.isDestroyed()) this.evaluateTab(extensionId, tab)
    }
  }

  private addRules = ({ extension }: ExtensionEvent, rules: Rule[] = []) => {
    const list = this.rules.get(extension.id) || []
    const added: Rule[] = []
    for (const rule of Array.isArray(rules) ? rules : []) {
      if (!rule || typeof rule !== 'object') continue
      const id = typeof rule.id === 'string' && rule.id ? rule.id : `_${++this.ruleCounter}_`
      if (list.some((r) => r.id === id)) {
        throw new Error(`Duplicate rule ID: ${id}`)
      }
      const stored: Rule = {
        id,
        priority: typeof rule.priority === 'number' ? rule.priority : 100,
        tags: Array.isArray(rule.tags) ? rule.tags : [],
        conditions: Array.isArray(rule.conditions) ? rule.conditions : [],
        actions: Array.isArray(rule.actions) ? rule.actions : [],
      }
      list.push(stored)
      added.push(stored)
    }
    this.rules.set(extension.id, list)
    d(`addRules ext=${extension.id} added=${added.length} total=${list.length}`)
    this.evaluateAllTabs(extension.id)
    return added
  }

  private removeRules = ({ extension }: ExtensionEvent, ruleIds?: string[] | null) => {
    const list = this.rules.get(extension.id) || []
    const next = Array.isArray(ruleIds) ? list.filter((r) => !ruleIds.includes(r.id!)) : []
    this.rules.set(extension.id, next)
    d(`removeRules ext=${extension.id} remaining=${next.length}`)
    this.evaluateAllTabs(extension.id)
  }

  private getRules = ({ extension }: ExtensionEvent, ruleIds?: string[] | null) => {
    const list = this.rules.get(extension.id) || []
    return Array.isArray(ruleIds) ? list.filter((r) => ruleIds.includes(r.id!)) : list
  }
}
