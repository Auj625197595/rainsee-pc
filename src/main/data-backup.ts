import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { promises } from 'fs';
import { basename, dirname, join, resolve, sep } from 'path';
import type { MessageKey } from '~/common/i18n';
import { DATA_BACKUP_RESTORE_PLAN, SYSTEM_USERDATA } from './bootstrap-paths';
import { getMainTranslator } from './i18n';
import { Application } from './application';

// 备份弹窗与 IPC 回执文案按当前设置的语言即时创建翻译器,不缓存。
const dataBackupTranslator = () =>
  getMainTranslator(Application.instance.settings?.object?.language);

// jszip is already used by the main process for archive downloads. Keep this
// as require because its CommonJS export is not described consistently.
const JSZip: any = require('jszip');
// The history index belongs with the active browser data. Keep the old path
// as a read-only fallback so existing backup records survive this relocation.
const BACKUP_HISTORY_PATH = join(
  app.getPath('userData'),
  'data-backup-history.json',
);
const LEGACY_BACKUP_HISTORY_PATH = join(
  dirname(SYSTEM_USERDATA),
  `${basename(SYSTEM_USERDATA)}-backup-history.json`,
);

type BackupItem = 'bookmarks' | 'history' | 'passwords' | 'extensions';
type BackupMode = 'full' | 'selected';

interface BackupManifest {
  format: 'rainsee-data-backup';
  version: 1;
  mode: BackupMode;
  createdAt: string;
  items: BackupItem[];
  skippedFiles?: string[];
}

interface BackupHistoryEntry {
  path: string;
  name: string;
  mode: BackupMode;
  createdAt: string;
  size: number;
}

const BACKUP_ITEMS: BackupItem[] = [
  'bookmarks',
  'history',
  'passwords',
  'extensions',
];

// 还原确认弹窗里的分类名,复用设置页既有词条。
const ITEM_LABEL_KEYS: Record<BackupItem, MessageKey> = {
  bookmarks: 'bookmarks',
  history: 'menuHistory',
  passwords: 'sysPasswords',
  extensions: 'sysExtensions',
};

const itemPaths: Record<BackupItem, string[]> = {
  // 书签的站点图标一并保存，否则还原后书签栏会缺少图标。
  bookmarks: ['storage/bookmarks.db', 'storage/favicons.db'],
  history: ['storage/history.db'],
  // 密码保存在 formfill 数据库；云同步状态也需要保留，避免还原后重复上传。
  passwords: ['storage/formfill.db'],
  extensions: ['extensions'],
};

const normalizeItems = (items: unknown): BackupItem[] =>
  Array.from(
    new Set(
      (Array.isArray(items) ? items : []).filter((item): item is BackupItem =>
        BACKUP_ITEMS.includes(item as BackupItem),
      ),
    ),
  );

const zipPath = (...parts: string[]) => parts.join('/').replace(/\\/g, '/');

const isWithin = (root: string, path: string) =>
  path === root || path.startsWith(root + sep);

const isTransientReadError = (error: any) =>
  error?.code === 'EBUSY' || error?.code === 'EPERM';

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const copyFile = async (
  source: string,
  destination: string,
  archivePath: string,
  skippedFiles: string[],
) => {
  // Chromium keeps a few lock files and active databases open while the
  // browser is running. Retry briefly because those handles are often short
  // lived, then omit only the locked file instead of aborting the archive.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await promises.mkdir(dirname(destination), { recursive: true });
      await promises.copyFile(source, destination);
      return;
    } catch (error) {
      if (!isTransientReadError(error) || attempt === 2) {
        if (isTransientReadError(error)) {
          await promises
            .rm(destination, { force: true })
            .catch(() => undefined);
          skippedFiles.push(archivePath);
          console.warn('[data-backup] skipped busy file:', source);
          return;
        }
        throw error;
      }
      await wait(100 * (attempt + 1));
    }
  }
};

const copyDirectory = async (
  sourceRoot: string,
  destinationRoot: string,
  archiveRoot: string,
  skippedFiles: string[],
) => {
  const entries = await promises.readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    // Do not follow symlinks: a data backup must never unexpectedly include
    // files outside the selected data directory.
    if (entry.isSymbolicLink()) continue;
    const source = join(sourceRoot, entry.name);
    if (resolve(source) === resolve(BACKUP_HISTORY_PATH)) continue;
    const destination = join(destinationRoot, entry.name);
    const archivePath = zipPath(archiveRoot, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(source, destination, archivePath, skippedFiles);
    } else if (entry.isFile()) {
      await copyFile(source, destination, archivePath, skippedFiles);
    }
  }
};

const copyIfPresent = async (
  source: string,
  destination: string,
  archivePath: string,
  skippedFiles: string[],
) => {
  try {
    const stat = await promises.lstat(source);
    if (stat.isDirectory()) {
      await copyDirectory(source, destination, archivePath, skippedFiles);
    } else if (stat.isFile()) {
      await copyFile(source, destination, archivePath, skippedFiles);
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

const addFile = async (zip: any, source: string, target: string) => {
  zip.file(target, await promises.readFile(source));
};

const addDirectory = async (
  zip: any,
  sourceRoot: string,
  archiveRoot: string,
) => {
  const entries = await promises.readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const source = join(sourceRoot, entry.name);
    const target = zipPath(archiveRoot, entry.name);
    if (entry.isDirectory()) {
      zip.folder(target);
      await addDirectory(zip, source, target);
    } else if (entry.isFile()) {
      await addFile(zip, source, target);
    }
  }
};

const stageSelectedBackup = async (
  stageRoot: string,
  dataRoot: string,
  items: BackupItem[],
  skippedFiles: string[],
) => {
  for (const item of items) {
    for (const dataPath of itemPaths[item]) {
      await copyIfPresent(
        join(dataRoot, dataPath),
        join(stageRoot, dataPath),
        zipPath('selection', dataPath),
        skippedFiles,
      );
    }
  }

  if (items.includes('passwords')) {
    try {
      const cloudDir = join(dataRoot, 'cloud');
      const entries = await promises.readdir(cloudDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && /^password-sync-v3-.*\.json$/i.test(entry.name)) {
          await copyFile(
            join(cloudDir, entry.name),
            join(stageRoot, 'cloud', entry.name),
            zipPath('selection', 'cloud', entry.name),
            skippedFiles,
          );
        }
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  // Extension enablement and pinning live in settings.json. Preserve only
  // those fields so a selected extension restore does not replace all settings.
  if (items.includes('extensions')) {
    try {
      const raw = await promises.readFile(
        join(dataRoot, 'settings.json'),
        'utf8',
      );
      const settings = JSON.parse(raw);
      const extensionSettings = {
        disabledExtensions: settings.disabledExtensions,
        incognitoAllowedExtensions: settings.incognitoAllowedExtensions,
        pinnedExtensions: settings.pinnedExtensions,
        extensionGroups: settings.extensionGroups,
        extensionShortcuts: settings.extensionShortcuts,
        extensionsAutoUpdate: settings.extensionsAutoUpdate,
      };
      await promises.mkdir(stageRoot, { recursive: true });
      await promises.writeFile(
        join(stageRoot, 'extension-settings.json'),
        JSON.stringify(extensionSettings, null, 2),
      );
    } catch (error: any) {
      if (error?.code === 'ENOENT') return;
      if (isTransientReadError(error)) {
        skippedFiles.push('selection/extension-settings.json');
        console.warn(
          '[data-backup] skipped busy file:',
          join(dataRoot, 'settings.json'),
        );
        return;
      }
      throw error;
    }
  }
};

/*
 * The archive is built from a temporary copy. This prevents ZIP generation
 * from racing with Chromium's file handles and also gives us one place to
 * report files that could not be copied while in use.
 */
const createStagedData = async (
  dataRoot: string,
  mode: BackupMode,
  items: BackupItem[],
  skippedFiles: string[],
) => {
  const tempRoot = await promises.mkdtemp(
    join(app.getPath('temp'), 'rainsee-backup-'),
  );
  const stageRoot = join(tempRoot, mode === 'full' ? 'data' : 'selection');
  try {
    await promises.mkdir(stageRoot, { recursive: true });
    if (mode === 'full') {
      await copyDirectory(dataRoot, stageRoot, 'data', skippedFiles);
    } else {
      await stageSelectedBackup(stageRoot, dataRoot, items, skippedFiles);
    }
    return { tempRoot, stageRoot };
  } catch (error) {
    await promises
      .rm(tempRoot, { recursive: true, force: true })
      .catch(() => undefined);
    throw error;
  }
};

const addStagedDataToZip = async (
  zip: any,
  stageRoot: string,
  mode: BackupMode,
) => {
  await addDirectory(zip, stageRoot, mode === 'full' ? 'data' : 'selection');
};

const backupFileName = (mode: BackupMode) => {
  const t = dataBackupTranslator();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `rainsee-${
    mode === 'full' ? t('sysBackupFull') : t('sysBackupSelected')
  }-${timestamp}.zip`;
};

const readBackupHistoryFile = async (
  filePath: string,
): Promise<BackupHistoryEntry[]> => {
  try {
    const raw = await promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is BackupHistoryEntry =>
        entry &&
        typeof entry.path === 'string' &&
        typeof entry.name === 'string' &&
        (entry.mode === 'full' || entry.mode === 'selected') &&
        typeof entry.createdAt === 'string' &&
        typeof entry.size === 'number',
    );
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.warn('[data-backup] read history failed:', filePath, error);
    }
    return [];
  }
};

const readBackupHistory = async (): Promise<BackupHistoryEntry[]> => {
  const current = await readBackupHistoryFile(BACKUP_HISTORY_PATH);
  if (
    current.length ||
    resolve(BACKUP_HISTORY_PATH) === resolve(LEGACY_BACKUP_HISTORY_PATH)
  ) {
    return current;
  }
  const legacy = await readBackupHistoryFile(LEGACY_BACKUP_HISTORY_PATH);
  if (!legacy.length) return [];
  try {
    await promises.mkdir(dirname(BACKUP_HISTORY_PATH), { recursive: true });
    await promises.writeFile(
      BACKUP_HISTORY_PATH,
      JSON.stringify(legacy, null, 2),
      'utf8',
    );
    await promises.unlink(LEGACY_BACKUP_HISTORY_PATH).catch(() => undefined);
  } catch (error) {
    console.warn('[data-backup] migrate history failed:', error);
  }
  return legacy;
};

const rememberBackup = async (entry: BackupHistoryEntry) => {
  try {
    const history = await readBackupHistory();
    const next = [
      entry,
      ...history.filter((item) => resolve(item.path) !== resolve(entry.path)),
    ].slice(0, 20);
    await promises.mkdir(dirname(BACKUP_HISTORY_PATH), { recursive: true });
    await promises.writeFile(
      BACKUP_HISTORY_PATH,
      JSON.stringify(next, null, 2),
      'utf8',
    );
  } catch (error) {
    // A history index is auxiliary; failure to update it must not invalidate
    // an already-created backup archive.
    console.warn('[data-backup] write history failed:', error);
  }
};

const listRecentBackups = async () => {
  const history = await readBackupHistory();
  const existing: BackupHistoryEntry[] = [];
  for (const entry of history) {
    try {
      const stat = await promises.stat(entry.path);
      if (!stat.isFile()) continue;
      existing.push({ ...entry, size: stat.size });
    } catch {
      // Remove stale entries from the returned list; the next successful
      // backup will rewrite the persisted history without them.
    }
  }
  return existing
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5);
};

const uniquePath = async (directory: string, filename: string) => {
  const extensionIndex = filename.lastIndexOf('.');
  const name = filename.slice(0, extensionIndex);
  const extension = filename.slice(extensionIndex);
  let candidate = join(directory, filename);
  let index = 1;
  while (true) {
    try {
      await promises.access(candidate);
      candidate = join(directory, `${name} (${index})${extension}`);
      index += 1;
    } catch {
      return candidate;
    }
  }
};

const getOwner = (event: Electron.IpcMainInvokeEvent) =>
  BrowserWindow.fromWebContents(event.sender) ||
  BrowserWindow.getFocusedWindow();

const readManifest = async (filePath: string) => {
  const t = dataBackupTranslator();
  const content = await promises.readFile(filePath);
  const zip = await JSZip.loadAsync(content);
  const manifestEntry = zip.file('rainsee-backup.json');
  if (!manifestEntry) throw new Error(t('bkErrNoManifest'));
  const manifest = JSON.parse(
    await manifestEntry.async('text'),
  ) as BackupManifest;
  if (
    manifest?.format !== 'rainsee-data-backup' ||
    manifest?.version !== 1 ||
    (manifest.mode !== 'full' && manifest.mode !== 'selected')
  ) {
    throw new Error(t('bkErrUnsupported'));
  }
  const items = normalizeItems(manifest.items);
  if (manifest.mode === 'selected' && items.length === 0) {
    throw new Error(t('bkErrNoItems'));
  }
  return { zip, manifest: { ...manifest, items } };
};

const extractArchive = async (zip: any, stageRoot: string, prefix: string) => {
  const t = dataBackupTranslator();
  const root = resolve(stageRoot);
  const normalizedPrefix = `${prefix}/`;
  const fileNames = Object.keys(zip.files);
  for (const name of fileNames) {
    const entry = zip.files[name];
    if (entry.dir || !name.startsWith(normalizedPrefix)) continue;
    const pathInArchive = name.slice(normalizedPrefix.length);
    if (!pathInArchive || pathInArchive.split('/').includes('..')) {
      throw new Error(t('bkErrInvalidEntryPath'));
    }
    const destination = resolve(root, pathInArchive);
    if (!isWithin(root, destination)) throw new Error(t('bkErrEscapePath'));
    await promises.mkdir(dirname(destination), { recursive: true });
    await promises.writeFile(destination, await entry.async('nodebuffer'));
  }
};

const prepareRestore = async (filePath: string, manifest: BackupManifest) => {
  const { zip } = await readManifest(filePath);
  const tempRoot = await promises.mkdtemp(
    join(app.getPath('temp'), 'rainsee-restore-'),
  );
  const stageRoot = join(tempRoot, 'stage');
  await promises.mkdir(stageRoot, { recursive: true });
  await extractArchive(
    zip,
    stageRoot,
    manifest.mode === 'full' ? 'data' : 'selection',
  );
  await promises.mkdir(SYSTEM_USERDATA, { recursive: true });
  await promises.writeFile(
    DATA_BACKUP_RESTORE_PLAN,
    JSON.stringify({ stageRoot, mode: manifest.mode, items: manifest.items }),
    'utf8',
  );
};

export const setupDataBackupIpc = () => {
  ipcMain.handle(
    'data-backup-create',
    async (event, requestedMode: BackupMode, requestedItems?: BackupItem[]) => {
      const t = dataBackupTranslator();
      const mode: BackupMode =
        requestedMode === 'selected' ? 'selected' : 'full';
      const items =
        mode === 'selected' ? normalizeItems(requestedItems) : BACKUP_ITEMS;
      if (mode === 'selected' && items.length === 0) {
        return { status: 'error', message: t('bkErrEmptySelection') };
      }

      const owner = getOwner(event);
      const result = owner
        ? await dialog.showOpenDialog(owner, {
            title: t('bkChooseDirTitle'),
            defaultPath: app.getPath('downloads'),
            properties: ['openDirectory', 'createDirectory'],
          })
        : await dialog.showOpenDialog({
            title: t('bkChooseDirTitle'),
            defaultPath: app.getPath('downloads'),
            properties: ['openDirectory', 'createDirectory'],
          });
      if (result.canceled || !result.filePaths[0])
        return { status: 'cancelled' };

      try {
        const zip = new JSZip();
        const skippedFiles: string[] = [];
        const manifest: BackupManifest = {
          format: 'rainsee-data-backup',
          version: 1,
          mode,
          createdAt: new Date().toISOString(),
          items,
        };
        const dataRoot = app.getPath('userData');
        const staged = await createStagedData(
          dataRoot,
          mode,
          items,
          skippedFiles,
        );
        try {
          await addStagedDataToZip(zip, staged.stageRoot, mode);
        } finally {
          await promises
            .rm(staged.tempRoot, {
              recursive: true,
              force: true,
            })
            .catch(() => undefined);
        }
        if (skippedFiles.length) manifest.skippedFiles = skippedFiles;
        zip.file('rainsee-backup.json', JSON.stringify(manifest, null, 2));

        const filePath = await uniquePath(
          result.filePaths[0],
          backupFileName(mode),
        );
        await promises.writeFile(
          filePath,
          await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
          }),
        );
        const stat = await promises.stat(filePath);
        await rememberBackup({
          path: filePath,
          name: filePath.slice(filePath.lastIndexOf(sep) + 1),
          mode,
          createdAt: manifest.createdAt,
          size: stat.size,
        });
        return { status: 'ok', path: filePath, items, skippedFiles };
      } catch (error) {
        console.error('[data-backup] create failed:', error);
        return {
          status: 'error',
          message: t('bkCreateFailedFull'),
        };
      }
    },
  );

  ipcMain.handle('data-backup-list', async () => listRecentBackups());

  ipcMain.handle('data-backup-open-dir', async (_event, filePath: string) => {
    const t = dataBackupTranslator();
    if (typeof filePath !== 'string') {
      return { status: 'error', message: t('bkErrInvalidPath') };
    }
    const history = await readBackupHistory();
    const entry = history.find(
      (item) => resolve(item.path) === resolve(filePath),
    );
    if (!entry) return { status: 'error', message: t('bkErrNoRecord') };
    try {
      shell.showItemInFolder(entry.path);
      return { status: 'ok' };
    } catch (error) {
      console.error('[data-backup] open directory failed:', error);
      return { status: 'error', message: t('sysOpenDirFailed') };
    }
  });

  ipcMain.handle('data-backup-select-restore', async (event) => {
    const t = dataBackupTranslator();
    const owner = getOwner(event);
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          title: t('bkChooseFileTitle'),
          filters: [
            { name: t('bkFileFilterName'), extensions: ['zip'] },
          ],
          properties: ['openFile'],
        })
      : await dialog.showOpenDialog({
          title: t('bkChooseFileTitle'),
          filters: [
            { name: t('bkFileFilterName'), extensions: ['zip'] },
          ],
          properties: ['openFile'],
        });
    if (result.canceled || !result.filePaths[0]) return { status: 'cancelled' };
    try {
      const { manifest } = await readManifest(result.filePaths[0]);
      return {
        status: 'ok',
        path: result.filePaths[0],
        mode: manifest.mode,
        items: manifest.items,
        createdAt: manifest.createdAt,
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: error?.message || t('sysRestoreReadFailed'),
      };
    }
  });

  ipcMain.handle('data-backup-restore', async (event, filePath: string) => {
    const t = dataBackupTranslator();
    try {
      const { manifest } = await readManifest(filePath);
      const labels =
        manifest.mode === 'full'
          ? t('bkRestoreAllData')
          : manifest.items
              .map((item) => t(ITEM_LABEL_KEYS[item]))
              .join(t('listSeparator'));
      const owner = getOwner(event);
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        title: t('bkRestoreConfirmTitle'),
        message: t('bkRestoreWarnMessage'),
        detail: t('bkRestoreWarnDetail', { items: labels }),
        buttons: [t('bkOverwriteRestore'), t('cancel')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      };
      const response = owner
        ? await dialog.showMessageBox(owner, options)
        : await dialog.showMessageBox(options);
      if (response.response !== 0) return { status: 'cancelled' };

      await prepareRestore(filePath, manifest);
      return { status: 'ok', items: manifest.items };
    } catch (error: any) {
      console.error('[data-backup] restore failed:', error);
      return {
        status: 'error',
        message: error?.message || t('bkRestoreFailed'),
      };
    }
  });

  ipcMain.on('data-backup-relaunch', () => {
    app.relaunch();
    app.quit();
  });
};
