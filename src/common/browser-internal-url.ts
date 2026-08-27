export const BROWSER_INTERNAL_PAGES = [
  'bookmarks',
  'downloads',
  'extensions',
  'flags',
  'history',
  'settings',
] as const;

export type BrowserInternalPage = typeof BROWSER_INTERNAL_PAGES[number];

export interface BrowserInternalLocation {
  page: BrowserInternalPage;
  suffix: string;
}

const PAGE_SET = new Set<string>(BROWSER_INTERNAL_PAGES);

export const parseBrowserInternalUrl = (
  value: unknown,
): BrowserInternalLocation | null => {
  if (typeof value !== 'string') return null;
  const rawUrl = value.trim();
  if (!rawUrl || rawUrl.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== 'chrome:' && url.protocol !== 'edge:') return null;
  if (url.username || url.password || url.port) return null;

  const page = url.hostname.toLowerCase();
  if (!PAGE_SET.has(page) || (url.pathname && url.pathname !== '/')) return null;

  return {
    page: page as BrowserInternalPage,
    suffix: `${url.search}${url.hash}`,
  };
};
