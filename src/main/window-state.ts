import {readFileSync} from 'fs';

export type PersistedWindowState = {
  bounds?: Electron.Rectangle;
  maximized?: boolean;
  fullscreen?: boolean;
};

export const getWindowStateFileNames = (incognito: boolean) =>
  incognito
    ? {
        primary: 'incognito-window-data.json',
        fallback: 'window-data.json',
      }
    : {
        primary: 'window-data.json',
        fallback: undefined,
      };

// An incognito window may use the normal window state as its initial geometry,
// but it always persists to its own primary file. This prevents an incognito
// launch from racing with or overwriting the normal window's saved state.
export const loadWindowState = (
  paths: Array<string | null | undefined>,
): PersistedWindowState => {
  for (const path of paths) {
    if (!path) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try the fallback path, or use the default state when none is readable.
    }
  }
  return {};
};
