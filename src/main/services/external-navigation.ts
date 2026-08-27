import {getSingledHost} from '~/utils/url';

export interface ExternalNavigationDetails {
  sourceUrl: string;
  sourceHost: string;
  targetUrl: string;
  targetHost: string;
}

export const getExternalNavigationDetails = (
  sourceUrl: string,
  targetUrl: string,
): ExternalNavigationDetails | null => {
  let source: URL;
  let target: URL;
  try {
    source = new URL(sourceUrl);
    target = new URL(targetUrl);
  } catch {
    return null;
  }

  if (!/^https?:$/.test(source.protocol) || !/^https?:$/.test(target.protocol)) {
    return null;
  }

  if (
    source.hostname === target.hostname ||
    getSingledHost(source.hostname) === getSingledHost(target.hostname)
  ) {
    return null;
  }

  return {
    sourceUrl: source.href,
    sourceHost: source.hostname,
    targetUrl: target.href,
    targetHost: target.hostname,
  };
};
