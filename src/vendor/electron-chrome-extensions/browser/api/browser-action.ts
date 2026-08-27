import { Menu, MenuItem, protocol, nativeImage, app } from 'electron'
import { ExtensionContext } from '../context'
import { PopupView } from '../popup'
import { ExtensionEvent } from '../router'
import {
  getExtensionUrl,
  getExtensionManifest,
  getIconPath,
  resolveExtensionPath,
  matchSize,
  ResizeType,
} from './common'
import { resolveExtMessage } from './i18n'
import debug from 'debug'

const d = debug('electron-chrome-extensions:browserAction')

if (!app.isReady()) {
  protocol.registerSchemesAsPrivileged([{ scheme: 'crx', privileges: { bypassCSP: true } }])
}

interface ExtensionAction {
  color?: string
  text?: string
  title?: string
  icon?: chrome.browserAction.TabIconDetails
  popup?: string
  /** Badge text color (CSS string). */
  textColor?: string
  /** Whether the action is enabled (clickable). Defaults to true. */
  enabled?: boolean
  /** Last modified date for icon. */
  iconModified?: number
}

type ExtensionActionKey = keyof ExtensionAction

interface ActivateDetails {
  eventType: string
  extensionId: string
  tabId: number
  anchorRect: { x: number; y: number; width: number; height: number }
  alignment?: string
}

const getBrowserActionDefaults = (extension: Electron.Extension): ExtensionAction | undefined => {
  const manifest = getExtensionManifest(extension)
  // MV3: `action`. MV2: prefer `browser_action` (shown by default); fall back to
  // `page_action`, which — per Chrome — is HIDDEN by default and only revealed
  // per-tab via chrome.pageAction.show (the renderer factory maps show/hide to
  // enable/disable, so default page_action to disabled = hidden).
  let browserAction: any
  let isPageAction = false
  if (manifest.manifest_version === 3) {
    browserAction = manifest.action
  } else if (manifest.manifest_version === 2) {
    browserAction = manifest.browser_action
    if (!browserAction && manifest.page_action) {
      browserAction = manifest.page_action
      isPageAction = true
    }
  }
  if (typeof browserAction === 'object' && browserAction !== null) {
    const manifestAction: chrome.runtime.ManifestAction = browserAction
    const action: ExtensionAction = {}

    // default_title / manifest.name 都可能是 __MSG_xxx__;按扩展 _locales 的
    // UI 语言解析,与 chrome.action.getTitle 返回值及管理页名字保持一致。
    action.title = resolveExtMessage(
      extension.path,
      manifest,
      manifestAction.default_title || manifest.name,
    )

    const iconPath = getIconPath(extension)
    if (iconPath) action.icon = { path: iconPath }

    if (manifestAction.default_popup) {
      action.popup = manifestAction.default_popup
    }

    // Respect manifest default_state. "disabled" means the action starts
    // disabled (must be enabled programmatically); default is enabled.
    if ((manifestAction as any).default_state === 'disabled') {
      action.enabled = false
    }

    // page_action is hidden by default until chrome.pageAction.show(tabId).
    if (isPageAction) {
      action.enabled = false
    }

    return action
  }
}

interface ExtensionActionStore extends Partial<ExtensionAction> {
  tabs: { [key: string]: ExtensionAction }
}

export class BrowserActionAPI {
  private actionMap = new Map</* extensionId */ string, ExtensionActionStore>()
  private popup?: PopupView
  private popupLaunchToken: number = 0

  private observers: Set<Electron.WebContents> = new Set()
  private queuedUpdate: boolean = false

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()

    const getter =
      (propName: ExtensionActionKey) =>
      ({ extension }: ExtensionEvent, details: chrome.browserAction.TabDetails = {}) => {
        const { tabId } = details
        const action = this.getAction(extension.id)

        let result

        if (tabId) {
          if (action.tabs[tabId]) {
            result = action.tabs[tabId][propName]
          } else {
            result = action[propName]
          }
        } else {
          result = action[propName]
        }

        return result
      }

    const setDetails = (
      { extension }: ExtensionEvent,
      details: any,
      propName: ExtensionActionKey,
    ) => {
      const { tabId } = details
      let value = details[propName]

      if (typeof value === 'undefined' || value === null) {
        const defaults = getBrowserActionDefaults(extension)
        value = defaults ? defaults[propName] : value
      }

      const valueObj = { [propName]: value }
      const action = this.getAction(extension.id)

      if (tabId) {
        const tabAction = action.tabs[tabId] || (action.tabs[tabId] = {})
        Object.assign(tabAction, valueObj)
      } else {
        Object.assign(action, valueObj)
      }

      // Notify the host app's toolbar (React) of the specific change. The
      // built-in <browser-action-list> web component uses the observer model
      // (onUpdate -> getState), but this app renders browser actions in React
      // and listens for granular 'browser-action-update' events instead.
      d(
        `setDetails: ext=${extension.id} prop=${propName} value=${JSON.stringify(
          value,
        )} tabId=${tabId}`,
      )
      // console.log(
      //   `[browser-action] setDetails ext=${extension.id} prop=${propName} value=${JSON.stringify(
      //     value,
      //   )} tabId=${tabId}`,
      // )
      this.ctx.emit('browser-action-update', extension.id, propName, value, tabId)

      this.onUpdate()
    }

    const setter =
      (propName: ExtensionActionKey) =>
      (event: ExtensionEvent, details: chrome.browserAction.TabDetails) =>
        setDetails(event, details, propName)

    const handleProp = (prop: string, key: ExtensionActionKey) => {
      handle(`browserAction.get${prop}`, getter(key))
      handle(`browserAction.set${prop}`, setter(key))
    }

    handleProp('BadgeBackgroundColor', 'color')
    handleProp('BadgeText', 'text')
    handleProp('BadgeTextColor', 'textColor')
    handleProp('Title', 'title')
    handleProp('Popup', 'popup')

    handle('browserAction.getUserSettings', (): chrome.action.UserSettings => {
      // TODO: allow extension pinning
      return { isOnToolbar: true }
    })

    // enable/disable/isEnabled take a BARE tabId number (not a {tabId}
    // object), so they can't reuse the generic getter/setter (which destructure
    // details.tabId / details[prop]). Effective value: per-tab override →
    // global → default true (see isEnabledForTab). isEnabled must coerce
    // undefined → true, otherwise a never-touched action reads back falsy and
    // the extension mistakes it for disabled.
    handle('browserAction.isEnabled', ({ extension }: ExtensionEvent, tabId?: number) =>
      this.isEnabledForTab(extension.id, tabId),
    )

    handle('browserAction.enable', (event: ExtensionEvent, tabId?: number) =>
      setDetails(event, { tabId, enabled: true }, 'enabled'),
    )

    handle('browserAction.disable', (event: ExtensionEvent, tabId?: number) =>
      setDetails(event, { tabId, enabled: false }, 'enabled'),
    )

    // setIcon is unique in that it can pass in a variety of properties. Here we normalize them
    // to use 'icon'.
    handle(
      'browserAction.setIcon',
      (event, { tabId, ...details }: chrome.browserAction.TabIconDetails) => {
        // TODO: icon paths need to be resolved relative to the sender url. In
        // the case of service workers, we need an API to get the script url.
        setDetails(event, { tabId, icon: details }, 'icon')
        setDetails(event, { tabId, iconModified: Date.now() }, 'iconModified')
      },
    )

    handle('browserAction.openPopup', this.openPopup)

    // browserAction preload API
    const preloadOpts = { allowRemote: true, extensionContext: false }
    handle('browserAction.getState', this.getState.bind(this), preloadOpts)
    handle('browserAction.activate', this.activate.bind(this), preloadOpts)
    handle(
      'browserAction.addObserver',
      (event) => {
        if (event.type != 'frame') return
        const observer = event.sender
        this.observers.add(observer)
        observer.once?.('destroyed', () => {
          this.observers.delete(observer)
        })
      },
      preloadOpts,
    )
    handle(
      'browserAction.removeObserver',
      (event) => {
        if (event.type != 'frame') return
        const { sender: observer } = event
        this.observers.delete(observer)
      },
      preloadOpts,
    )

    this.ctx.store.on('active-tab-changed', () => {
      this.onUpdate()
    })

    // Clear out tab details when removed
    this.ctx.store.on('tab-removed', (tabId: number) => {
      for (const [, actionDetails] of this.actionMap) {
        if (actionDetails.tabs[tabId]) {
          delete actionDetails.tabs[tabId]
        }
      }
      this.onUpdate()
    })

    this.setupSession(this.ctx.session)
  }

  private setupSession(session: Electron.Session) {
    const sessionExtensions = session.extensions || session
    sessionExtensions.on('extension-loaded', (event, extension) => {
      this.processExtension(extension)
    })

    sessionExtensions.on('extension-unloaded', (event, extension) => {
      if (this.popup?.extensionId === extension.id) {
        this.popup.destroy()
        this.popup = undefined
      }
      this.removeActions(extension.id)
    })
  }

  handleCRXRequest(request: GlobalRequest): GlobalResponse {
    d('%s', request.url)

    try {
      const url = new URL(request.url)
      const { hostname: requestType } = url

      switch (requestType) {
        case 'extension-icon': {
          const tabId = url.searchParams.get('tabId')

          const fragments = url.pathname.split('/')
          const extensionId = fragments[1]
          const imageSize = parseInt(fragments[2], 10)
          const resizeType = parseInt(fragments[3], 10) || ResizeType.Up

          const sessionExtensions = this.ctx.session.extensions || this.ctx.session
          const extension = sessionExtensions.getExtension(extensionId)

          let iconDetails: chrome.browserAction.TabIconDetails | undefined

          const action = this.actionMap.get(extensionId)
          if (action) {
            iconDetails = (tabId && action.tabs[tabId]?.icon) || action.icon
          }

          let iconImage

          if (extension && iconDetails) {
            if (typeof iconDetails.path === 'string') {
              const iconAbsPath = resolveExtensionPath(extension, iconDetails.path)
              if (iconAbsPath) iconImage = nativeImage.createFromPath(iconAbsPath)
            } else if (typeof iconDetails.path === 'object') {
              const imagePath = matchSize(iconDetails.path, imageSize, resizeType)
              const iconAbsPath = imagePath && resolveExtensionPath(extension, imagePath)
              if (iconAbsPath) iconImage = nativeImage.createFromPath(iconAbsPath)
            } else if (typeof iconDetails.imageData === 'string') {
              iconImage = nativeImage.createFromDataURL(iconDetails.imageData)
            } else if (typeof iconDetails.imageData === 'object') {
              const imageData = matchSize(iconDetails.imageData as any, imageSize, resizeType)
              iconImage = imageData ? nativeImage.createFromDataURL(imageData) : undefined
            }

            if (iconImage?.isEmpty()) {
              d('crx: icon image is empty', iconDetails)
            }
          }

          // Extensions without an action still appear in chrome.management.
          // Fall back to their manifest icon so the shared icon endpoint can
          // serve management pages as well as the browser action toolbar.
          if (extension && (!iconImage || iconImage.isEmpty())) {
            const iconPath = getIconPath(extension, imageSize, resizeType)
            const iconAbsPath = iconPath && resolveExtensionPath(extension, iconPath)
            if (iconAbsPath) iconImage = nativeImage.createFromPath(iconAbsPath)
          }

          if (iconImage && !iconImage.isEmpty()) {
            return new Response(iconImage.toPNG(), {
              status: 200,
              headers: {
                'Content-Type': 'image/png',
              },
            })
          }

          d('crx: no icon image for %s', extensionId)
          return new Response(null, { status: 400 })
        }
        default: {
          d('crx: invalid request %s', requestType)
          return new Response(null, { status: 400 })
        }
      }
    } catch (e) {
      console.error(e)
      return new Response(null, { status: 500 })
    }
  }

  private getAction(extensionId: string) {
    let action = this.actionMap.get(extensionId)
    if (!action) {
      action = { tabs: {} }
      this.actionMap.set(extensionId, action)
      this.onUpdate()
    }

    return action
  }

  /**
   * Effective enabled state for an action: a per-tab override wins, otherwise
   * the global value, otherwise the default (true). Used by isEnabled() and to
   * gate clicks in activateClick.
   */
  private isEnabledForTab(extensionId: string, tabId?: number): boolean {
    const action = this.getAction(extensionId)
    if (tabId) {
      const tabEnabled = action.tabs[tabId]?.enabled
      if (typeof tabEnabled === 'boolean') return tabEnabled
    }
    return action.enabled !== false
  }

  // TODO: Make private for v4 major release.
  removeActions(extensionId: string) {
    if (this.actionMap.has(extensionId)) {
      this.actionMap.delete(extensionId)
    }

    this.onUpdate()
  }

  private getPopupUrl(extensionId: string, tabId: number) {
    const action = this.getAction(extensionId)
    const tabPopupValue = action.tabs[tabId]?.popup
    const actionPopupValue = action.popup

    let popupPath: string | undefined

    if (typeof tabPopupValue !== 'undefined') {
      popupPath = tabPopupValue
    } else if (typeof actionPopupValue !== 'undefined') {
      popupPath = actionPopupValue
    }

    let url: string | undefined

    // Allow absolute URLs
    try {
      url = popupPath && new URL(popupPath).href
    } catch {}

    // Fallback to relative path
    if (!url) {
      try {
        url = popupPath && new URL(popupPath, `chrome-extension://${extensionId}`).href
      } catch {}
    }

    return url
  }

  // TODO: Make private for v4 major release.
  processExtension(extension: Electron.Extension) {
    const defaultAction = getBrowserActionDefaults(extension)
    if (defaultAction) {
      const action = this.getAction(extension.id)
      Object.assign(action, defaultAction)
    }
  }

  private getState() {
    // Get state without icon data.
    const actions = Array.from(this.actionMap.entries()).map(([id, details]) => {
      const { icon, tabs, ...rest } = details

      const tabsInfo: { [key: string]: any } = {}

      for (const tabId of Object.keys(tabs)) {
        const { icon, ...rest } = tabs[tabId]
        tabsInfo[tabId] = rest
      }

      return {
        id,
        tabs: tabsInfo,
        ...rest,
      }
    })

    const activeTab = this.ctx.store.getActiveTabOfCurrentWindow()
    return { activeTabId: activeTab?.id, actions }
  }

  /**
   * Public entry for host UIs that render their own toolbar (this app's React
   * BrowserAction component) instead of dispatching `browserAction.activate`
   * through the extension preload. Triggers a left-click activation: opens the
   * popup if the extension declares one, otherwise fires
   * `chrome.action.onClicked` for the target tab. Pass `tabId < 0` to use the
   * active tab of the focused window.
   */
  activateClickFromHost(
    extensionId: string,
    tabId: number,
    anchorRect?: { x: number; y: number; width: number; height: number },
  ) {
    void this.activateClick({
      eventType: 'click',
      extensionId,
      tabId: typeof tabId === 'number' ? tabId : -1,
      anchorRect: anchorRect || { x: 0, y: 0, width: 0, height: 0 },
    })
  }

  /**
   * Build a chrome.tabs.Tab-shaped snapshot of the host's live tabs for popup
   * injection. Mirrors the snapshot app.ts showExtensionPopup builds from
   * viewManager, but sourced from the ExtensionStore (the same store
   * TabsAPI.query reads), so the popup's SHIM fallback returns the same active
   * tab the live IPC would. Used by activateClick to seed globalThis.__crxTabs
   * in popups that land in a sandboxed renderer without the electron bridge.
   */
  private buildPopupTabsSnapshot(): any[] {
    const store = this.ctx.store
    const tabs: any[] = []
    for (const tab of store.tabs) {
      try {
        if (tab.isDestroyed()) continue
        const win = store.tabToWindow.get(tab)
        if (!win || win.isDestroyed()) continue
        const activeTab = store.getActiveTabFromWindow(win)
        const isActive = activeTab?.id === tab.id
        let url = ''
        let title = ''
        try {
          url = tab.getURL()
        } catch {
          /* best-effort */
        }
        try {
          title = tab.getTitle()
        } catch {
          /* best-effort */
        }
        tabs.push({
          id: tab.id,
          index: store.getTabIndex(tab),
          windowId: win.id,
          active: isActive,
          selected: isActive,
          highlighted: isActive,
          url,
          title,
          incognito: false,
          pinned: false,
          groupId: this.ctx.tabGroups?.getTabGroupId(tab.id) ?? -1,
          status: 'complete',
        })
      } catch {
        /* skip unreadable tab */
      }
    }
    return tabs
  }

  private activate({ type, sender }: ExtensionEvent, details: ActivateDetails) {
    if (type != 'frame') return
    const { eventType, extensionId, tabId } = details
    d(
      `activate [eventType: ${eventType}, extensionId: '${extensionId}', tabId: ${tabId}, senderId: ${sender?.id}]`,
    )

    switch (eventType) {
      case 'click':
        return this.activateClick(details)
      case 'contextmenu':
        this.activateContextMenu(details)
        break
      default:
        console.debug(`Ignoring unknown browserAction.activate event '${eventType}'`)
    }
  }

  private async activateClick(details: ActivateDetails) {
    const { extensionId, tabId, anchorRect, alignment } = details
    const launchToken = ++this.popupLaunchToken

    if (this.popup) {
      const toggleExtension = !this.popup.isDestroyed() && this.popup.extensionId === extensionId
      this.popup.destroy()
      this.popup = undefined
      if (toggleExtension) {
        d('skipping activate to close popup')
        return
      }
    }

    const tab =
      tabId >= 0 ? this.ctx.store.getTabById(tabId) : this.ctx.store.getActiveTabOfCurrentWindow()
    if (!tab) {
      throw new Error(`Unable to get active tab`)
    }

    // A disabled action is not clickable: don't open the popup and don't fire
    // onClicked. (The toolbar component also gates its own onClick, but this
    // covers chrome.action.openPopup() and the host dispatchActionClick path.)
    if (!this.isEnabledForTab(extensionId, tab.id)) {
      d(`activateClick: action disabled for ext=${extensionId} tab=${tab.id}, ignoring click`)
      return
    }

    // sidePanel: if the extension set openPanelOnActionClick and declares a side
    // panel, the action click opens the side panel instead of firing onClicked
    // (or a popup). Only reaches here for extensions WITHOUT a default_popup —
    // popup-declared actions are routed by the renderer straight to
    // app.ts showExtensionPopup and bypass activateClick (known v1 limitation).
    const sp = (this.ctx as any).sidePanel
    if (sp?.getPanelBehavior(extensionId)?.openPanelOnActionClick && sp.hasPanel(extensionId)) {
      const win = this.ctx.store.tabToWindow.get(tab)
      sp.openFromAction(extensionId, tab.id, win?.id)
      return
    }

    const popupUrl = this.getPopupUrl(extensionId, tab.id)

    if (popupUrl) {
      const win = this.ctx.store.tabToWindow.get(tab)
      if (!win) {
        throw new Error('Unable to get BrowserWindow from active tab')
      }

      const popupWorker = this.prewarmPopupServiceWorker(extensionId)

      try {
        this.popup = new PopupView({
          extensionId,
          session: this.ctx.session,
          parent: win,
          url: popupUrl,
          anchorRect,
          alignment,
          // Hand the popup a snapshot of the host's real tab list. MV2 page_action
          // popups open through this activateClick path and can land in a sandboxed
          // renderer (co-sited with the persistent background page) where the
          // frame-type crx-preload is dropped → no electron bridge → the SHIM's
          // tabs.query falls back to globalThis.__crxTabs. Without this snapshot
          // chrome.tabs.query({active:true}) returns [] ("no active tab"). Built
          // from the same ExtensionStore TabsAPI.query reads, so the fallback
          // answer matches the live IPC answer.
          tabs: this.buildPopupTabsSnapshot(),
        })
      } catch (error) {
        void popupWorker.then((release) => release?.())
        throw error
      }

      const popup = this.popup
      const popupWindow = popup.browserWindow
      void popupWorker.then((releasePopupWorker) => {
        if (!releasePopupWorker) return
        if (
          launchToken !== this.popupLaunchToken ||
          this.popup !== popup ||
          popup.isDestroyed() ||
          !popupWindow ||
          popupWindow.isDestroyed()
        ) {
          releasePopupWorker()
        } else {
          popupWindow.once('closed', releasePopupWorker)
        }
      })

      d(`opened popup: ${popupUrl}`)

      this.ctx.emit('browser-action-popup-created', this.popup)
    } else {
      d(`dispatching onClicked for ${extensionId}`)

      const tabDetails = this.ctx.store.tabDetailsCache.get(tab.id)
      this.ctx.router.sendEvent(extensionId, 'browserAction.onClicked', tabDetails)
    }
  }

  /**
   * Warm the MV3 worker in parallel with popup creation, then hold a keep-alive
   * task only for the popup's active lifetime.
   */
  private async prewarmPopupServiceWorker(extensionId: string): Promise<(() => void) | undefined> {
    const sessionExtensions = this.ctx.session.extensions || this.ctx.session
    const extension = sessionExtensions.getExtension(extensionId)
    if (!extension) return undefined

    const manifest = getExtensionManifest(extension) as chrome.runtime.Manifest & {
      background?: { service_worker?: string }
    }
    if (manifest.manifest_version !== 3 || !manifest.background?.service_worker) {
      return undefined
    }

    try {
      const acquire = this.ctx.recoverServiceWorker || this.ctx.messaging?.acquireServiceWorker
      if (!acquire) return undefined
      const release = await acquire.call(
        this.ctx.recoverServiceWorker ? this.ctx : this.ctx.messaging,
        extensionId,
        8_000,
      )
      d(`popup SW bridge ready and keepAlive acquired extId=${extensionId}`)
      return release
    } catch (error) {
      console.warn(`[action-click] popup SW prewarm failed extId=${extensionId}`, error)
      return undefined
    }
  }

  private activateContextMenu(details: ActivateDetails) {
    const { extensionId, anchorRect } = details

    const sessionExtensions = this.ctx.session.extensions || this.ctx.session
    const extension = sessionExtensions.getExtension(extensionId)
    if (!extension) {
      throw new Error(`Unregistered extension '${extensionId}'`)
    }

    const manifest = getExtensionManifest(extension)
    const menu = new Menu()
    const append = (opts: Electron.MenuItemConstructorOptions) => menu.append(new MenuItem(opts))
    const appendSeparator = () => menu.append(new MenuItem({ type: 'separator' }))

    append({
      label:
        typeof extension.name === 'string' && extension.name.startsWith('__MSG_')
          ? resolveExtMessage(extension.path, manifest, extension.name)
          : extension.name,
      click: () => {
        const homePageUrl =
          manifest.homepage_url || `https://chrome.google.com/webstore/detail/${extension.id}`
        this.ctx.store.createTab({ url: homePageUrl })
      },
    })

    appendSeparator()

    // TODO(mv3): need to build 'action' menu items?
    const contextMenuItems: MenuItem[] = this.ctx.store.buildMenuItems(
      extensionId,
      'browser_action',
    )
    if (contextMenuItems.length > 0) {
      contextMenuItems.forEach((item) => menu.append(item))
      appendSeparator()
    }

    const optionsPage = manifest.options_page || manifest.options_ui?.page
    const optionsPageUrl = optionsPage ? getExtensionUrl(extension, optionsPage) : undefined

    append({
      label: 'Options',
      enabled: typeof optionsPageUrl === 'string',
      click: () => {
        this.ctx.store.createTab({ url: optionsPageUrl })
      },
    })

    if (process.env.NODE_ENV === 'development' && process.env.DEBUG) {
      append({
        label: 'Remove extension',
        click: () => {
          d(`removing extension "${extension.name}" (${extension.id})`)
          sessionExtensions.removeExtension(extension.id)
        },
      })
    }

    menu.popup({
      x: Math.floor(anchorRect.x),
      y: Math.floor(anchorRect.y + anchorRect.height),
    })
  }

  private openPopup = (event: ExtensionEvent, options?: chrome.action.OpenPopupOptions) => {
    const window =
      typeof options?.windowId === 'number'
        ? this.ctx.store.getWindowById(options.windowId)
        : this.ctx.store.getCurrentWindow()
    if (!window || window.isDestroyed()) {
      d('openPopup: window %d destroyed', window?.id)
      return
    }

    const activeTab = this.ctx.store.getActiveTabFromWindow(window)
    if (!activeTab) return

    const [width] = window.getSize()
    const anchorSize = 64

    return this.activateClick({
      eventType: 'click',
      extensionId: event.extension.id,
      tabId: activeTab?.id,
      // TODO(mv3): get anchor position
      anchorRect: { x: width - anchorSize, y: 0, width: anchorSize, height: anchorSize },
    })
  }

  private onUpdate() {
    if (this.queuedUpdate) return
    this.queuedUpdate = true
    queueMicrotask(() => {
      this.queuedUpdate = false
      if (this.observers.size === 0) return
      d(`dispatching update to ${this.observers.size} observer(s)`)
      Array.from(this.observers).forEach((observer) => {
        if (!observer.isDestroyed()) {
          observer.send?.('browserAction.update')
        }
      })
    })
  }
}
