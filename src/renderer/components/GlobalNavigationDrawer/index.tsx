import * as React from 'react';
import { observer } from 'mobx-react-lite';
import {
  BookmarksSimple as BookmarksSimpleIcon,
  ClockCounterClockwise as ClockCounterClockwiseIcon,
  DownloadSimple as DownloadSimpleIcon,
  PuzzlePiece as PuzzlePieceIcon,
  Gear as GearIcon,
} from '@phosphor-icons/react';

import { getWebUIURL } from '~/common/webui';
import { Rail, RailGroup, RailItem } from './style';

const RailButton = observer(
  ({
    name,
    title,
    children,
  }: {
    name: string;
    title: string;
    children: React.ReactNode;
  }) => {
    const selected = window.location.href.startsWith(getWebUIURL(name));
    return (
      <RailItem
        title={title}
        selected={selected}
        onClick={() => (window.location.href = getWebUIURL(name))}
      >
        {children}
      </RailItem>
    );
  },
);

export const GlobalNavigationDrawer = () => {
  return (
    <Rail>
      <RailGroup>
        <RailButton name="history" title="历史记录">
          <ClockCounterClockwiseIcon size={20} weight="bold" />
        </RailButton>
        <RailButton name="bookmarks" title="书签">
          <BookmarksSimpleIcon size={20} weight="bold" />
        </RailButton>
        <RailButton name="downloads" title="下载管理">
          <DownloadSimpleIcon size={20} weight="bold" />
        </RailButton>
        <RailButton name="extensions" title="扩展管理">
          <PuzzlePieceIcon size={20} weight="bold" />
        </RailButton>
      </RailGroup>
      <RailButton name="settings" title="设置">
        <GearIcon size={20} weight="bold" />
      </RailButton>
    </Rail>
  );
};
