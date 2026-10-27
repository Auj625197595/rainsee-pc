import { IFormFillData } from '~/interfaces';
import { hasSameHostname, hostMatches } from '~/utils/url';
import { BrowserWindow } from 'electron';
import { Application } from '../application';
import { getAppContentBounds } from './dialog';

interface AuthCredentialOption {
  id: string;
  username: string;
}

interface AuthResult {
  username: string;
  password: string;
  credentialId?: string;
}

const getHostname = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

const getSavedCredentials = async (url: string): Promise<IFormFillData[]> => {
  if (!Application.instance.settings.object.autofill) return [];

  const hostname = getHostname(url);
  if (!hostname) return [];

  const credentials = await Application.instance.storage.find<IFormFillData>({
    scope: 'formfill',
    query: { type: 'password' },
  });

  return credentials
    .filter(
      (item) =>
        Boolean(item?._id && item.fields?.password) &&
        hostMatches(item.url || '', hostname),
    )
    .sort(
      (left, right) =>
        Number(!hasSameHostname(left.url || '', hostname)) -
        Number(!hasSameHostname(right.url || '', hostname)),
    );
};

const saveAuthCredentials = async (
  tab: any,
  url: string,
  result: AuthResult,
) => {
  if (
    !Application.instance.settings.object.autofill ||
    tab.incognito ||
    !result.password
  ) {
    return;
  }

  const hostname = getHostname(url);
  if (!hostname) return;

  const credentials = await Application.instance.storage.find<IFormFillData>({
    scope: 'formfill',
    query: { type: 'password' },
  });
  const existing =
    (result.credentialId &&
      credentials.find(
        (item) =>
          item._id === result.credentialId &&
          hostMatches(item.url || '', hostname),
      )) ||
    credentials.find(
      (item) =>
        item.fields?.username === result.username &&
        hostMatches(item.url || '', hostname),
    );

  let saved: IFormFillData;
  let eventType: 'credentials-insert' | 'credentials-update';

  if (existing) {
    await Application.instance.storage.update({
      scope: 'formfill',
      query: { _id: existing._id },
      value: {
        'fields.username': result.username,
        'fields.password': result.password,
        'fields.passLength': result.password.length,
        favicon: tab.favicon || existing.favicon,
      },
    });
    saved = {
      ...existing,
      favicon: tab.favicon || existing.favicon,
      fields: {
        ...existing.fields,
        username: result.username,
        password: result.password,
        passLength: result.password.length,
      },
    };
    eventType = 'credentials-update';
  } else {
    saved = await Application.instance.storage.insert<IFormFillData>({
      scope: 'formfill',
      item: {
        type: 'password',
        url: hostname,
        favicon: tab.favicon,
        fields: {
          username: result.username,
          password: result.password,
          passLength: result.password.length,
        },
      },
    });
    eventType = 'credentials-insert';
  }

  const settingsView = tab.window.viewManager.settingsView;
  if (settingsView && !settingsView.webContents.isDestroyed()) {
    settingsView.webContents.send(eventType, saved);
  }
  await tab.updateCredentials();
};

export const requestAuth = (
  browserWindow: BrowserWindow,
  url: string,
  tabId: number,
): Promise<{ username: string; password: string } | undefined> => {
  return new Promise((resolve, reject) => {
    const appWindow =
      Application.instance.windows.fromBrowserWindow(browserWindow);

    // 认证事件给出的是物理 WebContents id。覆盖页必须归并到根标签，
    // 否则这里会访问 undefined.requestedAuth。
    const tab = appWindow.viewManager.findViewByWebContentsId(tabId);
    if (!tab) {
      resolve(undefined);
      return;
    }
    const logicalTabId = tab.id;
    tab.requestedAuth = { url, credentials: [] };
    let hasSavedCredentials = false;

    const dialog = Application.instance.dialogs.show({
      name: 'auth',
      browserWindow,
      getBounds: () => {
        const area = getAppContentBounds(browserWindow, appWindow);
        return {
          width: 400,
          height: hasSavedCredentials ? 420 : 370,
          x: area.x + area.width / 2 - 400 / 2,
          y: area.y,
        };
      },
      tabAssociation: {
        tabId: logicalTabId,
        getTabInfo: (tabId) => {
          return appWindow.viewManager.getById(tabId)?.requestedAuth;
        },
      },
      onWindowBoundsUpdate: (disposition) => {
        if (disposition === 'resize') dialog.rearrange();
      },
    });

    if (!dialog) return;

    dialog.handle('auth-get-password', async (_event, credentialId: string) => {
      if (!credentialId) return null;
      const credentials = await getSavedCredentials(url);
      const credential = credentials.find((item) => item._id === credentialId);
      if (!credential) return null;
      return {
        username: credential.fields?.username || '',
        password: credential.fields?.password || '',
      };
    });

    getSavedCredentials(url)
      .then((credentials) => {
        const options: AuthCredentialOption[] = credentials.map((item) => ({
          id: item._id as string,
          username: item.fields?.username || '',
        }));
        hasSavedCredentials = options.length > 0;
        tab.requestedAuth = { url, credentials: options };
        dialog.rearrange();
        dialog._sendTabInfo(logicalTabId);
      })
      .catch((error) => {
        console.error('[auth] failed to load saved credentials', error);
      });

    let settled = false;
    dialog.on('result', async (_event, rawResult: AuthResult | null) => {
      if (settled) return;
      settled = true;

      const result =
        rawResult &&
        typeof rawResult.username === 'string' &&
        typeof rawResult.password === 'string'
          ? rawResult
          : null;

      dialog.hide();

      if (result) {
        try {
          await saveAuthCredentials(tab, url, result);
        } catch (error) {
          console.error('[auth] failed to save credentials', error);
        }
      }

      resolve(
        result
          ? { username: result.username, password: result.password }
          : undefined,
      );
    });
  });
};
