import { IBookmark } from '~/interfaces';

// MobX toJS may preserve non-observable values attached by callers. IPC only
// needs the persisted bookmark fields, so build a primitive-only snapshot.
export function snapshotBookmarkForIpc(item: IBookmark): IBookmark {
  return {
    _id: typeof item._id === 'string' ? item._id : undefined,
    title: typeof item.title === 'string' ? item.title : undefined,
    url: typeof item.url === 'string' ? item.url : undefined,
    favicon: typeof item.favicon === 'string' ? item.favicon : undefined,
    hovered: typeof item.hovered === 'boolean' ? item.hovered : undefined,
    isFolder: typeof item.isFolder === 'boolean' ? item.isFolder : undefined,
    parent: typeof item.parent === 'string' ? item.parent : undefined,
    order: typeof item.order === 'number' ? item.order : undefined,
    expanded: typeof item.expanded === 'boolean' ? item.expanded : undefined,
    static: typeof item.static === 'string' ? item.static : undefined,
    children: Array.isArray(item.children)
      ? item.children.filter((id): id is string => typeof id === 'string')
      : undefined,
  };
}

export function snapshotBookmarksForIpc(items: IBookmark[]): IBookmark[] {
  return items.map(snapshotBookmarkForIpc);
}
