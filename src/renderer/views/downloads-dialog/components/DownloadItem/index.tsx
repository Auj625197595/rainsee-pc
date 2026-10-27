import * as React from 'react';
import { observer } from 'mobx-react-lite';
import {
  StyledDownloadItem,
  Icon,
  Main,
  TitleRow,
  Title,
  TitleActions,
  ActionButton,
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
import * as remote from '@electron/remote';
import {
  FileTypeIcon,
  getFileCategory,
} from '~/renderer/components/FileTypeIcon';
import {
  getDownloadMenuTemplate,
  openItem,
  pauseDownload,
  resumeDownload,
  showInFolder,
} from '../download-menu';
import { getPreviewKind, useFilePreview } from './preview';
import { MiddleEllipsisText } from './MiddleEllipsisText';
import { useI18n } from '~/renderer/components/I18n';

type Translate = (key: string, params?: any) => string;

// 「⋯」按钮与右键共用同一份原生菜单:原生菜单不受 BrowserView 边界裁切,
// 弹窗无需为下拉菜单预留高度。
// 不传坐标:BrowserView 内的坐标与宿主窗口坐标系不同,按光标位置弹出最稳妥。
const popupMenu = (item: IDownloadItem) => {
  const menu = remote.Menu.buildFromTemplate(getDownloadMenuTemplate(item));
  menu.popup();
};

const getStatus = (item: IDownloadItem): DownloadStatus => {
  if (item.canceled || item.failed) return 'failed';
  if (item.completed) return 'completed';
  if (item.paused || item.interrupted) return 'paused';
  return 'downloading';
};

// 失败归因文案(重试耗尽时由主进程探测得出)。
const getFailDetail = (item: IDownloadItem, t: Translate): string => {
  if (item.failReason === 'file-locked') return t('dldFailFileLocked');
  if (item.failReason === 'dir-unwritable') return t('dldFailDirUnwritable');
  return t('dldFailUnknown');
};

const getSource = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url || '';
  }
};

const getStatusLabel = (
  item: IDownloadItem,
  status: DownloadStatus,
  percent: number,
  t: Translate,
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
      return item.canceled ? t('dldStatusCanceled') : t('dldStatusFailed');
    default:
      return t('dldStatusDownloading', { percent });
  }
};

const ICON_RESUME = (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M7 4l13 8-13 8z" />
  </svg>
);

const ICON_PAUSE = (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

const ICON_FOLDER = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const ICON_MORE = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.6"
    strokeLinecap="round"
  >
    <path d="M5 12h.01" />
    <path d="M12 12h.01" />
    <path d="M19 12h.01" />
  </svg>
);

export const DownloadItem = observer(({ item }: { item: IDownloadItem }) => {
  const t = useI18n();
  const status = getStatus(item);
  const category = getFileCategory(item.fileName);
  const previewKind = getPreviewKind(item.fileName, category);
  const preview = useFilePreview(item, item.fileMissing ? undefined : previewKind);
  const [previewBroken, setPreviewBroken] = React.useState(false);
  React.useEffect(() => setPreviewBroken(false), [preview]);

  const percent =
    item.totalBytes > 0
      ? Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100))
      : 0;

  let received = prettyBytes(item.receivedBytes || 0);
  const total = item.totalBytes > 0 ? prettyBytes(item.totalBytes) : '';
  const receivedSplit = received.split(' ');
  if (total && receivedSplit[1] === total.split(' ')[1]) {
    received = receivedSplit[0];
  }

  const host = getSource(item.url);
  // 已完成但文件已被删除/移走:不可打开,文件夹按钮隐藏,标题划线淡化。
  const missing = status === 'completed' && !!item.fileMissing;

  let detail = '';
  if (missing) {
    detail = t('dldFileMissingNote');
  } else if (status === 'completed') {
    detail = [total, host].filter(Boolean).join(' · ');
  } else if (status === 'failed') {
    detail = item.canceled ? t('dldCanceledNote') : getFailDetail(item, t);
  }

  const showProgress = status === 'downloading' || status === 'paused';
  // 失败终态仍给一个重试(恢复)按钮,与暂停态共用位置。
  const showRetry = status === 'failed' && !item.canceled;
  const resumeIcon = showRetry || (item.paused && !item.retrying);
  const pauseLabel = resumeIcon
    ? item.failed
      ? t('dldRetry')
      : t('dldResume')
    : t('dldPause');

  const onOpen = () => {
    if (!missing) openItem(item);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') {
      onOpen();
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      popupMenu(item);
    }
  };

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    popupMenu(item);
  };

  const onMoreClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    popupMenu(item);
  };

  const onPauseResume = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (resumeIcon) resumeDownload(item);
    else pauseDownload(item);
  };

  const onShowInFolder = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    showInFolder(item);
  };

  const showThumb = !!preview && !previewBroken;

  return (
    <StyledDownloadItem
      clickable={status === 'completed' && !missing}
      tabIndex={0}
      title={item.fileName}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
    >
      <Icon
        category={category}
        hasPreview={showThumb}
        dimmed={status === 'failed' || missing}
      >
        {showThumb ? (
          <img
            className={previewKind === 'icon' ? 'app-icon' : undefined}
            src={preview}
            alt=""
            draggable={false}
            onError={() => setPreviewBroken(true)}
          />
        ) : (
          <FileTypeIcon category={category} size={17} />
        )}
      </Icon>
      <Main>
        <TitleRow>
          <Title canceled={item.canceled || missing}>
            <MiddleEllipsisText text={item.fileName} />
          </Title>
          <TitleActions persistent={showProgress || showRetry}>
            {(showProgress || showRetry) && (
              <ActionButton
                type="button"
                aria-label={pauseLabel}
                title={pauseLabel}
                onClick={onPauseResume}
              >
                {resumeIcon ? ICON_RESUME : ICON_PAUSE}
              </ActionButton>
            )}
            {status === 'completed' && !missing && (
              <ActionButton
                type="button"
                aria-label={t('dldShowInFolder')}
                title={t('dldShowInFolder')}
                onClick={onShowInFolder}
              >
                {ICON_FOLDER}
              </ActionButton>
            )}
            <ActionButton
              type="button"
              aria-label={t('dldMoreActionsAria')}
              title={t('dldMoreActionsAria')}
              aria-haspopup="menu"
              onClick={onMoreClick}
            >
              {ICON_MORE}
            </ActionButton>
          </TitleActions>
        </TitleRow>
        <StatusRow>
          <StatusPrimary>
            {status !== 'completed' && (
              <StatusBadge status={status}>
                {getStatusLabel(item, status, percent, t)}
              </StatusBadge>
            )}
            {missing && (
              <StatusBadge status="failed">{t('dldStatusFileMissing')}</StatusBadge>
            )}
            {showProgress ? (
              <TransferInfo>
                {item.preparing
                  ? t('dldLookingForVideo')
                  : total
                    ? `${received} / ${total}`
                    : received}
              </TransferInfo>
            ) : (
              <Detail>{detail}</Detail>
            )}
          </StatusPrimary>
          {status === 'downloading' && !item.preparing && (
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
    </StyledDownloadItem>
  );
});
