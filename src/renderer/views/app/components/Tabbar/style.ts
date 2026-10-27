import styled, { css } from 'styled-components';

import { ToolbarButton } from '../ToolbarButton';
import {
  ADD_TAB_BUTTON_WIDTH,
  ADD_TAB_BUTTON_HEIGHT,
} from '~/constants/design';
import { ITheme } from '~/interfaces';
import { tabsBlockTop, topHitExtension } from '../Tab/style';

export const StyledTabbar = styled.div<{ $fullRows?: boolean }>`
  height: 100%;
  flex: 1;
  min-width: 0;
  position: relative;
  /* 独立成栏时标签容器向两侧外扩到整条标题栏,不能被本层裁掉 */
  overflow: ${({ $fullRows }) => ($fullRows ? 'visible' : 'hidden')};
  /* 工具箱等尾部按钮(单行高度)与第 0 行标签对齐;TabsContainer 为 100% 高不受影响 */
  align-items: flex-start;
  display: flex;
  margin-left: 0px;
`;

// $inset:多行「独立成栏」模式下容器向左外扩品牌块宽度、向右外扩工具箱+窗口控制宽度,
// 使第 1 行起占满整条标题栏;第 0 行由 TabsStore.getRowLeft/getRowWidth 留在两者之间。
export const TabsContainer = styled.div<{
  $allowScroll: boolean;
  $inset?: { left: number; right: number };
}>`
  height: 100%;
  flex: 1;
  min-width: 0;
  position: relative;
  margin-left: ${({ $inset }) => -($inset?.left || 0)}px;
  margin-right: ${({ $inset }) => -($inset?.right || 0)}px;
  overflow: hidden;
  overflow-x: ${({$allowScroll}) => ($allowScroll ? 'overlay' : 'hidden')};
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

export const TabScrollExtent = styled.div<{ $width: number }>`
  position: absolute;
  left: 0;
  top: 0;
  width: ${({ $width }) => `${$width}px`};
  height: 1px;
  pointer-events: none;
`;

// 网页链接拖入标签栏时的投放指示线:绝对定位在 TabsContainer 内容坐标系内
// (与 tab.left 同坐标系,用 transform 平移),随容器滚动跟随标签一起移动。
export const LinkDropIndicator = styled.div`
  position: absolute;
  top: ${({ theme }: { theme: ITheme }) => tabsBlockTop(theme)};
  height: ${({ theme }: { theme: ITheme }) => theme.tabSurfaceHeight}px;
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
  /* 叠在外扩的标签容器之上 */
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  height: ${({ theme }: { theme: ITheme }) => theme.titlebarBaseHeight}px;
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
    top: calc(
      ${tabsBlockTop(theme)} +
        ${(theme.tabSurfaceHeight - ADD_TAB_BUTTON_HEIGHT) / 2}px
    );
  `};
  ${({ theme }: { theme: ITheme }) =>
    topHitExtension(
      theme,
      Math.max(0, (theme.tabSurfaceHeight - ADD_TAB_BUTTON_HEIGHT) / 2),
    )};
`;
