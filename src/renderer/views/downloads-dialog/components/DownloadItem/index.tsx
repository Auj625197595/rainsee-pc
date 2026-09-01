import * as React from 'react';
import { observer } from 'mobx-react-lite';
import {
  StyledDownloadItem,
  Body,
  Icon,
  Main,
  TitleRow,
  Title,
  TitleActions,
  PauseButton,
  MoreButton,
  StatusRow,
  StatusPrimary,
  StatusBadge,
  Detail,
  TransferInfo,
  Speed,
  ProgressBackground,
  Progress,
  DownloadStatus,
} from './style';
import { IDownloadItem } from '~/interfaces';
import { normalizeDownloadSpeed } from '~/common/download-speed';
import prettyBytes = require('pretty-bytes');
import { shell } from 'electron';
import * as remote from '@electron/remote';
import store from '../../store';
import { DownloadItemMenu } from '../DownloadItemMenu';
import {
  getDownloadMenuTemplate,
  pauseDownload,
  resumeDownload,
} from '../download-menu';
import { useI18n } from '~/renderer/components/I18n';

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

const onPauseResume =
  (item: IDownloadItem) => (e: React.MouseEvent<HTMLButtonElement>) => {
    if (item.paused && !item.retrying) resumeDownload(item);
    else pauseDownload(item);
    e.stopPropagation();
  };

const getStatus = (item: IDownloadItem): DownloadStatus => {
  if (item.canceled) return 'failed';
  if (item.completed) return 'completed';
  if (item.paused || item.interrupted) return 'paused';
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
  item: IDownloadItem,
  status: DownloadStatus,
  percent: number,
  t: (key: string, params?: any) => string,
): string => {
  if (item.preparing && status === 'downloading') return t('dldStatusSniffing');
  switch (status) {
    case 'completed':
      return t('dldStatusCompleted');
    case 'paused':
      if (item.retrying) return t('dldStatusRecovering');
      if (item.interrupted) return t('dldStatusInterrupted');
      return t('dldStatusPaused');
    case 'failed':
      return t('dldStatusCanceled');
    default:
      return t('dldStatusDownloading', { percent });
  }
};

export const DownloadItem = observer(({ item }: { item: IDownloadItem }) => {
  const t = useI18n();
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

  let detail = '';
  if (status === 'completed') {
    detail = [host, total].filter(Boolean).join(' · ');
  } else if (status === 'failed') {
    detail = [host, t('dldCanceledNote')].filter(Boolean).join(' · ');
  }

  const showProgress = status === 'downloading' || status === 'paused';

  return (
    <StyledDownloadItem onClick={onClick(item)} onContextMenu={onContextMenu(item)}>
      <Body>
        <Icon>{getIconLabel(item.fileName)}</Icon>
        <Main>
          <TitleRow>
            <Title canceled={item.canceled}>{item.fileName}</Title>
            <TitleActions>
              {showProgress && (
                <PauseButton
                  aria-label={
                    item.paused && !item.retrying
                      ? t('dldResume')
                      : t('dldPause')
                  }
                  title={
                    item.paused && !item.retrying
                      ? t('dldResume')
                      : t('dldPause')
                  }
                  onClick={onPauseResume(item)}
                >
                  {item.paused && !item.retrying ? (
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M7 4l13 8-13 8z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="5" width="4" height="14" rx="1" />
                      <rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
                  )}
                </PauseButton>
              )}
              <MoreButton
                aria-label={t('dldMoreActionsAria')}
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
            </TitleActions>
          </TitleRow>
          <StatusRow>
            <StatusPrimary>
              <StatusBadge status={status}>
                {getStatusLabel(item, status, percent, t)}
              </StatusBadge>
              {showProgress ? (
                <TransferInfo>
                  {item.preparing
                    ? t('dldLookingForVideo')
                    : `${received} / ${total}`}
                </TransferInfo>
              ) : (
                <Detail>{detail}</Detail>
              )}
            </StatusPrimary>
            {status === 'downloading' && (
              <Speed>
                {prettyBytes(normalizeDownloadSpeed(item.speedBytesPerSecond))}/s
              </Speed>
            )}
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

