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
  height: 40px;
  margin: 2px 6px;
  padding: 0 8px;
  border-radius: 12px;
  cursor: default;
  overflow: hidden;
  -webkit-app-region: no-drag;
  transition: background-color 0.15s ease;

  ${({ selected, groupColor, dragging, collapsed, theme }: SidebarTabProps) => css`
    // 组内标签缩进 + 组色淡背景,体现分组归属。窄轨态取消缩进。
    margin-left: ${collapsed ? '6px' : groupColor ? '20px' : '6px'};
    padding: ${collapsed ? '0 8px' : '0 8px'};
    opacity: ${dragging ? 0.4 : 1};
    background-color: ${selected
      ? theme['toolbar.lightForeground']
        ? 'rgba(255, 255, 255, 0.14)'
        : '#ffffff'
      : groupColor
      ? tint(groupColor, 0.10)
      : 'transparent'};
    box-shadow: ${selected
      ? '0 4px 14px rgba(44, 73, 194, 0.12)'
      : 'none'};
    border: ${selected
      ? '1px solid rgba(52, 82, 255, 0.18)'
      : '1px solid transparent'};

    &:hover {
      background-color: ${selected
        ? theme['toolbar.lightForeground']
          ? 'rgba(255, 255, 255, 0.16)'
          : '#ffffff'
        : groupColor
        ? tint(groupColor, 0.18)
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
      ? theme['tab.selected.textColor']
      : theme['tab.textColor']};
  `};
`;

// 窄轨态标题:标题前两字,横向排在图标右侧。
export const SidebarTabCompactTitle = styled.div`
  flex: 1;
  min-width: 0;
  margin-left: 8px;
  font-size: 11.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ selected, theme }: SidebarTitleProps) => css`
    color: ${selected
      ? theme['tab.selected.textColor']
      : theme['tab.textColor']};
  `};
`;

interface CloseProps {
  visible: boolean;
  theme?: ITheme;
}

export const SidebarTabClose = styled.div`
  height: 20px;
  width: 20px;
  margin-left: 4px;
  border-radius: 99999px;
  background-image: url('${ICON_CLOSE}');
  transition: 0.1s background-color, 0.1s opacity;
  ${centerIcon(14)};

  ${({ visible, theme }: CloseProps) => css`
    opacity: ${visible ? 0.7 : 0};
    filter: ${theme['toolbar.lightForeground'] ? 'invert(100%)' : 'none'};
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
