import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { injectExtensionAPIs } from './renderer'

// Normal web pages also receive this registered frame preload. It is the only
// reliable way to execute a dynamic script in a child frame without falling
// back to the page's MAIN world.
ipcRenderer.on(
  'crx-execute-isolated-script',
  (_event, payload: { code?: string; extensionId?: string; worldId?: number }) => {
    if (!payload || typeof payload.code !== 'string') return
    try {
      if (
        typeof payload.worldId === 'number' &&
        typeof (webFrame as any).executeJavaScriptInIsolatedWorld === 'function'
      ) {
        void (webFrame as any)
          .executeJavaScriptInIsolatedWorld(
            payload.worldId,
            [{ code: payload.code }],
            true,
          )
          .catch((error: unknown) =>
            console.error(
              `[crx-isolated] script failed for ${payload.extensionId || 'unknown'}`,
              error,
            ),
          )
      } else {
        const g = globalThis as any
        if (!g.electron) g.electron = { ipcRenderer }
        ;(0, eval)(payload.code)
      }
    } catch (error) {
      console.error(`[crx-isolated] script failed for ${payload.extensionId || 'unknown'}`, error)
    }
  },
)

// document_start must run from preload time; did-frame-navigate is already too
// late for extensions that patch page primitives before site JavaScript.
try {
  if (typeof window !== 'undefined' && !location.href.startsWith('chrome-extension://')) {
    const payload = ipcRenderer.sendSync('crx-get-document-start-scripts') || {}
    const scripts = Array.isArray(payload.isolated) ? payload.isolated : []
    if (scripts.length) {
      const g = globalThis as any
      if (!g.electron) g.electron = { ipcRenderer }
      for (const payload of scripts) {
        const code = typeof payload === 'string' ? payload : payload?.code
        const worldId = typeof payload === 'object' ? payload?.worldId : undefined
        if (typeof code !== 'string') continue
        if (
          typeof worldId === 'number' &&
          typeof (webFrame as any).executeJavaScriptInIsolatedWorld === 'function'
        ) {
          void (webFrame as any)
            .executeJavaScriptInIsolatedWorld(
              worldId,
              [{ code }],
              true,
            )
            .catch((error: unknown) =>
              console.error('[crx-isolated] document-start script failed', error),
            )
        } else {
          Function(code)()
        }
      }
    }
    const mainScripts = Array.isArray(payload.main) ? payload.main : []
    for (const code of mainScripts) {
      if (typeof code !== 'string') continue
      if (process.contextIsolated && 'executeInMainWorld' in contextBridge) {
        ;(contextBridge as any).executeInMainWorld({
          func: (source: string) => Function(source)(),
          args: [code],
        })
      } else {
        Function(code)()
      }
    }
  }
} catch (error) {
  console.error('[crx-isolated] document_start failed', error)
}

const beacon = (msg: string) => {
  try {
    ipcRenderer.send('crx-beacon', msg)
  } catch {
    // ignore
  }
}

try {
  if (typeof window === 'undefined' || process.type === 'service-worker') {
    console.log(`[crx-preload] loaded: process.type=${process.type}`)
  }
} catch (e) {
  // ignore
}
beacon(
  `preload-top type=${process.type} href=${
    typeof location !== 'undefined' ? location.href : '<none>'
  } hasWindow=${typeof window !== 'undefined'}`,
)

// Only load within extension page context
if (process.type === 'service-worker' || location.href.startsWith('chrome-extension://')) {
  // Idempotency guard. crx-preload is registered BOTH as a session preload
  // (registerPreloadScript, frame/service-worker type) AND — for contexts where
  // that delivery is unreliable (popup/options renderers co-sited with a
  // sandboxed host get `binding.startupData === null` and skip the session
  // preload) — as a classic webPreferences.preload on the popup window. When
  // both paths land in the same renderer, injectExtensionAPIs() must run ONCE:
  // a second pass re-installs chrome.* (double event listeners, duplicated
  // contextBridge surface). The flag is set before inject so a concurrently-
  // scheduled second preload sees it.
  const g = globalThis as any
  if (g.__crxApisInjected) {
    beacon('inject-skip already-injected')
  } else {
    g.__crxApisInjected = true
    beacon(`inject-call type=${process.type}`)
    injectExtensionAPIs()
    beacon(`inject-return type=${process.type}`)
  }
}
