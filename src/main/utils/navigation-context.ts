/**
 * Normalized navigation metadata shared by every main-process navigation gate.
 * Electron 43 exposes these fields on the event object while older releases
 * also pass them as deprecated positional arguments. Keeping the fallback in
 * one place prevents frame-sensitive policies from drifting apart.
 */
export interface NavigationContext {
  url: string;
  isSameDocument: boolean;
  isMainFrame: boolean;
}

export const getNavigationContext = (
  event: unknown,
  legacyUrl?: unknown,
  legacyIsSameDocument?: unknown,
  legacyIsMainFrame?: unknown,
): NavigationContext => {
  const details = (event && typeof event === 'object' ? event : {}) as Record<
    string,
    unknown
  >;
  return {
    url:
      typeof details.url === 'string'
        ? details.url
        : typeof legacyUrl === 'string'
          ? legacyUrl
          : '',
    isSameDocument:
      typeof details.isSameDocument === 'boolean'
        ? details.isSameDocument
        : typeof legacyIsSameDocument === 'boolean'
          ? legacyIsSameDocument
          : false,
    // Navigation events are main-frame events by default in older Electron
    // versions; did-start-navigation/will-redirect provide an explicit value.
    isMainFrame:
      typeof details.isMainFrame === 'boolean'
        ? details.isMainFrame
        : typeof legacyIsMainFrame === 'boolean'
          ? legacyIsMainFrame
          : true,
  };
};
