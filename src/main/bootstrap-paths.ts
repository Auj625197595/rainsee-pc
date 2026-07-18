import { app } from 'electron';
import { join, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';

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
const isDirWritable = (dir: string): boolean => {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, '.write-probe');
    writeFileSync(probe, '');
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
};

// =====================================================================
// 自定义数据目录:指针文件存放在系统默认 AppData(永不动摇的固定位置)。
// 关键约束:这个「数据目录设置项」绝不能存在 data 里——否则用户改目录时
// 指向新目录的设置会被一并带走、造成失联。SYSTEM_USERDATA 在任何 setPath
// 之前捕获,app.getPath('appData') 又不受 setPath('userData',…) 影响,
// 故此位置永不随用户迁移数据而移动。
// =====================================================================
export const SYSTEM_USERDATA = app.getPath('userData');
export const DATA_LOCATION_POINTER = join(SYSTEM_USERDATA, 'data-location.json');

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
  try {
    mkdirSync(SYSTEM_USERDATA, { recursive: true });
    writeFileSync(DATA_LOCATION_POINTER, JSON.stringify(ptr, null, 2));
  } catch (e) {
    // 指针写失败是致命的(会导致下次启动无法定位数据目录);尽量抛出让上层感知。
    console.error('[bootstrap] 写 data-location 指针失败:', e);
  }
};

const pointer = readDataLocationPointer();

// pending:用户已选好新目录并确认迁移,等下次启动执行。此时 userData 先停在 from,
// 由 data-location.ts 在 app.ready 之后真正复制 from→to 并切换。
export const pendingMigration: { from: string; to: string } | null =
  pointer.pending && typeof pointer.pending.from === 'string' && typeof pointer.pending.to === 'string'
    ? { from: pointer.pending.from, to: pointer.pending.to }
    : null;

const PORTABLE_MARKER = 'portable.txt';

if (process.env.NODE_ENV === 'development') {
  // 开发模式:data 放在项目根目录(cwd)下。
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
    console.log('[bootstrap] 安装包模式,使用系统 AppData:', app.getPath('userData'));
  }
}

// =====================================================================
// 在 dev/portable/installer 默认决策之后,再用指针覆盖:
//   - 有 pending 且 from 可读、to 可写 → userData = from(等迁移)
//   - 否则有 current 且可写 → userData = current
//   - 脏 pending(目标不可达等)→ 清理指针,沿用上面算出的默认 userData
// =====================================================================
if (pendingMigration && existsSync(pendingMigration.from) && isDirWritable(pendingMigration.to)) {
  app.setPath('userData', pendingMigration.from);
  console.log('[bootstrap] 检测到待迁移数据,先停在旧目录:', pendingMigration.from);
} else if (pointer.current && typeof pointer.current === 'string' && isDirWritable(pointer.current)) {
  app.setPath('userData', pointer.current);
  // 清掉脏 pending(若有),保留有效的 current。
  if (pointer.pending) {
    writeDataLocationPointer({ current: pointer.current });
  }
} else if (pendingMigration || pointer.current) {
  // 指针存在但目标都不可用:清理以免每次启动卡在坏指针上。
  console.error('[bootstrap] data-location 指针无效,清理并沿用默认 userData:', pointer);
  writeDataLocationPointer({});
}
