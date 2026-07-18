import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'

import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'
import { matchesPattern } from './common'

/** True if a manifest permission string is a host/origin pattern rather than an API permission. */
const isHostPattern = (p: string) =>
  typeof p === 'string' &&
  (p === '<all_urls>' || /^(?:\*|[a-z][a-z0-9+.-]*):\/\//i.test(p))

const parseOriginPattern = (value: string): { scheme: string; host: string } | undefined => {
  if (value === '<all_urls>') return { scheme: '*all*', host: '*' }
  const match = /^([a-z*][a-z0-9+.*-]*):\/\/([^/]*)(?:\/.*)?$/i.exec(value)
  if (!match) return undefined
  return { scheme: match[1].toLowerCase(), host: match[2].toLowerCase() }
}

const schemeContains = (granted: string, requested: string) => {
  if (granted === '*all*') return true
  if (granted === '*') return requested === '*' || requested === 'http' || requested === 'https'
  return granted === requested
}

const hostContains = (granted: string, requested: string) => {
  if (granted === '*') return true
  if (requested === '*') return false
  const grantedWildcard = granted.startsWith('*.')
  const requestedWildcard = requested.startsWith('*.')
  const grantedBase = grantedWildcard ? granted.slice(2) : granted
  const requestedBase = requestedWildcard ? requested.slice(2) : requested
  if (!grantedWildcard) return !requestedWildcard && grantedBase === requestedBase
  return requestedBase === grantedBase || requestedBase.endsWith(`.${grantedBase}`)
}

/**
 * Whether a declared host-permission pattern grants access to a requested
 * origin. Host-permission paths are ignored by Chrome; scheme and wildcard
 * host containment are compared explicitly so a narrower required grant does
 * not accidentally swallow a broader optional request.
 */
const originMatches = (pattern: string, origin: string) => {
  if (pattern === '<all_urls>') return true
  if (origin === '<all_urls>') return pattern === '<all_urls>'
  const granted = parseOriginPattern(pattern)
  const requested = parseOriginPattern(origin)
  if (!granted || !requested) return matchesPattern(pattern, origin)
  return (
    schemeContains(granted.scheme, requested.scheme) &&
    hostContains(granted.host, requested.host)
  )
}

/**
 * This is a very basic implementation of the permissions API. Likely
 * more work will be needed to integrate with the native permissions.
 */
export class PermissionsAPI {
  private permissionMap = new Map<
    /* extensionId */ string,
    {
      requiredPermissions: string[]
      requiredOrigins: string[]
      grantedPermissions: string[]
      grantedOrigins: string[]
    }
  >()
  private persisted: Record<string, { permissions?: string[]; origins?: string[] }> = {}
  private changeListeners = new Set<(extensionId: string) => void>()
  private readonly permissionsFile = path.join(app.getPath('userData'), 'crx-permissions.json')

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('permissions.contains', this.contains)
    handle('permissions.getAll', this.getAll)
    handle('permissions.remove', this.remove)
    handle('permissions.request', this.request)

    this.loadPersisted()

    // Let all browser-side APIs consult one authoritative permission view.
    this.ctx.permissions = {
      hasPermission: (extensionId, permission) => this.hasPermission(extensionId, permission),
      hasOrigin: (extensionId, urlOrPattern) => this.hasOrigin(extensionId, urlOrPattern),
      onChanged: (listener) => {
        this.changeListeners.add(listener)
        return () => this.changeListeners.delete(listener)
      },
    }
    this.ctx.router.setPermissionResolver(
      (extensionId, permission) => this.hasPermission(extensionId, permission),
    )

    const sessionExtensions = ctx.session.extensions || ctx.session
    sessionExtensions.getAllExtensions().forEach((ext) => this.processExtension(ext))

    sessionExtensions.on('extension-loaded', (_event, extension) => {
      this.processExtension(extension)
    })

    sessionExtensions.on('extension-unloaded', (_event, extension) => {
      this.permissionMap.delete(extension.id)
    })
  }

  private processExtension(extension: Electron.Extension) {
    const manifest: chrome.runtime.Manifest = extension.manifest
    // MV2 lumps host patterns into `permissions` alongside API permissions; MV3
    // keeps them separate in `host_permissions`. Split host patterns out so
    // `contains({origins})` / `getAll().origins` reflect real host access for
    // both manifest versions (otherwise MV2 extensions see an empty `origins`).
    const apiPerms: string[] = []
    const origins: string[] = [...(manifest.host_permissions || [])]
    for (const p of manifest.permissions || []) {
      if (isHostPattern(p as string)) origins.push(p as string)
      else apiPerms.push(p as string)
    }
    const saved = this.persisted[extension.id] || {}
    this.permissionMap.set(extension.id, {
      requiredPermissions: apiPerms,
      requiredOrigins: origins,
      grantedPermissions: (saved.permissions || []).filter((p) =>
        (manifest.optional_permissions || []).includes(p),
      ),
      grantedOrigins: (saved.origins || []).filter((origin) =>
        this.isDeclaredOptionalOrigin(manifest, origin),
      ),
    })
  }

  private loadPersisted() {
    try {
      const parsed = JSON.parse(readFileSync(this.permissionsFile, 'utf8'))
      this.persisted = parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      this.persisted = {}
    }
  }

  private persist() {
    const out: Record<string, { permissions: string[]; origins: string[] }> = {
      ...(this.persisted as Record<string, { permissions: string[]; origins: string[] }>),
    }
    for (const [extensionId, current] of this.permissionMap) {
      if (current.grantedPermissions.length || current.grantedOrigins.length) {
        out[extensionId] = {
          permissions: current.grantedPermissions.slice(),
          origins: current.grantedOrigins.slice(),
        }
      } else delete out[extensionId]
    }
    this.persisted = out
    try {
      writeFileSync(this.permissionsFile, JSON.stringify(out), 'utf8')
    } catch {
      // A failed persistence write must not invalidate the in-memory grant.
    }
  }

  private allPermissions(current: ReturnType<PermissionsAPI['getCurrent']>) {
    return Array.from(new Set([...current.requiredPermissions, ...current.grantedPermissions]))
  }

  private allOrigins(current: ReturnType<PermissionsAPI['getCurrent']>) {
    return Array.from(new Set([...current.requiredOrigins, ...current.grantedOrigins]))
  }

  private getCurrent(extensionId: string) {
    return (
      this.permissionMap.get(extensionId) || {
        requiredPermissions: [],
        requiredOrigins: [],
        grantedPermissions: [],
        grantedOrigins: [],
      }
    )
  }

  private hasPermission(extensionId: string, permission: string) {
    return this.allPermissions(this.getCurrent(extensionId)).includes(permission)
  }

  private hasOrigin(extensionId: string, urlOrPattern: string) {
    const concreteUrl = !urlOrPattern.includes('*') && urlOrPattern !== '<all_urls>'
    return this.allOrigins(this.getCurrent(extensionId)).some((pattern) =>
      concreteUrl
        ? matchesPattern(pattern, urlOrPattern) || originMatches(pattern, urlOrPattern)
        : originMatches(pattern, urlOrPattern),
    )
  }

  private optionalOrigins(manifest: any): string[] {
    return [
      ...(manifest.optional_permissions || []),
      ...(manifest.optional_host_permissions || []),
    ].filter((p) => isHostPattern(p as string)) as string[]
  }

  private notifyChanged(extensionId: string) {
    for (const listener of this.changeListeners) {
      try {
        listener(extensionId)
      } catch {
        // One API reacting to a permission change must not block the others.
      }
    }
  }

  private isDeclaredOptionalOrigin(manifest: any, origin: string) {
    return this.optionalOrigins(manifest).some((pattern) => originMatches(pattern, origin))
  }

  private contains = (
    { extension }: ExtensionEvent,
    permissions: chrome.permissions.Permissions,
  ) => {
    const currentPermissions = this.getCurrent(extension.id)
    const allPermissions = this.allPermissions(currentPermissions)
    const allOrigins = this.allOrigins(currentPermissions)
    const hasPermissions = permissions.permissions
      ? permissions.permissions.every((permission) =>
          allPermissions.includes(permission as string),
        )
      : true
    // Origins may be declared as match patterns (e.g. `<all_urls>`,
    // `https://*/*`), so a requested origin is "contained" when any declared
    // pattern matches it — not only on exact string equality.
    const hasOrigins = permissions.origins
      ? permissions.origins.every((origin) =>
          allOrigins.some((pattern) => originMatches(pattern, origin)),
        )
      : true
    return hasPermissions && hasOrigins
  }

  private getAll = ({ extension }: ExtensionEvent) => {
    const current = this.getCurrent(extension.id)
    return { permissions: this.allPermissions(current), origins: this.allOrigins(current) }
  }

  private remove = ({ extension }: ExtensionEvent, permissions: chrome.permissions.Permissions) => {
    // Only optional grants are removable. Required manifest permissions make
    // the whole request fail atomically, matching Chrome.
    const current = this.permissionMap.get(extension.id)
    if (!current) return false
    if (
      permissions.permissions?.some((permission) =>
        current.requiredPermissions.includes(permission as string),
      ) ||
      permissions.origins?.some((origin) =>
        current.requiredOrigins.some((pattern) => originMatches(pattern, origin)),
      )
    ) {
      return false
    }
    let removed = false
    if (permissions.permissions) {
      const requested = permissions.permissions as string[]
      const before = current.grantedPermissions.length
      current.grantedPermissions = current.grantedPermissions.filter((p) => !requested.includes(p))
      removed = removed || before !== current.grantedPermissions.length
    }
    if (permissions.origins) {
      const before = current.grantedOrigins.length
      current.grantedOrigins = current.grantedOrigins.filter(
        (o) => !permissions.origins!.some((requested) => originMatches(requested, o)),
      )
      removed = removed || before !== current.grantedOrigins.length
    }
    if (!removed) return false
    this.persist()
    this.notifyChanged(extension.id)
    this.ctx.router.sendEvent(extension.id, 'permissions.onRemoved', permissions)
    return true
  }

  private request = async (
    { extension }: ExtensionEvent,
    request: chrome.permissions.Permissions,
  ) => {
    if (this.contains({ extension } as ExtensionEvent, request)) return true

    const optionalPermissions = new Set(extension.manifest.optional_permissions || [])
    if (request.permissions && !request.permissions.every((p) => optionalPermissions.has(p))) {
      throw new Error('Permissions request includes undeclared permission')
    }

    // Chrome requires requested origins to be a subset of the host patterns
    // declared as optional (`optional_permissions` host entries in MV2, plus
    // `optional_host_permissions` in MV3). Reject undeclared-origin requests
    // rather than silently granting arbitrary host access.
    if (request.origins && request.origins.length) {
      const declaredOptionalOrigins = this.optionalOrigins(extension.manifest)
      const allUrlsDeclared = declaredOptionalOrigins.includes('<all_urls>')
      const ok = request.origins.every((origin) =>
        allUrlsDeclared || declaredOptionalOrigins.some((pat) => originMatches(pat, origin)),
      )
      if (!ok) throw new Error('Permissions request includes undeclared origin')
    }

    const granted = await this.ctx.store.requestPermissions(extension, request)
    if (!granted) return false

    const permissions = this.permissionMap.get(extension.id)!
    if (request.origins) {
      for (const origin of request.origins) {
        if (!permissions.grantedOrigins.includes(origin)) {
          permissions.grantedOrigins.push(origin)
        }
      }
    }
    if (request.permissions) {
      for (const permission of request.permissions) {
        if (!permissions.grantedPermissions.includes(permission as string)) {
          permissions.grantedPermissions.push(permission as string)
        }
      }
    }
    this.persist()
    this.notifyChanged(extension.id)
    this.ctx.router.sendEvent(extension.id, 'permissions.onAdded', request)
    return true
  }
}
