import { clipboard, ipcRenderer } from 'electron';
import { makeObservable, observable } from 'mobx';

import { IPermissionRecord } from '~/interfaces';
import { DialogStore } from '~/models/dialog-store';
import { getWebUIURL } from '~/common/webui';

export interface SiteInfoData {
  title: string;
  url: string;
  host: string;
  protocol: string;
  secure: boolean;
  cookies: SiteCookieData[];
  certificate: SiteCertificateData | null;
  certificatePending: boolean;
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

export type CookieExportFormat = 'json' | 'header' | 'netscape';

export type CookieSaveError = 'noTarget' | 'name' | 'value' | 'domain' | 'set';

// 字段与 Cookie-Editor / EditThisCookie 的 JSON 导出一致，便于互相导入。
const toExportJson = (cookies: SiteCookieData[]) =>
  JSON.stringify(
    cookies.map((cookie) => ({
      domain: cookie.domain,
      ...(cookie.session ? {} : { expirationDate: cookie.expirationDate }),
      hostOnly: cookie.hostOnly,
      httpOnly: cookie.httpOnly,
      name: cookie.name,
      path: cookie.path,
      sameSite: cookie.sameSite,
      secure: cookie.secure,
      session: cookie.session,
      storeId: null as string | null,
      value: cookie.value,
    })),
    null,
    2,
  );

const toHeaderString = (cookies: SiteCookieData[]) =>
  cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');

// curl / wget / yt-dlp 通用的 cookies.txt 格式。
const toNetscape = (cookies: SiteCookieData[]) =>
  [
    '# Netscape HTTP Cookie File',
    '# https://curl.se/docs/http-cookies.html',
    '',
    ...cookies.map((cookie) => {
      const domain =
        !cookie.hostOnly && !cookie.domain.startsWith('.')
          ? `.${cookie.domain}`
          : cookie.domain;
      return [
        cookie.httpOnly ? `#HttpOnly_${domain}` : domain,
        cookie.hostOnly ? 'FALSE' : 'TRUE',
        cookie.path || '/',
        cookie.secure ? 'TRUE' : 'FALSE',
        cookie.session ? 0 : Math.floor(cookie.expirationDate || 0),
        cookie.name,
        cookie.value,
      ].join('\t');
    }),
    '',
  ].join('\n');

const EMPTY_DATA: SiteInfoData = {
  title: '',
  url: '',
  host: '',
  protocol: '',
  secure: false,
  cookies: [],
  certificate: null,
  certificatePending: false,
  permissions: [],
};

const recordQuery = (record: IPermissionRecord) =>
  record._id
    ? { _id: record._id }
    : {
        url: record.url,
        permission: record.permission,
        mediaTypes: record.mediaTypes || '',
      };

export class Store extends DialogStore {
  public data: SiteInfoData = EMPTY_DATA;

  public constructor() {
    super({ persistent: true, visibilityWrapper: false });

    makeObservable(this, {
      data: observable,
    });

    ipcRenderer.on('visible', (_event, visible, data: SiteInfoData) => {
      this.visible = visible;
      if (visible) {
        this.data = {
          ...EMPTY_DATA,
          ...data,
          cookies: Array.isArray(data?.cookies) ? data.cookies : [],
          certificatePending: !!data?.secure,
          permissions: Array.isArray(data?.permissions) ? data.permissions : [],
        };
      }
    });

    ipcRenderer.on(
      'site-info-certificate',
      (_event, certificate: SiteCertificateData | null) => {
        this.data = {
          ...this.data,
          certificate: certificate || null,
          certificatePending: false,
        };
      },
    );
  }

  public async setPermission(
    record: IPermissionRecord,
    value: 'default' | 'allow' | 'ask' | 'deny',
  ) {
    if (value === 'default') {
      await ipcRenderer.invoke('storage-remove', {
        scope: 'permissions',
        query: recordQuery(record),
      });
      this.data = {
        ...this.data,
        permissions: this.data.permissions.filter((item) => item !== record),
      };
      return;
    }

    const type = value === 'allow' ? 1 : value === 'ask' ? 3 : 2;
    await ipcRenderer.invoke('storage-update', {
      scope: 'permissions',
      query: recordQuery(record),
      value: { type },
    });
    this.data = {
      ...this.data,
      permissions: this.data.permissions.map((item) =>
        item === record ? { ...item, type } : item,
      ),
    };
  }

  public resize(height: number) {
    ipcRenderer.send(`resize-site-info-${this.id}`, height);
  }

  public async removeCookie(cookie: SiteCookieData) {
    const cookies = await ipcRenderer.invoke(
      `site-info-remove-cookie-${this.windowId}`,
      { ...cookie },
    );
    this.data = {
      ...this.data,
      cookies: Array.isArray(cookies) ? cookies : this.data.cookies,
    };
  }

  public async saveCookie(
    original: SiteCookieData | null,
    cookie: SiteCookieData,
  ): Promise<{ ok: boolean; error?: CookieSaveError }> {
    const result = await ipcRenderer.invoke(
      `site-info-save-cookie-${this.windowId}`,
      original ? { ...original } : null,
      { ...cookie },
    );
    this.data = {
      ...this.data,
      cookies: Array.isArray(result?.cookies)
        ? result.cookies
        : this.data.cookies,
    };
    return { ok: !!result?.ok, error: result?.error };
  }

  public exportCookies(format: CookieExportFormat) {
    const { cookies } = this.data;
    const text =
      format === 'json'
        ? toExportJson(cookies)
        : format === 'header'
        ? toHeaderString(cookies)
        : toNetscape(cookies);
    clipboard.writeText(text);
  }

  public async clearCookies() {
    const cookies = await ipcRenderer.invoke(
      `site-info-clear-cookies-${this.windowId}`,
    );
    this.data = {
      ...this.data,
      cookies: Array.isArray(cookies) ? cookies : this.data.cookies,
    };
  }

  public async persistSessionCookies() {
    if (!this.settings.persistSessionCookies) {
      this.openSettings('web-browsing', 'persistSessionCookies');
      return false;
    }

    const result = await ipcRenderer.invoke(
      `site-info-persist-session-cookies-${this.windowId}`,
    );
    if (result?.requiresSettings) {
      this.openSettings('web-browsing', 'persistSessionCookies');
      return false;
    }
    if (result?.ok) this.hide();
    return !!result?.ok;
  }

  public openSettings(
    section: 'permissions' | 'web-browsing',
    highlight?: string,
  ) {
    const params = new URLSearchParams({ section });
    if (section === 'permissions' && this.data.host) {
      params.set('site', this.data.host);
    }
    if (highlight) params.set('highlight', highlight);
    ipcRenderer.send(`add-tab-${this.windowId}`, {
      url: `${getWebUIURL('settings')}?${params.toString()}`,
      active: true,
    });
    this.hide();
  }
}

export default new Store();
