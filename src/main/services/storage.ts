import {ipcMain, dialog} from 'electron';
import * as Datastore from 'nedb';

import {getPath} from '~/utils';
import {
  IFindOperation,
  IInsertOperation,
  IRemoveOperation,
  IUpdateOperation,
  IHistoryItem,
  IFavicon,
  IBookmark,
} from '~/interfaces';
import {promises} from 'fs';
import {Application} from '../application';
import {getMainTranslator} from '../i18n';
import {requestURL} from '../network/request';
import {filterCount, getAdLists, updateAdLists, isSiteWhitelisted, toggleSiteWhitelist, getSubscriptions, addSubscription, removeSubscription, toggleSubscription, updateSubscription, updateAllSubscriptions, setAutoUpdateHours, getUserWhitelist, addWhitelistDomain, removeWhitelistDomain, getUserRulesText, saveUserRulesText} from "~/main/services/adblock";
import {bookmarkNodeById} from "./extension-bookmarks-history";
import {reloadCertificateErrorPermissions} from './certificate-error-permissions';
import {DatabaseWorker} from './database';

// —— 重依赖惰性加载 ——
// file-type(几百个 magic-number 判断的大模块)、icojs、node-bookmarks-parser 的
// 顶层求值都会拖慢 main bundle require(冷启动主进程 730ms 的重要构成)。
// 首次实际使用前不需要:file-type/icojs 只在首个 favicon 落盘时用,
// bookmarks-parser 只在用户手动导入书签时用。与 browser-import 的既有
// 动态 import 模式一致,配 promise 缓存避免重复 import。
let fileTypeModule: Promise<typeof import('file-type')> | null = null;
const getFileType = () => {
  fileTypeModule ??= import('file-type');
  return fileTypeModule;
};

let icojsModule: Promise<typeof import('icojs')> | null = null;
const getIcojs = () => {
  icojsModule ??= import('icojs');
  return icojsModule;
};

let bookmarksParserModule: Promise<typeof import('node-bookmarks-parser')> | null =
  null;
const getBookmarksParser = () => {
  bookmarksParserModule ??= import('node-bookmarks-parser');
  return bookmarksParserModule;
};

interface Databases {
  [key: string]: Datastore;
}

const convertIcoToPng = async (icoData: Buffer): Promise<ArrayBuffer> => {
  const icojsModule = await getIcojs();
  const icojs = (icojsModule as any).default || icojsModule;
  return (await icojs.parse(icoData, 'image/png'))[0].buffer;
};

// file-type 16 会把 SVG 识别为 application/xml。img 对 XML MIME 不做 SVG
// 解码，因此需要在生成 data URL 前确认根元素并使用 image/svg+xml。
const isSvgBuffer = (data: Buffer): boolean => {
  const prefix = data
    .subarray(0, 4096)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  return /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!doctype\s+svg[^>]*>\s*)?<svg(?:\s|>)/i.test(
    prefix,
  );
};

// 旧版本用文件扩展名直接拼 data URL（如 data:png / data:svg），Chromium
// 对位图有时会容错嗅探，但 SVG 会直接解码失败。读取缓存时统一迁移为标准 MIME。
const LEGACY_FAVICON_MIME_TYPES: Record<string, string> = {
  apng: 'image/apng',
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  // file-type 16 将 SVG 记为 xml；favicon 缓存中的 XML 实际即 SVG 图标。
  xml: 'image/svg+xml',
};

const normalizeFaviconDataUrl = (data: string): string => {
  const match = /^data:([^;,]+);base64,/i.exec(data || '');
  if (!match || match[1].includes('/')) return data;

  const mime = LEGACY_FAVICON_MIME_TYPES[match[1].toLowerCase()];
  return mime ? `data:${mime};base64,${data.slice(match[0].length)}` : data;
};

const encodeHref = (str: string) => {
  return (str || '').replace(/"/g, '&quot;');
};

const encodeTitle = (str: string) => {
  return (str || '')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

let bookmarkImportIdCounter = 0;
const createImportedBookmarkId = () =>
  `import_${Date.now().toString(36)}_${(bookmarkImportIdCounter++).toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

const indentLength = 4;
const indentType = ' ';

export class StorageService {
  private bookmarksLoadPromise: Promise<void> | null = null;
  private bookmarksLoaded = false;
  private workerDatabases: {[scope: string]: DatabaseWorker} = {};

  public databases: Databases = {
    favicons: null,
    bookmarks: null,
    history: null,
    formfill: null,
    startupTabs: null,
    // 标签组记录 {id, windowId, name, color, order}。与 startupTabs 同套 NeDB,
    // openDatabases() 自动建 storage/tabgroups.db。
    tabGroups: null,
    // 本机工作区定义。工作区自行保存标签与分组快照,不与 startupTabs/tabGroups
    // 混用,从而不受 Electron 运行时 windowId 变化影响。
    workspaces: null,
    permissions: null,
    // 已完成下载的历史记录,使下载页跨重启保留。openDatabases() 自动建
    // storage/downloads.db。sessions-service 在 done(completed) 写入、download-remove
    // 删除、启动时读回(sessions-service 闭包内的 downloads 数组)。
    downloads: null,
  };

  public history: IHistoryItem[] = [];

  public addHistory(item: IHistoryItem) {
    this.history.push(item);
  }

  // 按 _id 批量删除历史(内存数组 + NeDB + 扩展通知)。从原 history-remove
  // IPC handler 内联逻辑抽出,供「退出时清理搜索历史」复用。
  public async removeHistoryByIds(ids: string[]) {
    if (!ids || ids.length === 0) return;
    const urls = this.crxExtensions
      ? this.history
          .filter((x) => ids.indexOf(x._id) !== -1)
          .map((x) => x.url)
          .filter(Boolean)
      : [];
    this.history = this.history.filter((x) => ids.indexOf(x._id) === -1);
    ids.forEach((x) => this.remove({scope: 'history', query: {_id: x}}));
    if (urls.length) {
      this.crxExtensions?.notifyHistoryVisitRemoved({allHistory: false, urls});
    }
  }

  // 清空全部历史(内存数组 + NeDB 全删 + 扩展 allHistory 通知)。
  // 供「退出时清理历史记录」用。NeDB 空 query 必须带 multi:true 才删全部。
  public async clearAllHistory() {
    const hadItems = this.history.length > 0;
    this.history = [];
    await this.remove({scope: 'history', query: {}, multi: true});
    if (hadItems) {
      this.crxExtensions?.notifyHistoryVisitRemoved({allHistory: true, urls: []});
    }
  }

  public bookmarks: IBookmark[] = [];

  public favicons: Map<string, string> = new Map();

  // Notify loaded extensions (chrome.bookmarks events). Guarded: extensions may
  // not be initialised yet (e.g. during loadBookmarks at startup), and the
  // build may run without ENABLE_EXTENSIONS.
  private get crxExtensions() {
    if (!process.env.ENABLE_EXTENSIONS) return null;
    return Application.instance?.sessions?.chromeExtensions || null;
  }

  public constructor() {
    ipcMain.handle('storage-get', async (e, data: IFindOperation) => {
      return await this.find(data);
    });

    ipcMain.handle('storage-get-one', async (e, data: IFindOperation) => {
      return await this.findOne(data);
    });

    ipcMain.handle('storage-insert', async (e, data: IInsertOperation) => {
      return await this.insert(data);
    });

    ipcMain.handle('storage-remove', async (e, data: IRemoveOperation) => {
      return await this.remove(data);
    });

    ipcMain.handle('storage-update', async (e, data: IUpdateOperation) => {
      return await this.update(data);
    });

    ipcMain.handle('import-bookmarks', async () => {
      const t = getMainTranslator(Application.instance.settings?.object?.language);
      const dialogRes = await dialog.showOpenDialog({
        filters: [{name: t('bmioImportFilterName'), extensions: ['html']}],
      });

      try {
        const file = await promises.readFile(dialogRes.filePaths[0], 'utf8');
        const parserModule = await getBookmarksParser();
        const parser = (parserModule as any).default || parserModule;
        return parser(file);
      } catch (err) {
        console.error(err);
      }

      return [];
    });

    // 从本机浏览器导入书签（Chrome/Edge/Firefox）。动态 import 把 node:sqlite/
    // 浏览器读取代码挡在启动热路径之外，首用时才加载。
    ipcMain.handle('browser-import-detect', async () => {
      const { detectBrowsers } = await import('./browser-import');
      return detectBrowsers();
    });

    ipcMain.handle('browser-import-read', async (_e, id) => {
      const { readBrowserBookmarks } = await import('./browser-import');
      try {
        return await readBrowserBookmarks(id);
      } catch (err) {
        console.error('[browser-import]', id, err);
        // 失败用 __error 信封返回，区别于"0 条书签"。
        return { __error: (err as Error).message };
      }
    });

    // 引导页在主窗口创建前也可以导入书签。提交放在主进程完成，避免依赖书签
    // 管理页的 renderer store，并确保静态根目录已经从数据库载入。
    ipcMain.handle('browser-import-commit', async (_e, items: any[]) => {
      try {
        return await this.importBrowserBookmarks(Array.isArray(items) ? items : []);
      } catch (error) {
        console.error('[browser-import] commit failed', error);
        throw error;
      }
    });

    ipcMain.handle('browser-history-detect', async () => {
      const {detectHistoryBrowsers} = await import('./browser-import');
      return detectHistoryBrowsers();
    });

    ipcMain.handle('browser-history-preview', async (_e, id) => {
      const {previewBrowserHistory} = await import('./browser-import');
      try {
        return await previewBrowserHistory(id);
      } catch (error) {
        console.error('[browser-history] preview failed', id, error);
        return {__error: (error as Error).message};
      }
    });

    // 历史数据量可能很大，完整记录始终留在主进程中读取并直接提交；渲染层只
    // 接收预览统计和最终结果，避免数万条隐私数据在 IPC 中来回传输。
    ipcMain.handle('browser-history-import', async (_e, id) => {
      const {readBrowserHistory} = await import('./browser-import');
      try {
        const result = await readBrowserHistory(id);
        return await this.importBrowserHistory(result);
      } catch (error) {
        console.error('[browser-history] import failed', id, error);
        return {__error: (error as Error).message};
      }
    });

    ipcMain.handle('bookmarks-import-tree', async (_e, items: any[]) => {
      try {
        return await this.importBrowserBookmarks(Array.isArray(items) ? items : []);
      } catch (error) {
        console.error('[browser-import] commit failed', error);
        throw error;
      }
    });

    ipcMain.handle('export-bookmarks', async () => {
      await this.exportBookmarks();
    });

    ipcMain.handle('bookmarks-get', (e) => {
      return this.bookmarks;
    });

    ipcMain.on('bookmarks-remove', async (e, ids: string[]) => {
      try {
        for (const id of ids || []) {
          await this.removeBookmark(id);
        }
      } catch (error) {
        console.error('[bookmarks] remove failed', error);
        return;
      }
      Application.instance.windows.list.forEach((x) => {
        x.viewManager.selected.updateBookmark();
      });
    });

    ipcMain.handle('bookmarks-add', async (e, item) => {
      const b = await this.addBookmark(item);

      Application.instance.windows.list.forEach((x) => {
        x.viewManager.selected.updateBookmark();
      });

      return b;
    });

    // includeMobile=true 时同时返回「移动设备书签」子树(地址栏收藏弹窗可选
    // 移动端目录;移动域经 v3 云服务 mobile scope 双向同步)。默认保持排除。
    ipcMain.handle(
      'bookmarks-get-folders',
      async (e, includeMobile?: boolean) => {
        return this.bookmarks.filter(
          (x) => x.isFolder && (includeMobile || !this.isUnderMobileFolder(x)),
        );
      },
    );

    ipcMain.on('bookmarks-update', async (e, id, change) => {
      await this.updateBookmark(id, change);
    });

    // 书签栏长按拖拽排序：把新顺序写回同父级兄弟的 order 字段。
    ipcMain.on(
      'bookmarks-reorder',
      async (e, parent: string, orderedIds: string[]) => {
        await this.reorderBookmarks(parent, orderedIds);
      },
    );

    ipcMain.handle('history-get', (e) => {
      this.dedupeHistory();
      return this.history;
    });

    ipcMain.on('history-remove', (e, ids: string[]) => {
      this.removeHistoryByIds(ids == null ? ids : [...ids]);
    });

    ipcMain.handle('topsites-get', (e, count) => {
      const list = [];
      let c = 0;
      for (let i = this.history.length - 1; i >= 0; i--) {
        const x = this.history[i];
        if (x.title && x.title !== '') {
          const y = {...x, favicon: this.favicons.get(x.favicon)};
          list.push(y);
          c++;
          if (count != null && c >= count) {
            break;
          }
        }
      }
      return list;
    });

    ipcMain.handle('get-ad-lists', async (e) => {
      return getAdLists().join("\n\n");
    });

    ipcMain.handle('get-ad-filter-count', async (e) => {
      return filterCount;
    });

    ipcMain.on('update-ad-lists', async (e, str: string) => {
      console.log("update-ad-lists", str);
      e.returnValue = await updateAdLists(str, [
        Application.instance.sessions.view,
        Application.instance.sessions.viewIncognito,
      ]);
    });

    ipcMain.handle('is-site-whitelisted', async (e, domain: string) => {
      return isSiteWhitelisted(domain);
    });

    ipcMain.handle('toggle-site-adblock', async (e, domain: string) => {
      const enabled = await toggleSiteWhitelist(domain, [
        Application.instance.sessions.view,
        Application.instance.sessions.viewIncognito,
      ]);
      // 通知所有窗口刷新地址栏盾牌图标的白名单状态
      Application.instance.windows.broadcast('site-adblock-updated', domain, enabled);
      return enabled;
    });

    // ===== 广告拦截订阅管理 =====
    const adblockSessions = () => [
      Application.instance.sessions.view,
      Application.instance.sessions.viewIncognito,
    ];

    ipcMain.handle('adblock-get-subscriptions', async () => {
      return getSubscriptions();
    });

    ipcMain.handle('adblock-add-subscription', async (e, url: string) => {
      return addSubscription(url, adblockSessions());
    });

    ipcMain.handle('adblock-remove-subscription', async (e, url: string) => {
      return removeSubscription(url, adblockSessions());
    });

    ipcMain.handle('adblock-toggle-subscription', async (e, url: string, enabled: boolean) => {
      return toggleSubscription(url, enabled, adblockSessions());
    });

    ipcMain.handle('adblock-update-subscription', async (e, url: string) => {
      return updateSubscription(url, adblockSessions());
    });

    ipcMain.handle('adblock-update-all', async () => {
      return updateAllSubscriptions(adblockSessions());
    });

    ipcMain.handle('adblock-set-auto-update', async (e, hours: number) => {
      return setAutoUpdateHours(hours);
    });

    // ===== 广告拦截白名单 =====
    ipcMain.handle('adblock-get-whitelist', async () => {
      return getUserWhitelist();
    });

    ipcMain.handle('adblock-add-whitelist', async (e, domain: string) => {
      return addWhitelistDomain(domain, adblockSessions());
    });

    ipcMain.handle('adblock-remove-whitelist', async (e, domain: string) => {
      return removeWhitelistDomain(domain, adblockSessions());
    });

    // ===== 广告标识规则(用户自定义)文本 =====
    ipcMain.handle('adblock-get-user-rules', async () => {
      return getUserRulesText();
    });

    ipcMain.handle('adblock-save-user-rules', async (e, text: string) => {
      return saveUserRulesText(text, adblockSessions());
    });
  }

  public find<T>(data: IFindOperation): Promise<T[]> {
    const {scope, query} = data;

    if (this.usesDatabaseWorker(scope)) {
      return this.getDatabaseWorker(scope).request<T[]>('find', {query});
    }

    return new Promise((resolve, reject) => {
      this.databases[scope].find(query, (err: any, docs: any) => {
        if (err) reject(err);
        resolve(docs);
      });
    });
  }

  public findOne<T>(data: IFindOperation): Promise<T> {
    const {scope, query} = data;

    if (this.usesDatabaseWorker(scope)) {
      return this.getDatabaseWorker(scope).request<T>('findOne', {query});
    }

    return new Promise((resolve, reject) => {
      this.databases[scope].findOne(query, (err: any, doc: any) => {
        if (err) reject(err);
        resolve(doc);
      });
    });
  }

  public insert<T>(data: IInsertOperation): Promise<T> {
    const {scope, item} = data;

    if (this.usesDatabaseWorker(scope)) {
      return this.getDatabaseWorker(scope)
        .request<T>('insert', {item})
        .then((doc) => {
          if (scope === 'formfill') {
          }
          return doc;
        });
    }

    return new Promise((resolve, reject) => {
      this.databases[scope].insert(item, (err: any, doc: any) => {
        if (err) {
          reject(err);
          return;
        }
        if (scope === 'permissions') {
          this.refreshPermissionManagedViews().catch(() => undefined);
        }
        if (scope === 'formfill') {
        }
        resolve(doc);
      });
    });
  }

  // 批量插入(nedb 原生支持数组 insert,一次调用写多条)。用于移动端书签整树导入
  // 和密码云快照等大批量场景,把 N 次串行磁盘写压成 1 次。
  public insertMany<T>(data: {scope: string; items: T[]}): Promise<T[]> {
    const {scope, items} = data;
    if (this.usesDatabaseWorker(scope)) {
      return this.getDatabaseWorker(scope)
        .request<T[]>('insertMany', {items})
        .then((docs) => {
          if (scope === 'formfill' && docs.length > 0) {
          }
          return docs;
        });
    }
    return new Promise((resolve, reject) => {
      (this.databases[scope] as any).insert(items, (err: any, docs: any) => {
        if (err) reject(err);
        else resolve((docs as T[]) || []);
      });
    });
  }

  public remove(data: IRemoveOperation): Promise<number> {
    const {scope, query, multi} = data;

    if (this.usesDatabaseWorker(scope)) {
      return this.getDatabaseWorker(scope)
        .request<number>('remove', {query, multi})
        .then((removed) => {
          if (scope === 'formfill' && removed > 0) {
          }
          return removed;
        });
    }

    return new Promise((resolve, reject) => {
      this.databases[scope].remove(
        query,
        {multi},
        (err: any, removed: number) => {
          if (err) {
            reject(err);
            return;
          }
          if (scope === 'permissions') {
            this.refreshPermissionManagedViews().catch(() => undefined);
          }
          if (scope === 'formfill' && removed > 0) {
          }
          resolve(removed);
        },
      );
    });
  }

  public update(data: IUpdateOperation): Promise<number> {
    const {scope, query, value, multi} = data;

    // nedb 主键 _id 不可变:{$set: {_id: x}} 在匹配到 _id 不同的文档时会抛
    // "You can't change a document's _id"(replaceStartupTabIdNow 经 ...item
    // 扩散曾把 _id 带进 $set)。update 永不该改写主键,这里一律剔除。
    const {_id, ...setValue} = value || {};

    if (this.usesDatabaseWorker(scope)) {
      return this.getDatabaseWorker(scope)
        .request<number>('update', {
          query,
          value: setValue,
          multi,
        })
        .then((replaced) => {
          if (scope === 'formfill' && replaced > 0) {
          }
          return replaced;
        });
    }

    return new Promise((resolve, reject) => {
      this.databases[scope].update(
        query,
        {$set: setValue},
        {multi},
        (err: any, replaced: number) => {
          if (err) {
            reject(err);
            return;
          }
          if (scope === 'permissions') {
            this.refreshPermissionManagedViews().catch(() => undefined);
          }
          if (scope === 'formfill' && replaced > 0) {
          }
          resolve(replaced);
        },
      );
    });
  }

  public updateMany(data: {
    scope: string;
    updates: Array<{
      query: Record<string, unknown>;
      value: Record<string, unknown>;
      multi?: boolean;
    }>;
  }): Promise<number> {
    const {scope, updates} = data;
    if (updates.length === 0) return Promise.resolve(0);

    if (this.usesDatabaseWorker(scope)) {
      return this.getDatabaseWorker(scope)
        .request<number>('updateMany', {updates})
        .then((changed) => {
          if (scope === 'formfill' && changed > 0) {
          }
          return changed;
        });
    }

    return Promise.all(
      updates.map((update) =>
        this.update({
          scope,
          query: update.query,
          value: update.value,
          multi: update.multi,
        }),
      ),
    ).then((counts) => counts.reduce((total, count) => total + count, 0));
  }

  private async refreshPermissionManagedViews() {
    const windows = Application.instance.windows?.list || [];
    const tasks: Promise<any>[] = [];

    for (const win of windows) {
      for (const view of win.viewManager.views.values()) {
        if (typeof (view as any).syncOpenLinksInNewPageRule === 'function') {
          tasks.push((view as any).syncOpenLinksInNewPageRule());
        }
        if (typeof (view as any).syncOpenPopupsInNewTabRule === 'function') {
          tasks.push((view as any).syncOpenPopupsInNewTabRule());
        }
        if (typeof (view as any).syncExternalNavigationRule === 'function') {
          tasks.push((view as any).syncExternalNavigationRule());
        }
      }
    }

    tasks.push(reloadCertificateErrorPermissions(this));

    await Promise.allSettled(tasks);
  }

  // 打开数据库句柄。书签和密码库由各自的 worker 独占,其余库仍在主进程
  // autoload。此方法
  // 只启动句柄/线程且不会等待全量数据,必须在窗口创建前完成,使 storage-* IPC
  // 立即可用；内存缓存仍由下面的延迟任务载入。
  public openDatabases() {
    for (const key in this.databases) {
      if (this.usesDatabaseWorker(key)) {
        this.workerDatabases[key] = new DatabaseWorker(
          getPath(`storage/${key.toLowerCase()}.db`),
        );
      } else {
        this.databases[key] = this.createDatabase(key.toLowerCase());
      }
    }
  }

  private usesDatabaseWorker(scope: string) {
    return scope === 'bookmarks' || scope === 'formfill';
  }

  private getDatabaseWorker(scope: string) {
    if (!this.workerDatabases[scope]) {
      this.workerDatabases[scope] = new DatabaseWorker(
        getPath(`storage/${scope.toLowerCase()}.db`),
      );
    }
    return this.workerDatabases[scope];
  }

  // 载入书签/收藏/历史的内存缓存。这是启动重活(读全表 + 排序 + 历史去重),
  // 移出窗口创建关键路径,首屏渲染后再跑。完成后调用方应广播 reload-bookmarks
  // 让书签栏刷新(其首次 load() 可能读到空缓存)。
  public async loadCaches() {
    await this.ensureBookmarksLoaded();
    await this.loadFavicons();
    await this.loadHistory();
  }

  public async run() {
    this.openDatabases();
    await this.loadCaches();
  }

  private async loadFavicons() {
    const favicons = await this.find<IFavicon>({scope: 'favicons', query: {}});
    const migrations: Promise<number>[] = [];

    favicons.forEach((favicon) => {
      const data = normalizeFaviconDataUrl(favicon.data);

      if (this.favicons.get(favicon.url) == null) {
        this.favicons.set(favicon.url, data);
      }

      if (data !== favicon.data && favicon._id) {
        migrations.push(
          this.update({
            scope: 'favicons',
            query: {_id: favicon._id},
            value: {data},
          }).catch(() => 0),
        );
      }
    });

    await Promise.all(migrations);
  }

  private async loadHistory() {
    const items: IHistoryItem[] = await this.find({
      scope: 'history',
      query: {},
    });

    this.sortHistoryByDate(items);

    this.history = items;

    this.dedupeHistory();
  }

  // 去重:历史按时间升序排列后,相邻记录若 URL 完全相同则只保留最新的一条,
  // 其余从内存与磁盘中删除。
  private dedupeHistory() {
    try {
      // 云端合并会把记录追加到内存数组；恢复时间顺序后，倒序渲染时同一天的记录连续。
      this.sortHistoryByDate(this.history);

      const removeIds: string[] = [];
      const kept: IHistoryItem[] = [];

      for (let i = 0; i < this.history.length; i++) {
        const item = this.history[i];
        const prev = kept[kept.length - 1];

        if (prev && prev.url && item.url && prev.url === item.url) {
          // 相邻且 URL 相同:丢弃较旧的 prev,保留较新的 item
          if (prev._id) removeIds.push(prev._id);
          kept[kept.length - 1] = item;
        } else {
          kept.push(item);
        }
      }

      if (removeIds.length === 0) return;

      this.history = kept;
      removeIds.forEach((id) =>
        this.remove({scope: 'history', query: {_id: id}}).catch(() => {}),
      );
    } catch (e) {
      // 去重失败不应影响历史读取
    }
  }

  private sortHistoryByDate(items: IHistoryItem[]): void {
    items.sort((a, b) => {
      const aDate = typeof a.date === 'string' ? new Date(a.date).getTime() : a.date || 0;
      const bDate = typeof b.date === 'string' ? new Date(b.date).getTime() : b.date || 0;
      return aDate - bDate;
    });
  }

  private async loadBookmarks() {
    const items = await this.find<IBookmark>({scope: 'bookmarks', query: {}});

    items.sort((a, b) => a.order - b.order);

    let barFolder = items.find((x) => x.static === 'main');
    let otherFolder = items.find((x) => x.static === 'other');
    let mobileFolder = items.find((x) => x.static === 'mobile');

    this.bookmarks = items;

    if (!barFolder) {
      barFolder = await this.addBookmark({
        static: 'main',
        isFolder: true,
      });

      for (const item of items) {
        if (!item.static) {
          await this.updateBookmark(item._id, {parent: barFolder._id});
        }
      }
    }

    if (!otherFolder) {
      otherFolder = await this.addBookmark({
        static: 'other',
        isFolder: true,
      });
    }

    if (!mobileFolder) {
      mobileFolder = await this.addBookmark({
        static: 'mobile',
        isFolder: true,
      });
    }

    this.bookmarksLoaded = true;
  }

  public get areBookmarksLoaded(): boolean {
    return this.bookmarksLoaded;
  }

  public ensureBookmarksReady(): Promise<void> {
    if (!this.bookmarksLoadPromise) {
      this.bookmarksLoadPromise = this.loadBookmarks().catch((error) => {
        this.bookmarksLoaded = false;
        this.bookmarksLoadPromise = null;
        throw error;
      });
    }
    return this.bookmarksLoadPromise;
  }

  private ensureBookmarksLoaded(): Promise<void> {
    return this.ensureBookmarksReady();
  }

  private getImportRoot(nsRoot: string): IBookmark | undefined {
    return this.bookmarks.find((bookmark) =>
      nsRoot === 'toolbar'
        ? bookmark.static === 'main'
        : bookmark.static === 'other',
    );
  }

  private async importBrowserBookmarks(items: any[]) {
    await this.ensureBookmarksLoaded();

    const t = getMainTranslator(Application.instance.settings?.object?.language);
    let bookmarks = 0;
    let folders = 0;
    const pendingDocs: IBookmark[] = [];
    const touchedParents = new Map<string, IBookmark>();
    let nextOrder = this.bookmarks.filter((x) => !Boolean(x.static)).length;

    const ensureParentSnapshot = (parent: IBookmark): IBookmark | null => {
      if (!parent?._id) return null;
      let snapshot = touchedParents.get(parent._id);
      if (!snapshot) {
        snapshot = {
          ...parent,
          children: [...(parent.children || [])],
        };
        touchedParents.set(parent._id, snapshot);
      }
      return snapshot;
    };

    const appendChild = (parent: IBookmark, childId: string) => {
      const snapshot = ensureParentSnapshot(parent);
      if (!snapshot) return;
      snapshot.children.push(childId);
    };

    const importNodes = (nodes: any[], parent: IBookmark) => {
      if (!Array.isArray(nodes) || !parent) return;

      for (const item of nodes) {
        if (!item || typeof item !== 'object') continue;

        if (item.nsRoot) {
          const root = this.getImportRoot(item.nsRoot);
          if (root) importNodes(item.children, root);
          continue;
        }

        if (item.type === 'folder') {
          const folderId = createImportedBookmarkId();
          const folder: IBookmark = {
            _id: folderId,
            isFolder: true,
            title: String(item.title || t('bmioUntitledFolderName')),
            parent: parent._id,
            children: [],
            order: nextOrder++,
          };
          pendingDocs.push(folder);
          appendChild(parent, folderId);
          folders += 1;
          importNodes(item.children, folder);
          continue;
        }

        if (item.type === 'bookmark' && typeof item.url === 'string' && item.url) {
          const bookmarkId = createImportedBookmarkId();
          pendingDocs.push({
            _id: bookmarkId,
            isFolder: false,
            title: String(item.title || item.url),
            url: item.url,
            parent: parent._id,
            favicon: typeof item.icon === 'string' ? item.icon : undefined,
            order: nextOrder++,
          });
          appendChild(parent, bookmarkId);
          bookmarks += 1;
        }
      }
    };

    for (const item of items) {
      if (!item?.nsRoot) continue;
      const root = this.getImportRoot(item.nsRoot);
      if (root) importNodes(item.children, root);
    }

    if (pendingDocs.length === 0) {
      return {bookmarks, folders};
    }

    await this.insertMany<IBookmark>({
      scope: 'bookmarks',
      items: pendingDocs,
    });

    for (const parent of touchedParents.values()) {
      await this.update({
        scope: 'bookmarks',
        query: {_id: parent._id},
        value: {children: parent.children},
      });
      const index = this.bookmarks.findIndex((item) => item._id === parent._id);
      if (index >= 0) {
        this.bookmarks[index] = parent;
      }
    }

    const committedDocs = pendingDocs.map(
      (doc) => touchedParents.get(doc._id) || doc,
    );
    this.bookmarks.push(...committedDocs);
    this.bookmarks.sort((a, b) => (a.order || 0) - (b.order || 0));

    if (bookmarks > 0 || folders > 0) {
      Application.instance.windows?.broadcast('reload-bookmarks');
    }

    return {bookmarks, folders};
  }

  private async importBrowserHistory(result: {
    browserId: 'chrome' | 'edge' | 'firefox';
    profileName: string;
    count: number;
    oldestDate: number | null;
    newestDate: number | null;
    items: Array<{title: string; url: string; date: number}>;
  }) {
    const persisted = await this.find<IHistoryItem>({
      scope: 'history',
      query: {},
    });
    const historyKey = (item: Pick<IHistoryItem, 'url' | 'date'>) =>
      `${item.url || ''}\u0000${Number(item.date) || 0}`;
    const existingKeys = new Set(persisted.map(historyKey));
    const pending: IHistoryItem[] = [];
    let skipped = 0;

    // 本地历史读取会把时间相邻且 URL 相同的连续访问合并为最新一条。导入前
    // 先应用同一规则，否则这类记录导入后会被清理，下一次又被误判为可导入。
    const sourceItems: typeof result.items = [];
    for (const item of result.items || []) {
      const previous = sourceItems[sourceItems.length - 1];
      if (previous?.url && previous.url === item.url) {
        sourceItems[sourceItems.length - 1] = item;
        skipped++;
      } else {
        sourceItems.push(item);
      }
    }

    for (const item of sourceItems) {
      const date = Math.trunc(Number(item.date));
      const url = String(item.url || '');
      if (!url || !Number.isFinite(date) || date <= 0) {
        skipped++;
        continue;
      }

      const key = historyKey({url, date});
      if (existingKeys.has(key)) {
        skipped++;
        continue;
      }
      existingKeys.add(key);
      pending.push({
        title: String(item.title || url),
        url,
        date,
        favicon: '',
        cloudSyncExcluded: true,
      });
    }

    const inserted: IHistoryItem[] = [];
    const batchSize = 2000;
    for (let offset = 0; offset < pending.length; offset += batchSize) {
      const docs = await this.insertMany<IHistoryItem>({
        scope: 'history',
        items: pending.slice(offset, offset + batchSize),
      });
      inserted.push(...docs);
    }

    // 兼容引导页早于缓存加载、管理页晚于缓存加载两种调用时机。按 _id 合并
    // 数据库快照、当前内存和新记录，避免覆盖导入期间刚产生的本机访问。
    const combined = new Map<string, IHistoryItem>();
    for (const item of [...persisted, ...this.history, ...inserted]) {
      const key = item._id || historyKey(item);
      combined.set(key, item);
    }
    this.history = Array.from(combined.values());
    this.sortHistoryByDate(this.history);

    if (inserted.length > 0) {
      Application.instance.windows?.broadcast('history-imported');
    }

    return {
      browserId: result.browserId,
      profileName: result.profileName,
      count: result.count,
      oldestDate: result.oldestDate,
      newestDate: result.newestDate,
      imported: inserted.length,
      skipped,
    };
  }

  public async removeBookmark(id: string, silent = false): Promise<void> {
    const item = this.bookmarks.find((x) => x._id === id);

    if (!item) return;

    // Snapshot for chrome.bookmarks.onRemoved before we mutate the tree.
    const removedNode = !silent && this.crxExtensions
      ? bookmarkNodeById(this, id)
      : null;
    const removedParent = item.parent || '0';
    const removedIndex = removedNode?.index ?? 0;

    // Remove descendants while their parent links still exist. The old order
    // detached direct children first, so nested folders could survive as
    // orphans and later be classified into the wrong cloud scope.
    if (item.isFolder) {
      const childIds = this.bookmarks
        .filter((bookmark) => bookmark.parent === id)
        .map((bookmark) => bookmark._id);
      for (const childId of childIds) {
        await this.removeBookmark(childId, silent);
      }
    }

    this.bookmarks = this.bookmarks.filter((x) => x._id !== id);
    const parent = this.bookmarks.find((x) => x._id === item.parent);

    if (parent) {
      parent.children = parent.children.filter((x) => x !== id);
      // Parent bookkeeping is part of this delete transaction. Do not
      // schedule a cloud snapshot before the node itself is persisted away.
      await this.updateBookmark(item.parent, {children: parent.children}, true);
    }

    // Wait for the persistent delete before notifying cloud sync. Otherwise a
    // sync started by the mutation debounce can read a stale database snapshot
    // after the in-memory tree has already removed the node.
    await this.remove({scope: 'bookmarks', query: {_id: id}});
    if (removedNode) {
      this.crxExtensions?.notifyBookmarkRemoved(id, {
        parentId: removedParent,
        index: removedIndex,
        node: removedNode,
      });
    }
    if (!silent) {
      Application.instance.windows.broadcast('reload-bookmarks');
      if (this.bookmarksLoaded) {
      }
    }
  }

  public async updateBookmark(id: string, change: IBookmark, silent = false) {
    const current = this.bookmarks.find((x) => x._id === id);
    if (!current) return;

    const index = this.bookmarks.indexOf(current);
    const previousParent = current?.parent;

    this.bookmarks[index] = {...this.bookmarks[index], ...change};

    await this.update({
      scope: 'bookmarks',
      query: {_id: id},
      value: change,
    });

    if (change.parent !== undefined && change.parent !== previousParent) {
      if (previousParent) {
        const previousFolder = this.bookmarks.find(
          (x) => x._id === previousParent,
        );

        if (previousFolder?.children?.includes(id)) {
          await this.updateBookmark(
            previousFolder._id,
            {
              children: previousFolder.children.filter((childId) => childId !== id),
            },
            true,
          );
        }
      }

      if (change.parent) {
        const parent = this.bookmarks.find((x) => x._id === change.parent);
        if (parent && !parent.children.includes(id))
          await this.updateBookmark(
            parent._id,
            {
              children: [...parent.children, id],
            },
            true,
          );
      }
    } else if (change.parent) {
      const parent = this.bookmarks.find((x) => x._id === change.parent);
      if (parent && !parent.children.includes(id))
        await this.updateBookmark(
          parent._id,
          {
            children: [...parent.children, id],
          },
          true,
        );
    }

    if (!silent) {
      if (this.crxExtensions) {
        const node = bookmarkNodeById(this, id);
        if (node) {
          if (change.title !== undefined || change.url !== undefined) {
            this.crxExtensions.notifyBookmarkChanged(id, {
              title: node.title,
              url: node.url,
            });
          }
          if (change.parent !== undefined && change.parent !== previousParent) {
            this.crxExtensions.notifyBookmarkMoved(id, {
              parentId: node.parentId || '0',
              index: node.index ?? 0,
              oldParentId: previousParent || '0',
              oldIndex: node.index ?? 0,
            });
          }
        }
      }
      Application.instance.windows.broadcast('reload-bookmarks');
      if (this.bookmarksLoaded) {
      }
    }
  }

  // 书签栏拖拽排序：仅在同一个父级下重排兄弟项的 order。以这些兄弟当前的最小 order 为
  // 起点，按 [拖拽产生的新序列 ... 其余未涉及的兄弟(按现 order)] 分配连续值。跨父级 order
  // 交错不影响显示——书签栏与书签管理页都先按 parent 过滤再看 order，只保证同父级相对顺序
  // 正确即可。update 走 {$set}(部分更新)，传 {order} 不覆盖其它字段。
  public async reorderBookmarks(parent: string, orderedIds: string[]) {
    const children = this.bookmarks.filter((x) => x.parent === parent);
    if (children.length === 0) return;

    const idSet = new Set(orderedIds);
    const moved = orderedIds
      .map((id) => children.find((c) => c._id === id))
      .filter(Boolean) as IBookmark[];
    const rest = children
      .filter((c) => !idSet.has(c._id))
      .sort((a, b) => a.order - b.order);
    const sequence = [...moved, ...rest];

    const base = children.reduce((m, x) => Math.min(m, x.order), Infinity);
    const start = Number.isFinite(base) ? base : 0;

    let changed = false;
    await Promise.all(
      sequence.map(async (item, i) => {
        const newOrder = start + i;
        if (item.order === newOrder) return;
        item.order = newOrder; // 同步内存树
        changed = true;
        await this.update({
          scope: 'bookmarks',
          query: {_id: item._id},
          value: {order: newOrder},
        });
      }),
    );

    if (changed) {
      this.bookmarks.sort((a, b) => a.order - b.order);
      Application.instance.windows.broadcast('reload-bookmarks');
      if (this.bookmarksLoaded) {
      }
    }
  }

  // 判断书签（或其任意祖先）是否位于「移动设备书签」文件夹下
  public isUnderMobileFolder(bookmark: IBookmark): boolean {
    let current = bookmark;
    const guard = new Set<string>();

    while (current) {
      if (current.static === 'mobile') return true;
      if (current.parent == null || guard.has(current._id)) break;
      guard.add(current._id);
      current = this.bookmarks.find((x) => x._id === current.parent);
    }

    return false;
  }

  public async addBookmark(item: IBookmark, silent = false): Promise<IBookmark> {
    if (item.parent === undefined) {
      item.parent = null;
    }

    if (item.parent === null && !item.static) {
      throw new Error('Parent bookmark should be specified');
    }

    if (item.isFolder) {
      item.children = item.children || [];
    } else {
    }

    if (item.order === undefined) {
      item.order = this.bookmarks.filter((x) => !Boolean(x.static)).length;
    }

    const doc = await this.insert<IBookmark>({item, scope: 'bookmarks'});

    if (item.parent) {
      const parent = this.bookmarks.find((x) => x._id === item.parent);
      await this.updateBookmark(
        parent._id,
        {
          children: [...parent.children, doc._id],
        },
        silent,
      );
    }

    this.bookmarks.push(doc);

    if (!silent) {
      // Static folders (no `static` set => user bookmark) created here notify
      // chrome.bookmarks.onCreated. Static root folders are created during
      // startup before extensions load, so crxExtensions is null then.
      if (this.crxExtensions && !doc.static) {
        const node = bookmarkNodeById(this, doc._id);
        if (node) this.crxExtensions.notifyBookmarkCreated(node);
      }
      Application.instance.windows.broadcast('reload-bookmarks');
      if (this.bookmarksLoaded && !doc.static) {
      }
    }

    return doc;
  }

  private createDatabase = (name: string) => {
    return new Datastore({
      filename: getPath(`storage/${name}.db`),
      autoload: true,
    });
  };

  // 处理已下载的原始 buffer:ico→png 转换 + 生成 data URL + 写缓存(nedb + Map)。
  // 供主进程 requestURL 下载和页面脚本 fetch 两条路径共用,避免转换逻辑重复。
  public processFaviconBuffer = async (
    url: string,
    raw: Buffer,
  ): Promise<string> => {
    const existing = this.favicons.get(url);
    if (existing) {
      const normalized = normalizeFaviconDataUrl(existing);
      if (normalized !== existing) this.favicons.set(url, normalized);
      return normalized;
    }

    // 防异常大文件:ico→png 转换(icojs 解析)/ fromBuffer / nedb 持久化大 buffer
    // 都可能 OOM。1MB 足以容纳任何合理 favicon(多尺寸 ico / 高清 png / svg)。
    // 这是所有下载路径(主进程 requestURL + 页面脚本 fetch)的最终防线。
    if (raw.length > 1024 * 1024) {
      throw new Error(`favicon too large (${raw.length} bytes)`);
    }

    let data = raw;
    const fileTypeModule = await getFileType();
    const fileType = (fileTypeModule as any).default || fileTypeModule;
    const {fromBuffer} = fileType;
    let type = await fromBuffer(data);

    if (type && type.ext === 'ico') {
      data = Buffer.from(new Uint8Array(await convertIcoToPng(data)));
      type = await fromBuffer(data);
    }

    const mime = isSvgBuffer(data) ? 'image/svg+xml' : type?.mime;

    if (!mime) {
      throw new Error('unknown favicon format');
    }

    const str = `data:${mime};base64,${data.toString('base64')}`;

    this.insert({
      scope: 'favicons',
      item: {
        url,
        data: str,
      },
    });

    this.favicons.set(url, str);
    return str;
  };

  public addFavicon = async (
    url: string,
    referer?: string,
  ): Promise<string> => {
    if (this.favicons.get(url)) {
      return this.favicons.get(url);
    }

    const res = await requestURL(url, {
      headers: referer ? {Referer: referer} : undefined,
    });

    if (res.statusCode === 404) {
      throw new Error('404 favicon not found');
    }

    return this.processFaviconBuffer(url, Buffer.from(res.data, 'binary'));
  };

  private createBookmarkArray = (
    parentFolderId: string = null,
    first = true,
    depth = 1,
  ): string[] => {
    let payload: string[] = [];
    let title;
    const bookmarks = this.bookmarks.filter((x) => x.parent === parentFolderId);
    const indentFirst = indentType.repeat(depth * indentLength);
    const indentNext = !first
      ? indentFirst
      : indentType.repeat((depth + 1) * indentLength);

    if (first) payload.push(`${indentFirst}<DL><p>`);

    for (const bookmark of bookmarks) {
      if (!bookmark.isFolder && bookmark.url) {
        title = encodeTitle(bookmark.title);
        const href = encodeHref(bookmark.url);
        let icon = bookmark.favicon;

        // favicon 可选:书签可能没有图标(undefined),或其 URL 键在 favicons
        // 表里查不到(Map.get 返回 undefined)。两种情况都用空串,避免 startsWith 崩溃。
        if (icon && !icon.startsWith('data:')) {
          icon = this.favicons.get(icon);
        }
        if (!icon) icon = '';

        payload.push(
          `${indentNext}<DT><A HREF="${href}" ICON="${icon}">${title}</A>`,
        );
      } else if (bookmark.isFolder) {
        title = encodeTitle(bookmark.title);
        payload.push(`${indentNext}<DT><H3>${title}</H3>`);
        payload = payload.concat(
          this.createBookmarkArray(bookmark._id, true, depth + 1),
        );
      }
    }

    if (first) payload.push(`${indentFirst}</DL><p>`);

    return payload;
  };

  public exportBookmarks = async () => {
    const t = getMainTranslator(Application.instance.settings?.object?.language);
    const {filePath, canceled} = await dialog.showSaveDialog({
      filters: [{name: t('bmioExportFilterName'), extensions: ['html']}],
    });

    if (canceled) return;

    const breakTag = process.platform === 'win32' ? '\r\n' : '\n';
    const documentTitle = 'Bookmarks';

    const bar = this.createBookmarkArray(
      this.bookmarks.find((x) => x.static === 'main')._id,
    );

    const other = this.createBookmarkArray(
      this.bookmarks.find((x) => x.static === 'other')._id,
      false,
    );

    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
    It will be read and overwritten.
    DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>${documentTitle}</TITLE>
<H1>${documentTitle}</H1>
<DL><p>
    <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
${bar.join(breakTag)}
${other.join(breakTag)}
</DL><p>`;

    try {
      await promises.writeFile(filePath, html, 'utf8');
    } catch (err) {
      console.error(err);
    }
  };
}
