import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join, resolve, sep } from 'path';
import { promises } from 'fs';
import { pathToFileURL } from 'url';

import {
  DATA_LOCATION_POINTER,
  pendingMigration,
  readDataLocationPointer,
  writeDataLocationPointer,
} from './bootstrap-paths';

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
  try {
    const { mkdirSync, writeFileSync, unlinkSync } = require('fs');
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, '.write-probe');
    writeFileSync(probe, '');
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
};

const isPointerFile = (absPath: string): boolean => absPath === DATA_LOCATION_POINTER;

// ---------- 递归字节统计(仅 stat,不读内容) ----------
const dirSize = async (root: string, shouldSkip: (p: string) => boolean): Promise<number> => {
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

const dirHasRealContent = async (dir: string): Promise<boolean> => {
  try {
    const entries = await promises.readdir(dir);
    return entries.some((n) => n !== 'data-location.json');
  } catch {
    return false;
  }
};

// ---------- 校验目标目录合法性 ----------
const norm = (p: string) => {
  let n = resolve(p);
  // 去掉末尾分隔符,统一比较
  while (n.length > 1 && (n.endsWith(sep) || n.endsWith('/') || n.endsWith('\\'))) {
    n = n.slice(0, -1);
  }
  return n;
};

const isSystemDir = (target: string): boolean => {
  const t = norm(target).toLowerCase();
  const blockers = new Set<string>();
  try { blockers.add(norm(app.getPath('appData')).toLowerCase()); } catch {}
  try { blockers.add(norm(app.getPath('home')).toLowerCase()); } catch {}
  try { blockers.add(norm(app.getPath('temp')).toLowerCase()); } catch {}
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
  if (!newDir) return { ok: false, reason: '未选择目录' };
  const target = norm(newDir);
  const cur = norm(currentDir);
  if (!target) return { ok: false, reason: '目录路径无效' };
  if (target === cur) return { ok: false, reason: '新目录与当前数据目录相同,无需迁移' };

  const targetPrefix = target + sep;
  const curPrefix = cur + sep;
  // 新目录是当前目录的上级 → 复制会把目标自身卷进去(目标在源的下层会递归)。
  if (cur === target || curPrefix.startsWith(targetPrefix)) {
    return { ok: false, reason: '新目录不能是当前数据目录,也不能是它的上级目录(会递归复制)' };
  }
  // 新目录位于当前目录内 → 源包含目标,递归复制。
  if (targetPrefix.startsWith(curPrefix)) {
    return { ok: false, reason: '新目录不能位于当前数据目录内(会递归复制)' };
  }
  if (isSystemDir(target)) {
    return { ok: false, reason: '不能使用系统关键目录(系统盘根 / Windows / Program Files / 用户主目录等)' };
  }
  if (!isDirWritable(target)) {
    return { ok: false, reason: '目录不可写(权限不足或不可达)' };
  }
  return { ok: true };
};

const checkDiskSpace = async (
  target: string,
  requiredBytes: number,
): Promise<string | null> => {
  try {
    const stat: any = await (promises as any).statfs(target);
    const avail = (stat.bavail || 0) * (stat.bsize || 0);
    if (avail > 0 && avail < requiredBytes) {
      const needMB = Math.ceil(requiredBytes / 1024 / 1024);
      const haveMB = Math.floor(avail / 1024 / 1024);
      return `目标磁盘剩余空间不足(数据约 ${needMB} MB,目标可用约 ${haveMB} MB),迁移可能失败`;
    }
  } catch {
    // statfs 取不到(平台/权限),不阻断。
  }
  return null;
};

// ---------- 进度窗 ----------
const createMigrationWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    title: '正在迁移数据',
    width: 540,
    height: 280,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    center: true,
    alwaysOnTop: true,
    backgroundColor: '#1c1c1c',
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  const url = pathToFileURL(
    join(__dirname, '..', 'static', 'pages', 'data-migrating.html'),
  ).href;
  win.loadURL(url);
  // 阻止用户在迁移期间关窗(迁移必须完成)。
  win.on('close', (e) => {
    e.preventDefault();
  });
  return win;
};

// ---------- 递归复制(带进度) ----------
const copyDirWithProgress = async (
  from: string,
  to: string,
  onProgress: (copied: number, currentFile: string) => void,
  shouldSkip: (absPath: string) => boolean,
): Promise<{ copiedBytes: number; fileCount: number }> => {
  let copiedBytes = 0;
  let fileCount = 0;
  let lastEmit = 0;

  const walk = async (src: string, dst: string) => {
    await promises.mkdir(dst, { recursive: true });
    const entries = await promises.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const s = join(src, entry.name);
      const d = join(dst, entry.name);
      if (shouldSkip(s)) continue;
      if (entry.isDirectory()) {
        await walk(s, d);
      } else if (entry.isFile()) {
        await promises.copyFile(s, d);
        try {
          const st = await promises.stat(s);
          copiedBytes += st.size;
        } catch {
          // stat 失败不计字节,不影响复制
        }
        fileCount++;
        const now = Date.now();
        if (now - lastEmit > 150) {
          lastEmit = now;
          onProgress(copiedBytes, entry.name);
        }
      } else if (entry.isSymbolicLink()) {
        try {
          const target = await promises.readlink(s);
          await promises.symlink(target, d);
        } catch {
          // 符号链接复制失败忽略
        }
      }
    }
  };

  await walk(from, to);
  onProgress(copiedBytes, '');
  return { copiedBytes, fileCount };
};

// ---------- 执行单次迁移 ----------
const performMigration = async (from: string, to: string): Promise<void> => {
  const totalBytes = await dirSize(from, isPointerFile);
  console.log(`[data-location] 开始迁移: ${from} → ${to} (约 ${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);

  const win = createMigrationWindow();

  // 等待页面就绪(兜底超时 1.5s)
  await new Promise<void>((resolveShow) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolveShow(); } };
    win.once('ready-to-show', () => {
      try { win.show(); } catch {}
      finish();
    });
    setTimeout(finish, 1500);
  });

  try {
    try {
      win.webContents.send('migration-meta', { totalBytes, from, to });
    } catch {}

    const onProgress = (copied: number, file: string) => {
      try {
        win.webContents.send('migration-progress', { copied, total: totalBytes, file });
      } catch {}
    };

    const wasEmpty = !(await dirHasRealContent(to));

    try {
      const { fileCount } = await copyDirWithProgress(from, to, onProgress, isPointerFile);
      console.log(`[data-location] 复制完成,共 ${fileCount} 个文件`);
    } catch (e) {
      // 迁移前 to 为空/不存在 → 清理半成品,避免残留被当作"已有数据"。
      if (wasEmpty) {
        try { await promises.rm(to, { recursive: true, force: true }); } catch {}
      }
      throw e;
    }

    // 切换 userData + 写指针(current=to, 清 pending)
    writeDataLocationPointer({ current: to, pending: null });
    app.setPath('userData', to);

    try { win.webContents.send('migration-done', { totalBytes }); } catch {}
    // 短暂展示「完成」态
    await new Promise<void>((r) => setTimeout(r, 700));
    console.log(`[data-location] 迁移完成并已切换 userData → ${to}`);
  } finally {
    // 解除关窗拦截并关闭
    win.removeAllListeners('close');
    try { win.close(); } catch {}
  }
};

// ---------- 入口:有 pending 则迁移,否则直接放行 gate ----------
export const runPendingMigrationIfAny = async (): Promise<void> => {
  const pending = pendingMigration;
  if (!pending) {
    migrationGate.resolve();
    return;
  }
  try {
    await performMigration(pending.from, pending.to);
    migrationGate.resolve();
  } catch (e: any) {
    console.error('[data-location] 迁移失败,回退到旧目录:', e);
    // 回退:指针 current 仍指 from,清 pending;userData 在 bootstrap 已设为 from,不动。
    try {
      writeDataLocationPointer({ current: pending.from, pending: null });
    } catch {}
    migrationGate.resolve();
    try {
      dialog.showMessageBox({
        type: 'error',
        title: '数据迁移失败',
        message: `迁移数据到 ${pending.to} 失败,数据仍保留在原位置 ${pending.from}。`,
        detail: typeof e?.message === 'string' ? e.message : String(e),
        buttons: ['确定'],
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
    return { current: app.getPath('userData'), pending };
  });

  // 选目录 + 校验 + 写 pending。结果交 renderer 决定是否立即重启。
  ipcMain.handle('data-location-change', async () => {
    const current = app.getPath('userData');
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择数据存储位置',
      defaultPath: current,
      properties: ['openDirectory'],
    });
    if (canceled || !filePaths || !filePaths[0]) return { status: 'cancelled' };

    const newDir = filePaths[0];
    const v = validateDataDir(newDir, current);
    if (!v.ok) return { status: 'error', message: v.reason };

    // 目标非空(且非仅有指针文件)→ 警告但不阻断
    let existingNote: string | null = null;
    try {
      const entries = await promises.readdir(newDir);
      const real = entries.filter((n) => n !== 'data-location.json');
      if (real.length > 0) {
        existingNote = `目标目录非空(已有 ${real.length} 项),迁移可能与既有文件混存。`;
      }
    } catch {
      // 目标不存在属正常(迁移时创建)
    }

    // 磁盘空间预估
    const required = await dirSize(current, isPointerFile);
    const spaceWarn = await checkDiskSpace(newDir, required);

    // 写 pending
    writeDataLocationPointer({ current, pending: { from: current, to: newDir } });

    return {
      status: 'ok',
      pending: { from: current, to: newDir },
      existingNote,
      spaceWarn,
      requiredBytes: required,
    };
  });

  // 立即重启执行迁移
  ipcMain.on('data-location-relaunch', () => {
    try {
      app.relaunch();
    } catch {}
    app.exit(0);
  });

  // 取消待迁移
  ipcMain.on('data-location-cancel', () => {
    const ptr = readDataLocationPointer();
    writeDataLocationPointer({ current: ptr.current || null, pending: null });
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
