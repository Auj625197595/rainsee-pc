import { app, net, shell } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

// chrome.downloads. Gated on the "downloads" permission. Replaces the prior
// all-noop stub. download() streams the URL via Electron's net.request into the
// downloads directory (using the extension's session so proxy/cookies apply),
// tracking per-item state in memory and firing onCreated/onChanged/onErased.
// search/show/open/cancel are functional; pause/resume toggle state (true flow
// pausing of a streaming request is intentionally not attempted); the rest are
// best-effort. These downloads are independent of the app's own will-download
// path because they aren't triggered by a webContents.
interface DownloadItem {
  id: number
  url: string
  filename: string
  mime: string
  state: 'in_progress' | 'interrupted' | 'complete'
  paused: boolean
  bytesReceived: number
  totalBytes: number
  danger: 'safe'
  incognito: boolean
  startTime: number
  endTime?: number
  filePath: string
  byExtensionId: string
  nativeItem?: Electron.DownloadItem
  request?: Electron.ClientRequest
}

type DownloadConflictAction = 'overwrite' | 'prompt' | 'uniquify'

interface NormalizedDownloadOptions {
  body?: string
  conflictAction: DownloadConflictAction
  filename?: string
  headers?: Record<string, string | string[]>
  method?: string
  saveAs?: boolean
  url: string
}

interface PendingNativeDownload {
  filePath: string
  id: number
  saveAs?: boolean
  timeout: ReturnType<typeof setTimeout>
  url: string
}

export class DownloadsAPI {
  private items = new Map<number, DownloadItem>()
  private nextId = 1
  private pendingNativeDownloads: PendingNativeDownload[] = []

  private diag(...args: any[]) {
    try {
      console.log('[crx-downloads]', ...args)
    } catch {}
  }

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('downloads.download', this.download, { permission: 'downloads' })
    handle('downloads.search', this.search, { permission: 'downloads' })
    handle('downloads.pause', this.pause, { permission: 'downloads' })
    handle('downloads.resume', this.resume, { permission: 'downloads' })
    handle('downloads.cancel', this.cancel, { permission: 'downloads' })
    handle('downloads.erase', this.erase, { permission: 'downloads' })
    handle('downloads.getFileIcon', this.getFileIcon, { permission: 'downloads' })
    handle('downloads.open', this.open, { permission: 'downloads' })
    handle('downloads.show', this.show, { permission: 'downloads' })
    handle('downloads.showDefaultFolder', this.showDefaultFolder, { permission: 'downloads' })
    handle('downloads.removeFile', this.removeFile, { permission: 'downloads' })
    handle('downloads.acceptDanger', this.acceptDanger, { permission: 'downloads' })
    handle('downloads.setUiOptions', this.setUiOptions, { permission: 'downloads' })
    handle('downloads.setShelfEnabled', this.setShelfEnabled, { permission: 'downloads' })
    handle('downloads.drag', this.setShelfEnabled, { permission: 'downloads' })
    this.ctx.session.on('will-download', this.onWillDownload)
  }

  private fireChanged(id: number, delta: Partial<chrome.downloads.DownloadDelta> = {}) {
    if (!this.items.has(id)) return
    this.ctx.router.broadcastEvent('downloads.onChanged', {
      id,
      ...delta,
    })
  }

  private toIsoTime(value?: number): string | undefined {
    return typeof value === 'number' ? new Date(value).toISOString() : undefined
  }

  private defaultFilenameForUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname
      const basename = path.posix.basename(pathname)
      return basename || 'download'
    } catch {
      return 'download'
    }
  }

  private sanitizeRelativeFilename(filename: string | undefined, url: string): string {
    const fallback = this.defaultFilenameForUrl(url)
    const candidate = typeof filename === 'string' ? filename.trim() : ''

    if (!candidate) return fallback
    if (/^[a-zA-Z]:[\\/]/.test(candidate) || candidate.startsWith('/') || candidate.startsWith('\\')) {
      return fallback
    }

    const segments = candidate
      .replace(/\\/g, '/')
      .split('/')
      .filter((segment) => segment && segment !== '.')

    if (segments.length === 0 || segments.some((segment) => segment === '..')) {
      return fallback
    }

    const sanitizedSegments = segments
      .map((segment) => segment.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim())
      .filter(Boolean)

    if (sanitizedSegments.length === 0) return fallback

    return path.join(...sanitizedSegments)
  }

  private async uniquifyFilePath(filePath: string): Promise<string> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK)
    } catch {
      return filePath
    }

    const parsed = path.parse(filePath)
    for (let suffix = 1; suffix < 10000; suffix += 1) {
      const candidate = path.join(parsed.dir, `${parsed.name} (${suffix})${parsed.ext}`)
      try {
        await fs.promises.access(candidate, fs.constants.F_OK)
      } catch {
        return candidate
      }
    }

    return path.join(parsed.dir, `${parsed.name}-${Date.now()}${parsed.ext}`)
  }

  private async resolveTargetPath(opts: NormalizedDownloadOptions) {
    const relativeFilename = this.sanitizeRelativeFilename(opts.filename, opts.url)
    const baseDir = app.getPath('downloads')
    let filePath = path.join(baseDir, relativeFilename)

    if (opts.conflictAction !== 'overwrite') {
      filePath = await this.uniquifyFilePath(filePath)
    }

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })

    return {
      filePath,
      relativeFilename: path.relative(baseDir, filePath) || path.basename(filePath),
    }
  }

  private normalizeHeaders(
    headers?: chrome.downloads.HeaderNameValuePair[],
  ): Record<string, string | string[]> | undefined {
    if (!Array.isArray(headers) || headers.length === 0) return undefined

    const normalized: Record<string, string | string[]> = {}
    for (const header of headers) {
      const name = header?.name?.trim()
      if (!name) continue

      let value: string | undefined
      if (typeof header.value === 'string') {
        value = header.value
      } else if (Array.isArray((header as any).binaryValue)) {
        value = Buffer.from((header as any).binaryValue).toString('utf8')
      }

      if (value == null) continue

      const current = normalized[name]
      if (current == null) {
        normalized[name] = value
      } else if (Array.isArray(current)) {
        current.push(value)
      } else {
        normalized[name] = [current, value]
      }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined
  }

  private normalizeDownloadOptions(
    input: string | chrome.downloads.DownloadOptions,
    maybeOptions?: chrome.downloads.DownloadOptions,
  ): NormalizedDownloadOptions | undefined {
    const raw =
      typeof input === 'string'
        ? { ...(maybeOptions || {}), url: input }
        : input && typeof input === 'object'
          ? input
          : undefined

    if (!raw || typeof raw.url !== 'string' || !raw.url.trim()) {
      return undefined
    }

    const conflictAction = raw.conflictAction
    const normalizedConflictAction: DownloadConflictAction =
      conflictAction === 'overwrite' || conflictAction === 'prompt' ? conflictAction : 'uniquify'

    return {
      body: typeof raw.body === 'string' ? raw.body : undefined,
      conflictAction: normalizedConflictAction,
      filename: typeof raw.filename === 'string' ? raw.filename : undefined,
      headers: this.normalizeHeaders(raw.headers),
      method: typeof raw.method === 'string' && raw.method.trim() ? raw.method.trim() : undefined,
      saveAs: raw.saveAs === true,
      url: raw.url.trim(),
    }
  }

  private withContextHeaders(
    event: ExtensionEvent,
    options: NormalizedDownloadOptions,
  ): NormalizedDownloadOptions {
    const headers: Record<string, string | string[]> = { ...(options.headers || {}) }
    const hasHeader = (name: string) =>
      Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase())

    const activeTab = this.ctx.store.getActiveTabOfCurrentWindow(event)
    let pageUrl = ''
    try {
      pageUrl =
        this.ctx.store.tabDetailsCache.get(activeTab?.id || -1)?.url ||
        activeTab?.getURL?.() ||
        ''
    } catch {}

    if (pageUrl) {
      try {
        const page = new URL(pageUrl)
        if ((page.protocol === 'http:' || page.protocol === 'https:') && !hasHeader('Referer')) {
          headers.Referer = page.toString()
        }
        if ((page.protocol === 'http:' || page.protocol === 'https:') && !hasHeader('Origin')) {
          headers.Origin = page.origin
        }
      } catch {
        /* ignore invalid current page url */
      }
    }

    if (activeTab && !hasHeader('User-Agent')) {
      try {
        const userAgent = activeTab.userAgent || activeTab.getUserAgent?.()
        if (userAgent) headers['User-Agent'] = userAgent
      } catch {
        /* best-effort */
      }
    }

    return {
      ...options,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    }
  }

  private canUseNativeDownload(options: NormalizedDownloadOptions): boolean {
    if (options.body) return false
    if (!options.method) return true
    return options.method.toUpperCase() === 'GET'
  }

  private toDownloadURLHeaders(
    headers?: Record<string, string | string[]>,
  ): Record<string, string> | undefined {
    if (!headers) return undefined
    const normalized: Record<string, string> = {}
    for (const [name, value] of Object.entries(headers)) {
      if (Array.isArray(value)) normalized[name] = value.join(', ')
      else normalized[name] = value
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined
  }

  private toChromeStateFromNativeState(
    state: ReturnType<Electron.DownloadItem['getState']>,
  ): DownloadItem['state'] {
    if (state === 'completed') return 'complete'
    if (state === 'progressing') return 'in_progress'
    return 'interrupted'
  }

  private applyNativeItemSnapshot(item: DownloadItem, nativeItem: Electron.DownloadItem) {
    item.nativeItem = nativeItem
    item.bytesReceived = nativeItem.getReceivedBytes()
    const totalBytes = nativeItem.getTotalBytes()
    item.totalBytes = totalBytes > 0 ? totalBytes : -1
    item.mime = nativeItem.getMimeType() || item.mime
    item.paused = nativeItem.isPaused()
    item.state = this.toChromeStateFromNativeState(nativeItem.getState())
    const savePath = nativeItem.getSavePath()
    if (savePath) {
      item.filePath = savePath
      item.filename = path.relative(app.getPath('downloads'), savePath) || path.basename(savePath)
    }
  }

  private normalizedUrlKey(url: string): string {
    try {
      const parsed = new URL(url)
      parsed.hash = ''
      parsed.search = ''
      return parsed.toString()
    } catch {
      return url
    }
  }

  private takePendingNativeDownload(nativeItem: Electron.DownloadItem): PendingNativeDownload | undefined {
    const urlChain = (() => {
      try {
        return nativeItem.getURLChain()
      } catch {
        return []
      }
    })()
    const candidateUrls = [nativeItem.getURL(), ...urlChain].filter(Boolean)
    const directMatchIndex = this.pendingNativeDownloads.findIndex((entry) =>
      candidateUrls.includes(entry.url),
    )
    if (directMatchIndex >= 0) {
      this.diag('will-download match=direct', candidateUrls[0] || '', 'pending', this.pendingNativeDownloads[directMatchIndex].url)
      return this.pendingNativeDownloads.splice(directMatchIndex, 1)[0]
    }

    const normalizedCandidates = new Set(candidateUrls.map((entry) => this.normalizedUrlKey(entry)))
    const normalizedMatchIndex = this.pendingNativeDownloads.findIndex((entry) =>
      normalizedCandidates.has(this.normalizedUrlKey(entry.url)),
    )
    if (normalizedMatchIndex >= 0) {
      this.diag('will-download match=normalized', candidateUrls[0] || '', 'pending', this.pendingNativeDownloads[normalizedMatchIndex].url)
      return this.pendingNativeDownloads.splice(normalizedMatchIndex, 1)[0]
    }

    if (this.pendingNativeDownloads.length === 1) {
      this.diag('will-download match=single-fallback', candidateUrls[0] || '', 'pending', this.pendingNativeDownloads[0].url)
      return this.pendingNativeDownloads.shift()
    }

    this.diag('will-download no-match', candidateUrls[0] || '', 'pendingCount', this.pendingNativeDownloads.length)
    return undefined
  }

  // A native browser-initiated download (user clicked a link / navigated to a
  // download URL) — i.e. NOT one an extension started via chrome.downloads
  // .download(). Real Chrome fires chrome.downloads.onCreated for these, and
  // download-intercepting extensions (MotrixNext forwards the URL to its local
  // desktop app, others hand off to aria2/IDM/…) rely on that event to see and
  // grab native downloads. Register the item, broadcast onCreated, and wire
  // progress so cancel()/pause()/onChanged work for the extension.
  private registerNativeBrowserDownload(nativeItem: Electron.DownloadItem): DownloadItem {
    const url = nativeItem.getURL()
    const filename = nativeItem.getFilename() || this.defaultFilenameForUrl(url)
    const total = nativeItem.getTotalBytes()
    const id = this.nextId++
    const item: DownloadItem = {
      id,
      url,
      filename,
      mime: nativeItem.getMimeType() || '',
      state: 'in_progress',
      paused: false,
      bytesReceived: nativeItem.getReceivedBytes(),
      totalBytes: total > 0 ? total : -1,
      danger: 'safe',
      incognito: false,
      startTime: Date.now(),
      filePath: nativeItem.getSavePath() || filename,
      byExtensionId: '',
    }
    item.nativeItem = nativeItem
    this.items.set(id, item)
    // Snapshot again so state reflects however far the native item has already
    // progressed (e.g. a download that completed during the deferred tick).
    this.applyNativeItemSnapshot(item, nativeItem)
    this.ctx.router.broadcastEvent('downloads.onCreated', this.toChromeItem(item))
    this.diag('will-download native onCreated', 'id', id, 'state', item.state, 'url', url, 'filename', filename)
    this.attachNativeProgressListeners(item, nativeItem)
    return item
  }

  private onWillDownload = (
    event: Electron.Event,
    nativeItem: Electron.DownloadItem,
    _webContents: Electron.WebContents,
  ) => {
    const pending = this.takePendingNativeDownload(nativeItem)
    if (pending) {
      clearTimeout(pending.timeout)
      const item = this.items.get(pending.id)
      if (!item) return
      this.diag('will-download bound', 'id', item.id, 'state', nativeItem.getState(), 'url', nativeItem.getURL())

      if (pending.saveAs) {
        nativeItem.setSaveDialogOptions({
          defaultPath: pending.filePath,
        })
      } else {
        nativeItem.setSavePath(pending.filePath)
      }

      this.applyNativeItemSnapshot(item, nativeItem)
      this.fireChanged(item.id, {
        bytesReceived: { current: item.bytesReceived },
        filename: { current: item.filePath },
        mime: { current: item.mime },
        totalBytes: { current: item.totalBytes },
      })
      this.attachNativeProgressListeners(item, nativeItem)
      return
    }

    // An external download manager cannot dereference a page-owned Blob URL.
    // Do not advertise native page Blob downloads to intercepting extensions;
    // leaving the item untouched lets Electron save the actual renderer data.
    if (nativeItem.getURL().toLowerCase().startsWith('blob:')) return

    // Native browser download. This listener is registered before the app's own
    // will-download handler (sessions-service), so the app hasn't run yet and we
    // can't see its preventDefault synchronously. Defer the onCreated broadcast
    // to the next tick — by then the app has decided; if it preventDefault'd to
    // hand off to its built-in external downloader, skip broadcasting so the
    // download isn't sent to two downloaders.
    setImmediate(() => {
      if (event.defaultPrevented) return
      if ((nativeItem as any).isDestroyed?.()) return
      try {
        this.registerNativeBrowserDownload(nativeItem)
      } catch (error) {
        this.diag(
          'native onCreated error',
          error instanceof Error ? error.message : String(error),
        )
      }
    })
  }

  private attachNativeProgressListeners(item: DownloadItem, nativeItem: Electron.DownloadItem) {
    nativeItem.on('updated', (_evt, state) => {
      const prevBytes = item.bytesReceived
      const prevPaused = item.paused
      const prevState = item.state
      const prevTotalBytes = item.totalBytes
      const prevMime = item.mime
      const prevFilePath = item.filePath

      this.applyNativeItemSnapshot(item, nativeItem)

      const delta: Partial<chrome.downloads.DownloadDelta> = {}
      if (item.bytesReceived !== prevBytes) {
        delta.bytesReceived = { previous: prevBytes, current: item.bytesReceived }
      }
      if (item.paused !== prevPaused) {
        delta.paused = { previous: prevPaused, current: item.paused }
      }
      if (item.state !== prevState) {
        delta.state = { previous: prevState, current: item.state }
      } else if (state === 'interrupted' && item.state === 'interrupted') {
        delta.state = { previous: 'in_progress', current: 'interrupted' }
      }
      if (item.totalBytes !== prevTotalBytes) {
        delta.totalBytes = { previous: prevTotalBytes, current: item.totalBytes }
      }
      if (item.mime !== prevMime) {
        delta.mime = { previous: prevMime, current: item.mime }
      }
      if (item.filePath !== prevFilePath) {
        delta.filename = { previous: prevFilePath, current: item.filePath }
      }
      if (Object.keys(delta).length > 0) this.fireChanged(item.id, delta)
      if (state === 'interrupted') {
        this.diag('updated interrupted', 'id', item.id, 'canResume', nativeItem.canResume(), 'url', nativeItem.getURL())
      }
    })

    nativeItem.once('done', (_evt, state) => {
      const prevState = item.state
      this.applyNativeItemSnapshot(item, nativeItem)
      item.endTime = Date.now()

      const delta: Partial<chrome.downloads.DownloadDelta> = {
        bytesReceived: { current: item.bytesReceived },
        endTime: { current: this.toIsoTime(item.endTime) },
        exists: { current: state === 'completed' },
        filename: { current: item.filePath },
        mime: { current: item.mime },
        totalBytes: { current: item.totalBytes },
      }
      if (item.state !== prevState || state !== 'completed') {
        delta.state = { previous: prevState, current: item.state }
      }
      this.fireChanged(item.id, delta)
      this.diag('done', 'id', item.id, 'state', state, 'path', item.filePath)
    })
  }

  private downloadViaNative(
    event: ExtensionEvent,
    item: DownloadItem,
    options: NormalizedDownloadOptions,
  ): number | undefined {
    const timeout = setTimeout(() => {
      const pendingIndex = this.pendingNativeDownloads.findIndex((entry) => entry.id === item.id)
      if (pendingIndex < 0) return
      this.pendingNativeDownloads.splice(pendingIndex, 1)
      item.state = 'interrupted'
      item.endTime = Date.now()
      this.diag('native timeout', 'id', item.id, 'url', item.url)
      this.fireChanged(item.id, {
        endTime: { current: this.toIsoTime(item.endTime) },
        state: { previous: 'in_progress', current: 'interrupted' },
      })
    }, 10000)

    this.pendingNativeDownloads.push({
      filePath: item.filePath,
      id: item.id,
      saveAs: options.saveAs,
      timeout,
      url: options.url,
    })

    try {
      this.diag('downloadURL start', 'id', item.id, 'url', options.url)
      const downloadOptions = {
        headers: this.toDownloadURLHeaders(options.headers),
      }

      if (options.url.toLowerCase().startsWith('blob:')) {
        // Blob URLs live in the renderer/storage context that created them.
        // Session.downloadURL() runs outside that context and therefore cannot
        // resolve the in-memory payload. Prefer the calling frame when its
        // origin owns the Blob, otherwise use the active page (content scripts
        // commonly forward a page Blob URL through an extension worker/popup).
        const candidates: Electron.WebContents[] = []
        if (event.type === 'frame' && !event.sender.isDestroyed()) {
          candidates.push(event.sender)
        }
        const activeTab = this.ctx.store.getActiveTabOfCurrentWindow(event)
        if (activeTab && !activeTab.isDestroyed() && !candidates.includes(activeTab)) {
          candidates.push(activeTab)
        }

        let blobOrigin = ''
        try {
          blobOrigin = new URL(options.url).origin
        } catch {}
        const source =
          candidates.find((candidate) => {
            if (!blobOrigin || blobOrigin === 'null') return false
            try {
              return new URL(candidate.getURL()).origin === blobOrigin
            } catch {
              return false
            }
          }) || candidates[0]

        if (source) {
          source.downloadURL(options.url, downloadOptions)
        } else {
          // Keep the existing best-effort fallback for extension contexts for
          // which Electron cannot expose an owning WebContents (for example a
          // service worker with no browser window).
          this.ctx.session.downloadURL(options.url, downloadOptions)
        }
      } else {
        this.ctx.session.downloadURL(options.url, downloadOptions)
      }
      return item.id
    } catch {
      clearTimeout(timeout)
      this.pendingNativeDownloads = this.pendingNativeDownloads.filter((entry) => entry.id !== item.id)
      item.state = 'interrupted'
      item.endTime = Date.now()
      this.diag('downloadURL throw', 'id', item.id, 'url', options.url)
      this.fireChanged(item.id, {
        endTime: { current: this.toIsoTime(item.endTime) },
        state: { previous: 'in_progress', current: 'interrupted' },
      })
      return undefined
    }
  }

  private downloadViaRequest(item: DownloadItem, options: NormalizedDownloadOptions): Promise<number> {
    return new Promise<number>((resolve) => {
      let request: Electron.ClientRequest
      try {
        request = net.request({
          headers: options.headers,
          method: options.method,
          redirect: 'follow',
          session: this.ctx.session,
          url: options.url,
        } as any)
      } catch {
        item.state = 'interrupted'
        this.fireChanged(item.id, {
          state: { previous: 'in_progress', current: 'interrupted' },
        })
        resolve(item.id)
        return
      }

      item.request = request
      const stream = fs.createWriteStream(item.filePath)
      let finished = false

      const interrupt = () => {
        if (finished) return
        finished = true
        item.state = 'interrupted'
        try {
          request.destroy()
        } catch {
          /* ignore */
        }
        try {
          stream.destroy()
        } catch {
          /* ignore */
        }
        void fs.promises.unlink(item.filePath).catch(() => undefined)
        this.fireChanged(item.id, {
          state: { previous: 'in_progress', current: 'interrupted' },
        })
      }

      stream.on('error', interrupt)

      request.on('response', (response) => {
        const totalHeader = response.headers['content-length']
        const totalValue = Array.isArray(totalHeader) ? totalHeader[0] : totalHeader
        const total = Number(totalValue)
        item.totalBytes = Number.isFinite(total) && total >= 0 ? total : -1

        const contentType = response.headers['content-type']
        item.mime = Array.isArray(contentType) ? contentType[0] || '' : contentType || ''

        if (response.statusCode && response.statusCode >= 400) {
          interrupt()
          return
        }

        response.on('data', (chunk: Buffer) => {
          if (finished) return
          item.bytesReceived += chunk.length
          stream.write(chunk)
        })

        response.on('end', () => {
          if (finished) return
          stream.end(() => {
            finished = true
            item.state = 'complete'
            item.endTime = Date.now()
            this.fireChanged(item.id, {
              bytesReceived: { current: item.bytesReceived },
              endTime: { current: this.toIsoTime(item.endTime) },
              exists: { current: true },
              filename: { current: item.filePath },
              mime: { current: item.mime },
              state: { previous: 'in_progress', current: 'complete' },
              totalBytes: { current: item.totalBytes },
            })
          })
        })

        response.on('error', interrupt)
      })

      request.on('error', interrupt)

      if (options.body) {
        request.write(options.body)
      }

      request.end()
      resolve(item.id)
    })
  }

  private download = (
    event: ExtensionEvent,
    input: string | chrome.downloads.DownloadOptions,
    maybeOptions?: chrome.downloads.DownloadOptions,
  ): Promise<number | undefined> => {
    const rawOptions = this.normalizeDownloadOptions(input, maybeOptions)
    if (!rawOptions) return Promise.resolve(undefined)
    const options = this.withContextHeaders(event, rawOptions)
    const { extension } = event

    return this.resolveTargetPath(options)
      .then(({ filePath, relativeFilename }) => {
        const id = this.nextId++
        const item: DownloadItem = {
          id,
          url: options.url,
          filename: relativeFilename,
          mime: '',
          state: 'in_progress',
          paused: false,
          bytesReceived: 0,
          totalBytes: -1,
          danger: 'safe',
          incognito: false,
          startTime: Date.now(),
          filePath,
          byExtensionId: extension.id,
        }
        this.items.set(id, item)
        this.ctx.router.broadcastEvent('downloads.onCreated', this.toChromeItem(item))

        if (this.canUseNativeDownload(options)) {
          return Promise.resolve(this.downloadViaNative(event, item, options))
        }

        return this.downloadViaRequest(item, options)
      })
      .catch(() => undefined)
  }

  private toChromeItem(item: DownloadItem): chrome.downloads.DownloadItem {
    return {
      id: item.id,
      url: item.url,
      finalUrl: item.url,
      referrer: '',
      mime: item.mime,
      filename: item.filePath,
      danger: item.danger as any,
      fileSize: item.totalBytes,
      estimatedEndTime: undefined as any,
      exists: item.state === 'complete',
      byExtensionId: item.byExtensionId,
      byExtensionName: '',
      state: item.state as any,
      paused: item.paused,
      bytesReceived: item.bytesReceived,
      totalBytes: item.totalBytes,
      incognito: item.incognito,
      startTime: this.toIsoTime(item.startTime) as any,
      endTime: this.toIsoTime(item.endTime) as any,
    } as chrome.downloads.DownloadItem
  }

  private search = async (
    _event: ExtensionEvent,
    query: chrome.downloads.DownloadQuery = {},
  ): Promise<chrome.downloads.DownloadItem[]> => {
    let list = Array.from(this.items.values())
    if (query.id != null) {
      const ids = Array.isArray(query.id) ? query.id : [query.id]
      list = list.filter((i) => ids.includes(i.id))
    }
    if (query.state) list = list.filter((i) => i.state === query.state)
    if (query.filenameRegex) {
      try {
        const re = new RegExp(query.filenameRegex as string)
        list = list.filter((i) => re.test(i.filePath))
      } catch {
        /* invalid regex — ignore filter */
      }
    }
    const orderBy = query.orderBy
    if (orderBy) {
      const keys = Array.isArray(orderBy) ? orderBy : [orderBy]
      for (const k of keys.reverse()) {
        const desc = k.startsWith('-')
        const key = desc ? k.slice(1) : k
        list.sort((a: any, b: any) => {
          const av = a[key]
          const bv = b[key]
          if (av === bv) return 0
          return (av > bv ? 1 : -1) * (desc ? -1 : 1)
        })
      }
    }
    if (typeof query.limit === 'number') list = list.slice(0, query.limit)
    return list.map((i) => this.toChromeItem(i))
  }

  private pause = (_event: ExtensionEvent, id: number): boolean => {
    const item = this.items.get(id)
    if (!item || item.state !== 'in_progress' || item.paused) return false
    try {
      item.nativeItem?.pause()
    } catch {
      /* ignore */
    }
    item.paused = true
    this.fireChanged(id, {
      paused: { previous: false, current: true },
    })
    return true
  }

  private resume = (_event: ExtensionEvent, id: number): boolean => {
    const item = this.items.get(id)
    if (!item || !item.paused) return false
    try {
      item.nativeItem?.resume()
    } catch {
      /* ignore */
    }
    item.paused = false
    this.fireChanged(id, {
      paused: { previous: true, current: false },
    })
    return true
  }

  private cancel = (_event: ExtensionEvent, id: number): boolean => {
    const item = this.items.get(id)
    if (!item || item.state !== 'in_progress') return false
    // Tag the native Electron DownloadItem so the app's own will-download
    // handler can tell an extension take-over (e.g. MotrixNext) apart from a
    // user-initiated cancel and drop the entry silently (no popup, no history)
    // instead of surfacing it as a canceled download. Must be set BEFORE the
    // cancel so the app's `done` listener (fires next tick) sees it.
    if (item.nativeItem) {
      ;(item.nativeItem as any).__crxExtIntercepted = true
    }
    try {
      item.nativeItem?.cancel()
    } catch {
      /* ignore */
    }
    try {
      item.request?.abort?.()
    } catch {
      /* ignore */
    }
    item.state = 'interrupted'
    this.fireChanged(id, {
      state: { previous: 'in_progress', current: 'interrupted' },
    })
    return true
  }

  /** True if any extension registered a chrome.downloads.onCreated listener.
   *  The app uses this to decide whether to hold a native download's popup
   *  briefly (giving an intercepting extension time to claim it) vs. showing
   *  immediately. */
  hasCreatedListeners(): boolean {
    return this.ctx.router.hasListeners('downloads.onCreated')
  }

  private erase = async (
    _event: ExtensionEvent,
    query: chrome.downloads.DownloadQuery = {},
  ): Promise<number[]> => {
    const list = await this.search(_event, query)
    const erased: number[] = []
    for (const it of list) {
      this.items.delete(it.id)
      erased.push(it.id)
      this.ctx.router.broadcastEvent('downloads.onErased', it.id)
    }
    return erased
  }

  private getFileIcon = (): Promise<string> => Promise.resolve('')

  private open = (_event: ExtensionEvent, id: number): boolean => {
    const item = this.items.get(id)
    if (!item) return false
    if (item.state !== 'complete') return false
    void shell.openPath(item.filePath)
    return true
  }

  private show = (_event: ExtensionEvent, id: number): boolean => {
    const item = this.items.get(id)
    if (!item) return false
    shell.showItemInFolder(item.filePath)
    return true
  }

  private showDefaultFolder = (): void => {
    void shell.openPath(app.getPath('downloads'))
  }

  private removeFile = async (_event: ExtensionEvent, id: number): Promise<boolean> => {
    const item = this.items.get(id)
    if (!item) return false
    try {
      await fs.promises.unlink(item.filePath)
    } catch {
      /* best-effort */
    }
    return true
  }

  private acceptDanger = (_event: ExtensionEvent, id: number): boolean => {
    const item = this.items.get(id)
    if (!item) return false
    this.fireChanged(id, {
      danger: { current: item.danger },
    })
    return true
  }

  private setUiOptions = (): void => {}
  private setShelfEnabled = (): void => {}
}
