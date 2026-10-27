import { promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { app } from 'electron'
import debug from 'debug'

import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'
import { resolveExtensionPath } from './common'

const d = debug('electron-chrome-extensions:dnr')
const CRX_PERF = process.env.CRX_PERF === '1' || process.env.CRX_VERBOSE === '1'
const CRX_DEBUG = process.env.CRX_WEBREQUEST_DEBUG === '1' || process.env.CRX_VERBOSE === '1'
let headerMatchLogCount = 0

const DNR_PERMISSIONS = ['declarativeNetRequest', 'declarativeNetRequestWithHostAccess']

/** chrome.declarativeNetRequest.ResourceType values (snake_case, per spec). */
const RESOURCE_TYPE_MAP: Record<string, string> = {
  mainFrame: 'main_frame',
  subFrame: 'sub_frame',
  xhr: 'xmlhttprequest',
  fetch: 'xmlhttprequest',
  cspReport: 'csp_report',
  webSocket: 'websocket',
}
const normalizeResourceType = (t?: string) => (t ? RESOURCE_TYPE_MAP[t] || t : 'other')

interface DNRRule {
  id: number
  priority?: number
  action: any
  condition: any
}

interface CompiledRule {
  extensionId: string
  id: number
  priority: number
  source: 'static' | 'dynamic' | 'session'
  rulesetId: string
  action: any
  condition: any
  urlRe?: RegExp | null
  urlLiteral?: string
  urlLiteralCaseSensitive?: boolean
  regexRe?: RegExp | null
  domainHints?: string[]
}

export interface DNRRequest {
  url: string
  type: string
  initiator?: string
  requestHost?: string
  initiatorHost?: string
  urlLower?: string
  method?: string
  tabId?: number
  frame?: Electron.WebFrameMain | null
  requestId?: string
}

type RuleStage = 'beforeRequest' | 'allow' | 'requestHeaders' | 'responseHeaders'

interface RuleIndex {
  all: CompiledRule[]
  general: CompiledRule[]
  generalFallback: CompiledRule[]
  byHost: Map<string, CompiledRule[]>
  byToken: Map<string, CompiledRule[]>
  extensionIds: string[]
}

interface PerfBucket {
  calls: number
  candidates: number
  totalMs: number
  maxMs: number
}

const emptyRuleIndex = (): RuleIndex => ({
  all: [],
  general: [],
  generalFallback: [],
  byHost: new Map(),
  byToken: new Map(),
  extensionIds: [],
})

const emptyPerfBucket = (): PerfBucket => ({
  calls: 0,
  candidates: 0,
  totalMs: 0,
  maxMs: 0,
})

const hostOf = (url?: string): string => {
  if (!url) return ''
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Whether `host` is `domain` or a subdomain of it. */
const hostInDomain = (host: string, domain: string) => {
  domain = domain.toLowerCase().replace(/^\./, '')
  return host === domain || host.endsWith(`.${domain}`)
}
const hostInAnyDomain = (host: string, domains: string[]) => !!host && domains.some((dom) => hostInDomain(host, dom))

// Curated set of common two-label public suffixes (co.uk, com.cn, …) so the
// naive "last two labels" registrable-domain computation doesn't treat
// `example.co.uk` as `co.uk` (which would mis-classify two different *.co.uk
// sites as first-party). Not a full Public Suffix List, but covers the common
// cases that matter for `domainType: thirdParty|firstParty` detection.
const MULTI_PART_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'net.uk',
  'me.uk',
  'sch.uk',
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'edu.cn',
  'ac.cn',
  'co.jp',
  'or.jp',
  'ne.jp',
  'ac.jp',
  'go.jp',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'gov.au',
  'co.nz',
  'co.kr',
  'co.in',
  'co.id',
  'co.th',
  'co.za',
  'com.br',
  'com.ar',
  'com.mx',
  'com.tw',
  'com.hk',
  'com.sg',
  'com.my',
  'com.ph',
  'com.vn',
  'com.tr',
  'com.ua',
  'com.ru',
  'com.pl',
])

/** Registrable (eTLD+1) domain, accounting for the curated multi-part suffixes. */
const registrableDomain = (host: string): string => {
  const h = (host || '').toLowerCase()
  const parts = h.split('.')
  if (parts.length <= 2) return h
  const last2 = parts.slice(-2).join('.')
  if (MULTI_PART_SUFFIXES.has(last2) && parts.length >= 3) {
    return parts.slice(-3).join('.')
  }
  return last2
}

// eTLD+1 comparison for domainType first/third-party detection.
const sameSite = (a: string, b: string) => registrableDomain(a) === registrableDomain(b)

const escapeReChar = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const normalizeDomainHint = (domain: string) =>
  String(domain || '')
    .toLowerCase()
    .replace(/^\./, '')
    .replace(/\.$/, '')

const addDomainHint = (set: Set<string>, domain: string) => {
  const normalized = normalizeDomainHint(domain)
  if (normalized && normalized !== '*') set.add(normalized)
}

const anchoredHostFromUrlFilter = (urlFilter: string): string => {
  let authorityStart = -1
  if (urlFilter.startsWith('||')) {
    authorityStart = 2
  } else {
    const absolute = urlFilter.match(/^\|[a-z][a-z0-9+.-]*:\/\//i)
    if (absolute) authorityStart = absolute[0].length
  }
  if (authorityStart < 0) return ''

  const authority = urlFilter.slice(authorityStart).split(/[\/^:?#|]/, 1)[0]
  const host = authority.startsWith('*.') ? authority.slice(2) : authority
  // An internal wildcard makes the eventual request host unknowable. Indexing
  // a partial prefix (for example `telemetry` from `telemetry*.example.com`)
  // creates a bucket no real hostname suffix can reach and silently drops the
  // rule. Such filters stay in the token/fallback index instead.
  return host && !host.includes('*') && /^[a-z0-9._-]+$/i.test(host) ? host : ''
}

export const extractDomainHints = (cond: any): string[] => {
  const hints = new Set<string>()
  for (const domain of cond?.requestDomains || []) addDomainHint(hints, domain)
  const urlFilter = typeof cond?.urlFilter === 'string' ? cond.urlFilter : ''
  const anchoredDomain = anchoredHostFromUrlFilter(urlFilter)
  if (anchoredDomain) addDomainHint(hints, anchoredDomain)
  return Array.from(hints)
}

/**
 * Compile a DNR `urlFilter` to a RegExp per the spec's mini-language:
 *   `||` domain anchor · `|` start/end anchor · `^` separator · `*` wildcard.
 * @see https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#property-RuleCondition-urlFilter
 */
const compileUrlFilter = (filter: string, caseSensitive: boolean): RegExp => {
  let re = ''
  let i = 0
  const n = filter.length
  if (filter.startsWith('||')) {
    // scheme://(optional subdomains.)
    re += '^[a-z][a-z0-9+.-]*://(?:[^/:?#]*\\.)?'
    i = 2
  } else if (filter[0] === '|') {
    re += '^'
    i = 1
  }
  let end = n
  let anchorEnd = false
  if (n > 0 && filter[n - 1] === '|') {
    anchorEnd = true
    end = n - 1
  }
  for (; i < end; i++) {
    const c = filter[i]
    if (c === '*') re += '.*'
    else if (c === '^') re += '(?:[^a-zA-Z0-9_.%-]|$)'
    else re += escapeReChar(c)
  }
  if (anchorEnd) re += '$'
  return new RegExp(re, caseSensitive ? '' : 'i')
}

const actionRank = (type: string) =>
  type === 'allow' ? 5 : type === 'allowAllRequests' ? 4 : type === 'block' ? 3 : type === 'upgradeScheme' ? 2 : 1

const crossExtensionActionRank = (type: string) =>
  type === 'block' ? 3 : type === 'redirect' || type === 'upgradeScheme' ? 2 : 1

/**
 * Crude safety guard against catastrophic-backtracking regexes. Chrome's DNR
 * uses RE2 (linear time, no backtracking); JS `RegExp` isn't, so a sloppy
 * `regexFilter` matched synchronously on every request could freeze the network
 * path. This refuses the classic ReDoS shapes and caps source length. It's a
 * heuristic, not a proof — but it keeps the worst offenders out of the hot loop.
 */
const isRegexSafe = (src: string): boolean => {
  if (typeof src !== 'string' || src.length === 0 || src.length > 2048) return false
  // Nested quantifier right after a repeated group: `(a+)+`, `(a*)*`,
  // `(?:.+){2,}`. Require the inner quantifier at the END of the group;
  // scanning any `?` inside falsely rejects non-capturing/optional syntax such
  // as `(?:\.min)?` and lazy syntax such as `(.+?)`.
  if (/\((?:\?:)?[^()]*(?:[+*?]|\{\d+(?:,\d*)?\})\??\)(?:[+*?]|\{\d+(?:,\d*)?\})/.test(src)) return false
  // Do not reject `+?`, `*?`, `??` or `{m,n}?`: the trailing `?` makes a
  // quantifier lazy and is standard regex syntax. Invalid doubled quantifiers
  // such as `a++` / `a**` are rejected by `new RegExp` below.
  // Unbounded repetition on an alternation group, e.g. `(a|aa)*` / `(a|.)+`,
  // can be catastrophic. A single optional group such as `(\.bg|\.sub)?` is
  // bounded to one attempt and is valid RE2/DNR syntax, so do not reject `?`.
  if (/\([^)]*\|[^)]*\)(?:\+|\*|\{\d+,\})/.test(src)) return false
  // Greedy wildcard nested under repetition, e.g. `(.*)+`, `(.+)*`, `(?:.+){2,}`.
  if (/\((?:\?:)?\.(?:\*|\+)\)(?:\+|\*|\?|\{\d+(?:,\d*)?\})/.test(src)) return false
  return true
}

/**
 * RE2 accepts redundant repetition such as `([^/]+)+` and evaluates it in
 * linear time. JavaScript RegExp backtracks, but this particular shape has an
 * exact safe equivalent: remove the outer `+`. Tampermonkey's OpenUserJS
 * installer rules use this form. Keep literal/group cases like `(a+)+`
 * untouched so the safety guard still rejects genuinely ambiguous nesting.
 */
const normalizeRegexForJs = (src: string): string =>
  src.replace(
    /\((\?:)?(\[(?:\\.|[^\]\\])+\])\+\)\+/g,
    (_match, nonCapturing: string | undefined, characterClass: string) => `(${nonCapturing || ''}${characterClass}+)`,
  )

/**
 * A pragmatic `chrome.declarativeNetRequest` implementation.
 *
 * Supports static rulesets (manifest `declarative_net_request.rule_resources`),
 * dynamic rules and session rules, with `block` / `allow` / `allowAllRequests`
 * / `redirect` / `upgradeScheme` / `modifyHeaders` actions and the common
 * conditions (`urlFilter`, `regexFilter`, `resourceTypes`, request/initiator
 * domains, `requestMethods`, `domainType`, priority + allow-override).
 *
 * Enforcement is driven SYNCHRONOUSLY from WebRequestAPI's existing session
 * listeners (see web-request.ts) — this class never registers its own
 * webRequest hook, avoiding both the single-listener conflict with the host's
 * ad blocker and the Electron-42 async-callback crash. Rules are always stored,
 * so DNR extensions load and register even when the host blocker owns the
 * network hook.
 */
export class DeclarativeNetRequestAPI {
  /** Max regexFilter rules enforced; regexes are the expensive per-request path. */
  private static readonly REGEX_CAP = 1000
  /** How many recent matches to keep for getMatchedRules / onRuleMatchedDebug. */
  private static readonly MATCHED_RING_SIZE = 500

  private staticRules = new Map</* extId */ string, Map</* rulesetId */ string, CompiledRule[]>>()
  private enabledRulesets = new Map</* extId */ string, Set<string>>()
  private dynamicRules = new Map</* extId */ string, CompiledRule[]>()
  private sessionRules = new Map</* extId */ string, CompiledRule[]>()

  /** Flattened active rules across all DNR extensions; rebuilt on any change. */
  private active: CompiledRule[] = []
  /** Per-stage indexes keep header processing away from unrelated block rules. */
  private ruleIndexes: Record<RuleStage, RuleIndex> = {
    beforeRequest: emptyRuleIndex(),
    allow: emptyRuleIndex(),
    requestHeaders: emptyRuleIndex(),
    responseHeaders: emptyRuleIndex(),
  }
  private perfStartedAt = Date.now()
  private perf: Record<RuleStage, PerfBucket> = {
    beforeRequest: emptyPerfBucket(),
    allow: emptyPerfBucket(),
    requestHeaders: emptyPerfBucket(),
    responseHeaders: emptyPerfBucket(),
  }
  /** Frame-scoped allowAllRequests grants, isolated per extension. */
  private allowAllRequests = new WeakMap<Electron.WebFrameMain, Map<string, number>>()
  private loadedExtensions = new Set<string>()
  private extensionOrder = new Map<string, number>()
  private nextExtensionOrder = 1

  /** Recent matches are private to the extension that owns the rule. */
  private matchedRings = new Map<string, any[]>()

  /** Persistent store for dynamic rules + enabled rulesets across restarts. */
  private readonly dnrFile = join(app.getPath('userData'), 'crx-dnr-rules.json')
  private persistTimer: NodeJS.Timeout | null = null

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('declarativeNetRequest.updateDynamicRules', this.updateDynamicRules.bind(this))
    handle('declarativeNetRequest.getDynamicRules', this.getDynamicRules.bind(this))
    handle('declarativeNetRequest.updateSessionRules', this.updateSessionRules.bind(this))
    handle('declarativeNetRequest.getSessionRules', this.getSessionRules.bind(this))
    handle('declarativeNetRequest.getEnabledRulesets', this.getEnabledRulesets.bind(this))
    handle('declarativeNetRequest.updateEnabledRulesets', this.updateEnabledRulesets.bind(this))
    handle('declarativeNetRequest.getAvailableStaticRuleCount', this.getAvailableStaticRuleCount.bind(this))
    handle('declarativeNetRequest.getMatchedRules', this.getMatchedRules.bind(this))
    handle('declarativeNetRequest.isRegexSupported', this.isRegexSupported.bind(this))
    handle('declarativeNetRequest.setExtensionActionOptions', this.setExtensionActionOptions.bind(this))

    // Expose to WebRequestAPI for synchronous enforcement.
    this.ctx.declarativeNetRequest = this

    // Network hooks are synchronous, so persisted rules must be available
    // before the first request can reach decideBeforeRequest().
    this.loadPersistedSync()

    const sessionExtensions = ctx.session.extensions || ctx.session
    sessionExtensions.getAllExtensions?.().forEach((ext: Electron.Extension) => this.loadStatic(ext))
    sessionExtensions.on('extension-loaded', (_e: any, ext: Electron.Extension) => this.loadStatic(ext))
    sessionExtensions.on('extension-unloaded', (_e: any, ext: Electron.Extension) => {
      this.loadedExtensions.delete(ext.id)
      this.staticRules.delete(ext.id)
      this.sessionRules.delete(ext.id)
      this.matchedRings.delete(ext.id)
      this.rebuild()
    })
    this.ctx.permissions?.onChanged((extensionId) => {
      const extension = this.getExtension(extensionId)
      if (extension) this.loadStatic(extension)
      else this.rebuild()
    })
  }

  private assertDnrPermission(extension: Electron.Extension) {
    if (!DNR_PERMISSIONS.some((permission) => this.hasPermission(extension, permission))) {
      throw new Error('declarativeNetRequest permission is required')
    }
  }

  private hasPermission(extension: Electron.Extension, permission: string): boolean {
    return (
      extension.manifest?.permissions?.includes(permission) ||
      this.ctx.permissions?.hasPermission(extension.id, permission) === true
    )
  }

  private compile(
    extensionId: string,
    rule: DNRRule,
    meta: { source: 'static' | 'dynamic' | 'session'; rulesetId: string },
  ): CompiledRule | null {
    if (!rule || !Number.isInteger(rule.id) || rule.id <= 0 || !rule.action || !rule.condition) {
      throw new Error('Invalid DNR rule: id must be a positive integer and action/condition are required')
    }
    if (rule.priority !== undefined && (!Number.isInteger(rule.priority) || (rule.priority as number) <= 0)) {
      throw new Error(`Invalid priority for rule ${rule.id}`)
    }
    const actionTypes = new Set(['block', 'allow', 'allowAllRequests', 'redirect', 'upgradeScheme', 'modifyHeaders'])
    if (!actionTypes.has(rule.action.type)) throw new Error(`Invalid action for rule ${rule.id}`)
    const cond = rule.condition
    if (cond.urlFilter && cond.regexFilter) {
      throw new Error(`Rule ${rule.id} cannot specify both urlFilter and regexFilter`)
    }
    const caseSensitive = cond.isUrlFilterCaseSensitive === true
    let urlRe: RegExp | null = null
    let urlLiteral: string | undefined
    let regexRe: RegExp | null = null
    try {
      if (typeof cond.urlFilter === 'string' && cond.urlFilter) {
        if (!/[*^|]/.test(cond.urlFilter)) {
          urlLiteral = caseSensitive ? cond.urlFilter : cond.urlFilter.toLowerCase()
        } else {
          urlRe = compileUrlFilter(cond.urlFilter, caseSensitive)
        }
      }
      if (typeof cond.regexFilter === 'string' && cond.regexFilter) {
        // Guard against catastrophic-backtracking regexes (see isRegexSafe) —
        // Chrome uses RE2; JS RegExp isn't linear, so an unsafe pattern run
        // synchronously per request could freeze the network thread.
        const normalizedRegex = normalizeRegexForJs(cond.regexFilter)
        if (!isRegexSafe(normalizedRegex)) {
          throw new Error(`Rule ${rule.id} contains an unsupported regexFilter`)
        } else {
          regexRe = new RegExp(normalizedRegex, caseSensitive ? '' : 'i')
        }
      }
    } catch (err) {
      throw new Error(`Failed to compile rule ${rule.id}: ${(err as Error)?.message || err}`)
    }
    return {
      extensionId,
      id: rule.id,
      priority: typeof rule.priority === 'number' ? rule.priority : 1,
      source: meta.source,
      rulesetId: meta.rulesetId,
      action: rule.action,
      condition: cond,
      urlRe,
      urlLiteral,
      urlLiteralCaseSensitive: caseSensitive,
      regexRe,
      domainHints: extractDomainHints(cond),
    }
  }

  private loadStatic(extension: Electron.Extension) {
    const manifest: any = extension.manifest
    this.loadedExtensions.add(extension.id)
    if (!this.extensionOrder.has(extension.id)) {
      this.extensionOrder.set(extension.id, this.nextExtensionOrder++)
    }
    if (!DNR_PERMISSIONS.some((permission) => this.hasPermission(extension, permission))) {
      this.rebuild()
      return
    }
    const dnr = manifest.declarative_net_request
    const resources: any[] = (dnr && dnr.rule_resources) || []
    if (!Array.isArray(resources) || resources.length === 0) {
      this.staticRules.set(extension.id, new Map())
      this.rebuild()
      return
    }

    const byRuleset = new Map<string, CompiledRule[]>()
    const enabled = new Set<string>()
    for (const res of resources) {
      const rulesetId = res.id
      if (!rulesetId || !res.path) continue
      if (res.enabled) enabled.add(rulesetId)
      const filePath = resolveExtensionPath(extension, res.path)
      if (!filePath) continue
      try {
        const raw = readFileSync(filePath, 'utf8')
        const rules: DNRRule[] = JSON.parse(raw)
        // Chrome skips an invalid static rule (install-time warning) and keeps
        // the rest of the ruleset; one bad rule used to discard the whole file.
        const compiled: CompiledRule[] = []
        let skipped = 0
        for (const r of Array.isArray(rules) ? rules : []) {
          try {
            const c = this.compile(extension.id, r, { source: 'static', rulesetId })
            if (c) compiled.push(c)
          } catch (err) {
            skipped++
            if (skipped <= 3) d('skip invalid static rule in %s for %s: %s', rulesetId, extension.id, err)
          }
        }
        if (skipped) {
          console.warn(
            `[crx-dnr] ruleset ${rulesetId} of ${extension.id}: skipped ${skipped} invalid rule(s)`,
          )
        }
        byRuleset.set(rulesetId, compiled)
        d('loaded static ruleset %s (%d rules) for %s', rulesetId, compiled.length, extension.id)
      } catch (err) {
        d('failed to read ruleset %s for %s: %o', rulesetId, extension.id, err)
      }
    }
    this.staticRules.set(extension.id, byRuleset)
    if (!this.enabledRulesets.has(extension.id)) this.enabledRulesets.set(extension.id, enabled)
    this.rebuild()
  }

  /**
   * Rebuild the flattened active-rule list used by the synchronous matcher.
   *
   * Large static rulesets are no longer dropped outright. Instead, rules that
   * carry a request-host hint are indexed by host so the hot path scans only the
   * relevant subset for the current URL, with hostless rules kept in a smaller
   * general list.
   */
  private rebuild() {
    const dynamicSession: CompiledRule[] = []
    for (const [extensionId, rules] of this.dynamicRules) {
      if (this.isExtensionActive(extensionId)) dynamicSession.push(...rules)
    }
    for (const [extensionId, rules] of this.sessionRules) {
      if (this.isExtensionActive(extensionId)) dynamicSession.push(...rules)
    }

    const staticActive: CompiledRule[] = []
    for (const [extId, byRuleset] of this.staticRules) {
      if (!this.isExtensionActive(extId)) continue
      const enabled = this.enabledRulesets.get(extId)
      for (const [rulesetId, rules] of byRuleset) {
        if (enabled && !enabled.has(rulesetId)) continue
        staticActive.push(...rules)
      }
    }

    this.active = staticActive.concat(dynamicSession)

    // Cap regex-bearing rules: a regex is matched once more per request, so
    // thousands of them are the expensive path. Keep non-regex rules as-is and
    // retain only the first REGEX_CAP regex rules (others are dropped from
    // enforcement, matching Chrome's MAX_NUMBER_OF_REGEX_RULES behavior).
    const regexKept: CompiledRule[] = []
    const regexCounts = new Map<string, number>()
    const rest: CompiledRule[] = []
    for (const rule of this.active) {
      if (rule.regexRe) {
        const count = regexCounts.get(rule.extensionId) || 0
        if (count < DeclarativeNetRequestAPI.REGEX_CAP) {
          regexKept.push(rule)
          regexCounts.set(rule.extensionId, count + 1)
        }
      } else {
        rest.push(rule)
      }
    }
    this.active = rest.concat(regexKept)
    const beforeRequest = this.active.filter((rule) =>
      ['block', 'allow', 'allowAllRequests', 'redirect', 'upgradeScheme'].includes(rule.action?.type),
    )
    const allow = beforeRequest.filter((rule) => ['allow', 'allowAllRequests'].includes(rule.action?.type))
    const requestHeaders = this.active.filter(
      (rule) => rule.action?.type === 'modifyHeaders' && Array.isArray(rule.action?.requestHeaders),
    )
    const responseHeaders = this.active.filter(
      (rule) => rule.action?.type === 'modifyHeaders' && Array.isArray(rule.action?.responseHeaders),
    )
    this.ruleIndexes = {
      beforeRequest: this.buildRuleIndex(beforeRequest),
      allow: this.buildRuleIndex(allow),
      requestHeaders: this.buildRuleIndex(requestHeaders),
      responseHeaders: this.buildRuleIndex(responseHeaders),
    }
    const beforeIndex = this.ruleIndexes.beforeRequest
    if (CRX_PERF) {
      console.log(
        `[crx-dnr] active=${this.active.length} before=${beforeRequest.length} ` +
          `general=${beforeIndex.general.length} hostBuckets=${beforeIndex.byHost.size} ` +
          `tokenBuckets=${beforeIndex.byToken.size} fallback=${beforeIndex.generalFallback.length} ` +
          `requestHeaders=${requestHeaders.length} responseHeaders=${responseHeaders.length}`,
      )
    }
    d(
      'rebuilt active DNR rules: %d (hostBuckets=%d general=%d)',
      this.active.length,
      beforeIndex.byHost.size,
      beforeIndex.general.length,
    )
  }

  private buildRuleIndex(rules: CompiledRule[]): RuleIndex {
    const index: RuleIndex = {
      all: rules,
      general: [],
      generalFallback: [],
      byHost: new Map(),
      byToken: new Map(),
      extensionIds: Array.from(new Set(rules.map((rule) => rule.extensionId))),
    }

    // Most uBO Lite general rules are simple substring filters. Give each one
    // a rare trigram so a request only tests rules whose token occurs in its
    // URL, while ruleMatches still performs the authoritative full check.
    const tokenFrequency = new Map<string, number>()
    const tokensByRule = new Map<CompiledRule, string[]>()
    for (const rule of rules) {
      if ((rule.domainHints?.length || 0) > 0) continue
      const seen = new Set<string>()
      const parts = rule.urlLiteral
        ? [rule.urlLiteral]
        : typeof rule.condition?.urlFilter === 'string'
        ? rule.condition.urlFilter.split(/[*^|]+/)
        : []
      for (const part of parts) {
        const literal = part.toLowerCase()
        for (let i = 0; i <= literal.length - 3; i++) seen.add(literal.slice(i, i + 3))
      }
      if (seen.size === 0) continue
      tokensByRule.set(rule, Array.from(seen))
      for (const token of seen) tokenFrequency.set(token, (tokenFrequency.get(token) || 0) + 1)
    }
    for (const rule of rules) {
      if (rule.domainHints && rule.domainHints.length > 0) {
        for (const host of rule.domainHints) {
          const bucket = index.byHost.get(host) || []
          bucket.push(rule)
          index.byHost.set(host, bucket)
        }
      } else {
        index.general.push(rule)
        const tokens = tokensByRule.get(rule)
        if (tokens && tokens.length > 0) {
          let bestToken = tokens[0]
          let bestFrequency = tokenFrequency.get(bestToken) || Number.MAX_SAFE_INTEGER
          for (let i = 1; i < tokens.length; i++) {
            const token = tokens[i]
            const frequency = tokenFrequency.get(token) || Number.MAX_SAFE_INTEGER
            if (frequency < bestFrequency) {
              bestToken = token
              bestFrequency = frequency
            }
          }
          const bucket = index.byToken.get(bestToken) || []
          bucket.push(rule)
          index.byToken.set(bestToken, bucket)
        } else {
          index.generalFallback.push(rule)
        }
      }
    }
    return index
  }

  private getExtension(extensionId: string): Electron.Extension | undefined {
    const extensions = this.ctx.session.extensions || this.ctx.session
    return extensions.getExtension?.(extensionId)
  }

  private isExtensionActive(extensionId: string): boolean {
    const extension = this.loadedExtensions.has(extensionId) ? this.getExtension(extensionId) : undefined
    if (!extension) return false
    return DNR_PERMISSIONS.some((permission) => this.hasPermission(extension, permission))
  }

  // ---- Matching (called synchronously from WebRequestAPI) ------------------

  private ruleMatches(rule: CompiledRule, req: DNRRequest): boolean {
    const cond = rule.condition || {}
    const type = req.type
    if (Array.isArray(cond.resourceTypes) && cond.resourceTypes.length && !cond.resourceTypes.includes(type))
      return false
    if (Array.isArray(cond.excludedResourceTypes) && cond.excludedResourceTypes.includes(type)) return false

    if (Array.isArray(cond.requestMethods) && cond.requestMethods.length) {
      const m = (req.method || 'get').toLowerCase()
      if (!cond.requestMethods.includes(m)) return false
    }
    if (Array.isArray(cond.excludedRequestMethods) && cond.excludedRequestMethods.length) {
      const m = (req.method || 'get').toLowerCase()
      if (cond.excludedRequestMethods.includes(m)) return false
    }

    if (rule.urlLiteral) {
      const haystack = rule.urlLiteralCaseSensitive ? req.url : req.urlLower || ''
      if (!haystack.includes(rule.urlLiteral)) return false
    }
    if (rule.urlRe && !rule.urlRe.test(req.url)) return false
    if (rule.regexRe && !rule.regexRe.test(req.url)) return false

    const host = req.requestHost || ''
    if (Array.isArray(cond.requestDomains) && cond.requestDomains.length && !hostInAnyDomain(host, cond.requestDomains))
      return false
    if (Array.isArray(cond.excludedRequestDomains) && hostInAnyDomain(host, cond.excludedRequestDomains)) return false

    const initHost = req.initiatorHost || ''
    const initDomains = cond.initiatorDomains || cond.domains
    if (Array.isArray(initDomains) && initDomains.length && !hostInAnyDomain(initHost, initDomains)) return false
    const exInit = cond.excludedInitiatorDomains || cond.excludedDomains
    if (Array.isArray(exInit) && initHost && hostInAnyDomain(initHost, exInit)) return false

    if (cond.domainType === 'thirdParty' && initHost && host && sameSite(host, initHost)) return false
    if (cond.domainType === 'firstParty' && initHost && host && !sameSite(host, initHost)) return false

    if (Array.isArray(cond.tabIds) && cond.tabIds.length) {
      if (typeof req.tabId !== 'number' || !cond.tabIds.includes(req.tabId)) return false
    }
    if (
      Array.isArray(cond.excludedTabIds) &&
      cond.excludedTabIds.length &&
      typeof req.tabId === 'number' &&
      cond.excludedTabIds.includes(req.tabId)
    ) {
      return false
    }
    return true
  }

  private candidatesFor(req: DNRRequest, stage: RuleStage = 'beforeRequest'): CompiledRule[] {
    const index = this.ruleIndexes[stage]
    const host = req.requestHost || ''
    if (!host) return index.all
    let tokenMatches: CompiledRule[] | undefined
    if (index.byToken.size > 0 && req.urlLower && req.urlLower.length >= 3) {
      const seenTokens = new Set<string>()
      for (let i = 0; i <= req.urlLower.length - 3; i++) {
        const token = req.urlLower.slice(i, i + 3)
        if (seenTokens.has(token)) continue
        seenTokens.add(token)
        const bucket = index.byToken.get(token)
        if (!bucket) continue
        if (!tokenMatches) tokenMatches = []
        tokenMatches.push(...bucket)
      }
    }
    let extras: CompiledRule[] | undefined
    let seen: Set<CompiledRule> | undefined
    const labels = host.split('.')
    for (let i = 0; i < labels.length; i++) {
      const suffix = labels.slice(i).join('.')
      const bucket = index.byHost.get(suffix)
      if (!bucket) continue
      for (const rule of bucket) {
        if (!seen) seen = new Set()
        if (seen.has(rule)) continue
        seen.add(rule)
        if (!extras) extras = []
        extras.push(rule)
      }
    }
    if (!tokenMatches && !extras) return index.generalFallback
    return index.generalFallback.concat(tokenMatches || [], extras || [])
  }

  private inheritedAllowPriority(frame: Electron.WebFrameMain | null | undefined, extensionId: string): number {
    let priority = 0
    let current = frame || null
    while (current) {
      const granted = this.allowAllRequests.get(current)?.get(extensionId) || 0
      if (granted > priority) priority = granted
      current = current.parent
    }
    return priority
  }

  private grantAllowAll(frame: Electron.WebFrameMain | null | undefined, extensionId: string, priority: number) {
    if (!frame) return
    let grants = this.allowAllRequests.get(frame)
    if (!grants) {
      grants = new Map()
      this.allowAllRequests.set(frame, grants)
    }
    const current = grants.get(extensionId) || 0
    if (priority > current) grants.set(extensionId, priority)
  }

  /** Highest-priority matching rule, with allow-override at equal priority. */
  private winnerForExtension(
    req: DNRRequest,
    extensionId: string,
    types: string[],
    inheritedAllowPriority: number = 0,
    candidates: CompiledRule[] = this.candidatesFor(req),
  ): CompiledRule | undefined {
    let best: CompiledRule | undefined
    for (const rule of candidates) {
      if (rule.extensionId !== extensionId) continue
      const t = rule.action?.type
      if (!types.includes(t)) continue
      if (
        inheritedAllowPriority > 0 &&
        t !== 'allow' &&
        t !== 'allowAllRequests' &&
        rule.priority <= inheritedAllowPriority
      ) {
        continue
      }
      if (!this.ruleMatches(rule, req) || !this.canApplyRule(rule, req)) continue
      if (
        !best ||
        rule.priority > best.priority ||
        (rule.priority === best.priority && actionRank(t) > actionRank(best.action.type))
      ) {
        best = rule
      }
    }
    return best
  }

  private canApplyRule(rule: CompiledRule, req: DNRRequest): boolean {
    const extension = this.getExtension(rule.extensionId)
    if (!extension) return false
    const hasBase = this.hasPermission(extension, 'declarativeNetRequest')
    const hasHostVariant = this.hasPermission(extension, 'declarativeNetRequestWithHostAccess')
    if (!hasBase && !hasHostVariant) return false
    const type = rule.action?.type
    if (hasBase && ['block', 'upgradeScheme', 'allow', 'allowAllRequests'].includes(type)) {
      return true
    }
    return this.ctx.permissions?.hasOrigin(rule.extensionId, req.url) === true
  }

  private candidateExtensionIds(candidates: CompiledRule[]): string[] {
    return Array.from(new Set(candidates.map((rule) => rule.extensionId)))
  }

  /** Build the internal DNRRequest from an Electron-flavored details object. */
  private toReq(details: {
    url: string
    resourceType?: string
    method?: string
    referrer?: string
    initiator?: string
    webContentsId?: number
    tabId?: number
    frame?: Electron.WebFrameMain | null
    id?: number | string
  }): DNRRequest {
    const initiator = details.initiator || details.referrer
    const physicalTabId =
      typeof details.webContentsId === 'number'
        ? details.webContentsId
        : typeof details.tabId === 'number'
          ? details.tabId
          : undefined
    const logicalTabId =
      typeof physicalTabId === 'number'
        ? this.ctx.store.impl.resolveTabId
          ? this.ctx.store.impl.resolveTabId(physicalTabId) ?? -1
          : physicalTabId
        : undefined
    return {
      url: details.url,
      type: normalizeResourceType(details.resourceType),
      initiator,
      requestHost: hostOf(details.url),
      initiatorHost: hostOf(initiator),
      urlLower: details.url.toLowerCase(),
      method: details.method,
      tabId: logicalTabId,
      frame: details.frame || null,
      requestId: details.id != null ? String(details.id) : undefined,
    }
  }

  hasHeaderRules(kind: 'request' | 'response'): boolean {
    const stage: RuleStage = kind === 'request' ? 'requestHeaders' : 'responseHeaders'
    return this.ruleIndexes[stage].all.length > 0
  }

  /** True when at least one rule can affect an onBeforeRequest decision. */
  hasRules(): boolean {
    return this.ruleIndexes.beforeRequest.all.length > 0
  }

  private recordPerf(stage: RuleStage, candidateCount: number, elapsedMs: number) {
    if (!CRX_PERF) return
    const bucket = this.perf[stage]
    bucket.calls += 1
    bucket.candidates += candidateCount
    bucket.totalMs += elapsedMs
    if (elapsedMs > bucket.maxMs) bucket.maxMs = elapsedMs

    const now = Date.now()
    if (now - this.perfStartedAt < 10000) return
    const parts: string[] = []
    for (const key of ['beforeRequest', 'requestHeaders', 'responseHeaders'] as RuleStage[]) {
      const value = this.perf[key]
      if (value.calls === 0) continue
      parts.push(
        `${key} calls=${value.calls} avgCandidates=${Math.round(
          value.candidates / value.calls,
        )} totalMs=${value.totalMs.toFixed(1)} maxMs=${value.maxMs.toFixed(1)}`,
      )
    }
    if (parts.length > 0) {
      console.log(`[crx-perf][dnr] windowMs=${now - this.perfStartedAt} ${parts.join(' | ')}`)
    }
    this.perfStartedAt = now
    this.perf = {
      beforeRequest: emptyPerfBucket(),
      allow: emptyPerfBucket(),
      requestHeaders: emptyPerfBucket(),
      responseHeaders: emptyPerfBucket(),
    }
  }

  /**
   * Resolve a DNR verdict for onBeforeRequest, distinguishing an explicit
   * `allow` (which exempts the request from other blocking) from "no match".
   * Synchronous — safe to call inside a webRequest callback.
   */
  decideBeforeRequest(details: {
    url: string
    resourceType?: string
    method?: string
    referrer?: string
    initiator?: string
    webContentsId?: number
    tabId?: number
    frame?: Electron.WebFrameMain | null
  }): {
    action: 'block' | 'redirect' | 'upgradeScheme' | 'allow' | 'none'
    redirectUrl?: string
  } {
    if (this.active.length === 0) return { action: 'none' }
    const startedAt = CRX_PERF ? performance.now() : 0
    const req = this.toReq(details)
    const candidates = this.candidatesFor(req, 'beforeRequest')
    try {
      if (req.frame && (req.type === 'main_frame' || req.type === 'sub_frame')) {
        this.allowAllRequests.delete(req.frame)
      }
      const outcomes: Array<{
        extensionId: string
        type: string
        rule?: CompiledRule
      }> = []
      for (const extensionId of this.ruleIndexes.beforeRequest.extensionIds) {
        const inheritedAllow = this.inheritedAllowPriority(req.frame, extensionId)
        const rule = this.winnerForExtension(
          req,
          extensionId,
          ['block', 'allow', 'allowAllRequests', 'redirect', 'upgradeScheme'],
          inheritedAllow,
          candidates,
        )
        if (rule) outcomes.push({ extensionId, type: rule.action.type, rule })
        else if (inheritedAllow > 0) outcomes.push({ extensionId, type: 'allow' })
      }
      outcomes.sort((a, b) => {
        const rank = crossExtensionActionRank(b.type) - crossExtensionActionRank(a.type)
        if (rank !== 0) return rank
        return (this.extensionOrder.get(b.extensionId) || 0) - (this.extensionOrder.get(a.extensionId) || 0)
      })
      const outcome = outcomes[0]
      if (!outcome) return { action: 'none' }
      const best = outcome.rule
      if (!best) return { action: 'allow' }
      const t = best.action.type
      if (t === 'allowAllRequests') {
        this.grantAllowAll(req.frame, best.extensionId, best.priority)
        this.recordMatch(best, req)
        return { action: 'allow' }
      }
      if (t === 'allow') {
        this.recordMatch(best, req)
        return { action: 'allow' }
      }
      if (t === 'block') {
        this.recordMatch(best, req)
        return { action: 'block' }
      }
      if (t === 'upgradeScheme') {
        if (req.url.startsWith('http://')) {
          this.recordMatch(best, req)
          return {
            action: 'upgradeScheme',
            redirectUrl: 'https://' + req.url.slice(7),
          }
        }
        return { action: 'none' }
      }
      if (t === 'redirect') {
        const url = this.resolveRedirect(best, req)
        if (url) {
          this.recordMatch(best, req)
          return { action: 'redirect', redirectUrl: url }
        }
      }
      return { action: 'none' }
    } finally {
      if (CRX_PERF) this.recordPerf('beforeRequest', candidates.length, performance.now() - startedAt)
    }
  }

  /**
   * Back-compat shim: an Electron webRequest response (`{ cancel }` /
   * `{ redirectUrl }`) or undefined to let the request proceed. Used by
   * WebRequestAPI's own listener (the blocker-OFF path); the blocker-ON path
   * uses decideBeforeRequest so it can honor `allow` over the host blocker.
   */
  matchBeforeRequest(details: {
    url: string
    resourceType?: string
    method?: string
    referrer?: string
    initiator?: string
    webContentsId?: number
    tabId?: number
    frame?: Electron.WebFrameMain | null
  }): { cancel?: boolean; redirectUrl?: string } | undefined {
    const v = this.decideBeforeRequest(details)
    if (v.action === 'block') return { cancel: true }
    if (v.redirectUrl) return { redirectUrl: v.redirectUrl }
    return undefined
  }

  private resolveRedirect(rule: CompiledRule, req: DNRRequest): string | undefined {
    const redirect = rule.action.redirect || {}
    if (typeof redirect.url === 'string') return redirect.url
    if (typeof redirect.extensionPath === 'string') {
      const p = redirect.extensionPath.startsWith('/') ? redirect.extensionPath : '/' + redirect.extensionPath
      return `chrome-extension://${rule.extensionId}${p}`
    }
    if (typeof redirect.regexSubstitution === 'string' && rule.regexRe) {
      const m = rule.regexRe.exec(req.url)
      if (m) {
        return redirect.regexSubstitution.replace(/\\(\d)/g, (_s: string, n: string) => m[Number(n)] ?? '')
      }
    }
    if (redirect.transform && typeof redirect.transform === 'object') {
      try {
        const u = new URL(req.url)
        const tr = redirect.transform
        if (tr.scheme) u.protocol = tr.scheme
        if (tr.host) u.host = tr.host
        if (tr.path != null) u.pathname = tr.path
        if (tr.query != null) u.search = tr.query
        if (tr.fragment != null) u.hash = tr.fragment
        return u.href
      } catch {
        return undefined
      }
    }
    return undefined
  }

  /**
   * Apply `modifyHeaders` rules to a request/response header array (Chrome
   * `{name,value}[]` shape). Returns the modified array, or undefined if no rule
   * touched the headers. Synchronous.
   */
  matchHeaders(
    details: {
      url: string
      resourceType?: string
      method?: string
      referrer?: string
      initiator?: string
      webContentsId?: number
      tabId?: number
      frame?: Electron.WebFrameMain | null
    },
    kind: 'request' | 'response',
    headers: Array<{ name: string; value?: string }>,
  ): Array<{ name: string; value?: string }> | undefined {
    const stage: RuleStage = kind === 'request' ? 'requestHeaders' : 'responseHeaders'
    if (this.ruleIndexes[stage].all.length === 0) return undefined
    const startedAt = CRX_PERF ? performance.now() : 0
    const req = this.toReq(details)
    const candidates = this.candidatesFor(req, stage)
    const allowCandidates = this.candidatesFor(req, 'allow')
    const field = kind === 'request' ? 'requestHeaders' : 'responseHeaders'
    const applicable: CompiledRule[] = []
    const extensionIds = this.candidateExtensionIds(allowCandidates.concat(candidates))
    const minimumPriorities = new Map<string, number>()
    for (const extensionId of extensionIds) {
      const inheritedAllow = this.inheritedAllowPriority(req.frame, extensionId)
      const allow = this.winnerForExtension(
        req,
        extensionId,
        ['allow', 'allowAllRequests'],
        inheritedAllow,
        allowCandidates,
      )
      minimumPriorities.set(extensionId, Math.max(inheritedAllow, allow?.priority || 0))
    }
    for (const rule of candidates) {
      if (rule.priority <= (minimumPriorities.get(rule.extensionId) || 0)) continue
      if (!this.ruleMatches(rule, req) || !this.canApplyRule(rule, req)) continue
      applicable.push(rule)
    }
    applicable.sort((a, b) => {
      const extensionDelta =
        (this.extensionOrder.get(a.extensionId) || 0) - (this.extensionOrder.get(b.extensionId) || 0)
      return extensionDelta || a.priority - b.priority
    })
    if (applicable.length === 0) {
      if (CRX_PERF) {
        this.recordPerf(stage, candidates.length + allowCandidates.length, performance.now() - startedAt)
      }
      return undefined
    }
    if (CRX_DEBUG && headerMatchLogCount < 200) {
      headerMatchLogCount++
      let safeUrl = req.url.slice(0, 180)
      try {
        const parsed = new URL(req.url)
        safeUrl = `${parsed.origin}${parsed.pathname}`.slice(0, 180)
      } catch {}
      console.log(
        `[crx-dnr] modifyHeaders kind=${kind} tab=${req.tabId ?? -1} ` +
          `rules=${applicable.map((rule) => `${rule.extensionId}:${rule.id}`).join(',')} ` +
          `url=${safeUrl}`,
      )
    }
    for (const r of applicable) this.recordMatch(r, req)

    let out = headers.map((h) => ({ ...h }))
    let changed = false
    for (const rule of applicable) {
      for (const mod of rule.action[field] as any[]) {
        const name = String(mod.header || '').toLowerCase()
        if (!name) continue
        if (mod.operation === 'remove') {
          const before = out.length
          out = out.filter((h) => h.name.toLowerCase() !== name)
          if (out.length !== before) changed = true
        } else if (mod.operation === 'set') {
          out = out.filter((h) => h.name.toLowerCase() !== name)
          out.push({ name: mod.header, value: mod.value ?? '' })
          changed = true
        } else if (mod.operation === 'append') {
          out.push({ name: mod.header, value: mod.value ?? '' })
          changed = true
        }
      }
    }
    if (CRX_PERF) {
      this.recordPerf(stage, candidates.length + allowCandidates.length, performance.now() - startedAt)
    }
    return changed ? out : undefined
  }

  // ---- Match recording (getMatchedRules / onRuleMatchedDebug) --------------

  /** Record a matched rule for getMatchedRules / onRuleMatchedDebug. */
  private recordMatch(rule: CompiledRule, req: DNRRequest) {
    const ruleInfo = {
      rule: {
        ruleId: rule.id,
        rulesetId: rule.rulesetId,
        extensionId: rule.extensionId,
      },
      tabId: typeof req.tabId === 'number' ? req.tabId : -1,
      timeStamp: Date.now(),
    }
    const ring = this.matchedRings.get(rule.extensionId) || []
    ring.push(ruleInfo)
    if (ring.length > DeclarativeNetRequestAPI.MATCHED_RING_SIZE) ring.shift()
    this.matchedRings.set(rule.extensionId, ring)
    // Debug feedback is private to the rule owner and permission gated.
    try {
      const extension = this.getExtension(rule.extensionId)
      if (
        extension &&
        this.hasPermission(extension, 'declarativeNetRequestFeedback') &&
        this.ctx.router.hasListeners('declarativeNetRequest.onRuleMatchedDebug')
      ) {
        this.ctx.router.sendEvent(rule.extensionId, 'declarativeNetRequest.onRuleMatchedDebug', {
          rule: ruleInfo.rule,
          request: {
            requestId: req.requestId || `${rule.extensionId}:${rule.id}:${ruleInfo.timeStamp}`,
            url: req.url,
            method: (req.method || 'get').toUpperCase(),
            type: req.type,
            tabId: ruleInfo.tabId,
            frameId: req.frame ? req.frame.frameTreeNodeId : 0,
            parentFrameId: req.frame?.parent?.frameTreeNodeId ?? -1,
            initiator: req.initiator,
          },
        })
      }
    } catch {
      /* best-effort */
    }
  }

  // ---- Persistence (dynamic rules + enabled rulesets) ----------------------

  /** Restore before network hooks run; inactive/uninstalled extension ids stay dormant. */
  private loadPersistedSync() {
    let raw: string
    try {
      raw = readFileSync(this.dnrFile, 'utf8')
    } catch {
      return // no saved state yet — fine
    }
    try {
      const obj = JSON.parse(raw)
      if (obj && obj.dynamic && typeof obj.dynamic === 'object') {
        for (const [extId, rules] of Object.entries(obj.dynamic)) {
          if (Array.isArray(rules)) {
            this.dynamicRules.set(
              extId,
              this.compiledFromRules(extId, rules as DNRRule[], {
                source: 'dynamic',
                rulesetId: '_dynamic',
              }),
            )
          }
        }
      }
      if (obj && obj.enabled && typeof obj.enabled === 'object') {
        for (const [extId, ids] of Object.entries(obj.enabled)) {
          if (Array.isArray(ids)) this.enabledRulesets.set(extId, new Set(ids as string[]))
        }
      }
      this.rebuild()
      d('restored persisted DNR state: %d dynamic-rule extensions', Object.keys(obj?.dynamic || {}).length)
    } catch (err) {
      d('failed to parse persisted DNR state: %o', err)
    }
  }

  /** Coalesce disk writes (dynamic rules + enabled rulesets change in bursts). */
  private schedulePersist() {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persistNow().catch((err) => d('DNR persist failed: %o', err))
    }, 250)
  }

  private async persistNow() {
    const dynamic: Record<string, any[]> = {}
    this.dynamicRules.forEach((rules, extId) => {
      dynamic[extId] = rules.map((r) => ({
        id: r.id,
        priority: r.priority,
        action: r.action,
        condition: r.condition,
      }))
    })
    const enabled: Record<string, string[]> = {}
    this.enabledRulesets.forEach((ids, extId) => {
      enabled[extId] = Array.from(ids)
    })
    try {
      const temp = `${this.dnrFile}.tmp`
      await fs.writeFile(temp, JSON.stringify({ dynamic, enabled }))
      await fs.rename(temp, this.dnrFile)
    } catch (err) {
      d('DNR persist write failed: %o', err)
    }
  }

  // ---- API handlers --------------------------------------------------------

  private compiledFromRules(
    extensionId: string,
    rules: DNRRule[],
    meta: { source: 'dynamic' | 'session'; rulesetId: string },
  ): CompiledRule[] {
    return (Array.isArray(rules) ? rules : [])
      .map((r) => this.compile(extensionId, r, meta))
      .filter((r): r is CompiledRule => !!r)
  }

  private applyRuleUpdate(
    current: CompiledRule[],
    extensionId: string,
    options: { removeRuleIds?: number[]; addRules?: DNRRule[] },
    meta: { source: 'dynamic' | 'session'; rulesetId: string },
  ) {
    const removeIds = new Set(options.removeRuleIds || [])
    const next = new Map<number, CompiledRule>()
    for (const rule of current) {
      if (!removeIds.has(rule.id)) next.set(rule.id, rule)
    }
    const seenAddIds = new Set<number>()
    for (const rawRule of options.addRules || []) {
      if (typeof rawRule?.id !== 'number') throw new Error('Rule id must be a number')
      if (seenAddIds.has(rawRule.id)) throw new Error(`Duplicate rule id: ${rawRule.id}`)
      seenAddIds.add(rawRule.id)
      if (next.has(rawRule.id)) throw new Error(`Rule id already exists: ${rawRule.id}`)
      const compiled = this.compile(extensionId, rawRule, meta)
      if (compiled) next.set(compiled.id, compiled)
    }
    return Array.from(next.values())
  }

  private ensureExtensionReady(extension: Electron.Extension) {
    this.assertDnrPermission(extension)
    if (!this.staticRules.has(extension.id)) this.loadStatic(extension)
  }

  private validateRuleQuota(dynamic: CompiledRule[], session: CompiledRule[]) {
    if (dynamic.length > 30000) throw new Error('Dynamic rule limit exceeded')
    if (session.length > 5000) throw new Error('Session rule limit exceeded')
    const isUnsafe = (rule: CompiledRule) =>
      !['block', 'allow', 'allowAllRequests', 'upgradeScheme'].includes(rule.action?.type)
    if (dynamic.filter(isUnsafe).length > 5000) {
      throw new Error('Unsafe dynamic rule limit exceeded')
    }
    if (session.filter(isUnsafe).length > 5000) {
      throw new Error('Unsafe session rule limit exceeded')
    }
    const regexCount = dynamic.concat(session).filter((rule) => !!rule.regexRe).length
    if (regexCount > DeclarativeNetRequestAPI.REGEX_CAP) {
      throw new Error('Regex rule limit exceeded')
    }
  }

  private async updateDynamicRules(
    { extension }: ExtensionEvent,
    options: { removeRuleIds?: number[]; addRules?: DNRRule[] } = {},
  ) {
    this.ensureExtensionReady(extension)
    const current = this.dynamicRules.get(extension.id) || []
    const next = this.applyRuleUpdate(current, extension.id, options, {
      source: 'dynamic',
      rulesetId: '_dynamic',
    })
    this.validateRuleQuota(next, this.sessionRules.get(extension.id) || [])
    this.dynamicRules.set(extension.id, next)
    this.rebuild()
    this.schedulePersist()
  }

  private getDynamicRules({ extension }: ExtensionEvent) {
    this.ensureExtensionReady(extension)
    return (this.dynamicRules.get(extension.id) || []).map((r) => ({
      id: r.id,
      priority: r.priority,
      action: r.action,
      condition: r.condition,
    }))
  }

  private updateSessionRules(
    { extension }: ExtensionEvent,
    options: { removeRuleIds?: number[]; addRules?: DNRRule[] } = {},
  ) {
    this.ensureExtensionReady(extension)
    const current = this.sessionRules.get(extension.id) || []
    const next = this.applyRuleUpdate(current, extension.id, options, {
      source: 'session',
      rulesetId: '_session',
    })
    this.validateRuleQuota(this.dynamicRules.get(extension.id) || [], next)
    this.sessionRules.set(extension.id, next)
    this.rebuild()
  }

  private getSessionRules({ extension }: ExtensionEvent) {
    this.ensureExtensionReady(extension)
    return (this.sessionRules.get(extension.id) || []).map((r) => ({
      id: r.id,
      priority: r.priority,
      action: r.action,
      condition: r.condition,
    }))
  }

  private getMatchedRules({ extension }: ExtensionEvent, filter: { tabId?: number; minTimeStamp?: number } = {}) {
    this.ensureExtensionReady(extension)
    if (!this.hasPermission(extension, 'declarativeNetRequestFeedback')) {
      throw new Error('declarativeNetRequestFeedback permission is required')
    }
    const cutoff = Math.max(Date.now() - 5 * 60 * 1000, filter.minTimeStamp || 0)
    const rulesMatchedInfo = (this.matchedRings.get(extension.id) || []).filter(
      (info) => info.timeStamp >= cutoff && (typeof filter.tabId !== 'number' || info.tabId === filter.tabId),
    )
    return { rulesMatchedInfo }
  }

  private getEnabledRulesets({ extension }: ExtensionEvent) {
    this.ensureExtensionReady(extension)
    return Array.from(this.enabledRulesets.get(extension.id) || [])
  }

  private async updateEnabledRulesets(
    { extension }: ExtensionEvent,
    options: { disableRulesetIds?: string[]; enableRulesetIds?: string[] } = {},
  ) {
    this.ensureExtensionReady(extension)
    let set = this.enabledRulesets.get(extension.id)
    if (!set) {
      set = new Set()
      this.enabledRulesets.set(extension.id, set)
    }
    const available = new Set(this.staticRules.get(extension.id)?.keys() || [])
    for (const id of options.disableRulesetIds || []) set.delete(id)
    for (const id of options.enableRulesetIds || []) {
      if (!available.has(id)) throw new Error(`Unknown static ruleset: ${id}`)
      set.add(id)
    }
    this.rebuild()
    this.schedulePersist()
  }

  private getAvailableStaticRuleCount({ extension }: ExtensionEvent) {
    this.ensureExtensionReady(extension)
    // Chrome reports the number of ADDITIONAL static rules that can be enabled
    // given the ones already enabled. Approximate per-extension against a
    // 30000-rule guaranteed budget (Chrome's documented minimum).
    const enabled = this.enabledRulesets.get(extension.id)
    const byRuleset = this.staticRules.get(extension.id)
    let enabledCount = 0
    if (byRuleset && enabled) {
      for (const [id, rules] of byRuleset) if (enabled.has(id)) enabledCount += rules.length
    }
    return Math.max(0, 30000 - enabledCount)
  }

  private isRegexSupported({ extension }: ExtensionEvent, regexOptions: { regex?: string } = {}) {
    this.ensureExtensionReady(extension)
    const src = regexOptions.regex || ''
    // Mirror compile()'s guard: refuse the catastrophic-backtracking shapes we
    // won't enforce anyway, so extensions get an accurate isSupported=false.
    const normalizedRegex = normalizeRegexForJs(src)
    if (!isRegexSafe(normalizedRegex)) {
      return { isSupported: false, reason: 'syntaxError' as const }
    }
    try {
      // eslint-disable-next-line no-new
      new RegExp(normalizedRegex)
      return { isSupported: true }
    } catch (err: any) {
      return { isSupported: false, reason: 'syntaxError' as const }
    }
  }

  private setExtensionActionOptions({ extension }: ExtensionEvent) {
    this.ensureExtensionReady(extension)
  }
}
