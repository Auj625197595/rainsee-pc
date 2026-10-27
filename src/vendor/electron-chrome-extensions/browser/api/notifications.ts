import { randomUUID } from 'node:crypto'
import { app, Extension, nativeImage, NativeImage, Notification } from 'electron'
import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'
import { getIconPath, validateExtensionResource } from './common'

enum TemplateType {
  Basic = 'basic',
  Image = 'image',
  List = 'list',
  Progress = 'progress',
}

const getBody = (opts: chrome.notifications.NotificationOptions) => {
  const { type = TemplateType.Basic } = opts

  switch (type) {
    case TemplateType.List: {
      if (!Array.isArray(opts.items)) {
        throw new Error('List items must be provided for list type')
      }
      const items = opts.items.map((item) => `${item.title} - ${item.message}`).join('\n')
      return opts.message ? `${opts.message}\n${items}` : items
    }
    case TemplateType.Progress: {
      const progress = typeof opts.progress === 'number' ? ` (${opts.progress}%)` : ''
      return `${opts.message || ''}${progress}`
    }
    default:
      return opts.message || ''
  }
}

const getUrgency = (
  priority?: number,
): Required<Electron.NotificationConstructorOptions>['urgency'] => {
  if (typeof priority !== 'number') {
    return 'normal'
  } else if (priority >= 2) {
    return 'critical'
  } else if (priority < 0) {
    return 'low'
  } else {
    return 'normal'
  }
}

const createScopedIdentifier = (extension: Extension, id: string) => `${extension.id}-${id}`
const stripScopeFromIdentifier = (id: string) => {
  const index = id.indexOf('-')
  return id.substr(index + 1)
}

const ICON_FETCH_TIMEOUT_MS = 5000

/**
 * Options for notifications posted by an extension service worker through
 * `ServiceWorkerRegistration.showNotification`. Electron's platform
 * notification service drops persistent notifications entirely (no popup, no
 * permission prompt, so on macOS the app never even appears in System
 * Settings → Notifications); the SW shim forwards them here instead.
 */
interface PersistentNotificationOptions {
  title?: string
  body?: string
  icon?: string
  silent?: boolean
  requireInteraction?: boolean
  actions?: { action?: string; title?: string }[]
}

interface NotificationEntry {
  notification: Notification
  opts: chrome.notifications.NotificationOptions
  /** SW showNotification(): events go to the SW shim, not chrome.notifications. */
  persistent: boolean
  /** Opaque SW-side snapshot (tag/data/actions) echoed back with events so a
   *  restarted worker can rebuild `event.notification`. */
  payload?: unknown
  /** Finalizes the entry exactly once: drops it from the registry and, when
   *  `emit`, reports onClosed. Electron does not guarantee a 'close' event for
   *  programmatic close(), so host-initiated closes settle explicitly. */
  settle: (byUser: boolean, emit: boolean) => void
}

export class NotificationsAPI {
  private registry = new Map<string, NotificationEntry>()

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('notifications.clear', this.clear)
    handle('notifications.create', this.create)
    handle('notifications.getAll', this.getAll)
    handle('notifications.getPermissionLevel', this.getPermissionLevel)
    handle('notifications.update', this.update)
    handle('notifications.showPersistent', this.showPersistent)
    handle('notifications.closePersistent', this.closePersistent)

    const sessionExtensions = ctx.session.extensions || ctx.session
    sessionExtensions.on('extension-unloaded', (event, extension) => {
      for (const [key, entry] of this.registry) {
        if (key.startsWith(`${extension.id}-`)) {
          entry.settle(false, false)
          entry.notification.close()
        }
      }
    })
  }

  private clear = ({ extension }: ExtensionEvent, id: string) => {
    const notificationId = createScopedIdentifier(extension, id)
    const entry = this.registry.get(notificationId)
    if (!entry || entry.persistent) return false
    // Chrome reports byUser=false for clear().
    entry.settle(false, true)
    entry.notification.close()
    return true
  }

  private create = async ({ extension }: ExtensionEvent, arg1: unknown, arg2?: unknown) => {
    let id: string
    let opts: chrome.notifications.NotificationOptions

    if (typeof arg1 === 'object' && arg1 !== null) {
      id = randomUUID()
      opts = arg1 as chrome.notifications.NotificationOptions
    } else if (typeof arg1 === 'string') {
      id = arg1 || randomUUID()
      opts = arg2 as chrome.notifications.NotificationOptions
    } else {
      throw new Error('Invalid arguments')
    }

    if (typeof opts !== 'object' || !opts) {
      throw new Error('Missing required notification options')
    }
    // Chrome requires type/iconUrl/title/message, but a missing or broken
    // iconUrl is common in the wild and only costs the icon there. Keep the
    // notification and fall back to the extension icon instead.
    if (!opts.title && !opts.message) {
      throw new Error('Missing required notification options')
    }

    await this.show(extension, id, opts, false)
    return id
  }

  private showPersistent = async (
    { extension }: ExtensionEvent,
    id: string,
    persistentOpts: PersistentNotificationOptions,
    payload?: unknown,
  ) => {
    if (typeof id !== 'string' || !id) throw new Error('Invalid notification id')
    const p = persistentOpts || {}
    const actions = Array.isArray(p.actions) ? p.actions : []
    const opts: chrome.notifications.NotificationOptions = {
      type: TemplateType.Basic,
      title: String(p.title || ''),
      message: String(p.body || ''),
      iconUrl: typeof p.icon === 'string' ? p.icon : undefined,
      silent: !!p.silent,
      requireInteraction: !!p.requireInteraction,
      buttons: actions.slice(0, 2).map((a) => ({ title: String(a?.title || a?.action || '') })),
    }
    await this.show(extension, id, opts, true, payload)
    return true
  }

  private closePersistent = ({ extension }: ExtensionEvent, id: string) => {
    const notificationId = createScopedIdentifier(extension, id)
    const entry = this.registry.get(notificationId)
    if (!entry || !entry.persistent) return false
    // Notification.close() fires no notificationclose event in Chrome.
    entry.settle(false, false)
    entry.notification.close()
    return true
  }

  private getMode(extension: Extension) {
    try {
      return this.ctx.store.impl.getNotificationMode?.(extension.id) || 'allow'
    } catch {
      return 'allow'
    }
  }

  private async resolveIcon(
    extension: Extension,
    iconUrl?: string,
  ): Promise<NativeImage | string | undefined> {
    if (typeof iconUrl === 'string' && iconUrl) {
      try {
        let url: URL | undefined
        try {
          url = new URL(iconUrl)
        } catch {}

        if (url?.protocol === 'data:') {
          const image = nativeImage.createFromDataURL(iconUrl)
          if (!image.isEmpty()) return image
        } else if (url?.protocol === 'http:' || url?.protocol === 'https:') {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), ICON_FETCH_TIMEOUT_MS)
          try {
            const res = await this.ctx.session.fetch(url.href, { signal: controller.signal })
            if (res.ok) {
              const image = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()))
              if (!image.isEmpty()) return image
            }
          } finally {
            clearTimeout(timer)
          }
        } else if (!url || url.protocol === 'chrome-extension:') {
          // Relative path, or an absolute URL into this extension's package.
          const relative =
            url && url.host === extension.id ? decodeURIComponent(url.pathname) : iconUrl
          const resolved = await validateExtensionResource(extension, relative)
          if (resolved) return resolved
        }
      } catch (err) {
        console.warn('[crx-notifications] icon resolve failed', extension.id, String(err))
      }
    }

    const fallback = getIconPath(extension, 128)
    return fallback ? validateExtensionResource(extension, fallback) : undefined
  }

  private async show(
    extension: Extension,
    id: string,
    opts: chrome.notifications.NotificationOptions,
    persistent: boolean,
    payload?: unknown,
  ) {
    const mode = this.getMode(extension)
    if (mode === 'block') {
      console.log('[crx-notifications] blocked by user', extension.id, id)
      // Chrome: chrome.notifications.create still resolves its id, while
      // registration.showNotification rejects without permission.
      if (persistent) throw new Error('No notification permission has been granted')
      return
    }
    const hideName = mode === 'hide-name'

    const notificationId = createScopedIdentifier(extension, id)
    const icon = await this.resolveIcon(extension, opts.iconUrl)

    const previous = this.registry.get(notificationId)
    if (previous) {
      // Same id: Chrome replaces the notification in place without onClosed.
      previous.settle(false, false)
      try {
        previous.notification.close()
      } catch {}
    }

    const buttons = Array.isArray(opts.buttons) ? opts.buttons.slice(0, 2) : []

    const notification = new Notification({
      title: opts.title || (hideName ? app.name : extension.name),
      // macOS shows the app name already; the extension name tells the user
      // which extension sent it, unless the user chose to hide it.
      subtitle: process.platform === 'darwin' ? (hideName ? undefined : extension.name) : app.name,
      body: getBody(opts),
      silent: !!opts.silent,
      icon,
      urgency: getUrgency(opts.priority),
      timeoutType: opts.requireInteraction ? 'never' : 'default',
      actions: buttons.map((b) => ({ type: 'button' as const, text: String(b?.title || '') })),
    })

    const clickEvent = persistent ? 'notifications.onPersistentClicked' : 'notifications.onClicked'
    const closeEvent = persistent ? 'notifications.onPersistentClosed' : 'notifications.onClosed'

    notification.on('click', () => {
      if (persistent) {
        this.ctx.router.sendEvent(extension.id, clickEvent, id, -1, payload)
      } else {
        this.ctx.router.sendEvent(extension.id, clickEvent, id)
      }
    })

    notification.on('action', (details: any, legacyIndex?: unknown) => {
      // Older Electron passed (event, index); newer passes { actionIndex }.
      const index =
        typeof details?.actionIndex === 'number' ? details.actionIndex : Number(legacyIndex)
      if (!Number.isInteger(index) || index < 0) return
      if (persistent) {
        this.ctx.router.sendEvent(extension.id, clickEvent, id, index, payload)
      } else {
        this.ctx.router.sendEvent(extension.id, 'notifications.onButtonClicked', id, index)
      }
    })

    notification.on('failed', (_event: unknown, error: string) => {
      console.warn('[crx-notifications] show failed', extension.id, id, error)
    })

    let settled = false
    const settle = (byUser: boolean, emit: boolean) => {
      if (settled) return
      settled = true
      if (this.registry.get(notificationId)?.notification === notification) {
        this.registry.delete(notificationId)
      }
      if (!emit) return
      if (persistent) {
        this.ctx.router.sendEvent(extension.id, closeEvent, id, byUser, payload)
      } else {
        this.ctx.router.sendEvent(extension.id, closeEvent, id, byUser)
      }
    }
    this.registry.set(notificationId, { notification, opts, persistent, payload, settle })

    // User dismissal / timeout. Host-initiated closes have already settled.
    notification.once('close', () => settle(true, true))

    console.log('[crx-notifications] show', extension.id, id, persistent ? 'persistent' : 'api')
    notification.show()
  }

  private getAll = ({ extension }: ExtensionEvent) => {
    // chrome.notifications.getAll resolves an object keyed by id.
    const result: Record<string, boolean> = {}
    for (const [key, entry] of this.registry) {
      if (key.startsWith(`${extension.id}-`) && !entry.persistent) {
        result[stripScopeFromIdentifier(key)] = true
      }
    }
    return result
  }

  private getPermissionLevel = ({ extension }: ExtensionEvent) => {
    if (this.getMode(extension) === 'block') return 'denied'
    return Notification.isSupported() ? 'granted' : 'denied'
  }

  private update = async (
    { extension }: ExtensionEvent,
    id: string,
    opts: chrome.notifications.NotificationOptions,
  ) => {
    const notificationId = createScopedIdentifier(extension, id)
    const entry = this.registry.get(notificationId)
    if (!entry || entry.persistent) {
      return false
    }

    // Electron's Notification is effectively immutable after show(), so
    // re-run the show path with merged options; show() replaces the old one
    // without surfacing onClosed.
    try {
      await this.show(extension, id, { ...entry.opts, ...opts }, false)
      return true
    } catch {
      return false
    }
  }
}
