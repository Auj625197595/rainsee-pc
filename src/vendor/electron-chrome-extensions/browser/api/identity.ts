import { BrowserWindow } from 'electron'

import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

/**
 * Minimal `chrome.identity` implementation.
 *
 * `launchWebAuthFlow` opens the auth URL in a window and resolves with the
 * final redirect URL once the browser navigates to the extension's
 * `https://<id>.chromiumapp.org/*` redirect target — enough for the OAuth
 * implicit / PKCE flows most extensions use. The auth window shares the
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
  ): Promise<string | undefined> {
    const authUrl = details?.url
    if (!authUrl) throw new Error('launchWebAuthFlow requires a url')
    const redirectPrefix = `https://${extension.id}.chromiumapp.org/`
    const interactive = details.interactive !== false

    return new Promise<string | undefined>((resolve, reject) => {
      let settled = false
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

      const finish = (result?: string, err?: Error) => {
        if (settled) return
        settled = true
        try {
          if (!win.isDestroyed()) win.destroy()
        } catch {
          /* best-effort */
        }
        if (err) reject(err)
        else resolve(result)
      }

      // Intercept the navigation to the extension's chromiumapp.org redirect
      // target (which never actually resolves) and hand the full URL — including
      // the OAuth `#access_token=...` / `?code=...` fragment — back to the caller.
      const check = (url: string) => {
        if (typeof url === 'string' && url.startsWith(redirectPrefix)) {
          finish(url)
          return true
        }
        return false
      }

      const wc = win.webContents
      wc.on('will-redirect', (_e, url) => check(url))
      wc.on('will-navigate', (_e, url) => check(url))
      wc.on('did-start-navigation', (_e: any, url: string) => {
        if (typeof url === 'string') check(url)
      })
      win.on('closed', () =>
        finish(undefined, new Error('The user did not approve access.')),
      )

      // Non-interactive: don't wait forever for a silent redirect.
      if (!interactive) {
        setTimeout(
          () => finish(undefined, new Error('launchWebAuthFlow was not interactive and timed out')),
          8000,
        )
      }

      win.loadURL(authUrl).catch((err) => finish(undefined, err))
    })
  }
}
