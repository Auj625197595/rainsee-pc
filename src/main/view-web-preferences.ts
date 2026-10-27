export type ViewSecurityKind =
  | 'sandboxed'
  | 'privileged-koodo'
  | 'privileged-extension';

const KOODO_READER_PREFIX = 'yjllq://web.koodoreader.com/';

export const getViewSecurityKind = (url: string): ViewSecurityKind => {
  const normalized = String(url || '').trim().toLowerCase();
  if (normalized.startsWith(KOODO_READER_PREFIX)) {
    return 'privileged-koodo';
  }
  if (normalized.startsWith('chrome-extension://')) {
    return 'privileged-extension';
  }
  return 'sandboxed';
};

export const isCrossViewSecurityNavigation = (
  sourceKind: ViewSecurityKind,
  targetUrl: string,
) => getViewSecurityKind(targetUrl) !== sourceKind;

export const areSandboxedTabsEnabled = () =>
  process.env.RAINSEE_SANDBOXED_TABS !== '0';

/**
 * Electron 43's built-in PDF viewer needs a non-sandboxed renderer when it is
 * hosted in a custom BrowserView session. This is only a URL hint: callers
 * must still treat the response MIME type as authoritative when it is known.
 */
export const isPdfUrl = (url: string) => {
  try {
    return new URL(String(url || '')).pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return /\.pdf(?:[?#]|$)/i.test(String(url || ''));
  }
};

// The built-in viewer is a Chromium internal extension, not an application
// extension. It is the expected main-frame URL after a PDF document starts.
export const isBuiltinPdfViewerUrl = (url: string) => {
  try {
    const parsed = new URL(String(url || ''));
    return (
      parsed.protocol === 'chrome-extension:' &&
      parsed.hostname === 'mhjfbmdgcfjbbpaeojofohoefgiehjai'
    );
  } catch {
    return false;
  }
};

export const getViewPreloadFilename = (
  securityKind: ViewSecurityKind,
  url = '',
) =>
  isBuiltinPdfViewerUrl(url)
    ? 'view-preload.bundle.js'
    : securityKind === 'privileged-extension'
    ? 'extension-view-preload.bundle.js'
    : securityKind === 'privileged-koodo' ||
      (securityKind === 'sandboxed' && !areSandboxedTabsEnabled())
    ? 'privileged-view-preload.bundle.js'
    : 'view-preload.bundle.js';

let loggedSandboxMode = false;

export const createViewWebPreferences = (
  session: Electron.Session,
  preload: string,
  _incognito: boolean,
  securityKind: ViewSecurityKind = 'sandboxed',
  pdfCompat = false,
): Electron.WebPreferences => ({
  // Keep browser tabs on the session whose network, permission, adblock, and
  // extension handlers were installed by SessionsService. PDF compatibility
  // is isolated to sandbox:false below; it must not move tabs to defaultSession.
  session,
  preload,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  allowRunningInsecureContent: true,
  contextIsolation: false,
  sandbox:
    !pdfCompat && securityKind === 'sandboxed' && areSandboxedTabsEnabled(),
  enableRemoteModule: false,
  plugins: true,
  nativeWindowOpen: true,
  webSecurity: true,
  javascript: true,
  worldSafeExecuteJavaScript: true,
});

export const logSandboxedTabsMode = () => {
  if (loggedSandboxMode) return;
  loggedSandboxMode = true;
  console.log(
    `[view-security] sandboxed tabs ${
      areSandboxedTabsEnabled()
        ? 'enabled'
        : 'disabled by RAINSEE_SANDBOXED_TABS=0'
    }`,
  );
};
