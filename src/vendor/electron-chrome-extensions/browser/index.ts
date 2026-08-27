import { session as electronSession, webFrameMain } from 'electron'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { BrowserActionAPI } from './api/browser-action'
import { TabsAPI } from './api/tabs'
import { WindowsAPI } from './api/windows'
import { WebNavigationAPI } from './api/web-navigation'
import { WebRequestAPI } from './api/web-request'
import { ExtensionStore } from './store'
import { ContextMenusAPI } from './api/context-menus'
import { RuntimeAPI } from './api/runtime'
import { CookiesAPI } from './api/cookies'
import { NotificationsAPI } from './api/notifications'
import { ChromeExtensionImpl } from './impl'
import { CommandsAPI } from './api/commands'
import { ExtensionContext } from './context'
import { ExtensionRouter } from './router'
import { readLoadedExtensionManifest } from './manifest'
import { PermissionsAPI } from './api/permissions'
import { UserScriptsAPI } from './api/user-scripts'
import { ScriptingAPI } from './api/scripting'
import { MessagingAPI } from './api/messaging'
import { I18nAPI } from './api/i18n'
import { BookmarksAPI } from './api/bookmarks'
import { HistoryAPI } from './api/history'
import { AlarmsAPI } from './api/alarms'
import { ProxyAPI } from './api/proxy'
import { IdleAPI } from './api/idle'
import { PowerAPI } from './api/power'
import { SystemAPI } from './api/system'
import { BrowsingDataAPI } from './api/browsing-data'
import { ManagementAPI } from './api/management'
import { DownloadsAPI } from './api/downloads'
import { SearchAPI } from './api/search'
import { SessionsAPI } from './api/sessions'
import { TopSitesAPI } from './api/topsites'
import { TabGroupsAPI } from './api/tab-groups'
import { FontSettingsAPI } from './api/font-settings'
import { PrivacyAPI } from './api/privacy'
import { TtsAPI } from './api/tts'
import { SidePanelAPI } from './api/side-panel'
import { OffscreenAPI } from './api/offscreen'
import { IdentityAPI } from './api/identity'
import { DeclarativeNetRequestAPI } from './api/declarative-net-request'
import { resolvePartition } from './partition'

function createDynamicContentScriptRegistry(): ExtensionContext['dynamicContentScripts'] {
  const scriptsByFrame = new WeakMap<Electron.WebFrameMain, Map<string, number>>()
  const tokensByFrame = new WeakMap<Electron.WebFrameMain, number>()
  const extensionEpochs = new Map<string, number>()

  return {
    token(frame) {
      return tokensByFrame.get(frame) || 0
    },
    mark(extensionId, frame, expectedToken) {
      if (expectedToken !== undefined && expectedToken !== (tokensByFrame.get(frame) || 0)) return
      let scripts = scriptsByFrame.get(frame)
      if (!scripts) {
        scripts = new Map()
        scriptsByFrame.set(frame, scripts)
      }
      scripts.set(extensionId, extensionEpochs.get(extensionId) || 0)
    },
    clearExtension(extensionId) {
      extensionEpochs.set(extensionId, (extensionEpochs.get(extensionId) || 0) + 1)
    },
    clearFrame(frame) {
      scriptsByFrame.delete(frame)
      tokensByFrame.set(frame, (tokensByFrame.get(frame) || 0) + 1)
    },
    has(extensionId, frame) {
      return scriptsByFrame.get(frame)?.get(extensionId) === (extensionEpochs.get(extensionId) || 0)
    },
  }
}

function checkVersion() {
  const electronVersion = process.versions.electron
  if (electronVersion && parseInt(electronVersion.split('.')[0], 10) < 35) {
    console.warn('electron-chrome-extensions requires electron@>=35.0.0')
  }
}

function resolvePreloadPath(modulePath?: string) {
  // Vendored into this project: the preload script is built by the host
  // project's webpack as a separate bundle. The host passes its absolute
  // path via `modulePath`.
  if (modulePath) {
    return modulePath
  }

  // Fallback to preload relative to entrypoint directory
  const preloadFilename = 'chrome-extension-api.preload.js'
  return path.join(__dirname, preloadFilename)
}

export interface ChromeExtensionOptions extends ChromeExtensionImpl {
  /**
   * Session to add Chrome extension support in.
   * Defaults to `session.defaultSession`.
   */
  session?: Electron.Session

  /**
   * Path to electron-chrome-extensions module files. Might be needed if
   * JavaScript bundlers like Webpack are used in your build process.
   *
   * @deprecated See "Packaging the preload script" in the readme.
   */
  modulePath?: string
}

const sessionMap = new WeakMap<Electron.Session, ElectronChromeExtensions>()

/**
 * Provides an implementation of various Chrome extension APIs to a session.
 */
export class ElectronChromeExtensions extends EventEmitter {
  /** Retrieve an instance of this class associated with the given session. */
  static fromSession(session: Electron.Session) {
    return sessionMap.get(session)
  }

  /**
   * Handles the 'crx://' protocol in the session.
   *
   * This is required to display <browser-action-list> extension icons.
   */
  static handleCRXProtocol(session: Electron.Session) {
    if (session.protocol.isProtocolHandled('crx')) {
      session.protocol.unhandle('crx')
    }
    session.protocol.handle('crx', function handleCRXRequest(request) {
      let url
      try {
        url = new URL(request.url)
      } catch {
        return new Response('Invalid URL', { status: 404 })
      }

      const partition = url?.searchParams.get('partition') || '_self'
      const remoteSession = partition === '_self' ? session : resolvePartition(partition)
      const extensions = ElectronChromeExtensions.fromSession(remoteSession)
      if (!extensions) {
        return new Response(`ElectronChromeExtensions not found for "${partition}"`, {
          status: 404,
        })
      }

      return extensions.api.browserAction.handleCRXRequest(request)
    })
  }

  private ctx: ExtensionContext
  private dynamicContentScriptTabs = new WeakSet<Electron.WebContents>()

  private api: {
    browserAction: BrowserActionAPI
    contextMenus: ContextMenusAPI
    commands: CommandsAPI
    cookies: CookiesAPI
    notifications: NotificationsAPI
    permissions: PermissionsAPI
    runtime: RuntimeAPI
    tabs: TabsAPI
    userScripts: UserScriptsAPI
    scripting: ScriptingAPI
    messaging: MessagingAPI
    webNavigation: WebNavigationAPI
    webRequest: WebRequestAPI
    windows: WindowsAPI
    i18n: I18nAPI
    bookmarks: BookmarksAPI
    history: HistoryAPI
    alarms: AlarmsAPI
    proxy: ProxyAPI
    idle: IdleAPI
    power: PowerAPI
    system: SystemAPI
    browsingData: BrowsingDataAPI
    management: ManagementAPI
    downloads: DownloadsAPI
    search: SearchAPI
    sessions: SessionsAPI
    topSites: TopSitesAPI
    tabGroups: TabGroupsAPI
    fontSettings: FontSettingsAPI
    privacy: PrivacyAPI
    tts: TtsAPI
    sidePanel: SidePanelAPI
    identity: IdentityAPI
    declarativeNetRequest: DeclarativeNetRequestAPI
  }

  constructor(opts: ChromeExtensionOptions) {
    super()

    const { session = electronSession.defaultSession, ...impl } = opts || {}

    checkVersion()

    if (sessionMap.has(session)) {
      throw new Error(`Extensions instance already exists for the given session`)
    }

    sessionMap.set(session, this)

    const router = new ExtensionRouter(session)
    const store = new ExtensionStore(impl)
    const preloadPath = resolvePreloadPath(opts.modulePath)

    this.ctx = {
      dynamicContentScripts: createDynamicContentScriptRegistry(),
      emit: this.emit.bind(this),
      preloadPath,
      router,
      session,
      store,
    }

    this.api = {
      browserAction: new BrowserActionAPI(this.ctx),
      contextMenus: new ContextMenusAPI(this.ctx),
      commands: new CommandsAPI(this.ctx),
      cookies: new CookiesAPI(this.ctx),
      notifications: new NotificationsAPI(this.ctx),
      permissions: new PermissionsAPI(this.ctx),
      runtime: new RuntimeAPI(this.ctx),
      tabs: new TabsAPI(this.ctx),
      userScripts: new UserScriptsAPI(this.ctx),
      scripting: new ScriptingAPI(this.ctx),
      messaging: new MessagingAPI(this.ctx),
      webNavigation: new WebNavigationAPI(this.ctx),
      webRequest: new WebRequestAPI(this.ctx),
      windows: new WindowsAPI(this.ctx),
      i18n: new I18nAPI(this.ctx),
      bookmarks: new BookmarksAPI(this.ctx),
      history: new HistoryAPI(this.ctx),
      alarms: new AlarmsAPI(this.ctx),
      proxy: new ProxyAPI(this.ctx),
      idle: new IdleAPI(this.ctx),
      power: new PowerAPI(this.ctx),
      system: new SystemAPI(this.ctx),
      browsingData: new BrowsingDataAPI(this.ctx),
      management: new ManagementAPI(this.ctx),
      downloads: new DownloadsAPI(this.ctx),
      search: new SearchAPI(this.ctx),
      sessions: new SessionsAPI(this.ctx),
      topSites: new TopSitesAPI(this.ctx),
      tabGroups: new TabGroupsAPI(this.ctx),
      fontSettings: new FontSettingsAPI(this.ctx),
      privacy: new PrivacyAPI(this.ctx),
      tts: new TtsAPI(this.ctx),
      sidePanel: new SidePanelAPI(this.ctx),
      offscreen: new OffscreenAPI(this.ctx),
      identity: new IdentityAPI(this.ctx),
      // Before WebRequestAPI so ctx.declarativeNetRequest is set for its
      // synchronous DNR enforcement inside the webRequest callbacks.
      declarativeNetRequest: new DeclarativeNetRequestAPI(this.ctx),
    }

    // Expose the SidePanelAPI on ctx so BrowserActionAPI.activateClick can
    // consult openPanelOnActionClick and divert action clicks to the panel.
    this.ctx.tabs = this.api.tabs
    this.ctx.tabGroups = this.api.tabGroups
    this.ctx.sidePanel = this.api.sidePanel

    // Wire `_execute_action` / `_execute_browser_action` command shortcuts to
    // the same activator a toolbar click uses (opens popup or fires onClicked).
    this.api.commands.setActionDispatcher((extensionId) => {
      try {
        this.activateExtensionAction(extensionId)
      } catch {
        /* no active tab resolvable (e.g. during startup / incognito) */
      }
    })

    // `chrome.tabs.sendMessage` is backed by the messaging hub (background/popup
    // -> content script), registered here so it shares MessagingAPI's state.
    this.ctx.router
      .apiHandler()('tabs.sendMessage', this.api.messaging.sendMessageToTab.bind(this.api.messaging))
    // `chrome.tabs.connect` (background -> content script long-lived Port) is
    // likewise backed by the messaging hub.
    this.ctx.router
      .apiHandler()('tabs.connect', this.api.messaging.connectToTab.bind(this.api.messaging))
    // `chrome.tabs.group` / `chrome.tabs.ungroup` share TabGroupsAPI's
    // in-memory group state (tabGroups.get/query/update/move read it).
    this.ctx.router.apiHandler()('tabs.group', this.api.tabGroups.group.bind(this.api.tabGroups))
    this.ctx.router
      .apiHandler()('tabs.ungroup', this.api.tabGroups.ungroup.bind(this.api.tabGroups))

    this.listenForExtensions()
    this.prependPreload(preloadPath)
  }

  private listenForExtensions() {
    const sessionExtensions = this.ctx.session.extensions || this.ctx.session
    sessionExtensions.addListener('extension-loaded', (_event, extension) => {
      readLoadedExtensionManifest(this.ctx, extension)
    })
  }

  private prependPreload(preloadPath: string) {
    const { session } = this.ctx

    if ('registerPreloadScript' in session) {
      session.registerPreloadScript({
        id: 'crx-mv2-preload',
        type: 'frame',
        filePath: preloadPath,
      })
      session.registerPreloadScript({
        id: 'crx-mv3-preload',
        type: 'service-worker',
        filePath: preloadPath,
      })
    } else {
      // @ts-expect-error Deprecated electron@<35
      session.setPreloads([...session.getPreloads(), preloadPath])
    }

    if (!existsSync(preloadPath)) {
      console.error(
        new Error(
          `electron-chrome-extensions: Preload file not found at "${preloadPath}". ` +
            'See "Packaging the preload script" in the readme.',
        ),
      )
    }
  }

  private checkWebContentsArgument(wc: Electron.WebContents) {
    if (this.ctx.session !== wc.session) {
      throw new TypeError(
        'Invalid WebContents argument. Its session must match the session provided to ElectronChromeExtensions constructor options.',
      )
    }
  }

  /** Add webContents to be tracked as a tab. */
  addTab(tab: Electron.WebContents, window: Electron.BaseWindow) {
    this.checkWebContentsArgument(tab)
    this.observeDynamicContentScriptFrames(tab)
    this.ctx.store.addTab(tab, window)
    // App-scoped command shortcuts are matched here (before-input-event). The
    // listener self-cleans on webContents `destroyed`, so this is best-effort.
    this.api.commands.attachWebContents(tab)
  }

  private observeDynamicContentScriptFrames(tab: Electron.WebContents) {
    if (this.dynamicContentScriptTabs.has(tab)) return
    this.dynamicContentScriptTabs.add(tab)

    const clear = (frame?: Electron.WebFrameMain | null) => {
      if (!frame) return
      try {
        this.ctx.dynamicContentScripts.clearFrame(frame)
      } catch {
        /* best-effort */
      }
    }

    const onNavigationStart = (
      _event: Electron.Event,
      _url: string,
      isInPlace: boolean,
      isMainFrame: boolean,
      frameProcessId: number,
      frameRoutingId: number,
    ) => {
      if (isInPlace) return
      if (isMainFrame) {
        try {
          clear(tab.mainFrame)
        } catch {}
        return
      }
      clear(webFrameMain.fromId(frameProcessId, frameRoutingId))
    }

    tab.on('did-start-navigation', onNavigationStart)
    tab.once('destroyed', () => {
      tab.off('did-start-navigation', onNavigationStart)
      try {
        clear(tab.mainFrame)
      } catch {}
    })
  }

  /** Remove webContents from being tracked as a tab. */
  removeTab(tab: Electron.WebContents) {
    this.checkWebContentsArgument(tab)
    this.ctx.store.removeTab(tab)
    this.api.commands.detachWebContents(tab)
  }

  /**
   * Start an MV3 background worker, wait until its hosted API bridge is ready,
   * and keep it alive until the returned release function is called.
   */
  acquireServiceWorker(extensionId: string, timeoutMs?: number) {
    if (this.ctx.recoverServiceWorker) {
      return this.ctx.recoverServiceWorker(extensionId, timeoutMs, false)
    }
    return this.api.messaging.acquireServiceWorker(extensionId, timeoutMs)
  }

  /** Internal raw acquisition used by the host recovery handler itself. */
  acquireServiceWorkerRaw(extensionId: string, timeoutMs?: number) {
    return this.api.messaging.acquireServiceWorker(extensionId, timeoutMs)
  }

  /** Record the explicit API-bridge handshake from a specific ServiceWorkerMain. */
  markServiceWorkerReady(
    serviceWorker: any,
    details?: any,
  ) {
    this.api.messaging.markServiceWorkerReady(serviceWorker, details)
  }

  setServiceWorkerRecoveryHandler(
    handler: (
      extensionId: string,
      timeoutMs?: number,
      provenFailure?: boolean,
    ) => Promise<(() => void) | undefined>,
  ) {
    this.ctx.recoverServiceWorker = handler
  }

  /** Keep chrome.tabs window ownership in sync when the host moves a live tab. */
  moveTabToWindow(tab: Electron.WebContents, window: Electron.BaseWindow) {
    this.checkWebContentsArgument(tab)
    this.ctx.store.moveTabToWindow(tab, window)
  }

  /** Notify extension system that the active tab has changed. */
  selectTab(tab: Electron.WebContents) {
    this.checkWebContentsArgument(tab)
    if (this.ctx.store.tabs.has(tab)) {
      // Heal command listeners when a restored/reused WebContents becomes
      // active. attachWebContents is idempotent.
      this.api.commands.attachWebContents(tab)
      this.api.tabs.onActivated(tab.id)
    }
  }

  /**
   * Push the visual tab-strip order for a window (tabId = webContents.id).
   * The host UI owns the authoritative ordering (drag-reorder lives in the
   * renderer); this lets the store report an accurate chrome.tabs.Tab.index.
   */
  setTabOrder(windowId: number, orderedTabIds: number[]) {
    this.ctx.store.setTabOrder(windowId, orderedTabIds)
  }

  /** Return the session-local Chrome tab-group id for a host tab. */
  getTabGroupId(tabId: number) {
    return this.api.tabGroups.getTabGroupId(tabId)
  }

  /**
   * Dispatch a browser-action left-click for the given extension. For host UIs
   * that render their own toolbar (and therefore don't go through the extension
   * preload's `browserAction.activate`). Opens the popup if declared, otherwise
   * fires `chrome.action.onClicked`. Pass `tabId < 0` for the active tab.
   */
  activateExtensionAction(
    extensionId: string,
    tabId: number = -1,
    anchorRect?: { x: number; y: number; width: number; height: number },
  ) {
    this.api.browserAction.activateClickFromHost(extensionId, tabId, anchorRect)
  }

  /**
   * Fire chrome.commands.onCommand for an extension's command, allowing the
   * host to synthesize a command from its own keyboard handling. Manifest
   * `suggested_key` parsing, scope handling (app-scoped vs `global:true`), and
   * accelerator registration are owned by the vendored CommandsAPI.
   */
  fireCommand(extensionId: string, commandName: string) {
    this.api.commands.fireCommand(extensionId, commandName)
  }

  /**
   * 注入持久化的扩展命令改键覆盖(宿主启动时,加载扩展前调一次)。
   * 详见 CommandsAPI.applyOverrides。
   */
  applyExtensionCommandOverrides(map: { [extId: string]: { [name: string]: string } } | undefined) {
    this.api.commands.applyOverrides(map)
  }

  /** 运行时修改某扩展命令的快捷键(设置页改键,立即生效)。详见 CommandsAPI.setShortcut。 */
  setExtensionCommandOverride(extensionId: string, name: string, shortcut: string) {
    this.api.commands.setShortcut(extensionId, name, shortcut)
  }

  /** 清除某扩展命令的覆盖(随后由调用方 reloadExtension 触发重解析恢复默认)。 */
  clearExtensionCommandOverride(extensionId: string, name?: string) {
    this.api.commands.clearOverride(extensionId, name)
  }

  /**
   * 读取所有扩展命令的只读快照(设置页「扩展命令」区块数据源)。
   * extensions 由宿主传入(SessionsService.extensions,确定的 Electron.Extension[])。
   */
  getExtensionCommandSnapshot(extensions: Electron.Extension[]) {
    return this.api.commands.getHostSnapshot(extensions)
  }

  /**
   * Add webContents to be tracked as an extension host which will receive
   * extension events when a chrome-extension:// resource is loaded.
   *
   * This is usually reserved for extension background pages and popups, but
   * can also be used in other special cases.
   *
   * @deprecated Extension hosts are now tracked lazily when they send
   * extension IPCs to the main process.
   */
  addExtensionHost(host: Electron.WebContents) {
    console.warn('ElectronChromeExtensions.addExtensionHost() is deprecated')
  }

  /**
   * Get collection of menu items managed by the `chrome.contextMenus` API.
   * @see https://developer.chrome.com/extensions/contextMenus
   */
  getContextMenuItems(webContents: Electron.WebContents, params: Electron.ContextMenuParams) {
    this.checkWebContentsArgument(webContents)
    return this.api.contextMenus.buildMenuItemsForParams(webContents, params)
  }

  /**
   * Gets map of special pages to extension override URLs.
   *
   * @see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/chrome_url_overrides
   */
  getURLOverrides(): Record<string, string> {
    return this.ctx.store.urlOverrides
  }

  /**
   * Handles the 'crx://' protocol in the session.
   *
   * @deprecated Call `ElectronChromeExtensions.handleCRXProtocol(session)`
   * instead. The CRX protocol is no longer one-to-one with
   * ElectronChromeExtensions instances. Instead, it should now be handled only
   * on the sessions where <browser-action-list> extension icons will be shown.
   */
  handleCRXProtocol(session: Electron.Session) {
    throw new Error(
      'extensions.handleCRXProtocol(session) is deprecated, call ElectronChromeExtensions.handleCRXProtocol(session) instead.',
    )
  }

  /**
   * Add extensions to be visible as an extension action button.
   *
   * @deprecated Not needed in Electron >=12.
   */
  addExtension(extension: Electron.Extension) {
    console.warn('ElectronChromeExtensions.addExtension() is deprecated')
    this.api.browserAction.processExtension(extension)
  }

  /**
   * Remove extensions from the list of visible extension action buttons.
   *
   * @deprecated Not needed in Electron >=12.
   */
  removeExtension(extension: Electron.Extension) {
    console.warn('ElectronChromeExtensions.removeExtension() is deprecated')
    this.api.browserAction.removeActions(extension.id)
  }

  /**
   * Notify listening extensions that a bookmark or folder was created in the
   * browser UI. Use for changes that don't originate from a `chrome.bookmarks`
   * API call (API-initiated changes already emit their own events).
   */
  notifyBookmarkCreated(bookmark: chrome.bookmarks.BookmarkTreeNode) {
    this.api.bookmarks.onCreated(bookmark)
  }

  /** Notify listening extensions that a bookmark or folder changed. */
  notifyBookmarkChanged(id: string, changeInfo: chrome.bookmarks.BookmarkChangeInfo) {
    this.api.bookmarks.onChanged(id, changeInfo)
  }

  /** Notify listening extensions that a bookmark or folder was moved. */
  notifyBookmarkMoved(id: string, moveInfo: chrome.bookmarks.BookmarkMoveInfo) {
    this.api.bookmarks.onMoved(id, moveInfo)
  }

  /** Notify listening extensions that a bookmark or folder was removed. */
  notifyBookmarkRemoved(id: string, removeInfo: chrome.bookmarks.BookmarkRemoveInfo) {
    this.api.bookmarks.onRemoved(id, removeInfo)
  }

  /**
   * Notify listening extensions that the browser recorded a page visit. Should
   * be called when the browser adds an entry to its history.
   */
  notifyHistoryVisited(item: chrome.history.HistoryItem) {
    this.api.history.onVisited(item)
  }

  /** Notify listening extensions that history entries were removed. */
  notifyHistoryVisitRemoved(removed: chrome.history.RemovedResult) {
    this.api.history.onVisitRemoved(removed)
  }

  notifyRuntimeInstalled(
    extensionId: string,
    details: chrome.runtime.InstalledDetails,
  ) {
    return this.ctx.router.sendEvent(extensionId, 'runtime.onInstalled', details)!
  }

  notifyRuntimeStartup(extensionId: string) {
    return this.ctx.router.sendEvent(extensionId, 'runtime.onStartup')!
  }
}
