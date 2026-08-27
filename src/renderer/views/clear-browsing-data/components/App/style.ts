import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { PersistentDialogStyle } from '~/renderer/mixins/dialogs';

const foreground = (theme: ITheme) =>
  theme['dialog.lightForeground'] ? '#f4f6fb' : '#172033';
const muted = (theme: ITheme) =>
  theme['dialog.lightForeground'] ? 'rgba(244, 246, 251, 0.66)' : '#687089';

export const StyledApp = styled(PersistentDialogStyle)`
  height: 190px;
  color: ${({ theme }: { theme: ITheme }) => foreground(theme)};
  letter-spacing: 0;
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  height: 42px;
  padding: 0 10px 0 14px;
`;

export const Title = styled.div`
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
`;

export const IconButton = styled.button`
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  padding: 0;
  color: inherit;
  background: transparent;
  cursor: default;

  ${({ theme }: { theme: ITheme }) => css`
    &:hover {
      background: ${theme['dialog.lightForeground']
        ? 'rgba(255, 255, 255, 0.12)'
        : 'rgba(52, 82, 255, 0.1)'};
    }
  `}
`;

export const Status = styled.div<{ $success: boolean }>`
  min-height: 88px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px 16px;
`;

export const StatusIcon = styled.div<{ $success: boolean }>`
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 50%;

  ${({ theme, $success }: { theme: ITheme; $success: boolean }) => css`
    color: ${$success
      ? '#16845b'
      : theme['dialog.lightForeground']
      ? '#b9c5ff'
      : '#4058c7'};
    background: ${$success
      ? 'rgba(22, 132, 91, 0.12)'
      : theme['dialog.lightForeground']
      ? 'rgba(185, 197, 255, 0.12)'
      : 'rgba(64, 88, 199, 0.1)'};
  `}
`;

export const StatusText = styled.div`
  min-width: 0;
`;

export const StatusTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
`;

export const StatusDetail = styled.div`
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 18px;
  color: ${({ theme }: { theme: ITheme }) => muted(theme)};
`;

export const Footer = styled.div`
  height: 60px;
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-top: 1px solid
    ${({ theme }: { theme: ITheme }) =>
      theme['dialog.lightForeground']
        ? 'rgba(255, 255, 255, 0.1)'
        : 'rgba(72, 82, 110, 0.12)'};
`;

export const ClearAllButton = styled.button`
  width: 100%;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 7px;
  padding: 0 12px;
  color: #fff;
  background: #4058c7;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
  cursor: default;

  &:hover:not(:disabled) {
    background: #344bb5;
  }

  &:active:not(:disabled) {
    background: #2c409e;
  }

  &:disabled {
    opacity: 0.65;
  }
`;
