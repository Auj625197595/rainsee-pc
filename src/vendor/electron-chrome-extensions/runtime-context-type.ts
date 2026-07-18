/**
 * chrome.runtime.ContextType values exposed to extensions.
 *
 * The first six keys mirror Chromium's canonical enum exactly (Chrome 114+).
 * The remaining keys (ALL / CONTENT_SCRIPT / SERVICE_WORKER / PANEL) are
 * NON-STANDARD compatibility aliases — real Chrome does NOT define them — kept
 * so legacy extensions and webext-polyfills that reference them don't throw on
 * property access. They form a harmless superset: getContexts() only honors the
 * canonical six. Plain enumerable (not non-enumerable) so the value survives
 * every injection path uniformly — SHIM JSON.stringify, contextBridge arg
 * structured-clone, and the direct main-world call.
 */
export const RUNTIME_CONTEXT_TYPE = Object.freeze({
  TAB: 'TAB',
  POPUP: 'POPUP',
  BACKGROUND: 'BACKGROUND',
  OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT',
  SIDE_PANEL: 'SIDE_PANEL',
  DEVELOPER_TOOLS: 'DEVELOPER_TOOLS',
  // Non-standard compat aliases (real Chrome omits these).
  ALL: 'ALL',
  CONTENT_SCRIPT: 'CONTENT_SCRIPT',
  SERVICE_WORKER: 'SERVICE_WORKER',
  PANEL: 'PANEL',
} as const)

export type RuntimeContextTypeMap = typeof RUNTIME_CONTEXT_TYPE
