import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { IDownloadItem } from '~/interfaces';
import store from '../../store';
import {
  formatBytes,
  formatSpeed,
  getProgress,
  getFileCategory,
} from '../../utils';
import { FileTypeIcon } from '~/renderer/components/FileTypeIcon';
import {
  Row,
  IconBox,
  RowText,
  Title,
  SubLine,
  SubText,
  Dot,
  ProgressTrack,
  ProgressFill,
  RowActions,
  ActionBtn,
} from './style';
import { useI18n } from '~/renderer/components/I18n';

// ===== 操作图标 =====

const IconPause = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <rect x="6" y="5" width="4" height="14" rx="1"></rect>
    <rect x="14" y="5" width="4" height="14" rx="1"></rect>
  </svg>
);

const IconResume = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M7 4l13 8-13 8z"></path>
  </svg>
);

const IconFolder = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
  </svg>
);

const IconClose = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M18 6L6 18M6 6l12 12"></path>
  </svg>
);

const IconTrash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18"></path>
    <path d="M8 6V4h8v2"></path>
    <path d="M19 6l-1 14H6L5 6"></path>
  </svg>
);

const stop = (e: React.MouseEvent) => e.stopPropagation();

export const DownloadRow = observer(({ data }: { data: IDownloadItem }) => {
  const t = useI18n();
  const status = store.statusOf(data);
  const completed = status === 'completed';
  const canceled = status === 'canceled';
  const failed = status === 'failed';
  const active = status === 'active';
  // 已完成但文件已被删除/移走(主进程子线程校验)。
  const missing = completed && !!data.fileMissing;

  const onRowClick = () => {
    if (completed && !missing) void store.open(data).catch(() => undefined);
  };

  const onPauseResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data.failed || (data.paused && !data.retrying)) store.resume(data);
    else store.pause(data);
  };

  const onCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    store.cancel(data);
  };

  const onShowInFolder = (e: React.MouseEvent) => {
    e.stopPropagation();
    void store.showInFolder(data).catch(() => undefined);
  };

  const onRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    store.remove(data);
  };

  const percent = getProgress(data.receivedBytes, data.totalBytes);

  // 失败归因文案(与下载面板共用 dldFail* 文案)。
  const failText =
    data.failReason === 'file-locked'
      ? t('dldFailFileLocked')
      : data.failReason === 'dir-unwritable'
        ? t('dldFailDirUnwritable')
        : t('dldFailUnknown');

  return (
    <Row clickable={completed && !missing} onClick={onRowClick}>
      <IconBox danger={canceled || failed || missing}>
        <FileTypeIcon category={getFileCategory(data.fileName)} />
      </IconBox>

      <RowText>
        <Title missing={missing}>{data.fileName}</Title>

        {active && (
          <>
            <SubLine>
              <SubText tone="accent">
                {data.preparing
                  ? t('dlvSniffing')
                  : `${formatBytes(data.receivedBytes)} / ${formatBytes(data.totalBytes)}`}
              </SubText>
              {!data.preparing && !data.paused && !data.interrupted && (
                <>
                  <Dot />
                  <SubText>{formatSpeed(data.speedBytesPerSecond)}</SubText>
                </>
              )}
              {(data.paused || data.interrupted) && (
                <>
                  <Dot />
                  <SubText>
                    {data.retrying
                      ? t('dlvRecovering')
                      : data.interrupted
                        ? t('dlvInterrupted')
                        : t('dlvPaused')}
                  </SubText>
                </>
              )}
            </SubLine>
            <ProgressTrack>
              <ProgressFill
                animated={!data.paused && !data.interrupted}
                style={{ width: `${data.preparing ? 100 : percent}%` }}
              />
            </ProgressTrack>
          </>
        )}

        {missing && (
          <SubLine>
            <SubText tone="danger">{t('dlvFileMissing')}</SubText>
            <Dot />
            <SubText title={data.savePath}>{data.savePath}</SubText>
          </SubLine>
        )}

        {completed && !missing && (
          <SubLine>
            <SubText>{formatBytes(data.totalBytes)}</SubText>
            <Dot />
            <SubText title={data.savePath}>{data.savePath}</SubText>
          </SubLine>
        )}

        {canceled && (
          <SubLine>
            <SubText tone="danger">{t('dlvCanceled')}</SubText>
          </SubLine>
        )}

        {failed && (
          <SubLine>
            <SubText tone="danger" title={failText}>
              {failText}
            </SubText>
          </SubLine>
        )}
      </RowText>

      <RowActions onClick={stop}>
        {active && (
          <>
            <ActionBtn
              onClick={onPauseResume}
              title={
                data.paused && !data.retrying
                  ? t('dlvResumeTitle')
                  : t('dlvPauseTitle')
              }
            >
              {data.paused && !data.retrying ? <IconResume /> : <IconPause />}
            </ActionBtn>
            <ActionBtn danger onClick={onCancel} title={t('dlvCancelTitle')}>
              <IconClose />
            </ActionBtn>
          </>
        )}

        {completed && (
          <>
            {!missing && (
              <ActionBtn onClick={onShowInFolder} title={t('dlvShowInFolder')}>
                <IconFolder />
              </ActionBtn>
            )}
            <ActionBtn danger onClick={onRemove} title={t('dlvRemoveTitle')}>
              <IconTrash />
            </ActionBtn>
          </>
        )}

        {failed && (
          <>
            <ActionBtn onClick={onPauseResume} title={t('dlvResumeTitle')}>
              <IconResume />
            </ActionBtn>
            <ActionBtn danger onClick={onRemove} title={t('dlvRemoveTitle')}>
              <IconTrash />
            </ActionBtn>
          </>
        )}

        {canceled && (
          <ActionBtn danger onClick={onRemove} title={t('dlvRemoveTitle')}>
            <IconClose />
          </ActionBtn>
        )}
      </RowActions>
    </Row>
  );
});
