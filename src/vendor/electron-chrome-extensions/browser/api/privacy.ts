import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

// chrome.privacy. Gated on the "privacy" permission (enforced at the handler
// level by the router, NOT at the namespace level — the chrome.privacy object
// exists for every extension, matching Chrome, where a missing permission makes
// get/set/clear throw rather than making the namespace undefined).
//
// Electron ships no usable chrome.privacy store, so we persist a Chrome-shaped
// one ourselves (userData/privacy-settings.json). Each leaf is a
// chrome.types.ChromeSetting: get returns { value, levelOfControl }; set/clear
// mutate state, persist, and broadcast privacy.<cat>.<name>.onChange.
//
// We do NOT re-apply these to Chromium's real prefs: Electron cannot reliably
// change `net.network_prediction_options` / `enable_hyperlink_audit` /
// `webRTCIPHandlingPolicy` at runtime (command-line switches are startup-only,
// `session.preferences` is limited/deprecated). This matches the fontSettings
// philosophy — the API contract (persistent set/get/clear + events) is what
// makes privacy-touching extensions (uBlock Origin, Privacy Badger, ...) load
// and present a working UI instead of crashing on `chrome.privacy.network.X`.
// An optional `apply` hook is left on SettingMeta for future per-setting wiring.

interface SettingMeta {
  /** Value returned by get() before any extension override. Chromium default. */
  default: any
  /** Optional: best-effort apply to a real Electron/Chromium knob (future use). */
  apply?: (value: any, ctx: ExtensionContext) => void
}

/** Chrome-standard chrome.privacy schema (network / services / websites). */
const PRIVACY_SETTINGS: Record<string, Record<string, SettingMeta>> = {
  network: {
    networkPredictionEnabled: { default: true },
    webRTCIPHandlingPolicy: { default: 'default' },
    globalPrivacyControl: { default: false },
  },
  services: {
    alternateErrorPagesEnabled: { default: true },
    autofillAddressEnabled: { default: true },
    autofillCreditCardEnabled: { default: true },
    passwordSavingEnabled: { default: true },
    safeBrowsingEnabled: { default: true },
    safeBrowsingExtendedReportingEnabled: { default: false },
    searchSuggestEnabled: { default: true },
    spellingServiceEnabled: { default: true },
    translationServiceEnabled: { default: true },
  },
  websites: {
    hyperlinkAuditingEnabled: { default: true },
    referrersEnabled: { default: true },
    thirdPartyCookiesAllowed: { default: true },
    cookieControlsEnabled: { default: '' },
    protectedContentEnabled: { default: true },
  },
}

interface PrivacyState {
  // key: `${category}.${setting}` -> override value
  values: Record<string, any>
}

const state: PrivacyState = { values: {} }
let settingsFile = ''
let saveTimer: ReturnType<typeof setTimeout> | null = null

function loadState() {
  try {
    settingsFile = path.join(app.getPath('userData'), 'privacy-settings.json')
    if (!fs.existsSync(settingsFile)) return
    const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return
    if (parsed.values && typeof parsed.values === 'object') state.values = parsed.values
  } catch {
    /* corrupt or unreadable file — start fresh, don't crash */
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      fs.writeFileSync(settingsFile, JSON.stringify(state), 'utf8')
    } catch {
      /* ignore disk errors — in-memory state still serves the session */
    }
  }, 200)
  if (typeof (saveTimer as any)?.unref === 'function') (saveTimer as any).unref()
}

function levelFor(
  v: unknown,
): 'controlled_by_this_extension' | 'controllable_by_this_extension' {
  return v !== undefined ? 'controlled_by_this_extension' : 'controllable_by_this_extension'
}

export class PrivacyAPI {
  constructor(private ctx: ExtensionContext) {
    loadState()
    const handle = this.ctx.router.apiHandler()
    // Register get/set/clear for every leaf. handle() accepts any string name
    // and a `permission` (router.ts), so a loop over the table gives every
    // ChromeSetting its own handler without 45 hand-written lines.
    for (const [cat, settings] of Object.entries(PRIVACY_SETTINGS)) {
      for (const name of Object.keys(settings)) {
        handle(`privacy.${cat}.${name}.get`, this.makeGet(cat, name), { permission: 'privacy' })
        handle(`privacy.${cat}.${name}.set`, this.makeSet(cat, name), { permission: 'privacy' })
        handle(`privacy.${cat}.${name}.clear`, this.makeClear(cat, name), {
          permission: 'privacy',
        })
      }
    }
  }

  private keyOf(cat: string, name: string) {
    return `${cat}.${name}`
  }

  // Each make* returns a DISTINCT closure capturing its own cat/name — critical
  // inside a loop, otherwise every handler would share the last iteration's vars.
  private makeGet = (cat: string, name: string) => (_event: ExtensionEvent, _details: any) => {
    const stored = state.values[this.keyOf(cat, name)]
    const meta = PRIVACY_SETTINGS[cat][name]
    return {
      value: stored !== undefined ? stored : meta.default,
      levelOfControl: levelFor(stored),
    }
  }

  private makeSet = (cat: string, name: string) => (_event: ExtensionEvent, details: any) => {
    const value = details?.value
    state.values[this.keyOf(cat, name)] = value
    scheduleSave()
    const meta = PRIVACY_SETTINGS[cat][name]
    if (meta.apply) {
      try {
        meta.apply(value, this.ctx)
      } catch {
        /* best-effort — never let an apply hook tear down the caller */
      }
    }
    this.ctx.router.broadcastEvent(`privacy.${cat}.${name}.onChange`, {
      value,
      levelOfControl: 'controlled_by_this_extension',
    })
    // chrome.types.ChromeSetting.set's callback receives no arguments.
    return undefined
  }

  private makeClear = (cat: string, name: string) => (_event: ExtensionEvent, _details: any) => {
    delete state.values[this.keyOf(cat, name)]
    scheduleSave()
    const meta = PRIVACY_SETTINGS[cat][name]
    if (meta.apply) {
      try {
        meta.apply(meta.default, this.ctx)
      } catch {
        /* best-effort */
      }
    }
    this.ctx.router.broadcastEvent(`privacy.${cat}.${name}.onChange`, {
      value: meta.default,
      levelOfControl: 'controllable_by_this_extension',
    })
    return undefined
  }
}
