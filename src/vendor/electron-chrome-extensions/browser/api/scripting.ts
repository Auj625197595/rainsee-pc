import { app, ipcMain, webFrameMain } from 'electron'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import debug from 'debug'

import { ExtensionContext, PreloadIsolatedScript } from '../context'
import { ExtensionEvent } from '../router'
import {
  getFrameMatchUrls,
  isBrowserInternalFrame,
  isRelatedFrameUrl,
  matchesScriptFilter,
  executeExtensionScript,
  extensionWorldId,
  resolveExtensionPath,
} from './common'
import { buildContentScriptBridge, clearContentScriptBridge } from './content-bridge'

const d = debug('electron-chrome-extensions:scripting')
// `log` fires on every inject candidate (very hot); off unless CRX_VERBOSE=1.
// `warn` stays on — it only fires on actual injection failures.
const CRX_VERBOSE = !!process.env.CRX_VERBOSE
const log = CRX_VERBOSE ? (...args: any[]) => console.log('[crx-scripting]', ...args) : () => {}
const warn = (...args: any[]) => console.warn('[crx-scripting]', ...args)

interface ScriptFile {
  file?: string
  code?: string
}

interface RegisteredContentScript {
  id: string
  matches?: string[]
  excludeMatches?: string[]
  includeGlobs?: string[]
  excludeGlobs?: string[]
  js?: ScriptFile[]
  css?: ScriptFile[]
  runAt?: 'document_start' | 'document_end' | 'document_idle'
  allFrames?: boolean
  world?: 'ISOLATED' | 'MAIN'
  persistAcrossSessions?: boolean
  matchAboutBlank?: boolean
  matchOriginAsFallback?: boolean
  _code?: string
  _css?: string
}

/**
 * Which run_at phase an injection pass is servicing.
 *  - `start`: only `document_start` scripts (injected right after the frame's
 *    navigation commits, before the page's own scripts run).
 *  - `end`: everything else (`document_end` / `document_idle` / unspecified),
 *    injected at dom-ready / frame-finish-load.
 *  - `all`: no run_at filter — used when a script is registered AFTER the page
 *    already loaded, where document_start timing is moot.
 */
type InjectPhase = 'start' | 'end' | 'all'

const scriptingBySession = new WeakMap<Electron.Session, ScriptingAPI>()
let documentStartHandlerInstalled = false

const installDocumentStartHandler = () => {
  if (documentStartHandlerInstalled) return
  documentStartHandlerInstalled = true
  ipcMain.on('crx-get-document-start-scripts', (event) => {
    const api = scriptingBySession.get(event.sender.session)
    event.returnValue = api
      ? {
          isolated: api.getPreloadDocumentStartScripts(event.senderFrame),
          main: api.getPreloadDocumentStartMainScripts(event.senderFrame),
        }
      : { isolated: [], main: [] }
  })
}

/**
 * Implements `chrome.scripting` (MV3) for the session.
 *
 * Electron has no native implementation, so extensions that register content
 * scripts dynamically (e.g. Tampermonkey, which registers `page.js` + a bridge
 * `content.js` to `<all_urls>` instead of declaring `content_scripts` in the
 * manifest) get no injection at all. Without it, the popup reports
 * "has no access to this page" because the bridge never reports back.
 *
 * This mirrors UserScriptsAPI's injection model: scripts are stored per
 * extension and injected into matching frames at `dom-ready` (main frame) and
 * `did-frame-finish-load` (child frames). Before each extension's JS we prepend
 * a synthesized `chrome` bridge (see content-bridge.ts) so the content script
 * can talk to its background service worker over IPC.
 */
export class ScriptingAPI {
  private scriptsMap = new Map</* extensionId */ string, RegisteredContentScript[]>()
  /**
   * Per-frame record of which scripts have already been injected at the current
   * navigation epoch (the dynamicContentScripts token). Prevents a document_start
   * pass (did-frame-navigate) and the later document_end pass (dom-ready) — or
   * two overlapping injectExistingTabs calls — from injecting the same script
   * twice. Reset when the frame's token changes (i.e. on navigation).
   */
  private injected = new WeakMap<Electron.WebFrameMain, { token: number; keys: Set<string> }>()
  private readonly persistedFile = path.join(app.getPath('userData'), 'crx-dynamic-content-scripts.json')
  private persistedLoadPromise?: Promise<void>
  private persisted: Record<string, RegisteredContentScript[]> = {}

  constructor(private ctx: ExtensionContext) {
    scriptingBySession.set(ctx.session, this)
    installDocumentStartHandler()
    const handle = this.ctx.router.apiHandler()
    const opts = { permission: 'scripting' as chrome.runtime.ManifestPermissions }

    handle('scripting.registerContentScripts', this.registerContentScripts.bind(this), opts)
    handle('scripting.unregisterContentScripts', this.unregisterContentScripts.bind(this), opts)
    handle('scripting.updateContentScripts', this.updateContentScripts.bind(this), opts)
    handle('scripting.getRegisteredContentScripts', this.getRegisteredContentScripts.bind(this), opts)
    handle('scripting.executeScript', this.executeScript.bind(this), opts)
    handle('scripting.insertCSS', this.insertCSS.bind(this), opts)
    handle('scripting.removeCSS', this.removeCSS.bind(this), opts)

    const sessionExtensions = ctx.session.extensions || ctx.session
    sessionExtensions.on('extension-loaded', (_event: any, extension: Electron.Extension) => {
      log('extension-loaded', extension.id, extension.name)
      this.restoreExtension(extension).catch((err) =>
        warn('restore failed', extension.id, err && (err.stack || err.message || err)),
      )
    })
    sessionExtensions.on('extension-unloaded', (_event: any, extension: Electron.Extension) => {
      this.scriptsMap.delete(extension.id)
      this.ctx.dynamicContentScripts.clearExtension(extension.id)
      clearContentScriptBridge(extension.id)
    })

    this.ctx.store.on('tab-added', this.observeTab.bind(this))
    // Tabs added before this API subscribed won't fire 'tab-added' again —
    // observe them now so registered scripts inject on their next navigation
    // (and immediately, via observeTab's already-loaded check).
    try {
      for (const tab of Array.from(this.ctx.store.tabs) as Electron.WebContents[]) {
        this.observeTab(tab)
      }
    } catch {}
  }

  private getList(extensionId: string) {
    let list = this.scriptsMap.get(extensionId)
    if (!list) {
      list = []
      this.scriptsMap.set(extensionId, list)
    }
    return list
  }

  private async loadPersisted() {
    if (!this.persistedLoadPromise) {
      this.persistedLoadPromise = (async () => {
        try {
          const raw = await fs.readFile(this.persistedFile, 'utf8')
          const data = JSON.parse(raw)
          this.persisted = data && typeof data === 'object' ? data : {}
          log(
            'persisted loaded',
            this.persistedFile,
            'extensions=',
            Object.keys(this.persisted).join(',') || '(none)',
          )
        } catch {
          this.persisted = {}
          log('persisted missing/empty', this.persistedFile)
        }
      })()
    }
    await this.persistedLoadPromise
  }

  private async savePersisted() {
    await this.loadPersisted()
    const out: Record<string, RegisteredContentScript[]> = { ...this.persisted }
    for (const [extensionId, scripts] of this.scriptsMap) {
      const persistent = scripts.filter((script) => script.persistAcrossSessions !== false)
      if (persistent.length) {
        out[extensionId] = persistent.map(({ _code, _css, ...script }) => ({ ...script }))
      }
      else delete out[extensionId]
    }
    this.persisted = out
    try {
      await fs.mkdir(path.dirname(this.persistedFile), { recursive: true })
      await fs.writeFile(this.persistedFile, JSON.stringify(out, null, 2), 'utf8')
      log(
        'persisted saved',
        this.persistedFile,
        'extensions=',
        Object.keys(out).join(',') || '(none)',
      )
    } catch (err) {
      warn('persist save failed', err && (err.stack || err.message || err))
    }
  }

  private async restoreExtension(extension: Electron.Extension) {
    await this.loadPersisted()
    const scripts = this.persisted[extension.id]
    if (!Array.isArray(scripts) || scripts.length === 0) {
      log('restore none', extension.id)
      return
    }
    const restored: RegisteredContentScript[] = []
    for (const script of scripts) {
      const item = { ...script }
      item._code = await this.resolveCode(extension, item)
      item._css = await this.resolveCss(extension, item)
      restored.push(item)
    }
    this.scriptsMap.set(extension.id, restored)
    log(
      'restore ok',
      extension.id,
      'count=',
      scripts.length,
      'ids=',
      scripts.map((s) => s.id).join(','),
    )
    this.injectExistingTabs(extension.id)
  }

  private injectExistingTabs(extensionId?: string) {
    log('injectExistingTabs', extensionId || '*', 'tabs=', this.ctx.store.tabs.size)
    for (const tab of Array.from(this.ctx.store.tabs) as Electron.WebContents[]) {
      try {
        if (!tab.isDestroyed()) {
          log('injectExistingTab', extensionId || '*', 'tab=', tab.id, 'url=', tab.getURL())
          // Registered against an already-loaded tab → document_start timing is
          // moot; inject every phase now.
          this.injectInto(tab.mainFrame, false, extensionId, 'all')
        }
      } catch (err) {
        warn('injectExistingTab failed', extensionId || '*', err && (err.message || err))
      }
    }
  }

  private async registerContentScripts(
    event: ExtensionEvent,
    scripts: RegisteredContentScript[] = [],
  ) {
    const list = this.getList(event.extension.id)
    for (const script of scripts) {
      if (!script.id) throw new Error('Content script must have an id')
      if (
        (script.matches || []).some(
          (pattern) => !this.ctx.permissions?.hasOrigin(event.extension.id, pattern),
        )
      ) {
        throw new Error(`Content script ${script.id} requests an undeclared host`)
      }
      const existing = list.findIndex((s) => s.id === script.id)
      if (existing !== -1) {
        throw new Error(`Duplicate script id: ${script.id}`)
      }
      const stored = { ...script }
      stored._code = await this.resolveCode(event.extension, stored)
      stored._css = await this.resolveCss(event.extension, stored)
      list.push(stored)
    }
    log(
      'register',
      event.extension.id,
      'count=',
      scripts.length,
      'ids=',
      scripts.map((s) => s.id).join(','),
      'persist=',
      scripts.map((s) => `${s.id}:${s.persistAcrossSessions !== false}`).join(','),
    )
    await this.savePersisted()
    this.injectExistingTabs(event.extension.id)
  }

  private async updateContentScripts(event: ExtensionEvent, scripts: RegisteredContentScript[] = []) {
    const list = this.getList(event.extension.id)
    for (const script of scripts) {
      const index = list.findIndex((s) => s.id === script.id)
      if (index === -1) {
        throw new Error(`Content script does not exist: ${script.id}`)
      } else {
        const merged = { ...list[index], ...script }
        merged._code = await this.resolveCode(event.extension, merged)
        merged._css = await this.resolveCss(event.extension, merged)
        list[index] = merged
      }
    }
    log(
      'update',
      event.extension.id,
      'count=',
      scripts.length,
      'ids=',
      scripts.map((s) => s.id).join(','),
    )
    await this.savePersisted()
    this.injectExistingTabs(event.extension.id)
  }

  private async unregisterContentScripts(event: ExtensionEvent, filter?: { ids?: string[] }) {
    const ids = filter?.ids
    if (!ids) {
      this.scriptsMap.set(event.extension.id, [])
      log('unregister all', event.extension.id)
      await this.savePersisted()
      return
    }
    const list = this.getList(event.extension.id)
    this.scriptsMap.set(
      event.extension.id,
      list.filter((s) => !ids.includes(s.id)),
    )
    log('unregister', event.extension.id, 'ids=', ids.join(','))
    await this.savePersisted()
  }

  private getRegisteredContentScripts(event: ExtensionEvent, filter?: { ids?: string[] }) {
    const list = this.getList(event.extension.id)
    log(
      'getRegistered',
      event.extension.id,
      'filter=',
      filter?.ids?.join(',') || '(all)',
      'count=',
      list.length,
      'ids=',
      list.map((s) => s.id).join(','),
    )
    if (filter?.ids) return list.filter((s) => filter.ids!.includes(s.id))
    return list
  }

  // ---- Injection ----------------------------------------------------------

  private observeTab(tab: Electron.WebContents) {
    d(`observeTab tabId=${tab.id} destroyed=${tab.isDestroyed()}`)
    // document_start: inject as early as we reliably can — right after a frame's
    // navigation commits (document created, before the page's own scripts run).
    // did-frame-navigate fires for the main frame and every sub-frame.
    const startFrameHandler = (
      _event: Electron.Event,
      _url: string,
      _httpResponseCode: number,
      _httpStatusText: string,
      isMainFrame: boolean,
      frameProcessId: number,
      frameRoutingId: number,
    ) => {
      const frame = isMainFrame
        ? tab.mainFrame
        : webFrameMain.fromId(frameProcessId, frameRoutingId)
      if (frame) this.injectInto(frame, !isMainFrame, undefined, 'start')
    }
    const mainFrameHandler = () => {
      d(`dom-ready fired tabId=${tab.id}`)
      this.injectInto(tab.mainFrame, false, undefined, 'end')
    }
    const childFrameHandler = (
      _event: Electron.Event,
      isMainFrame: boolean,
      frameProcessId: number,
      frameRoutingId: number,
    ) => {
      if (isMainFrame) return
      const frame = webFrameMain.fromId(frameProcessId, frameRoutingId)
      if (frame) this.injectInto(frame, true, undefined, 'end')
    }

    tab.on('did-frame-navigate', startFrameHandler)
    tab.on('dom-ready', mainFrameHandler)
    tab.on('did-frame-finish-load', childFrameHandler)

    // If the tab already finished loading before we attached (it existed at
    // construction, or loaded between tab-added and this listener), inject now
    // so a registered script isn't stranded until the next navigation.
    try {
      if (!tab.isDestroyed()) this.injectInto(tab.mainFrame, false, undefined, 'all')
    } catch {}

    tab.once('destroyed', () => {
      tab.off('did-frame-navigate', startFrameHandler)
      tab.off('dom-ready', mainFrameHandler)
      tab.off('did-frame-finish-load', childFrameHandler)
    })
  }

  private async injectInto(
    frame: Electron.WebFrameMain | undefined,
    isChildFrame: boolean,
    onlyExtensionId?: string,
    phase: InjectPhase = 'all',
  ) {
    if (!frame) {
      log('inject skip no-frame', 'child=', isChildFrame, 'only=', onlyExtensionId || '*')
      return
    }
    if (isBrowserInternalFrame(frame)) {
      log('inject skip browser-internal', 'child=', isChildFrame)
      return
    }
    let url = ''
    try {
      url = frame.url
    } catch (e) {
      warn('inject skip frame.url threw', 'child=', isChildFrame, e)
      return
    }
    if (!url || (!/^(https?|file|ftp):/i.test(url) && !isRelatedFrameUrl(url))) {
      log('inject skip url', 'child=', isChildFrame, 'url=', (url || '').slice(0, 120))
      return
    }
    const registryToken = this.ctx.dynamicContentScripts.token(frame)
    log(
      'inject enter',
      'url=',
      url.slice(0, 160),
      'child=',
      isChildFrame,
      'extMaps=',
      this.scriptsMap.size,
      'only=',
      onlyExtensionId || '*',
    )

    const sessionExtensions = this.ctx.session.extensions || this.ctx.session

    for (const [extensionId, scripts] of this.scriptsMap) {
      if (onlyExtensionId && extensionId !== onlyExtensionId) continue
      const extension = sessionExtensions.getExtension(extensionId)
      if (!extension) {
        log('inject skip extension missing', extensionId)
        continue
      }

      for (const script of scripts) {
        // Only inject scripts belonging to the run_at phase being serviced
        // (document_start vs everything else). 'all' skips the filter.
        if (phase !== 'all') {
          const isStart = (script.runAt || 'document_idle') === 'document_start'
          if (phase === 'start' ? !isStart : isStart) continue
          // ISOLATED document_start scripts run from the registered frame
          // preload before page JavaScript. This pass is only for MAIN world.
          if (phase === 'start') continue
        }
        if (isChildFrame && !script.allFrames) {
          log('inject skip child-frame', extensionId, script.id)
          continue
        }
        if (!this.scriptMatches(script, frame)) {
          log(
            'inject skip match',
            extensionId,
            script.id,
            'url=',
            url.slice(0, 120),
            'matches=',
            (script.matches || []).join(','),
            'exclude=',
            (script.excludeMatches || []).join(','),
          )
          continue
        }
        if (!this.hasHostAccess(extension, frame)) {
          log('inject skip host permission', extensionId, script.id, 'url=', url.slice(0, 120))
          continue
        }

        const code = script._code ?? (await this.resolveCode(extension, script))
        if (!code) {
          warn('inject skip empty-code', extensionId, script.id, 'js=', JSON.stringify(script.js || []))
          continue
        }
        if (registryToken !== this.ctx.dynamicContentScripts.token(frame)) {
          log('inject skip navigated', extensionId, script.id)
          continue
        }

        // Idempotency: don't inject the same script twice into this frame at the
        // same navigation epoch (the document_start pass + the document_end pass,
        // or overlapping injectExistingTabs calls, would otherwise both run it).
        let injectedRec = this.injected.get(frame)
        if (!injectedRec || injectedRec.token !== registryToken) {
          injectedRec = { token: registryToken, keys: new Set<string>() }
          this.injected.set(frame, injectedRec)
        }
        const injectKey = `${extensionId}:${script.id}`
        if (injectedRec.keys.has(injectKey)) {
          log('inject skip duplicate', extensionId, script.id)
          continue
        }
        injectedRec.keys.add(injectKey)

        const isMainWorld = (script.world || 'ISOLATED').toUpperCase() === 'MAIN'
        let wrapped: string
        if (isMainWorld) {
          // MAIN-world content scripts run in the page's JS context with NO
          // chrome.* access (per Chrome spec). Inject RAW — do NOT prepend the
          // isolated-world `chrome` bridge. The bridge both pollutes the page
          // world and, for scripts that only hook page globals (e.g. pakku's
          // xhr_hook hooking XMLHttpRequest.prototype), is unnecessary and can
          // short-circuit the hook.
          wrapped = `(function(){\n${code}\n})();\nvoid 0;`
        } else {
          // ISOLATED-world: prepend a page-side `chrome` bridge bound to this
          // extension so the content script can reach its background SW.
          const bridge = buildContentScriptBridge(extensionId, extension.manifest)
          wrapped = `${bridge}\n(function(chrome){(function(){\n${code}\n})();})(globalThis.chrome);\nvoid 0;`
        }

        d(
          `inject ext=${extensionId} id=${script.id} world=${script.world || 'ISOLATED'} runAt=${script.runAt || 'document_idle'} child=${isChildFrame} url=${url.slice(0, 80)} len=${code.length}`,
        )
        log(
          'inject run',
          extensionId,
          script.id,
          'world=',
          script.world || 'ISOLATED',
          'runAt=',
          script.runAt || 'document_idle',
          'child=',
          isChildFrame,
          'url=',
          url.slice(0, 160),
          'len=',
          code.length,
        )
        executeExtensionScript(
          frame,
          extensionId,
          wrapped,
          isMainWorld ? 'MAIN' : 'ISOLATED',
        ).then(
          () => {
            log('inject ok', extensionId, script.id, 'url=', url.slice(0, 160))
            if (!isMainWorld) {
              this.ctx.dynamicContentScripts.mark(extensionId, frame, registryToken)
            }
          },
          (err) => {
            injectedRec!.keys.delete(injectKey)
            warn('inject failed', extensionId, script.id, 'url=', url.slice(0, 160), err)
          },
        )

        // Inject registered CSS (string paths per Chrome spec) via a <style>
        // element. WebFrameMain has no insertCSS; this works in both worlds.
        void Promise.resolve(script._css ?? this.resolveCss(extension, script)).then((css) => {
          if (!css) return
          const styleJs = `(function(){try{var s=document.createElement('style');s.textContent=${JSON.stringify(css)};(document.head||document.documentElement).appendChild(s);}catch(e){}})();`
          frame.executeJavaScript(styleJs, true).catch(() => {})
        })
      }
    }
  }

  private scriptMatches(script: RegisteredContentScript, frame: Electron.WebFrameMain) {
    const urls = getFrameMatchUrls(frame, {
      matchAboutBlank: script.matchAboutBlank,
      matchOriginAsFallback: script.matchOriginAsFallback,
    })
    return matchesScriptFilter({
      urls,
      matches: script.matches,
      excludeMatches: script.excludeMatches,
      includeGlobs: script.includeGlobs,
      excludeGlobs: script.excludeGlobs,
    })
  }

  private collectDocumentStartScripts(
    frame: Electron.WebFrameMain | null | undefined,
    targetWorld: 'MAIN',
  ): string[]
  private collectDocumentStartScripts(
    frame: Electron.WebFrameMain | null | undefined,
    targetWorld: 'ISOLATED',
  ): PreloadIsolatedScript[]
  private collectDocumentStartScripts(
    frame: Electron.WebFrameMain | null | undefined,
    targetWorld: 'MAIN' | 'ISOLATED',
  ): Array<string | PreloadIsolatedScript> {
    if (!frame) return []
    const sessionExtensions = this.ctx.session.extensions || this.ctx.session
    const token = this.ctx.dynamicContentScripts.token(frame)
    const payloads: Array<string | PreloadIsolatedScript> = []
    for (const [extensionId, scripts] of this.scriptsMap) {
      const extension = sessionExtensions.getExtension(extensionId)
      if (!extension || !this.hasHostAccess(extension, frame)) continue
      for (const script of scripts) {
        if ((script.runAt || 'document_idle') !== 'document_start') continue
        const scriptWorld = (script.world || 'ISOLATED') === 'MAIN' ? 'MAIN' : 'ISOLATED'
        if (scriptWorld !== targetWorld) continue
        if (frame.parent && !script.allFrames) continue
        if (!this.scriptMatches(script, frame) || !script._code) continue

        let record = this.injected.get(frame)
        if (!record || record.token !== token) {
          record = { token, keys: new Set<string>() }
          this.injected.set(frame, record)
        }
        const key = `${extensionId}:${script.id}`
        if (record.keys.has(key)) continue
        record.keys.add(key)

        const bridge = targetWorld === 'ISOLATED'
          ? `${buildContentScriptBridge(extensionId, extension.manifest)}\n`
          : ''
        const guardId = JSON.stringify(key)
        const css = script._css
          ? `var s=document.createElement('style');s.textContent=${JSON.stringify(script._css)};(document.head||document.documentElement).appendChild(s);`
          : ''
        const code =
          `${bridge}window.__crxInjected=window.__crxInjected||{};` +
          `if(!window.__crxInjected[${guardId}]){window.__crxInjected[${guardId}]=1;` +
          `${css}\n(function(chrome){(function(){${script._code}\n})();})(globalThis.chrome);}\nvoid 0;`
        payloads.push(
          targetWorld === 'ISOLATED'
            ? { code, worldId: extensionWorldId(extensionId) }
            : code,
        )
      }
    }
    return payloads
  }

  getDocumentStartScripts(
    frame: Electron.WebFrameMain | null | undefined,
  ): PreloadIsolatedScript[] {
    return this.collectDocumentStartScripts(frame, 'ISOLATED')
  }

  getDocumentStartMainScripts(frame: Electron.WebFrameMain | null | undefined): string[] {
    return this.collectDocumentStartScripts(frame, 'MAIN')
  }

  getPreloadDocumentStartScripts(
    frame: Electron.WebFrameMain | null | undefined,
  ): PreloadIsolatedScript[] {
    return [
      ...this.getDocumentStartScripts(frame),
      ...(this.ctx.userScripts?.getDocumentStartScripts(frame) || []),
    ]
  }

  getPreloadDocumentStartMainScripts(frame: Electron.WebFrameMain | null | undefined): string[] {
    return [
      ...this.getDocumentStartMainScripts(frame),
      ...(this.ctx.userScripts?.getDocumentStartMainScripts?.(frame) || []),
    ]
  }

  private hasHostAccess(extension: Electron.Extension, frame: Electron.WebFrameMain) {
    const urls = getFrameMatchUrls(frame, {
      matchAboutBlank: true,
      matchOriginAsFallback: true,
    })
    if (urls.some((url) => this.ctx.permissions?.hasOrigin(extension.id, url))) return true
    const activeTab = this.ctx.store.getActiveTabOfCurrentWindow()
    return (
      extension.manifest.permissions?.includes('activeTab') === true &&
      !!activeTab &&
      !frame.parent &&
      activeTab.mainFrame === frame
    )
  }

  private async resolveCode(extension: Electron.Extension, script: RegisteredContentScript) {
    const parts: string[] = []
    for (const source of (script.js || []) as any[]) {
      // Chrome's `scripting.registerContentScripts` passes `js` as an array of
      // STRING paths (e.g. pakku: js:["/generated/xhr_hook.js"]). The `{file}`
      // object form is only for `scripting.executeScript({files})`. Accept both.
      const file = typeof source === 'string' ? source : source?.file
      if (typeof source === 'object' && source.code) {
        parts.push(source.code)
      } else if (file) {
        const filePath = resolveExtensionPath(extension, file)
        if (!filePath) continue
        try {
          parts.push(await fs.readFile(filePath, 'utf8'))
        } catch (err) {
          d(`failed to read ${file} for ${extension.id}: ${err}`)
        }
      }
    }
    return parts.join('\n')
  }

  /** Resolve a registered script's `css` (string paths per Chrome spec) to CSS text. */
  private async resolveCss(extension: Electron.Extension, script: RegisteredContentScript) {
    const parts: string[] = []
    for (const source of (script.css || []) as any[]) {
      const file = typeof source === 'string' ? source : source?.file
      if (file) {
        const filePath = resolveExtensionPath(extension, file)
        if (!filePath) continue
        try {
          parts.push(await fs.readFile(filePath, 'utf8'))
        } catch {
          /* ignore unreadable css */
        }
      }
    }
    return parts.join('\n')
  }

  // ---- executeScript / CSS ------------------------------------------------

  private async executeScript(event: ExtensionEvent, injection: any = {}) {
    const target = injection.target || {}
    const tabId: number | undefined = target.tabId
    const tab = typeof tabId === 'number' ? this.ctx.store.getTabById(tabId) : undefined
    if (!tab || tab.isDestroyed()) return []

    let frames: Electron.WebFrameMain[] = [tab.mainFrame]
    if (target.allFrames || Array.isArray(target.frameIds)) {
      try {
        for (const f of tab.mainFrame.framesInSubtree) {
          if (f !== tab.mainFrame) frames.push(f)
        }
      } catch {}
    }
    if (Array.isArray(target.frameIds)) {
      const ids = new Set(target.frameIds)
      frames = frames.filter((frame) => ids.has(frame.frameTreeNodeId))
    }

    for (const frame of frames) {
      if (!this.hasHostAccess(event.extension, frame)) {
        throw new Error(`Cannot access contents of url "${frame.url}"`)
      }
    }

    let codes: string[] = []
    if (typeof injection.func === 'function' || typeof injection.func === 'string') {
      const fnStr = String(injection.func)
      const args = JSON.stringify(injection.args || [])
      codes = [`(${fnStr}).apply(null, ${args});`]
    } else if (Array.isArray(injection.files)) {
      const sessionExtensions = this.ctx.session.extensions || this.ctx.session
      const extension = sessionExtensions.getExtension(event.extension.id)
      for (const file of injection.files) {
        const filePath = extension && resolveExtensionPath(extension, file)
        if (!filePath) continue
        try {
          codes.push(await fs.readFile(filePath, 'utf8'))
        } catch (err) {
          d(`executeScript read ${file} failed: ${err}`)
        }
      }
    }

    if (codes.length === 0) throw new Error('No script source was provided')
    const code = codes.join('\n')
    const world = String(injection.world || 'ISOLATED').toUpperCase() === 'MAIN' ? 'MAIN' : 'ISOLATED'
    const results: any[] = []
    for (const frame of frames) {
      const result = await executeExtensionScript(
        frame,
        event.extension.id,
        code,
        world,
      )
      results.push({ frameId: frame.frameTreeNodeId, result })
    }
    return results
  }

  private async insertCSS(event: ExtensionEvent, injection: any = {}) {
    const target = injection.target || {}
    const tab = typeof target.tabId === 'number' ? this.ctx.store.getTabById(target.tabId) : undefined
    if (!tab || tab.isDestroyed()) return
    if (!this.hasHostAccess(event.extension, tab.mainFrame)) {
      throw new Error(`Cannot access contents of url "${tab.getURL()}"`)
    }
    let css = ''
    if (injection.css) {
      css = injection.css
    } else if (Array.isArray(injection.files)) {
      const sessionExtensions = this.ctx.session.extensions || this.ctx.session
      const extension = sessionExtensions.getExtension(event.extension.id)
      for (const file of injection.files) {
        const filePath = extension && resolveExtensionPath(extension, file)
        if (!filePath) continue
        try {
          css += (await fs.readFile(filePath, 'utf8')) + '\n'
        } catch {}
      }
    }
    if (css) {
      try {
        await tab.insertCSS(css)
      } catch (err) {
        d(`insertCSS failed: ${err}`)
      }
    }
  }

  private async removeCSS(_event: ExtensionEvent, _injection: any = {}) {
    // Electron's insertCSS returns a key for removal; we don't track keys here.
    // No-op for now (Tampermonkey does not rely on removeCSS).
  }
}
