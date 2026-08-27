import {app, net} from 'electron';

const GOOGLE_PROBE_URL = 'https://www.google.com/generate_204';
const GREASYFORK_HOST = 'greasyfork.org';
const GREASYFORK_MIRROR_HOST = 'greatest.deepsurf.us';
const CHECK_INTERVAL_MS = 60_000;
const CHECK_TIMEOUT_MS = 5_000;

/** Detects Google reachability without creating a visible browser tab. */
export class GoogleConnectivityService {
  public isCanGoogle: boolean | undefined;

  private checkedAt = 0;
  private checkPromise: Promise<boolean> | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private started = false;

  public start() {
    if (this.started) return;
    this.started = true;

    app.whenReady().then(() => {
      void this.refresh(true);
      this.refreshTimer = setInterval(() => void this.refresh(true), CHECK_INTERVAL_MS);
    });

    // A focused browser window means the app has returned to the foreground.
    app.on('browser-window-focus', () => void this.refresh(true));
    app.on('activate', () => void this.refresh(true));
    app.once('will-quit', () => this.dispose());
  }

  public async getIsCanGoogle() {
    if (
      this.isCanGoogle !== undefined &&
      Date.now() - this.checkedAt < CHECK_INTERVAL_MS
    ) {
      return this.isCanGoogle;
    }
    return this.refresh();
  }

  public async refresh(force = false): Promise<boolean> {
    if (this.checkPromise) return this.checkPromise;
    if (
      !force &&
      this.isCanGoogle !== undefined &&
      Date.now() - this.checkedAt < CHECK_INTERVAL_MS
    ) {
      return this.isCanGoogle;
    }

    this.checkPromise = this.checkGoogleConnectivity();
    try {
      this.isCanGoogle = await this.checkPromise;
      this.checkedAt = Date.now();
      return this.isCanGoogle;
    } finally {
      this.checkPromise = null;
    }
  }

  public dispose() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  private async checkGoogleConnectivity(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
      // Use Chromium's network stack, including the browser's proxy configuration.
      const response = await net.fetch(GOOGLE_PROBE_URL, {
        cache: 'no-store',
        signal: controller.signal,
      });
      return response.status === 204;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const isGreasyforkUrl = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === GREASYFORK_HOST ||
        url.hostname.endsWith(`.${GREASYFORK_HOST}`))
    );
  } catch {
    return false;
  }
};

export const getGreasyforkMirrorUrl = (rawUrl: string) => {
  if (!isGreasyforkUrl(rawUrl)) return rawUrl;
  const url = new URL(rawUrl);
  url.protocol = 'https:';
  url.hostname = GREASYFORK_MIRROR_HOST;
  return url.toString();
};

export const isGreasyforkMirrorUrl = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname === GREASYFORK_MIRROR_HOST
    );
  } catch {
    return false;
  }
};

/** Convert the mirror's physical URL to the address shown by the browser UI. */
export const getGreasyforkDisplayUrl = (rawUrl: string) => {
  if (!isGreasyforkMirrorUrl(rawUrl)) return rawUrl;
  const url = new URL(rawUrl);
  url.protocol = 'https:';
  url.hostname = GREASYFORK_HOST;
  return url.toString();
};
