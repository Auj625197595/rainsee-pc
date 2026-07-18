import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';

export const StyledToolbar = styled.div`
  position: relative;
  z-index: 100;
  display: flex;
  align-items: center;
  flex-flow: row;
  width: 100%;
  height: 54px;
  padding: 0 12px;
  -webkit-app-region: drag;

  ${({ theme }: { theme: ITheme }) => css`
    background-color: ${theme['toolbar.backgroundColor']};
    border-bottom: 1px solid ${theme['toolbar.bottomLine.backgroundColor']};
    color: ${theme['toolbar.lightForeground'] ? '#fff' : 'rgba(0, 0, 0, 0.8)'};
  `};
`;
