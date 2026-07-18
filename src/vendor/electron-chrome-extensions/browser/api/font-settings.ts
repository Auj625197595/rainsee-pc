import { execFile } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

// chrome.fontSettings. Gated on the "fontSettings" permission. Electron has no
// font-settings store, so we persist a Chrome-shaped one ourselves
// (userData/font-settings.json): set*/clear* mutate it and broadcast the
// matching on*Changed event; get* read it with a correct levelOfControl.
// getFontList enumerates the OS's installed fonts (PowerShell + GDI on Windows,
// fontconfig elsewhere) and caches the result; FALLBACK_FONTS only kicks in if
// every enumeration path fails.
//
// We do NOT re-apply these to page rendering: Electron can't replicate Chrome's
// font pipeline (per-script / per-generic-family mapping, minimum font size),
// and injected CSS would double-apply against extensions that inject their own
// <style> (e.g. the lkiif… font-rendering extension). The API contract —
// persistent set/get/clear + events — is what makes font-settings UIs work.
const FALLBACK_FONTS = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Verdana',
  'Trebuchet MS',
  'Tahoma',
  'Segoe UI',
  'Microsoft YaHei',
  'SimSun',
  'sans-serif',
  'serif',
  'monospace',
]

const DEFAULT_FONT_SIZE = 16
const DEFAULT_FIXED_FONT_SIZE = 13
const DEFAULT_MIN_FONT_SIZE = 0

// --- Real system-font enumeration -----------------------------------------
// Electron exposes no API to list installed fonts, so we shell out to the OS:
//   Windows -> PowerShell + GDI InstalledFontCollection (accurate family names,
//              matches what Chromium itself would report)
//   macOS    -> fontconfig `fc-list`, falling back to `system_profiler`
//   Linux    -> fontconfig `fc-list`
// Result is cached for the process lifetime; any failure falls back to
// FALLBACK_FONTS so font-picker UIs still render.
let cachedFontList: string[] | null = null
let fontListPromise: Promise<string[]> | null = null

function runCmd(cmd: string, args: string[], timeout = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

function listWindowsFonts(): Promise<string[]> {
  const script =
    'Add-Type -AssemblyName System.Drawing; ' +
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' +
    '(New-Object System.Drawing.Text.InstalledFontCollection).Families | ' +
    'ForEach-Object { $_.Name }'
  return runCmd('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]).then(
    (stdout) => stdout.replace(/^\uFEFF/, '').split(/\r?\n/),
  )
}

function listFontconfigFonts(): Promise<string[]> {
  // `fc-list : family` prints one comma-separated family list per matched face.
  return runCmd('fc-list', [':', 'family']).then((stdout) =>
    stdout
      .split(/\r?\n/)
      .flatMap((line) => line.split(','))
      .map((name) => name.trim()),
  )
}

function listMacFonts(): Promise<string[]> {
  return listFontconfigFonts().catch(() =>
    // No fontconfig (stock macOS) — system_profiler is slow but always present.
    runCmd(
      'sh',
      ['-c', "system_profiler SPFontsDataType -detailLevel mini 2>/dev/null | awk -F': ' '/Family:/{print $2}'"],
      20000,
    ).then((stdout) => stdout.replace(/^\uFEFF/, '').split(/\r?\n/)),
  )
}

function listSystemFonts(): Promise<string[]> {
  if (process.platform === 'win32') return listWindowsFonts()
  if (process.platform === 'darwin') return listMacFonts()
  if (process.platform === 'linux') return listFontconfigFonts()
  return Promise.resolve([])
}

function enumerateSystemFonts(): Promise<string[]> {
  if (cachedFontList) return Promise.resolve(cachedFontList)
  if (fontListPromise) return fontListPromise
  fontListPromise = listSystemFonts()
    .then((names) => {
      const seen = new Set<string>()
      const out: string[] = []
      for (const raw of names) {
        const name = raw.trim()
        if (!name) continue
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(name)
      }
      if (out.length === 0) out.push(...FALLBACK_FONTS)
      out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      // Chrome always exposes the CSS generic families; append any missing.
      for (const g of ['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy']) {
        if (!seen.has(g)) out.push(g)
      }
      cachedFontList = out
      return out
    })
    .catch(() => {
      cachedFontList = [...FALLBACK_FONTS]
      return cachedFontList
    })
  return fontListPromise
}

// --- Persisted settings store ---------------------------------------------
interface FontSettingsState {
  // key: `${genericFamily}|${script|'Zyyy'}` -> fontId
  fonts: Record<string, string>
  defaultFontSize?: number
  defaultFixedFontSize?: number
  minimumFontSize?: number
}

const state: FontSettingsState = { fonts: {} }
let settingsFile = ''
let saveTimer: ReturnType<typeof setTimeout> | null = null

function loadState() {
  try {
    settingsFile = path.join(app.getPath('userData'), 'font-settings.json')
    if (!fs.existsSync(settingsFile)) return
    const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return
    if (parsed.fonts && typeof parsed.fonts === 'object') state.fonts = parsed.fonts
    if (typeof parsed.defaultFontSize === 'number') state.defaultFontSize = parsed.defaultFontSize
    if (typeof parsed.defaultFixedFontSize === 'number')
      state.defaultFixedFontSize = parsed.defaultFixedFontSize
    if (typeof parsed.minimumFontSize === 'number') state.minimumFontSize = parsed.minimumFontSize
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

function systemDefaultFont(genericFamily?: string): string {
  if (genericFamily === 'fixed') return 'monospace'
  try {
    if (typeof (app as any).getSystemFont === 'function') return (app as any).getSystemFont()
  } catch {
    /* ignore */
  }
  return 'sans-serif'
}

function fontKey(genericFamily: string, script?: string): string {
  return `${genericFamily}|${script || 'Zyyy'}`
}

function levelFor(v: unknown): 'controlled_by_this_extension' | 'controllable_by_this_extension' {
  return v !== undefined ? 'controlled_by_this_extension' : 'controllable_by_this_extension'
}

export class FontSettingsAPI {
  constructor(private ctx: ExtensionContext) {
    loadState()
    const handle = this.ctx.router.apiHandler()
    handle('fontSettings.getFont', this.getFont, { permission: 'fontSettings' })
    handle('fontSettings.setFont', this.setFont, { permission: 'fontSettings' })
    handle('fontSettings.clearFont', this.clearFont, { permission: 'fontSettings' })
    handle('fontSettings.getDefaultFontSize', this.getDefaultFontSize, { permission: 'fontSettings' })
    handle('fontSettings.setDefaultFontSize', this.setDefaultFontSize, { permission: 'fontSettings' })
    handle('fontSettings.clearDefaultFontSize', this.clearDefaultFontSize, { permission: 'fontSettings' })
    handle('fontSettings.getDefaultFixedFontSize', this.getDefaultFixedFontSize, {
      permission: 'fontSettings',
    })
    handle('fontSettings.setDefaultFixedFontSize', this.setDefaultFixedFontSize, {
      permission: 'fontSettings',
    })
    handle('fontSettings.clearDefaultFixedFontSize', this.clearDefaultFixedFontSize, {
      permission: 'fontSettings',
    })
    handle('fontSettings.setMinimumFontSize', this.setMinimumFontSize, { permission: 'fontSettings' })
    handle('fontSettings.clearMinimumFontSize', this.clearMinimumFontSize, { permission: 'fontSettings' })
    handle('fontSettings.getMinimumFontSize', this.getMinimumFontSize, {
      permission: 'fontSettings',
    })
    handle('fontSettings.getFontList', this.getFontList, { permission: 'fontSettings' })
  }

  private getFont = (
    _event: ExtensionEvent,
    details: { genericFamily?: string; script?: string },
  ) => {
    const gf = details?.genericFamily || 'standard'
    const stored = state.fonts[fontKey(gf, details?.script)]
    return {
      fontId: stored !== undefined ? stored : systemDefaultFont(gf),
      levelOfControl: levelFor(stored),
      pixelSize: undefined as any,
    }
  }

  private setFont = (
    _event: ExtensionEvent,
    details: { fontId: string; genericFamily: string; script?: string },
  ) => {
    const gf = details?.genericFamily || 'standard'
    const key = fontKey(gf, details?.script)
    const fontId = details?.fontId ?? ''
    // Chrome contract: empty fontId == fall back to the global-script font
    // (i.e. clear this generic-family/script override).
    if (fontId === '') delete state.fonts[key]
    else state.fonts[key] = fontId
    scheduleSave()
    const after = state.fonts[key]
    this.ctx.router.broadcastEvent('fontSettings.onFontChanged', {
      fontId: after !== undefined ? after : systemDefaultFont(gf),
      genericFamily: gf,
      script: details?.script,
      levelOfControl: levelFor(after),
    })
  }

  private clearFont = (
    _event: ExtensionEvent,
    details: { genericFamily: string; script?: string },
  ) => {
    const gf = details?.genericFamily || 'standard'
    delete state.fonts[fontKey(gf, details?.script)]
    scheduleSave()
    this.ctx.router.broadcastEvent('fontSettings.onFontChanged', {
      fontId: systemDefaultFont(gf),
      genericFamily: gf,
      script: details?.script,
      levelOfControl: 'controllable_by_this_extension',
    })
  }

  private getDefaultFontSize = () => ({
    pixelSize: state.defaultFontSize ?? DEFAULT_FONT_SIZE,
    levelOfControl: levelFor(state.defaultFontSize),
  })

  private setDefaultFontSize = (_event: ExtensionEvent, details: { pixelSize: number }) => {
    state.defaultFontSize = details?.pixelSize
    scheduleSave()
    this.ctx.router.broadcastEvent('fontSettings.onDefaultFontSizeChanged', {
      pixelSize: state.defaultFontSize,
      levelOfControl: 'controlled_by_this_extension',
    })
  }

  private clearDefaultFontSize = () => {
    state.defaultFontSize = undefined
    scheduleSave()
    this.ctx.router.broadcastEvent('fontSettings.onDefaultFontSizeChanged', {
      pixelSize: DEFAULT_FONT_SIZE,
      levelOfControl: 'controllable_by_this_extension',
    })
  }

  private getDefaultFixedFontSize = () => ({
    pixelSize: state.defaultFixedFontSize ?? DEFAULT_FIXED_FONT_SIZE,
    levelOfControl: levelFor(state.defaultFixedFontSize),
  })

  private setDefaultFixedFontSize = (_event: ExtensionEvent, details: { pixelSize: number }) => {
    state.defaultFixedFontSize = details?.pixelSize
    scheduleSave()
    this.ctx.router.broadcastEvent('fontSettings.onDefaultFixedFontSizeChanged', {
      pixelSize: state.defaultFixedFontSize,
      levelOfControl: 'controlled_by_this_extension',
    })
  }

  private clearDefaultFixedFontSize = () => {
    state.defaultFixedFontSize = undefined
    scheduleSave()
    this.ctx.router.broadcastEvent('fontSettings.onDefaultFixedFontSizeChanged', {
      pixelSize: DEFAULT_FIXED_FONT_SIZE,
      levelOfControl: 'controllable_by_this_extension',
    })
  }

  private getMinimumFontSize = () => ({
    pixelSize: state.minimumFontSize ?? DEFAULT_MIN_FONT_SIZE,
    levelOfControl: levelFor(state.minimumFontSize),
  })

  private setMinimumFontSize = (_event: ExtensionEvent, details: { pixelSize: number }) => {
    state.minimumFontSize = details?.pixelSize
    scheduleSave()
    this.ctx.router.broadcastEvent('fontSettings.onMinimumFontSizeChanged', {
      pixelSize: state.minimumFontSize,
      levelOfControl: 'controlled_by_this_extension',
    })
  }

  private clearMinimumFontSize = () => {
    state.minimumFontSize = undefined
    scheduleSave()
    this.ctx.router.broadcastEvent('fontSettings.onMinimumFontSizeChanged', {
      pixelSize: DEFAULT_MIN_FONT_SIZE,
      levelOfControl: 'controllable_by_this_extension',
    })
  }

  private getFontList = async (): Promise<chrome.fontSettings.FontName[]> => {
    const fonts = await enumerateSystemFonts()
    return fonts.map((name) => ({ fontId: name, displayName: name }))
  }
}
