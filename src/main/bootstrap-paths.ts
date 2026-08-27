import { app } from 'electron';
import { dirname, join, resolve } from 'path';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { parseProfileArgument } from '~/common/profiles';

// `npm run build && npm start` 会把 NODE_ENV 编译为 production,但 Electron
// 进程仍是未打包的本地开发实例。必须以 isPackaged 区分它与安装版,否则两者会
// 共用 AppData 目录和 Chromium 的单实例锁,从而把安装版启动请求交给本地实例。
export const isLocalDevelopment = app.isPackaged === false;

// 必须在任何业务模块(尤其是会同步读取 getPath('userData') 的 Settings)被 import
// 之前执行。ES 模块的 import 会先于模块体语句求值,而 Application 在 import 阶段就
// 静态构造 Settings 并同步解析 userData 路径。若 setPath 晚于这些 import,Settings
// 会落到 Electron 默认的 AppData 目录,而 extensions 等在 onReady 中较晚解析的路径
// 又落到 data 目录,两者不一致会导致设置(含 disabledExtensions)读写错乱、丢失。

// 与 package.json 的 name('wexond')无关:固定中文名,保证默认路径与显示名一致。
export const isNightly = app.name === '雨见浏览器-nightly';
app.name = isNightly ? '雨见浏览器 Nightly' : '雨见浏览器';

// 真实写探针:尝试在 dir 内创建并写入一个临时文件,成功才认为该目录对当前进程可写。
// 不能用 fs.accessSync(dir, W_OK):Windows 上它对 ACL 的判断不可靠,Program Files
// 下非管理员也可能被误报为「可写」,于是把 userData 指向不可写的 exe/data,后续所有
// 写入(settings/storage/extensions/logs)全部 EPERM,应用打不开(管理员能写故正常)。
export interface IDirectoryProbeFailure {
  dir: string;
  code?: string;
  message: string;
}

let lastDirectoryProbeFailure: IDirectoryProbeFailure | null = null;

export const getLastDirectoryProbeFailure = (): IDirectoryProbeFailure | null =>
  lastDirectoryProbeFailure;

const isDirWritable = (dir: string): boolean => {
  const probe = join(
    dir,
    `.write-probe-${process.pid}-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`,
  );
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(probe, '');
  } catch (error: any) {
    lastDirectoryProbeFailure = {
      dir,
      code: error?.code,
      message: error?.message || String(error),
    };
    console.error('[bootstrap] 数据目录写探针失败:', lastDirectoryProbeFailure);
    try {
      unlinkSync(probe);
    } catch {}
    return false;
  }
  lastDirectoryProbeFailure = null;
  try {
    unlinkSync(probe);
  } catch (error) {
    // 写入已经成功，清理失败不代表目录不可写。探针带有进程/时间后缀，
    // 留下单个文件不会影响下次启动，也不会与其他进程互相删除。
    console.warn('[bootstrap] 清理数据目录可写探针失败:', probe, error);
  }
  return true;
};

// =====================================================================
// 自定义数据目录:指针文件存放在系统默认 AppData(永不动摇的固定位置)。
// 关键约束:这个「数据目录设置项」绝不能存在 data 里——否则用户改目录时
// 指向新目录的设置会被一并带走、造成失联。SYSTEM_USERDATA 在任何 setPath
// 之前捕获,app.getPath('appData') 又不受 setPath('userData',…) 影响,
// 故此位置永不随用户迁移数据而移动。
// =====================================================================
// 不直接复用 getPath('userData'):它既可被 setPath 改写,默认值又依赖应用名称的
// 初始化时机。显式用 appData + 固定产品目录,保证正式安装包每次启动都从同一处
// 读取指针。
export const SYSTEM_USERDATA = join(
  isLocalDevelopment ? resolve(process.cwd(), '.rainsee-dev') : app.getPath('appData'),
  isNightly ? '雨见浏览器 Nightly' : '雨见浏览器',
);
export const DATA_LOCATION_POINTER = join(
  SYSTEM_USERDATA,
  'data-location.json',
);
// 还原操作由运行中的主进程解压到系统临时目录，再在下一次启动、Chromium
// 尚未打开 Cookie/LevelDB 文件前执行覆盖。计划文件必须放在稳定目录，不能放在
// 可被完整还原覆盖的 userData 中。
export const DATA_BACKUP_RESTORE_PLAN = join(
  SYSTEM_USERDATA,
  'data-backup-restore.json',
);

export interface IDataLocationPointer {
  current?: string | null;
  pending?: { from: string; to: string } | null;
}

export const readDataLocationPointer = (): IDataLocationPointer => {
  try {
    const raw = readFileSync(DATA_LOCATION_POINTER, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj;
  } catch {
    // 文件不存在/损坏:视为无覆盖。
  }
  return {};
};

export const writeDataLocationPointer = (ptr: IDataLocationPointer): void => {
  const tempFile = `${DATA_LOCATION_POINTER}.${process.pid}.tmp`;
  try {
    mkdirSync(SYSTEM_USERDATA, { recursive: true });
    writeFileSync(tempFile, JSON.stringify(ptr, null, 2), 'utf8');
    renameSync(tempFile, DATA_LOCATION_POINTER);
  } catch (e) {
    try {
      rmSync(tempFile, { force: true });
    } catch {}
    // 指针写失败是致命的(会导致下次启动无法定位数据目录),必须抛给上层,
    // 不能让设置页显示成功后重启到默认目录。
    console.error('[bootstrap] 写 data-location 指针失败:', e);
    throw e;
  }
};

const pointer = readDataLocationPointer();
const requestedProfile = parseProfileArgument(process.argv);

export let profileStartupError: string | null = requestedProfile.error || null;
export let activeProfileName: string | null = requestedProfile.name;

// pending:用户已选好新目录并确认迁移,等下次启动在 Electron ready 之前执行。
export let pendingMigration: { from: string; to: string } | null =
  pointer.pending &&
  typeof pointer.pending.from === 'string' &&
  typeof pointer.pending.to === 'string'
    ? { from: pointer.pending.from, to: pointer.pending.to }
    : null;

export interface IStartupMigrationFailure {
  from: string;
  to: string;
  error: string;
}

// data-location.ts 在 app ready 后读取并向用户提示。真正复制必须在 ready 之前完成,
// 否则 Chromium 已打开 Cookie/Local Storage/扩展 LevelDB,Windows 下复制会遇到锁
// 文件或得到不一致快照。
export let startupMigrationFailure: IStartupMigrationFailure | null = null;

const dirHasRealContent = (dir: string): boolean => {
  try {
    return readdirSync(dir).some(
      (name) =>
        name !== 'data-location.json' && !name.startsWith('.write-probe'),
    );
  } catch {
    return false;
  }
};

const copyDataDirSync = (from: string, to: string): void => {
  const walk = (src: string, dst: string) => {
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const source = join(src, entry.name);
      const destination = join(dst, entry.name);
      if (
        source === DATA_LOCATION_POINTER ||
        entry.name.startsWith('.write-probe')
      )
        continue;

      if (entry.isDirectory()) {
        walk(source, destination);
      } else if (entry.isFile()) {
        copyFileSync(source, destination);
      } else if (entry.isSymbolicLink()) {
        try {
          symlinkSync(readlinkSync(source), destination);
        } catch {
          // Windows 下无创建符号链接权限时忽略;符号链接不承载浏览器持久数据。
        }
      }
    }
  };

  walk(from, to);
};

interface IBackupRestorePlan {
  stageRoot: string;
  mode: 'full' | 'selected';
  items: Array<'bookmarks' | 'history' | 'passwords' | 'extensions'>;
}

const readBackupRestorePlan = (): IBackupRestorePlan | null => {
  try {
    const plan = JSON.parse(readFileSync(DATA_BACKUP_RESTORE_PLAN, 'utf8'));
    if (
      !plan ||
      typeof plan.stageRoot !== 'string' ||
      (plan.mode !== 'full' && plan.mode !== 'selected') ||
      !Array.isArray(plan.items)
    ) {
      return null;
    }
    return plan;
  } catch {
    return null;
  }
};

const clearDirectorySync = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(dir)) {
    rmSync(join(dir, entry), { recursive: true, force: true });
  }
};

// 只在启动早期运行：此时数据文件尚未被 Chromium 或 NeDB 打开，Windows 下可以
// 可靠覆盖 Cookies、扩展 LevelDB 等运行时会锁定的文件。
const applyPendingBackupRestore = (dataRoot: string) => {
  const plan = readBackupRestorePlan();
  if (!plan || requestedProfile.present) return;
  if (!existsSync(plan.stageRoot)) {
    try {
      unlinkSync(DATA_BACKUP_RESTORE_PLAN);
    } catch {}
    return;
  }

  const rollbackRoot = `${plan.stageRoot}-rollback`;
  const selectedPaths: Record<string, string[]> = {
    bookmarks: ['storage/bookmarks.db', 'storage/favicons.db'],
    history: ['storage/history.db'],
    passwords: ['storage/formfill.db'],
    extensions: ['extensions'],
  };
  try {
    rmSync(rollbackRoot, { recursive: true, force: true });
    copyDataDirSync(dataRoot, rollbackRoot);

    if (plan.mode === 'full') {
      clearDirectorySync(dataRoot);
      copyDataDirSync(plan.stageRoot, dataRoot);
    } else {
      for (const item of plan.items) {
        for (const relativePath of selectedPaths[item] || []) {
          const source = join(plan.stageRoot, relativePath);
          if (!existsSync(source)) continue;
          const target = join(dataRoot, relativePath);
          rmSync(target, { recursive: true, force: true });
          if (statSync(source).isDirectory()) copyDataDirSync(source, target);
          else {
            mkdirSync(dirname(target), { recursive: true });
            copyFileSync(source, target);
          }
        }
      }

      if (plan.items.includes('passwords')) {
        const cloudDir = join(plan.stageRoot, 'cloud');
        if (existsSync(cloudDir)) copyDataDirSync(cloudDir, join(dataRoot, 'cloud'));
      }
      if (plan.items.includes('extensions')) {
        const settingsPatch = join(plan.stageRoot, 'extension-settings.json');
        const settingsPath = join(dataRoot, 'settings.json');
        if (existsSync(settingsPatch) && existsSync(settingsPath)) {
          const current = JSON.parse(readFileSync(settingsPath, 'utf8'));
          const patch = JSON.parse(readFileSync(settingsPatch, 'utf8'));
          writeFileSync(settingsPath, JSON.stringify({...current, ...patch}), 'utf8');
        }
      }
    }

    // 自定义数据目录有 settings 镜像。将刚还原的版本同步过去，避免随后按
    // mtime 比较时把旧的镜像反向覆盖回来。
    const settingsPath = join(dataRoot, 'settings.json');
    const mirrorPath = join(SYSTEM_USERDATA, 'settings.json');
    if (existsSync(settingsPath) && settingsPath !== mirrorPath) {
      copyFileSync(settingsPath, mirrorPath);
    }
    unlinkSync(DATA_BACKUP_RESTORE_PLAN);
    rmSync(plan.stageRoot, { recursive: true, force: true });
    rmSync(rollbackRoot, { recursive: true, force: true });
    console.log('[bootstrap] 数据备份还原完成:', plan.mode, plan.items);
  } catch (error) {
    console.error('[bootstrap] 数据备份还原失败，尝试恢复原数据:', error);
    try {
      clearDirectorySync(dataRoot);
      if (existsSync(rollbackRoot)) copyDataDirSync(rollbackRoot, dataRoot);
    } catch (rollbackError) {
      console.error('[bootstrap] 回滚还原数据失败:', rollbackError);
    }
  }
};

const isSamePath = (left: string, right: string): boolean => {
  const normalize = (value: string) => {
    const resolved = resolve(value).replace(/\\/g, '/');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
};

interface ISettingsSnapshot {
  path: string;
  content: string;
  modifiedAt: number;
}

const readSettingsSnapshot = (path: string): ISettingsSnapshot | null => {
  try {
    const content = readFileSync(path, 'utf8');
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return {path, content, modifiedAt: statSync(path).mtimeMs};
  } catch {
    return null;
  }
};

const writeSettingsSnapshot = (path: string, content: string): void => {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(temp, content, 'utf8');
    renameSync(temp, path);
  } catch (error) {
    try {
      rmSync(temp, {force: true});
    } catch {}
    throw error;
  }
};

// 自定义目录与系统 AppData 各保存一份 settings.json。启动时只接受可解析的
// JSON，冲突时选择更新时间更晚的一份修复另一份，避免覆盖安装或异常退出后
// 因单份设置缺失而回落默认值。
export const syncSettingsMirror = (): void => {
  const current = app.getPath('userData');
  const configured = readDataLocationPointer().current;
  if (
    typeof configured !== 'string' ||
    !isSamePath(configured, current) ||
    isSamePath(current, SYSTEM_USERDATA)
  ) {
    return;
  }

  const currentPath = join(current, 'settings.json');
  const mirrorPath = join(SYSTEM_USERDATA, 'settings.json');
  const currentSnapshot = readSettingsSnapshot(currentPath);
  const mirrorSnapshot = readSettingsSnapshot(mirrorPath);
  if (!currentSnapshot && !mirrorSnapshot) return;

  const winner =
    !mirrorSnapshot ||
    (currentSnapshot && currentSnapshot.modifiedAt >= mirrorSnapshot.modifiedAt)
      ? currentSnapshot
      : mirrorSnapshot;
  if (!winner) return;

  const target = winner.path === currentPath ? mirrorPath : currentPath;
  try {
    writeSettingsSnapshot(target, winner.content);
  } catch (error) {
    // 镜像失败不能阻止启动；Settings.save 会在之后的每次正常保存再次尝试同步。
    console.error('[bootstrap] 同步 settings.json 镜像失败:', error);
  }
};

const PORTABLE_MARKER = 'portable.txt';

if (isLocalDevelopment) {
  // 未打包的本地运行(包括 production webpack 构建后的 `npm start`)统一将
  // data 放在项目根目录,不读取安装版的数据目录指针。
  const dataDir = resolve(process.cwd(), 'data');
  if (isDirWritable(dataDir)) {
    app.setPath('userData', dataDir);
  } else {
    console.error('[bootstrap] dev data dir 不可写,沿用默认 userData');
  }
} else {
  // 打包模式:
  // - dist zip 绿色版:打包时带上 cwd/portable.txt,数据写到 cwd/data。
  // - 其余打包产物(无 portable.txt):沿用 Electron 默认 userData(系统 AppData)。
  const cwd = process.cwd();
  const forcePortable = existsSync(join(cwd, PORTABLE_MARKER));

  if (forcePortable) {
    const dataDir = resolve(cwd, 'data');
    if (isDirWritable(dataDir)) {
      app.setPath('userData', dataDir);
      console.log('[bootstrap] portable 模式,数据存放在:', dataDir);
    } else {
      console.error('[bootstrap] portable data dir 不可写,沿用默认 userData');
    }
  } else {
    console.log(
      '[bootstrap] 安装包模式,使用系统 AppData:',
      app.getPath('userData'),
    );
  }
}

// 指针覆盖前记录本运行形态的默认目录。设置页“恢复默认”必须回到这里，
// 而不是一律回到系统 AppData（便携版和开发版的默认位置是 cwd/data）。
export const DEFAULT_USER_DATA = app.getPath('userData');

// =====================================================================
// 在 dev/portable/installer 默认决策之后,再用指针覆盖:
//   - 有 pending 且 from 可读、to 可写 → ready 前复制完成并切到 to
//   - 否则有 current 且可写 → userData = current
//   - 脏 pending(目标不可达等)→ 清理指针,沿用上面算出的默认 userData
// =====================================================================
if (
  !isLocalDevelopment &&
  !requestedProfile.present &&
  pendingMigration &&
  existsSync(pendingMigration.from) &&
  isDirWritable(pendingMigration.to)
) {
  const { from, to } = pendingMigration;
  const targetWasEmpty = !dirHasRealContent(to);
  try {
    console.log('[bootstrap] ready 前迁移数据:', from, '→', to);
    copyDataDirSync(from, to);
    // 先持久化指针,成功后才切路径。任何失败都继续使用旧目录。
    writeDataLocationPointer({ current: to, pending: null });
    app.setPath('userData', to);
    console.log('[bootstrap] 数据迁移完成,userData:', to);
  } catch (e: any) {
    if (targetWasEmpty) {
      try {
        rmSync(to, { recursive: true, force: true });
      } catch {}
    }
    try {
      writeDataLocationPointer({ current: from, pending: null });
    } catch {}
    app.setPath('userData', from);
    startupMigrationFailure = {
      from,
      to,
      error: typeof e?.message === 'string' ? e.message : String(e),
    };
    console.error('[bootstrap] 数据迁移失败,继续使用旧目录:', e);
  }
  // 迁移已经在 ready 前完成或回退;禁止 ready 后再次复制活动中的配置文件。
  pendingMigration = null;
} else if (
  !isLocalDevelopment &&
  pointer.current &&
  typeof pointer.current === 'string' &&
  isDirWritable(pointer.current)
) {
  app.setPath('userData', pointer.current);
  // 清掉脏 pending(若有),保留有效的 current。
  if (pointer.pending && !requestedProfile.present) {
    try {
      writeDataLocationPointer({ current: pointer.current });
    } catch {}
  }
} else if (
  !isLocalDevelopment &&
  !requestedProfile.present &&
  (pendingMigration || pointer.current)
) {
  // 指针存在但目标暂时不可用时保留指针。D 盘短暂离线、唤醒或被安全软件
  // 占用不应把用户永久切到一个没有小号数据的 AppData 空目录；下次启动
  // 目标恢复后仍可继续使用原目录。
  console.error(
    '[bootstrap] data-location 指针暂时不可用,保留指针并沿用默认 userData:',
    { pointer, probeFailure: lastDirectoryProbeFailure },
  );
}

applyPendingBackupRestore(app.getPath('userData'));

// 小号只读取主数据目录的稳定 current,绝不执行或改写全局迁移。迁移计划存在时
// 拒绝启动小号,避免主实例复制 profiles 时仍有 Cookie/LevelDB 文件被占用。
export const BASE_USER_DATA = app.getPath('userData');
export const PROFILES_ROOT = join(BASE_USER_DATA, 'profiles');

if (requestedProfile.present) {
  if (pointer.pending) {
    profileStartupError = '主账号正在等待迁移数据目录，请先完成或取消迁移';
  }

  if (!activeProfileName) {
    profileStartupError = profileStartupError || '小号启动参数无效';
  }

  const profileDir = activeProfileName
    ? join(PROFILES_ROOT, activeProfileName)
    : '';
  if (
    !profileStartupError &&
    (!existsSync(profileDir) || !isDirWritable(profileDir))
  ) {
    profileStartupError = '该小号不存在、已被删除或数据目录不可写';
  }

  if (profileStartupError) {
    activeProfileName = null;
    const rejectedDir = join(
      app.getPath('temp'),
      'rainsee-rejected-profile',
      String(process.pid),
    );
    mkdirSync(rejectedDir, { recursive: true });
    app.setPath('userData', rejectedDir);
    app.setPath('sessionData', rejectedDir);
  } else {
    app.setPath('userData', profileDir);
    app.setPath('sessionData', profileDir);
  }
} else {
  // 仅主账号的自定义数据目录启用镜像；小号配置天然独立，不能混入主账号设置。
  syncSettingsMirror();
}

// Chromium 的 sessionData 必须与最终 userData 一起切换。launcher 为取得稳定
// 单实例锁会短暂改写两者，bootstrap 完成便携/自定义目录/迁移/profile 决策后，
// 这里统一落到真实数据目录，避免缓存和扩展分区写回默认 AppData。
app.setPath('sessionData', app.getPath('userData'));
