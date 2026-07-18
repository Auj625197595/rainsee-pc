import styled, { css } from 'styled-components';

import { ToolbarButton } from '../ToolbarButton';
import {
  ADD_TAB_BUTTON_WIDTH,
  ADD_TAB_BUTTON_HEIGHT,
} from '~/constants/design';
import { ITheme } from '~/interfaces';

export const StyledTabbar = styled.div`
  height: 100%;
  flex: 1;
  min-width: 0;
  position: relative;
  overflow: hidden;
  align-items: center;
  display: flex;
  margin-left: 0px;
`;

export const TabsContainer = styled.div`
  height: 100%;
  flex: 1;
  min-width: 0;
  position: relative;
  overflow: hidden;
  overflow-x: overlay;
  white-space: nowrap;
  /* 为最右侧浮动的「+ 新建标签」按钮预留尾部空间,
     避免滚动到末尾时最后一个标签被按钮压住、出现重叠。 */
  padding-right: ${ADD_TAB_BUTTON_WIDTH + 6}px;

  &::-webkit-scrollbar {
    height: 0px;
    display: none;
    background-color: transparent;
    opacity: 0;
  }
`;

// 网页链接拖入标签栏时的投放指示线:绝对定位在 TabsContainer 内容坐标系内
// (与 tab.left 同坐标系,用 transform 平移),随容器滚动跟随标签一起移动。
export const LinkDropIndicator = styled.div`
  position: absolute;
  top: 6px;
  bottom: 6px;
  width: 2px;
  left: 0;
  border-radius: 2px;
  z-index: 5;
  pointer-events: none;
  background: ${({theme}: {theme: ITheme}) =>
    theme.accentColor || '#1a73e8'};
  box-shadow: 0 0 4px
    ${({theme}: {theme: ITheme}) => theme.accentColor || '#1a73e8'};
  will-change: transform;
`;

export const TabbarEnd = styled.div`
  display: flex;
  align-items: center;
  height: 100%;
  flex-shrink: 0;
  padding-left: 6px;
  padding-right: 4px;
  gap: 4px;
  -webkit-app-region: no-drag;
`;

export const AddTab = styled(ToolbarButton)`
  position: absolute;
  left: 0;
  flex-shrink: 0;
  min-width: ${ADD_TAB_BUTTON_WIDTH}px;
  height: ${ADD_TAB_BUTTON_HEIGHT}px;
  border-radius: 99999px;

  ${({ theme }: { theme: ITheme }) => css`
    top: ${theme.isCompact ? 'auto' : theme.tabMarginTop + 2}px;
  `};
`;
