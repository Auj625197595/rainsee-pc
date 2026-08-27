import store from '../store';
import {ISettings} from '~/interfaces';

type WebBrowsingSettingsPatch = Pick<
  ISettings,
  | 'clearBrowsingData'
  | 'clearOnExit'
  | 'persistSessionCookies'
  | 'persistSessionCookieHosts'
>;

export const saveWebBrowsingSettings = (
  patch: Partial<WebBrowsingSettingsPatch>,
) => {
  window.postMessage(
    {
      type: 'save-web-browsing-settings',
      data: patch,
    },
    '*',
  );
};

export const onSwitchChange = (key: string) => () => {
  (store.settings as any)[key] = !(store.settings as any)[key];
  store.save();
};
