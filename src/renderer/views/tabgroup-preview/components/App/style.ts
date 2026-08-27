import styled, { css } from 'styled-components';

// 覆盖整个 BrowserView（包含卡片四周用于渲染阴影的透明边距）。鼠标从标签组
// 移向卡片时会先进入这段边距，因此 hover 接管必须放在这里，不能只监听卡片。
export const HoverArea = styled.div`
  position: absolute;
  inset: 0;
`;

export const StyledApp = styled.div`
  /* 卡片绝对定位内缩 12px:BrowserView 按「卡片 + 两侧 12px」建大小,卡片内缩后
     阴影得以在 BrowserView 内完整渲染。原先卡片=BrowserView 全填,投影被
     BrowserView 边界硬裁,边缘发脏(就是那个丑阴影的根因)。参考 add-bookmark /
     QuickMenu 标准:轻量多层阴影 + 毛玻璃 + 细描边。不设 overflow:hidden——色盘
     浮层需能越过卡片边界显示。 */
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  bottom: 12px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  background-color: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  box-shadow: 0 1px 4px rgba(20, 32, 72, 0.05),
    0 4px 12px rgba(20, 32, 72, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.7);
  display: flex;
  flex-direction: column;
  padding: 6px;
  box-sizing: border-box;
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 6px;
  font-size: 12px;
  font-weight: 700;
  color: #1b2440;
  flex-shrink: 0;
`;

export const HeaderAddButton = styled.button`
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #5f6368;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;

  &:hover {
    color: #1b2440;
    background-color: rgba(43, 83, 217, 0.08);
  }

  &:active {
    transform: scale(0.92);
  }
`;

export const ColorDot = styled.div`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  cursor: pointer;
`;

// 色点点击后弹出的预设色盘。色点本身可点击切换。
export const ColorButton = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: 50%;
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    background-color: rgba(43, 83, 217, 0.08);
  }
`;

export const Swatches = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  background-color: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  box-shadow: 0 1px 4px rgba(20, 32, 72, 0.08), 0 4px 12px rgba(20, 32, 72, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
`;

export const Swatch = styled.div`
  width: 16px;
  height: 16px;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.08s ease;

  &:hover {
    transform: scale(1.18);
  }
`;

// 组名内联输入框:占满标题剩余空间,无边框,聚焦时淡蓝底。本地 state 驱动,
// 每次输入经 IPC 把改名回传宿主持久化(宿主 refresh 回写 store.groupName,但本地
// state 不随之重置,避免打断输入)。
export const NameInput = styled.input`
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 700;
  color: #1b2440;
  background: transparent;
  border: 0;
  outline: 0;
  padding: 3px 6px;
  border-radius: 7px;

  &::placeholder {
    color: #98a1b3;
    font-weight: 600;
  }

  &:focus {
    background-color: rgba(43, 83, 217, 0.08);
  }
`;

export const List = styled.div`
  flex: 1;
  overflow-y: auto;
  min-height: 0;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    border-radius: 99px;
    background-color: rgba(0, 0, 0, 0.16);
  }
`;

interface RowProps {
  selected: boolean;
}

export const Row = styled.div`
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
