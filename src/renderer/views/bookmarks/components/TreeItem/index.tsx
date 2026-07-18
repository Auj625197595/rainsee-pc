import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { IBookmark } from '~/interfaces';
import store from '../../store';
import { getBookmarkTitle } from '../../utils';
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
          onClick={onClick(data)}
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
