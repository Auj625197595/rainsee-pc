import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';

export const ControlsContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 6px 0 2px;
  position: relative;
  z-index: 2;
  -webkit-app-region: no-drag;
`;

interface ControlButtonProps {
  close?: boolean;
  theme?: ITheme;
}

export const ControlButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 0;
  /* 按钮本体占满整个标题栏高度,使点击命中区域向上延伸到窗口最顶部——
     用户习惯把鼠标甩到屏幕右上角触发关闭,指针即便略高于药丸也能命中。
     可见的 32px 悬停药丸改由 ::after 绘制并居中,与全高命中区解耦。 */
  height: 100%;
  width: 32px;
  cursor: default;
  transition: color 0.16s ease;

  > svg {
    transition: transform 0.16s ease;
  }

  /* 32px 圆角药丸:垂直居中、垫在图标之后(z-index:-1)。按钮建立
     z-index:0 栈上下文,使负 z-index 仅相对按钮自身生效。 */
  &::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 32px;
    border-radius: 11px;
    transform: translateY(-50%);
    z-index: -1;
    transition: background-color 0.16s ease, box-shadow 0.16s ease;
  }

  &:active > svg {
    transform: scale(0.94);
  }

  &:active::after {
    transform: translateY(-50%) scale(0.94);
  }

  ${({ close, theme }: ControlButtonProps) => {
    const light = theme['toolbar.lightForeground'];
    const fg = light
      ? 'rgba(255, 255, 255, 0.82)'
      : 'rgba(117, 128, 154, 0.95)';
    const hoverBg = light
      ? 'rgba(255, 255, 255, 0.12)'
      : 'rgba(255, 255, 255, 0.9)';
    const hoverFg = light ? '#ffffff' : '#161b2d';

    return css`
      color: ${fg};

      ${close &&
      css`
        /* 把右上角命中区直接锚定到视口,不再按按钮位置补固定宽度。
           侧栏工具栏在控件外还有 12px padding,沉浸头部 BrowserView 在高 DPI
           屏幕上也可能出现小数像素取整；position:fixed + right:0 可确保任意
           宽度和缩放比例下，窗口最右上角始终归关闭按钮所有。 */
        &::before {
          content: '';
          position: fixed;
          top: 0;
          right: 0;
          width: 32px;
          height: 54px;
          -webkit-app-region: no-drag;
        }
      `}

      &:hover {
        color: ${close ? '#ffffff' : hoverFg};

        &::after {
          background-color: ${close ? '#FF6C7A' : hoverBg};
          box-shadow: ${close
            ? '0 6px 16px rgba(255, 108, 122, 0.35)'
            : light
            ? 'none'
            : '0 4px 14px rgba(20, 32, 72, 0.08)'};
        }
      }
    `;
  }};
`;
