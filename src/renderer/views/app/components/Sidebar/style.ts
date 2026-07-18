import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';

interface SidebarProps {
  side: 'left' | 'right';
  collapsed?: boolean;
  theme?: ITheme;
}

// 缩放模式收窄后的窄轨宽度:恰好容纳 favicon + 截取的两字标题。
export const SIDEBAR_RAIL_WIDTH = 62;

export const StyledSidebar = styled.div`
  position: relative;
  z-index: 100;
  display: flex;
  flex-flow: column;
  height: 100%;
  flex-shrink: 0;
  -webkit-app-region: drag;
  transition: width 0.16s ease;

  ${({ side, collapsed, theme }: SidebarProps) => css`
    width: ${collapsed ? SIDEBAR_RAIL_WIDTH : theme.sidebarWidth}px;
    background-color: ${theme['titlebar.backgroundColor']};
    border-${side === 'left' ? 'right' : 'left'}: 1px solid ${
      theme['toolbar.bottomLine.backgroundColor']
    };
  `};
`;

export const SidebarHeader = styled.div`
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 10px;
  flex-shrink: 0;
  gap: 4px;
`;

// 头部右侧的按钮组(布局切换 + 固定/缩放钉子)。窄轨态下隐藏,
// 悬停展开后随头部一起显现。
export const SidebarHeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;

  ${({ collapsed }: { collapsed?: boolean }) => css`
    display: ${collapsed ? 'none' : 'flex'};
  `};
`;

// 固定/缩放模式切换钉子。pinned=true 时高亮(固定模式)。
interface PinButtonProps {
  pinned?: boolean;
  theme?: ITheme;
}

export const SidebarPinButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  width: 32px;
  border-radius: 10px;
  flex-shrink: 0;
  cursor: default;
  -webkit-app-region: no-drag;
  transition: background-color 0.15s ease, color 0.15s ease,
    transform 0.15s ease;

  &:active {
    transform: scale(0.94);
  }

  ${({ pinned, theme }: PinButtonProps) => {
    const light = theme['toolbar.lightForeground'];
    const fg = light ? 'rgba(255, 255, 255, 0.82)' : 'rgba(22, 27, 45, 0.66)';
    const hoverBg = light
      ? 'rgba(255, 255, 255, 0.12)'
      : 'rgba(52, 82, 255, 0.1)';
    const accent = theme.accentColor || '#3452ff';
    return css`
      color: ${pinned ? (light ? '#ffffff' : accent) : fg};
      background-color: ${pinned ? hoverBg : 'transparent'};

      &:hover {
        color: ${light ? '#ffffff' : accent};
        background-color: ${hoverBg};
      }
    `;
  }};
`;

export const SidebarBrand = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
`;

export const SidebarBrandText = styled.div`
  font-size: 14px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ collapsed, theme }: { collapsed?: boolean; theme?: ITheme }) => css`
    display: ${collapsed ? 'none' : 'block'};
    color: ${theme['tab.selected.textColor']};
  `};
`;

export const SidebarNav = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px 8px;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
`;

// 列表背景是原生窗口拖拽区;标签项与分组头各自声明 no-drag,
// 因而只有未被列表项覆盖的空白区域会触发窗口移动。
export const SidebarTabList = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-app-region: drag;
  user-select: none;
  padding: 4px 0;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 99px;
    ${({ theme }: { theme?: ITheme }) => css`
      background-color: ${theme['toolbar.lightForeground']
        ? 'rgba(255, 255, 255, 0.18)'
        : 'rgba(0, 0, 0, 0.16)'};
    `};
  }
`;

export const SidebarFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 8px;
  flex-shrink: 0;
  -webkit-app-region: no-drag;

  ${({ theme }: { theme?: ITheme }) => css`
    border-top: 1px solid ${theme['toolbar.bottomLine.backgroundColor']};
  `};
`;

interface NewTabButtonProps {
  collapsed?: boolean;
}

export const SidebarNewTab = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  margin: 6px 12px 8px;
  border-radius: 18px;
  cursor: default;
  font-size: 12.5px;
  font-weight: 700;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
  transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;

  ${({ collapsed }: NewTabButtonProps) => css`
    color: #ffffff;
    padding: ${collapsed ? '0' : '0 18px'};
    justify-content: center;
    background: linear-gradient(135deg, #4a63ff 0%, #2f49e8 100%);
    box-shadow: 0 10px 22px rgba(47, 73, 232, 0.22),
      inset 0 1px 0 rgba(255, 255, 255, 0.18);

    &:hover {
      filter: brightness(1.04);
      box-shadow: 0 12px 24px rgba(47, 73, 232, 0.26),
        inset 0 1px 0 rgba(255, 255, 255, 0.2);
    }

    &:active {
      transform: scale(0.985);
      box-shadow: 0 8px 18px rgba(47, 73, 232, 0.2),
        inset 0 1px 0 rgba(255, 255, 255, 0.12);
    }

    ${collapsed &&
    css`
      width: 38px;
      height: 38px;
      margin: 6px auto 8px;
      padding: 0;
      border-radius: 12px;
      box-shadow: 0 8px 18px rgba(47, 73, 232, 0.2),
        inset 0 1px 0 rgba(255, 255, 255, 0.16);
    `}
  `};
`;

// 窄轨态下隐藏的文字标签(如「新建标签页」)。
export const SidebarNewTabLabel = styled.span`
  letter-spacing: 0.4px;

  ${({ collapsed }: { collapsed?: boolean }) => css`
    display: ${collapsed ? 'none' : 'inline'};
    font-size: 14px;
    font-weight: 800;
  `};
`;

// 侧栏分组折叠头:组色圆点 + 组名 + 展开箭头。点击切换折叠。
export const SidebarGroupHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  margin: 6px 6px 2px;
  padding: 0 10px;
  border-radius: 8px;
  cursor: default;
  font-size: 12px;
  font-weight: 700;
  -webkit-app-region: no-drag;
  transition: background-color 0.12s ease, box-shadow 0.12s ease;

  ${({
    theme,
    dropActive,
    collapsed,
  }: {
    theme?: ITheme;
    dropActive?: boolean;
    collapsed?: boolean;
  }) => css`
    color: ${theme['tab.textColor']};
    justify-content: ${collapsed ? 'center' : 'flex-start'};
    padding: ${collapsed ? '0' : '0 10px'};
    ${dropActive
      ? css`
          background-color: ${theme['toolbar.lightForeground']
            ? 'rgba(255, 255, 255, 0.12)'
            : 'rgba(52, 82, 255, 0.10)'};
          box-shadow: inset 0 0 0 1.5px ${theme.accentColor || '#3452ff'};
        `
      : css`
          &:hover {
            background-color: ${theme['toolbar.lightForeground']
              ? 'rgba(255, 255, 255, 0.07)'
              : 'rgba(0, 0, 0, 0.05)'};
          }
        `}
  `}
`;

export const SidebarGroupDot = styled.div`
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  cursor: pointer;
  transition: transform 0.1s ease, box-shadow 0.1s ease;

  &:hover {
    transform: scale(1.25);
    box-shadow: 0 0 0 3px rgba(120, 130, 160, 0.22);
  }
`;

// 组色圆点点击后弹出的预设色盘(绝对定位,浮在组头下方)。
export const SidebarSwatches = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 6px;
  z-index: 30;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 5px;
  padding: 8px;
  border-radius: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${theme['dialog.backgroundColor'] ||
    theme['titlebar.backgroundColor']};
    border: 1px solid ${theme['toolbar.bottomLine.backgroundColor']};
    box-shadow: 0 6px 22px rgba(20, 32, 72, 0.24);
  `};
`;

export const SidebarSwatch = styled.div`
  width: 16px;
  height: 16px;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.08s ease;

  &:hover {
    transform: scale(1.18);
  }
`;

export const SidebarGroupName = styled.div`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ collapsed }: { collapsed?: boolean }) => css`
    display: ${collapsed ? 'none' : 'block'};
  `};
`;

// 组名内联改名输入框(双击组名进入)。占满剩余宽度,无边框,聚焦淡底。
export const SidebarGroupNameInput = styled.input`
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 700;
  background: transparent;
  border: 0;
  outline: 0;
  padding: 2px 6px;
  border-radius: 7px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme['tab.selected.textColor']};
    background-color: ${theme['toolbar.lightForeground']
      ? 'rgba(255, 255, 255, 0.12)'
      : 'rgba(52, 82, 255, 0.10)'};
  `};
`;

export const SidebarGroupChevron = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  transition: transform 0.15s ease;

  ${({ collapsed, hidden }: { collapsed: boolean; hidden?: boolean }) => css`
    display: ${hidden ? 'none' : 'flex'};
    transform: ${collapsed ? 'rotate(-90deg)' : 'rotate(0deg)'};
  `}
`;
