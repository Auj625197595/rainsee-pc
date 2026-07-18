import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';
import { centerIcon } from '~/renderer/mixins';

export const FILTER_BAR_HEIGHT = 40;

export const StyledFilterBar = styled.div`
  display: flex;
  align-items: center;
  height: ${FILTER_BAR_HEIGHT}px;
  padding: 0 8px 0 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-top: 1px solid
      ${theme['searchBox.lightForeground']
        ? 'rgba(255, 255, 255, 0.08)'
        : 'rgba(0, 0, 0, 0.08)'};
  `}
`;

export const Label = styled.div`
  font-size: 12px;
  margin-right: 8px;
  opacity: 0.54;
  white-space: nowrap;
`;

export const Chip = styled.div`
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0 12px;
  margin-right: 8px;
  border-radius: 13px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;

  ${({ active, theme }: { active?: boolean; theme?: ITheme }) => {
    const light = theme['searchBox.lightForeground'];
    if (active) {
      return css`
        background-color: ${light
          ? 'rgba(255, 255, 255, 0.16)'
          : 'rgba(0, 0, 0, 0.08)'};
        font-weight: 500;
      `;
    }
    return css`
      &:hover {
        background-color: ${light
          ? 'rgba(255, 255, 255, 0.08)'
          : 'rgba(0, 0, 0, 0.04)'};
      }
    `;
  }}
`;

export const Spacer = styled.div`
  flex: 1;
`;

export const SettingsButton = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  ${centerIcon(16)};

  ${({ theme }: { theme?: ITheme }) => css`
    filter: ${theme['searchBox.lightForeground'] ? 'invert(100%)' : 'none'};
    opacity: 0.7;
    &:hover {
      opacity: 1;
    }
  `}
`;
