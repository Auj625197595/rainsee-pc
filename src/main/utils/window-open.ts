import type { HandlerDetails, LoadURLOptions } from 'electron';

import { postBodyToLoadOptions } from './post-body';

/**
 * Preserve the navigation metadata Chromium calculated for window.open and
 * target=_blank when the host recreates that navigation in a BrowserView.
 */
export function windowOpenToLoadOptions(
  details: Pick<HandlerDetails, 'postBody' | 'referrer'>,
): LoadURLOptions {
  const options = postBodyToLoadOptions(details.postBody) ?? {};

  // Pass the structured referrer through so Chromium still applies its policy.
  options.httpReferrer = { ...details.referrer };
  return options;
}
