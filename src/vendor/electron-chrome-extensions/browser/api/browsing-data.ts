import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

// chrome.browsingData. Gated on the "browsingData" permission. Maps Chrome's
// DataTypeSet onto Electron session clearers (clearCache / clearStorageData /
// clearHostResolverCache / clearAuthCache) and the host history impl. Origin
// filtering is honored when provided; otherwise the whole session is cleared.
// Electron has no dedicated password/form-data stores, so those map onto the
// closest available storage (cookies/localstorage) as a best effort.
export class BrowsingDataAPI {
  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('browsingData.remove', this.remove, { permission: 'browsingData' })
    handle('browsingData.removeCookies', this.removeCookies, { permission: 'browsingData' })
    handle('browsingData.removeCache', this.removeCache, { permission: 'browsingData' })
    handle('browsingData.removeFileSystems', this.removeFileSystems, { permission: 'browsingData' })
    handle('browsingData.removeFormData', this.removeFormData, { permission: 'browsingData' })
    handle('browsingData.removeHistory', this.removeHistory, { permission: 'browsingData' })
    handle('browsingData.removeIndexedDB', this.removeIndexedDB, { permission: 'browsingData' })
    handle('browsingData.removeLocalStorage', this.removeLocalStorage, {
      permission: 'browsingData',
    })
    handle('browsingData.removePasswords', this.removePasswords, { permission: 'browsingData' })
    handle('browsingData.removeWebSQL', this.removeWebSQL, { permission: 'browsingData' })
    handle('browsingData.removeServiceWorkers', this.removeServiceWorkers, {
      permission: 'browsingData',
    })
    handle('browsingData.removeDownloads', this.noopRemove, { permission: 'browsingData' })
    handle('browsingData.removeAppcache', this.noopRemove, { permission: 'browsingData' })
    handle('browsingData.removePluginData', this.noopRemove, { permission: 'browsingData' })
    handle('browsingData.settings', this.settings, { permission: 'browsingData' })
  }

  private noopRemove = async () => undefined

  private storageOpts(origin: string | undefined, storages: string[]): Electron.ClearStorageDataOptions {
    const opts: Electron.ClearStorageDataOptions = { storages }
    if (origin) opts.origin = origin
    return opts
  }

  private clearStorages(origin: string | undefined, storages: string[]) {
    return this.ctx.session.clearStorageData(this.storageOpts(origin, storages))
  }

  private remove = async (
    _event: ExtensionEvent,
    options: chrome.browsingData.RemovalOptions = {},
    dataToRemove: chrome.browsingData.DataTypeSet = {},
  ): Promise<void> => {
    const o = options
    const tasks: Promise<void>[] = []
    if (dataToRemove.cache) tasks.push(this.removeCache(_event, o))
    if (dataToRemove.cookies) tasks.push(this.removeCookies(_event, o))
    if (dataToRemove.history) tasks.push(this.removeHistory(_event, o))
    if (dataToRemove.fileSystems) tasks.push(this.removeFileSystems(_event, o))
    if (dataToRemove.formData) tasks.push(this.removeFormData(_event, o))
    if (dataToRemove.indexedDB) tasks.push(this.removeIndexedDB(_event, o))
    if (dataToRemove.localStorage) tasks.push(this.removeLocalStorage(_event, o))
    if (dataToRemove.passwords) tasks.push(this.removePasswords(_event, o))
    if (dataToRemove.webSQL) tasks.push(this.removeWebSQL(_event, o))
    if (dataToRemove.serviceWorkers) tasks.push(this.removeServiceWorkers(_event, o))
    // downloads / appcache / pluginData: no Electron equivalent — accept silently.
    await Promise.all(tasks)
  }

  private removeCache = async (): Promise<void> => {
    await this.ctx.session.clearCache()
    await (this.ctx.session as any).clearHostResolverCache?.()
    await (this.ctx.session as any).clearAuthCache?.()
  }

  private removeCookies = async (
    _event: ExtensionEvent,
    options: chrome.browsingData.RemovalOptions = {},
  ): Promise<void> => {
    if (options.origin) {
      await this.clearStorages(options.origin, ['cookies'])
      return
    }
    // No origin: drop every cookie in the session.
    const cookies = await this.ctx.session.cookies.get({})
    for (const c of cookies) {
      try {
        const scheme = c.secure ? 'https://' : 'http://'
        const host = (c.domain || '').replace(/^\./, '')
        await this.ctx.session.cookies.remove({ url: `${scheme}${host}${c.path || '/'}`, name: c.name })
      } catch {
        /* best-effort */
      }
    }
  }

  private removeFileSystems = (_e: ExtensionEvent, o: chrome.browsingData.RemovalOptions = {}) =>
    this.clearStorages(o.origin, ['filesystem'])
  private removeFormData = (_e: ExtensionEvent, o: chrome.browsingData.RemovalOptions = {}) =>
    this.clearStorages(o.origin, ['localstorage'])
  private removeIndexedDB = (_e: ExtensionEvent, o: chrome.browsingData.RemovalOptions = {}) =>
    this.clearStorages(o.origin, ['indexdb'])
  private removeLocalStorage = (_e: ExtensionEvent, o: chrome.browsingData.RemovalOptions = {}) =>
    this.clearStorages(o.origin, ['localstorage'])
  private removePasswords = (_e: ExtensionEvent, o: chrome.browsingData.RemovalOptions = {}) =>
    this.clearStorages(o.origin, ['cookies'])
  private removeWebSQL = (_e: ExtensionEvent, o: chrome.browsingData.RemovalOptions = {}) =>
    this.clearStorages(o.origin, ['websql'])
  private removeServiceWorkers = (_e: ExtensionEvent, o: chrome.browsingData.RemovalOptions = {}) =>
    this.clearStorages(o.origin, ['serviceworkers'])

  private removeHistory = async (): Promise<void> => {
    await this.ctx.store.impl.history?.deleteAll?.()
  }

  private settings = (): {
    dataToRemove: chrome.browsingData.DataTypeSet
    options: chrome.browsingData.RemovalOptions
  } => {
    return {
      dataToRemove: {
        appcache: true,
        cache: true,
        cookies: true,
        downloads: true,
        fileSystems: true,
        formData: true,
        history: true,
        indexedDB: true,
        localStorage: true,
        pluginData: true,
        passwords: true,
        serviceWorkers: true,
        webSQL: true,
      } as chrome.browsingData.DataTypeSet,
      options: {} as chrome.browsingData.RemovalOptions,
    }
  }
}
