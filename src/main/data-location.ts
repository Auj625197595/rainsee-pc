import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { dirname, join, resolve, sep } from 'path';
import { promises } from 'fs';

import {
  DATA_LOCATION_POINTER,
  DEFAULT_USER_DATA,
  activeProfileName,
  readDataLocationPointer,
  startupMigrationFailure,
  writeDataLocationPointer,
} from './bootstrap-paths';
import { getRunningProfileNames } from './profiles';
import { getMainTranslator } from './i18n';
import { Application } from './application';

// 原生弹窗/IPC 回执文案按当前设置的语言即时创建翻译器,不缓存。
const dataLocationTranslator = () =>
  getMainTranslator(Application.instance.settings?.object?.language);

// =====================================================================
// 迁移 gate:Settings.load() 与 onReady() 都 await 它,确保迁移(若有)在
// Application 打开任何数据文件之前完成。runPendingMigrationIfAny() 负责 resolve。
// resolve 永远调用(失败也 resolve 并回退到旧目录),绝不 reject——reject 会让
// Settings/onReady 抛错导致启动崩溃。
// =====================================================================
export const migrationGate: {
  promise: Promise<void>;
  resolve: () => void;
  reject: (e: any) => void;
} = {} as any;
migrationGate.promise = new Promise<void>((res, rej) => {
  migrationGate.resolve = res;
  migrationGate.reject = rej;
});

// ---------- 目录可写探针(与 bootstrap-paths 同款,真实写文件而非 accessSync) ----------
const isDirWritable = (dir: string): boolean => {
  const probe = join(
    dir,
    `.write-probe-${process.pid}-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`,
  );
  try {
    const { mkdirSync, writeFileSync, unlinkSync } = require('fs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(probe, '');
  } catch (error: any) {
    console.error('[data-location] 目录写探针失败:', {
      dir,
      code: error?.code,
      message: error?.message || String(error),
    });
    try {
      require('fs').unlinkSync(probe);
    } catch {}
    return false;
  }
  try {
    require('fs').unlinkSync(probe);
  } catch (error) {
    console.warn('[data-location] 清理目录可写探针失败:', probe, error);
  }
  return true;
};

const isPointerFile = (absPath: string): boolean =>
  absPath === DATA_LOCATION_POINTER;

// ---------- 递归字节统计(仅 stat,不读内容) ----------
const dirSize = async (
  root: string,
  shouldSkip: (p: string) => boolean,
): Promise<number> => {
  let total = 0;
  const walk = async (d: string) => {
    let entries: import('fs').Dirent[];
    try {
      entries = await promises.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (shouldSkip(p)) continue;
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile()) {
        try {
          const st = await promises.stat(p);
          total += st.size;
        } catch {
          // 单文件 stat 失败忽略
        }
      }
    }
  };
  await walk(root);
  return total;
};

// ---------- 校验目标目录合法性 ----------
const norm = (p: string) => {
  let n = resolve(p);
  // 去掉末尾分隔符,统一比较
  while (
    n.length > 1 &&
    (n.endsWith(sep) || n.endsWith('/') || n.endsWith('\\'))
  ) {
    n = n.slice(0, -1);
  }
  return n;
};

const isSamePath = (left: string, right: string): boolean => {
  const a = norm(left);
  const b = norm(right);
  return process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
};

const isInInstallDir = (target: string): boolean => {
  const normalizeForComparison = (value: string) => {
    const normalized = norm(value);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const selected = normalizeForComparison(target);
  const installDir = normalizeForComparison(dirname(app.getPath('exe')));
  return selected === installDir || selected.startsWith(`${installDir}${sep}`);
};

const isSystemDir = (target: string): boolean => {
  const t = norm(target).toLowerCase();
  const blockers = new Set<string>();
  try {
    blockers.add(norm(app.getPath('appData')).toLowerCase());
  } catch {}
  try {
    blockers.add(norm(app.getPath('home')).toLowerCase());
  } catch {}
  try {
    blockers.add(norm(app.getPath('temp')).toLowerCase());
  } catch {}
  if (process.platform === 'win32') {
    blockers.add('c:\\');
    blockers.add('c:\\windows');
    blockers.add('c:\\program files');
    blockers.add('c:\\program files (x86)');
    blockers.add('c:\\users');
  }
  if (blockers.has(t)) return true;
  // Windows 任意盘根(如 D:\)过宽,拒绝;允许盘下的具体目录。
  if (process.platform === 'win32' && /^[a-z]:\\$/.test(t)) return true;
  return false;
};

export const validateDataDir = (
  newDir: string,
  currentDir: string,
): { ok: boolean; reason?: string } => {
  const t = dataLocationTranslator();
  if (!newDir) return { ok: false, reason: t('dlocErrNoDirSelected') };
  const target = norm(newDir);
  const cur = norm(currentDir);
  if (!target) return { ok: false, reason: t('dlocErrInvalidPath') };
  if (target === cur)
    return { ok: false, reason: t('dlocErrSameDir') };

  const targetPrefix = target + sep;
  const curPrefix = cur + sep;
  // 新目录是当前目录的上级 → 复制会把目标自身卷进去(目标在源的下层会递归)。
  if (cur === target || curPrefix.startsWith(targetPrefix)) {
    return {
      ok: false,
      reason: t('dlocErrParentDir'),
    };
  }
  // 新目录位于当前目录内 → 源包含目标,递归复制。
  if (targetPrefix.startsWith(curPrefix)) {
    return { ok: false, reason: t('dlocErrInsideCurrent') };
  }
  if (isSystemDir(target)) {
    return {
      ok: false,
      reason: t('dlocErrSystemDir'),
    };
  }
  if (!isDirWritable(target)) {
    return { ok: false, reason: t('dlocErrNotWritable') };
  }
  return { ok: true };
};

const checkDiskSpace = async (
  target: string,
  requiredBytes: number,
): Promise<string | null> => {
  const t = dataLocationTranslator();
  try {
    const stat: any = await (promises as any).statfs(target);
    const avail = (stat.bavail || 0) * (stat.bsize || 0);
    if (avail > 0 && avail < requiredBytes) {
      const needMB = Math.ceil(requiredBytes / 1024 / 1024);
      const haveMB = Math.floor(avail / 1024 / 1024);
      return t('dlocSpaceWarnN', { need: needMB, have: haveMB });
    }
  } catch {
    // statfs 取不到(平台/权限),不阻断。
  }
  return null;
};

const scheduleDataLocationMigration = async (
  current: string,
  target: string,
) => {
  const t = dataLocationTranslator();
  const validation = validateDataDir(target, current);
  if (!validation.ok)
    return { status: 'error' as const, message: validation.reason };

  // 目标非空(且非仅有指针文件)→ 警告但不阻断。
  let existingNote: string | null = null;
  try {
    const entries = await promises.readdir(target);
    const real = entries.filter(
      (name) =>
        name !== 'data-location.json' && !name.startsWith('.write-probe'),
    );
    if (real.length > 0) {
      existingNote = t('dlocExistingNoteN', { count: real.length });
    }
  } catch {
    // 目标不存在属正常(迁移时创建)。
  }

  const required = await dirSize(current, isPointerFile);
  const spaceWarn = await checkDiskSpace(target, required);

  try {
    writeDataLocationPointer({
      current,
      pending: { from: current, to: target },
    });
  } catch {
    return {
      status: 'error' as const,
      message: t('dlocErrSavePointer'),
    };
  }

  return {
    status: 'ok' as const,
    pending: { from: current, to: target },
    existingNote,
    spaceWarn,
    requiredBytes: required,
  };
};

// ---------- 入口:复制已在 bootstrap 的 ready 前阶段完成,这里负责放行与错误提示 ----------
export const runPendingMigrationIfAny = async (): Promise<void> => {
  migrationGate.resolve();
  if (startupMigrationFailure) {
    try {
      // 此时尚未读到设置语言,回退系统 locale(与启动外观同策略)。
      const t = dataLocationTranslator();
      dialog.showMessageBox({
        type: 'error',
        title: t('dlocMigrationFailedTitle'),
        message: t('dlocMigrationFailedBody', {
          to: startupMigrationFailure.to,
          from: startupMigrationFailure.from,
        }),
        detail: startupMigrationFailure.error,
        buttons: [t('confirm')],
      });
    } catch {}
  }
};

// ---------- IPC ----------
export const setupDataLocationIpc = () => {
  // 查询当前数据目录 + 待迁移计划(每次读磁盘指针,设置页据此显示「已计划」态)
  ipcMain.handle('data-location-get', () => {
    const ptr = readDataLocationPointer();
    const pending =
      ptr.pending && ptr.pending.from && ptr.pending.to
        ? { from: ptr.pending.from, to: ptr.pending.to }
        : null;
    return {
      current: app.getPath('userData'),
      defaultPath: DEFAULT_USER_DATA,
      isDefault: isSamePath(app.getPath('userData'), DEFAULT_USER_DATA),
      pending: activeProfileName ? null : pending,
      canChange: !activeProfileName,
      profileName: activeProfileName,
    };
  });

  // 选目录 + 校验 + 写 pending。结果交 renderer 决定是否立即重启。
  ipcMain.handle('data-location-change', async (event) => {
    const t = dataLocationTranslator();
    if (activeProfileName) {
      return {
        status: 'error',
        message: t('dlocAltManagedByMain'),
      };
    }
    const runningProfiles = getRunningProfileNames();
    if (runningProfiles.length > 0) {
      return {
        status: 'error',
        message: t('dlocCloseRunningProfiles', {
          names: runningProfiles.join(t('listSeparator')),
        }),
      };
    }
    const current = app.getPath('userData');
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: t('dlocChooseDialogTitle'),
      defaultPath: current,
      properties: ['openDirectory'],
    });
    if (canceled || !filePaths || !filePaths[0]) return { status: 'cancelled' };

    const newDir = filePaths[0];
    if (isInInstallDir(newDir)) {
      const owner =
        BrowserWindow.fromWebContents(event.sender) ||
        BrowserWindow.getFocusedWindow();
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        title: t('dlocDataLossTitle'),
        message: t('dlocInInstallDirMsg'),
        detail: t('dlocInInstallDirDetail'),
        buttons: [t('dlocKeepUsing'), t('cancel')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      };
      const { response } = owner
        ? await dialog.showMessageBox(owner, options)
        : await dialog.showMessageBox(options);
      if (response !== 0) return { status: 'cancelled' };
    }

    return scheduleDataLocationMigration(current, newDir);
  });

  // 将自定义数据目录迁回当前运行形态的默认位置。
  ipcMain.handle('data-location-reset', async () => {
    const t = dataLocationTranslator();
    if (activeProfileName) {
      return {
        status: 'error',
        message: t('dlocAltManagedByMain'),
      };
    }
    const runningProfiles = getRunningProfileNames();
    if (runningProfiles.length > 0) {
      return {
        status: 'error',
        message: t('dlocCloseRunningProfiles', {
          names: runningProfiles.join(t('listSeparator')),
        }),
      };
    }
    const current = app.getPath('userData');
    if (isSamePath(current, DEFAULT_USER_DATA)) {
      return { status: 'error', message: t('dlocAlreadyDefault') };
    }
    return scheduleDataLocationMigration(current, DEFAULT_USER_DATA);
  });

  // 立即重启执行迁移
  ipcMain.on('data-location-relaunch', async (event) => {
    if (activeProfileName) return;
    const runningProfiles = getRunningProfileNames();
    if (runningProfiles.length > 0) {
      const owner =
        BrowserWindow.fromWebContents(event.sender) ||
        BrowserWindow.getFocusedWindow();
      const t = dataLocationTranslator();
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        title: t('dlocCannotMigrateNow'),
        message: t('dlocCloseAltWindows'),
        detail: t('dlocStillRunning', {
          names: runningProfiles.join(t('listSeparator')),
        }),
        buttons: [t('confirm')],
      };
      if (owner) await dialog.showMessageBox(owner, options);
      else await dialog.showMessageBox(options);
      return;
    }
    try {
      app.relaunch();
    } catch {}
    // 正常退出会等待现有 before-quit 清理,让 Cookie/LevelDB/数据库先完整落盘。
    // relaunch 会在当前进程真正退出后再启动新进程。
    app.quit();
  });

  // 取消待迁移
  ipcMain.on('data-location-cancel', () => {
    if (activeProfileName) return;
    const ptr = readDataLocationPointer();
    try {
      writeDataLocationPointer({ current: ptr.current || null, pending: null });
    } catch (e) {
      console.error('[data-location] 取消迁移时写指针失败:', e);
    }
  });

  // 在系统文件管理器中打开当前数据目录(设置页「打开目录」入口)。
  ipcMain.on('data-location-open-dir', async (_e, dir?: string) => {
    try {
      await shell.openPath(dir || app.getPath('userData'));
    } catch {
      // best-effort
    }
  });
};
