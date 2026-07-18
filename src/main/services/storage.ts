import {ipcMain, dialog} from 'electron';
import * as Datastore from 'nedb';
import {fromBuffer} from 'file-type';
import * as icojs from 'icojs';

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
import {requestURL} from '../network/request';
import * as parse from 'node-bookmarks-parser';
import {filterCount, getAdLists, updateAdLists, isSiteWhitelisted, toggleSiteWhitelist, getSubscriptions, addSubscription, removeSubscription, toggleSubscription, updateSubscription, updateAllSubscriptions, setAutoUpdateHours, getUserWhitelist, addWhitelistDomain, removeWhitelistDomain, getUserRulesText, saveUserRulesText} from "~/main/services/adblock";
import {bookmarkNodeById} from "./extension-bookmarks-history";

interface Databases {
  [key: string]: Datastore;
}

const convertIcoToPng = async (icoData: Buffer): Promise<ArrayBuffer> => {
  return (await icojs.parse(icoData, 'image/png'))[0].buffer;
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

const indentLength = 4;
const indentType = ' ';

export class StorageService {
  public databases: Databases = {
    favicons: null,
    bookmarks: null,
    history: null,
    formfill: null,
    startupTabs: null,
    // 标签组记录 {id, windowId, name, color, order}。与 startupTabs 同套 NeDB,
    // openDatabases() 自动建 storage/tabgroups.db。
    tabGroups: null,
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
      const dialogRes = await dialog.showOpenDialog({
        filters: [{name: '选择要导入的书签文件', extensions: ['html']}],
      });

      try {
        const file = await promises.readFile(dialogRes.filePaths[0], 'utf8');
        return parse(file);
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

    ipcMain.handle('export-bookmarks', async () => {
      await this.exportBookmarks();
    });

    ipcMain.handle('bookmarks-get', (e) => {
      return this.bookmarks;
    });

    ipcMain.on('bookmarks-remove', (e, ids: string[]) => {
      ids.forEach((x) => this.removeBookmark(x));
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

    ipcMain.handle('bookmarks-get-folders', async (e) => {
      return this.bookmarks.filter(
        (x) => x.isFolder && !this.isUnderMobileFolder(x),
      );
    });

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
      const urls = this.crxExtensions
        ? this.history.filter((x) => ids.indexOf(x._id) !== -1).map((x) => x.url).filter(Boolean)
        : [];
      this.history = this.history.filter((x) => ids.indexOf(x._id) === -1);
      ids.forEach((x) => this.remove({scope: 'history', query: {_id: x}}));
      if (urls.length) {
        this.crxExtensions?.notifyHistoryVisitRemoved({allHistory: false, urls});
      }
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
          if (c >= count) {
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

    return new Promise((resolve, reject) => {
      this.databases[scope].find(query, (err: any, docs: any) => {
        if (err) reject(err);
        resolve(docs);
      });
    });
  }

  public findOne<T>(data: IFindOperation): Promise<T> {
    const {scope, query} = data;

    return new Promise((resolve, reject) => {
      this.databases[scope].findOne(query, (err: any, doc: any) => {
        if (err) reject(err);
        resolve(doc);
      });
    });
  }

  public insert<T>(data: IInsertOperation): Promise<T> {
    const {scope, item} = data;

    return new Promise((resolve, reject) => {
      this.databases[scope].insert(item, (err: any, doc: any) => {
        if (err) {
          reject(err);
          return;
        }
        if (scope === 'permissions') {
          this.refreshPermissionManagedViews().catch(() => undefined);
        }
        resolve(doc);
      });
    });
  }

  // 批量插入(nedb 原生支持数组 insert,一次调用写多条)。用于移动端书签整树导入
  // 等大批量场景,把 N 次串行磁盘写压成 1 次。docs 需自带 _id(由调用方生成)。
  public insertMany<T>(data: {scope: string; items: T[]}): Promise<T[]> {
    const {scope, items} = data;
    return new Promise((resolve, reject) => {
      (this.databases[scope] as any).insert(items, (err: any, docs: any) => {
        if (err) reject(err);
        else resolve((docs as T[]) || []);
      });
    });
  }

  public remove(data: IRemoveOperation): Promise<number> {
    const {scope, query, multi} = data;

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
          resolve(removed);
        },
      );
    });
  }

  public update(data: IUpdateOperation): Promise<number> {
    const {scope, query, value, multi} = data;

    return new Promise((resolve, reject) => {
      this.databases[scope].update(
        query,
        {$set: value},
        {multi},
        (err: any, replaced: number) => {
          if (err) {
            reject(err);
            return;
          }
          if (scope === 'permissions') {
            this.refreshPermissionManagedViews().catch(() => undefined);
          }
          resolve(replaced);
        },
      );
    });
  }

  private async refreshPermissionManagedViews() {
    const windows = Application.instance.windows?.list || [];
    const tasks: Promise<any>[] = [];

    for (const win of windows) {
      for (const view of win.viewManager.views.values()) {
        if (typeof (view as any).syncOpenLinksInNewPageRule === 'function') {
          tasks.push((view as any).syncOpenLinksInNewPageRule());
        }
      }
    }

    await Promise.allSettled(tasks);
  }

  // 打开数据库句柄。便宜且同步(仅 new Datastore + autoload),必须在窗口创建前
  // 完成,使 storage-get/insert 等 IPC 立即可用——历史页/搜索联想走 DB 查询,
  // 不依赖下面的内存缓存。
  public openDatabases() {
    for (const key in this.databases) {
      this.databases[key] = this.createDatabase(key.toLowerCase());
    }
  }

  // 载入书签/收藏/历史的内存缓存。这是启动重活(读全表 + 排序 + 历史去重),
  // 移出窗口创建关键路径,首屏渲染后再跑。完成后调用方应广播 reload-bookmarks
  // 让书签栏刷新(其首次 load() 可能读到空缓存)。
  public async loadCaches() {
    await this.loadBookmarks();
    await this.loadFavicons();
    await this.loadHistory();
  }

  public async run() {
    this.openDatabases();
    await this.loadCaches();
  }

  private async loadFavicons() {
    (await this.find<IFavicon>({scope: 'favicons', query: {}})).forEach(
      (favicon) => {
        const {data} = favicon;

        if (this.favicons.get(favicon.url) == null) {
          this.favicons.set(favicon.url, data);
        }
      },
    );
  }

  private async loadHistory() {
    const items: IHistoryItem[] = await this.find({
      scope: 'history',
      query: {},
    });

    items.sort((a, b) => {
      let aDate = a.date;
      let bDate = b.date;

      if (typeof aDate === 'string') {
        aDate = new Date(a.date).getTime();
        bDate = new Date(b.date).getTime();
      }

      return aDate - bDate;
    });

    this.history = items;

    this.dedupeHistory();
  }

  // 去重:历史按时间升序排列后,相邻记录若 URL 完全相同则只保留最新的一条,
  // 其余从内存与磁盘中删除。
  private dedupeHistory() {
    try {
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
  }

  public removeBookmark(id: string) {
    const item = this.bookmarks.find((x) => x._id === id);

    if (!item) return;

    // Snapshot for chrome.bookmarks.onRemoved before we mutate the tree.
    const removedNode = this.crxExtensions ? bookmarkNodeById(this, id) : null;
    const removedParent = item.parent || '0';
    const removedIndex = removedNode?.index ?? 0;

    this.bookmarks = this.bookmarks.filter((x) => x._id !== id);
    const parent = this.bookmarks.find((x) => x._id === item.parent);

    parent.children = parent.children.filter((x) => x !== id);
    this.updateBookmark(item.parent, {children: parent.children});

    this.remove({scope: 'bookmarks', query: {_id: id}});

    if (item.isFolder) {
      this.bookmarks = this.bookmarks.filter((x) => x.parent !== id);
      const removed = this.bookmarks.filter((x) => x.parent === id);

      this.remove({scope: 'bookmarks', query: {parent: id}, multi: true});

      for (const i of removed) {
        if (i.isFolder) {
          this.removeBookmark(i._id);
        }
      }
    }
    if (removedNode) {
      this.crxExtensions?.notifyBookmarkRemoved(id, {
        parentId: removedParent,
        index: removedIndex,
        node: removedNode,
      });
    }
    Application.instance.windows.broadcast('reload-bookmarks');
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
    if (existing) return existing;

    // 防异常大文件:ico→png 转换(icojs 解析)/ fromBuffer / nedb 持久化大 buffer
    // 都可能 OOM。1MB 足以容纳任何合理 favicon(多尺寸 ico / 高清 png / svg)。
    // 这是所有下载路径(主进程 requestURL + 页面脚本 fetch)的最终防线。
    if (raw.length > 1024 * 1024) {
      throw new Error(`favicon too large (${raw.length} bytes)`);
    }

    let data = raw;
    let type = await fromBuffer(data);

    if (type && type.ext === 'ico') {
      data = Buffer.from(new Uint8Array(await convertIcoToPng(data)));
      type = await fromBuffer(data);
    }

    if (!type) {
      throw new Error('unknown favicon format');
    }

    const str = `data:${type.ext};base64,${data.toString('base64')}`;

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

        if (!icon.startsWith('data:')) {
          icon = this.favicons.get(icon);
        }

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
    const {filePath, canceled} = await dialog.showSaveDialog({
      filters: [{name: '选择导出书签文件路径', extensions: ['html']}],
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
