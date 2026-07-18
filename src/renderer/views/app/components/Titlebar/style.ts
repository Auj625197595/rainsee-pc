import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';
import { platform } from 'os';
import { ICON_FULLSCREEN_EXIT } from '~/renderer/constants/icons'
import { centerIcon } from '~/renderer/mixins';

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
    align-items: ${theme.isCompact ? 'center' : 'initial'};
    padding-left: ${platform() === 'darwin' && !isFullscreen ? 78 : 4}px;
    /* 跟随主题的前景色,供依赖 currentColor 的图标(紧凑模式下标题栏内的导航/集群按钮)继承;
       深色/无痕背景下用白色,否则保持近黑深灰。 */
    color: ${theme['toolbar.lightForeground'] ? '#fff' : 'rgba(0, 0, 0, 0.8)'};

    &:before {
      -webkit-app-region: ${isFullscreen ? 'no-drag' : 'drag'};
    }
  `};
`;

export const FullscreenExitButton = styled.div`
  top: 0;
  right: 0;
  height: 32px;
  min-width: 45px;
  -webkit-app-region: no-drag;
  marginLeft: 8;
  background-image: url(${ICON_FULLSCREEN_EXIT});
  transition: 0.1s background-color;
  ${centerIcon(24)};

  ${({ theme }: { theme?: ITheme }) => css`
    filter: ${theme['dialog.lightForeground']
      ? `invert(100%)`
      : `none`};
  `}

  &:hover {
    background-color: rgba(60, 60, 60, 0.4);
  }
`;

// Brand block shown at the very left of the title bar (design spec: logo +
// "雨见浏览器 / RainPC"). Hidden in compact mode where space is tight.
export const Brand = styled.div`
  position: relative;
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

// RainPC 副标题行
export const BrandSubRow = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
`;
