import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { IBookmark } from '~/interfaces';
import store from '../../store';
import { getBookmarkTitle } from '../../utils';
import {
  PickerWrap,
  PickerToolbar,
  SearchBox,
  SearchInput,
  ToolbarBtn,
  TreeViewport,
  TreeItemRow,
  TreeToggle,
  TreeToggleSpacer,
  TreeIconBox,
  TreeLabel,
  TreeMeta,
  TreeCheck,
  EmptyState,
} from './style';

interface Props {
  selectedId: string | null;
  onSelect: (folder: IBookmark) => void;
  excludeIds?: string[];
}

const FolderGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
    <path
      d="M3.75 7.5A2.25 2.25 0 0 1 6 5.25h4.03a2.25 2.25 0 0 1 1.59.66l1.22 1.22a2.25 2.25 0 0 0 1.59.66H18A2.25 2.25 0 0 1 20.25 10v6A2.25 2.25 0 0 1 18 18.25H6A2.25 2.25 0 0 1 3.75 16V7.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

const ChevronGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
    <path
      d="m9 6 6 6-6 6"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SearchGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path
      d="m21 21-4.35-4.35"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2.2" />
  </svg>
);

const CheckGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <path
      d="m5.5 12.5 4 4 9-9"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const matchesFolder = (folder: IBookmark, query: string): boolean => {
  if (query === '') return true;
  if (getBookmarkTitle(folder).toLowerCase().includes(query)) return true;
  return store
    .getFolderChildren(folder._id)
    .some((child) => matchesFolder(child, query));
};

const FolderTreeItem = observer(
  ({
    folder,
    depth,
    query,
    selectedId,
    excludeIds,
    onSelect,
  }: {
    folder: IBookmark;
    depth: number;
    query: string;
    selectedId: string | null;
    excludeIds: Set<string>;
    onSelect: (folder: IBookmark) => void;
  }) => {
    const children = store.getFolderChildren(folder._id);
    const visibleChildren = children.filter((child) =>
      matchesFolder(child, query),
    );
    const selected = selectedId === folder._id;
    const disabled = excludeIds.has(folder._id);
    const expanded = query !== '' || store.isFolderExpanded(folder._id);

    if (query !== '' && !matchesFolder(folder, query)) return null;

    return (
      <>
        <TreeItemRow
          depth={depth}
          selected={selected}
          disabled={disabled}
          onClick={() => !disabled && onSelect(folder)}
        >
          {children.length > 0 ? (
            <TreeToggle
              type="button"
              expanded={expanded}
              onClick={(e) => {
                e.stopPropagation();
                store.toggleFolderExpanded(folder._id);
              }}
              aria-label={expanded ? '收起文件夹' : '展开文件夹'}
            >
              <ChevronGlyph />
            </TreeToggle>
          ) : (
            <TreeToggleSpacer />
          )}
          <TreeIconBox selected={selected}>
            <FolderGlyph />
          </TreeIconBox>
          <TreeLabel selected={selected}>
            {getBookmarkTitle(folder)}
          </TreeLabel>
          <TreeMeta>
            {children.length > 0 ? `${children.length} 个子级` : '空文件夹'}
          </TreeMeta>
          <TreeCheck selected={selected}>{selected && <CheckGlyph />}</TreeCheck>
        </TreeItemRow>
        {expanded &&
          visibleChildren.map((child) => (
            <FolderTreeItem
              key={child._id}
              folder={child}
              depth={depth + 1}
              query={query}
              selectedId={selectedId}
              excludeIds={excludeIds}
              onSelect={onSelect}
            />
          ))}
      </>
    );
  },
);

export const FolderPicker = observer(
  ({ selectedId, onSelect, excludeIds = [] }: Props) => {
    const query = store.folderPickerSearch.trim().toLowerCase();
    const excludeSet = React.useMemo(
      () => new Set(excludeIds),
      [excludeIds],
    );
    const rootFolders = store
      .getFolderTreeRoots()
      .filter((folder) => matchesFolder(folder, query));
    const allFolders = store.list.filter((x) => x.isFolder);
    const allExpanded =
      allFolders.length > 0 &&
      store.expandedFolderIds.length >= allFolders.length;

    return (
      <PickerWrap>
        <PickerToolbar>
          <SearchBox>
            <SearchGlyph />
            <SearchInput
              placeholder="搜索文件夹"
              value={store.folderPickerSearch}
              onChange={(e) => store.setFolderPickerSearch(e.target.value)}
            />
          </SearchBox>
          <ToolbarBtn
            type="button"
            onClick={
              query !== ''
                ? () => store.setFolderPickerSearch('')
                : allExpanded
                  ? () => store.collapseAllFolders()
                  : () => store.expandAllFolders()
            }
          >
            {query !== '' ? '清空' : allExpanded ? '收起全部' : '展开全部'}
          </ToolbarBtn>
        </PickerToolbar>

        <TreeViewport>
          {rootFolders.length > 0 ? (
            rootFolders.map((folder) => (
              <FolderTreeItem
                key={folder._id}
                folder={folder}
                depth={0}
                query={query}
                selectedId={selectedId}
                excludeIds={excludeSet}
                onSelect={onSelect}
              />
            ))
          ) : (
            <EmptyState>
              {allFolders.length === 0 && query === ''
                ? '暂无文件夹'
                : '没有找到匹配的文件夹'}
            </EmptyState>
          )}
        </TreeViewport>
      </PickerWrap>
    );
  },
);

export default FolderPicker;
