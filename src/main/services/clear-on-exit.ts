// 退出时自动清理 / 立即清除 —— 共用同一套清理编排。
//
// 两条入口:
//   1) 主窗口关闭最后一个浏览器窗口时 (windows/app.ts runClearOnExit) → 进度覆盖层
//      mode='exit',完成后真正关闭窗口。
//   2) 设置页「立即清除」按钮 → ipcMain.handle('clear-browsing-data-now'),
//      不显示覆盖层(设置页 BrowserView 会遮挡),仅靠按钮态反馈,完成后 resolve。
//
// 清理项对齐 Chrome「清除浏览数据」:浏览记录 / 搜索历史 / 下载记录 / Cookie 及其他
// 网站数据 / 缓存 / 密码 / 自动填充 / 网站设置。阶段按 PHASES 顺序串行,每段进度区间
// 由权重固定算出;未勾选的阶段直接 report 该段终点跳过,避免动态重算导致进度回退。
// 单项失败不阻断整体,最后必发 done:true。
//
// 「Cookie 及其他网站数据」用 session.clearData 并 excludeOrigins 留出扩展,否则
// chrome.storage / 扩展 IndexedDB 会被连带清空。缓存单独走 clearCache()。

import {ipcMain, app, BrowserWindow} from 'electron';

import {Application} from '../application';
import {getMainTranslator} from '../i18n';
import {findSearchQuery} from '~/utils/search-engine';
import {CLEAR_ON_EXIT_KEYS, ClearOnExitItems} from '~/interfaces/settings';

export type ClearItems = ClearOnExitItems;

export type ClearPhase = keyof ClearItems | 'finalize';

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

export const normalizeItems = (items?: Partial<ClearItems> | null): ClearItems => {
  const next = {} as ClearItems;
  for (const key of CLEAR_ON_EXIT_KEYS) next[key] = !!items?.[key];
  return next;
};

// 是否至少勾了一项(决定是否触发清理)。
export const hasAnyItem = (items?: Partial<ClearItems> | null): boolean =>
  !!items && CLEAR_ON_EXIT_KEYS.some((key) => !!items[key]);

// 阶段顺序与进度权重(耗时越久权重越大)。
const PHASES: {key: keyof ClearItems; weight: number}[] = [
  {key: 'history', weight: 20},
  {key: 'searchHistory', weight: 10},
  {key: 'downloads', weight: 5},
  {key: 'passwords', weight: 5},
  {key: 'autofill', weight: 5},
  {key: 'siteSettings', weight: 5},
  {key: 'cache', weight: 25},
  {key: 'cookies', weight: 25},
];

// 网站数据只清网页,留出扩展(chrome.storage / 扩展 IndexedDB)。
const getExtensionOrigins = (): string[] => {
  try {
    return Application.instance.sessions.view
      .getAllExtensions()
      .map((ext) => `chrome-extension://${ext.id}`);
  } catch {
    return [];
  }
};

const clearWebSiteData = async (session: Electron.Session) => {
  const dataTypes: Electron.ClearDataOptions['dataTypes'] = [
    'cookies',
    'localStorage',
    'indexedDB',
    'serviceWorkers',
    'fileSystems',
    'webSQL',
    'backgroundFetch',
  ];
  const excludeOrigins = getExtensionOrigins();
  await session.clearData(
    excludeOrigins.length > 0 ? {dataTypes, excludeOrigins} : {dataTypes},
  );
};

const clearSiteSettings = async () => {
  const storage = Application.instance.storage;
  await storage.remove({scope: 'permissions', query: {}, multi: true});
  Application.instance.sessions.clearDevicePermissions();
};

// 各项当前数据量(设置页勾选项下方的说明行)。单项读取失败返回 null,UI 只显示标题。
export async function getClearItemStats() {
  const storage = Application.instance.storage;
  const sessions = Application.instance.sessions;
  const safe = async <T>(fn: () => Promise<T> | T): Promise<T | null> => {
    try {
      return await fn();
    } catch {
      return null;
    }
  };
  const hostOf = (url?: string) => {
    try {
      return new URL(url || '').hostname;
    } catch {
      return '';
    }
  };
  const engines = Application.instance.settings.object.searchEngines || [];
  const [formfill, profiles, permissions, cookies, cache] = await Promise.all([
    safe(() =>
      storage.find<{type?: string; url?: string}>({scope: 'formfill', query: {}}),
    ),
    safe(() =>
      storage.find<{type?: string}>({
        scope: 'autofillProfiles',
        query: {type: {$in: ['address', 'card']}},
      }),
    ),
    safe(() => storage.find<{url?: string}>({scope: 'permissions', query: {}})),
    safe(() => sessions.view.cookies.get({})),
    safe(() => sessions.view.getCacheSize()),
  ]);
  const passwords = formfill ? formfill.filter((x) => x.type === 'password') : null;
  return {
    history: storage.history.length,
    searchHistory: storage.history.filter((x) =>
      findSearchQuery(x.url || '', engines),
    ).length,
    downloads: await safe(() => sessions.countDownloadHistory()),
    cookies: cookies
      ? new Set(cookies.map((c) => (c.domain || '').replace(/^\./, ''))).size
      : null,
    cache,
    passwords: passwords ? passwords.length : null,
    passwordSites: passwords
      ? [...new Set(passwords.map((x) => hostOf(x.url)).filter(Boolean))].slice(0, 2)
      : [],
    autofill:
      formfill && passwords
        ? formfill.length - passwords.length + (profiles ? profiles.length : 0)
        : null,
    siteSettings: permissions
      ? new Set(permissions.map((x) => x.url).filter(Boolean)).size +
        sessions.countDevicePermissions()
      : null,
  };
}

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
  const t = getMainTranslator(Application.instance.settings?.object?.language);
  const origin = getOrigin(opts.url);
  if (!origin) {
    return {ok: false, unsupported: true, error: t('coePageUnsupported')};
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

  const total = PHASES.reduce((sum, x) => sum + x.weight, 0);
  const sessions = Application.instance.sessions;
  const engines = Application.instance.settings.object.searchEngines || [];
  const tasks: Record<keyof ClearItems, () => Promise<unknown>> = {
    history: () => storage.clearAllHistory(),
    // 若 history 已全清,搜索历史自然清空。
    searchHistory: async () => {
      if (items.history) return;
      const toRemove = storage.history
        .filter((x) => x._id && findSearchQuery(x.url || '', engines))
        .map((x) => x._id as string);
      if (toRemove.length > 0) await storage.removeHistoryByIds(toRemove);
    },
    downloads: () => sessions.clearDownloadHistory(),
    passwords: () =>
      storage.remove({scope: 'formfill', query: {type: 'password'}, multi: true}),
    autofill: () =>
      Promise.all([
        storage.remove({
          scope: 'formfill',
          query: {type: {$ne: 'password'}},
          multi: true,
        }),
        storage.remove({scope: 'autofillProfiles', query: {}, multi: true}),
      ]),
    siteSettings: () => clearSiteSettings(),
    cache: () => sessions.view.clearCache(),
    cookies: () => clearWebSiteData(sessions.view),
  };

  const run = async () => {
    let done = 0;
    for (const {key, weight} of PHASES) {
      done += weight;
      const percent = Math.round((done / total) * 100);
      if (!items[key]) {
        report(key, percent);
        continue;
      }
      try {
        await tasks[key]();
        report(key, percent);
      } catch (e) {
        console.error(`[clear-on-exit] ${key} failed`, e);
        report(key, percent, String(e));
      }
    }
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

ipcMain.handle('clear-browsing-data-stats', async () => {
  try {
    return await getClearItemStats();
  } catch (err) {
    console.error('[clear-browsing-data-stats] failed', err);
    return null;
  }
});

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
