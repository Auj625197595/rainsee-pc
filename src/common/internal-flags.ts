const INTERNAL_FLAGS_PATTERN =
  /^(chrome:\/\/flags|yjllq:\/\/flags)([/?#].*)?$/i;

/** Resolve supported flags aliases to one canonical internal-page URL. */
export const resolveInternalFlagsUrl = (
  url: string,
  flagsPageUrl: string,
): string => {
  if (!url || !flagsPageUrl) return '';

  const match = INTERNAL_FLAGS_PATTERN.exec(url);
  if (!match) return '';

  const base = `${flagsPageUrl.replace(/\/+$/, '')}/`;
  const suffix = (match[2] || '').replace(/^\/+/, '');
  return `${base}${suffix}`;
};

/** Return a redirect only when canonicalization actually changes the URL. */
export const getInternalFlagsRedirectTarget = (
  url: string,
  flagsPageUrl: string,
): string => {
  const target = resolveInternalFlagsUrl(url, flagsPageUrl);
  if (!target || target.toLowerCase() === url.toLowerCase()) return '';
  return target;
};
