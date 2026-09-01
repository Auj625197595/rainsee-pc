import {
  clipboard,
  contextBridge,
  ipcRenderer,
  nativeImage,
  shell,
  webFrame,
  webUtils,
} from 'electron';

import type {IFormFillData} from '~/interfaces';
import type {IProfileFingerprint} from '~/common/profile-network';

export {
  clipboard,
  contextBridge,
  ipcRenderer,
  nativeImage,
  shell,
  webFrame,
  webUtils,
};

export interface SelectionTranslateConfig {
  panelEnabled: boolean;
  wordCountEnabled: boolean;
  translateEnabled: boolean;
  target: string;
  language?: unknown;
}

type Unsubscribe = () => void;

const onPayload = <T extends unknown[]>(
  channel: string,
  listener: (...payload: T) => void,
): Unsubscribe => {
  const wrapped = (_event: Electron.IpcRendererEvent, ...payload: T) =>
    listener(...payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

// This is the only Electron-facing module imported by the ordinary-tab
// preload graph. DOM agents receive fixed operations instead of arbitrary IPC
// channel access.
export const rendererCapabilities = {
  lifecycle: {
    getTabId: (): number => ipcRenderer.sendSync('get-webcontents-id'),
    getWindowId: (): number => ipcRenderer.sendSync('get-window-id'),
  },
  credentials: {
    onSaved: (listener: (data: IFormFillData) => void) =>
      onPayload<[IFormFillData]>('credentials-saved', listener),
    onPromptDismissed: (listener: () => void) =>
      onPayload<[]>('credentials-prompt-dismissed', listener),
    findForHost: (windowId: number, hostname: string) =>
      ipcRenderer.invoke(`find-form-fill-update-${windowId}`, hostname),
    openSettings: (windowId: number) =>
      ipcRenderer.send(`open-password-settings-${windowId}`),
    remove: (windowId: number, credentialId: string) =>
      ipcRenderer.send(`credentials-delete-${windowId}`, credentialId),
    showPrompt: (windowId: number, payload: unknown) =>
      ipcRenderer.send(`credentials-show-${windowId}`, payload),
  },
  selection: {
    getConfig: (): SelectionTranslateConfig | undefined =>
      ipcRenderer.sendSync('get-selection-translate-config-sync'),
    copy: (text: string): Promise<boolean> =>
      ipcRenderer.invoke('selection-panel-copy', text),
    search: (text: string) => ipcRenderer.send('selection-panel-search', text),
    more: (text: string) => ipcRenderer.send('selection-panel-more', text),
    openSettings: (section: string) =>
      ipcRenderer.invoke('selection-translate-open-settings', section),
    hideSite: () => ipcRenderer.invoke('selection-panel-hide-site'),
    hideGlobal: () => ipcRenderer.invoke('selection-panel-hide-global'),
    request: (payload: unknown) =>
      ipcRenderer.send('selection-translate-request', payload),
    getSiteState: (): Promise<boolean> =>
      ipcRenderer.invoke('selection-panel-site-state'),
    onResult: (tabId: number, listener: (payload: any) => void) =>
      onPayload<[any]>(`selection-translate-result-${tabId}`, listener),
    onConfigChanged: (
      listener: (config: SelectionTranslateConfig) => void,
    ) =>
      onPayload<[SelectionTranslateConfig]>(
        'selection-translate-config-changed',
        listener,
      ),
    onSiteRuleChanged: (
      listener: (hostname: string, hidden: boolean) => void,
    ) =>
      onPayload<[string, boolean]>(
        'selection-panel-site-rule-changed',
        listener,
      ),
  },
  fingerprint: {
    get: (): IProfileFingerprint | null =>
      ipcRenderer.sendSync('profile-fingerprint-get'),
    executeInMainWorld: (source: string) =>
      webFrame.executeJavaScript(source, true),
  },
};

