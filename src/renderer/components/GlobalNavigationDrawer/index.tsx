import * as React from 'react';
import { observer } from 'mobx-react-lite';
import {
  BookmarksSimple as BookmarksSimpleIcon,
  ClockCounterClockwise as ClockCounterClockwiseIcon,
  DownloadSimple as DownloadSimpleIcon,
  PuzzlePiece as PuzzlePieceIcon,
  Gear as GearIcon,
  ChartDonut as ChartDonutIcon,
} from '@phosphor-icons/react';

import { getWebUIURL } from '~/common/webui';
import { useI18n } from '~/renderer/components/I18n';
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
  const t = useI18n();
  return (
    <Rail>
      <RailGroup>
        <RailButton name="history" title={t('menuHistory')}>
          <ClockCounterClockwiseIcon size={20} weight="bold" />
        </RailButton>
        <RailButton name="bookmarks" title={t('menuBookmarks')}>
          <BookmarksSimpleIcon size={20} weight="bold" />
        </RailButton>
        <RailButton name="downloads" title={t('dlvTitle')}>
          <DownloadSimpleIcon size={20} weight="bold" />
        </RailButton>
        <RailButton name="extensions" title={t('mrPgExtensions')}>
          <PuzzlePieceIcon size={20} weight="bold" />
        </RailButton>
        <RailButton name="memory" title={t('mrPgMemory')}>
          <ChartDonutIcon size={20} weight="bold" />
        </RailButton>
      </RailGroup>
      <RailButton name="settings" title={t('settings')}>
        <GearIcon size={20} weight="bold" />
      </RailButton>
    </Rail>
  );
};
