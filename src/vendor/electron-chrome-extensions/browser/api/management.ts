import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'
import { resolveExtMessage } from './i18n'

// chrome.management. Gated on the "management" permission (except getSelf /
// uninstallSelf, which any extension may call for itself). Reads come from the
// session's loaded extensions; setEnabled / uninstall delegate to the host impl
// so disabled-state persistence and on-disk removal match the app's own
// install flow. Only currently-loaded (enabled) extensions are visible —
// disabled ones aren't returned by getAllExtensions(), a minor Chrome divergence.
export class ManagementAPI {
  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('management.get', this.get, { permission: 'management' })
    handle('management.getAll', this.getAll, { permission: 'management' })
    handle('management.getPermissionWarningsById', this.noopWarnings, {
      permission: 'management',
    })
    handle('management.getPermissionWarningsByManifest', this.noopWarnings, {
      permission: 'management',
    })
    handle('management.setEnabled', this.setEnabled, { permission: 'management' })
    handle('management.uninstall', this.uninstall, { permission: 'management' })
    // Self-targeted calls don't require the management permission.
    handle('management.getSelf', this.getSelf)
    handle('management.uninstallSelf', this.uninstallSelf)
  }

  private noopWarnings = (): string[] => []

  private all(): Electron.Extension[] {
    const get = (this.ctx.session as any).getAllExtensions
    return typeof get === 'function' ? (get.call(this.ctx.session) as Electron.Extension[]) : []
  }

  private toInfo(ext: Electron.Extension): chrome.management.ExtensionInfo {
    const manifest: any = ext.manifest || {}
    const hostPerms: string[] = manifest.host_permissions || []
    const perms: string[] = manifest.permissions || []
    // manifest.name / short_name / description 都可能是 __MSG_xxx__;按扩展
    // _locales 的 UI 语言解析,使 management.get/getAll/getSelf 与管理页名字一致。
    const name = resolveExtMessage(ext.path, manifest, manifest.name) || ''
    return {
      id: ext.id,
      name,
      shortName: resolveExtMessage(ext.path, manifest, manifest.short_name) || name,
      description: resolveExtMessage(ext.path, manifest, manifest.description) || '',
      version: manifest.version || '',
      versionName: manifest.version_name || manifest.version || '',
      mayDisable: true,
      enabled: true,
      type: 'extension',
      homepageUrl: manifest.homepage_url || '',
      updateUrl: '',
      optionsUrl: manifest.options_ui?.page || manifest.options_page || '',
      installType: 'normal',
      icons: manifest.icons
        ? Object.keys(manifest.icons).map((size) => ({
            size: Number(size),
            // A management page commonly displays icons belonging to other
            // extensions. Direct chrome-extension:// URLs are blocked unless
            // the target declares the icon as web-accessible, so serve them
            // through the browser-owned, icon-only protocol endpoint.
            url: `crx://extension-icon/${ext.id}/${Number(size)}/1`,
          }))
        : [],
      permissions: perms,
      hostPermissions: hostPerms.length ? hostPerms : perms.filter((p: string) => p.includes('://')),
    } as chrome.management.ExtensionInfo
  }

  private get = ({
    extension,
  }: ExtensionEvent,
  idOrName: string,
  ): chrome.management.ExtensionInfo | undefined => {
    // Chrome semantics: an unknown id/name resolves to undefined (callback
    // receives undefined; chrome.runtime.lastError is set), NOT a thrown error.
    // Throwing rejects the crx-msg IPC and surfaces as a RENDERER-ERR that some
    // extensions' init code doesn't expect — e.g. IDM probes for a sibling
    // extension ("clhiejnehegdfknplplojohghjaklbae") and its callback does
    // `b && b.enabled`, which is safe with undefined but the throw still spams
    // the log and can break callers using the callback form without F() wrap.
    const ext = this.all().find(
      (e) => e.id === idOrName || e.manifest?.name === idOrName,
    )
    if (!ext) return undefined
    return this.toInfo(ext)
  }

  private getAll = (): chrome.management.ExtensionInfo[] => {
    return this.all().map((e) => this.toInfo(e))
  }

  private getSelf = ({ extension }: ExtensionEvent): chrome.management.ExtensionInfo => {
    return this.toInfo(extension)
  }

  private setEnabled = async (
    { extension }: ExtensionEvent,
    id: string,
    enabled: boolean,
  ): Promise<boolean> => {
    if (extension.id === id) {
      throw new Error("An extension can't enable or disable itself via management.")
    }
    return (await this.ctx.store.impl.management?.setEnabled?.(id, enabled)) ?? false
  }

  private uninstall = async (
    { extension }: ExtensionEvent,
    id: string,
  ): Promise<void> => {
    if (extension.id === id) {
      throw new Error("An extension can't uninstall itself via management; use uninstallSelf.")
    }
    await this.ctx.store.impl.management?.uninstall?.(id)
  }

  private uninstallSelf = async ({ extension }: ExtensionEvent): Promise<void> => {
    await this.ctx.store.impl.management?.uninstall?.(extension.id)
  }
}
