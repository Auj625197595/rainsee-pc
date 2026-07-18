import { IBookmark } from '~/interfaces';
import store from '../store';

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

export const getBookmarkTitle = (item: IBookmark) => {
  if (!item.static) return item.title;

  if (item.static === 'main') {
    return '书签栏';
  }

  if (item.static === 'mobile') {
    return '移动设备书签';
  }

  if (item.static === 'other') {
    return '其它文件夹';
  }

  return item.title;
};

export const addImported = async (arr: any[], parent: IBookmark = null) => {
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
