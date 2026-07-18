import { app, ipcMain } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import debug from 'debug'

import { ExtensionContext } from '../context'

const d = debug('electron-chrome-extensions:i18n')

interface MessageEntry {
  message: string
  placeholders?: Record<string, { content?: string }>
}

export interface I18nCatalog {
  /** BCP-47 UI language for chrome.i18n.getUILanguage(), e.g. 'zh-CN'. */
  uiLocale: string
  /** Resolved _locales directory name (underscore form), e.g. 'zh_CN'. */
  messageLocale: string
  /** Lower-cased message map merged from default_locale + resolved locale. */
  messages: Record<string, MessageEntry>
}

/**
 * The browser UI language. Mirrors app.getLocale(), which the host forces to
 * zh-CN via `--lang` (see src/main/application.ts). Extension UIs follow the
 * browser UI language so they stay consistent with the rest of the app.
 */
export function getAppUILocale(): string {
  try {
    return app.getLocale() || 'en-US'
  } catch (e) {
    return 'en-US'
  }
}

const catalogCache = new Map<string, I18nCatalog>()

function readMessages(localesDir: string, locale: string): Record<string, MessageEntry> | null {
  const file = path.join(localesDir, locale, 'messages.json')
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const out: Record<string, MessageEntry> = {}
    for (const key of Object.keys(raw)) {
      const entry = raw[key]
      if (!entry || typeof entry.message !== 'string') continue
      // Chrome matches message names AND placeholder names case-insensitively.
      let placeholders: Record<string, { content?: string }> | undefined
      if (entry.placeholders && typeof entry.placeholders === 'object') {
        placeholders = {}
        for (const p of Object.keys(entry.placeholders)) {
          placeholders[p.toLowerCase()] = entry.placeholders[p]
        }
      }
      out[key.toLowerCase()] = { message: entry.message, placeholders }
    }
    return out
  } catch (e) {
    d('failed to read %s: %o', file, e)
    return null
  }
}

/** Candidate _locales dir names (underscore form) in priority order. */
function localeCandidates(uiLocale: string, defaultLocale?: string): string[] {
  const out: string[] = []
  const add = (v?: string) => {
    if (!v) return
    const norm = v.replace(/-/g, '_')
    if (!out.includes(norm)) out.push(norm)
  }
  add(uiLocale) // e.g. zh_CN
  add(uiLocale.split(/[-_]/)[0]) // e.g. zh
  add(defaultLocale) // manifest default (e.g. en)
  add('en') // hard fallback
  return out
}

/**
 * Synchronously load and merge an extension's _locales catalog for the browser
 * UI language. Cached per (extensionPath|uiLocale). Returns an empty message map
 * if the extension ships no _locales.
 *
 * Mirrors Chrome's resolution: the manifest's default_locale is the base layer
 * and the resolved UI locale overlays it (per-key fallback).
 */
export function buildI18nCatalog(
  extensionPath: string,
  manifest: any,
  uiLocale: string,
): I18nCatalog {
  const cacheKey = `${extensionPath}|${uiLocale}`
  const cached = catalogCache.get(cacheKey)
  if (cached) return cached

  const defaultLocale: string | undefined = manifest && manifest.default_locale
  const localesDir = path.join(extensionPath, '_locales')

  let messageLocale = (uiLocale || 'en').replace(/-/g, '_')
  let messages: Record<string, MessageEntry> = {}

  if (existsSync(localesDir)) {
    const base = defaultLocale
      ? readMessages(localesDir, defaultLocale.replace(/-/g, '_'))
      : null
    let resolved: Record<string, MessageEntry> | null = null
    for (const cand of localeCandidates(uiLocale, defaultLocale)) {
      resolved = readMessages(localesDir, cand)
      if (resolved) {
        messageLocale = cand
        break
      }
    }
    messages = { ...(base || {}), ...(resolved || {}) }
  }

  const catalog: I18nCatalog = { uiLocale: uiLocale || 'en-US', messageLocale, messages }
  catalogCache.set(cacheKey, catalog)
  d('built catalog for %s -> %s (%d messages)', extensionPath, messageLocale, Object.keys(messages).length)
  return catalog
}

/**
 * Resolve a single `__MSG_key__` string (e.g. manifest `name`, action
 * `default_title`) against the extension's _locales catalog for the browser UI
 * language. Non-`__MSG_` input is returned verbatim. Used by host display layers
 * (extensions management page, browser-action defaults, management API, context
 * menu grouping) so they localize consistently with the runtime
 * `chrome.i18n.getMessage` impl, sharing the same catalog cache and locale
 * fallback order (uiLocale → short → default_locale → en).
 */
export function resolveExtMessage(
  extensionPath: string,
  manifest: any,
  text: string | undefined,
): string {
  if (!text || typeof text !== 'string' || !text.startsWith('__MSG_')) return text || ''
  const key = text.slice(6, -2)
  try {
    const catalog = buildI18nCatalog(extensionPath, manifest, getAppUILocale())
    const entry = catalog.messages[key.toLowerCase()]
    if (entry && entry.message) return entry.message
  } catch (e) {
    d('resolveExtMessage(%s) failed: %o', key, e)
  }
  return text
}

// The global IPC handler occasionally receives a devtools/webui sender session
// rather than the extension's own session, so fallback lookup must be iterable.
// The application owns a small, process-lifetime set of extension sessions.
const i18nBySession = new Map<Electron.Session, I18nAPI>()
let i18nIpcInstalled = false

/**
 * Registers IPC endpoints that extension contexts use to fetch their i18n
 * catalog. `chrome.i18n.getMessage`/`getUILanguage` are synchronous, so:
 *  - Frames (extension pages, popups, content scripts) use a SYNCHRONOUS IPC
 *    (`ipcRenderer.sendSync('crx-i18n')`) and resolve immediately.
 *  - Service workers route IPC through `sw.ipc` (not global `ipcMain`) and do
 *    not support `sendSync`, so they use the ASYNC channel (`crx-i18n-async`)
 *    to prime their catalog shortly after startup. This matters because some
 *    extensions (e.g. Tampermonkey) resolve the UI language in the background
 *    service worker, and the popup follows it.
 */
export class I18nAPI {
  private attachedWorkers = new WeakSet<any>()

  constructor(private ctx: ExtensionContext) {
    i18nBySession.set(ctx.session, this)
    if (!i18nIpcInstalled) {
      i18nIpcInstalled = true
      const apiFor = (event: any, extensionId: string) => {
        try {
          const api = i18nBySession.get(event?.sender?.session)
          if (api?.hasExtension(extensionId)) return api
          // Fall back to the registered API that actually owns the extension so
          // a frame whose sender session isn't directly tracked (for example a
          // devtools/webui frame) still resolves the correct catalog.
          for (const fallback of i18nBySession.values()) {
            if (fallback.hasExtension(extensionId)) return fallback
          }
          return api
        } catch {
          /* ignore */
        }
        return undefined
      }
      ipcMain.on('crx-i18n', (event, extensionId) => {
        event.returnValue = apiFor(event, extensionId)?.catalogFor(extensionId)
      })
      ipcMain.handle('crx-i18n-async', (event, extensionId) =>
        apiFor(event, extensionId)?.catalogFor(extensionId),
      )
    }
    this.attachWorkerHandlers()
  }

  private onGetCatalogAsync = (_event: any, extensionId: string) => {
    return this.catalogFor(extensionId)
  }

  private hasExtension(extensionId: string): boolean {
    try {
      const sessionExtensions: any = (this.ctx.session as any).extensions || this.ctx.session
      return !!sessionExtensions.getExtension(extensionId)
    } catch {
      return false
    }
  }

  /** Attach the async i18n handler to extension service workers as they start. */
  private attachWorkerHandlers() {
    const swApi = (this.ctx.session as any).serviceWorkers
    if (!swApi || typeof swApi.on !== 'function') return
    const attach = (versionId: number) => {
      const sw = swApi.getWorkerFromVersionID?.(versionId)
      if (!sw || this.attachedWorkers.has(sw)) return
      if (!sw.scope?.startsWith('chrome-extension://')) return
      this.attachedWorkers.add(sw)
      try {
        sw.ipc.handle('crx-i18n-async', this.onGetCatalogAsync)
        d('attached i18n handler to SW %s', sw.scope)
      } catch (err) {
        d('failed attaching SW i18n handler: %o', err)
      }
    }
    swApi.on('running-status-changed', ({ runningStatus, versionId }: any) => {
      if (runningStatus === 'starting') attach(versionId)
    })
  }

  private catalogFor(extensionId: string): I18nCatalog {
    const uiLocale = getAppUILocale()
    const empty: I18nCatalog = {
      uiLocale,
      messageLocale: uiLocale.replace(/-/g, '_'),
      messages: {},
    }
    try {
      const sessionExtensions: any = (this.ctx.session as any).extensions || this.ctx.session
      const extension = sessionExtensions.getExtension(extensionId)
      if (!extension || !extension.path) return empty
      return buildI18nCatalog(extension.path, extension.manifest, uiLocale)
    } catch (e) {
      d('catalogFor(%s) failed: %o', extensionId, e)
      return empty
    }
  }
}
