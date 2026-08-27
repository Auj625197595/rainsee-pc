import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { IBookmark } from '~/interfaces';
import store from '../../store';
import { getBookmarkTitle } from '../../utils';
import { getDraggedBookmarkId, hasBookmarkSortDrag } from '../../utils/drag';
import {
  StyledTreeItem,
  IconBox,
  Label,
  CountBadge,
  DropIcon,
} from './style';

const onClick = (item: IBookmark) => () => {
  store.currentFolder = item._id;
};

const onDropClick = (item: IBookmark) => (
  e: React.MouseEvent<HTMLDivElement>,
) => {
  e.stopPropagation();

  if (item.children.length > 0) {
    item.expanded = !item.expanded;
  }
};

// 拖拽悬停:仅用 dataTransfer.types 判断(dragover 阶段 getData 受安全限制返回空)。
// 放行 drop + 高亮;真正读 _id 与循环校验放到 onDrop(getData 此时可用)。
const onItemDragOver = (
  item: IBookmark,
  setHover: (v: boolean) => void,
) => (e: React.DragEvent<HTMLDivElement>) => {
  if (!hasBookmarkSortDrag(e.dataTransfer)) return;
  if (!item._id || store.isReadOnly(item)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  setHover(true);
};

const onItemDrop = (
  item: IBookmark,
  setHover: (v: boolean) => void,
) => (e: React.DragEvent<HTMLDivElement>) => {
  setHover(false);
  const draggedId = getDraggedBookmarkId(e.dataTransfer);
  if (!draggedId || !item._id) return;
  e.preventDefault();
  e.stopPropagation();
  const ids = store.getMoveSetFromDrag(draggedId);
  store.moveItemsToFolder(ids, item._id);
  store.clearBookmarkDrag();
};

const FolderGlyph = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
    <path d="M10 4l2 2h7a2 2 0 0 1 2 2v1H3V6a2 2 0 0 1 2-2h5zm11 7v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7h18z"></path>
  </svg>
);

const ChevronGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6"></path>
  </svg>
);

const TreeItem = observer(
  ({ depth, data }: { depth: number; data: IBookmark }) => {
    const [dropHover, setDropHover] = React.useState(false);

    if (!data) return null;

    const children = data.children || [];
    const selected = store.currentFolder === data._id;

    const c = children
      .map((x) => store.list.find((y) => x === y._id))
      .filter((x) => x && x.isFolder);

    return (
      <>
        <StyledTreeItem
          selected={selected}
          dropHover={dropHover}
          onClick={onClick(data)}
          onDragOver={onItemDragOver(data, setDropHover)}
          onDragLeave={() => setDropHover(false)}
          onDrop={onItemDrop(data, setDropHover)}
          style={{ marginLeft: depth * 16 }}
        >
          <IconBox selected={selected}>
            <FolderGlyph />
          </IconBox>
          <Label selected={selected}>{getBookmarkTitle(data)}</Label>
          {c.length > 0 ? (
            <DropIcon
              visible={c.length !== 0}
              expanded={data.expanded}
              onClick={onDropClick(data)}
            >
              <ChevronGlyph />
            </DropIcon>
          ) : (
            <CountBadge selected={selected}>{children.length}</CountBadge>
          )}
        </StyledTreeItem>
        {data.expanded &&
          c.map((item) => (
            <TreeItem key={item._id} data={item} depth={depth + 1} />
          ))}
      </>
    );
  },
);

export default TreeItem;
