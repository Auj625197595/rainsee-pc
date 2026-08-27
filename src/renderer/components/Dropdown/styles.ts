import styled, { css } from 'styled-components';

import {
  EASING_FUNCTION,
  transparency,
  ICON_DROPDOWN,
} from '~/renderer/constants';
import { centerIcon } from '~/renderer/mixins';
import { ITheme } from '~/interfaces';
import { ContextMenu } from '../ContextMenu';

export const DropdownMenu = styled(ContextMenu)`
  box-sizing: border-box;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 3px;
    background-color: rgba(127, 127, 127, 0.35);
  }
`;

export const StyledDropdown = styled.div`
  height: 32px;
  position: relative;
  user-select: none;
  cursor: pointer;
  display: flex;
  align-items: center;

  ${({ theme }: { theme: ITheme }) =>
    (theme as any).settingsPage
      ? css`
          height: 34px;
          min-width: 76px;
          border: 1px solid
            ${theme['pages.lightForeground']
              ? 'rgba(255, 255, 255, 0.08)'
              : '#F0F1F6'};
          border-radius: 10px;
          background-color: ${theme['pages.lightForeground']
            ? 'rgba(255, 255, 255, 0.07)'
            : '#F4F5FA'};

          &:hover {
            color: ${(theme as any).settingsAccent};
            background-color: ${(theme as any).settingsAccentSoft};
          }
        `
      : css`
          min-width: 200px;
          border-radius: 4px;
          background-color: ${theme['control.backgroundColor']};

          &:hover {
            background-color: ${theme['control.hover.backgroundColor']};
          }
        `}
`;

export const Label = styled.div`
  font-size: 13px;
  pointer-events: none;

  ${({ theme }: { theme: ITheme }) => css`
    margin-left: ${(theme as any).settingsPage ? 12 : 8}px;
    font-weight: ${(theme as any).settingsPage ? 500 : 400};
    white-space: nowrap;
    color: ${(theme as any).settingsPage
      ? theme['pages.textColor']
      : theme['control.valueColor']};
  `}
`;

export const DropIcon = styled.div`
  width: 24px;
  height: 24px;
  margin-left: auto;
  margin-right: 2px;
  opacity: ${transparency.icons.inactive};
  background-image: url(${ICON_DROPDOWN});
  transition: 0.2s ${EASING_FUNCTION} transform;
  ${centerIcon(24)};

  ${({ expanded, theme }: { expanded: boolean; theme?: ITheme }) => css`
    transform: ${expanded ? 'rotate(180deg)' : 'rotate(0deg)'};
    filter: ${theme['control.lightIcon'] ? 'invert(100%)' : 'unset'};
  `}
`;
