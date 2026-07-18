import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';

interface ButtonProps {
  variant?: 'tab' | 'bar';
  theme?: ITheme;
}

export const SwitcherButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: default;
  -webkit-app-region: no-drag;
  transition: background-color 0.15s ease, color 0.15s ease,
    transform 0.15s ease;

  &:active {
    transform: scale(0.94);
  }

  ${({ variant, theme }: ButtonProps) => {
    const light = theme['toolbar.lightForeground'];
    const fg = light ? 'rgba(255, 255, 255, 0.82)' : 'rgba(22, 27, 45, 0.66)';
    const hoverBg = light
      ? 'rgba(255, 255, 255, 0.12)'
      : 'rgba(52, 82, 255, 0.1)';
    const hoverFg = light ? '#ffffff' : '#3452ff';

    if (variant === 'tab') {
      return css`
        height: 30px;
        width: 30px;
        margin: 0 2px;
        border-radius: 10px;
        color: ${fg};
        background-color: ${light
          ? 'rgba(255, 255, 255, 0.06)'
          : 'rgba(255, 255, 255, 0.7)'};
        border: 1px solid
          ${light ? 'rgba(255, 255, 255, 0.12)' : 'rgba(221, 229, 244, 0.9)'};

        &:hover {
          color: ${hoverFg};
          background-color: ${hoverBg};
        }
      `;
    }

    return css`
      height: 32px;
      width: 32px;
      border-radius: 10px;
      color: ${fg};
      background-color: transparent;

      &:hover {
        color: ${hoverFg};
        background-color: ${hoverBg};
      }
    `;
  }};
`;
