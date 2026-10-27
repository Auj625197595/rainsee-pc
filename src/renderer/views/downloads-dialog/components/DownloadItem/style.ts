import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';
import {
  FileCategory,
  FILE_TYPE_COLORS,
} from '~/renderer/components/FileTypeIcon';

export type DownloadStatus =
  | 'downloading'
  | 'completed'
  | 'paused'
  | 'failed';

const STATUS_COLORS: Record<
  DownloadStatus,
  { fg: string; darkFg: string; progress: string }
> = {
  downloading: { fg: '#3b6cff', darkFg: '#8fb0ff', progress: '#3b6cff' },
  completed: { fg: '#28a37a', darkFg: '#6fd6a8', progress: '#34c38f' },
  paused: { fg: '#d68a14', darkFg: '#f3c26a', progress: '#f0b24d' },
  failed: { fg: '#d34f5b', darkFg: '#ff9393', progress: '#e06a78' },
};

export const TitleActions = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  transition: 0.12s opacity;

  /* 已完成的条目只在悬停/聚焦时露出操作,保持列表安静;进行中的条目常驻暂停按钮。 */
  ${({ persistent }: { persistent?: boolean }) =>
    !persistent &&
    css`
      opacity: 0;
    `}
`;

export const StyledDownloadItem = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 6px 8px 10px;
  border-radius: 10px;
  position: relative;
  outline: none;
  transition: 0.12s background-color;

  ${({ clickable }: { theme?: ITheme; clickable?: boolean }) => css`
    cursor: ${clickable ? 'pointer' : 'default'};
  `}

  &:hover,
  &:focus-visible {
    background-color: rgba(15, 23, 42, 0.045);

    ${TitleActions} {
      opacity: 1;
    }
  }

  &:focus-visible {
    box-shadow: inset 0 0 0 2px rgba(79, 124, 255, 0.55);
  }

  &:focus-within ${TitleActions} {
    opacity: 1;
  }

  ${({ theme }: { theme?: ITheme; clickable?: boolean }) =>
    theme.dark &&
    css`
      &:hover,
      &:focus-visible {
        background-color: rgba(255, 255, 255, 0.06);
      }
    `}
`;

export const Icon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  overflow: hidden;

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* 应用自带图标保持原比例居中,不裁切。 */
  img.app-icon {
    width: 26px;
    height: 26px;
    object-fit: contain;
  }

  ${({
    theme,
    category,
    hasPreview,
    dimmed,
  }: {
    theme?: ITheme;
    category: FileCategory;
    hasPreview?: boolean;
    dimmed?: boolean;
  }) => {
    const c = FILE_TYPE_COLORS[category];
    return css`
      color: ${theme.dark ? c.darkFg : c.fg};
      background-color: ${hasPreview
        ? theme.dark
          ? 'rgba(255,255,255,0.06)'
          : '#f4f6fa'
        : theme.dark
          ? c.darkBg
          : c.bg};
      opacity: ${dimmed ? 0.55 : 1};
      ${hasPreview &&
      css`
        box-shadow: inset 0 0 0 1px
          ${theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)'};
      `}
    `;
  }}
`;

export const Main = styled.div`
  min-width: 0;
  flex: 1;
`;

export const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-height: 22px;
`;

export const Title = styled.div`
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  ${({ canceled }: { canceled?: boolean }) =>
    canceled &&
    css`
      text-decoration: line-through;
      opacity: 0.6;
    `}
`;

export const ActionButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  cursor: pointer;
  border-radius: 6px;
  background-color: transparent;
  color: inherit;
  opacity: 0.5;
  transition: 0.12s background-color, 0.12s color;

  svg {
    width: 13px;
    height: 13px;
  }

  &:hover {
    opacity: 1;
    background-color: rgba(15, 23, 42, 0.07);
  }

  &:focus-visible {
    outline: 2px solid #4f7cff;
    outline-offset: 0;
  }

  ${({ theme }: { theme?: ITheme }) =>
    theme.dark &&
    css`
      &:hover {
        background-color: rgba(255, 255, 255, 0.1);
      }
    `}
`;

export const StatusRow = styled.div`
  margin-top: 1px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

export const StatusPrimary = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
`;

export const StatusBadge = styled.span`
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;

  ${({ theme, status }: { theme?: ITheme; status: DownloadStatus }) => css`
    color: ${theme.dark
      ? STATUS_COLORS[status].darkFg
      : STATUS_COLORS[status].fg};
  `}
`;

export const Detail = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 400;
  line-height: 17px;
  opacity: 0.5;
`;

export const TransferInfo = styled(Detail)`
  font-variant-numeric: tabular-nums;
  opacity: 0.6;
`;

export const Speed = styled.span`
  flex-shrink: 0;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: #3b6cff;

  ${({ theme }: { theme?: ITheme }) =>
    theme.dark &&
    css`
      color: #8fb0ff;
    `}
`;

export const ProgressBackground = styled.div`
  margin-top: 6px;
  height: 3px;
  border-radius: 999px;
  overflow: hidden;
  background-color: rgba(15, 23, 42, 0.07);

  ${({ theme }: { theme?: ITheme }) =>
    theme.dark &&
    css`
      background-color: rgba(255, 255, 255, 0.1);
    `}
`;

export const Progress = styled.div`
  height: 100%;
  border-radius: 999px;
  transition: 0.2s width;

  ${({ status }: { status: DownloadStatus }) => css`
    background-color: ${STATUS_COLORS[status].progress};
  `}
`;
