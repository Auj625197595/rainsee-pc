import { app } from 'electron';
import {
  createTranslator,
  resolveAppLanguage,
} from '~/common/i18n';
import { Translator } from '~/common/i18n';
/** Resolve the application language for native main-process UI. */
export const getMainTranslator = (preference: unknown): Translator => {
  let systemLocale: string | undefined;
  try {
    systemLocale = app.getSystemLocale();
  } catch {
    systemLocale = undefined;
  }
  return createTranslator(
    resolveAppLanguage(
      preference,
      systemLocale,
    ),
  );
};
