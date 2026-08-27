import styled, { keyframes, css } from 'styled-components';

import { ITheme } from '~/interfaces';

// 从左/右滑出的关键帧:起点在自身宽度外(-100%/100%),终点归位。
// 用带轻微回弹的 cubic-bezier(见 SidebarPanelContent)营造阻尼质感,不在关键帧里做位移过冲,
// 避免露出 BrowserView 边界外的空白。
const slideFromLeft = keyframes`
  from { transform: translateX(-100%); opacity: 0.2; }
  to   { transform: translateX(0);      opacity: 1; }
`;

const slideFromRight = keyframes`
  from { transform: translateX(100%);  opacity: 0.2; }
  to   { transform: translateX(0);      opacity: 1; }
`;

interface AppProps {
  side?: 'left' | 'right';
  theme?: ITheme;
}

// 浮层外壳:填满整个 BrowserView,作为稳定的鼠标接管层。动画放在内部内容上,
// 避免根节点滑出时鼠标事件丢失,导致宿主侧的关闭计时器误触发。
export const StyledApp = styled.div`
  position: absolute;
  inset: 0;
  overflow: hidden;
  background-color: transparent;
`;

export const SidebarPanelContent = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-flow: column;
  overflow: hidden;
  will-change: transform, opacity;
  animation: ${({ side }: AppProps) =>
      side === 'right' ? slideFromRight : slideFromLeft}
    0.34s cubic-bezier(0.16, 1.02, 0.3, 1) both;

  ${({ theme }: AppProps) => css`
    background-color: ${theme['titlebar.backgroundColor']};
  `};
`;
