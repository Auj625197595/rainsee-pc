// 从本机浏览器读取书签并归一化为 node-bookmarks-parser 的 Bookmark[] 形状，
// 交给渲染层 addImported 路由：nsRoot==='toolbar' → 书签栏(static main)；
// 'menu' / 'unsorted' → 其它文件夹(static other)。
//
// 注意：addImported 对 nsRoot 做真值判断(if(item.nsRoot))，所以非工具栏根必须用
// 真值('menu'/'unsorted')，不能用 null —— null 会落入普通书签分支并以 parent=null
// 调 addBookmark，抛 "Parent bookmark should be specified"。

// node-bookmarks-parser 的 Bookmark 类型未从包根导出（其 index.d.ts 仅导出解析函数），
// 这里按 build/interfaces/bookmark.d.ts 局部重声明，字段保持一致。
export interface Bookmark {
  title?: string;
  url?: string;
  type?: 'folder' | 'bookmark';
  children?: Bookmark[];
  nsRoot?: 'menu' | 'toolbar' | 'unsorted' | null;
  icon?: string;
}

export type BrowserId = 'chrome' | 'edge' | 'firefox';

export interface DetectedBrowsers {
  chrome: boolean;
  edge: boolean;
  firefox: boolean;
}

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ===== 路径解析（Windows 优先；本应用为 Windows 目标）=====

const localAppData = () => process.env.LOCALAPPDATA || '';
const appData = () => process.env.APPDATA || '';

const CHROMIUM_DIRS: Record<'chrome' | 'edge', string> = {
  chrome: join(localAppData(), 'Google', 'Chrome', 'User Data'),
  edge: join(localAppData(), 'Microsoft', 'Edge', 'User Data'),
};

const firefoxDir = () => join(appData(), 'Mozilla', 'Firefox');

// ===== 检测 =====

const exists = (p: string) => {
  try {
    return !!p && existsSync(p);
  } catch {
    return false;
  }
};

export const detectBrowsers = async (): Promise<DetectedBrowsers> => {
  const chromeBookmarks = join(CHROMIUM_DIRS.chrome, 'Default', 'Bookmarks');
  const edgeBookmarks = join(CHROMIUM_DIRS.edge, 'Default', 'Bookmarks');
  const firefoxIni = join(firefoxDir(), 'profiles.ini');

  // 检测以"该浏览器数据存在"为准；即便用户用的不是 Default 配置，User Data 目录
  // 本身存在即认为装了 Chrome，再交给读取阶段挑 profile。
  const chromeInstalled = exists(CHROMIUM_DIRS.chrome) || exists(chromeBookmarks);
  const edgeInstalled = exists(CHROMIUM_DIRS.edge) || exists(edgeBookmarks);
  const firefoxInstalled = exists(firefoxIni);

  return {
    chrome: chromeInstalled,
    edge: edgeInstalled,
    firefox: firefoxInstalled,
  };
};

// ===== Chromium（Chrome / Edge）=====

// 选 profile：优先 Local State 的 profile.last_used（且其 Bookmarks 存在），
// 否则 Default，否则首个 "Profile *" 目录。
const pickChromiumProfile = (userDataDir: string): string | null => {
  const candidates: string[] = [];

  try {
    const localStatePath = join(userDataDir, 'Local State');
    if (existsSync(localStatePath)) {
      const j = JSON.parse(readFileSync(localStatePath, 'utf8'));
      const lu = j?.profile?.last_used;
      if (typeof lu === 'string' && lu) candidates.push(lu);
    }
  } catch {
    // Local State 损坏不影响后续兜底
  }

  candidates.push('Default');

  try {
    readdirSync(userDataDir).forEach((name) => {
      if (/^Profile /.test(name)) candidates.push(name);
    });
  } catch {
    // 目录不可读则只能依赖 Default
  }

  for (const c of candidates) {
    if (c && existsSync(join(userDataDir, c, 'Bookmarks'))) return c;
  }
  return null;
};

const mapChromiumChildren = (nodes: any[]): Bookmark[] => {
  const out: Bookmark[] = [];
  if (!Array.isArray(nodes)) return out;

  for (const node of nodes) {
    if (!node) continue;
    if (node.type === 'url') {
      if (node.url) {
        out.push({ type: 'bookmark', title: node.name || node.url, url: node.url });
      }
    } else if (node.type === 'folder') {
      out.push({
        type: 'folder',
        title: node.name || '文件夹',
        children: mapChromiumChildren(node.children),
      });
    }
    // separator 等忽略
  }

  return out;
};

const readChromium = (vendor: 'chrome' | 'edge'): Bookmark[] => {
  const userDataDir = CHROMIUM_DIRS[vendor];
  if (!exists(userDataDir)) {
    throw new Error('BROWSER_NOT_FOUND');
  }

  const profile = pickChromiumProfile(userDataDir);
  if (!profile) {
    throw new Error('PROFILE_NOT_FOUND');
  }

  let json: any;
  try {
    json = JSON.parse(readFileSync(join(userDataDir, profile, 'Bookmarks'), 'utf8'));
  } catch (err) {
    throw new Error('PARSE_FAILED: ' + (err as Error).message);
  }

  const roots = json?.roots;
  if (!roots) throw new Error('PARSE_FAILED: 缺少 roots');

  const sections: Bookmark[] = [];

  // 书签栏 → 书签栏(main)
  if (roots.bookmark_bar) {
    const children = mapChromiumChildren(roots.bookmark_bar.children);
    if (children.length) {
      sections.push({
        type: 'folder',
        title: roots.bookmark_bar.name || 'Bookmarks bar',
        nsRoot: 'toolbar',
        children,
      });
    }
  }

  // 其它书签 → 其它文件夹(other)。用真值 'unsorted' 让 addImported 走 other 分支。
  if (roots.other) {
    const children = mapChromiumChildren(roots.other.children);
    if (children.length) {
      sections.push({
        type: 'folder',
        title: roots.other.name || 'Other bookmarks',
        nsRoot: 'unsorted',
        children,
      });
    }
  }

  // 移动端书签(synced)同样导入到"其它文件夹"——它们也是用户的书签，不应静默丢弃。
  // 不进本应用只读的 mobile 目录，而是作为单独文件夹落在可写的 other 下。
  if (roots.synced) {
    const children = mapChromiumChildren(roots.synced.children);
    if (children.length) {
      sections.push({
        type: 'folder',
        title: roots.synced.name || 'Mobile Bookmarks',
        nsRoot: 'unsorted',
        children,
      });
    }
  }

  return sections;
};

// ===== Firefox（places.sqlite）=====

// 极简 INI 解析（profiles.ini 无依赖读取）。
const parseIni = (text: string): Record<string, Record<string, string>> => {
  const sections: Record<string, Record<string, string>> = {};
  let cur: Record<string, string> = (sections._global = {});
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const m = line.match(/^\[(.+)\]$/);
    if (m) {
      cur = sections[m[1]] = {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    cur[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return sections;
};

// 选 profile：profiles.ini 里的 Default=1/IsDefault 标记并不可靠（常指向一个
// 几乎没用过的空 profile，其 places.sqlite 为 0 字节）。改为在所有候选 profile
// 里挑 places.sqlite 非空且 mtime 最新的——即最近使用过、真正活跃的那个 profile。
// 候选来源：profiles.ini 的 [ProfileN] 段 + Profiles/ 子目录扫描（兜底 ini 缺项）。
const pickFirefoxProfile = (baseDir: string): string | null => {
  const iniPath = join(baseDir, 'profiles.ini');
  const candidateDirs = new Set<string>();

  if (exists(iniPath)) {
    try {
      const ini = parseIni(readFileSync(iniPath, 'utf8'));
      for (const [name, kv] of Object.entries(ini)) {
        if (/^Profile/i.test(name) && kv && kv.Path) {
          const isRelative = kv.IsRelative !== '0';
          candidateDirs.add(
            isRelative ? join(baseDir, kv.Path) : kv.Path,
          );
        }
      }
    } catch {
      // ini 损坏则依赖目录扫描
    }
  }

  // 兜底：扫描 Profiles/ 子目录，覆盖 ini 未登记的 profile。
  const profilesRoot = join(baseDir, 'Profiles');
  if (exists(profilesRoot)) {
    try {
      for (const name of readdirSync(profilesRoot)) {
        candidateDirs.add(join(profilesRoot, name));
      }
    } catch {
      // 不可读则跳过
    }
  }

  if (candidateDirs.size === 0) return null;

  // 取 places.sqlite 非空且 mtime 最新的 profile。
  let best: { dir: string; mtime: number } | null = null;
  let fallback: string | null = null;
  for (const dir of candidateDirs) {
    if (!exists(dir)) continue;
    if (fallback == null) fallback = dir;
    const dbPath = join(dir, 'places.sqlite');
    if (!exists(dbPath)) continue;
    try {
      const st = statSync(dbPath);
      if (!st.size) continue; // 跳过空/损坏文件
      if (!best || st.mtimeMs > best.mtime) {
        best = { dir, mtime: st.mtimeMs };
      }
    } catch {
      // stat 失败忽略
    }
  }

  return best?.dir || fallback;
};

const readFirefox = async (): Promise<Bookmark[]> => {
  const baseDir = firefoxDir();
  const profileDir = pickFirefoxProfile(baseDir);
  if (!profileDir) throw new Error('PROFILE_NOT_FOUND');

  const liveDb = join(profileDir, 'places.sqlite');
  if (!exists(liveDb)) throw new Error('BROWSER_NOT_FOUND');

  // Firefox 运行时对 live 文件持 WAL 锁，readOnly 仍可能 SQLITE_BUSY；
  // 把 places.sqlite 及其 -wal/-shm 一起拷到唯一临时目录，开只读副本。
  const tmpDir = join(tmpdir(), `yjllq-ff-${process.pid}-${Date.now()}`);
  await fsPromises.mkdir(tmpDir, { recursive: true });

  // node:sqlite 在 Electron 42(Node 24) 内置；此处用 any 规避 @types/node
  // 是否含 node:sqlite 类型声明的不确定性（构建走 transpileOnly 不校验类型）。
  let db: any = null;
  try {
    for (const f of readdirSync(profileDir)) {
      if (f === 'places.sqlite' || f.startsWith('places.sqlite-')) {
        await fsPromises.copyFile(join(profileDir, f), join(tmpDir, f));
      }
    }
    const tmpDb = join(tmpDir, 'places.sqlite');
    if (!existsSync(tmpDb)) throw new Error('PARSE_FAILED: places.sqlite 拷贝失败');

    // node:sqlite 在 Electron 42(Node 24) 内置；readOnly 避免任何写意图。
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(tmpDb, { readOnly: true });

    const rows: any[] = db
      .prepare(
        `SELECT b.id, b.type, b.parent, b.position, b.title, b.fk, p.url
         FROM moz_bookmarks b
         LEFT JOIN moz_places p ON b.fk = p.id
         WHERE b.type IN (1,2,3)
         ORDER BY b.parent, b.position`,
      )
      .all();

    // id → 行；parent → 子行（已按 parent,position 排序）。
    const childrenOf = new Map<number, any[]>();
    for (const r of rows) {
      if (r.parent == null) continue;
      if (!childrenOf.has(r.parent)) childrenOf.set(r.parent, []);
      childrenOf.get(r.parent)!.push(r);
    }

    // 根 id=1。其直接子节点里识别 toolbar/menu/unfiled：先用稳定 id(3/2/5)，
    // 再按多语言标题兜底（标题随 Firefox 语言变化，id 更可靠）。
    const rootKids = childrenOf.get(1) || [];
    const findRoot = (...idsOrTitles: (number | string)[]) =>
      rootKids.find(
        (r) => idsOrTitles.includes(r.id) || idsOrTitles.includes(r.title),
      );

    const toolbarRoot =
      findRoot(3, 'Bookmarks Toolbar', '书签工具栏', 'Bookmarks Toolbar') ||
      undefined;
    const menuRoot =
      findRoot(2, 'Bookmarks Menu', '书签菜单') || undefined;
    const unfiledRoot =
      findRoot(
        5,
        'Other Bookmarks',
        'Unsorted Bookmarks',
        '未分类书签',
        '其它书签',
      ) || undefined;
    // mobile(6) 也导入到"其它文件夹"（用户的书签不应丢弃）；tags(4) 是标签关联非书签，跳过。
    const mobileRoot =
      findRoot(6, 'Mobile Bookmarks', '移动书签') || undefined;

    const build = (parentId: number): Bookmark[] => {
      const kids = childrenOf.get(parentId) || [];
      const out: Bookmark[] = [];
      for (const k of kids) {
        if (k.type === 1) {
          // url
          if (k.url) {
            out.push({
              type: 'bookmark',
              title: k.title || k.url,
              url: k.url,
            });
          }
        } else if (k.type === 2) {
          // folder
          out.push({
            type: 'folder',
            title: k.title || '文件夹',
            children: build(k.id),
          });
        }
        // type 3 separator 跳过
      }
      return out;
    };

    const sections: Bookmark[] = [];
    if (toolbarRoot) {
      const children = build(toolbarRoot.id);
      if (children.length) {
        sections.push({
          type: 'folder',
          title: toolbarRoot.title || 'Bookmarks Toolbar',
          nsRoot: 'toolbar',
          children,
        });
      }
    }
    if (menuRoot) {
      const children = build(menuRoot.id);
      if (children.length) {
        sections.push({
          type: 'folder',
          title: menuRoot.title || 'Bookmarks Menu',
          nsRoot: 'menu',
          children,
        });
      }
    }
    if (unfiledRoot) {
      const children = build(unfiledRoot.id);
      if (children.length) {
        sections.push({
          type: 'folder',
          title: unfiledRoot.title || 'Other Bookmarks',
          nsRoot: 'unsorted',
          children,
        });
      }
    }
    if (mobileRoot) {
      const children = build(mobileRoot.id);
      if (children.length) {
        sections.push({
          type: 'folder',
          title: mobileRoot.title || 'Mobile Bookmarks',
          nsRoot: 'unsorted',
          children,
        });
      }
    }

    return sections;
  } catch (err) {
    const msg = (err as Error).message || '';
    if (msg.startsWith('BROWSER_NOT_FOUND') || msg.startsWith('PROFILE_NOT_FOUND')) {
      throw err;
    }
    throw new Error('PARSE_FAILED: ' + msg);
  } finally {
    try {
      db?.close();
    } catch {
      // 关闭失败不阻塞
    }
    try {
      await fsPromises.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // 临时文件残留不影响功能
    }
  }
};

// ===== 统一入口 =====

export const readBrowserBookmarks = async (
  id: BrowserId,
): Promise<Bookmark[]> => {
  if (id === 'firefox') return readFirefox();
  return readChromium(id);
};
