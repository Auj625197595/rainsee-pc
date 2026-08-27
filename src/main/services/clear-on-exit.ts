// 退出时自动清理 / 立即清除 —— 共用同一套清理编排。
//
// 两条入口:
//   1) 主窗口关闭最后一个浏览器窗口时 (windows/app.ts runClearOnExit) → 进度覆盖层
//      mode='exit',完成后真正关闭窗口。
//   2) 设置页「立即清除」按钮 → ipcMain.handle('clear-browsing-data-now'),
//      不显示覆盖层(设置页 BrowserView 会遮挡),仅靠按钮态反馈,完成后 resolve。
//
// 4 个清理项按阶段串行,进度区间固定(history 0→25 / searchHistory 25→40 /
// cache 40→75 / cookies 75→100)。未勾选的阶段直接 report 该段终点跳过执行,
// 避免动态重算百分比导致进度回退观感。单项失败不阻断整体,finally 必发 done:true。
//
// 不复用 sessions.clearCache('normal'):那个方法 (sessions-service.ts:1561) 会清
// 8 种 storage,超出「只清缓存/Cookie」的语义边界。这里直接调用 view.clearCache()
// 与 view.clearStorageData({storages:['cookies']})。

import {ipcMain, app, BrowserWindow} from 'electron';

import {Application} from '../application';
import {findSearchQuery} from '~/utils/search-engine';

export interface ClearItems {
  cache: boolean;
  cookies: boolean;
  history: boolean;
  searchHistory: boolean;
}

export type ClearPhase =
  | 'history'
  | 'searchHistory'
  | 'cache'
  | 'cookies'
  | 'finalize';

export interface ClearProgress {
  phase: ClearPhase;
  percent: number;
  done: boolean;
  error?: string;
}

export interface ClearOnExitOptions {
  items: ClearItems;
  onProgress?: (p: ClearProgress) => void;
}

export const normalizeItems = (items?: Partial<ClearItems> | null): ClearItems => ({
  cache: !!items?.cache,
  cookies: !!items?.cookies,
  history: !!items?.history,
  searchHistory: !!items?.searchHistory,
});

// 是否至少勾了一项(决定是否触发清理)。
export const hasAnyItem = (items: ClearItems): boolean =>
  items.cache || items.cookies || items.history || items.searchHistory;

const getOrigin = (rawUrl: string): string | null => {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : null;
  } catch {
    return null;
  }
};

// 清理单个站点。缓存/Cookie 交给 Chromium 按 origin 删除,历史与搜索历史
// 则从雨见自己的历史库中按同一 origin 精确移除。
export async function performClearSiteData(opts: {
  url: string;
  incognito?: boolean;
  items: Partial<ClearItems>;
}) {
  const origin = getOrigin(opts.url);
  if (!origin) {
    return {ok: false, unsupported: true, error: '当前页面不支持清理'};
  }

  const items = normalizeItems(opts.items);
  if (!hasAnyItem(items)) {
    return {ok: true, skipped: true, origin};
  }

  const storage = Application.instance.storage;
  const historyIds = storage.history
    .filter((entry) => {
      if (!entry._id) return false;
      try {
        if (new URL(entry.url || '').origin !== origin) return false;
      } catch {
        return false;
      }
      if (items.history) return true;
      if (!items.searchHistory) return false;
      const engines = Application.instance.settings.object.searchEngines || [];
      return !!findSearchQuery(entry.url || '', engines);
    })
    .map((entry) => entry._id as string);

  const tasks: Promise<unknown>[] = [];
  if (historyIds.length > 0 && !opts.incognito) {
    tasks.push(storage.removeHistoryByIds(historyIds));
  }

  const sessions = Application.instance.sessions;
  const session = opts.incognito ? sessions.viewIncognito : sessions.view;
  const dataTypes: Electron.ClearDataOptions['dataTypes'] = [];
  if (items.cache) dataTypes.push('cache');
  if (items.cookies) dataTypes.push('cookies');
  if (dataTypes.length > 0) {
    tasks.push(
      session.clearData({
        origins: [origin],
        dataTypes,
        originMatchingMode: 'origin-in-all-contexts',
      }),
    );
  }

  await Promise.all(tasks);
  return {ok: true, origin};
}

// 执行清理。总超时 30s,防止磁盘 IO 卡死阻塞退出。
export async function performClearOnExit(
  opts: ClearOnExitOptions,
): Promise<void> {
  const items = normalizeItems(opts.items);
  const {onProgress} = opts;
  const storage = Application.instance.storage;
  const report = (
    phase: ClearPhase,
    percent: number,
    error?: string,
  ) => onProgress?.({phase, percent, done: false, error});

  const run = async () => {
    // === 阶段 1:历史记录(全清) — 0~25 ===
    if (items.history) {
      try {
        await storage.clearAllHistory();
        report('history', 25);
      } catch (e) {
        report('history', 25, String(e));
      }
    } else {
      report('history', 25);
    }

    // === 阶段 2:搜索历史 — 25~40 ===
    // 若 history 已全清,搜索历史自然清空,跳过。
    if (items.searchHistory && !items.history) {
      try {
        const engines =
          Application.instance.settings.object.searchEngines || [];
        const toRemove = storage.history
          .filter((x) => x._id && findSearchQuery(x.url || '', engines))
          .map((x) => x._id as string);
        if (toRemove.length > 0) {
          await storage.removeHistoryByIds(toRemove);
        }
        report('searchHistory', 40);
      } catch (e) {
        report('searchHistory', 40, String(e));
      }
    } else {
      report('searchHistory', 40);
    }

    // === 阶段 3 & 4:缓存 + Cookie 并行 — 40~100 ===
    // 两者都作用在 sessions.view 上,Electron 的 clearCache/clearStorageData
    // 异步且内部串行化,Promise.all 不会损坏数据,并行只为尽早返回。
    const sessions = Application.instance.sessions;
    const tasks: Promise<void>[] = [];
    if (items.cache) {
      tasks.push(
        sessions.view
          .clearCache()
          .then(
            () => report('cache', 75),
            (e) => report('cache', 75, String(e)),
          ),
      );
    } else {
      report('cache', 75);
    }
    if (items.cookies) {
      tasks.push(
        sessions.view
          .clearStorageData({storages: ['cookies']})
          .then(
            () => report('cookies', 100),
            (e) => report('cookies', 100, String(e)),
          ),
      );
    } else {
      report('cookies', 100);
    }
    await Promise.all(tasks);

    report('finalize', 100);
  };

  // 30s 总超时:超时也认为 done,让退出流程继续(尽力清理语义)。
  await Promise.race([
    run(),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        report('finalize', 100, '清理超时,已强制完成');
        resolve();
      }, 30000),
    ),
  ]);

  onProgress?.({phase: 'finalize', percent: 100, done: true});
}

// 「立即清除」IPC:设置页确定后触发。复用 performClearOnExit。
// 不显示进度覆盖层:设置页本身是 BrowserView,渲染在主窗 webContents 之上,会完全
// 遮挡覆盖层(用户不可见)。设置页按钮的 disabled + "清理中…" 态已提供反馈。
ipcMain.handle(
  'clear-browsing-data-now',
  async (e, payload: {items: Partial<ClearItems>}) => {
    const items = normalizeItems(payload?.items);
    if (!hasAnyItem(items)) {
      return {ok: true, skipped: true};
    }
    try {
      await performClearOnExit({items});
      return {ok: true};
    } catch (err) {
      return {ok: false, error: String(err)};
    }
  },
);

ipcMain.handle(
  'clear-site-browsing-data',
  async (
    e,
    payload: {
      url?: string;
      incognito?: boolean;
      items?: Partial<ClearItems>;
    },
  ) => {
    try {
      return await performClearSiteData({
        url: String(payload?.url || ''),
        incognito: !!payload?.incognito,
        items: payload?.items || {},
      });
    } catch (err) {
      console.error('[clear-site-browsing-data] failed', err);
      return {ok: false, error: String(err)};
    }
  },
);

// 「立即退出」:exit 模式覆盖层兜底按钮,用户认为清理卡死时可强制退出(绕过清理)。
ipcMain.on('force-quit', () => {
  // 延迟一拍让覆盖层点击反馈落地。
  setTimeout(() => {
    // 先同步 destroy 所有窗口(含只 hide 不 destroy 的辅助窗:扩展 popup / 白屏
    // 覆盖层 / 媒体播放器 / 登录窗等)。app.exit 不触发 before-quit,若不手动销毁,
    // 这些辅助窗的渲染进程会残留 → requestSingleInstanceLock 不释放 → 下次启动秒退
    // (与 index.ts before-quit 的兜底清理等价,此处补上 app.exit 绕过的那段)。
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        try {
          w.destroy();
        } catch {
          // 单个销毁失败不阻断
        }
      }
    }
    try {
      app.exit(0);
    } catch {
      // ignore
    }
  }, 100);
});
