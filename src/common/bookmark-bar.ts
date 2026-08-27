import { BookmarkBarDisplay } from '~/interfaces';

export const normalizeBookmarkBarDisplay = (
  value: unknown,
  legacyVisible: unknown = true,
): BookmarkBarDisplay => {
  if (value === 'always' || value === 'newtab' || value === 'never') {
    return value;
  }

  return legacyVisible === false ? 'never' : 'always';
};

export const shouldShowBookmarkBar = (
  display: BookmarkBarDisplay,
  currentUrl: string,
  newTabUrl: string,
): boolean => {
  if (display === 'always') return true;
  if (display === 'never' || !currentUrl || !newTabUrl) return false;

  try {
    const current = new URL(currentUrl);
    const newTab = new URL(newTabUrl);
    const normalizePath = (path: string) => path.replace(/\/+$/, '') || '/';
    return (
      current.protocol === newTab.protocol &&
      current.host === newTab.host &&
      normalizePath(current.pathname) === normalizePath(newTab.pathname)
    );
  } catch {
    return currentUrl === newTabUrl;
  }
};
