import {promises} from 'fs';
import {dirname, join} from 'path';

const EXTENSION_STATE_FILES = [
  'crx-dnr-rules.json',
  'crx-permissions.json',
  'crx-dynamic-content-scripts.json',
  'crx-user-scripts.json',
  'privacy-settings.json',
  'font-settings.json',
];

export interface IProfileDataCloneOptions {
  bookmarks: boolean;
  passwords: boolean;
  history: boolean;
  extensions: boolean;
  settings: boolean;
}

const readOptionalFile = async (path: string): Promise<string | null> => {
  try {
    return await promises.readFile(path, 'utf8');
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const writeJsonSnapshot = async (source: string, destination: string) => {
  const raw = await readOptionalFile(source);
  if (raw === null) return;

  const value = JSON.parse(raw);
  await promises.mkdir(dirname(destination), {recursive: true});
  await promises.writeFile(destination, JSON.stringify(value, null, 2), 'utf8');
};

const writeNedbSnapshot = async (
  source: string,
  destination: string,
  filter?: (record: Record<string, any>) => boolean,
) => {
  const raw = await readOptionalFile(source);
  if (raw === null) return;

  // NeDB 是一行一个 JSON 记录。主账号仍在写入时，文件末尾可能恰好被读到
  // 半行；只保留完整记录，避免新小号首次加载数据库时整库解析失败。
  const records: string[] = [];
  const compacted = new Map<string, Record<string, any>>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (!filter) {
        records.push(line);
      } else if (record && typeof record._id === 'string') {
        if (record.$$deleted === true) compacted.delete(record._id);
        else compacted.set(record._id, record);
      }
    } catch {
      // 不完整或损坏的行不进入克隆快照。
    }
  }

  if (filter) {
    for (const record of compacted.values()) {
      if (filter(record)) records.push(JSON.stringify(record));
    }
  }

  await promises.mkdir(dirname(destination), {recursive: true});
  await promises.writeFile(
    destination,
    records.length ? `${records.join('\n')}\n` : '',
    'utf8',
  );
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await promises.access(path);
    return true;
  } catch {
    return false;
  }
};

const copyDirectory = async (source: string, destination: string) => {
  await promises.mkdir(destination, {recursive: true});
  const entries = await promises.readdir(source, {withFileTypes: true});

  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await promises.copyFile(sourcePath, destinationPath);
    }
    // 不跟随符号链接，防止拓展目录把克隆范围带到主数据目录之外。
  }
};

const copyInstalledExtensions = async (
  sourceRoot: string,
  destinationRoot: string,
) => {
  const sourceExtensions = join(sourceRoot, 'extensions');
  let entries: import('fs').Dirent[];
  try {
    entries = await promises.readdir(sourceExtensions, {withFileTypes: true});
  } catch (error: any) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const source = join(sourceExtensions, entry.name);
    if (!(await pathExists(join(source, 'manifest.json')))) continue;
    await copyDirectory(source, join(destinationRoot, 'extensions', entry.name));
  }
};

/**
 * 克隆主账号中用户明确选择的可迁移数据。不复制 Cookie、缓存、下载记录、
 * Chromium 网站存储或账号身份文件。
 */
export const cloneMainProfileData = async (
  sourceRoot: string,
  destinationRoot: string,
  options: IProfileDataCloneOptions,
): Promise<void> => {
  if (options.settings) {
    await writeJsonSnapshot(
      join(sourceRoot, 'settings.json'),
      join(destinationRoot, 'settings.json'),
    );
  }

  if (options.bookmarks) {
    await writeNedbSnapshot(
      join(sourceRoot, 'storage', 'bookmarks.db'),
      join(destinationRoot, 'storage', 'bookmarks.db'),
    );
  }

  if (options.passwords) {
    await writeNedbSnapshot(
      join(sourceRoot, 'storage', 'formfill.db'),
      join(destinationRoot, 'storage', 'formfill.db'),
      (record) => record.type === 'password',
    );
  }

  if (options.history) {
    await writeNedbSnapshot(
      join(sourceRoot, 'storage', 'history.db'),
      join(destinationRoot, 'storage', 'history.db'),
    );
  }

  if (options.bookmarks || options.history) {
    await writeNedbSnapshot(
      join(sourceRoot, 'storage', 'favicons.db'),
      join(destinationRoot, 'storage', 'favicons.db'),
    );
  }

  if (options.extensions) {
    await copyInstalledExtensions(sourceRoot, destinationRoot);
    for (const filename of EXTENSION_STATE_FILES) {
      await writeJsonSnapshot(
        join(sourceRoot, filename),
        join(destinationRoot, filename),
      );
    }
  }
};
