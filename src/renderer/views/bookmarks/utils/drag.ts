// 书签拖拽共享工具:自定义 MIME 用于区分“内部书签拖拽”与“标题链接外拖”。
// Bookmark 卡片(拖源)、TreeItem/面包屑(放置目标)三处复用。

export const BOOKMARK_SORT_MIME = 'application/x-rainsee-bookmark-sort';

// 判断当前拖拽是否为书签内部拖拽(仅认自定义 MIME,排除文本/链接拖拽)。
export const hasBookmarkSortDrag = (dataTransfer: DataTransfer | null) => {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types || []).includes(BOOKMARK_SORT_MIME);
};

// 读取被拖书签 _id;非内部拖拽返回 null。
export const getDraggedBookmarkId = (
  dataTransfer: DataTransfer | null,
): string | null => {
  if (!hasBookmarkSortDrag(dataTransfer)) return null;
  try {
    const id = dataTransfer.getData(BOOKMARK_SORT_MIME);
    return id || null;
  } catch {
    return null;
  }
};
