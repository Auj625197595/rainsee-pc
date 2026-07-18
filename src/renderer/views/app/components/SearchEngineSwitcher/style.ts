import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';

export const IconButton = styled.div`
  height: 28px;
  width: 28px;
  margin-left: 2px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: default;
  -webkit-app-region: no-drag;
  transition: background-color 0.15s ease;

  ${({ theme }: { theme: ITheme }) => css`
    &:hover {
      background-color: ${theme['toolbar.lightForeground']
        ? 'rgba(255, 255, 255, 0.12)'
        : 'rgba(52, 82, 255, 0.1)'};
    }
  `};
`;

export const EngineIcon = styled.div`
  height: 16px;
  width: 16px;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  flex-shrink: 0;

  ${({ theme, $monochrome }: { theme: ITheme; $monochrome?: boolean }) => css`
    filter: ${$monochrome && theme['toolbar.lightForeground']
      ? 'invert(100%)'
      : 'none'};
  `};
`;
