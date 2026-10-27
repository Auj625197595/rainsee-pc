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

const INTERNAL_APPS_PATTERN =
  /^(chrome:\/\/apps|edge:\/\/apps|yjllq:\/\/apps)([/?#].*)?$/i;

/** chrome://apps / yjllq://apps 是设置页「应用」分区的别名。 */
export const resolveInternalAppsUrl = (
  url: string,
  settingsPageUrl: string,
): string => {
  if (!url || !settingsPageUrl || !INTERNAL_APPS_PATTERN.test(url)) return '';
  return `${settingsPageUrl.replace(/[?#].*$/, '')}#apps`;
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
