// 标签页预览图落盘:每次 View.captureThumbnail 抓到快照后,按标签的稳定键
// (thumbKey,渲染层 ITab 生成并随 startupTabs 持久化)写到 userData/tab-thumbnails/<key>.jpg。
//
// 目的:内存节省模式恢复的占位标签(discarded)没有 BrowserView,View.thumbnail 为空,
// 标签组总览只能显示大图标。磁盘副本跨重启、跨占位→真实 id 替换都可用,直到标签被
// 真正关闭(ITab.close → tab-thumbnail-delete)才删除。标签撕离/合并到其它窗口不算关闭,
// thumbKey 随 tab-adopt 带过去继续沿用。
//
// 键由渲染层上报,必须做白名单校验后才能拼进路径(防路径穿越)。无痕/工作区窗口不
// 上报键(canPersistNormalSession 门控),因此永不落盘。

import { ipcMain, NativeImage } from 'electron';
import { promises as fs } from 'fs';
import { getPath } from '~/utils';
import { Application } from '../application';

const DIR_NAME = 'tab-thumbnails';
const KEY_RE = /^[a-z0-9]{8,48}$/;
// 启动后延迟清理孤儿文件:等各窗口会话恢复把 startupTabs 写回之后再对账。
const PRUNE_DELAY_MS = 90_000;
// 新近写入的文件不清理:对应标签的 startupTabs 记录可能还没落库。
const PRUNE_MIN_AGE_MS = 10 * 60_000;

export const isValidThumbKey = (key: unknown): key is string =>
  typeof key === 'string' && KEY_RE.test(key);

const dir = () => getPath(DIR_NAME);
const fileOf = (key: string) => getPath(DIR_NAME, `${key}.jpg`);

let dirReady: Promise<unknown> | null = null;
const ensureDir = () => {
  if (!dirReady) {
    dirReady = fs.mkdir(dir(), { recursive: true }).catch((error) => {
      dirReady = null;
      throw error;
    });
  }
  return dirReady;
};

// 已删除的键:抓图是异步的,关闭标签后仍可能有一帧在途,不能让它把文件写回来。
const deletedKeys = new Set<string>();
// 每个键同一时间只有一个写入;在途期间到达的新帧只保留最新一帧,写完再补。
const writing = new Set<string>();
const pendingFrames = new Map<string, Buffer>();

const writeFrame = async (key: string, data: Buffer) => {
  writing.add(key);
  try {
    await ensureDir();
    if (deletedKeys.has(key)) return;
    const target = fileOf(key);
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, data);
    if (deletedKeys.has(key)) {
      await fs.unlink(tmp).catch(() => undefined);
      return;
    }
    await fs.rename(tmp, target);
  } catch (error) {
    console.warn('[tab-thumbnails] write failed', key, error);
  } finally {
    writing.delete(key);
    const next = pendingFrames.get(key);
    if (next) {
      pendingFrames.delete(key);
      void writeFrame(key, next);
    }
  }
};

export const saveTabThumbnail = (key: string, image: NativeImage) => {
  if (!isValidThumbKey(key) || deletedKeys.has(key)) return;
  if (!image || image.isEmpty()) return;
  let data: Buffer;
  try {
    data = image.toJPEG(82);
  } catch {
    return;
  }
  if (!data?.length) return;
  if (writing.has(key)) {
    pendingFrames.set(key, data);
    return;
  }
  void writeFrame(key, data);
};

// 读磁盘预览图为 dataURL;不存在/读取失败返回空串。
export const loadTabThumbnail = async (key: string): Promise<string> => {
  if (!isValidThumbKey(key) || deletedKeys.has(key)) return '';
  try {
    const data = await fs.readFile(fileOf(key));
    if (!data.length) return '';
    return `data:image/jpeg;base64,${data.toString('base64')}`;
  } catch {
    return '';
  }
};

export const deleteTabThumbnail = (key: string) => {
  if (!isValidThumbKey(key)) return;
  deletedKeys.add(key);
  pendingFrames.delete(key);
  void fs.unlink(fileOf(key)).catch(() => undefined);
};

// 当前仍被引用的键 = startupTabs 记录里的 thumbKey ∪ 所有窗口存活 View 的 thumbKey。
const collectLiveKeys = async () => {
  const keys = new Set<string>();
  const app = Application.instance;
  const records = await app.storage.find<{ thumbKey?: string }>({
    scope: 'startupTabs',
    query: {},
  });
  for (const record of records) {
    if (isValidThumbKey(record?.thumbKey)) keys.add(record.thumbKey);
  }
  for (const window of app.windows.list) {
    for (const view of window.viewManager?.views?.values() || []) {
      if (isValidThumbKey(view.thumbKey)) keys.add(view.thumbKey);
    }
  }
  return keys;
};

// 清理孤儿文件:非正常退出、启动偏好清空会话、无记录的工作区标签等都会留下
// 不再被任何标签引用的预览图。
export const pruneTabThumbnails = async () => {
  let names: string[];
  try {
    names = await fs.readdir(dir());
  } catch {
    return;
  }
  if (names.length === 0) return;

  let live: Set<string>;
  try {
    live = await collectLiveKeys();
  } catch (error) {
    console.warn('[tab-thumbnails] prune skipped: cannot read startupTabs', error);
    return;
  }

  const now = Date.now();
  let removed = 0;
  for (const name of names) {
    const match = /^([a-z0-9]+)\.jpg(\.tmp)?$/.exec(name);
    if (!match) continue;
    const [, key, tmp] = match;
    if (!tmp && live.has(key)) continue;
    const path = getPath(DIR_NAME, name);
    try {
      const stat = await fs.stat(path);
      if (now - stat.mtimeMs < PRUNE_MIN_AGE_MS) continue;
      await fs.unlink(path);
      removed++;
    } catch {
      // 文件可能刚被并发删除,忽略。
    }
  }
  if (removed) console.log(`[tab-thumbnails] pruned ${removed} orphan file(s)`);
};

const ownerWindowFor = (sender: Electron.WebContents, windowId: number) => {
  const owner = Application.instance.windows.list.find(
    (window) => window.win.id === windowId,
  );
  if (!owner || owner.win.isDestroyed()) return null;
  // 只接受该窗口主 UI renderer(app.html tabs store)的上报。
  return sender === owner.win.webContents ? owner : null;
};

export const setupTabThumbnails = () => {
  // 渲染层上报本窗口 [tabId, thumbKey] 映射(标签增删、占位标签加载后触发)。
  ipcMain.on(
    'tab-thumb-keys',
    (e, windowId: number, pairs: Array<[number, string]>) => {
      if (!Array.isArray(pairs)) return;
      const owner = ownerWindowFor(e.sender, windowId);
      if (!owner) return;
      for (const pair of pairs) {
        if (!Array.isArray(pair)) continue;
        const [id, key] = pair;
        if (!isValidThumbKey(key)) continue;
        owner.viewManager.views.get(id)?.setThumbKey(key);
      }
    },
  );

  // 标签真正关闭:删除其磁盘预览图。
  ipcMain.on('tab-thumbnail-delete', (e, windowId: number, key: string) => {
    if (!ownerWindowFor(e.sender, windowId)) return;
    deleteTabThumbnail(key);
  });

  setTimeout(() => {
    void pruneTabThumbnails();
  }, PRUNE_DELAY_MS);
};
