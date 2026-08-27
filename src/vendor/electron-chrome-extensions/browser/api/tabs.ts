import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'
import {
  getAllWindows,
  matchesPattern,
  matchesTitlePattern,
  resolveExtensionPath,
  TabContents,
} from './common'
import { WindowsAPI } from './windows'
import { webContents } from 'electron'
import { promises as fs } from 'node:fs'
import debug from 'debug'

const d = debug('electron-chrome-extensions:tabs')
const tabLog = (...args: any[]) => {
  if (process.env.CRX_WEBREQUEST_DEBUG !== '1' && process.env.CRX_VERBOSE !== '1') return
  try {
    console.log('[crx-tabs]', ...args)
  } catch {}
}
let tabGetLogCount = 0

const toPlainTab = (tab: Partial<chrome.tabs.Tab>): chrome.tabs.Tab => {
  try {
    // Keep present and future Chrome Tab fields while stripping prototypes,
    // functions, and other values that cannot cross Electron IPC.
    const plain = JSON.parse(JSON.stringify(tab)) as chrome.tabs.Tab
    if (typeof plain.status !== 'string') delete plain.status
    return plain
  } catch {
    // A host hook may attach a circular or otherwise non-JSON value. Preserve
    // the standard Tab surface so one optional field cannot reject the API.
    return {
      active: !!tab.active,
      audible: !!tab.audible,
      autoDiscardable: !!tab.autoDiscardable,
      discarded: !!tab.discarded,
      favIconUrl: typeof tab.favIconUrl === 'string' ? tab.favIconUrl : undefined,
      frozen: !!tab.frozen,
      groupId: typeof tab.groupId === 'number' ? tab.groupId : -1,
      height: typeof tab.height === 'number' ? tab.height : 0,
      highlighted: !!tab.highlighted,
      id: typeof tab.id === 'number' ? tab.id : TabsAPI.TAB_ID_NONE,
      incognito: !!tab.incognito,
      index: typeof tab.index === 'number' ? tab.index : 0,
      mutedInfo: { muted: !!tab.mutedInfo?.muted },
      pinned: !!tab.pinned,
      selected: !!tab.selected,
      status:
        tab.status === 'loading' || tab.status === 'complete' ? tab.status : undefined,
      title: typeof tab.title === 'string' ? tab.title : undefined,
      url: typeof tab.url === 'string' ? tab.url : undefined,
      width: typeof tab.width === 'number' ? tab.width : 0,
      windowId:
        typeof tab.windowId === 'number' ? tab.windowId : TabsAPI.WINDOW_ID_NONE,
    } as chrome.tabs.Tab
  }
}

const validateExtensionUrl = (url: string, extension: Electron.Extension) => {
  // Convert relative URLs to absolute if needed
  try {
    url = new URL(url, extension.url).href
  } catch (e) {
    throw new Error('Invalid URL')
  }

  // Prevent creating chrome://kill or other debug commands
  if (url.startsWith('chrome:') || url.startsWith('javascript:')) {
    throw new Error('Invalid URL')
  }

  return url
}

export class TabsAPI {
  static TAB_ID_NONE = -1
  static WINDOW_ID_NONE = -1
  static WINDOW_ID_CURRENT = -2

  private warnedUntrackedExtensionTabs = new WeakSet<Electron.WebContents>()

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('tabs.get', this.get.bind(this))
    handle('tabs.getAllInWindow', this.getAllInWindow.bind(this))
    handle('tabs.getCurrent', this.getCurrent.bind(this))
    handle('tabs.create', this.create.bind(this))
    handle('tabs.insertCSS', this.insertCSS.bind(this))
    handle('tabs.query', this.query.bind(this))
    handle('tabs.reload', this.reload.bind(this))
    handle('tabs.update', this.update.bind(this))
    handle('tabs.highlight', this.highlight.bind(this))
    handle('tabs.remove', this.remove.bind(this))
    handle('tabs.goForward', this.goForward.bind(this))
    handle('tabs.goBack', this.goBack.bind(this))
    // Previously advertised by the SW-dedicated tabs patch but unimplemented —
    // calling them threw "not a registered handler" and crashed the SW. All use
    // Electron-native APIs where possible.
    handle('tabs.captureVisibleTab', this.captureVisibleTab.bind(this))
    handle('tabs.duplicate', this.duplicate.bind(this))
    handle('tabs.detectLanguage', this.detectLanguage.bind(this))
    handle('tabs.getZoom', this.getZoom.bind(this))
    handle('tabs.setZoom', this.setZoom.bind(this))
    handle('tabs.getZoomSettings', this.getZoomSettings.bind(this))
    // Electron has no zoom-mode/scope distinction; accept the call but no-op.
    handle('tabs.setZoomSettings', this.setZoomSettings.bind(this))

    this.ctx.store.on('tab-added', this.observeTab.bind(this))

    // When the store re-elects an active tab (e.g. the active tab was closed and
    // a sibling was promoted), refresh caches and broadcast onActivated so both
    // query() and event listeners see the new active tab.
    this.ctx.store.on('active-tab-changed', (tab: TabContents) => {
      if (!tab.isDestroyed()) this.broadcastActivated(tab.id)
    })

    this.ctx.store.on(
      'tab-window-changed',
      (
        tab: TabContents,
        previousWindow: Electron.BaseWindow,
        window: Electron.BaseWindow,
        oldPosition: number,
      ) => {
        if (tab.isDestroyed()) return
        // Moving one tab shifts indexes in both windows. Invalidate all
        // affected descriptors before onDetached/onAttached so a synchronous
        // tabs.get/getAllInWindow observes the new positions.
        const affectedTabs = new Set([
          ...this.ctx.store.getTabsInWindow(previousWindow),
          ...this.ctx.store.getTabsInWindow(window),
        ])
        affectedTabs.forEach((affectedTab) => {
          this.ctx.store.tabDetailsCache.delete(affectedTab.id)
        })
        const details = this.createTabDetails(tab)
        this.ctx.router.broadcastEvent('tabs.onDetached', tab.id, {
          oldWindowId: previousWindow.id,
          oldPosition: Math.max(0, oldPosition),
        })
        this.ctx.router.broadcastEvent('tabs.onAttached', tab.id, {
          newWindowId: window.id,
          newPosition: Math.max(0, details.index),
        })
      },
    )
  }

  private observeTab(tab: TabContents) {
    const tabId = tab.id

    const updateEvents = [
      'page-title-updated', // title
      'did-start-loading', // status
      'did-stop-loading', // status
      'media-started-playing', // audible
      'media-paused', // audible
      'did-start-navigation', // url
      'did-redirect-navigation', // url
      'did-navigate-in-page', // url

      // Listen for 'tab-updated' to handle all other cases which don't have
      // an official Electron API such as discarded tabs. App developers can
      // emit this event to trigger chrome.tabs.onUpdated if a property has
      // changed.
      'tab-updated',
    ]

    const updateHandler = () => {
      this.onUpdated(tabId)
    }

    updateEvents.forEach((eventName) => {
      tab.on(eventName as any, updateHandler)
    })

    const faviconHandler = (event: Electron.Event, favicons: string[]) => {
      ;(tab as TabContents).favicon = favicons[0]
      this.onUpdated(tabId)
    }
    tab.on('page-favicon-updated', faviconHandler)

    tab.once('destroyed', () => {
      updateEvents.forEach((eventName) => {
        tab.off(eventName as any, updateHandler)
      })
      tab.off('page-favicon-updated', faviconHandler)

      this.ctx.store.removeTab(tab)
      this.onRemoved(tabId)
    })

    this.onCreated(tabId)

    d(`Observing tab[${tabId}][${tab.getType()}] ${tab.getURL()}`)
  }

  private createTabDetails(tab: TabContents) {
    const tabId = tab.id
    const activeTab = this.ctx.store.getActiveTabFromWebContents(tab)
    const active = activeTab?.id === tabId
    const previous = this.ctx.store.tabDetailsCache.get(tabId)
    let win = this.ctx.store.tabToWindow.get(tab)
    if (win?.isDestroyed()) win = undefined
    const [width = 0, height = 0] = win ? win.getSize() : []

    const details: chrome.tabs.Tab = {
      active,
      audible: tab.isCurrentlyAudible(),
      autoDiscardable: true,
      discarded: false,
      favIconUrl: tab.favicon || undefined,
      frozen: false,
      height,
      // `selected` is Chrome's deprecated alias for `active`. Preserve an
      // explicit multi-highlight selection until activation changes it.
      highlighted: active || previous?.highlighted === true,
      id: tabId,
      incognito: false,
      index: this.ctx.store.getTabIndex(tab),
      groupId: this.ctx.tabGroups?.getTabGroupId(tabId) ?? -1,
      mutedInfo: { muted: tab.audioMuted },
      pinned: false,
      selected: active,
      status: tab.isLoading() ? 'loading' : 'complete',
      title: tab.getTitle(),
      url: tab.getURL(), // TODO: tab.mainFrame.url (Electron 12)
      width,
      windowId: win ? win.id : -1,
    }

    if (typeof this.ctx.store.impl.assignTabDetails === 'function') {
      this.ctx.store.impl.assignTabDetails(details, tab)
    }

    const plainDetails = toPlainTab(details)
    this.ctx.store.tabDetailsCache.set(tab.id, plainDetails)
    return plainDetails
  }

  private getTabDetails(tab: TabContents) {
    if (this.ctx.store.tabDetailsCache.has(tab.id)) {
      return this.ctx.store.tabDetailsCache.get(tab.id)
    }
    const details = this.createTabDetails(tab)
    return details
  }

  private get(event: ExtensionEvent, tabId: number) {
    const tab = this.ctx.store.getTabById(tabId)
    if ((process.env.CRX_WEBREQUEST_DEBUG === '1' || process.env.CRX_VERBOSE === '1') && tabGetLogCount < 120) {
      tabGetLogCount++
      tabLog(`get ext=${event?.extension?.id || '-'} tabId=${tabId} found=${!!tab}`)
    }
    if (!tab) return { id: TabsAPI.TAB_ID_NONE }
    return this.getTabDetails(tab)
  }

  private getAllInWindow(event: ExtensionEvent, windowId: number = TabsAPI.WINDOW_ID_CURRENT) {
    const currentWindow =
      windowId === TabsAPI.WINDOW_ID_CURRENT
        ? this.ctx.store.getCurrentWindow(event)
        : this.ctx.store.getWindowById(windowId)
    if (!currentWindow) return []

    const tabs = Array.from(this.ctx.store.tabs).filter((tab) => {
      if (tab.isDestroyed()) return false

      const browserWindow = this.ctx.store.tabToWindow.get(tab)
      if (!browserWindow || browserWindow.isDestroyed()) return

      return browserWindow.id === currentWindow.id
    })

    return tabs.map(this.getTabDetails.bind(this))
  }

  private getCurrent(event: ExtensionEvent) {
    const sender = event.type === 'frame' ? event.sender : undefined
    const tab = sender && this.ctx.store.tabs.has(sender) ? sender : undefined

    // Toolbar popups and service workers are separate extension contexts, so
    // Chrome resolves getCurrent() to undefined for them. A genuine extension
    // page opened in a tab must be registered in store.tabs before loadURL.
    // Surface violations of that host invariant without warning for legitimate
    // BrowserWindow popups, side panels, or service workers.
    if (!tab && sender && !this.warnedUntrackedExtensionTabs.has(sender)) {
      let senderUrl = ''
      let senderType = ''
      try {
        senderUrl = sender.getURL()
        senderType = sender.getType()
      } catch {}
      if (
        senderUrl.startsWith('chrome-extension://') &&
        senderType === 'browserView' &&
        typeof (sender as any).windowId === 'number'
      ) {
        this.warnedUntrackedExtensionTabs.add(sender)
        console.warn(
          `[crx-tabs] getCurrent sender is an untracked extension tab wcId=${sender.id} url=${senderUrl}`,
        )
      }
    }
    return tab ? this.getTabDetails(tab as TabContents) : undefined
  }

  private async create(event: ExtensionEvent, details: chrome.tabs.CreateProperties = {}) {
    const url = details.url ? validateExtensionUrl(details.url, event.extension) : undefined
    const active = details.active !== false
    const createDetails = { ...details, url, active }

    // Chrome resolves an omitted WINDOW_ID_CURRENT against the API caller. An
    // action popup is a child BrowserWindow, so global focus alone can point at
    // the popup instead of its owning browser window. Resolve it while the
    // ExtensionEvent still carries the sender and pass the concrete host id to
    // the embedder. Service workers naturally fall back to the last-focused
    // browser window through getCurrentWindow().
    if (
      typeof createDetails.windowId !== 'number' ||
      createDetails.windowId === TabsAPI.WINDOW_ID_CURRENT
    ) {
      createDetails.windowId = this.ctx.store.getCurrentWindow(event)?.id
    }
    try {
      tabLog(
        'CREATE',
        'ext=',
        event.extension?.id,
        'url=',
        url,
        'reqWindowId=',
        createDetails.windowId,
      )
    } catch {}
    const tab = await this.ctx.store.createTab(createDetails)
    const tabDetails = this.getTabDetails(tab)
    try {
      tabLog(
        'create RESULT',
        'ext=',
        event.extension?.id,
        'newTabId=',
        tabDetails?.id,
        'windowId=',
        tabDetails?.windowId,
      )
    } catch {}
    if (active) {
      queueMicrotask(() => this.onActivated(tab.id))
    }
    return tabDetails
  }

  private async insertCSS(event: ExtensionEvent, tabId: number, details: chrome.tabs.InjectDetails) {
    const tab = this.ctx.store.getTabById(tabId)
    if (!tab) return

    // TODO: move to webFrame in renderer?
    if (details.code) {
      tab.insertCSS(details.code)
    } else if (details.file) {
      // Resolve the CSS file from the extension's package (mirrors scripting.ts).
      const resPath = resolveExtensionPath(event.extension, details.file)
      if (!resPath) return
      try {
        const code = await fs.readFile(resPath, 'utf8')
        tab.insertCSS(code)
      } catch (e) {
        d(`tabs.insertCSS failed to read ${details.file}: ${e}`)
      }
    }
  }

  private query(event: ExtensionEvent, info: chrome.tabs.QueryInfo = {}) {
    const isSet = (value: any) => typeof value !== 'undefined'
    const currentWindow = info.currentWindow ? this.ctx.store.getCurrentWindow(event) : undefined
    let lastFocusedWindow = info.lastFocusedWindow ? this.ctx.store.getLastFocusedWindow() : undefined
    // Safety net: if the caller asked for lastFocusedWindow but no tracked
    // window currently holds that title (e.g. the focused window was just
    // removed and none has gained focus since, or no window has been focused
    // yet this session), fall back to the sender's own window rather than
    // silently returning an empty tab list. Many popup extensions resolve the
    // active tab via {active:true,lastFocusedWindow:true} and otherwise see
    // [] → treat every page as "protected" / unusable.
    if (info.lastFocusedWindow && !lastFocusedWindow) {
      lastFocusedWindow = this.ctx.store.getCurrentWindow(event)
    }

    const liveTabs = Array.from(this.ctx.store.tabs).filter((tab) => !tab.isDestroyed())
    tabLog(
      'query',
      'ext=',
      event.extension?.id,
      'info=',
      JSON.stringify(info || {}),
      'storeTabs=',
      liveTabs.map((tab) => `${tab.id}:${tab.getURL().slice(0, 80)}`).join(' | '),
    )

    const filteredTabs = liveTabs
      .map((tab) => this.createTabDetails(tab as TabContents))
      .filter((tab) => {
        if (!tab) return false
        // Recompute `active` from the live store rather than trusting the cached
        // flag, which can go stale when the host re-selects a tab (e.g. after the
        // active tab is closed, or focus shifts) without the extension system
        // observing the activation. Guarantees the active tab is reported.
        const wc = this.ctx.store.getTabById(tab.id!)
        if (wc) {
          const activeWc = this.ctx.store.getActiveTabFromWebContents(wc)
          tab.active = activeWc?.id === tab.id
        }
        if (isSet(info.active) && info.active !== tab.active) return false
        if (isSet(info.pinned) && info.pinned !== tab.pinned) return false
        if (isSet(info.audible) && info.audible !== tab.audible) return false
        if (isSet(info.muted) && info.muted !== tab.mutedInfo?.muted) return false
        if (isSet(info.highlighted) && info.highlighted !== tab.highlighted) return false
        if (isSet(info.discarded) && info.discarded !== tab.discarded) return false
        if (isSet(info.autoDiscardable) && info.autoDiscardable !== tab.autoDiscardable)
          return false
        if (info.currentWindow && (!currentWindow || tab.windowId !== currentWindow.id)) return false
        if (info.lastFocusedWindow && (!lastFocusedWindow || tab.windowId !== lastFocusedWindow.id))
          return false
        if (isSet(info.frozen) && info.frozen !== tab.frozen) return false
        if (isSet(info.groupId) && info.groupId !== tab.groupId) return false
        if (isSet(info.status) && info.status !== tab.status) return false
        if (isSet(info.title) && typeof info.title === 'string' && typeof tab.title === 'string') {
          if (!matchesTitlePattern(info.title, tab.title)) return false
        }
        // Chrome's tabs.query({ url }) matches the candidate URL — with its
        // fragment stripped — against one or more match patterns. A tab with no
        // usable URL never matches a url filter (we must NOT skip the filter
        // when tab.url is missing: that would let every tab through, which
        // breaks extensions that look up their own pages, e.g. uBlock's
        // logger-ui.html lookup in vapi-background.js).
        if (isSet(info.url) && info.url !== null) {
          const patterns: string[] = Array.isArray(info.url) ? info.url : [info.url]
          const rawUrl = typeof tab.url === 'string' ? tab.url : ''
          const frag = rawUrl.indexOf('#')
          const candidate = frag === -1 ? rawUrl : rawUrl.slice(0, frag)
          if (!patterns.some((p) => typeof p === 'string' && matchesPattern(p, candidate))) {
            return false
          }
        }
        if (isSet(info.windowId)) {
          if (info.windowId === TabsAPI.WINDOW_ID_CURRENT) {
            const win = this.ctx.store.getCurrentWindow(event)
            if (!win || win.id !== tab.windowId) return false
          } else if (info.windowId !== tab.windowId) {
            return false
          }
        }
        // if (isSet(info.windowType) && info.windowType !== tab.windowType) return false
        // if (isSet(info.index) && info.index !== tab.index) return false
        return true
      })
    try {
      tabLog(
        'query RESULT',
        'ext=',
        event.extension?.id,
        'info=',
        JSON.stringify(info || {}),
        'returned=',
        filteredTabs.map((t: any) => `${t?.id}:${typeof t?.url === 'string' ? t.url.slice(0, 50) : ''}`).join(' | ') || '[]',
      )
    } catch {}
    return filteredTabs
  }

  private reload(event: ExtensionEvent, arg1?: unknown, arg2?: unknown) {
    const tabId: number | undefined = typeof arg1 === 'number' ? arg1 : undefined
    const reloadProperties: chrome.tabs.ReloadProperties | null =
      typeof arg1 === 'object' ? arg1 : typeof arg2 === 'object' ? arg2 : {}

    const tab = tabId
      ? this.ctx.store.getTabById(tabId)
      : this.ctx.store.getActiveTabOfCurrentWindow(event)
    if (!tab) return

    if (reloadProperties?.bypassCache) {
      tab.reloadIgnoringCache()
    } else {
      tab.reload()
    }
  }

  private async update(event: ExtensionEvent, arg1?: unknown, arg2?: unknown) {
    let tabId = typeof arg1 === 'number' ? arg1 : undefined
    const updateProperties: chrome.tabs.UpdateProperties =
      (typeof arg1 === 'object' ? (arg1 as any) : (arg2 as any)) || {}

    const tab = tabId
      ? this.ctx.store.getTabById(tabId)
      : this.ctx.store.getActiveTabOfCurrentWindow(event)
    if (!tab) {
      // Chrome resolves chrome.tabs.update with the updated Tab object. A tab
      // not in our store was either already closed, or the id is stale (the
      // classic case: an extension's tabs.query/getCurrent fell back to a
      // snapshot that listed a now-dead tab — see the SHIM TQuery/readInjectedTabs
      // localStorage-leak fix in extension-storage-patch.ts). Defense in depth:
      // (1) fall back to tabDetailsCache if we have a recent snapshot;
      // (2) if the id resolves to a real webContents we don't track, destroy the
      //     orphan so the extension's NEXT query stops seeing it;
      // (3) return a synthetic Tab so callers that read tab.windowId with no
      //     null guard (uBlock's vapi-background.js open() at :522) don't crash.
      // This is a deliberate, documented deviation from Chrome's reject-undefined
      // semantics — it buys compatibility with extensions that race open/close.
      if (tabId !== undefined) {
        const cached = this.ctx.store.tabDetailsCache.get(tabId)
        if (cached) return cached
        try {
          const orphan = webContents.fromId(tabId)
          if (
            orphan &&
            !orphan.isDestroyed() &&
            !this.ctx.store.tabs.has(orphan as any)
          ) {
            tabLog(
              'update destroying untracked webContents for staleTabId=',
              tabId,
              'url=',
              orphan.getURL(),
              'type=',
              orphan.getType(),
            )
            orphan.destroy()
          }
        } catch (e) {
          d(`update orphan cleanup failed for ${tabId}: ${e}`)
        }
        const win = this.ctx.store.getCurrentWindow(event)
        return {
          id: tabId,
          active: true,
          windowId: win && !win.isDestroyed() ? win.id : -1,
          ...updateProperties,
        } as chrome.tabs.Tab
      }
      return undefined
    }

    tabId = tab.id

    const props = updateProperties

    const url = props.url ? validateExtensionUrl(props.url, event.extension) : undefined
    if (url) {
      // Don't let a failed/aborted navigation (e.g. a `.user.js` URL that the
      // host redirects elsewhere, which rejects with ERR_ABORTED/ERR_FAILED)
      // reject the whole handler — that would leave the `crx-msg` IPC without a
      // reply ("reply was never sent") and cascade into tabs.create failures.
      tab.loadURL(url).catch((err) => {
        d(`tabs.update loadURL failed for ${url}: ${err}`)
      })
    }

    if (typeof props.muted === 'boolean') tab.setAudioMuted(props.muted)

    if (props.active) this.onActivated(tabId)

    // pinned / autoDiscardable have no Electron/WebContents behavior; persist
    // them into the cached details so query()/get() reflect the change.
    const cached = this.ctx.store.tabDetailsCache.get(tabId)
    if (cached) {
      if (typeof props.pinned === 'boolean') cached.pinned = props.pinned
      if (typeof props.autoDiscardable === 'boolean') cached.autoDiscardable = props.autoDiscardable
      if (typeof props.highlighted === 'boolean') cached.highlighted = props.highlighted
    }
    // This app has a single-selection tab model; highlighted/selected maps to
    // activating the tab.
    if (props.highlighted || props.selected) this.onActivated(tabId)

    this.onUpdated(tabId)

    return this.createTabDetails(tab)
  }

  private remove(event: ExtensionEvent, id: number | number[]) {
    const ids = Array.isArray(id) ? id : [id]

    ids.forEach((tabId) => {
      const tab = this.ctx.store.getTabById(tabId)
      if (tab) this.ctx.store.removeTab(tab)
      this.onRemoved(tabId)
    })
  }

  private highlight(event: ExtensionEvent, highlightInfo: chrome.tabs.HighlightInfo) {
    const requested = Array.isArray(highlightInfo?.tabs)
      ? highlightInfo.tabs
      : [highlightInfo?.tabs]
    if (
      requested.length === 0 ||
      requested.some(
        (value) => typeof value !== 'number' || !Number.isInteger(value) || value < 0,
      )
    ) {
      throw new Error('Invalid highlighted tab index')
    }
    const indices = requested.filter(
      (value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0,
    )

    const window =
      typeof highlightInfo.windowId === 'number' &&
      highlightInfo.windowId !== TabsAPI.WINDOW_ID_CURRENT
        ? this.ctx.store.getWindowById(highlightInfo.windowId)
        : this.ctx.store.getCurrentWindow(event)
    if (!window) throw new Error('No current window')

    const tabs = this.ctx.store.getTabsInWindow(window)
    const tabsByIndex = new Map<number, TabContents>()
    for (const tab of tabs) tabsByIndex.set(this.ctx.store.getTabIndex(tab), tab)
    const highlighted = indices
      .map((index) => tabsByIndex.get(index))
      .filter((tab): tab is TabContents => !!tab)
    const selected = highlighted[0]
    if (!selected || highlighted.length !== indices.length) {
      throw new Error('No tab at the requested index')
    }

    // The host has a single-selection tab model. Chrome permits multiple
    // highlighted tabs, but the active tab must be one of them; select the
    // first requested index and expose the resulting window state.
    this.ctx.store.setActiveTab(selected)
    const highlightedIds = new Set(highlighted.map((tab) => tab.id))
    for (const tab of tabs) {
      const cached = this.ctx.store.tabDetailsCache.get(tab.id)
      if (!cached) continue
      const active = tab.id === selected.id
      cached.active = active
      cached.selected = active
      cached.highlighted = highlightedIds.has(tab.id)
    }
    this.ctx.router.broadcastEvent('tabs.onHighlighted', {
      tabIds: Array.from(highlightedIds),
      windowId: window.id,
    })
    const [left, top] = window.getPosition()
    const [width, height] = window.getSize()
    const windowType = (window as any).__crxWindowType
    const hostIncognito = this.ctx.store.impl.isIncognitoWindow?.(window)
    const incognito =
      typeof hostIncognito === 'boolean'
        ? hostIncognito
        : !this.ctx.session.isPersistent() ||
          tabs.some((tab) => this.ctx.store.tabDetailsCache.get(tab.id)?.incognito === true)
    const state: chrome.windows.Window['state'] = window.isMaximized()
      ? 'maximized'
      : window.isMinimized()
        ? 'minimized'
        : window.isFullScreen()
          ? 'fullscreen'
          : 'normal'
    return {
      alwaysOnTop: window.isAlwaysOnTop(),
      focused: window.isFocused(),
      height,
      id: window.id,
      incognito,
      left,
      state,
      tabs: tabs.map((tab) => this.getTabDetails(tab)),
      top,
      type: windowType === 'popup' || windowType === 'panel' ? windowType : 'normal',
      width,
    } as chrome.windows.Window
  }

  private goForward(event: ExtensionEvent, arg1?: unknown) {
    const tabId = typeof arg1 === 'number' ? arg1 : undefined
    const tab = tabId
      ? this.ctx.store.getTabById(tabId)
      : this.ctx.store.getActiveTabOfCurrentWindow(event)
    if (!tab) return
    tab.navigationHistory.goForward()
  }

  private goBack(event: ExtensionEvent, arg1?: unknown) {
    const tabId = typeof arg1 === 'number' ? arg1 : undefined
    const tab = tabId
      ? this.ctx.store.getTabById(tabId)
      : this.ctx.store.getActiveTabOfCurrentWindow(event)
    if (!tab) return
    tab.navigationHistory.goBack()
  }

  // chrome.tabs.captureVisibleTab(windowId?, options?, cb). Returns a PNG data
  // URL of the visible area of the active tab in the (last-focused) window.
  private async captureVisibleTab(
    event: ExtensionEvent,
    windowId?: number,
    _options?: chrome.tabs.ImageDetails,
  ) {
    let win: Electron.BaseWindow | null | undefined
    if (typeof windowId === 'number' && windowId !== TabsAPI.WINDOW_ID_CURRENT) {
      win = this.ctx.store.getWindowById(windowId)
    } else {
      win = this.ctx.store.getCurrentWindow(event)
    }
    const tab = win ? this.ctx.store.getActiveTabFromWindow(win) : undefined
    if (!tab || tab.isDestroyed()) return undefined
    const image = await tab.capturePage()
    return image.toDataURL()
  }

  // chrome.tabs.duplicate(tabId). Opens a new tab at the same URL. Tab state
  // (scroll/form) is not preserved — acceptable for this app's scope.
  private async duplicate(event: ExtensionEvent, tabId: number) {
    const tab = this.ctx.store.getTabById(tabId)
    if (!tab) return undefined
    const details = this.getTabDetails(tab)
    const newTab = await this.ctx.store.createTab({
      url: details.url,
      windowId: details.windowId,
      active: false,
    })
    return this.getTabDetails(newTab)
  }

  // chrome.tabs.detectLanguage(tabId?, cb). Electron has no CLD3; best-effort
  // via the page's declared language.
  private async detectLanguage(event: ExtensionEvent, arg1?: unknown) {
    const tabId = typeof arg1 === 'number' ? arg1 : undefined
    const tab = tabId
      ? this.ctx.store.getTabById(tabId)
      : this.ctx.store.getActiveTabOfCurrentWindow(event)
    if (!tab || tab.isDestroyed()) return undefined
    try {
      const lang = await tab.executeJavaScript(
        'document.documentElement.lang || navigator.language || "en"',
        true,
      )
      return typeof lang === 'string' ? lang : undefined
    } catch {
      return undefined
    }
  }

  // chrome.tabs.getZoom(tabId?, cb). Returns the zoom factor (0..1, 1 = 100%).
  private getZoom(event: ExtensionEvent, arg1?: unknown) {
    const tabId = typeof arg1 === 'number' ? arg1 : undefined
    const tab = tabId
      ? this.ctx.store.getTabById(tabId)
      : this.ctx.store.getActiveTabOfCurrentWindow(event)
    if (!tab || tab.isDestroyed()) return undefined
    return tab.getZoomFactor()
  }

  // chrome.tabs.setZoom(tabId?, zoomFactor, cb). Supports both
  // setZoom(zoomFactor) and setZoom(tabId, zoomFactor).
  private setZoom(event: ExtensionEvent, arg1?: unknown, arg2?: unknown) {
    const hasTabId = typeof arg1 === 'number' && typeof arg2 === 'number'
    const tabId = hasTabId ? (arg1 as number) : undefined
    const factor = (hasTabId ? arg2 : arg1) as number | undefined
    const tab = tabId
      ? this.ctx.store.getTabById(tabId)
      : this.ctx.store.getActiveTabOfCurrentWindow(event)
    if (!tab || tab.isDestroyed() || typeof factor !== 'number') return
    try {
      tab.setZoomFactor(factor)
    } catch (e) {
      d(`tabs.setZoom failed: ${e}`)
    }
  }

  private getZoomSettings(event: ExtensionEvent, arg1?: unknown) {
    return { mode: 'automatic' as const, scope: 'per-tab' as const, defaultZoomFactor: 1 }
  }

  // Electron has no zoom-mode/scope distinction; accept and succeed (no-op).
  private setZoomSettings(event: ExtensionEvent, arg1?: unknown, arg2?: unknown) {
    return undefined
  }

  onCreated(tabId: number) {
    const tab = this.ctx.store.getTabById(tabId)
    if (!tab) return
    const tabDetails = this.getTabDetails(tab)
    this.ctx.router.broadcastEvent('tabs.onCreated', tabDetails)
  }

  onUpdated(tabId: number) {
    const tab = this.ctx.store.getTabById(tabId)
    if (!tab) return

    let prevDetails
    if (this.ctx.store.tabDetailsCache.has(tab.id)) {
      prevDetails = this.ctx.store.tabDetailsCache.get(tab.id)
    }
    if (!prevDetails) return

    const details = this.createTabDetails(tab)

    const compareProps: (keyof chrome.tabs.Tab)[] = [
      'audible',
      'autoDiscardable',
      'discarded',
      'favIconUrl',
      'frozen',
      'groupId',
      'pinned',
      'status',
      'title',
      'url',
    ]

    let didUpdate = false
    const changeInfo: chrome.tabs.TabChangeInfo = {}

    for (const prop of compareProps) {
      if (details[prop] !== prevDetails[prop]) {
        ;(changeInfo as any)[prop] = details[prop]
        didUpdate = true
      }
    }

    if (details.mutedInfo?.muted !== prevDetails.mutedInfo?.muted) {
      changeInfo.mutedInfo = details.mutedInfo
      didUpdate = true
    }

    if (!didUpdate) return

    this.ctx.router.broadcastEvent('tabs.onUpdated', tab.id, changeInfo, details)
  }

  onRemoved(tabId: number) {
    const details = this.ctx.store.tabDetailsCache.has(tabId)
      ? this.ctx.store.tabDetailsCache.get(tabId)
      : null
    this.ctx.store.tabDetailsCache.delete(tabId)

    const windowId = details ? details.windowId : WindowsAPI.WINDOW_ID_NONE
    const win =
      typeof windowId !== 'undefined' && windowId > -1
        ? getAllWindows().find((win) => win.id === windowId)
        : null

    this.ctx.router.broadcastEvent('tabs.onRemoved', tabId, {
      windowId,
      isWindowClosing: win ? win.isDestroyed() : false,
    })
  }

  onActivated(tabId: number) {
    const tab = this.ctx.store.getTabById(tabId)
    if (!tab) return

    const activeTab = this.ctx.store.getActiveTabFromWebContents(tab)
    const activeChanged = activeTab?.id !== tabId
    if (!activeChanged) return

    this.ctx.store.setActiveTab(tab)

    this.broadcastActivated(tabId)
  }

  /**
   * Refresh cached `active` flags and broadcast chrome.tabs.onActivated for the
   * given tab. Unlike onActivated() this has no change-detection guard, so it
   * also fires when the store has already committed the active tab (e.g. an
   * active tab was closed and a sibling was re-elected in removeTab).
   */
  private broadcastActivated(tabId: number) {
    const tab = this.ctx.store.getTabById(tabId)
    if (!tab) return

    const win = this.ctx.store.tabToWindow.get(tab)

    // invalidate cache since 'active' has changed
    this.ctx.store.tabDetailsCache.forEach((tabInfo, cacheTabId) => {
      const active = tabId === cacheTabId
      tabInfo.active = active
      tabInfo.selected = active
      tabInfo.highlighted = active
    })

    this.ctx.router.broadcastEvent('tabs.onActivated', {
      tabId,
      windowId: win?.id,
    })
  }
}
