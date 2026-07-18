import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { BaseWindow, BrowserWindow, nativeImage, webContents } from 'electron'

import { ERROR_PROTOCOL, WEBUI_BASE_URL, WEBUI_PROTOCOL } from '~/constants/files'

export interface TabContents extends Electron.WebContents {
  favicon?: string
}

export type ContextMenuType =
  | 'all'
  | 'page'
  | 'frame'
  | 'selection'
  | 'link'
  | 'editable'
  | 'image'
  | 'video'
  | 'audio'
  | 'launcher'
  | 'browser_action'
  | 'page_action'
  | 'action'

/**
 * Get the extension's properly typed Manifest.
 *
 * I can't seem to get TS's merged type declarations working so I'm using this
 * instead for now.
 */
export const getExtensionManifest = (extension: Electron.Extension): chrome.runtime.Manifest =>
  extension.manifest

export const getExtensionUrl = (extension: Electron.Extension, uri: string) => {
  try {
    return new URL(uri, extension.url).href
  } catch {}
}

export const resolveExtensionPath = (
  extension: Electron.Extension,
  uri: string,
  requestPath?: string,
) => {
  // Resolve any relative paths.
  const relativePath = path.join(requestPath || '/', uri)
  const resPath = path.join(extension.path, relativePath)

  // prevent any parent traversals
  if (!resPath.startsWith(extension.path)) return

  return resPath
}

export const validateExtensionResource = async (extension: Electron.Extension, uri: string) => {
  const resPath = resolveExtensionPath(extension, uri)
  if (!resPath) return

  try {
    await fs.stat(resPath)
  } catch {
    return // doesn't exist
  }

  return resPath
}

export enum ResizeType {
  Exact,
  Up,
  Down,
}

export const matchSize = (
  imageSet: { [key: number]: string },
  size: number,
  match: ResizeType,
): string | undefined => {
  // TODO: match based on size
  const first = parseInt(Object.keys(imageSet).pop()!, 10)
  return imageSet[first]
}

/** Gets the relative path to the extension's default icon. */
export const getIconPath = (
  extension: Electron.Extension,
  iconSize: number = 32,
  resizeType = ResizeType.Up,
) => {
  const manifest = getExtensionManifest(extension)
  const { icons } = manifest

  const default_icon: chrome.runtime.ManifestIcons | undefined = (
    manifest.manifest_version === 3 ? manifest.action : manifest.browser_action
  )?.default_icon

  if (typeof default_icon === 'string') {
    const iconPath = default_icon
    return iconPath
  } else if (typeof default_icon === 'object') {
    const iconPath = matchSize(default_icon, iconSize, resizeType)
    return iconPath
  } else if (typeof icons === 'object') {
    const iconPath = matchSize(icons, iconSize, resizeType)
    return iconPath
  }
}

export const getIconImage = (extension: Electron.Extension) => {
  const iconPath = getIconPath(extension)
  const iconAbsolutePath = iconPath && resolveExtensionPath(extension, iconPath)
  return iconAbsolutePath ? nativeImage.createFromPath(iconAbsolutePath) : undefined
}

const escapePattern = (pattern: string) => pattern.replace(/[\\^$+?.()|[\]{}]/g, '\\$&')

/** Convert a match-pattern component glob (only `*` is special) to a RegExp. */
const globToRegExp = (glob: string) =>
  new RegExp(`^${glob.split('*').map(escapePattern).join('.*')}$`)

const RELATED_FRAME_URL_RE = /^(about:(blank|srcdoc)$|data:|blob:|filesystem:)/i

const safeFrameUrl = (frame: Electron.WebFrameMain | null | undefined) => {
  try {
    return frame?.url || ''
  } catch {
    return ''
  }
}

/** Browser-owned pages must never receive extension content/user scripts. */
export const isBrowserInternalUrl = (url: string): boolean => {
  const value = String(url || '').toLowerCase()
  return (
    value.startsWith(WEBUI_BASE_URL.toLowerCase()) ||
    value.startsWith(`${WEBUI_PROTOCOL}://`) ||
    value.startsWith(`${ERROR_PROTOCOL}://`) ||
    value.startsWith('devtools://') ||
    value.startsWith('chrome://')
  )
}

/** Also blocks about:blank/data/blob child frames owned by an internal page. */
export const isBrowserInternalFrame = (
  frame: Electron.WebFrameMain | null | undefined,
): boolean => {
  let current = frame
  while (current) {
    if (isBrowserInternalUrl(safeFrameUrl(current))) return true
    current = current.parent
  }
  return false
}

const pushUnique = (arr: string[], value: string | undefined) => {
  if (!value || arr.includes(value)) return
  arr.push(value)
}

const toOriginMatchUrl = (url: string) => {
  try {
    const parsed = new URL(url)
    if (!parsed.origin || parsed.origin === 'null') return undefined
    return `${parsed.origin}/`
  } catch {
    return undefined
  }
}

/**
 * Chrome match-pattern test.
 *
 * Unlike a naive `*`→`.*` glob over the whole URL (which lets `*` span `://`
 * and host boundaries — matching e.g. `weirdscheme://` or the wrong host), this
 * parses BOTH the pattern and the URL into scheme / host / path and matches
 * each component per the spec. Returns a boolean.
 *
 * @see https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
 */
export const matchesPattern = (pattern: string, url: string): boolean => {
  if (pattern === '<all_urls>') return true

  const schemeSep = pattern.indexOf('://')
  if (schemeSep < 0) return false
  const scheme = pattern.slice(0, schemeSep).toLowerCase()
  const afterScheme = pattern.slice(schemeSep + 3)
  const pathSep = afterScheme.indexOf('/')
  const host = (pathSep >= 0 ? afterScheme.slice(0, pathSep) : afterScheme).toLowerCase()
  // Path is required by the spec; default to `/*` for lenient/origin patterns.
  const path = pathSep >= 0 ? afterScheme.slice(pathSep) : '/*'

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const urlScheme = parsed.protocol.replace(/:$/, '').toLowerCase()
  const urlHost = parsed.hostname.toLowerCase()
  // Chrome matches the path glob against path + query, not the fragment.
  const urlPath = parsed.pathname + (parsed.search || '')

  // scheme: Chrome's `*` matches http/https only (ws/wss/ftp/file must be
  // declared explicitly); otherwise the scheme must match exactly.
  if (scheme === '*') {
    if (urlScheme !== 'http' && urlScheme !== 'https') return false
  } else if (scheme !== urlScheme) {
    return false
  }

  // host: `*` = any host; `*.foo` = `foo` and any subdomain; else exact match.
  // (file:// URLs have an empty host and only match an empty-host pattern.)
  if (host !== '*') {
    if (host.startsWith('*.')) {
      const base = host.slice(2)
      if (urlHost !== base && !urlHost.endsWith(`.${base}`)) return false
    } else if (host !== urlHost) {
      return false
    }
  }

  return globToRegExp(path).test(urlPath)
}

/** Chrome glob match used by include_globs / exclude_globs style filters. */
export const matchesGlob = (pattern: string, url: string): boolean => globToRegExp(pattern).test(url)

/** True when the frame URL inherits its context/origin from another frame. */
export const isRelatedFrameUrl = (url: string): boolean => RELATED_FRAME_URL_RE.test(url)

/**
 * Candidate URLs/origins a content/user script should match against for a frame.
 *
 * Electron exposes the ancestor frame chain but not Chrome's exact opener
 * bookkeeping, so related-frame matching is approximated by walking parents.
 */
export const getFrameMatchUrls = (
  frame: Electron.WebFrameMain | null | undefined,
  opts: { matchAboutBlank?: boolean; matchOriginAsFallback?: boolean } = {},
): string[] => {
  const urls: string[] = []
  const url = safeFrameUrl(frame)
  pushUnique(urls, url)
  if (!frame || !isRelatedFrameUrl(url)) return urls

  const ancestorUrls: string[] = []
  let parent = frame.parent
  while (parent) {
    pushUnique(ancestorUrls, safeFrameUrl(parent))
    parent = parent.parent
  }

  if (opts.matchAboutBlank && /^about:(blank|srcdoc)$/i.test(url)) {
    for (const ancestorUrl of ancestorUrls) pushUnique(urls, ancestorUrl)
  }

  if (opts.matchOriginAsFallback) {
    const originCandidates = ancestorUrls.length > 0 ? ancestorUrls : [url]
    for (const candidate of originCandidates) pushUnique(urls, toOriginMatchUrl(candidate))
  }

  return urls
}

/** Shared content-script/user-script matcher for Chrome pattern + glob filters. */
export const matchesScriptFilter = (opts: {
  urls: string[]
  matches?: string[]
  excludeMatches?: string[]
  includeGlobs?: string[]
  excludeGlobs?: string[]
}): boolean => {
  const urls = opts.urls.filter(Boolean)
  const matches = opts.matches || []
  if (urls.length === 0 || matches.length === 0) return false

  const included = urls.some((url) => matches.some((pattern) => matchesPattern(pattern, url)))
  if (!included) return false

  const includeGlobs = opts.includeGlobs || []
  if (includeGlobs.length > 0) {
    const globIncluded = urls.some((url) =>
      includeGlobs.some((pattern) => matchesGlob(pattern, url)),
    )
    if (!globIncluded) return false
  }

  const excludeMatches = opts.excludeMatches || []
  if (
    excludeMatches.length > 0 &&
    urls.some((url) => excludeMatches.some((pattern) => matchesPattern(pattern, url)))
  ) {
    return false
  }

  const excludeGlobs = opts.excludeGlobs || []
  if (
    excludeGlobs.length > 0 &&
    urls.some((url) => excludeGlobs.some((pattern) => matchesGlob(pattern, url)))
  ) {
    return false
  }

  return true
}

/** Stable non-reserved isolated-world id for one extension/user-script world. */
export const extensionWorldId = (extensionId: string, worldName = ''): number => {
  const input = `${extensionId}:${worldName}`
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return 1000 + ((hash >>> 0) % 900000)
}

/** Execute in MAIN or in an extension-isolated world, including child frames. */
export const executeExtensionScript = async (
  frame: Electron.WebFrameMain,
  extensionId: string,
  code: string,
  world: 'MAIN' | 'ISOLATED' = 'ISOLATED',
  worldName = '',
): Promise<unknown> => {
  if (world === 'MAIN') return frame.executeJavaScript(code, true)

  const worldId = extensionWorldId(extensionId, worldName)
  const frameExecutor = (frame as any).executeJavaScriptInIsolatedWorld
  if (typeof frameExecutor === 'function') {
    return frameExecutor.call(frame, worldId, [{ code }], true)
  }

  // Electron exposes isolated-world execution on WebContents for the main
  // frame. Child frames are targeted through the registered frame preload.
  if (!frame.parent) {
    const contents = webContents.fromFrame(frame)
    if (contents && !contents.isDestroyed()) {
      return contents.executeJavaScriptInIsolatedWorld(worldId, [{ code }], true)
    }
  }

  frame.send('crx-execute-isolated-script', { code, extensionId, worldId })
  return undefined
}

export const matchesTitlePattern = (pattern: string, title: string) => {
  const regexp = new RegExp(`^${pattern.split('*').map(escapePattern).join('.*')}$`)
  return title.match(regexp)
}

export const getAllWindows = () => [...BaseWindow.getAllWindows(), ...BrowserWindow.getAllWindows()]
