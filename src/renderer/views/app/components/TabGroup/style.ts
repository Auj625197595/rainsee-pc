import styled, { css } from 'styled-components';

import {
  CHIP_PAD_LR,
  CHIP_NAME_MAX,
  CHIP_FAV_W,
  CHIP_ACTIVE_TITLE_W,
} from '../../constants';

// hex 组色 → rgba(用于淡/浓基准色叠加)。
function tint(hex: string, alpha: number): string {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 芯片 slot 容器:由布局引擎经 transform/width 动画驱动(等同单个标签的位置)。
// 不设 align-items(沿用默认 stretch),与普通标签 StyledTab 一致——Chip 靠
// margin-top:tabMarginTop 下沉,与 TabContainer 处于同一水平基线。
export const StyledTabGroup = styled.div`
  position: absolute;
  left: 0;
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
`;

interface ChipProps {
  color: string;
  containsActive: boolean;
  pinned: boolean;
  dropTarget?: boolean;
  theme?: any;
}

// 芯片本体:高度/圆角/投影与普通标签一致;组的视觉标识=基准色(组色)按状态显浓淡——
// 选中:完整基准色(边框+内圈实色);未选中:淡淡基准色(边框+内圈低 alpha),
// 使其与透明边框的散落未分组标签明显区分。
// 固定分组(整组钉住):实心组色填充 + 白字,紧凑态(无活动标题),视觉上区别于
// 普通芯片。组名颜色经 CSS 变量 --chip-name-fg 下发给 ChipName。
export const Chip = styled.div`
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0 ${CHIP_PAD_LR}px;
  border-radius: 9999px;
  border: 1px solid transparent;
  overflow: hidden;
  box-sizing: border-box;
  transition: 0.12s background-color, 0.12s box-shadow, 0.12s border-color;
  cursor: default;

  ${({ color, containsActive, pinned, dropTarget, theme }: ChipProps) => css`
    height: ${theme.isCompact ? theme.tabHeight : 34}px;
    margin: ${theme.isCompact ? 'auto 0' : `${theme.tabMarginTop}px 0 4px`};
    background: ${pinned
      ? color
      : `linear-gradient(180deg, ${tint(color, 0.16)} 0%, ${tint(color, 0.08)} 100%)`};
    border-color: ${pinned
      ? color
      : containsActive
        ? tint(color, 0.78)
        : tint(color, 0.34)};
    box-shadow: ${pinned
      ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.42)'
      : `0 3px 8px ${tint(color, 0.12)}, inset 0 0 0 1px ${tint(color, 0.22)}`};
    --chip-name-fg: ${pinned
      ? '#fff'
      : theme?.['toolbar.lightForeground']
        ? '#fff'
        : '#000'};

    &:hover {
      border-color: ${pinned ? color : tint(color, 0.52)};
      box-shadow: ${pinned
        ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.5)'
        : `0 4px 10px ${tint(color, 0.14)}, inset 0 0 0 1px ${tint(color, 0.26)}`};
    }

    /* 拖拽合入的投放高亮:醒目组色底 + 双层组色环 + 外发光,明确「松手即合入此组」。
       置于最后,覆盖上面的底色/描边;transform 微放大呼应 Chrome 的吸附反馈。 */
    ${dropTarget &&
    css`
      background-color: ${tint(color, 0.22)} !important;
      border-color: ${color} !important;
      box-shadow:
        inset 0 0 0 2px ${color},
        0 0 0 1px ${tint(color, 0.45)},
        0 2px 6px ${tint(color, 0.22)} !important;
    `}
  `};
`;

// favicon 横排:不再有底层背景高亮——选中态只由被选中那个 Fav 自身的底色表达,
// 避免整行底色与芯片选中态(白底+基准色边框)叠加显得脏。gap/padding 置 0,使行宽
// 精确 = count * CHIP_FAV_W,与 computeChipWidth 对齐,避免 overflow:hidden 裁掉
// 末尾图标。Fav 自身 22px 槽位(内含 16px 图标)已提供视觉间距。
export const FavRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0;
  border-radius: 7px;
`;

interface FavProps {
  selected: boolean;
}

export const Fav = styled.div`
  width: ${CHIP_FAV_W}px;
  height: ${CHIP_FAV_W}px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  transition: 0.1s background-color;

  ${({ selected }: FavProps) => css`
    background-color: ${selected ? 'rgba(255, 255, 255, 0.92)' : 'transparent'};
    box-shadow: ${selected ? '0 4px 10px rgba(42, 152, 101, 0.16)' : 'none'};
  `};

  & > img {
    width: 16px;
    height: 16px;
    object-fit: contain;
  }

  &:hover {
    background-color: rgba(255, 255, 255, 0.72);
  }
`;

// 含选中标签时显示的标题槽(~5 格,超出 ellipsis)。
export const ActiveTitle = styled.div`
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.12em;
  width: ${CHIP_ACTIVE_TITLE_W}px;
  margin-left: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--chip-name-fg, ${({ theme }: { theme?: any }) => theme['tab.selected.textColor']});
  flex-shrink: 0;
  cursor: pointer;
`;

export const CountBadge = styled.div`
  margin-left: 8px;
  padding: 2px 10px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: inset 0 0 0 1px #cfefdd;
  color: #2b8b60;
  font-size: 10px;
  font-weight: 900;
  line-height: 1.4;
  flex-shrink: 0;
`;

// ===== 悬停列表弹窗(Portal 到 document.body,逃逸 TabsContainer 的 overflow:hidden)=====
export const PopoverCard = styled.div`
  position: absolute;
  z-index: 9999;
  min-width: 240px;
  max-width: 320px;
  padding: 6px;
  border-radius: 14px;
  background-color: rgba(255, 255, 255, 0.97);
  box-shadow:
    0 2px 8px rgba(20, 32, 72, 0.12),
    0 8px 24px rgba(20, 32, 72, 0.12),
    inset 0 0 0 1px #e3eafb;
  overflow: hidden;
`;

export const PopoverHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 6px;
  font-size: 12px;
  font-weight: 700;
  color: #1b2440;
`;

export const ColorDot = styled.div`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
`;

interface RowProps {
  selected: boolean;
}

export const PopoverRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 9px;
  cursor: pointer;
  user-select: none;

  ${({ selected }: RowProps) => css`
    background-color: ${selected ? 'rgba(43, 83, 217, 0.10)' : 'transparent'};
  `};

  &:hover {
    background-color: rgba(43, 83, 217, 0.08);
  }
`;

export const RowFav = styled.div`
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;

  & > img {
    width: 16px;
    height: 16px;
    object-fit: contain;
  }
`;

export const RowTitle = styled.div`
  flex: 1;
  font-size: 13px;
  color: #1b2440;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const RowClose = styled.div`
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  opacity: 0.5;
  flex-shrink: 0;

  &:hover {
    opacity: 1;
    background-color: rgba(0, 0, 0, 0.08);
  }
`;
