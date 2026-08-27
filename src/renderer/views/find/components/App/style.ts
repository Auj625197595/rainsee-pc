import styled, { css } from 'styled-components';

import { centerIcon } from '~/renderer/mixins';
import { ITheme } from '~/interfaces';
import { ICON_SEARCH } from '~/renderer/constants';

export const StyledApp = styled.div`
  margin: 16px;
  margin-top: 3px;
  border-radius: 26px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);

  ${({ theme }: { theme?: ITheme }) => css`
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

export const StyledFind = styled.div`
  border-radius: 30px;
  height: 40px;
  -webkit-app-region: no-drag;
  align-items: center;
  overflow: hidden;
  display: flex;
`;

export const SearchIcon = styled.div`
  min-width: 16px;
  height: 16px;
  ${centerIcon()};
  margin-left: 12px;
  opacity: 0.54;
  background-image: url(${ICON_SEARCH});

  ${({ theme }: { theme?: ITheme }) => css`
    filter: ${theme['dialog.lightForeground'] ? 'invert(100%)' : 'none'};
  `}
`;

export const Input = styled.input`
  width: 100%;
  height: 100%;
  font-size: 13px;
  margin-right: 8px;
  border: none;
  outline: none;
  background: transparent;
  margin-left: 8px;
  color: inherit;
`;

export const Button = styled.div`
  ${({
    size,
    icon,
    theme,
  }: {
    size: number;
    icon: string;
    theme?: ITheme;
  }) => css`
    ${centerIcon(size)};
    background-image: url(${icon});
    filter: ${theme['dialog.lightForeground'] ? 'invert(100%)' : 'none'};
  `}

  width: 24px;
  height: 24px;
  opacity: 0.54;
  position: relative;

  &:after {
    background-color: rgba(0, 0, 0, 0.08);
    content: '';
    position: absolute;
    border-radius: 50%;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    opacity: 0;
    transition: 0.2s opacity;
  }

  &:hover {
    &:after {
      opacity: 1;
    }
  }
`;

export const Buttons = styled.div`
  display: flex;
  margin-right: 8px;
`;

export const Occurrences = styled.div`
  opacity: 0.54;
  margin-right: 4px;
`;
