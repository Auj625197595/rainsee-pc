import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';

export const Line = styled.div<{ $visible?: boolean }>`
  flex-shrink: 0;
  width: 100%;
  position: relative;
  z-index: 30;
  pointer-events: ${({ $visible }) => ($visible ? 'auto' : 'none')};
  height: ${({ $visible }) => ($visible ? 3 : 0)}px;
  background: transparent;
`;

// 头部拖拽区域:包裹 Titlebar + Toolbar,覆盖整个头部
export const HeaderWrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  z-index: 10;
  position: relative;
  pointer-events: auto;
`;

// 标题栏、工具栏与书签栏共用的定位上下文。文件拖入顶部时，悬浮层需要
// 覆盖这组区域的完整实测高度，而不是只覆盖 HeaderWrapper。
export const TopChrome = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  flex-shrink: 0;
  pointer-events: auto;
`;

export const HeaderStack = styled.div<{ $visible?: boolean }>`
  display: ${({ $visible }) => ($visible ? 'flex' : 'none')};
  flex-direction: column;
  width: 100%;
  flex-shrink: 0;
  position: relative;
  z-index: 40;
`;

export const StyledApp = styled.div`
  display: flex;
  flex-flow: column;
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${theme?.['titlebar.backgroundColor'] || '#fff'};
  `};
`;

// 侧栏模式顶部全宽拖拽条:侧边栏头部与内容区工具栏原本都紧贴窗口上边缘,
// 这里留出一小段呼吸间距,并把这段间距作为窗口拖拽区(-webkit-app-region:
// drag),弥补侧栏模式下内容区顶部缺少拖拽区的不足(侧栏自身虽已是 drag,
// 但缩放窄轨态可拖拽宽度很小)。SidebarShell 因此改为纵向布局:顶部 drag 条
// + 下方的 SidebarBody(sidebar | content)。
export const SIDEBAR_TOP_DRAG_HEIGHT = 8;

// Wrapper used for the left/right sidebar layouts. It fills the whole window
// and lays the sidebar next to the content column.
export const SidebarShell = styled.div`
  display: flex;
  flex-flow: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${theme['titlebar.backgroundColor']};
  `};
`;

// 顶部全宽拖拽条:把侧边栏头部与内容区工具栏一起下移 SIDEBAR_TOP_DRAG_HEIGHT,
// 与窗口上边缘留出呼吸间距。这里必须使用 Electron 原生 drag region:贴着无边框
// 窗口顶边的 DOM mousedown 会被 Windows 缩放命中区截获,无法可靠启动手动拖动。
export const SidebarTopDrag = styled.div`
  width: 100%;
  height: ${SIDEBAR_TOP_DRAG_HEIGHT}px;
  flex-shrink: 0;
  -webkit-app-region: drag;
  user-select: none;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${theme['titlebar.backgroundColor']};
  `};
`;

// 侧栏与内容列的横向容器,占去除顶部 drag 条外的全部高度。
export const SidebarBody = styled.div`
  display: flex;
  flex-flow: row;
  flex: 1;
  min-height: 0;
  width: 100%;
`;

export const ContentColumn = styled.div`
  display: flex;
  flex-flow: column;
  flex: 1;
  min-width: 0;
  height: 100%;
`;

// Transparent placeholder marking the rectangle that the native BrowserView
// should occupy. The main process measures #view-anchor to position the view.
export const ViewAnchor = styled.div`
  flex: 1;
  min-height: 0;
  width: 100%;
  -webkit-app-region: no-drag;
`;
