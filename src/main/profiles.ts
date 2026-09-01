import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  shell,
  webContents,
} from 'electron';
import { execFile, spawn } from 'child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, join, resolve } from 'path';

import {
  getProfileArgument,
  PROFILE_ONBOARDING_SKIPPED_NOTICE,
  profileNameKey,
  validateProfileName,
} from '~/common/profiles';
import {
  activeProfileName,
  BASE_USER_DATA,
  getLastDirectoryProbeFailure,
  PROFILES_ROOT,
  readDataLocationPointer,
} from './bootstrap-paths';
import { buildIcoFromPng } from './services/pwa';
import {
  cloneMainProfileData,
  IProfileDataCloneOptions,
} from './profile-data-clone';
import { Application } from './application';
import { getMainTranslator } from './i18n';

// 原生弹窗/IPC 回执文案按当前设置的语言即时创建翻译器,不缓存。
const profileTranslator = () =>
  getMainTranslator(Application.instance.settings?.object?.language);

export interface IProfileInfo {
  name: string;
  current: boolean;
  running: boolean;
}

export interface IProfileOperationResult {
  ok: boolean;
  message?: string;
  profile?: IProfileInfo;
}

export interface IProfileShortcutOptions {
  desktop: boolean;
  startMenu: boolean;
  localIconPath?: string;
}

export interface IProfileShortcutDialogData extends IProfileOperationResult {
  name?: string;
  iconUrl?: string;
}

export interface IProfileBrandInfo {
  profileName: string | null;
  logoDataUrl: string | null;
}

const INTERNAL_PREFIX = '.';
const RUNTIME_DIR = join(PROFILES_ROOT, '.runtime');
const MANAGER_LOCK = join(PROFILES_ROOT, '.manager-lock');
const SHORTCUT_PREFIX = `${app.name} - `;
const PROFILE_LOGO_FILE = join(app.getPath('userData'), 'profile-logo.png');
const MAX_PROFILE_LOGO_BYTES = 10 * 1024 * 1024;

const isSamePath = (left: string, right: string): boolean => {
  const normalize = (value: string) => resolve(value).replace(/\\/g, '/');
  const a = normalize(left);
  const b = normalize(right);
  return process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
};

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const isPidRunning = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const runtimeProfileDir = (name: string) =>
  join(RUNTIME_DIR, encodeURIComponent(name));

const runtimeMarker = (name: string, pid: number) =>
  join(runtimeProfileDir(name), `${pid}.json`);

const writeRuntimeMarker = (name: string, pid: number) => {
  try {
    mkdirSync(runtimeProfileDir(name), { recursive: true });
    writeFileSync(
      runtimeMarker(name, pid),
      JSON.stringify({ pid, name, startedAt: Date.now() }),
      'utf8',
    );
  } catch (error) {
    console.error('[profiles] 写运行标记失败:', error);
  }
};

const removeRuntimeMarker = (name: string, pid: number) => {
  try {
    unlinkSync(runtimeMarker(name, pid));
  } catch {}
  try {
    if (readdirSync(runtimeProfileDir(name)).length === 0) {
      rmSync(runtimeProfileDir(name), { recursive: true, force: true });
    }
  } catch {}
};

const livePidsForProfile = (name: string): number[] => {
  const dir = runtimeProfileDir(name);
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const live: number[] = [];
  for (const entry of entries) {
    const match = /^(\d+)\.json$/.exec(entry);
    if (!match) continue;
    const pid = Number(match[1]);
    if (isPidRunning(pid)) {
      live.push(pid);
    } else {
      try {
        unlinkSync(join(dir, entry));
      } catch {}
    }
  }
  try {
    if (readdirSync(dir).length === 0)
      rmSync(dir, { recursive: true, force: true });
  } catch {}
  return live;
};

export const isProfileRunning = (name: string): boolean =>
  livePidsForProfile(name).length > 0;

const scanProfileDirectories = (): string[] => {
  mkdirSync(PROFILES_ROOT, { recursive: true });
  return readdirSync(PROFILES_ROOT, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith(INTERNAL_PREFIX),
    )
    .map((entry) => entry.name)
    .filter((name) => validateProfileName(name).ok)
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { sensitivity: 'base' }));
};

const profileDirectories = (): string[] => {
  try {
    return scanProfileDirectories();
  } catch (error: any) {
    console.error('[profiles] 扫描目录失败:', {
      root: PROFILES_ROOT,
      code: error?.code,
      message: error?.message || String(error),
    });
    return [];
  }
};

const profileInfo = (name: string): IProfileInfo => ({
  name,
  current: activeProfileName === name,
  running: isProfileRunning(name),
});

export const listProfiles = (): IProfileInfo[] =>
  profileDirectories().map(profileInfo);

export const listProfilesResult = (): {
  ok: boolean;
  profiles: IProfileInfo[];
  error?: string;
} => {
  try {
    const profiles = scanProfileDirectories().map(profileInfo);
    console.info('[profiles] 列表读取成功:', {
      root: PROFILES_ROOT,
      count: profiles.length,
      current: activeProfileName,
    });
    return { ok: true, profiles };
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error('[profiles] 列表读取失败:', {
      root: PROFILES_ROOT,
      code: error?.code,
      message,
    });
    return { ok: false, profiles: [], error: message };
  }
};

export const getRunningProfileNames = (): string[] =>
  profileDirectories().filter(isProfileRunning);

const readLockOwner = (): number => {
  try {
    const value = JSON.parse(
      readFileSync(join(MANAGER_LOCK, 'owner.json'), 'utf8'),
    );
    return Number(value?.pid) || 0;
  } catch {
    return 0;
  }
};

const withManagerLock = async <T>(
  operation: () => Promise<T> | T,
): Promise<T> => {
  mkdirSync(PROFILES_ROOT, { recursive: true });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    let acquired = false;
    try {
      mkdirSync(MANAGER_LOCK);
      acquired = true;
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      const owner = readLockOwner();
      if (!owner || !isPidRunning(owner)) {
        try {
          rmSync(MANAGER_LOCK, { recursive: true, force: true });
        } catch {}
      } else {
        await delay(50);
      }
    }

    if (!acquired) continue;
    try {
      writeFileSync(
        join(MANAGER_LOCK, 'owner.json'),
        JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
        'utf8',
      );
      return await operation();
    } finally {
      rmSync(MANAGER_LOCK, { recursive: true, force: true });
    }
  }
  throw new Error('小号管理正忙，请稍后重试');
};

const findProfileDirectoryName = (requested: string): string | null => {
  const key = profileNameKey(requested);
  return (
    profileDirectories().find((name) => profileNameKey(name) === key) || null
  );
};

const getLaunchArguments = (name: string): string[] => {
  const args = [getProfileArgument(name)];
  return (process as any).defaultApp ? [app.getAppPath(), ...args] : args;
};

const launchProfile = (name: string): IProfileOperationResult => {
  if (activeProfileName === name) {
    return { ok: true, message: '当前已在该小号窗口中' };
  }
  if (readDataLocationPointer().pending) {
    return { ok: false, message: '请先完成或取消主账号的数据目录迁移' };
  }

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (env.NODE_OPTIONS) {
    env.NODE_OPTIONS = env.NODE_OPTIONS.replace(
      /--openssl-legacy-provider/g,
      '',
    ).trim();
    if (!env.NODE_OPTIONS) delete env.NODE_OPTIONS;
  }

  try {
    const child = spawn(process.execPath, getLaunchArguments(name), {
      detached: true,
      stdio: 'ignore',
      env,
    });
    if (child.pid) writeRuntimeMarker(name, child.pid);
    child.once('error', () => {
      if (child.pid) removeRuntimeMarker(name, child.pid);
    });
    child.once('exit', () => {
      if (child.pid) removeRuntimeMarker(name, child.pid);
    });
    child.unref();
    return { ok: true };
  } catch (error: any) {
    return { ok: false, message: error?.message || '小号窗口启动失败' };
  }
};

const quoteWindowsArgument = (value: string): string => {
  if (!/[\s"]/g.test(value)) return value;
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
};

const quoteDesktopArgument = (value: string): string =>
  `"${value.replace(/([\\"$`])/g, '\\$1')}"`;

const shellQuote = (value: string): string =>
  `'${value.replace(/'/g, `'"'"'`)}'`;

const shortcutBaseName = (name: string) => `${SHORTCUT_PREFIX}${name}`;

const desktopShortcutPath = (name: string): string => {
  const base = join(app.getPath('desktop'), shortcutBaseName(name));
  if (process.platform === 'win32') return `${base}.lnk`;
  if (process.platform === 'darwin') return `${base}.app`;
  return `${base}.desktop`;
};

const startMenuShortcutPath = (name: string): string | null => {
  if (process.platform !== 'win32') return null;
  return join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    `${shortcutBaseName(name)}.lnk`,
  );
};

const profileShortcutIconPath = (name: string): string =>
  join(
    PROFILES_ROOT,
    name,
    `shortcut-icon.${process.platform === 'win32' ? 'ico' : 'png'}`,
  );

const profileLogoPath = (name: string): string =>
  join(PROFILES_ROOT, name, 'profile-logo.png');

const defaultShortcutIconPath = (): string =>
  join(
    app.getAppPath(),
    'static',
    'icons',
    process.platform === 'win32'
      ? 'icon.ico'
      : process.platform === 'darwin'
      ? 'icon.icns'
      : 'icon.png',
  );

const writeAtomicFile = (target: string, content: string, mode?: number) => {
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, content, 'utf8');
  if (mode) chmodSync(temp, mode);
  try {
    rmSync(target, { force: true });
  } catch {}
  renameSync(temp, target);
};

const prepareProfileShortcutIcon = (
  name: string,
  localIconPath?: string,
): string => {
  const savedIcon = profileShortcutIconPath(name);
  const source =
    localIconPath ||
    (existsSync(savedIcon)
      ? savedIcon
      : existsSync(profileLogoPath(name))
      ? profileLogoPath(name)
      : defaultShortcutIconPath());

  if (!localIconPath && source === savedIcon) return savedIcon;
  if (
    !localIconPath &&
    source === defaultShortcutIconPath() &&
    process.platform === 'win32'
  ) {
    return source;
  }

  try {
    const image = nativeImage.createFromPath(source);
    if (image.isEmpty()) return defaultShortcutIconPath();
    const resized = image.resize({ width: 256, height: 256, quality: 'best' });
    const png = resized.toPNG();
    const output =
      process.platform === 'win32' ? buildIcoFromPng(png, 256, 256) : png;
    const temp = `${savedIcon}.${process.pid}.tmp`;
    writeFileSync(temp, output);
    rmSync(savedIcon, { force: true });
    renameSync(temp, savedIcon);
    return savedIcon;
  } catch (error) {
    console.error('[profiles] 准备小号快捷方式图标失败:', error);
    return defaultShortcutIconPath();
  }
};

export const getProfileShortcutDialogData = (
  rawName: unknown,
): IProfileShortcutDialogData => {
  const t = profileTranslator();
  const validation = validateProfileName(rawName);
  if (!validation.ok || !validation.name) {
    return { ok: false, message: t(validation.error!) };
  }
  const actual = findProfileDirectoryName(validation.name);
  if (!actual) return { ok: false, message: t('profileNotFoundDeleted') };

  const candidates = [
    profileShortcutIconPath(actual),
    profileLogoPath(actual),
    defaultShortcutIconPath(),
  ];
  let iconUrl = '';
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const image = nativeImage.createFromPath(candidate);
      if (!image.isEmpty()) {
        iconUrl = image.resize({ width: 128, height: 128 }).toDataURL();
        break;
      }
    } catch {}
  }
  return { ok: true, name: actual, iconUrl };
};

const readProfileBrand = (): IProfileBrandInfo => {
  let logoDataUrl: string | null = null;
  if (activeProfileName && existsSync(PROFILE_LOGO_FILE)) {
    try {
      const image = nativeImage.createFromPath(PROFILE_LOGO_FILE);
      if (!image.isEmpty()) logoDataUrl = image.toDataURL();
    } catch (error) {
      console.error('[profiles] 读取小号 Logo 失败:', error);
    }
  }
  return { profileName: activeProfileName, logoDataUrl };
};

const broadcastProfileBrand = (brand: IProfileBrandInfo) => {
  for (const contents of webContents.getAllWebContents()) {
    const url = contents.getURL().split(/[?#]/, 1)[0];
    if (!contents.isDestroyed() && /\/(?:app|sidebar-panel)\.html$/.test(url)) {
      contents.send('profile-brand-updated', brand);
    }
  }
};

const selectProfileLogo = async (
  event: Electron.IpcMainInvokeEvent,
): Promise<{
  ok: boolean;
  canceled?: boolean;
  message?: string;
  brand?: IProfileBrandInfo;
}> => {
  const t = profileTranslator();
  if (!activeProfileName) {
    return { ok: false, message: t('profileLogoMainAccount') };
  }

  const owner =
    BrowserWindow.fromWebContents(event.sender) ||
    BrowserWindow.getFocusedWindow();
  const options: Electron.OpenDialogOptions = {
    title: t('profileLogoChooseFile'),
    properties: ['openFile'],
    filters: [
      { name: t('fileFilterImages'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] },
    ],
  };
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return { ok: true, canceled: true, brand: readProfileBrand() };
  }

  try {
    const source = result.filePaths[0];
    if (statSync(source).size > MAX_PROFILE_LOGO_BYTES) {
      throw new Error(t('profileLogoTooLarge'));
    }
    const image = nativeImage.createFromPath(source);
    if (image.isEmpty()) throw new Error(t('profileLogoUnreadable'));
    const normalized = image.resize({ width: 256, quality: 'best' });
    const temp = `${PROFILE_LOGO_FILE}.${process.pid}.tmp`;
    const backup = `${PROFILE_LOGO_FILE}.${process.pid}.backup`;
    writeFileSync(temp, normalized.toPNG());
    if (existsSync(PROFILE_LOGO_FILE)) renameSync(PROFILE_LOGO_FILE, backup);
    try {
      renameSync(temp, PROFILE_LOGO_FILE);
      rmSync(backup, { force: true });
    } catch (error) {
      try {
        rmSync(temp, { force: true });
      } catch {}
      if (existsSync(backup) && !existsSync(PROFILE_LOGO_FILE)) {
        renameSync(backup, PROFILE_LOGO_FILE);
      }
      throw error;
    }
    const brand = readProfileBrand();
    broadcastProfileBrand(brand);
    return { ok: true, brand };
  } catch (error) {
    const message = (error as any)?.message || t('profileLogoChangeFailed');
    const messageBoxOptions: Electron.MessageBoxOptions = {
      type: 'error',
      title: t('profileLogoCannotChange'),
      message,
    };
    if (owner) {
      await dialog.showMessageBox(owner, messageBoxOptions);
    } else {
      await dialog.showMessageBox(messageBoxOptions);
    }
    return {
      ok: false,
      message,
    };
  }
};

const execFileAsync = (file: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    execFile(file, args, (error) => (error ? reject(error) : resolve()));
  });

const hostMacAppPath = (): string => {
  const marker = '.app/Contents/MacOS/';
  const index = process.execPath.indexOf(marker);
  return index >= 0 ? process.execPath.slice(0, index + 4) : process.execPath;
};

const createProfileShortcut = async (
  name: string,
  options: IProfileShortcutOptions,
): Promise<IProfileOperationResult> => {
  const t = profileTranslator();
  const args = getLaunchArguments(name);
  const wantsDesktop = !!options.desktop;
  const wantsStartMenu = process.platform === 'win32' && !!options.startMenu;
  if (!wantsDesktop && !wantsStartMenu) {
    return { ok: false, message: t('profileShortcutNoTarget') };
  }
  try {
    const icon = prepareProfileShortcutIcon(name, options.localIconPath);
    if (process.platform === 'win32') {
      const details: Electron.ShortcutDetails = {
        target: process.execPath,
        args: args.map(quoteWindowsArgument).join(' '),
        description: shortcutBaseName(name),
        icon,
        iconIndex: 0,
      };
      const targets = [
        wantsDesktop ? desktopShortcutPath(name) : null,
        wantsStartMenu ? startMenuShortcutPath(name) : null,
      ].filter((target): target is string => !!target);
      for (const target of targets) {
        mkdirSync(dirname(target), { recursive: true });
        const operation: 'create' | 'update' = existsSync(target)
          ? 'update'
          : 'create';
        if (!shell.writeShortcutLink(target, operation, details)) {
          throw new Error(t('profileShortcutWriteFailed'));
        }
      }
    } else if (process.platform === 'darwin') {
      if (!wantsDesktop) {
        return { ok: false, message: t('profileShortcutStartMenuUnsupported') };
      }
      const target = desktopShortcutPath(name);
      mkdirSync(dirname(target), { recursive: true });
      const temp = join(
        app.getPath('desktop'),
        `.rainsee-profile-${process.pid}-${Date.now()}.app`,
      );
      const command = [
        '/usr/bin/open',
        '-na',
        shellQuote(hostMacAppPath()),
        '--args',
        ...args.map(shellQuote),
      ].join(' ');
      const script = `do shell script ${JSON.stringify(command)}`;
      await execFileAsync('/usr/bin/osacompile', ['-o', temp, '-e', script]);
      const iconSource = join(app.getAppPath(), 'static', 'icons', 'icon.icns');
      const iconTarget = join(temp, 'Contents', 'Resources', 'applet.icns');
      if (existsSync(iconSource) && existsSync(dirname(iconTarget))) {
        copyFileSync(iconSource, iconTarget);
      }
      const backup = `${target}.${process.pid}.backup`;
      if (existsSync(target)) renameSync(target, backup);
      try {
        renameSync(temp, target);
        rmSync(backup, { recursive: true, force: true });
      } catch (error) {
        try {
          rmSync(temp, { recursive: true, force: true });
        } catch {}
        if (existsSync(backup) && !existsSync(target))
          renameSync(backup, target);
        throw error;
      }
    } else {
      if (!wantsDesktop) {
        return { ok: false, message: t('profileShortcutStartMenuUnsupported') };
      }
      const target = desktopShortcutPath(name);
      mkdirSync(dirname(target), { recursive: true });
      const executable = quoteDesktopArgument(process.execPath);
      const launchArgs = args.map(quoteDesktopArgument).join(' ');
      const content = [
        '[Desktop Entry]',
        'Type=Application',
        `Name=${shortcutBaseName(name)}`,
        `Comment=${shortcutBaseName(name)}`,
        `Exec=${executable} ${launchArgs}`,
        `Icon=${icon}`,
        'Terminal=false',
        'Categories=Network;WebBrowser;',
        '',
      ].join('\n');
      writeAtomicFile(target, content, 0o755);
    }
    const message =
      wantsDesktop && wantsStartMenu
        ? t('profileShortcutAddedBoth')
        : wantsStartMenu
        ? t('profileShortcutAddedStartMenu')
        : t('profileShortcutAddedDesktop');
    return { ok: true, message };
  } catch (error: any) {
    console.error('[profiles] 创建小号快捷方式失败:', error);
    return { ok: false, message: error?.message || t('profileShortcutCreateFailed') };
  }
};

export const createProfileShortcuts = async (
  rawName: unknown,
  options?: IProfileShortcutOptions,
): Promise<IProfileOperationResult> => {
  const t = profileTranslator();
  const validation = validateProfileName(rawName);
  if (!validation.ok || !validation.name) {
    return { ok: false, message: t(validation.error!) };
  }
  const normalizedOptions: IProfileShortcutOptions = {
    desktop: !!options?.desktop,
    startMenu: !!options?.startMenu,
    localIconPath: options?.localIconPath,
  };
  try {
    return await withManagerLock(async () => {
      const actual = findProfileDirectoryName(validation.name || '');
      return actual
        ? createProfileShortcut(actual, normalizedOptions)
        : { ok: false, message: t('profileNotFoundDeleted') };
    });
  } catch (error) {
    return operationError(error, t('profileShortcutCreateFailed'));
  }
};

const removeProfileShortcut = (name: string) => {
  try {
    rmSync(desktopShortcutPath(name), { recursive: true, force: true });
    const startMenuPath = startMenuShortcutPath(name);
    if (startMenuPath) rmSync(startMenuPath, { force: true });
  } catch (error) {
    console.error('[profiles] 删除小号快捷方式失败:', error);
  }
};

const operationError = (
  error: any,
  fallback: string,
): IProfileOperationResult => ({
  ok: false,
  message: error?.message || fallback,
});

let setupComplete = false;

export const setupProfilesIpc = () => {
  if (setupComplete) return;
  setupComplete = true;
  mkdirSync(PROFILES_ROOT, { recursive: true });

  if (activeProfileName) {
    writeRuntimeMarker(activeProfileName, process.pid);
    const cleanup = () => removeRuntimeMarker(activeProfileName, process.pid);
    app.once('will-quit', cleanup);
    process.once('exit', cleanup);
  }

  ipcMain.handle('profiles-list', () => {
    const configuredRoot = readDataLocationPointer().current;
    if (
      typeof configuredRoot === 'string' &&
      !isSamePath(configuredRoot, BASE_USER_DATA)
    ) {
      console.error('[profiles] 自定义数据目录与当前数据根目录不一致:', {
        configuredRoot,
        activeRoot: BASE_USER_DATA,
        profilesRoot: PROFILES_ROOT,
        probeFailure: getLastDirectoryProbeFailure(),
      });
      return {
        currentProfile: activeProfileName,
        ok: false,
        profiles: [],
        error: profileTranslator()('profileCustomDataRootUnavailable', {
          path: configuredRoot,
        }),
      };
    }
    const result = listProfilesResult();
    console.info('[profiles] profiles-list IPC:', {
      root: PROFILES_ROOT,
      ok: result.ok,
      count: result.profiles.length,
    });
    return {
      currentProfile: activeProfileName,
      ...result,
    };
  });

  ipcMain.handle('profile-brand-get', () => readProfileBrand());
  ipcMain.handle('profile-brand-select', selectProfileLogo);

  ipcMain.handle(
    'profiles-create',
    async (_event, rawName: unknown, rawOptions?: unknown) => {
      const t = profileTranslator();
      const validation = validateProfileName(rawName);
      if (!validation.ok || !validation.name) {
        return {
          ok: false,
          message: t(validation.error!),
        } as IProfileOperationResult;
      }
      const name = validation.name;
      const legacyCloneAll =
        !!rawOptions &&
        typeof rawOptions === 'object' &&
        (rawOptions as {cloneMainData?: unknown}).cloneMainData === true;
      const rawCloneData =
        !!rawOptions && typeof rawOptions === 'object'
          ? (rawOptions as {cloneData?: unknown}).cloneData
          : null;
      const cloneDataRecord =
        rawCloneData && typeof rawCloneData === 'object'
          ? (rawCloneData as Record<string, unknown>)
          : {};
      const cloneOptions: IProfileDataCloneOptions = {
        bookmarks: legacyCloneAll || cloneDataRecord.bookmarks === true,
        passwords: legacyCloneAll || cloneDataRecord.passwords === true,
        history: legacyCloneAll || cloneDataRecord.history === true,
        extensions: legacyCloneAll || cloneDataRecord.extensions === true,
        settings: legacyCloneAll || cloneDataRecord.settings === true,
      };
      const shouldClone = Object.keys(cloneOptions).some(
        (key) => cloneOptions[key as keyof IProfileDataCloneOptions],
      );
      try {
        return await withManagerLock(async () => {
          if (findProfileDirectoryName(name)) {
            throw new Error(t('profileDuplicateName'));
          }
          const dir = join(PROFILES_ROOT, name);
          const staging = join(
            PROFILES_ROOT,
            `.creating-${process.pid}-${Date.now()}`,
          );
          try {
            mkdirSync(staging);
            writeFileSync(join(staging, 'onboarding-done'), '', 'utf8');
            writeFileSync(
              join(staging, PROFILE_ONBOARDING_SKIPPED_NOTICE),
              '',
              'utf8',
            );
            if (shouldClone) {
              try {
                await cloneMainProfileData(
                  BASE_USER_DATA,
                  staging,
                  cloneOptions,
                );
              } catch (error: any) {
                throw new Error(
                  t('profileCloneFailed', {
                    reason:
                      error?.message || t('profileCloneUnreadable'),
                  }),
                );
              }
            }
            renameSync(staging, dir);
          } catch (error) {
            try {
              rmSync(staging, { recursive: true, force: true });
            } catch {}
            throw error;
          }
          const launched = launchProfile(name);
          return launched.ok
            ? { ok: true, profile: { name, current: false, running: true } }
            : launched;
        });
      } catch (error) {
        return operationError(error, t('qmCreateFailed'));
      }
    },
  );

  ipcMain.handle('profiles-open', async (_event, rawName: unknown) => {
    const t = profileTranslator();
    const validation = validateProfileName(rawName);
    if (!validation.ok || !validation.name) {
      return {
        ok: false,
        message: t(validation.error!),
      } as IProfileOperationResult;
    }
    try {
      return await withManagerLock(() => {
        const actual = findProfileDirectoryName(validation.name || '');
        return actual
          ? launchProfile(actual)
          : { ok: false, message: t('profileNotFoundDeleted') };
      });
    } catch (error) {
      return operationError(error, t('qmOpenFailed'));
    }
  });

  ipcMain.handle('profiles-delete', async (_event, rawName: unknown) => {
    const t = profileTranslator();
    const validation = validateProfileName(rawName);
    if (!validation.ok || !validation.name) {
      return {
        ok: false,
        message: t(validation.error!),
      } as IProfileOperationResult;
    }
    try {
      return await withManagerLock(() => {
        const actual = findProfileDirectoryName(validation.name || '');
        if (!actual) return { ok: false, message: t('profileNotFoundDeleted') };
        if (isProfileRunning(actual)) {
          return { ok: false, message: t('qmDeleteRunning') };
        }

        const source = join(PROFILES_ROOT, actual);
        const tombstone = join(
          PROFILES_ROOT,
          `.deleting-${process.pid}-${Date.now()}`,
        );
        renameSync(source, tombstone);
        try {
          rmSync(tombstone, { recursive: true, force: true });
        } catch (error) {
          if (!existsSync(source) && existsSync(tombstone))
            renameSync(tombstone, source);
          throw error;
        }
        try {
          rmSync(runtimeProfileDir(actual), { recursive: true, force: true });
        } catch {}
        removeProfileShortcut(actual);
        return { ok: true, message: t('qmDeleted') };
      });
    } catch (error) {
      return operationError(error, t('qmDeleteFailed'));
    }
  });

  ipcMain.handle(
    'profiles-create-shortcut',
    (_event, rawName: unknown, options?: IProfileShortcutOptions) =>
      createProfileShortcuts(
        rawName,
        options || { desktop: true, startMenu: false },
      ),
  );
};
