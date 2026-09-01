import * as ReactDOM from 'react-dom';
import * as React from 'react';

import { configureUI } from '~/common/renderer-config';
import { ipcRenderer } from 'electron';
import {
  I18nProvider,
  LanguageSubscription,
} from '~/renderer/components/I18n';

const subscribeToLanguage: LanguageSubscription = (listener) => {
  const onSettingsUpdate = (
    _event: Electron.IpcRendererEvent,
    settings: { language?: unknown },
  ) => {
    if (settings && Object.prototype.hasOwnProperty.call(settings, 'language')) {
      listener(settings.language);
    }
  };

  ipcRenderer.on('update-settings', onSettingsUpdate);
  return () => ipcRenderer.removeListener('update-settings', onSettingsUpdate);
};

export const renderUI = (Component: any) => {
  ipcRenderer.setMaxListeners(0);
  configureUI();
  const settings = ipcRenderer.sendSync('get-settings-sync') || {};

  ReactDOM.render(
    React.createElement(
      I18nProvider,
      {
        initialLanguage: settings.language,
        subscribe: subscribeToLanguage,
      },
      React.createElement(Component),
    ),
    document.getElementById('app'),
  );
};
