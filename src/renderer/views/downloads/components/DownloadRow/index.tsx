import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { IDownloadItem } from '~/interfaces';
import store from '../../store';
import {
  formatBytes,
  getProgress,
  getFileCategory,
  FileCategory,
} from '../../utils';
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

// 内部标签页无法直接 require('electron')，文件操作走 preload 暴露的 window.electron.shell。
const shell: typeof import('electron').shell = (window as any).electron?.shell;

// ===== 文件类型图标(内联 SVG，跟随 currentColor)=====

const FILE_ICONS: Record<FileCategory, JSX.Element> = {
  image: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
      <circle cx="8.5" cy="8.5" r="1.5"></circle>
      <path d="M21 15l-5-5L5 21"></path>
    </svg>
  ),
  video: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"></rect>
      <path d="M10 9l5 3-5 3z"></path>
    </svg>
  ),
  audio: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13"></path>
      <circle cx="6" cy="18" r="3"></circle>
      <circle cx="18" cy="16" r="3"></circle>
    </svg>
  ),
  archive: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8v13H3V8"></path>
      <path d="M1 3h22v5H1z"></path>
      <path d="M10 12h4"></path>
    </svg>
  ),
  doc: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <path d="M14 2v6h6"></path>
      <path d="M8 13h8"></path>
      <path d="M8 17h8"></path>
    </svg>
  ),
  app: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"></rect>
      <rect x="14" y="3" width="7" height="7" rx="1"></rect>
      <rect x="14" y="14" width="7" height="7" rx="1"></rect>
      <rect x="3" y="14" width="7" height="7" rx="1"></rect>
    </svg>
  ),
  file: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
      <path d="M13 2v7h7"></path>
    </svg>
  ),
};

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
  const status = store.statusOf(data);
  const completed = status === 'completed';
  const canceled = status === 'canceled';
  const active = status === 'active';

  const onRowClick = () => {
    if (completed) shell?.openPath(data.savePath);
  };

  const onPauseResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data.paused) store.resume(data);
    else store.pause(data);
  };

  const onCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    store.cancel(data);
  };

  const onShowInFolder = (e: React.MouseEvent) => {
    e.stopPropagation();
    shell?.showItemInFolder(data.savePath);
  };

  const onRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    store.remove(data);
  };

  const percent = getProgress(data.receivedBytes, data.totalBytes);

  return (
    <Row clickable={completed} onClick={onRowClick}>
      <IconBox danger={canceled}>
        {FILE_ICONS[getFileCategory(data.fileName)]}
      </IconBox>

      <RowText>
        <Title>{data.fileName}</Title>

        {active && (
          <>
            <SubLine>
              <SubText tone="accent">
                {formatBytes(data.receivedBytes)} / {formatBytes(data.totalBytes)}
              </SubText>
              {data.paused && (
                <>
                  <Dot />
                  <SubText>已暂停</SubText>
                </>
              )}
            </SubLine>
            <ProgressTrack>
              <ProgressFill
                animated={!data.paused}
                style={{ width: `${percent}%` }}
              />
            </ProgressTrack>
          </>
        )}

        {completed && (
          <SubLine>
            <SubText>{formatBytes(data.totalBytes)}</SubText>
            <Dot />
            <SubText title={data.savePath}>{data.savePath}</SubText>
          </SubLine>
        )}

        {canceled && (
          <SubLine>
            <SubText tone="danger">已取消</SubText>
          </SubLine>
        )}
      </RowText>

      <RowActions onClick={stop}>
        {active && (
          <>
            <ActionBtn
              onClick={onPauseResume}
              title={data.paused ? '恢复下载' : '暂停下载'}
            >
              {data.paused ? <IconResume /> : <IconPause />}
            </ActionBtn>
            <ActionBtn danger onClick={onCancel} title="取消下载">
              <IconClose />
            </ActionBtn>
          </>
        )}

        {completed && (
          <>
            <ActionBtn onClick={onShowInFolder} title="在文件夹中显示">
              <IconFolder />
            </ActionBtn>
            <ActionBtn danger onClick={onRemove} title="从列表中移除">
              <IconTrash />
            </ActionBtn>
          </>
        )}

        {canceled && (
          <ActionBtn danger onClick={onRemove} title="从列表中移除">
            <IconClose />
          </ActionBtn>
        )}
      </RowActions>
    </Row>
  );
});
