import styled, { keyframes, css } from 'styled-components';

import { ITheme } from '~/interfaces';

// 从左/右滑出的关键帧:起点在自身宽度外(-100%/100%),终点归位。
// 用带轻微回弹的 cubic-bezier(见 StyledApp)营造阻尼质感,不在关键帧里做位移过冲,
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

// 浮层外壳:填满整个 BrowserView,底色/分割线与固定模式侧边栏一致。入场时从同侧
// 滑出,cubic-bezier 带回弹尾段做出阻尼质感。不加投影——滑入过程中投影会扫过
// 尚未归位的空白区,视觉上像先闪一道黑影再出现侧边栏。
export const StyledApp = styled.div`
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
