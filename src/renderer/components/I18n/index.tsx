import * as React from 'react';

import {
  createTranslator,
  resolveAppLanguage,
  Translator,
} from '~/common/i18n';

type LanguageListener = (language: unknown) => void;

export type LanguageSubscription = (
  listener: LanguageListener,
) => () => void;

interface I18nProviderProps {
  children?: React.ReactNode;
  initialLanguage?: unknown;
  subscribe?: LanguageSubscription;
}

const I18nContext = React.createContext<Translator | null>(null);
let activeTranslator = createTranslator(
  resolveAppLanguage(
    undefined,
    typeof navigator === 'undefined' ? undefined : navigator.language,
  ),
);

export const I18nProvider = ({
  children,
  initialLanguage,
  subscribe,
}: I18nProviderProps) => {
  const [language, setLanguage] = React.useState(initialLanguage);
  const locale = resolveAppLanguage(
    language,
    typeof navigator === 'undefined' ? undefined : navigator.language,
  );
  const translator = React.useMemo(() => createTranslator(locale), [locale]);
  activeTranslator = translator;

  React.useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe(setLanguage);
  }, [subscribe]);

  React.useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <I18nContext.Provider value={translator}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = (): Translator => {
  const translator = React.useContext(I18nContext);
  if (!translator) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return translator;
};

// Compatibility entry for class components and renderer callbacks that cannot
// call hooks. React function components should use useI18n instead.
export const getRendererTranslator = (): Translator => activeTranslator;
