import { app, ipcMain } from 'electron';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export type FlagSelection = 'default' | 'enabled' | 'disabled';

export interface IFlagItem {
  key: string;
  title: string;
  description: string;
  permalink: string;
  supportedPlatforms: string[];
  defaultSelection: FlagSelection;
  selected: FlagSelection;
  available: boolean;
}

export interface IFlagsPayload {
  version: {
    electron: string;
    chromium: string;
  };
  tabs: {
    available: IFlagItem[];
    unavailable: IFlagItem[];
  };
  needsRestart: boolean;
}

const SETTINGS_FILE = 'settings.json';
const FLAGS_MARKDOWN_FILE = 'flasg.md';
const BUILTIN_SWITCHES = new Set([
  'enable-transparent-visuals',
  'enable-features',
  'disable-features',
  'lang',
  'remote-debugging-port',
  'host-rules',
]);

let cachedFlags: IFlagItem[] | null = null;

const normalizeSelection = (value: unknown): FlagSelection => {
  if (value === 'enabled' || value === 'disabled') return value;
  return 'default';
};

const getSettingsPath = () => resolve(app.getPath('userData'), SETTINGS_FILE);

const readRawSettings = (): Record<string, any> => {
  try {
    const file = readFileSync(getSettingsPath(), 'utf8');
    return JSON.parse(file);
  } catch {
    return {};
  }
};

const getPersistedSelections = (): Record<string, FlagSelection> => {
  const json = readRawSettings();
  const source = json?.flagsSelections;
  if (!source || typeof source !== 'object') return {};

  const result: Record<string, FlagSelection> = {};
  for (const [key, value] of Object.entries(source)) {
    result[key] = normalizeSelection(value);
  }
  return result;
};

const getFlagsMarkdownPath = () => resolve(process.cwd(), FLAGS_MARKDOWN_FILE);

const parsePlatforms = (descriptionLine: string): string[] => {
  const idx = descriptionLine.lastIndexOf(' – ');
  if (idx < 0) return [];
  return descriptionLine
    .slice(idx + 3)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
};

const extractDescription = (lines: string[], startIndex: number): { text: string; nextIndex: number } => {
  const parts: string[] = [];
  let i = startIndex;

  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (parts.length > 0) break;
      continue;
    }
    if (line.startsWith('#')) break;
    parts.push(line);
  }

  return { text: parts.join(' '), nextIndex: i };
};

const parseDefaultSelection = (value: string): FlagSelection => {
  const lower = value.trim().toLowerCase();
  if (lower === 'enabled') return 'enabled';
  if (lower === 'disabled') return 'disabled';
  return 'default';
};

const parseFlagsMarkdown = (): IFlagItem[] => {
  if (cachedFlags) return cachedFlags;

  const filePath = getFlagsMarkdownPath();
  if (!existsSync(filePath)) {
    cachedFlags = [];
    return cachedFlags;
  }

  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/);
  const items: IFlagItem[] = [];
  let currentSectionAvailable = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line === 'Available') {
      currentSectionAvailable = true;
      continue;
    }

    if (line === 'Unavailable') {
      currentSectionAvailable = false;
      continue;
    }

    if (line.startsWith('#')) continue;
    if (line === 'Default' || line === 'Enabled' || line === 'Disabled') continue;

    const title = line;
    const { text: description, nextIndex } = extractDescription(lines, i + 1);
    i = nextIndex;

    while (i < lines.length && !lines[i].trim()) i++;
    const permalink = i < lines.length ? lines[i].trim() : '';
    if (!permalink.startsWith('#')) continue;

    i++;
    while (i < lines.length && !lines[i].trim()) i++;
    const selectionLine = i < lines.length ? lines[i].trim() : 'Default';

    const key = permalink.replace(/^#/, '');
    const item: IFlagItem = {
      key,
      title,
      description,
      permalink,
      supportedPlatforms: parsePlatforms(description),
      defaultSelection: parseDefaultSelection(selectionLine),
      selected: parseDefaultSelection(selectionLine),
      available: currentSectionAvailable,
    };

    items.push(item);
  }

  cachedFlags = items;
  return cachedFlags;
};

const cloneFlagsWithSelections = (
  selections: Record<string, FlagSelection>,
): IFlagItem[] => {
  return parseFlagsMarkdown().map((item) => ({
    ...item,
    selected: selections[item.key] || item.defaultSelection,
  }));
};

const selectionNeedsRestart = (
  items: IFlagItem[],
  selections: Record<string, FlagSelection>,
): boolean => {
  return items.some((item) => {
    const current = selections[item.key] || item.defaultSelection;
    return current !== item.defaultSelection;
  });
};

const keyToSwitch = (key: string): string => {
  if (key.startsWith('enable-')) {
    return key.slice('enable-'.length);
  }
  if (key.startsWith('disable-')) {
    return key.slice('disable-'.length);
  }
  return key;
};

const shouldAppendForSelection = (
  key: string,
  selection: FlagSelection,
): boolean => {
  if (selection === 'default') return false;
  if (key.startsWith('enable-')) return selection === 'enabled';
  if (key.startsWith('disable-')) return selection === 'disabled';
  return selection === 'enabled';
};

export const applyPersistedFlagsBeforeReady = () => {
  const selections = getPersistedSelections();
  const flags = cloneFlagsWithSelections(selections);

  for (const item of flags) {
    if (!shouldAppendForSelection(item.key, item.selected)) continue;
    const switchName = keyToSwitch(item.key);
    if (!switchName || BUILTIN_SWITCHES.has(switchName)) continue;
    try {
      app.commandLine.appendSwitch(switchName);
    } catch (error) {
      console.log('[flags] appendSwitch failed:', switchName, error);
    }
  }
};

export const getFlagsPayload = (): IFlagsPayload => {
  const selections = getPersistedSelections();
  const flags = cloneFlagsWithSelections(selections);

  return {
    version: {
      electron: process.versions.electron || '',
      chromium: process.versions.chrome || '',
    },
    tabs: {
      available: flags.filter((item) => item.available),
      unavailable: flags.filter((item) => !item.available),
    },
    needsRestart: selectionNeedsRestart(flags, selections),
  };
};

export const setupFlagsIpc = () => {
  ipcMain.handle('flags-get', () => {
    return getFlagsPayload();
  });

  ipcMain.handle('flags-set', async (_event, key: string, selection: FlagSelection) => {
    const normalized = normalizeSelection(selection);
    const settings = readRawSettings();
    const current =
      settings.flagsSelections && typeof settings.flagsSelections === 'object'
        ? { ...settings.flagsSelections }
        : {};

    current[key] = normalized;
    if (normalized === 'default') {
      delete current[key];
    }

    const appSettings = (await import('./application')).Application.instance.settings;
    appSettings.updateSettings({
      flagsSelections: current,
    } as any);

    return getFlagsPayload();
  });

  ipcMain.handle('flags-reset-all', async () => {
    const appSettings = (await import('./application')).Application.instance.settings;
    appSettings.updateSettings({
      flagsSelections: {},
    } as any);
    return getFlagsPayload();
  });
};
