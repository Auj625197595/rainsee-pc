import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { DialogStyle } from '~/renderer/mixins/dialogs';

export const StyledApp = styled(DialogStyle)`
  padding: 6px;

  ${({ theme }: { theme?: ITheme; visible: boolean }) => css`
    color: ${theme['dialog.lightForeground'] ? '#fff' : '#161b2d'};
  `}
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 4px 0 10px;
  margin-bottom: 2px;
`;

export const HeaderTitle = styled.div`
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  opacity: 0.9;
`;

export const SettingsButton = styled.div`
  height: 24px;
  width: 24px;
  border-radius: 6px;
  background-size: 16px;
  background-repeat: no-repeat;
  background-position: center;
  cursor: default;
  flex-shrink: 0;

  ${({ theme }: { theme: ITheme }) => css`
    filter: ${theme['dialog.lightForeground'] ? 'invert(1)' : 'none'};
    opacity: 0.7;
    &:hover {
      opacity: 1;
      background-color: ${theme['dialog.lightForeground']
        ? 'rgba(255, 255, 255, 0.16)'
        : 'rgba(52, 82, 255, 0.14)'};
    }
  `};
`;

export const List = styled.div`
  width: 100%;
  max-height: 324px;
  overflow-y: auto;
`;

export const Item = styled.div<{ selected?: boolean }>`
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  cursor: default;
  font-size: 13px;
  white-space: nowrap;

  ${({ theme, selected }: { theme: ITheme; selected?: boolean }) => css`
    background-color: ${selected
      ? theme['dialog.lightForeground']
        ? 'rgba(255, 255, 255, 0.1)'
        : 'rgba(52, 82, 255, 0.1)'
      : 'transparent'};

    &:hover {
      background-color: ${theme['dialog.lightForeground']
        ? 'rgba(255, 255, 255, 0.16)'
        : 'rgba(52, 82, 255, 0.14)'};
    }
  `};
`;

export const ItemIcon = styled.div`
  height: 16px;
  width: 16px;
  margin-right: 10px;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  flex-shrink: 0;
`;

export const ItemLabel = styled.div`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const Check = styled.div`
  margin-left: 8px;
  font-size: 12px;
  opacity: 0.7;
`;

