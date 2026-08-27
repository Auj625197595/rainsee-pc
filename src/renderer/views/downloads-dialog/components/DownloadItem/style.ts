import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';

export type DownloadStatus =
  | 'downloading'
  | 'completed'
  | 'paused'
  | 'failed';

const STATUS_COLORS: Record<
  DownloadStatus,
  { badgeBg: string; badgeFg: string; ring: string; progress: string }
> = {
  downloading: {
    badgeBg: '#eef2ff',
    badgeFg: '#3452ff',
    ring: '#d7e4ff',
    progress: '#3452ff',
  },
  completed: {
    badgeBg: '#eaf9f3',
    badgeFg: '#28a37a',
    ring: '#d8eee4',
    progress: '#34c38f',
  },
  paused: {
    badgeBg: '#fff4de',
    badgeFg: '#d68a14',
    ring: '#f3e3c5',
    progress: '#f0b24d',
  },
  failed: {
    badgeBg: '#ffe8e8',
    badgeFg: '#d34f5b',
    ring: '#f2d5d9',
    progress: '#e06a78',
  },
};

export const StyledDownloadItem = styled.div`
  border-radius: 14px;
  background-color: rgba(255, 255, 255, 0.92);
  padding: 8px 10px;
  box-shadow: 0 4px 12px rgba(20, 32, 72, 0.04);
  cursor: default;
  position: relative;
  transition: 0.12s background-color;

  & + & {
    margin-top: 6px;
  }

  ${({ theme }: { theme?: ITheme }) =>
    theme.dark &&
    css`
      background-color: rgba(255, 255, 255, 0.06);
      box-shadow: none;
    `}
`;

export const Body = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

export const Icon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  font-size: 10px;
  font-weight: 900;
  background-color: #eef2ff;
  color: #3452ff;

  ${({ theme }: { theme?: ITheme }) =>
    theme.dark &&
    css`
      background-color: rgba(52, 82, 255, 0.18);
      color: #9db0ff;
    `}
`;

export const Main = styled.div`
  min-width: 0;
  flex: 1;
`;

export const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

export const TitleActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
`;

export const Title = styled.div`
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 800;
  ${({ canceled }: { canceled?: boolean }) =>
    canceled &&
    css`
      text-decoration: line-through;
    `}
`;

export const MoreButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: none;
  cursor: pointer;
  border-radius: 10px;
  background-color: #f2f7ff;
  color: #6f86b7;
  transition: 0.12s background-color;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover {
    background-color: #e7f0ff;
  }

  ${({ theme, toggled }: { theme?: ITheme; toggled?: boolean }) =>
    theme.dark
      ? css`
          background-color: rgba(255, 255, 255, 0.08);
          color: rgba(255, 255, 255, 0.7);
          &:hover {
            background-color: rgba(255, 255, 255, 0.14);
          }
        `
      : toggled &&
        css`
          background-color: #e7f0ff;
        `}
`;

export const PauseButton = styled(MoreButton)``;

export const StatusRow = styled.div`
  margin-top: 5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

export const StatusPrimary = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const StatusBadge = styled.span`
  flex-shrink: 0;
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 10px;
  font-weight: 900;
  white-space: nowrap;

  ${({ status }: { status: DownloadStatus }) => {
    const c = STATUS_COLORS[status];
    return css`
      background-color: ${c.badgeBg};
      color: ${c.badgeFg};
      box-shadow: inset 0 0 0 1px ${c.ring};
    `;
  }}
`;

export const Detail = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 650;
  opacity: 0.5;
`;

export const TransferInfo = styled(Detail)`
  font-variant-numeric: tabular-nums;
  opacity: 0.64;
`;

export const Speed = styled.span`
  flex-shrink: 0;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #3452ff;

  ${({ theme }: { theme?: ITheme }) =>
    theme.dark &&
    css`
      color: #9db0ff;
    `}
`;

export const ProgressBackground = styled.div`
  margin-top: 7px;
  height: 4px;
  border-radius: 999px;
  overflow: hidden;
  background-color: rgba(20, 32, 72, 0.08);

  ${({ theme }: { theme?: ITheme }) =>
    theme.dark &&
    css`
      background-color: rgba(255, 255, 255, 0.12);
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
