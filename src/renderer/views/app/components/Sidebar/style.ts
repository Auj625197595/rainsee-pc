import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { SIDEBAR_RAIL_WIDTH } from '~/constants/design';

export { SIDEBAR_RAIL_WIDTH };

interface SidebarProps {
  side: 'left' | 'right';
  collapsed?: boolean;
  $phoneTabsOpen?: boolean;
  theme?: ITheme;
}

export const StyledSidebar = styled.div`
  position: relative;
  z-index: 100;
  display: flex;
  flex-flow: column;
  height: 100%;
  flex-shrink: 0;
  -webkit-app-region: ${({ $phoneTabsOpen }: SidebarProps) =>
    $phoneTabsOpen ? 'no-drag' : 'drag'};
  transition: width 0.16s ease;

  html.sidebar-resizing & {
    transition: none;
  }

  ${({ $phoneTabsOpen }: SidebarProps) =>
    $phoneTabsOpen &&
    css`
      &,
      & * {
        -webkit-app-region: no-drag !important;
      }
    `}

  ${({ side, collapsed, theme }: SidebarProps) => css`
    width: ${
      collapsed
        ? `${SIDEBAR_RAIL_WIDTH}px`
        : `var(--sidebar-width, ${theme.sidebarWidth}px)`
    };
    background-color: ${
      theme['sidebar.backgroundColor'] || theme['titlebar.backgroundColor']
    };
    border-${side === 'left' ? 'right' : 'left'}: 1px solid ${
    theme['toolbar.bottomLine.backgroundColor']
  };
  `};
`;

export const SidebarHeader = styled.div<{ $macLeft?: boolean }>`
  display: flex;
  align-items: center;
  height: ${({ $macLeft }) => ($macLeft ? 40 : 48)}px;
  padding: ${({ $macLeft }) => ($macLeft ? '0 10px 0 78px' : '0 10px')};
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

export const SidebarBrand = styled.div<{
  collapsed?: boolean;
  $macLeft?: boolean;
}>`
  display: flex;
  align-items: center;
  justify-content: ${({ collapsed }) => (collapsed ? 'center' : 'flex-start')};
  gap: 8px;
  flex: 1;
  min-width: 0;
  -webkit-app-region: no-drag;
  transform: translateY(${({ $macLeft }) => ($macLeft ? -2 : 0)}px);
`;

export const SidebarBrandText = styled.div<{
  collapsed?: boolean;
  $macLeft?: boolean;
}>`
  font-size: 14px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({
    collapsed,
    $macLeft,
    theme,
  }: {
    collapsed?: boolean;
    $macLeft?: boolean;
    theme?: ITheme;
  }) => css`
    display: ${collapsed || $macLeft ? 'none' : 'block'};
    color: ${theme['tab.selected.textColor']};
  `};
`;

export const SidebarWorkspaceDot = styled.span<{ color: string }>`
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: ${({ color }) => color};
`;

export const SidebarHoverArea = styled.div`
  display: flex;
  flex-flow: column;
  flex: 1;
  min-height: 0;
  -webkit-app-region: no-drag;
`;

export const SidebarNav = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px 8px;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
`;

// Logo 下方整块区域都需要响应缩略侧栏悬停。Electron 的 drag 区会吞掉
// mouseenter，因此列表空白处也必须保持 no-drag。
export const SidebarTabList = styled.div<{ $dropOutside?: boolean }>`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-flow: column;
  overflow-x: hidden;
  -webkit-app-region: no-drag;
  user-select: none;
  padding: 0;
  transition: box-shadow 0.1s ease;
  box-shadow: ${({ $dropOutside, theme }) =>
    $dropOutside
      ? `inset 0 0 0 2px ${theme.accentColor || '#3452ff'}`
      : 'none'};

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

export const SidebarTabScroll = styled.div<{ $pinned?: boolean }>`
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-app-region: no-drag;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  transition: scrollbar-color 0.15s ease;

  &:hover,
  &:focus-within {
    scrollbar-color: rgba(90, 105, 150, 0.35) transparent;
  }

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 99px;
    background-color: transparent;
  }

  &:hover::-webkit-scrollbar-thumb,
  &:focus-within::-webkit-scrollbar-thumb {
    background-color: rgba(90, 105, 150, 0.35);
  }
`;

export const SidebarPinnedSection = styled.section<{
  $height: number;
  $collapsed?: boolean;
  $resizing?: boolean;
}>`
  display: flex;
  flex-flow: column;
  flex: 0 0 ${({ $height }) => `${$height}px`};
  min-height: 0;
  overflow: hidden;
  transition: ${({ $resizing }) =>
    $resizing ? 'none' : 'flex-basis 0.18s ease'};
  will-change: flex-basis;
`;

export const SidebarRegularSection = styled.section`
  display: flex;
  flex: 1 1 auto;
  flex-flow: column;
  min-height: 0;
`;

export const SidebarPinnedHeader = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  flex: 0 0 30px;
  margin: 0 8px;
  padding: 0 10px;
  color: ${({ theme }) => theme['tab.textColor']};
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.3px;
  opacity: 0.72;
  user-select: none;
  -webkit-app-region: no-drag;
  cursor: pointer;
  border-radius: 8px;
  transition: background-color 0.12s ease, opacity 0.12s ease;

  &:hover {
    background: ${({ theme }) =>
      theme['toolbar.lightForeground']
        ? 'rgba(255, 255, 255, 0.07)'
        : 'rgba(52, 82, 255, 0.07)'};
    opacity: 0.95;
  }

  ${({ $collapsed }) =>
    $collapsed &&
    css`
      justify-content: center;
      padding: 0;
      gap: 0;
    `}
`;

export const SidebarPinnedHeaderIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: ${({ theme }) => theme.accentColor || '#3452ff'};
`;

export const SidebarPinnedCount = styled.span`
  margin-left: auto;
  min-width: 18px;
  padding: 2px 5px;
  border-radius: 6px;
  text-align: center;
  font-size: 10px;
  line-height: 1;
  background: ${({ theme }) =>
    theme['toolbar.lightForeground']
      ? 'rgba(255, 255, 255, 0.09)'
      : 'rgba(52, 82, 255, 0.08)'};
`;

export const SidebarSectionDivider = styled.div<{
  $dragging?: boolean;
  $interactive?: boolean;
}>`
  position: relative;
  flex: 0 0 7px;
  height: 7px;
  cursor: ${({ $interactive }) => ($interactive === false ? 'default' : 'row-resize')};
  -webkit-app-region: no-drag;

  &::before {
    content: '';
    position: absolute;
    top: 3px;
    left: 10px;
    right: 10px;
    height: 1px;
    background: ${({ theme }) => theme['toolbar.bottomLine.backgroundColor']};
    opacity: ${({ $dragging }) => ($dragging ? 1 : 0.85)};
    transition: background-color 0.15s ease, opacity 0.15s ease;
  }

  &:hover::before,
  &:focus-visible::before {
    height: 2px;
    top: 2px;
    background: ${({ theme }) => theme.accentColor || '#3452ff'};
    opacity: 0.9;
  }

  &:focus-visible {
    outline: none;
  }
`;

function groupTint(hex: string | undefined, alpha: number): string {
  const value = (hex || '').replace('#', '');
  if (value.length !== 6) return 'transparent';
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface SidebarGroupSectionProps {
  $groupColor?: string;
  $groupCollapsed?: boolean;
  $railCollapsed?: boolean;
  $groupPinned?: boolean;
  theme?: ITheme;
}

// 分组使用连续容器承载标题与成员，让组边界不再依赖每个标签行的底色表达。
export const SidebarGroupSection = styled.div`
  position: relative;
  margin: 8px 6px 12px;
  padding: 3px 4px 5px;
  border: 1px solid transparent;
  border-radius: 8px;
  -webkit-app-region: no-drag;

  &::before {
    content: '';
    position: absolute;
    left: -1px;
    top: 9px;
    bottom: 9px;
    width: 3px;
    border-radius: 0 3px 3px 0;
  }

  ${({
    $groupColor,
    $groupCollapsed,
    $railCollapsed,
    $groupPinned,
    theme,
  }: SidebarGroupSectionProps) => css`
    padding-bottom: ${$groupCollapsed ? '3px' : '5px'};
    background-color: ${theme['toolbar.lightForeground']
      ? 'rgba(255, 255, 255, 0.035)'
      : 'rgba(255, 255, 255, 0.58)'};
    border-color: ${$groupPinned
      ? groupTint($groupColor, 0.42)
      : theme['toolbar.lightForeground']
      ? 'rgba(255, 255, 255, 0.06)'
      : 'rgba(60, 82, 184, 0.08)'};
    box-shadow: ${theme['toolbar.lightForeground']
      ? 'none'
      : '0 1px 3px rgba(34, 48, 96, 0.04)'};

    &::before {
      width: ${$groupPinned ? '4px' : '3px'};
      background-color: ${$groupColor || theme.accentColor || '#3452ff'};
      box-shadow: ${$groupPinned
        ? `0 0 0 3px ${groupTint($groupColor, 0.16)}, 0 0 7px ${groupTint(
            $groupColor,
            0.42,
          )}`
        : `0 0 0 2px ${groupTint($groupColor, 0.08)}`};
    }

    ${$railCollapsed &&
    css`
      margin: 5px 4px 7px;
      padding: 2px 0;
      background-color: transparent;
      border-color: transparent;
      box-shadow: none;

      &::before {
        display: none;
      }
    `}
  `}
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

// 新建标签页:与标签行同尺寸/同对齐的轻量行(图标列与 favicon 对齐),
// 强调色只用于图标与文字,避免大面积渐变色块压过标签列表。
export const SidebarNewTab = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  margin: 2px 8px 6px;
  padding: 0 10px;
  border-radius: 8px;
  cursor: default;
  font-size: 12.5px;
  font-weight: 600;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
  transition: background-color 0.12s ease, transform 0.12s ease;

  svg {
    flex-shrink: 0;
  }

  &:active {
    transform: scale(0.985);
  }

  ${({ collapsed, theme }: NewTabButtonProps & { theme?: ITheme }) => {
    const light = theme['toolbar.lightForeground'];
    const accent = theme.accentColor || '#3452ff';
    return css`
      color: ${light ? 'rgba(255, 255, 255, 0.92)' : accent};
      justify-content: ${collapsed ? 'center' : 'flex-start'};
      background-color: ${light
        ? 'rgba(255, 255, 255, 0.06)'
        : 'rgba(52, 82, 255, 0.07)'};

      &:hover {
        background-color: ${light
          ? 'rgba(255, 255, 255, 0.11)'
          : 'rgba(52, 82, 255, 0.12)'};
      }

      ${collapsed &&
      css`
        width: 40px;
        height: 40px;
        margin: 2px auto 6px;
        padding: 0;
        border-radius: 10px;
      `}
    `;
  }};
`;

// 窄轨态下隐藏的文字标签(如「新建标签页」)。
export const SidebarNewTabLabel = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ collapsed }: { collapsed?: boolean }) => css`
    display: ${collapsed ? 'none' : 'inline'};
  `};
`;

// 侧栏分组折叠头:组色圆点 + 组名 + 展开箭头。点击切换折叠。
export const SidebarGroupHeader = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  margin: 0 1px 2px;
  padding: 0 7px;
  border-radius: 6px;
  cursor: default;
  font-size: 12.5px;
  font-weight: 700;
  -webkit-app-region: no-drag;
  transition: background-color 0.12s ease, box-shadow 0.12s ease;

  ${({
    theme,
    dropActive,
    collapsed,
    $dragging,
    pinned,
    $color,
  }: {
    theme?: ITheme;
    dropActive?: boolean;
    collapsed?: boolean;
    $dragging?: boolean;
    pinned?: boolean;
    $color?: string;
  }) => css`
    color: ${theme['tab.textColor']};
    justify-content: ${collapsed ? 'center' : 'flex-start'};
    padding: ${collapsed ? '0' : '0 7px'};
    cursor: ${$dragging ? 'grabbing' : 'grab'};
    opacity: ${$dragging ? 0.45 : 1};
    ${dropActive
      ? css`
          background-color: ${theme['toolbar.lightForeground']
            ? 'rgba(255, 255, 255, 0.12)'
            : 'rgba(52, 82, 255, 0.10)'};
          box-shadow: inset 0 0 0 1.5px ${theme.accentColor || '#3452ff'};
        `
      : pinned
      ? // 固定分组:组头常驻组色淡填充,呼应顶部栏芯片的实心组色语义;hover 加深。
        css`
          background-color: ${groupTint($color, 0.15)};
          &:hover {
            background-color: ${groupTint($color, 0.25)};
          }
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
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.72);
  flex-shrink: 0;
  cursor: pointer;
  transition: transform 0.1s ease, box-shadow 0.1s ease;

  &:hover {
    transform: scale(1.18);
    box-shadow: 0 0 0 3px rgba(120, 130, 160, 0.18);
  }

  // 固定分组:圆点加白色内描边,呈「锁定实心」感;窄轨态下这是唯一的固定标识。
  ${({ pinned, collapsed }: { pinned?: boolean; collapsed?: boolean }) => css`
    width: ${collapsed ? '22px' : '10px'};
    height: ${collapsed ? '22px' : '10px'};
    border-radius: ${collapsed ? '6px' : '3px'};
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.38);
    box-shadow: ${pinned
      ? 'inset 0 0 0 1.5px rgba(255, 255, 255, 0.9)'
      : 'none'};
  `}
`;

// 固定分组钉子徽章:组头右侧的显式「已固定」标识,与侧边栏单个标签的 favicon
// 角标钉子语义一致。强调色 + 白描边保证在组色淡底上清晰可见。
export const SidebarGroupPinBadge = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-left: 2px;
  flex-shrink: 0;
  pointer-events: none;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.accentColor || '#3452ff'};
  `}
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

export const SidebarGroupCount = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 5px;
  border-radius: 6px;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1;
  flex-shrink: 0;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme['tab.textColor']};
    background-color: ${theme['toolbar.lightForeground']
      ? 'rgba(255, 255, 255, 0.08)'
      : 'rgba(41, 55, 105, 0.07)'};
  `}
`;

export const SidebarGroupAddButton = styled.button`
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease, background-color 0.12s ease,
    transform 0.12s ease;

  ${SidebarGroupHeader}:hover &,
  ${SidebarGroupHeader}:focus-within & {
    opacity: 1;
    pointer-events: auto;
  }

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme['tab.textColor']};

    &:hover {
      background-color: ${theme['toolbar.lightForeground']
        ? 'rgba(255, 255, 255, 0.10)'
        : 'rgba(41, 55, 105, 0.08)'};
    }
  `}

  &:active {
    transform: scale(0.92);
  }
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
  width: 22px;
  height: 22px;
  border-radius: 6px;
  flex-shrink: 0;
  opacity: 0;
  pointer-events: none;
  transition: transform 0.15s ease, background-color 0.12s ease,
    opacity 0.12s ease;

  ${SidebarGroupHeader}:hover &,
  ${SidebarGroupHeader}:focus-within & {
    opacity: 1;
    pointer-events: auto;
  }

  &:hover {
    ${({ theme }: { theme?: ITheme }) => css`
      background-color: ${theme['toolbar.lightForeground']
        ? 'rgba(255, 255, 255, 0.08)'
        : 'rgba(41, 55, 105, 0.07)'};
    `}
  }

  ${({ collapsed, hidden }: { collapsed: boolean; hidden?: boolean }) => css`
    display: ${hidden ? 'none' : 'flex'};
    transform: ${collapsed ? 'rotate(-90deg)' : 'rotate(0deg)'};
  `}
`;
