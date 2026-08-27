import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { centerIcon } from '~/renderer/mixins';
import { ICON_CLOSE } from '~/renderer/constants';

interface SidebarTabProps {
  selected: boolean;
  groupColor?: string;
  dragging?: boolean;
  collapsed?: boolean;
  theme?: ITheme;
}

// hex 组色 → rgba(用于组内标签的淡 tint 背景)。
function tint(hex: string, alpha: number): string {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return 'transparent';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const StyledSidebarTab = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  height: 38px;
  margin: 2px 6px;
  padding: 0 8px;
  border-radius: 7px;
  cursor: default;
  overflow: hidden;
  -webkit-app-region: no-drag;
  transition: background-color 0.15s ease;

  ${({
    selected,
    groupColor,
    dragging,
    collapsed,
    theme,
  }: SidebarTabProps) => css`
    // 分组容器已经表达归属，成员行只保留轻微缩进与交互态颜色。
    margin-left: ${collapsed ? '6px' : groupColor ? '9px' : '6px'};
    margin-right: ${groupColor && !collapsed ? '3px' : '6px'};
    padding: ${collapsed ? '0' : '0 8px'};
    justify-content: ${collapsed ? 'center' : 'flex-start'};
    opacity: ${dragging ? 0.4 : 1};
    background-color: ${selected
      ? theme['sidebar.tab.selectedBackgroundColor'] ||
        (theme['toolbar.lightForeground']
          ? 'rgba(255, 255, 255, 0.14)'
          : '#ffffff')
      : groupColor
      ? tint(groupColor, 0.025)
      : theme['sidebar.tab.inactiveBackgroundColor'] ||
        theme['sidebar.tab.backgroundColor'] ||
        'transparent'};
    box-shadow: ${selected
      ? theme['toolbar.lightForeground']
        ? '0 4px 12px rgba(26, 115, 232, 0.38), 0 1px 3px rgba(0, 0, 0, 0.26)'
        : '0 4px 12px rgba(26, 115, 232, 0.28), 0 1px 3px rgba(26, 115, 232, 0.2)'
      : 'none'};
    border: ${selected
      ? theme['toolbar.lightForeground']
        ? '1px solid rgba(102, 161, 255, 0.92)'
        : '1px solid rgba(26, 115, 232, 0.92)'
      : '1px solid transparent'};

    &:hover {
      background-color: ${selected
        ? theme['sidebar.tab.selectedBackgroundColor'] ||
          (theme['toolbar.lightForeground']
            ? 'rgba(255, 255, 255, 0.16)'
            : '#ffffff')
        : groupColor
        ? tint(groupColor, 0.12)
        : theme['toolbar.lightForeground']
        ? 'rgba(255, 255, 255, 0.07)'
        : 'rgba(0, 0, 0, 0.05)'};
    }
  `};
`;

export const SidebarTabIcon = styled.div`
  position: relative;
  height: 18px;
  min-width: 18px;
  border-radius: 6px;
  ${centerIcon(16)};
`;

// 固定标签角标:favicon 右上角叠一个小钉子图标,明确标识「已固定」。
// 锚定在 SidebarTabIcon 上(非整行),跟随 favicon;drop-shadow 描边保证任意
// favicon 配色下都清晰可见。
export const SidebarTabPinBadge = styled.div`
  position: absolute;
  top: -4px;
  right: -5px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.accentColor || '#3452ff'};
  `};
`;

interface SidebarTitleProps {
  selected: boolean;
  theme?: ITheme;
}

export const SidebarTabTitle = styled.div`
  flex: 1;
  min-width: 0;
  margin-left: 10px;
  font-size: 12.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ selected, theme }: SidebarTitleProps) => css`
    color: ${selected
      ? theme['sidebar.tab.selectedTextColor'] ||
        theme['tab.selected.textColor']
      : theme['sidebar.tab.textColor'] || theme['tab.textColor']};
  `};
`;

interface CloseProps {
  visible: boolean;
  hoverOnly?: boolean;
  theme?: ITheme;
}

export const SidebarTabClose = styled.div`
  height: 20px;
  min-width: 0;
  border-radius: 99999px;
  background-image: url('${ICON_CLOSE}');
  overflow: hidden;
  transition: 0.1s background-color, 0.1s opacity, 0.1s width, 0.1s margin;
  ${centerIcon(14)};

  ${({ visible, hoverOnly, theme }: CloseProps) => css`
    width: ${visible && hoverOnly ? 0 : 20}px;
    margin-left: ${visible && hoverOnly ? 0 : 4}px;
    display: ${visible ? 'block' : 'none'};
    opacity: ${visible && !hoverOnly ? 0.7 : 0};
    pointer-events: ${visible && !hoverOnly ? 'auto' : 'none'};
    filter: ${theme['toolbar.lightForeground'] ? 'invert(100%)' : 'none'};

    ${hoverOnly &&
    css`
      div[data-rainsee-part='sidebar-tab']:hover & {
        width: 20px;
        margin-left: 4px;
        opacity: 0.7;
        pointer-events: auto;
      }
    `}
  `};

  &:hover {
    background-color: rgba(0, 0, 0, 0.1);
  }
`;

// 拖拽落点插入线:落在目标行上/下半时,在对应边缘画一条主题色高亮线,
// 指示"松手后新标签会插到这里"。绝对定位覆盖行边缘,不占布局。
interface DropLineProps {
  position: 'top' | 'bottom';
  theme?: ITheme;
}

export const SidebarDropLine = styled.div`
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  border-radius: 2px;
  pointer-events: none;
  z-index: 2;
  background-color: ${({ theme }: DropLineProps) =>
    theme.accentColor || '#3452ff'};

  ${({ position }: DropLineProps) => css`
    ${position === 'top' ? 'top: -1px;' : 'bottom: -1px;'}
  `};
`;
