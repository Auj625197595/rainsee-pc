import { BrowserWindow } from 'electron'
import debug from 'debug'

import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

const d = debug('electron-chrome-extensions:identity')

// OAuth URLs contain authorization codes, state and PKCE material. Keep
// diagnostics useful without writing those values to the application log.
const redactIdentityUrl = (value: unknown) => {
  if (typeof value !== 'string' || !value) return ''
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return value.split(/[?#]/, 1)[0].slice(0, 240)
  }
}

const summarizeIdentityUrl = (value: unknown) => {
  if (typeof value !== 'string' || !value) return { type: typeof value, value: '' }
  try {
    const url = new URL(value)
    const searchKeys = Array.from(url.searchParams.keys())
    const hashText = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
    const hashKeys = hashText
      .split('&')
      .map((part) => part.split('=', 1)[0])
      .filter(Boolean)
    return {
      origin: url.origin,
      pathname: url.pathname,
      searchKeys,
      hashKeys,
      searchLength: url.search.length,
      hashLength: url.hash.length,
      hasCode: url.searchParams.has('code') || hashKeys.includes('code'),
      hasState: url.searchParams.has('state') || hashKeys.includes('state'),
      hasError: url.searchParams.has('error') || hashKeys.includes('error'),
    }
  } catch {
    return { type: 'invalid-url', value: redactIdentityUrl(value) }
  }
}

const redactIdentityErrorMessage = (value: unknown) =>
  String(value || '')
    .split(/[\r\n]/, 1)[0]
    .replace(/https?:\/\/[^\s'"<>]+/gi, (url) => redactIdentityUrl(url))
    .slice(0, 240)

const describeIdentityError = (err: any) => ({
  message: redactIdentityErrorMessage(err?.message || err),
  code: err?.code || '',
  errno: typeof err?.errno === 'number' ? err.errno : '',
  url: redactIdentityUrl(err?.url),
})

const toIdentityLoadError = (err: any) => {
  const code = typeof err?.code === 'string' && /^ERR_[A-Z0-9_]+$/.test(err.code)
    ? err.code
    : ''
  const errno = typeof err?.errno === 'number' ? err.errno : undefined
  const detail = [code, errno].filter((value) => value !== '' && value !== undefined).join(', ')
  return new Error(`Authorization page could not be loaded${detail ? ` (${detail})` : ''}.`)
}

/**
 * Minimal `chrome.identity` implementation.
 *
 * `launchWebAuthFlow` opens the auth URL in a window and resolves with the
 * final redirect URL once the browser navigates to the extension's
 * `https://<id>.chromiumapp.org/*` redirect target —
 * enough for the OAuth implicit / PKCE flows most extensions use. The auth window shares the
 * browsing session so a user already signed in to the identity provider isn't
 * prompted to log in again.
 *
 * `getAuthToken` (Google-account specific — requires a bundled OAuth2 client id
 * and Chrome's sign-in machinery) is not supported; it fails via
 * chrome.runtime.lastError, matching Chrome when no token is available, so
 * extensions fall back to launchWebAuthFlow.
 */
export class IdentityAPI {
  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    const opts = { permission: 'identity' as any }
    handle('identity.launchWebAuthFlow', this.launchWebAuthFlow.bind(this), opts)
    handle('identity.getAuthToken', this.getAuthToken.bind(this), opts)
    handle('identity.removeCachedAuthToken', async () => {}, opts)
    handle('identity.clearAllCachedAuthTokens', async () => {}, opts)
    handle('identity.getProfileUserInfo', async () => ({ email: '', id: '' }), opts)
  }

  private async getAuthToken(): Promise<never> {
    // No bundled Google OAuth client — surface as a failure (lastError) instead
    // of hanging. Extensions typically fall back to launchWebAuthFlow.
    throw new Error('identity.getAuthToken is not supported')
  }

  private launchWebAuthFlow(
    { extension }: ExtensionEvent,
    details: { url: string; interactive?: boolean } = {} as any,
  ): Promise<string> {
    const authUrl = details?.url
    if (!authUrl) throw new Error('launchWebAuthFlow requires a url')
    const redirectPrefix = `https://${extension.id}.chromiumapp.org/`
    const interactive = details.interactive !== false
    const trace = (event: string, data: Record<string, unknown> = {}) => {
      d(event, { extensionId: extension.id, interactive, ...data })
    }
    trace('launch-start', {
      authUrl: redactIdentityUrl(authUrl),
      authUrlSummary: summarizeIdentityUrl(authUrl),
      redirectPrefix,
    })

    return new Promise<string>((resolve, reject) => {
      let settled = false
      let retryTimer: ReturnType<typeof setTimeout> | undefined
      let silentTimeout: ReturnType<typeof setTimeout> | undefined
      let failureTimer: ReturnType<typeof setTimeout> | undefined
      let loadAttempt = 0
      let authPageLoaded = false
      let replacementNavigationSeen = false
      const maxTransientRetries = 3
      const win = new BrowserWindow({
        width: 480,
        height: 640,
        show: interactive,
        autoHideMenuBar: true,
        title: extension.name,
        webPreferences: {
          // Share the browsing session so the user's existing IdP login applies.
          session: this.ctx.session,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      })
      trace('window-created', { windowId: win.id, visible: win.isVisible() })

      // Keep the interactive auth window visible even when the first network
      // request fails before Chromium emits `ready-to-show`.
      if (interactive) {
        try {
          win.show()
          trace('window-show', { windowId: win.id, visible: win.isVisible() })
        } catch {
          /* best-effort; the window may already be closing */
        }
      }

      const finish = (result?: string, err?: Error) => {
        if (settled) return
        settled = true
        trace('finish', {
          windowId: win.id,
          resultUrl: redactIdentityUrl(result),
          resultUrlSummary: summarizeIdentityUrl(result),
          error: err ? describeIdentityError(err) : undefined,
        })
        if (retryTimer) {
          clearTimeout(retryTimer)
          retryTimer = undefined
        }
        if (silentTimeout) {
          clearTimeout(silentTimeout)
          silentTimeout = undefined
        }
        if (failureTimer) {
          clearTimeout(failureTimer)
          failureTimer = undefined
        }
        try {
          if (!win.isDestroyed()) win.destroy()
        } catch {
          /* best-effort */
        }
        if (err) reject(err)
        else if (typeof result === 'string') resolve(result)
        else reject(new Error('identity.launchWebAuthFlow returned no redirect URL'))
      }

      // Intercept the navigation to the extension's chromiumapp.org redirect
      // target (which never actually resolves) and hand the full URL — including
      // the OAuth `#access_token=...` / `?code=...` fragment — back to the caller.
      // Preventing the navigation is important: destroying the window while
      // Chromium is trying to load this synthetic host otherwise makes the
      // original loadURL() reject with ERR_ABORTED.
      const check = (event: Electron.Event, url: string) => {
        if (
          typeof url === 'string' &&
          url.startsWith(redirectPrefix)
        ) {
          try {
            event.preventDefault()
          } catch {
            /* best-effort; did-start-navigation has no cancelable event */
          }
          trace('redirect-callback', { windowId: win.id, redirectUrl: redactIdentityUrl(url) })
          trace('redirect-callback-details', {
            windowId: win.id,
            redirectUrlSummary: summarizeIdentityUrl(url),
          })
          finish(url)
          return true
        }
        return false
      }

      const isAbortedError = (err: any) => err?.code === 'ERR_ABORTED' || err?.errno === -3
      const isTransientNetworkError = (err: any) =>
        err?.errno === -100 ||
        err?.code === 'ERR_CONNECTION_CLOSED' ||
        (typeof err?.message === 'string' && err.message.includes('ERR_CONNECTION_CLOSED'))

      const handleLoadError = (err: any, attempt: number, source: string, deferAbort = true) => {
        trace('load-error', {
          windowId: win.id,
          attempt,
          source,
          authPageLoaded,
          error: describeIdentityError(err),
        })
        if (settled || attempt !== loadAttempt || authPageLoaded) return

        // Navigation events and loadURL's rejected Promise are not guaranteed
        // to be delivered in the same task. Give a replacement navigation one
        // turn to become observable before treating ERR_ABORTED as fatal.
        if (isAbortedError(err) && !replacementNavigationSeen && deferAbort) {
          if (!failureTimer) {
            failureTimer = setTimeout(() => {
              failureTimer = undefined
              handleLoadError(err, attempt, source, false)
            }, 0)
          }
          return
        }
        if (isAbortedError(err) && replacementNavigationSeen) return

        // A connection can be closed while the account chooser is being
        // brought up (common with proxy/VPN handshakes). Keep the window open
        // and retry a few times so one transient network failure does not
        // immediately abort the OAuth flow.
        if (isTransientNetworkError(err) && loadAttempt <= maxTransientRetries) {
          if (retryTimer) return
          const delay = Math.min(250 * 2 ** (loadAttempt - 1), 2000)
          trace('load-retry-scheduled', { windowId: win.id, attempt: loadAttempt, delay })
          retryTimer = setTimeout(() => {
            retryTimer = undefined
            loadAuthPage()
          }, delay)
          return
        }

        // Do not propagate Electron's raw loadURL error: its message embeds the
        // complete authorization URL, including state and PKCE parameters.
        finish(undefined, toIdentityLoadError(err))
      }

      const wc = win.webContents
      wc.on('did-finish-load', () => {
        // Ignore the BrowserWindow's initial about:blank document. Only a
        // real navigated page means it is safe to leave the current OAuth form
        // untouched if its navigation promise later reports a network error.
        const loadedUrl = wc.getURL()
        trace('did-finish-load', { windowId: win.id, url: redactIdentityUrl(loadedUrl) })
        let protocol = ''
        try {
          protocol = new URL(loadedUrl).protocol
        } catch {
          return
        }
        // Electron also emits did-finish-load for chrome-error://chromewebdata.
        // Only a real web document proves that the provider page loaded.
        if (protocol !== 'http:' && protocol !== 'https:') return
        authPageLoaded = true
        // A retry may have been queued before the first document finished
        // loading. Cancel it now so typing into Google's form is never
        // interrupted by a second load of the original URL.
        if (retryTimer) {
          clearTimeout(retryTimer)
          retryTimer = undefined
        }
      })
      wc.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
        if (isMainFrame !== false && !check(event, url) && url !== authUrl) {
          replacementNavigationSeen = true
        }
      })
      wc.on('will-navigate', (event, url) => {
        if (!check(event, url) && url !== authUrl) replacementNavigationSeen = true
      })
      wc.on('did-start-navigation', (event: any, url: string, _isInPlace, isMainFrame) => {
        if (isMainFrame !== false && typeof url === 'string') {
          trace('did-start-navigation', { windowId: win.id, url: redactIdentityUrl(url) })
          if (!check(event, url) && url !== authUrl) replacementNavigationSeen = true
        }
      })
      wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (isMainFrame === false) return
        const err = Object.assign(
          new Error(errorDescription || `Navigation failed (${errorCode})`),
          {
            code: errorDescription || '',
            errno: errorCode,
            url: validatedURL,
          },
        )
        handleLoadError(err, loadAttempt, 'did-fail-load')
      })
      win.on('closed', () => {
        trace('window-closed', { windowId: win.id })
        finish(undefined, new Error('The user did not approve access.'))
      })

      // Non-interactive: don't wait forever for a silent redirect.
      if (!interactive) {
        silentTimeout = setTimeout(
          () => finish(undefined, new Error('launchWebAuthFlow was not interactive and timed out')),
          8000,
        )
      }

      const loadAuthPage = () => {
        if (settled || win.isDestroyed()) return
        const attempt = ++loadAttempt
        replacementNavigationSeen = false
        trace('load-start', { windowId: win.id, attempt, url: redactIdentityUrl(authUrl) })
        let pendingLoad: Promise<void>
        try {
          pendingLoad = win.loadURL(authUrl)
        } catch (err) {
          handleLoadError(err, attempt, 'loadURL-sync')
          return
        }
        pendingLoad.catch((err: any) => {
          handleLoadError(err, attempt, 'loadURL')
        })
      }

      loadAuthPage()
    })
  }
}
