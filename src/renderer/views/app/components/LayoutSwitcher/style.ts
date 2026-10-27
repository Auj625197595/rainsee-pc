import styled, { css, keyframes } from 'styled-components';

import { ITheme } from '~/interfaces';

interface ButtonProps {
  variant?: 'tab' | 'bar';
  $restore?: boolean;
  theme?: ITheme;
}

// 「恢复刚关闭」态:主色光晕一呼一吸,图标轻微缩放;尊重系统减弱动画偏好。
const restoreBreath = keyframes`
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(52, 82, 255, 0.34);
  }
  50% {
    box-shadow: 0 0 0 5px rgba(52, 82, 255, 0);
  }
`;

const restoreIconIn = keyframes`
  from {
    opacity: 0;
    transform: rotate(90deg) scale(0.6);
  }
  to {
    opacity: 1;
    transform: rotate(0) scale(1);
  }
`;

export const SwitcherIcon = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;

  &[data-restore='true'] {
    animation: ${restoreIconIn} 0.32s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  }
`;

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

  ${({ $restore, theme }: ButtonProps) => {
    if (!$restore) return '';
    const light = theme['toolbar.lightForeground'];
    return css`
      && {
        color: ${light ? '#ffffff' : '#3452ff'};
        background-color: ${light
          ? 'rgba(104, 143, 255, 0.32)'
          : 'rgba(52, 82, 255, 0.14)'};
        border-color: ${light
          ? 'rgba(160, 185, 255, 0.55)'
          : 'rgba(52, 82, 255, 0.42)'};
        animation: ${restoreBreath} 1.5s ease-in-out infinite;
      }
      &&:hover {
        color: #ffffff;
        background-color: #3452ff;
        border-color: #3452ff;
        animation-play-state: paused;
      }
      @media (prefers-reduced-motion: reduce) {
        && {
          animation: none;
        }
      }
    `;
  }};

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
