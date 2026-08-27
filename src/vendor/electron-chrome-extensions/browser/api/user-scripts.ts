import { app, webFrameMain } from 'electron'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import debug from 'debug'

import { ExtensionContext, PreloadIsolatedScript } from '../context'
import { ExtensionEvent } from '../router'
import {
  getFrameMatchUrls,
  isBrowserInternalFrame,
  isBrowserInternalUrl,
  isRelatedFrameUrl,
  matchesScriptFilter,
  executeExtensionScript,
  extensionWorldId,
} from './common'
import {
  buildUserScriptMessagingBridge,
  clearContentScriptBridge,
} from './content-bridge'

const d = debug('electron-chrome-extensions:userScripts')
const log = (...args: any[]) => console.log('[crx-userScripts]', ...args)
const warn = (...args: any[]) => console.warn('[crx-userScripts]', ...args)

/** A single source entry for a user script: inline code or a packaged file. */
interface ScriptSource {
  code?: string
  file?: string
}

/**
 * Subset of chrome.userScripts.RegisteredUserScript that we persist.
 * `@types/chrome` in this project predates the userScripts API, so the shape
 * is described locally.
 */
interface RegisteredUserScript {
  id: string
  matches?: string[]
  excludeMatches?: string[]
  includeGlobs?: string[]
  excludeGlobs?: string[]
  js?: ScriptSource[]
  runAt?: 'document_start' | 'document_end' | 'document_idle'
  allFrames?: boolean
  world?: 'USER_SCRIPT' | 'MAIN'
  worldId?: string
  persistAcrossSessions?: boolean
  matchAboutBlank?: boolean
  matchOriginAsFallback?: boolean
  /** Resolved code (files read + inline code joined) cached at register time. */
  _code?: string
}

interface WorldConfiguration {
  worldId?: string
  csp?: string
  messaging?: boolean
}

interface UserScriptGroup {
  world: 'MAIN' | 'ISOLATED'
  worldName: string
  blocks: string[]
  messagingEnabled: boolean
}

/**
 * Implements `chrome.userScripts` for the session.
 *
 * Electron has no native implementation, so scripts registered by extensions
 * (e.g. Tampermonkey under MV3) are stored here and injected into matching
 * frames via `executeJavaScript`.
 *
 * Design:
 * - At register/update time we resolve each script's sources (reading any
 *   `file` from disk) into a single code string, cached on `_code`. Reads
 *   happen once, not on every navigation.
 * - On navigation we concatenate the code of all matching scripts for the
 *   frame and inject in a single `executeJavaScript` call, guarded by
 *   `window.__crxInjected` so the same script id never runs twice per frame.
 * - A page-side `chrome` bridge (see content-bridge.ts) is prepended so
 *   injected content scripts can reach their background service worker.
 *
 * Trade-off: `runAt` is best-effort — injection happens at `dom-ready` (main
 * frame) and `did-frame-finish-load` (child frames) regardless of requested
 * time. All scripts run in the page's main world.
 */
export class UserScriptsAPI {
  /** Map of extension id -> registered scripts. */
  private scriptsMap = new Map</* extensionId */ string, RegisteredUserScript[]>()
  /** Map of extension id -> world configurations keyed by worldId (''=default). */
  private worldsMap = new Map</* extensionId */ string, Map<string, WorldConfiguration>>()
  private readonly persistedFile = path.join(app.getPath('userData'), 'crx-user-scripts.json')
  private persistedLoadPromise?: Promise<void>
  private persisted: Record<string, { scripts?: RegisteredUserScript[]; worlds?: WorldConfiguration[] }> =
    {}

  constructor(private ctx: ExtensionContext) {
    this.ctx.userScripts = this
    const handle = this.ctx.router.apiHandler()
    const opts = { permission: 'userScripts' as chrome.runtime.ManifestPermissions }

    handle('userScripts.register', this.register.bind(this), opts)
    handle('userScripts.unregister', this.unregister.bind(this), opts)
    handle('userScripts.update', this.update.bind(this), opts)
    handle('userScripts.getScripts', this.getScripts.bind(this), opts)
    handle('userScripts.configureWorld', this.configureWorld.bind(this), opts)
    handle('userScripts.getWorldConfigurations', this.getWorldConfigurations.bind(this), opts)
    handle('userScripts.resetWorldConfiguration', this.resetWorldConfiguration.bind(this), opts)

    const sessionExtensions = ctx.session.extensions || ctx.session
    sessionExtensions.on('extension-loaded', (_event: any, extension: Electron.Extension) => {
      log('extension-loaded', extension.id, extension.name)
      this.restoreExtension(extension).catch((err) =>
        warn('restore failed', extension.id, err && (err.stack || err.message || err)),
      )
    })
    sessionExtensions.on('extension-unloaded', (_event: any, extension: Electron.Extension) => {
      this.scriptsMap.delete(extension.id)
      this.worldsMap.delete(extension.id)
      this.ctx.dynamicContentScripts.clearExtension(extension.id)
      clearContentScriptBridge(extension.id)
    })

    this.ctx.store.on('tab-added', this.observeTab.bind(this))
  }

  // ---- Registry -----------------------------------------------------------

  private async register(event: ExtensionEvent, scripts: RegisteredUserScript[] = []) {
    const extension = event.extension
    const list = this.getList(extension.id)
    for (const script of scripts) {
      if (!script.id) throw new Error('User script must have an id')
      this.validateHosts(extension, script)
      if (list.some((s) => s.id === script.id)) {
        throw new Error(`Duplicate script id: ${script.id}`)
      }
      const stored: RegisteredUserScript = { ...script }
      stored._code = await this.resolveCode(extension as any, stored)
      list.push(stored)
    }
    log(
      'register',
      extension.id,
      'count=',
      scripts.length,
      'ids=',
      scripts.map((s) => s.id).join(','),
      'persist=',
      scripts.map((s) => `${s.id}:${s.persistAcrossSessions !== false}`).join(','),
    )
    await this.savePersisted()
    this.injectExistingTabs(extension.id)
  }

  private async update(event: ExtensionEvent, scripts: RegisteredUserScript[] = []) {
    const extension = event.extension
    const list = this.getList(extension.id)
    for (const script of scripts) {
      const index = list.findIndex((s) => s.id === script.id)
      if (index === -1) throw new Error(`Script not found: ${script.id}`)
      const merged: RegisteredUserScript = { ...list[index], ...script }
      this.validateHosts(extension, merged)
      merged._code = await this.resolveCode(extension as any, merged)
      list[index] = merged
    }
    log(
      'update',
      extension.id,
      'count=',
      scripts.length,
      'ids=',
      scripts.map((s) => s.id).join(','),
    )
    await this.savePersisted()
    this.injectExistingTabs(extension.id)
  }

  private async unregister(event: ExtensionEvent, filter?: { ids?: string[] }) {
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

  private getScripts(event: ExtensionEvent, filter?: { ids?: string[] }) {
    const list = this.getList(event.extension.id).map(({ _code, ...rest }) => rest)
    log(
      'getScripts',
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

  private async configureWorld(event: ExtensionEvent, properties: WorldConfiguration = {}) {
    const worlds = this.getWorlds(event.extension.id)
    worlds.set(properties.worldId || '', { ...properties })
    await this.savePersisted()
  }

  private getWorldConfigurations(event: ExtensionEvent) {
    return Array.from(this.getWorlds(event.extension.id).values())
  }

  private async resetWorldConfiguration(event: ExtensionEvent, worldId?: string) {
    this.getWorlds(event.extension.id).delete(worldId || '')
    await this.savePersisted()
  }

  private getList(extensionId: string) {
    let list = this.scriptsMap.get(extensionId)
    if (!list) {
      list = []
      this.scriptsMap.set(extensionId, list)
    }
    return list
  }

  private getWorlds(extensionId: string) {
    let worlds = this.worldsMap.get(extensionId)
    if (!worlds) {
      worlds = new Map()
      this.worldsMap.set(extensionId, worlds)
    }
    return worlds
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
    const out: Record<string, { scripts?: RegisteredUserScript[]; worlds?: WorldConfiguration[] }> = {
      ...this.persisted,
    }
    for (const [extensionId, scripts] of this.scriptsMap) {
      const persistent = scripts
        .filter((script) => script.persistAcrossSessions !== false)
        .map(({ _code, ...script }) => ({ ...script }))
      const worlds = Array.from(this.getWorlds(extensionId).values()).map((world) => ({ ...world }))
      if (persistent.length || worlds.length) out[extensionId] = { scripts: persistent, worlds }
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
    const entry = this.persisted[extension.id]
    const scripts = Array.isArray(entry?.scripts) ? entry!.scripts! : []
    const worlds = Array.isArray(entry?.worlds) ? entry!.worlds! : []
    log('restore check', extension.id, 'scripts=', scripts.length, 'worlds=', worlds.length)
    if (worlds.length) {
      const map = this.getWorlds(extension.id)
      map.clear()
      for (const world of worlds) map.set(world.worldId || '', { ...world })
    }
    if (scripts.length) {
      const restored: RegisteredUserScript[] = []
      for (const script of scripts) {
        const item = { ...script }
        item._code = await this.resolveCode(extension as any, item)
        restored.push(item)
      }
      this.scriptsMap.set(extension.id, restored)
      log(
        'restore ok',
        extension.id,
        'count=',
        restored.length,
        'ids=',
        restored.map((s) => s.id).join(','),
        'lens=',
        restored.map((s) => `${s.id}:${(s._code || '').length}`).join(','),
      )
      this.injectRestoredExtension(extension)
    }
  }

  private injectRestoredExtension(extension: Electron.Extension) {
    // Chrome persists registered user scripts independently of the extension
    // service worker. They must be eligible at document_start even while the
    // worker is stopped; messaging from the script can wake it on demand.
    // Waiting for `running` created a multi-second blind window at startup and,
    // when no tabs existed at the timeout, permanently missed the first tab.
    this.injectExistingTabs(extension.id)
  }

  private injectExistingTabs(extensionId?: string) {
    log('injectExistingTabs', extensionId || '*', 'tabs=', this.ctx.store.tabs.size)
    for (const tab of Array.from(this.ctx.store.tabs) as Electron.WebContents[]) {
      try {
        if (!tab.isDestroyed()) {
          log('injectExistingTab', extensionId || '*', 'tab=', tab.id, 'url=', tab.getURL())
          this.injectInto(tab.mainFrame, tab.getURL(), false, extensionId)
        }
      } catch (err) {
        warn('injectExistingTab failed', extensionId || '*', err && (err.message || err))
      }
    }
  }

  /** Resolve a script's sources to a single code string (files read once). */
  private async resolveCode(extension: Electron.Extension, script: RegisteredUserScript) {
    const parts: string[] = []
    for (const source of script.js || []) {
      if (source.code) {
        parts.push(source.code)
      } else if (source.file) {
        try {
          parts.push(await fs.readFile(path.join(extension.path, source.file), 'utf8'))
        } catch (err) {
          d(`failed to read ${source.file} for ${extension.id}: ${err}`)
        }
      }
    }
    return parts.join('\n')
  }

  // ---- Injection ----------------------------------------------------------

  /** Attach navigation listeners to a newly tracked tab. */
  private observeTab(tab: Electron.WebContents) {
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
      if (frame) this.injectInto(frame, frame.url, !isMainFrame, undefined, 'start')
    }
    const mainFrameHandler = () => {
      log('dom-ready', 'tab=', tab.id, 'url=', tab.getURL())
      this.injectInto(tab.mainFrame, tab.getURL(), false, undefined, 'end')
    }

    const childFrameHandler = (
      _event: Electron.Event,
      isMainFrame: boolean,
      frameProcessId: number,
      frameRoutingId: number,
    ) => {
      if (isMainFrame) return
      const frame = webFrameMain.fromId(frameProcessId, frameRoutingId)
      if (frame) {
        log('child-frame-finish', 'tab=', tab.id, 'url=', frame.url)
        this.injectInto(frame, frame.url, true, undefined, 'end')
      }
    }

    tab.on('did-frame-navigate', startFrameHandler)
    tab.on('dom-ready', mainFrameHandler)
    tab.on('did-frame-finish-load', childFrameHandler)

    tab.once('destroyed', () => {
      tab.off('did-frame-navigate', startFrameHandler)
      tab.off('dom-ready', mainFrameHandler)
      tab.off('did-frame-finish-load', childFrameHandler)
    })
  }

  private scriptMatches(
    script: RegisteredUserScript,
    frame: Electron.WebFrameMain,
    currentUrl?: string,
  ) {
    const urls = getFrameMatchUrls(frame, {
      matchAboutBlank: script.matchAboutBlank,
      matchOriginAsFallback: script.matchOriginAsFallback,
      urlOverride: currentUrl,
    })
    return matchesScriptFilter({
      urls,
      matches: script.matches,
      excludeMatches: script.excludeMatches,
      includeGlobs: script.includeGlobs,
      excludeGlobs: script.excludeGlobs,
    })
  }

  /**
   * Concatenate all matching scripts for the frame and inject once. Each
   * script's body is guarded by `window.__crxInjected[id]` so re-injection
   * (multiple navigation events for the same document) is a no-op.
   */
  private injectInto(
    frame: Electron.WebFrameMain | undefined,
    url: string,
    isChildFrame: boolean,
    onlyExtensionId?: string,
    phase: InjectPhase = 'all',
  ) {
    if (!frame) {
      log('inject skip no-frame', 'child=', isChildFrame, 'only=', onlyExtensionId || '*')
      return
    }
    if (isBrowserInternalFrame(frame)) {
      log('inject skip browser-internal', 'url=', (url || '').slice(0, 120))
      return
    }
    // Native window.open() creates an about:blank renderer before Chromium starts
    // the requested navigation. Executing an isolated-world userscript during
    // that handoff crashes Electron 43's renderer on Windows (0xC0000005).
    // The destination will receive its normal dom-ready injection after it
    // commits, so skipping this transient document does not skip the script.
    if (!isChildFrame && /^about:blank(?:[?#]|$)/i.test(url || '')) {
      log('inject skip transient about:blank')
      return
    }
    if (!url || (!/^(https?|file|ftp):/i.test(url) && !isRelatedFrameUrl(url))) {
      log('inject skip url', 'child=', isChildFrame, 'url=', (url || '').slice(0, 120))
      return
    }

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

      const groups = new Map<string, UserScriptGroup>()
      for (const script of scripts) {
        if (phase !== 'all') {
          const isStart = (script.runAt || 'document_idle') === 'document_start'
          if (phase === 'start' ? !isStart : isStart) continue
        }
        if (isChildFrame && !script.allFrames) {
          log('inject skip child-frame', extensionId, script.id)
          continue
        }
        if (!this.hasHostAccess(extension, frame)) {
          log('inject skip host permission', extensionId, script.id, 'url=', url.slice(0, 120))
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
        const code = script._code
        if (!code) {
          warn('inject skip empty-code', extensionId, script.id, 'js=', JSON.stringify(script.js || []))
          continue
        }
        const guardId = JSON.stringify(`${extensionId}:${script.id}`)
        // Guard so the same script id never executes twice in this frame.
        const world = script.world === 'MAIN' ? 'MAIN' : 'ISOLATED'
        // Chrome isolates the USER_SCRIPT world from the extension's own
        // content-script ISOLATED world. Both would otherwise hash to
        // worldName='' and share a single V8 isolated world
        // (extensionWorldId keys on extId+worldName), letting a userscript read
        // or stomp the extension's content-script state and vice-versa. Give
        // user scripts a dedicated world-name namespace so they cannot collide
        // with manifest/scripting content scripts.
        const isUserScriptWorld = script.world !== 'MAIN'
        const worldName = isUserScriptWorld
          ? `__crxus__${script.worldId || ''}`
          : script.worldId || ''
        // Chrome gates chrome.* in a user-script world behind
        // userScripts.configureWorld({ messaging: true }); the default is NO
        // chrome API access. Looked up by the extension-facing worldId.
        const messagingEnabled = this.worldMessagingEnabled(extensionId, script.worldId || '')
        const groupKey = `${world}:${worldName}`
        let group = groups.get(groupKey)
        if (!group) {
          group = { world, worldName, blocks: [], messagingEnabled }
          groups.set(groupKey, group)
        }
        group.blocks.push(
          `if(!window.__crxInjected[${guardId}]){window.__crxInjected[${guardId}]=1;\n` +
            `try{\n(function(chrome){(function(){${code}\n})();})(globalThis.chrome);\n}catch(e){console.error('[crx inject ${script.id}]',e)}\n}`,
        )
      }
      if (groups.size === 0) {
        log('inject no blocks', extensionId, 'url=', url.slice(0, 160), 'scripts=', scripts.length)
        continue
      }

      const messagingBridge = buildUserScriptMessagingBridge(
        extensionId,
        extension.manifest,
      )
      const registryToken = this.ctx.dynamicContentScripts.token(frame)
      for (const group of groups.values()) {
        // MAIN executes in the page and must never receive extension APIs.
        // USER_SCRIPT worlds only receive the runtime messaging surface after
        // configureWorld({ messaging: true }).
        const prefix =
          group.world === 'ISOLATED' && group.messagingEnabled
            ? `${messagingBridge}\n`
            : ''
        const wrapped =
          `${prefix}window.__crxInjected=window.__crxInjected||{};\n` +
          group.blocks.join('\n') +
          '\nvoid 0;'
        executeExtensionScript(
          frame,
          extensionId,
          wrapped,
          group.world,
          group.worldName,
        ).then(
          () => {
            log('inject ok', extensionId, 'blocks=', group.blocks.length, 'url=', url.slice(0, 160))
            if (group.world !== 'MAIN') {
              this.ctx.dynamicContentScripts.mark(extensionId, frame, registryToken)
            }
          },
          (err) => warn('inject failed', extensionId, 'url=', url.slice(0, 160), err),
        )
      }
    }
  }

  private hasHostAccess(
    extension: Electron.Extension,
    frame: Electron.WebFrameMain,
    currentUrl?: string,
  ) {
    return getFrameMatchUrls(frame, {
      matchAboutBlank: true,
      matchOriginAsFallback: true,
      urlOverride: currentUrl,
    }).some((candidate) => this.ctx.permissions?.hasOrigin(extension.id, candidate))
  }

  /**
   * Whether an extension has enabled `messaging` for a given user-script world
   * via `userScripts.configureWorld({ messaging: true })`. Chrome defaults to
   * `false` — no chrome.* API surface in a USER_SCRIPT world unless opted in.
   */
  private worldMessagingEnabled(extensionId: string, worldId: string): boolean {
    return this.worldsMap.get(extensionId)?.get(worldId || '')?.messaging === true
  }

  getDocumentStartScripts(
    frame: Electron.WebFrameMain | null | undefined,
    currentUrl?: string,
  ): PreloadIsolatedScript[] {
    if (!frame) return []
    if (currentUrl && isBrowserInternalUrl(currentUrl)) return []
    const sessionExtensions = this.ctx.session.extensions || this.ctx.session
    const payloads: PreloadIsolatedScript[] = []
    for (const [extensionId, scripts] of this.scriptsMap) {
      const extension = sessionExtensions.getExtension(extensionId)
      if (!extension || !this.hasHostAccess(extension, frame, currentUrl)) continue
      for (const script of scripts) {
        if ((script.runAt || 'document_idle') !== 'document_start') continue
        if (script.world === 'MAIN' || (frame.parent && !script.allFrames)) continue
        if (!this.scriptMatches(script, frame, currentUrl) || !script._code) continue
        const worldName = `__crxus__${script.worldId || ''}`
        const messagingEnabled = this.worldMessagingEnabled(
          extensionId,
          script.worldId || '',
        )
        const bridge = messagingEnabled
          ? `${buildUserScriptMessagingBridge(extensionId, extension.manifest)}\n`
          : ''
        const guardId = JSON.stringify(`${extensionId}:${script.id}`)
        const code =
          `${bridge}window.__crxInjected=window.__crxInjected||{};` +
            `if(!window.__crxInjected[${guardId}]){window.__crxInjected[${guardId}]=1;` +
          `(function(chrome){(function(){${script._code}\n})();})(globalThis.chrome);}\nvoid 0;`
        payloads.push({
          code,
          worldId: extensionWorldId(extensionId, worldName),
        })
      }
    }
    return payloads
  }

  getDocumentStartMainScripts(
    frame: Electron.WebFrameMain | null | undefined,
    currentUrl?: string,
  ): string[] {
    if (!frame) return []
    if (currentUrl && isBrowserInternalUrl(currentUrl)) return []
    const sessionExtensions = this.ctx.session.extensions || this.ctx.session
    const payloads: string[] = []
    for (const [extensionId, scripts] of this.scriptsMap) {
      const extension = sessionExtensions.getExtension(extensionId)
      if (!extension || !this.hasHostAccess(extension, frame, currentUrl)) continue
      for (const script of scripts) {
        if ((script.runAt || 'document_idle') !== 'document_start') continue
        if (script.world !== 'MAIN' || (frame.parent && !script.allFrames)) continue
        if (!this.scriptMatches(script, frame, currentUrl) || !script._code) continue
        const guardId = JSON.stringify(`${extensionId}:${script.id}`)
        payloads.push(
          `window.__crxInjected=window.__crxInjected||{};` +
            `if(!window.__crxInjected[${guardId}]){window.__crxInjected[${guardId}]=1;` +
            `(function(){${script._code}\n})();}\nvoid 0;`,
        )
      }
    }
    return payloads
  }

  private validateHosts(extension: Electron.Extension, script: RegisteredUserScript) {
    if (
      (script.matches || []).some(
        (pattern) => !this.ctx.permissions?.hasOrigin(extension.id, pattern),
      )
    ) {
      throw new Error(`User script ${script.id} requests an undeclared host`)
    }
  }
}

type InjectPhase = 'start' | 'end' | 'all'
