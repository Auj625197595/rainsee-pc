import { IBookmark, IHistoryItem } from '~/interfaces';
import { StorageService } from './storage';
import {
  BookmarksImpl,
  HistoryImpl,
} from '~/vendor/electron-chrome-extensions/browser/impl';

/**
 * Bridges the browser's own bookmark / history stores (StorageService, backed
 * by NeDB) to the vendored chrome.bookmarks / chrome.history API layer.
 *
 * The vendored API classes are app-agnostic and speak only the Chrome
 * `BookmarkTreeNode` / `HistoryItem` shapes; all mapping to/from the app's
 * `IBookmark` / `IHistoryItem` model lives here.
 */

// Synthetic root id for the bookmark tree (Chrome uses "0").
const ROOT_ID = '0';

// Chrome's permanent folders have fixed, well-known ids that extensions
// hardcode (e.g. `chrome.bookmarks.get('1')` for the bookmarks bar). The app's
// static folders carry random NeDB ids, so alias them at this boundary.
const STATIC_EXT_IDS: Record<string, string> = {main: '1', other: '2', mobile: '3'};
const EXT_ID_STATICS: Record<string, string> = {'1': 'main', '2': 'other', '3': 'mobile'};

/** Internal bookmark id -> id exposed to extensions. */
export function toExtBookmarkId(storage: StorageService, id: string | undefined): string {
  if (!id) return ROOT_ID;
  const b = storage.bookmarks.find((x) => x._id === id);
  return (b?.static && STATIC_EXT_IDS[b.static]) || id;
}

/** Id received from an extension -> internal bookmark id. */
export function fromExtBookmarkId(storage: StorageService, id: string): string {
  const stat = EXT_ID_STATICS[id];
  if (!stat) return id;
  return storage.bookmarks.find((x) => x.isFolder && x.static === stat)?._id || id;
}

// ---- chrome.bookmarks ----

const isVisibleFolder = (b: IBookmark) =>
  b.isFolder && (b.static === 'main' || b.static === 'other' || b.static === 'mobile');

function bookmarkTitle(b: IBookmark): string {
  if (b.title) return b.title;
  // Static folders have no user-facing title stored; give them stable names.
  switch (b.static) {
    case 'main':
      return 'Bookmarks bar';
    case 'other':
      return 'Other bookmarks';
    case 'mobile':
      return 'Mobile bookmarks';
    default:
      return '';
  }
}

// Direct children of a node, ordered. Top-level (static) folders are the
// children of the synthetic root.
function childrenOf(storage: StorageService, id: string): IBookmark[] {
  const list =
    id === ROOT_ID
      ? storage.bookmarks.filter((x) => isVisibleFolder(x))
      : storage.bookmarks.filter((x) => x.parent === id);
  if (id === ROOT_ID) {
    // Chrome exposes its permanent roots in this order. Extensions commonly
    // use the first root as the bookmarks bar. The app's static folders can all
    // have the same persisted `order`, so sorting by `order` alone is not enough.
    const rootOrder: Record<string, number> = {main: 0, other: 1, mobile: 2};
    return list.slice().sort((a, b) =>
      (rootOrder[a.static || ''] ?? 3) - (rootOrder[b.static || ''] ?? 3),
    );
  }
  return list.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function indexOf(storage: StorageService, b: IBookmark): number {
  const parentId = b.parent || ROOT_ID;
  return childrenOf(storage, parentId).findIndex((x) => x._id === b._id);
}

function toNode(
  storage: StorageService,
  b: IBookmark,
  recursive: boolean,
): chrome.bookmarks.BookmarkTreeNode {
  const node: chrome.bookmarks.BookmarkTreeNode = {
    id: toExtBookmarkId(storage, b._id),
    parentId: toExtBookmarkId(storage, b.parent),
    title: bookmarkTitle(b),
    index: indexOf(storage, b),
  };
  if (!b.isFolder && b.url) {
    node.url = b.url;
  }
  if (b.isFolder && recursive) {
    const kids = childrenOf(storage, b._id!);
    node.children = kids.map((k) => toNode(storage, k, true));
  }
  return node;
}

function rootNode(storage: StorageService, recursive: boolean): chrome.bookmarks.BookmarkTreeNode {
  const node: chrome.bookmarks.BookmarkTreeNode = {
    id: ROOT_ID,
    title: '',
  };
  if (recursive) {
    node.children = childrenOf(storage, ROOT_ID).map((c) => toNode(storage, c, true));
  }
  return node;
}

/**
 * Build the Chrome BookmarkTreeNode for a stored bookmark id. Used by both the
 * read API and the event broadcasters in StorageService. Returns null if the
 * id is unknown.
 */
export function bookmarkNodeById(
  storage: StorageService,
  id: string,
  recursive = false,
): chrome.bookmarks.BookmarkTreeNode | null {
  if (id === ROOT_ID) return rootNode(storage, recursive);
  const internalId = fromExtBookmarkId(storage, id);
  const b = storage.bookmarks.find((x) => x._id === internalId);
  return b ? toNode(storage, b, recursive) : null;
}

export function createBookmarksImpl(storage: StorageService): BookmarksImpl {
  // Extension startup can overlap the deferred bookmark-cache load. Without
  // this barrier getTree()/getChildren('0') can temporarily observe an empty
  // tree and make extension startup race the local cache initialization.
  const ready = () => storage.ensureBookmarksReady();
  const all = () => storage.bookmarks;

  const toInternal = (id: string) => fromExtBookmarkId(storage, id);
  const byId = (id: string): IBookmark | undefined =>
    id === ROOT_ID ? undefined : all().find((x) => x._id === toInternal(id));

  // Default parent for create()/move() when none given: the "Other bookmarks"
  // folder, matching Chrome.
  const defaultParentId = (): string | undefined =>
    all().find((x) => x.static === 'other')?._id;

  const requireNode = (id: string, recursive = false) => {
    const node = bookmarkNodeById(storage, id, recursive);
    if (!node) throw new Error(`Can't find bookmark for id ${id}`);
    return node;
  };

  return {
    async getTree() {
      await ready();
      return [rootNode(storage, true)];
    },

    async get(idList: string[]) {
      await ready();
      if (!idList.length) throw new Error('Bookmark id list must not be empty');
      return idList.map((id) => requireNode(id));
    },

    async getChildren(id: string) {
      await ready();
      requireNode(id);
      return childrenOf(storage, id === ROOT_ID ? ROOT_ID : toInternal(id)).map((c) => toNode(storage, c, false));
    },

    async getSubTree(id: string) {
      await ready();
      return [requireNode(id, true)];
    },

    async getRecent(count: number) {
      await ready();
      if (count < 1) throw new Error('numberOfItems cannot be less than 1.');
      const items = all().filter((x) => !x.isFolder && x.url);
      // Newest first. The app appends on insert, so reverse insertion order is
      // the best available proxy for recency.
      return items
        .slice()
        .reverse()
        .slice(0, Math.max(0, count))
        .map((b) => toNode(storage, b, false));
    },

    async search(query) {
      await ready();
      const terms: string[] = [];
      let urlMatch: string | undefined;
      let titleMatch: string | undefined;

      if (typeof query === 'string') {
        terms.push(...query.toLowerCase().split(/\s+/).filter(Boolean));
      } else {
        if (query.query) {
          terms.push(...query.query.toLowerCase().split(/\s+/).filter(Boolean));
        }
        urlMatch = query.url?.toLowerCase();
        titleMatch = query.title?.toLowerCase();
      }

      const matches = all().filter((b) => {
        if (b.isFolder && !terms.length && !titleMatch) return false;
        const title = (b.title || '').toLowerCase();
        const url = (b.url || '').toLowerCase();
        if (urlMatch !== undefined && url !== urlMatch) return false;
        if (titleMatch !== undefined && title !== titleMatch) return false;
        for (const t of terms) {
          if (!title.includes(t) && !url.includes(t)) return false;
        }
        return true;
      });

      return matches.map((b) => toNode(storage, b, false));
    },

    async create(bookmark) {
      await ready();
      const parent = bookmark.parentId ? toInternal(bookmark.parentId) : defaultParentId();
      const created = await storage.addBookmark({
        title: bookmark.title || '',
        url: bookmark.url,
        parent,
        isFolder: !bookmark.url,
      });
      return toNode(storage, created, false);
    },

    async move(id, destination) {
      await ready();
      if (storage.isProtectedBookmarkRoot(byId(id))) throw new Error("Can't modify the root bookmark folders.");
      const change: IBookmark = {};
      if (destination.parentId !== undefined) change.parent = toInternal(destination.parentId);
      if (destination.index !== undefined) change.order = destination.index;
      await storage.updateBookmark(toInternal(id), change);
      const b = byId(id);
      if (!b) throw new Error(`Bookmark ${id} not found`);
      return toNode(storage, b, false);
    },

    async update(id, changes) {
      await ready();
      if (storage.isProtectedBookmarkRoot(byId(id))) throw new Error("Can't modify the root bookmark folders.");
      const change: IBookmark = {};
      if (changes.title !== undefined) change.title = changes.title;
      if (changes.url !== undefined) change.url = changes.url;
      await storage.updateBookmark(toInternal(id), change);
      const b = byId(id);
      if (!b) throw new Error(`Bookmark ${id} not found`);
      return toNode(storage, b, false);
    },

    async remove(id) {
      await ready();
      const b = byId(id);
      if (!b) throw new Error(`Bookmark ${id} not found`);
      if (storage.isProtectedBookmarkRoot(b)) throw new Error("Can't modify the root bookmark folders.");
      if (b.isFolder && all().some((x) => x.parent === b._id)) {
        throw new Error("Can't remove non-empty folder (use recursive to force)");
      }
      await storage.removeBookmark(b._id!);
    },

    async removeTree(id) {
      await ready();
      const b = byId(id);
      if (!b) throw new Error(`Bookmark ${id} not found`);
      if (storage.isProtectedBookmarkRoot(b)) throw new Error("Can't modify the root bookmark folders.");
      // removeBookmark already recurses into folder contents.
      await storage.removeBookmark(b._id!);
    },
  };
}

// ---- chrome.history ----

// Chrome history ids are opaque strings, stable per URL. Derive a deterministic
// id from the URL so repeated queries return the same id.
function urlToHistoryId(url: string): string {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) {
    hash = (hash * 33) ^ url.charCodeAt(i);
  }
  // Unsigned, base36 — compact and stable.
  return (hash >>> 0).toString(36);
}

const toMillis = (date: number | string | undefined): number => {
  if (date === undefined) return 0;
  if (typeof date === 'number') return date;
  const t = new Date(date).getTime();
  return Number.isNaN(t) ? 0 : t;
};

export function createHistoryImpl(storage: StorageService): HistoryImpl {
  // Collapse the app's per-visit rows into one HistoryItem per URL, the shape
  // chrome.history.search returns.
  const aggregate = (): Map<string, chrome.history.HistoryItem> => {
    const map = new Map<string, chrome.history.HistoryItem>();
    for (const item of storage.history) {
      if (!item.url) continue;
      const when = toMillis(item.date);
      const existing = map.get(item.url);
      if (existing) {
        existing.visitCount = (existing.visitCount || 0) + 1;
        if (when > (existing.lastVisitTime || 0)) {
          existing.lastVisitTime = when;
          if (item.title) existing.title = item.title;
        }
      } else {
        map.set(item.url, {
          id: urlToHistoryId(item.url),
          url: item.url,
          title: item.title || '',
          lastVisitTime: when,
          visitCount: 1,
          typedCount: 0,
        });
      }
    }
    return map;
  };

  const removeByUrl = async (url: string) => {
    const ids = storage.history.filter((x) => x.url === url).map((x) => x._id);
    storage.history = storage.history.filter((x) => x.url !== url);
    for (const id of ids) {
      await storage.remove({ scope: 'history', query: { _id: id } });
    }
  };

  return {
    async search(query) {
      const text = (query.text || '').toLowerCase();
      const maxResults = query.maxResults && query.maxResults > 0 ? query.maxResults : 100;
      const startTime = query.startTime;
      const endTime = query.endTime;

      let results = Array.from(aggregate().values());

      if (text) {
        results = results.filter(
          (r) =>
            (r.title || '').toLowerCase().includes(text) ||
            (r.url || '').toLowerCase().includes(text),
        );
      }
      if (startTime !== undefined) {
        results = results.filter((r) => (r.lastVisitTime || 0) >= startTime);
      }
      if (endTime !== undefined) {
        results = results.filter((r) => (r.lastVisitTime || 0) < endTime);
      }

      results.sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
      return results.slice(0, maxResults);
    },

    async getVisits(details) {
      const visits = storage.history
        .filter((x) => x.url === details.url)
        .sort((a, b) => toMillis(a.date) - toMillis(b.date));
      const id = urlToHistoryId(details.url);
      return visits.map((v, i) => ({
        id,
        visitId: `${id}-${i}`,
        visitTime: toMillis(v.date),
        referringVisitId: '0',
        transition: 'link',
      }));
    },

    async addUrl(details) {
      const item: IHistoryItem = {
        url: details.url,
        title: '',
        date: new Date().getTime(),
      };
      const doc = await storage.insert<IHistoryItem>({ scope: 'history', item });
      item._id = doc._id;
      storage.addHistory(item);
    },

    async deleteUrl(details) {
      await removeByUrl(details.url);
    },

    async deleteRange(range) {
      const inRange = storage.history.filter((x) => {
        const t = toMillis(x.date);
        return t >= range.startTime && t <= range.endTime;
      });
      const ids = inRange.map((x) => x._id);
      storage.history = storage.history.filter((x) => {
        const t = toMillis(x.date);
        return !(t >= range.startTime && t <= range.endTime);
      });
      for (const id of ids) {
        await storage.remove({ scope: 'history', query: { _id: id } });
      }
    },

    async deleteAll() {
      storage.history = [];
      await storage.remove({ scope: 'history', query: {}, multi: true });
    },
  };
}
