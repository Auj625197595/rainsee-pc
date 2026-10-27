import { BrowserWindow, ipcMain, WebContents } from 'electron';
import { isIP } from 'net';
import { connect as connectTls } from 'tls';

import { DIALOG_MARGIN, DIALOG_MARGIN_TOP } from '~/constants/design';
import { IPermissionRecord } from '~/interfaces';
import { getSingledHost } from '~/utils/url';
import { PersistentDialog } from './dialog';
import { Application } from '../application';
import { getMainTranslator } from '../i18n';

const WIDTH = 380;
const MIN_HEIGHT = 240;
const MAX_HEIGHT = 470;
const WINDOW_GAP = 8;

export interface SiteInfoDialogData {
  title: string;
  url: string;
  host: string;
  protocol: string;
  secure: boolean;
  cookies: SiteCookieData[];
  certificate: SiteCertificateData | null;
  permissions: IPermissionRecord[];
}

export interface SiteCookieData {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  hostOnly: boolean;
  session: boolean;
  sameSite: string;
  expirationDate?: number;
}

export interface SiteCookieSaveResult {
  ok: boolean;
  error?: 'noTarget' | 'name' | 'value' | 'domain' | 'set';
  cookies: SiteCookieData[];
}

const SAME_SITE_VALUES = new Set([
  'unspecified',
  'no_restriction',
  'lax',
  'strict',
]);

export interface SiteCertificateData {
  subjectName: string;
  issuerName: string;
  validStart: number;
  validExpiry: number;
  serialNumber: string;
  fingerprint: string;
  protocol: string;
  cipher: string;
  authorized: boolean;
  authorizationError: string;
}

const hostFromValue = (value: string) => {
  const input = String(value || '').trim();
  if (!input) return '';
  try {
    return new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`,
    ).hostname.toLowerCase();
  } catch {
    return '';
  }
};

const toCookieData = (cookie: Electron.Cookie): SiteCookieData => ({
  name: cookie.name,
  value: cookie.value,
  domain: cookie.domain || '',
  path: cookie.path || '/',
  secure: !!cookie.secure,
  httpOnly: !!cookie.httpOnly,
  hostOnly: !!cookie.hostOnly,
  session: !!cookie.session,
  sameSite: cookie.sameSite || 'unspecified',
  expirationDate: cookie.expirationDate,
});

const readCertificate = (
  rawUrl: string,
): Promise<SiteCertificateData | null> => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return Promise.resolve(null);
  }
  if (parsed.protocol !== 'https:') return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: SiteCertificateData | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const socket = connectTls(
      {
        host: parsed.hostname,
        port: Number(parsed.port) || 443,
        servername: isIP(parsed.hostname) ? undefined : parsed.hostname,
        rejectUnauthorized: false,
      },
      () => {
        const certificate = socket.getPeerCertificate(true) as any;
        if (!certificate || !Object.keys(certificate).length) {
          finish(null);
          return;
        }
        const cipher = socket.getCipher();
        finish({
          subjectName:
            certificate.subject?.CN ||
            certificate.subjectaltname ||
            parsed.hostname,
          issuerName: certificate.issuer?.CN || '',
          validStart: Date.parse(certificate.valid_from || '') / 1000 || 0,
          validExpiry: Date.parse(certificate.valid_to || '') / 1000 || 0,
          serialNumber: certificate.serialNumber || '',
          fingerprint:
            certificate.fingerprint256 || certificate.fingerprint || '',
          protocol: socket.getProtocol() || '',
          cipher: cipher?.name || '',
          authorized: socket.authorized,
          authorizationError: socket.authorizationError
            ? String(socket.authorizationError)
            : '',
        });
      },
    );
    socket.setTimeout(2500, () => finish(null));
    socket.once('error', () => finish(null));
  });
};

export class SiteInfoDialog extends PersistentDialog {
  private pos = { x: 0, y: 0 };
  private contentHeight = 280;
  private targetWebContents: WebContents | null = null;
  private currentUrl = '';
  private currentCookies: SiteCookieData[] = [];

  public constructor() {
    super({
      name: 'site-info',
      bounds: { width: WIDTH, height: MAX_HEIGHT },
    });

    const resizeChannel = `resize-site-info-${this.id}`;
    this.ipcChannels.push(resizeChannel);
    ipcMain.on(resizeChannel, (_event, height: number) => {
      if (!Number.isFinite(Number(height))) return;
      this.contentHeight = Math.min(
        MAX_HEIGHT,
        Math.max(MIN_HEIGHT, Math.ceil(Number(height))),
      );
      this.rearrange();
    });
  }

  public rearrange() {
    const windowBounds = this.browserWindow?.getContentBounds();
    const width = WIDTH + 2 * DIALOG_MARGIN;
    const y = Math.max(WINDOW_GAP, this.pos.y - DIALOG_MARGIN_TOP);
    const height = Math.min(
      this.contentHeight + 2 * DIALOG_MARGIN,
      Math.max(
        MIN_HEIGHT,
        (windowBounds?.height || MAX_HEIGHT) - y - WINDOW_GAP,
      ),
    );
    const maxX = Math.max(
      WINDOW_GAP,
      (windowBounds?.width || width) - width - WINDOW_GAP,
    );

    super.rearrange({
      x: Math.min(Math.max(WINDOW_GAP, this.pos.x - DIALOG_MARGIN), maxX),
      y,
      width,
      height,
    });
  }

  private onBoundsUpdate = () => this.hide();

  private async readCookies() {
    const target = this.targetWebContents;
    if (!target || target.isDestroyed() || !this.currentUrl) return [];
    try {
      const cookies = await target.session.cookies.get({
        url: this.currentUrl,
      });
      this.currentCookies = cookies.map(toCookieData);
    } catch {
      this.currentCookies = [];
    }
    return this.currentCookies;
  }

  private cookieRemovalUrl(cookie: SiteCookieData) {
    const host =
      cookie.domain.replace(/^\./, '') || hostFromValue(this.currentUrl);
    let protocol = cookie.secure ? 'https:' : 'http:';
    try {
      const currentProtocol = new URL(this.currentUrl).protocol;
      if (currentProtocol === 'http:' || currentProtocol === 'https:') {
        protocol = cookie.secure ? 'https:' : currentProtocol;
      }
    } catch {
      // 使用上面的协议兜底。
    }
    const path = cookie.path.startsWith('/') ? cookie.path : `/${cookie.path}`;
    return `${protocol}//${host}${path}`;
  }

  public async removeCookie(cookie: SiteCookieData) {
    const target = this.targetWebContents;
    if (!target || target.isDestroyed()) return [];
    const existing = this.currentCookies.find(
      (item) =>
        item.name === cookie?.name &&
        item.domain === cookie?.domain &&
        item.path === cookie?.path,
    );
    if (!existing) return this.currentCookies;
    await target.session.cookies.remove(
      this.cookieRemovalUrl(existing),
      existing.name,
    );
    return this.readCookies();
  }

  /**
   * 新增或编辑 Cookie。original 为空表示新增；名称/域/路径变化时先删旧条目，
   * 避免改名后新旧两条并存。domain 不带前导点且等于当前主机名时按 hostOnly 写入。
   */
  public async saveCookie(
    original: SiteCookieData | null,
    cookie: SiteCookieData,
  ): Promise<SiteCookieSaveResult> {
    const fail = (error: SiteCookieSaveResult['error']) => ({
      ok: false,
      error,
      cookies: this.currentCookies,
    });
    const target = this.targetWebContents;
    if (!target || target.isDestroyed()) return fail('noTarget');
    let pageUrl: URL;
    try {
      pageUrl = new URL(this.currentUrl);
    } catch {
      return fail('noTarget');
    }
    if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') {
      return fail('noTarget');
    }

    const name = String(cookie?.name ?? '').trim();
    const value = String(cookie?.value ?? '');
    if (!name || /[\s;=,]/.test(name)) return fail('name');
    if (/[;\r\n]/.test(value)) return fail('value');

    const pageHost = pageUrl.hostname.toLowerCase();
    const rawDomain =
      String(cookie?.domain ?? '').trim().toLowerCase() || pageHost;
    const bareDomain = rawDomain.replace(/^\./, '');
    // 只允许当前主机或其父域，否则写入后当前页面也读不到。
    if (
      !bareDomain ||
      (pageHost !== bareDomain && !pageHost.endsWith(`.${bareDomain}`))
    ) {
      return fail('domain');
    }
    const hostOnly = !rawDomain.startsWith('.') && bareDomain === pageHost;

    let path = String(cookie?.path ?? '').trim() || '/';
    if (!path.startsWith('/')) path = `/${path}`;

    const sameSite = (
      SAME_SITE_VALUES.has(cookie?.sameSite) ? cookie.sameSite : 'unspecified'
    ) as Electron.CookiesSetDetails['sameSite'];
    // Chromium 拒绝非 Secure 的 SameSite=None。
    const secure = !!cookie?.secure || sameSite === 'no_restriction';
    const expirationDate = Number(cookie?.expirationDate);

    const details: Electron.CookiesSetDetails = {
      url: `${secure ? 'https:' : pageUrl.protocol}//${bareDomain}${path}`,
      name,
      value,
      path,
      secure,
      httpOnly: !!cookie?.httpOnly,
      sameSite,
    };
    if (!hostOnly) details.domain = `.${bareDomain}`;
    if (!cookie?.session && expirationDate > 0) {
      details.expirationDate = expirationDate;
    }

    const existing = original
      ? this.currentCookies.find(
          (item) =>
            item.name === original.name &&
            item.domain === original.domain &&
            item.path === original.path,
        )
      : undefined;

    try {
      if (
        existing &&
        (existing.name !== name ||
          existing.path !== path ||
          existing.hostOnly !== hostOnly ||
          existing.domain.replace(/^\./, '') !== bareDomain)
      ) {
        await target.session.cookies.remove(
          this.cookieRemovalUrl(existing),
          existing.name,
        );
      }
      await target.session.cookies.set(details);
    } catch (error) {
      console.warn('[site-info] set cookie failed', error);
      return { ok: false, error: 'set', cookies: await this.readCookies() };
    }
    return { ok: true, cookies: await this.readCookies() };
  }

  public async clearCookies() {
    const target = this.targetWebContents;
    if (!target || target.isDestroyed()) return [];
    const cookies = [...this.currentCookies];
    await Promise.all(
      cookies.map((cookie) =>
        target.session.cookies.remove(
          this.cookieRemovalUrl(cookie),
          cookie.name,
        ),
      ),
    );
    return this.readCookies();
  }

  public async getSessionCookieHost() {
    const cookies = await this.readCookies();
    if (!cookies.some((cookie) => cookie.session)) return '';
    return getSingledHost(this.currentUrl);
  }

  public getTargetWebContents() {
    const target = this.targetWebContents;
    return target && !target.isDestroyed() ? target : null;
  }

  private async getData(webContents: WebContents): Promise<SiteInfoDialogData> {
    const url = webContents?.getURL() || '';
    let host = '';
    let protocol = '';
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
      protocol = parsed.protocol.replace(':', '');
    } catch {
      host = '';
      protocol = '';
    }

    this.targetWebContents = webContents;
    this.currentUrl = url;
    const cookies =
      host && (protocol === 'http' || protocol === 'https')
        ? await this.readCookies()
        : [];

    let permissions: IPermissionRecord[] = [];
    if (host) {
      try {
        const records =
          await Application.instance.storage.find<IPermissionRecord>({
            scope: 'permissions',
            query: {},
          });
        permissions = records.filter(
          (record) => hostFromValue(record.url) === host.toLowerCase(),
        );
      } catch {
        permissions = [];
      }
    }

    return {
      title: webContents?.getTitle() || host || url,
      url,
      host: host || url || getMainTranslator(Application.instance.settings?.object?.language)('siThisPage'),
      protocol,
      secure: protocol === 'https',
      cookies,
      certificate: null,
      permissions,
    };
  }

  public async open(
    browserWindow: BrowserWindow,
    webContents: WebContents,
    x: number,
    y: number,
  ) {
    this.pos = { x, y };
    const data = await this.getData(webContents);
    this.contentHeight = Math.min(
      MAX_HEIGHT,
      260 + Math.min(data.permissions.length, 3) * 48,
    );
    if (!(await super.show(browserWindow, true))) return;

    browserWindow.removeListener('resize', this.onBoundsUpdate);
    browserWindow.removeListener('move', this.onBoundsUpdate);
    browserWindow.on('resize', this.onBoundsUpdate);
    browserWindow.on('move', this.onBoundsUpdate);

    this.send('visible', true, data);
    if (data.secure) {
      const openedUrl = data.url;
      void readCertificate(openedUrl)
        .catch(() => null)
        .then((certificate) => {
          if (this.visible && this.currentUrl === openedUrl) {
            this.send('site-info-certificate', certificate);
          }
        });
    }
  }

  public hide(bringToTop = false) {
    super.hide(bringToTop);
    if (this.browserWindow) {
      this.browserWindow.removeListener('resize', this.onBoundsUpdate);
      this.browserWindow.removeListener('move', this.onBoundsUpdate);
    }
  }
}
