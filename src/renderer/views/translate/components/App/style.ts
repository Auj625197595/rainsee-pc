import styled, {css} from 'styled-components';

import {ITheme} from '~/interfaces';
import {DialogStyle} from '~/renderer/mixins/dialogs';

export const StyledApp = styled(DialogStyle)`
  padding: 6px;
  display: flex;
  flex-direction: column;

  ${({theme}: {theme?: ITheme; visible: boolean}) => css`
    color: ${theme['dialog.lightForeground'] ? '#fff' : '#161b2d'};
  `}
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 10px;
  margin-bottom: 2px;
  flex-shrink: 0;
`;

export const HeaderTitle = styled.div`
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  opacity: 0.9;
`;

export const List = styled.div`
  width: 100%;
  flex: 1;
  max-height: 224px;
  overflow-y: auto;
`;

export const Item = styled.div<{selected?: boolean}>`
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  cursor: default;
  font-size: 13px;
  white-space: nowrap;

  ${({theme, selected}: {theme: ITheme; selected?: boolean}) => css`
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
  `}
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

export const Footer = styled.div`
  display: flex;
  justify-content: center;
  padding: 6px 10px 2px;
  flex-shrink: 0;
`;

export const RestoreButton = styled.button`
  height: 28px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 13px;
  cursor: default;
  border: none;
  outline: none;

  ${({theme}: {theme?: ITheme}) => css`
    color: ${theme['dialog.lightForeground'] ? '#fff' : '#161b2d'};
    background: ${theme['dialog.lightForeground']
      ? 'rgba(255,255,255,0.12)'
      : '#f0f2f7'};
  `}
`;
