import store from '../store';
import {ISettings} from '~/interfaces';
import {ipcRenderer} from '~/common/renderer-ipc';
import type {Translator} from '~/common/i18n';
import {getRendererTranslator} from '~/renderer/components/I18n';

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
  ipcRenderer.send('save-web-browsing-settings', patch);
};

export const onSwitchChange = (key: string) => () => {
  (store.settings as any)[key] = !(store.settings as any)[key];
  store.save();
};

// 类组件和既有设置项的兼容入口。同一 locale 下的函数引用由 Provider 的
// useMemo 保持稳定,避免 ChromeStylePanel 行级 memo 失效。
export const getSettingsTranslator = (): Translator =>
  getRendererTranslator();
