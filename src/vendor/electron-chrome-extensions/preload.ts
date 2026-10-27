import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { injectExtensionAPIs } from './renderer'
import { ERROR_PROTOCOL, WEBUI_BASE_URL, WEBUI_PROTOCOL } from '~/constants/files'

// ===== Chrome semantics: normal web pages must not see Node globals ==========
// This preload runs in EVERY frame of every page (session frame preload). In a
// non-sandboxed renderer (sandbox:false) that preload world carries Node's
// `process` (verified: process.versions.node present) even though the page MAIN
// world and isolated worlds do not. Every script this preload later executes
// locally — the `crx-execute-isolated-script` (0,eval) fallback and the
// document_start `Function(code)()` fallback — therefore runs where UMD
// libraries (js-md5@0.7.3: `typeof process==='object' &&
// process.versions.node`, no process.type guard) misdetect Node and die on
// eval("require('crypto')") → "require is not defined", killing the whole
// userscript bundle (Tampermonkey + LinkSwift).
//
// Scrub the Node globals from THIS shared world before any such script runs.
// Exemptions (kept in lockstep with view-preload's list and
// browser/api/common.ts isBrowserInternalUrl):
//   - chrome-extension:// pages & service workers (injectExtensionAPIs and the
//     extension shim legitimately run here; Electron native semantics stay);
//   - the browser's internal pages (WEBUI / error protocol / devtools) and
//     about:blank — trusted UI code may probe its environment.
// The preload's own code never touches these globals afterwards (ipcRenderer /
// webFrame are captured imports; the runtime `process` reads below use the
// captured __crxNodeProcess reference).
const __crxNodeProcess = process
const __crxPreloadGlobal = globalThis as any
const __crxIsBuiltinPdfViewer = (() => {
  try {
    return (
      typeof location !== 'undefined' &&
      location.protocol === 'chrome-extension:' &&
      location.hostname === 'mhjfbmdgcfjbbpaeojofohoefgiehjai'
    )
  } catch {
    return false
  }
})()
try {
  let exempt = false
  if (typeof location !== 'undefined') {
    exempt =
      location.href.startsWith('chrome-extension://') ||
      location.href.startsWith('devtools://') ||
      location.href.startsWith('chrome://') ||
      location.href.startsWith(WEBUI_BASE_URL) ||
      location.protocol === `${WEBUI_PROTOCOL}:` ||
      location.protocol === `${ERROR_PROTOCOL}:` ||
      location.href === 'about:blank'
  }
  const isWorker = typeof window === 'undefined' || __crxNodeProcess.type === 'service-worker'
  if (!exempt && !isWorker) {
    for (const name of ['process', 'Buffer', 'setImmediate', 'clearImmediate', 'global']) {
      try {
        delete (globalThis as any)[name]
      } catch {
        /* best-effort */
      }
      if ((globalThis as any)[name] !== undefined) {
        try {
          Object.defineProperty(globalThis, name, {
            configurable: true,
            writable: true,
            enumerable: false,
            value: undefined,
          })
        } catch {
          /* best-effort */
        }
      }
    }
  }
} catch {
  /* the scrub must never break the preload */
}

// Normal web pages also receive this registered frame preload. It is the only
// reliable way to execute a dynamic script in a child frame without falling
// back to the page's MAIN world.
if (!__crxPreloadGlobal.__crxIsolatedScriptListenerInstalled) {
  __crxPreloadGlobal.__crxIsolatedScriptListenerInstalled = true
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
}

// A frame preload runs before Blink has necessarily inserted the document's
// root element. Chrome's document_start scripts, however, run after the
// document element exists (and before page scripts). Submit the script to its
// target world now, but let that world wait for the first root insertion when
// needed. Observing the Document preserves parser ordering: the observer runs
// at the mutation checkpoint before a later parser-inserted page script.
const wrapDocumentStartCode = (source: string) => `
;(() => {
  const run = () => {
${source}
  };
  if (document.documentElement) {
    run();
    return;
  }
  const observer = new MutationObserver(() => {
    if (!document.documentElement) return;
    observer.disconnect();
    run();
  });
  observer.observe(document, { childList: true });
})();
`

// document_start must be submitted from preload time; did-frame-navigate is
// already too late for extensions that patch page primitives before site JS.
try {
  if (typeof window !== 'undefined' && !location.href.startsWith('chrome-extension://')) {
    // senderFrame.url can still be empty while a new document's preload is
    // running. The renderer already has the committed target URL, so pass it
    // explicitly to keep document_start matching from missing the first load.
    const payload =
      ipcRenderer.sendSync('crx-get-document-start-scripts', location.href) || {}
    const scripts = Array.isArray(payload.isolated) ? payload.isolated : []
    if (scripts.length) {
      const g = globalThis as any
      if (!g.electron) g.electron = { ipcRenderer }
      for (const payload of scripts) {
        try {
          const source = typeof payload === 'string' ? payload : payload?.code
          const worldId = typeof payload === 'object' ? payload?.worldId : undefined
          if (typeof source !== 'string') continue
          const code = wrapDocumentStartCode(source)
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
        } catch (error) {
          // Chrome isolates failures between registered content scripts.
          console.error('[crx-isolated] document-start script failed', error)
        }
      }
    }
    const mainScripts = Array.isArray(payload.main) ? payload.main : []
    for (const source of mainScripts) {
      if (typeof source !== 'string') continue
      try {
        const code = wrapDocumentStartCode(source)
        if (__crxNodeProcess.contextIsolated && 'executeInMainWorld' in contextBridge) {
          ;(contextBridge as any).executeInMainWorld({
            func: (source: string) => Function(source)(),
            args: [code],
          })
        } else {
          Function(code)()
        }
      } catch (error) {
        console.error('[crx-main] document-start script failed', error)
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
  if (typeof window === 'undefined' || __crxNodeProcess.type === 'service-worker') {
    console.log(`[crx-preload] loaded: process.type=${__crxNodeProcess.type}`)
  }
} catch (e) {
  // ignore
}
if (!__crxPreloadGlobal.__crxPreloadTopReported) {
  __crxPreloadGlobal.__crxPreloadTopReported = true
  beacon(
    `preload-top type=${__crxNodeProcess.type} href=${
      typeof location !== 'undefined' ? location.href : '<none>'
    } hasWindow=${typeof window !== 'undefined'}`,
  )
}

// Only load within hosted extension contexts. Chromium's built-in PDF viewer
// owns native private bindings and must not receive this host's synthesized
// third-party chrome.* surface merely because its URL uses the same scheme.
if (
  __crxNodeProcess.type === 'service-worker' ||
  (location.href.startsWith('chrome-extension://') && !__crxIsBuiltinPdfViewer)
) {
  // Idempotency guard. crx-preload is registered BOTH as a session preload
  // (registerPreloadScript, frame/service-worker type) AND — for contexts where
  // that delivery is unreliable (popup/options renderers co-sited with a
  // sandboxed host get `binding.startupData === null` and skip the session
  // preload) — as a classic webPreferences.preload on the popup window. When
  // both paths land in the same renderer, injectExtensionAPIs() must run ONCE:
  // a second pass re-installs chrome.* (double event listeners, duplicated
  // contextBridge surface). The flag is set before inject so a concurrently-
  // scheduled second preload sees it.
  const g = __crxPreloadGlobal
  if (g.__crxApisInjected) {
    beacon('inject-skip already-injected')
  } else {
    g.__crxApisInjected = true
    beacon(`inject-call type=${__crxNodeProcess.type}`)
    injectExtensionAPIs()
    beacon(`inject-return type=${__crxNodeProcess.type}`)
  }
}
