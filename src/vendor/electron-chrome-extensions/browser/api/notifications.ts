import { app, Extension, Notification } from 'electron'
import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'
import { validateExtensionResource } from './common'

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
      return opts.items.map((item) => `${item.title} - ${item.message}`).join('\n')
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

export class NotificationsAPI {
  private registry = new Map<string, Notification>()
  // Last create() opts per scoped id, so update() can re-create with merged
  // options (Electron's Notification is effectively immutable after show()).
  private optsRegistry = new Map<string, chrome.notifications.NotificationOptions>()
  // Scoped ids currently being replaced by update(); their close handler skips
  // the spurious onClosed event + registry cleanup (update() owns those).
  private replacing = new Set<string>()

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('notifications.clear', this.clear)
    handle('notifications.create', this.create)
    handle('notifications.getAll', this.getAll)
    handle('notifications.getPermissionLevel', this.getPermissionLevel)
    handle('notifications.update', this.update)

    const sessionExtensions = ctx.session.extensions || ctx.session
    sessionExtensions.on('extension-unloaded', (event, extension) => {
      for (const [key, notification] of this.registry) {
        if (key.startsWith(extension.id)) {
          notification.close()
        }
      }
    })
  }

  private clear = ({ extension }: ExtensionEvent, id: string) => {
    const notificationId = createScopedIdentifier(extension, id)
    if (this.registry.has(notificationId)) {
      this.registry.get(notificationId)?.close()
    }
  }

  private create = async ({ extension }: ExtensionEvent, arg1: unknown, arg2?: unknown) => {
    let id: string
    let opts: chrome.notifications.NotificationOptions

    if (typeof arg1 === 'object') {
      id = 'guid' // TODO: generate uuid
      opts = arg1 as chrome.notifications.NotificationOptions
    } else if (typeof arg1 === 'string') {
      id = arg1
      opts = arg2 as chrome.notifications.NotificationOptions
    } else {
      throw new Error('Invalid arguments')
    }

    if (typeof opts !== 'object' || !opts.type || !opts.iconUrl || !opts.title || !opts.message) {
      throw new Error('Missing required notification options')
    }

    const notificationId = createScopedIdentifier(extension, id)

    if (this.registry.has(notificationId)) {
      this.registry.get(notificationId)?.close()
    }

    let icon

    if (opts.iconUrl) {
      let url
      try {
        url = new URL(opts.iconUrl)
      } catch {}

      if (url?.protocol === 'data:') {
        icon = opts.iconUrl
      } else {
        icon = await validateExtensionResource(extension, opts.iconUrl)
      }

      if (!icon) {
        throw new Error('Invalid iconUrl')
      }
    }

    // TODO: buttons, template types

    const notification = new Notification({
      title: opts.title,
      subtitle: app.name,
      body: getBody(opts),
      silent: opts.silent,
      icon,
      urgency: getUrgency(opts.priority),
      timeoutType: opts.requireInteraction ? 'never' : 'default',
    })

    this.registry.set(notificationId, notification)
    this.optsRegistry.set(notificationId, opts)

    notification.on('click', () => {
      this.ctx.router.sendEvent(extension.id, 'notifications.onClicked', id)
    })

    notification.once('close', () => {
      if (this.replacing.has(notificationId)) {
        // update() triggered this close as part of re-creation; it owns the
        // registry/opts cleanup and must NOT surface onClosed to the extension.
        this.replacing.delete(notificationId)
        return
      }
      const byUser = true // TODO
      this.ctx.router.sendEvent(extension.id, 'notifications.onClosed', id, byUser)
      this.registry.delete(notificationId)
      this.optsRegistry.delete(notificationId)
    })

    notification.show()

    return id
  }

  private getAll = ({ extension }: ExtensionEvent) => {
    return Array.from(this.registry.keys())
      .filter((key) => key.startsWith(extension.id))
      .map(stripScopeFromIdentifier)
  }

  private getPermissionLevel = (event: ExtensionEvent) => {
    return Notification.isSupported() ? 'granted' : 'denied'
  }

  private update = async (
    { extension }: ExtensionEvent,
    id: string,
    opts: chrome.notifications.NotificationOptions,
  ) => {
    const notificationId = createScopedIdentifier(extension, id)

    const notification = this.registry.get(notificationId)

    if (!notification) {
      return false
    }

    // Merge with the stored create() opts, then re-create. Electron's
    // Notification is effectively immutable after show(), so close + re-run the
    // create path is the only way to reflect title/message/icon/type changes.
    const stored = this.optsRegistry.get(notificationId) || {}
    const merged = { ...stored, ...opts }

    this.replacing.add(notificationId)
    try {
      notification.close()
    } catch {}
    // The old notification's close handler is guarded by `replacing` and will
    // not touch the registry; clean up ourselves so the new create() owns it.
    this.registry.delete(notificationId)
    this.optsRegistry.delete(notificationId)

    try {
      await this.create({ extension } as ExtensionEvent, id, merged)
      return true
    } catch {
      return false
    }
  }
}
