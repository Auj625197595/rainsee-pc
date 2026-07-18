import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'
import debug from 'debug'

const d = debug('electron-chrome-extensions:proxy')

/**
 * chrome.proxy implementation backed by Electron's `session.setProxy`.
 *
 * This Electron build ships no native chrome.proxy API, so proxy extensions
 * (SwitchyOmega / ZeroOmega) previously crashed in `getProxyImpl()` and blanked
 * their UI. The renderer factory + SHIM expose a `chrome.proxy.settings` object
 * whose `set`/`clear`/`get` route here over the `crx-msg` router; this class
 * applies them to the browsing session (`ctx.session` = `persist:view`, the same
 * session every BrowserView tab uses, so the proxy takes effect for all pages).
 *
 * Chrome's `proxy.settings` value shape is mapped 1:1 to Electron's ProxyConfig
 * (the `mode` enum already matches: direct / system / auto_detect / pac_script /
 * fixed_servers). The only non-trivial part is `fixed_servers`: Chrome passes a
 * structured `rules` object (singleProxy / proxyFor{Http,Https,Ftp} /
 * fallbackProxy / bypassList) while Electron wants a `proxyRules` string, so we
 * flatten it. SOCKS proxies become `socks5://` / `socks4://` URIs. Best-effort:
 * the common omega cases (single HTTP/SOCKS proxy, PAC, per-scheme, bypass list)
 * are covered; exotic combos fall back gracefully.
 */
export class ProxyAPI {
  /** Last-applied value, echoed by `get` (mirrors Chrome returning current settings). */
  private current: any = { mode: 'system' }

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('proxy.settings.set', this.set, { permission: 'proxy' })
    handle('proxy.settings.clear', this.clear, { permission: 'proxy' })
    handle('proxy.settings.get', this.get, { permission: 'proxy' })
  }

  private set = async (_event: ExtensionEvent, details: any): Promise<undefined> => {
    const value = (details && details.value) || { mode: 'system' }
    this.current = value
    const config = mapProxyConfig(value)
    try {
      await this.ctx.session.setProxy(config)
      d(`setProxy ${JSON.stringify(config)}`)
    } catch (e: any) {
      // Never let a bad config tear down the caller — Chrome's set never rejects.
      console.error('[crx-proxy] setProxy failed:', e && e.message, JSON.stringify(config))
    }
    // chrome.proxy.settings.set's callback receives no arguments.
    return undefined
  }

  private clear = async (_event: ExtensionEvent, _details: any): Promise<undefined> => {
    this.current = { mode: 'system' }
    try {
      await this.ctx.session.setProxy({ mode: 'system' })
      d('setProxy cleared -> system')
    } catch (e: any) {
      console.error('[crx-proxy] clear failed:', e && e.message)
    }
    return undefined
  }

  private get = async (_event: ExtensionEvent, _details: any) => {
    return {
      value: this.current,
      levelOfControl: 'controlled_by_this_extension',
    }
  }
}

/** Format a single Chrome proxy host ({scheme, host, port}) as an Electron proxy URI. */
function proxyUri(p: any): string | undefined {
  if (!p || !p.host) return undefined
  const host = String(p.host)
  const port = p.port != null && p.port !== '' ? ':' + p.port : ''
  switch (p.scheme) {
    case 'socks5':
      return 'socks5://' + host + port
    case 'socks4':
      return 'socks4://' + host + port
    default:
      // http / https / quic → a plain host:port acts as an HTTP proxy in Electron
      return host + port
  }
}

/** True for SOCKS proxies, which Electron needs as `socks5://` / `socks4://` URIs. */
function isSocks(p: any): boolean {
  return !!p && (p.scheme === 'socks5' || p.scheme === 'socks4')
}

/** Flatten Chrome's structured `rules` into Electron's `proxyRules` string. */
function mapRules(rules: any): string | undefined {
  if (!rules) return undefined
  // singleProxy: one proxy for all schemes.
  if (rules.singleProxy) {
    return isSocks(rules.singleProxy) ? proxyUri(rules.singleProxy) : proxyUri(rules.singleProxy)
  }
  // Per-scheme proxies: http=...;https=...;ftp=... (socks per-scheme -> socks=...).
  const parts: string[] = []
  const perScheme: [string, string][] = [
    ['proxyForHttp', 'http'],
    ['proxyForHttps', 'https'],
    ['proxyForFtp', 'ftp'],
  ]
  for (const [chromeKey, scheme] of perScheme) {
    const p = rules[chromeKey]
    if (!p || !p.host) continue
    const uri = proxyUri(p)
    if (!uri) continue
    if (isSocks(p)) parts.push('socks=' + uri.replace(/^socks[45]:\/\//, ''))
    else parts.push(scheme + '=' + uri)
  }
  if (parts.length) return parts.join(';')
  // fallbackProxy only (typically a non-http scheme like SOCKS).
  if (rules.fallbackProxy) return proxyUri(rules.fallbackProxy)
  return undefined
}

/** Flatten Chrome's bypassList into Electron's `proxyBypassRules` string. */
function mapBypass(bypassList: any): string | undefined {
  if (!Array.isArray(bypassList) || !bypassList.length) return undefined
  const out: string[] = []
  for (const b of bypassList) {
    if (typeof b === 'string') out.push(b)
    else if (b && typeof b.pattern === 'string') out.push(b.pattern)
    else if (b && typeof b.host === 'string') out.push(b.host)
    else if (b != null) out.push(String(b))
  }
  const joined = out.filter(Boolean).join(',')
  return joined || undefined
}

/** Map a chrome.proxy.settings value to an Electron ProxyConfig. */
function mapProxyConfig(value: any): Electron.ProxyConfig {
  const mode = value && value.mode
  switch (mode) {
    case 'direct':
    case 'system':
    case 'auto_detect':
      return { mode }
    case 'pac_script': {
      const ps = (value && value.pacScript) || {}
      return { mode: 'pac_script', pacScript: ps.data || ps.url || '' }
    }
    case 'fixed_servers': {
      const rules = (value && value.rules) || {}
      const proxyRules = mapRules(rules)
      const cfg: Electron.ProxyConfig = { mode: 'fixed_servers' }
      if (proxyRules) (cfg as any).proxyRules = proxyRules
      const bypass = mapBypass(rules.bypassList)
      if (bypass) (cfg as any).proxyBypassRules = bypass
      return cfg
    }
    default:
      return { mode: 'system' }
  }
}
