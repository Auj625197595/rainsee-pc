import { IBookmark } from '~/interfaces';
import { ipcRenderer } from '~/common/renderer-ipc';
import { createLocaleTranslator, Translator } from '~/common/i18n';
import store from '../store';

// 书签管理器语言偏好(store.settings 由 WebUI 注入并随 update-settings 刷新)。
const t = () => createLocaleTranslator(store.settings.language);

export type SortCriteria = 'title-asc' | 'title-desc' | 'url-asc' | 'url-desc';

// 书签排序比较器。名称用 zh 区域 localeCompare(中文拼音友好);网址排序时文件夹无 url,
// 退化为按名称比较,避免文件夹被随机挤到结果中间。主键相同时按名称二级稳定。
export const compareBookmark = (
  a: IBookmark,
  b: IBookmark,
  criteria: SortCriteria,
): number => {
  const titleA = (a.title || '').trim();
  const titleB = (b.title || '').trim();
  const urlA = (a.url || '').trim();
  const urlB = (b.url || '').trim();

  let primary = 0;
  if (criteria === 'title-asc' || criteria === 'title-desc') {
    primary = titleA.localeCompare(titleB, 'zh');
  } else {
    primary = (urlA || titleA).localeCompare(urlB || titleB, 'zh');
  }

  if (primary !== 0) {
    return criteria.endsWith('-desc') ? -primary : primary;
  }
  return titleA.localeCompare(titleB, 'zh');
};

export const getBookmarkTitle = (item: IBookmark, tr?: Translator) => {
  if (!item.static) return item.title;

  const translator = tr || t();

  if (item.static === 'main') {
    return translator('bookmarkBar');
  }

  if (item.static === 'mobile') {
    return translator('mobileDeviceBookmarks');
  }

  if (item.static === 'other') {
    return translator('bookmarksOtherFolder');
  }

  return item.title;
};

// Chrome's bookmark manager shows a folder's location alongside the item,
// especially in search results. Keep the full ancestor chain so the location
// remains useful even when the current view is filtered or searched.
export const getBookmarkPath = (item: IBookmark, tr?: Translator): string => {
  if (!item?.isFolder) return '';
  const ancestors = item.parent ? store.getFolderPath(item.parent) : [];
  const path = ancestors
    .map((x) => getBookmarkTitle(x, tr))
    .filter(Boolean)
    .join(' > ');
  return path || t()('bmMyBookmarks');
};

export const addImported = async (arr: any[], parent: IBookmark = null) => {
  // 顶层导入统一交给主进程批量落库，避免 renderer 逐条 IPC 导致大批量导入卡顿。
  if (parent == null) {
    // pendingImport 会被 MobX 转为 observable；Electron IPC 不能克隆 Proxy，
    // 因此在跨进程前还原为浏览器书签数据所需的纯 JSON 对象。
    const items = JSON.parse(JSON.stringify(arr));
    await ipcRenderer.invoke('bookmarks-import-tree', items);
    await store.load();
    return;
  }

  let order = 0;

  for (const item of arr) {
    if (item.nsRoot) {
      let folder: IBookmark = null;

      if (item.nsRoot === 'toolbar') {
        folder = store.list.find((x) => x.static === 'main');
      } else {
        folder = store.list.find((x) => x.static === 'other');
      }

      if (folder) {
        await addImported(item.children, folder);
      }

      // 原为 return; —— 会丢掉首个 nsRoot 根之后的所有顶层根（如"其它书签"）。
      // 改 continue 让 toolbar / menu / unsorted 都能各自路由到对应静态文件夹。
      continue;
    }

    const bookmark = await store.addItem({
      isFolder: item.type === 'folder',
      title: item.title,
      url: item.url,
      parent: parent && parent._id,
      children: [],
      favicon: item.icon,
      order,
    });

    if (parent) {
      parent.children.push(bookmark._id);
    }

    if (bookmark.isFolder) {
      await addImported(item.children, bookmark);
    }

    order++;
  }
};
