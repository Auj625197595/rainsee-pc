import * as ReactDOM from 'react-dom';
import * as React from 'react';
import { injectFonts } from '~/renderer/mixins';
import { configureUI } from '~/common/renderer-config';
import { getWebUIContext } from '~/common/webui-context';
import {
  I18nProvider,
  LanguageSubscription,
} from '~/renderer/components/I18n';

const subscribeToLanguage: LanguageSubscription = (listener) => {
  const bridge = (globalThis as any).rainseeWebUI;
  if (!bridge || typeof bridge.on !== 'function') return () => undefined;
  return bridge.on(
    'update-settings',
    (settings: { language?: unknown }) => {
      if (settings && Object.prototype.hasOwnProperty.call(settings, 'language')) {
        listener(settings.language);
      }
    },
  );
};

export const renderWebUI = (Component: any) => {
  injectFonts();
  configureUI();
  const settings = getWebUIContext().settings;

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
