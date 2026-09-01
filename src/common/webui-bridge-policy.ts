const TRUSTED_WEBUI_HOSTS = new Set([
  'bookmarks', 'downloads', 'extensions', 'flags', 'history', 'image-viewer',
  'memory', 'newtab', 'settings',
]);

const TRUSTED_DEV_PATH = /^\/(bookmarks|downloads|extensions|flags|history|image-viewer|memory|newtab|settings)\.html$/;

export const getTrustedWebUIHost = (rawUrl: string): string | null => {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'yjllq-error:') return 'error';
    if (url.protocol === 'yjllq:') {
      return TRUSTED_WEBUI_HOSTS.has(url.hostname) && url.pathname === '/'
        ? url.hostname
        : null;
    }
    if (
      url.protocol === 'http:' && url.hostname === 'localhost' &&
      url.port === '4444' && TRUSTED_DEV_PATH.test(url.pathname)
    ) {
      return url.pathname.slice(1, -'.html'.length);
    }
    return null;
  } catch {
    return null;
  }
};

export const isTrustedWebUIUrl = (rawUrl: string) =>
  getTrustedWebUIHost(rawUrl) !== null;

const WEBUI_INVOKE_CHANNELS = [
  'adblock-add-subscription', 'adblock-add-whitelist',
  'adblock-get-subscriptions', 'adblock-get-user-rules',
  'adblock-get-whitelist', 'adblock-remove-subscription',
  'adblock-remove-whitelist', 'adblock-save-user-rules',
  'adblock-set-auto-update', 'adblock-toggle-subscription',
  'adblock-update-all', 'adblock-update-subscription',
  'bookmarks-add',
  'bookmarks-get', 'bookmarks-get-folders', 'bookmarks-import-tree',
  'browser-import-detect', 'browser-import-read',
  'clear-browsing-data-now', 'credentials-get-password', 'data-backup-create',
  'data-backup-list', 'data-backup-open-dir', 'data-backup-restore',
  'data-backup-select-restore',
  'data-location-change', 'data-location-get', 'data-location-reset',
  'device-permission-revoke', 'device-permissions-list',
  'device-permissions-revoke-site', 'export-bookmarks',
  'download-open', 'download-show-in-folder',
  'extension-get-inspect-views', 'extension-inspect-target',
  'extension-reload', 'extension-set-enabled',
  'extension-set-incognito-allowed', 'extension-store-install',
  'extension-store-list', 'extension-uninstall',
  'extensions-check-updates', 'extensions-get-auto-update',
  'extensions-get-detailed', 'extensions-import-from-browser',
  'extensions-scan-browser-import', 'extensions-set-auto-update',
  'extensions-set-groups', 'flags-get', 'flags-reset-all', 'flags-set',
  'flash-support-set-enabled', 'get-ad-filter-count', 'get-ad-lists',
  'get-default-browser-status', 'get-downloads', 'get-extension-shortcuts',
  'get-gesture-actions', 'get-pending-homepage-items',
  'get-shortcut-actions', 'history-get', 'image-viewer-get',
  'image-viewer-pack-zip', 'import-bookmarks',
  'load-extension-from-crx', 'load-extension-from-dir',
  'load-extension-from-file', 'media-download', 'media-download-create',
  'memory-get-snapshot',
  'open-log-dir',
  'passwords-export-csv', 'passwords-import-csv',
  'profile-fingerprint-regenerate', 'profile-fingerprint-set-enabled',
  'profile-network-get', 'profile-proxy-save', 'profile-proxy-test',
  'reset-extension-shortcut', 'reset-gesture', 'reset-shortcut',
  'sedentary-reminder-notify', 'sedentary-reminder-sync',
  'sedentary-reminder-test', 'set-as-default-browser',
  'set-extension-shortcut', 'set-gesture', 'set-gesture-option',
  'set-selection-translate-option', 'set-shortcut', 'shortcut-capture-mode',
  'set-search-engine-by-index',
  'show-onboarding', 'storage-get', 'storage-get-one', 'storage-insert',
  'storage-remove', 'storage-update',
] as const;

const WEBUI_SEND_CHANNELS = [
  'bookmarks-remove', 'bookmarks-reorder', 'bookmarks-update',
  'chrome-style-preview', 'data-backup-relaunch', 'data-location-cancel',
  'data-location-open-dir', 'data-location-relaunch', 'download-cancel',
  'download-pause', 'download-remove', 'download-resume',
  'downloader-path-autodetect', 'downloader-path-change',
  'downloads-path-change', 'newtab-search', 'newtab-search-url',
  'history-remove', 'remove-down-homepage-items', 'save-settings',
  'save-web-browsing-settings', 'selection-panel-rule-updated',
  'update-ad-lists',
] as const;

const WEBUI_EVENT_CHANNELS = [
  'credentials-insert', 'credentials-reload',
  'credentials-remove', 'credentials-update', 'homepage-items',
  'image-viewer-zip-progress',
  'pc-search-suggestion-action-result', 'pc-search-suggestions-result',
  'reload-bookmarks',
  'sedentary-reminder-notice', 'sedentary-reminder-state', 'update-settings',
] as const;

export type AllowedWebUIInvokeChannel =
  | typeof WEBUI_INVOKE_CHANNELS[number]
  | `show-bookmarks-bar-context-menu-${number}`;
export type AllowedWebUISendChannel = typeof WEBUI_SEND_CHANNELS[number] |
  `add-tab-${number}` | `newtab-open-browser-internal-${number}` |
  `newtab-search-show-${number}` | `pc-search-suggestion-action-${number}` |
  `pc-search-suggestions-${number}`;
export type AllowedWebUIEventChannel = typeof WEBUI_EVENT_CHANNELS[number];
export type WebUIChannelOperation = 'invoke' | 'send' | 'event';

/**
 * Synchronous data available during initial WebUI rendering.  This replaces
 * the historical collection of ad-hoc globals (window.settings, windowId,
 * account, etc.) while keeping the page-facing surface to one bridge.
 */
export interface WebUIContext {
  settings: unknown;
  windowId: number;
  appVersion?: string;
  // 开源版:无账号/设备参数,仅无痕标记。
  isIncognito?: boolean;
}

export interface RainseeWebUIErrorBridge {
  getUrl(): Promise<string>;
  reload(): Promise<unknown>;
  goHome(): Promise<unknown>;
  checkNetwork(): Promise<unknown>;
  copyDiagnostics(text: string): void;
  ignoreCertificateError(): Promise<unknown>;
  addAdblockWhitelist(domain?: string): Promise<unknown>;
}

export interface RainseeWebUIBridge {
  invoke(
    channel: AllowedWebUIInvokeChannel,
    ...args: unknown[]
  ): Promise<unknown>;
  send(channel: AllowedWebUISendChannel, ...args: unknown[]): void;
  on(
    channel: AllowedWebUIEventChannel,
    listener: (...payload: unknown[]) => void,
  ): () => void;
  getContext(): WebUIContext;
  getPathForFile?(file: File): string;
  error?: RainseeWebUIErrorBridge;
}

const invokeChannels = new Set<string>(WEBUI_INVOKE_CHANNELS);
const sendChannels = new Set<string>(WEBUI_SEND_CHANNELS);
const eventChannels = new Set<string>(WEBUI_EVENT_CHANNELS);
const dynamicSendChannel = /^(?:add-tab|newtab-open-browser-internal|newtab-search-show|pc-search-suggestion-action|pc-search-suggestions)-\d+$/;
const dynamicInvokeChannel = /^show-bookmarks-bar-context-menu-\d+$/;

const NON_SETTINGS_CHANNELS = new Set<string>([
  ...WEBUI_INVOKE_CHANNELS.filter((channel) =>
    /^(?:bookmarks-|browser-import-|export-bookmarks$|import-bookmarks$|get-downloads$|download-|extension-|extensions-|flags-|history-|image-viewer-|media-download|memory-|newtab-|sedentary-reminder-|get-pending-homepage-items$)/.test(
      channel,
    ),
  ),
  ...WEBUI_SEND_CHANNELS.filter((channel) =>
    /^(?:bookmarks-|download-|history-|newtab-|remove-down-homepage-items$)/.test(
      channel,
    ),
  ),
  ...WEBUI_EVENT_CHANNELS.filter((channel) =>
    /^(?:homepage-items$|pc-search-|sedentary-reminder-|update-settings$)/.test(
      channel,
    ),
  ),
]);

// A few extension operations are intentionally shared with Settings.
for (const channel of [
  'bookmarks-get-folders',
  'extensions-get-detailed',
  'load-extension-from-crx',
  'load-extension-from-dir',
]) {
  NON_SETTINGS_CHANNELS.delete(channel);
}

const isChannelOwnedByHost = (
  host: string,
  channel: string,
  operation: WebUIChannelOperation,
) => {
  // Settings changes are a read-only broadcast consumed by every built-in
  // page, so all registered WebUI hosts may subscribe to this event.
  if (operation === 'event' && channel === 'update-settings' && host !== 'error') {
    return true;
  }
  if (host === 'settings') {
    return !NON_SETTINGS_CHANNELS.has(channel) ||
      (operation === 'send' && /^add-tab-\d+$/.test(channel));
  }
  if (host === 'bookmarks') {
    return /^(?:bookmarks-|browser-import-|export-bookmarks$|import-bookmarks$)/.test(channel) ||
      (operation === 'invoke' && /^storage-/.test(channel)) ||
      (operation === 'send' && /^add-tab-\d+$/.test(channel)) ||
      (operation === 'invoke' && dynamicInvokeChannel.test(channel));
  }
  if (host === 'downloads') {
    return channel === 'get-downloads' || /^download-/.test(channel) ||
      /^media-download/.test(channel);
  }
  if (host === 'extensions') return /^(?:extension-|extensions-|load-extension-)/.test(channel);
  if (host === 'flags') return /^flags-/.test(channel);
  if (host === 'history') {
    return /^(?:history-|storage-)/.test(channel);
  }
  if (host === 'image-viewer') {
    return /^(?:image-viewer-|media-download$)/.test(channel);
  }
  if (host === 'memory') return channel === 'memory-get-snapshot' || channel === 'update-settings';
  if (host === 'newtab') {
    // 开源版:本地新标签页额外读取书签磁贴(bookmarks-get)。
    return /^(?:get-pending-homepage-items$|homepage-items$|newtab-|pc-search-|remove-down-homepage-items$|sedentary-reminder-|set-search-engine-by-index$|bookmarks-get$|update-settings$)/.test(channel);
  }
  return false;
};

export const isAllowedWebUIChannelForHost = (
  host: string | null,
  channel: unknown,
  operation: WebUIChannelOperation,
  windowId?: number,
) => host !== null &&
  isAllowedWebUIChannel(channel, operation) &&
  isAllowedDynamicWindowChannel(channel as string, windowId) &&
  isChannelOwnedByHost(host, channel as string, operation);

export const isAllowedWebUIChannel = (
  channel: unknown,
  operation?: WebUIChannelOperation,
) => {
  if (typeof channel !== 'string' || channel.length > 160) return false;
  if (operation === 'invoke') {
    return invokeChannels.has(channel) || dynamicInvokeChannel.test(channel);
  }
  if (operation === 'send') {
    return sendChannels.has(channel) || dynamicSendChannel.test(channel);
  }
  if (operation === 'event') return eventChannels.has(channel);
  return invokeChannels.has(channel) || sendChannels.has(channel) ||
    eventChannels.has(channel) || dynamicSendChannel.test(channel) ||
    dynamicInvokeChannel.test(channel);
};

const isAllowedDynamicWindowChannel = (
  channel: string,
  windowId?: number,
) => {
  if (!dynamicSendChannel.test(channel) && !dynamicInvokeChannel.test(channel)) {
    return true;
  }
  if (!Number.isSafeInteger(windowId)) return false;
  const separator = channel.lastIndexOf('-');
  return Number(channel.slice(separator + 1)) === windowId;
};

export const isAllowedWebUIChannelForUrl = (
  rawUrl: string,
  channel: unknown,
  operation: WebUIChannelOperation,
  windowId?: number,
) => isAllowedWebUIChannelForHost(
  getTrustedWebUIHost(rawUrl),
  channel,
  operation,
  windowId,
);
