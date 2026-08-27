import styled, {css} from 'styled-components';

import {ITheme} from '~/interfaces';
import {DialogStyle} from '~/renderer/mixins/dialogs';

export const StyledApp = styled(DialogStyle)`
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 26px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);

  ${({theme}: {theme?: ITheme; visible: boolean}) => css`
    box-shadow: ${theme.dark
      ? 'inset 0 1px 0 rgba(255, 255, 255, 0.04)'
      : `0 1px 4px rgba(20, 32, 72, 0.05),
         0 4px 12px rgba(20, 32, 72, 0.06),
         inset 0 1px 0 rgba(255, 255, 255, 0.7)`};
    background-color: ${theme.dark
      ? 'rgba(15, 18, 24, 0.88)'
      : 'rgba(255, 255, 255, 0.72)'};
    color: ${theme['dialog.textColor']};
  `}
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  min-height: 32px;
  padding: 0 2px;
  flex-shrink: 0;
`;

export const HeaderIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin-right: 9px;
  border-radius: 10px;
  color: #4772e8;
  background: rgba(71, 114, 232, 0.12);
`;

export const HeaderTitle = styled.div`
  flex: 1;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: 0;
`;

export const EngineSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex-shrink: 0;
`;

export const SectionLabel = styled.div`
  padding: 0 2px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
  opacity: 0.58;
`;

export const EngineSelect = styled.select`
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 1px solid rgba(120, 130, 150, 0.2);
  border-radius: 10px;
  outline: none;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  appearance: auto;

  ${({theme}: {theme: ITheme}) => css`
    color: ${theme['dialog.lightForeground'] ? '#fff' : '#161b2d'};
    background: ${theme['dialog.lightForeground']
      ? 'rgba(255, 255, 255, 0.1)'
      : 'rgba(240, 243, 249, 0.92)'};

    &:hover,
    &:focus {
      border-color: rgba(71, 114, 232, 0.55);
      box-shadow: 0 0 0 3px rgba(71, 114, 232, 0.12);
    }
  `}
`;

export const List = styled.div`
  width: 100%;
  flex: 1;
  min-height: 0;
  max-height: 236px;
  padding-right: 2px;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(100, 110, 130, 0.36);
  }
`;

export const Item = styled.div<{selected?: boolean}>`
  display: flex;
  align-items: center;
  height: 36px;
  margin-bottom: 2px;
  padding: 0 10px;
  border-radius: 10px;
  cursor: default;
  font-size: 14px;
  white-space: nowrap;
  transition: background-color 0.15s ease, transform 0.15s ease;

  ${({theme, selected}: {theme: ITheme; selected?: boolean}) => css`
    background-color: ${selected
      ? theme['dialog.lightForeground']
        ? 'rgba(104, 143, 236, 0.3)'
        : 'rgba(71, 114, 232, 0.14)'
      : 'transparent'};

    &:hover {
      background-color: ${theme['dialog.lightForeground']
        ? 'rgba(104, 143, 236, 0.22)'
        : 'rgba(71, 114, 232, 0.09)'};
      transform: translateX(1px);
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
  color: #4772e8;
  font-size: 16px;
  font-weight: 700;
`;

export const Footer = styled.div`
  display: flex;
  justify-content: center;
  padding: 9px 2px 0;
  border-top: 1px solid rgba(120, 130, 150, 0.16);
  flex-shrink: 0;
`;

export const RestoreButton = styled.button`
  width: 100%;
  height: 34px;
  padding: 0 14px;
  border: 1px solid rgba(120, 130, 150, 0.2);
  border-radius: 10px;
  font-size: 13px;
  cursor: pointer;
  outline: none;
  transition: background-color 0.15s ease, transform 0.15s ease;

  ${({theme}: {theme?: ITheme}) => css`
    color: ${theme['dialog.lightForeground'] ? '#fff' : '#161b2d'};
    background: ${theme['dialog.lightForeground']
      ? 'rgba(255,255,255,0.12)'
      : '#f0f2f7'};

    &:hover {
      background: ${theme['dialog.lightForeground']
        ? 'rgba(255,255,255,0.2)'
        : '#e7ebf3'};
    }

    &:active {
      transform: scale(0.98);
    }
  `}
`;
