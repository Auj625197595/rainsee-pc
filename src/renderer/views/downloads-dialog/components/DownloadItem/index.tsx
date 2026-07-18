import * as React from 'react';
import { observer } from 'mobx-react-lite';
import {
  StyledDownloadItem,
  Body,
  Icon,
  Main,
  TitleRow,
  Title,
  MoreButton,
  StatusRow,
  StatusBadge,
  Detail,
  ProgressBackground,
  Progress,
  DownloadStatus,
} from './style';
import { IDownloadItem } from '~/interfaces';
import prettyBytes = require('pretty-bytes');
import { shell } from 'electron';
import * as remote from '@electron/remote';
import store from '../../store';
import { DownloadItemMenu } from '../DownloadItemMenu';
import { getDownloadMenuTemplate } from '../download-menu';

const onClick = (item: IDownloadItem) => () => {
  if (item.completed) {
    shell.openPath(item.savePath);
  }
};

// 右键下载项 → 在光标处弹出原生菜单(与「⋯」下拉菜单共用同一套操作)。
const onContextMenu =
  (item: IDownloadItem) => (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    store.closeAllDownloadMenu();
    const menu = remote.Menu.buildFromTemplate(getDownloadMenuTemplate(item));
    menu.popup();
  };

const onMoreClick =
  (item: IDownloadItem) => (e: React.MouseEvent<HTMLButtonElement>) => {
    store.openMenu(item);
    e.stopPropagation();
  };

const getStatus = (item: IDownloadItem): DownloadStatus => {
  if (item.canceled) return 'failed';
  if (item.completed) return 'completed';
  if (item.paused) return 'paused';
  return 'downloading';
};

const getSource = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url || '';
  }
};

const getIconLabel = (fileName = '') => {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1 || dot === fileName.length - 1) return 'FILE';
  return fileName.slice(dot + 1, dot + 5).toUpperCase();
};

const getStatusLabel = (
  status: DownloadStatus,
  percent: number,
): string => {
  switch (status) {
    case 'completed':
      return '已完成';
    case 'paused':
      return '已暂停';
    case 'failed':
      return '已取消';
    default:
      return `下载中 ${percent}%`;
  }
};

export const DownloadItem = observer(({ item }: { item: IDownloadItem }) => {
  const status = getStatus(item);

  const percent =
    item.totalBytes > 0
      ? Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100))
      : 0;

  let received = prettyBytes(item.receivedBytes || 0);
  const total = prettyBytes(item.totalBytes || 0);
  const receivedSplit = received.split(' ');
  if (receivedSplit[1] === total.split(' ')[1]) {
    received = receivedSplit[0];
  }

  const host = getSource(item.url);

  let detail: string;
  if (status === 'completed') {
    detail = [host, total].filter(Boolean).join(' · ');
  } else if (status === 'failed') {
    detail = [host, '下载已取消'].filter(Boolean).join(' · ');
  } else {
    detail = [host, `${received} / ${total}`].filter(Boolean).join(' · ');
  }

  const showProgress = status === 'downloading' || status === 'paused';

  return (
    <StyledDownloadItem onClick={onClick(item)} onContextMenu={onContextMenu(item)}>
      <Body>
        <Icon>{getIconLabel(item.fileName)}</Icon>
        <Main>
          <TitleRow>
            <Title canceled={item.canceled}>{item.fileName}</Title>
            <MoreButton
              aria-label="更多操作"
              toggled={item.menuIsOpen}
              onClick={onMoreClick(item)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.3"
                strokeLinecap="round"
              >
                <path d="M12 5h.01" />
                <path d="M12 12h.01" />
                <path d="M12 19h.01" />
              </svg>
            </MoreButton>
          </TitleRow>
          <StatusRow>
            <StatusBadge status={status}>
              {getStatusLabel(status, percent)}
            </StatusBadge>
            <Detail>{detail}</Detail>
          </StatusRow>
          {showProgress && (
            <ProgressBackground>
              <Progress status={status} style={{ width: `${percent}%` }} />
            </ProgressBackground>
          )}
        </Main>
      </Body>
      <DownloadItemMenu item={item} visible={item.menuIsOpen} />
    </StyledDownloadItem>
  );
});

