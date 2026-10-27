import { MessageKey, Translator } from './i18n';

// Chrome 安装确认框里的「该扩展程序可以:」列表。只列会触发权限警告的项,
// storage/contextMenus/alarms/activeTab 等 Chrome 不提示的权限不展示。
const API_WARNINGS: Record<string, MessageKey> = {
  bookmarks: 'permBookmarks',
  clipboardRead: 'permClipboardRead',
  clipboardWrite: 'permClipboardWrite',
  contentSettings: 'permContentSettings',
  debugger: 'extiPermDebugger',
  declarativeNetRequest: 'permDnr',
  downloads: 'permDownloads',
  geolocation: 'xpermGeolocation',
  history: 'permHistory',
  management: 'permManagement',
  nativeMessaging: 'permNativeMessaging',
  notifications: 'xpermNotifications',
  privacy: 'permPrivacy',
  proxy: 'extiPermProxy',
  tabs: 'permTabs',
  topSites: 'permTopSites',
  userScripts: 'permUserScripts',
  webNavigation: 'permWebNavigation',
};

// 超过此数量的具体站点合并成「多个网站」,与 Chrome 的折叠规则接近。
const MAX_LISTED_HOSTS = 3;

const isAllHosts = (pattern: string) =>
  pattern === '<all_urls>' || /^(\*|https?|wss?):\/\/\*\//.test(pattern);

const hostOf = (pattern: string) => {
  const match = /^[^:]+:\/\/([^/]+)/.exec(pattern);
  if (!match) return '';
  return match[1].replace(/^\*\./, '');
};

export const getExtensionPermissionWarnings = (
  permissions: string[],
  hosts: string[],
  t: Translator,
): string[] => {
  const warnings: string[] = [];

  const hostList = (hosts || []).filter((h) => typeof h === 'string' && h);
  if (hostList.some(isAllHosts)) {
    warnings.push(t('extiHostAll'));
  } else {
    const names = Array.from(
      new Set(hostList.map(hostOf).filter((h) => h && h !== '*')),
    );
    if (names.length > MAX_LISTED_HOSTS) {
      warnings.push(t('extiHostMany'));
    } else if (names.length) {
      warnings.push(t('extiHostList', { hosts: names.join(', ') }));
    }
  }

  for (const permission of permissions || []) {
    const key = API_WARNINGS[permission];
    if (!key) continue;
    const text = t(key);
    // tabs 与 history 等在 Chrome 中合并为同一句,按文案去重。
    if (!warnings.includes(text)) warnings.push(text);
  }
  return warnings;
};
