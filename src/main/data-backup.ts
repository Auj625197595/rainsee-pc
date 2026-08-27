import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { promises } from 'fs';
import { dirname, join, resolve, sep } from 'path';
import { DATA_BACKUP_RESTORE_PLAN, SYSTEM_USERDATA } from './bootstrap-paths';

// jszip is already used by the main process for archive downloads. Keep this
// as require because its CommonJS export is not described consistently.
const JSZip: any = require('jszip');

type BackupItem = 'bookmarks' | 'history' | 'passwords' | 'extensions';
type BackupMode = 'full' | 'selected';

interface BackupManifest {
  format: 'rainsee-data-backup';
  version: 1;
  mode: BackupMode;
  createdAt: string;
  items: BackupItem[];
}

const BACKUP_ITEMS: BackupItem[] = [
  'bookmarks',
  'history',
  'passwords',
  'extensions',
];

const ITEM_LABELS: Record<BackupItem, string> = {
  bookmarks: '书签',
  history: '历史记录',
  passwords: '密码',
  extensions: '扩展程序',
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

const addFile = async (zip: any, source: string, target: string) => {
  const content = await promises.readFile(source);
  zip.file(target, content);
};

const addDirectory = async (zip: any, sourceRoot: string, archiveRoot: string) => {
  const entries = await promises.readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    // Do not follow symlinks: a data backup must never unexpectedly include
    // files outside the selected data directory.
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

const addIfPresent = async (zip: any, source: string, target: string) => {
  try {
    const stat = await promises.lstat(source);
    if (stat.isDirectory()) {
      zip.folder(target);
      await addDirectory(zip, source, target);
    } else if (stat.isFile()) {
      await addFile(zip, source, target);
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

const backupFileName = (mode: BackupMode) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `rainsee-${mode === 'full' ? '完整' : '可选'}备份-${timestamp}.zip`;
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
  BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();

const addSelectedBackup = async (
  zip: any,
  dataRoot: string,
  items: BackupItem[],
) => {
  for (const item of items) {
    for (const dataPath of itemPaths[item]) {
      await addIfPresent(zip, join(dataRoot, dataPath), zipPath('selection', dataPath));
    }
  }

  if (items.includes('passwords')) {
    try {
      const cloudDir = join(dataRoot, 'cloud');
      const entries = await promises.readdir(cloudDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isFile() &&
          /^password-sync-v3-.*\.json$/i.test(entry.name)
        ) {
          await addFile(
            zip,
            join(cloudDir, entry.name),
            zipPath('selection', 'cloud', entry.name),
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
      const raw = await promises.readFile(join(dataRoot, 'settings.json'), 'utf8');
      const settings = JSON.parse(raw);
      const extensionSettings = {
        disabledExtensions: settings.disabledExtensions,
        incognitoAllowedExtensions: settings.incognitoAllowedExtensions,
        pinnedExtensions: settings.pinnedExtensions,
        extensionGroups: settings.extensionGroups,
        extensionShortcuts: settings.extensionShortcuts,
        extensionsAutoUpdate: settings.extensionsAutoUpdate,
      };
      zip.file(
        'selection/extension-settings.json',
        JSON.stringify(extensionSettings, null, 2),
      );
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
};

const readManifest = async (filePath: string) => {
  const content = await promises.readFile(filePath);
  const zip = await JSZip.loadAsync(content);
  const manifestEntry = zip.file('rainsee-backup.json');
  if (!manifestEntry) throw new Error('未找到雨见备份清单');
  const manifest = JSON.parse(await manifestEntry.async('text')) as BackupManifest;
  if (
    manifest?.format !== 'rainsee-data-backup' ||
    manifest?.version !== 1 ||
    (manifest.mode !== 'full' && manifest.mode !== 'selected')
  ) {
    throw new Error('不是受支持的雨见备份文件');
  }
  const items = normalizeItems(manifest.items);
  if (manifest.mode === 'selected' && items.length === 0) {
    throw new Error('备份文件未包含可还原的数据');
  }
  return { zip, manifest: {...manifest, items} };
};

const extractArchive = async (
  zip: any,
  stageRoot: string,
  prefix: string,
) => {
  const root = resolve(stageRoot);
  const normalizedPrefix = `${prefix}/`;
  const fileNames = Object.keys(zip.files);
  for (const name of fileNames) {
    const entry = zip.files[name];
    if (entry.dir || !name.startsWith(normalizedPrefix)) continue;
    const pathInArchive = name.slice(normalizedPrefix.length);
    if (!pathInArchive || pathInArchive.split('/').includes('..')) {
      throw new Error('备份文件包含无效路径');
    }
    const destination = resolve(root, pathInArchive);
    if (!isWithin(root, destination)) throw new Error('备份文件包含越界路径');
    await promises.mkdir(dirname(destination), { recursive: true });
    await promises.writeFile(destination, await entry.async('nodebuffer'));
  }
};

const prepareRestore = async (filePath: string, manifest: BackupManifest) => {
  const { zip } = await readManifest(filePath);
  const tempRoot = await promises.mkdtemp(join(app.getPath('temp'), 'rainsee-restore-'));
  const stageRoot = join(tempRoot, 'stage');
  await promises.mkdir(stageRoot, { recursive: true });
  await extractArchive(zip, stageRoot, manifest.mode === 'full' ? 'data' : 'selection');
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
      const mode: BackupMode = requestedMode === 'selected' ? 'selected' : 'full';
      const items = mode === 'selected' ? normalizeItems(requestedItems) : BACKUP_ITEMS;
      if (mode === 'selected' && items.length === 0) {
        return { status: 'error', message: '请至少选择一项要备份的数据' };
      }

      const owner = getOwner(event);
      const result = owner
        ? await dialog.showOpenDialog(owner, {
            title: '选择备份保存位置',
            defaultPath: app.getPath('downloads'),
            properties: ['openDirectory', 'createDirectory'],
          })
        : await dialog.showOpenDialog({
            title: '选择备份保存位置',
            defaultPath: app.getPath('downloads'),
            properties: ['openDirectory', 'createDirectory'],
          });
      if (result.canceled || !result.filePaths[0]) return { status: 'cancelled' };

      try {
        const zip = new JSZip();
        const manifest: BackupManifest = {
          format: 'rainsee-data-backup',
          version: 1,
          mode,
          createdAt: new Date().toISOString(),
          items,
        };
        zip.file('rainsee-backup.json', JSON.stringify(manifest, null, 2));
        const dataRoot = app.getPath('userData');
        if (mode === 'full') await addDirectory(zip, dataRoot, 'data');
        else await addSelectedBackup(zip, dataRoot, items);

        const filePath = await uniquePath(result.filePaths[0], backupFileName(mode));
        await promises.writeFile(
          filePath,
          await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
        );
        return { status: 'ok', path: filePath, items };
      } catch (error) {
        console.error('[data-backup] create failed:', error);
        return { status: 'error', message: '创建备份失败，请检查目录权限和剩余空间' };
      }
    },
  );

  ipcMain.handle('data-backup-select-restore', async (event) => {
    const owner = getOwner(event);
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          title: '选择雨见备份文件',
          filters: [{ name: '雨见备份文件', extensions: ['zip'] }],
          properties: ['openFile'],
        })
      : await dialog.showOpenDialog({
          title: '选择雨见备份文件',
          filters: [{ name: '雨见备份文件', extensions: ['zip'] }],
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
      return { status: 'error', message: error?.message || '无法读取备份文件' };
    }
  });

  ipcMain.handle('data-backup-restore', async (event, filePath: string) => {
    try {
      const { manifest } = await readManifest(filePath);
      const labels =
        manifest.mode === 'full'
          ? '全部数据（包括 Cookie、书签、历史、密码和扩展）'
          : manifest.items.map((item) => ITEM_LABELS[item]).join('、');
      const owner = getOwner(event);
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        title: '确认覆盖还原',
        message: '即将覆盖当前数据',
        detail: `将还原：${labels}。当前对应数据会被覆盖，此操作无法撤销；还原完成后需要立即重启浏览器。`,
        buttons: ['覆盖并还原', '取消'],
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
      return { status: 'error', message: error?.message || '还原失败，请稍后重试' };
    }
  });

  ipcMain.on('data-backup-relaunch', () => {
    app.relaunch();
    app.quit();
  });
};
