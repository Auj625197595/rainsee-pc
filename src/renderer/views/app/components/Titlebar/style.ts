import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';
import { platform } from 'os';

// margin-top: ${isHTMLFullscreen ? -TOOLBAR_HEIGHT : 0}px;

export const StyledTitlebar = styled.div`
  position: relative;
  z-index: 100;
  display: flex;
  flex-flow: row;
  width: 100%;

  &:before {
    position: absolute;
    z-index: 0;
    top: 4px;
    left: 4px;
    right: 4px;
    bottom: 0px;
    content: '';
  }

  ${({
  isHTMLFullscreen,
  isFullscreen,
  theme,
}: {
  isHTMLFullscreen: boolean;
  isFullscreen: boolean;
  theme: ITheme;
}) => css`
    background-color: ${theme['titlebar.backgroundColor']};
    height: ${theme.titlebarHeight}px;
    /* 子元素顶部对齐:品牌/按钮/窗口控制均为单行高度(titlebarBaseHeight),
       多行标签时与第 0 行标签同一水平中线,下方行视为额外的标签栏 */
    align-items: flex-start;
    padding-left: ${platform() === 'darwin' && !isFullscreen ? 78 : 4}px;
    /* 跟随主题的前景色,供依赖 currentColor 的图标(紧凑模式下标题栏内的导航/集群按钮)继承;
       深色/无痕背景下用白色,否则保持近黑深灰。 */
    color: ${theme['toolbar.lightForeground'] ? '#fff' : 'rgba(0, 0, 0, 0.8)'};

    > [data-rainsee-part='brand'],
    > [data-rainsee-part='navigation-buttons'],
    > [data-rainsee-part='right-buttons'],
    > [data-rainsee-part='window-controls'] {
      height: ${theme.titlebarBaseHeight}px;
      flex-shrink: 0;
    }

    &:before {
      -webkit-app-region: ${isFullscreen ? 'no-drag' : 'drag'};
    }
  `};
`;

// Brand block shown at the very left of the title bar (design spec: logo +
// "雨见浏览器 / RainPC"). Hidden in compact mode where space is tight.
export const Brand = styled.div`
  position: relative;
  /* 叠在多行独立成栏时外扩到左侧的标签容器之上 */
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 100%;
  padding: 0 12px 0 4px;
  flex-shrink: 0;
  -webkit-app-region: drag;
`;

export const BrandLogo = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  width: 32px;
  border-radius: 11px;
  background-color: #ffffff;
  box-shadow: 0 6px 18px rgba(20, 32, 72, 0.1);

  ${({ theme }: { theme?: ITheme }) => css`
    ${theme['toolbar.lightForeground'] &&
    css`
      background-color: rgba(255, 255, 255, 0.08);
      box-shadow: none;
    `}
  `}
`;

export const BrandText = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 180px;
  line-height: 1.1;
`;

// 文本区的悬停包裹层:相对定位锚点 + no-drag,
// 使 mouseenter/leave 能在标题栏拖拽区内正常触发,并承载弹窗定位。
export const BrandHover = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 100%;
  -webkit-app-region: no-drag;
`;

export const BrandTitle = styled.div`
  font-size: 14px;
  font-weight: 800;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme['toolbar.lightForeground'] ? '#ffffff' : '#161b2d'};
  `}
`;

export const BrandSub = styled.div`
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #a8b2c7;
`;

// RainPC 与在线绿点同一行
export const BrandSubRow = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
`;

// 互联状态点:已开启在线=绿、已开启离线=琥珀(互联未开启时不渲染)
export const OnlineDot = styled.div`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;

  ${({ online }: { online: boolean }) => css`
    background-color: ${online ? '#2ecc71' : '#f5a623'};
    box-shadow: 0 0 0 2px
      ${online ? 'rgba(46, 204, 113, 0.25)' : 'rgba(245, 166, 35, 0.25)'};
  `}
`;

export const WorkspaceDot = styled.div<{ color: string }>`
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${({ color }) => color};
  box-shadow: 0 0 0 2px ${({ color }) => `${color}33`};
`;
