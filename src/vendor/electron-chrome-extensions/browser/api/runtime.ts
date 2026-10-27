import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'
import { getExtensionManifest } from './common'
import { NativeMessagingHost } from './lib/native-messaging-host'

export class RuntimeAPI extends EventEmitter {
  private hostMap: Record<string, NativeMessagingHost | undefined> = Object.create(null)
  private static readonly connectionIdPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  constructor(private ctx: ExtensionContext) {
    super()

    const handle = this.ctx.router.apiHandler()
    handle('runtime.connectNative', this.connectNative, { permission: 'nativeMessaging' })
    handle('runtime.disconnectNative', this.disconnectNative, { permission: 'nativeMessaging' })
    handle('runtime.openOptionsPage', this.openOptionsPage)
    handle('runtime.sendNativeMessage', this.sendNativeMessage, { permission: 'nativeMessaging' })
  }

  private connectNative = async (
    event: ExtensionEvent,
    connectionId: string,
    application: string,
  ) => {
    if (
      typeof connectionId !== 'string' ||
      !RuntimeAPI.connectionIdPattern.test(connectionId)
    ) {
      throw new TypeError('runtime.connectNative requires a valid connection id')
    }
    if (typeof application !== 'string' || !application) {
      throw new TypeError('runtime.connectNative requires a native application name')
    }
    this.hostMap[connectionId]?.destroy(new Error('Native messaging connection replaced'))
    const host = new NativeMessagingHost(
      event.extension.id,
      event.sender!,
      connectionId,
      application,
      true,
      () => {
        // A host can exit on its own (or its renderer can be destroyed). Do
        // not retain a dead Port and accidentally route a later connection to
        // it. The identity check avoids deleting a replacement with the same
        // externally supplied id.
        if (this.hostMap[connectionId] === host) this.hostMap[connectionId] = undefined
      },
    )
    this.hostMap[connectionId] = host
  }

  private disconnectNative = (event: ExtensionEvent, connectionId: string) => {
    this.hostMap[connectionId]?.destroy()
    this.hostMap[connectionId] = undefined
  }

  private sendNativeMessage = async (event: ExtensionEvent, application: string, message: any) => {
    if (typeof application !== 'string' || !application) {
      throw new TypeError('runtime.sendNativeMessage requires a native application name')
    }
    const connectionId = randomUUID()
    const host = new NativeMessagingHost(
      event.extension.id,
      event.sender!,
      connectionId,
      application,
      false,
    )
    await host.ready
    return await host.sendAndReceive(message)
  }

  private openOptionsPage = async ({ extension }: ExtensionEvent) => {
    // TODO: options page shouldn't appear in Tabs API
    // https://developer.chrome.com/extensions/options#tabs-api

    const manifest = getExtensionManifest(extension)
    // Embedded options_ui (open_in_new_tab:false) has no host surface; open it
    // in a tab like options_page.
    const page = manifest.options_ui?.page || manifest.options_page
    if (!page) throw new Error('Could not create an options page.')
    const url = `chrome-extension://${extension.id}/${String(page).replace(/^\/+/, '')}`

    // Chrome focuses an already-open options page instead of opening another.
    const strip = (u: string) => u.split('#')[0].split('?')[0]
    const existing = Array.from(this.ctx.store.tabs).find((tab) => {
      try {
        return !tab.isDestroyed() && strip(tab.getURL()) === strip(url)
      } catch {
        return false
      }
    })
    if (existing) {
      this.ctx.store.setActiveTab(existing)
      const win = this.ctx.store.tabToWindow.get(existing)
      try {
        if (win && !win.isDestroyed()) win.focus()
      } catch {}
      return
    }
    await this.ctx.store.createTab({ url, active: true })
  }
}
