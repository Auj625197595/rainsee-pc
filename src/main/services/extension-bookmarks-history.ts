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
    id: b._id!,
    parentId: b.parent || ROOT_ID,
    title: bookmarkTitle(b),
    index: indexOf(storage, b),
  };
  if (!b.isFolder && b.url) {
    node.url = b.url;
  }
  if (b.isFolder) {
    const kids = childrenOf(storage, b._id!);
    node.children = kids.map((k) => toNode(storage, k, recursive));
  }
  return node;
}

function rootNode(storage: StorageService, recursive: boolean): chrome.bookmarks.BookmarkTreeNode {
  return {
    id: ROOT_ID,
    title: '',
    children: childrenOf(storage, ROOT_ID).map((c) => toNode(storage, c, recursive)),
  };
}

/**
 * Build the Chrome BookmarkTreeNode for a stored bookmark id. Used by both the
 * read API and the event broadcasters in StorageService. Returns null if the
 * id is unknown.
 */
export function bookmarkNodeById(
  storage: StorageService,
  id: string,
): chrome.bookmarks.BookmarkTreeNode | null {
  if (id === ROOT_ID) return rootNode(storage, false);
  const b = storage.bookmarks.find((x) => x._id === id);
  return b ? toNode(storage, b, false) : null;
}

export function createBookmarksImpl(storage: StorageService): BookmarksImpl {
  const all = () => storage.bookmarks;

  const byId = (id: string): IBookmark | undefined =>
    id === ROOT_ID ? undefined : all().find((x) => x._id === id);

  // Default parent for create()/move() when none given: the "Other bookmarks"
  // folder, matching Chrome.
  const defaultParentId = (): string | undefined =>
    all().find((x) => x.static === 'other')?._id;

  return {
    async getTree() {
      return [rootNode(storage, true)];
    },

    async get(idList: string[]) {
      const nodes: chrome.bookmarks.BookmarkTreeNode[] = [];
      for (const id of idList) {
        const node = bookmarkNodeById(storage, id);
        if (node) nodes.push(node);
      }
      return nodes;
    },

    async getChildren(id: string) {
      return childrenOf(storage, id).map((c) => toNode(storage, c, false));
    },

    async getSubTree(id: string) {
      if (id === ROOT_ID) return [rootNode(storage, true)];
      const b = byId(id);
      return b ? [toNode(storage, b, true)] : [];
    },

    async getRecent(count: number) {
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
      const parent = bookmark.parentId || defaultParentId();
      const created = await storage.addBookmark({
        title: bookmark.title || '',
        url: bookmark.url,
        parent,
        isFolder: !bookmark.url,
      });
      return toNode(storage, created, false);
    },

    async move(id, destination) {
      const change: IBookmark = {};
      if (destination.parentId !== undefined) change.parent = destination.parentId;
      if (destination.index !== undefined) change.order = destination.index;
      await storage.updateBookmark(id, change);
      const b = byId(id);
      if (!b) throw new Error(`Bookmark ${id} not found`);
      return toNode(storage, b, false);
    },

    async update(id, changes) {
      const change: IBookmark = {};
      if (changes.title !== undefined) change.title = changes.title;
      if (changes.url !== undefined) change.url = changes.url;
      await storage.updateBookmark(id, change);
      const b = byId(id);
      if (!b) throw new Error(`Bookmark ${id} not found`);
      return toNode(storage, b, false);
    },

    async remove(id) {
      const b = byId(id);
      if (!b) throw new Error(`Bookmark ${id} not found`);
      if (b.isFolder && all().some((x) => x.parent === id)) {
        throw new Error("Can't remove non-empty folder (use recursive to force)");
      }
      storage.removeBookmark(id);
    },

    async removeTree(id) {
      const b = byId(id);
      if (!b) throw new Error(`Bookmark ${id} not found`);
      // removeBookmark already recurses into folder contents.
      storage.removeBookmark(id);
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
