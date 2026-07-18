import styled from 'styled-components';

// 看图模式:强制深色,不依赖主题。配色集中在上方便于统一调整。
const C = {
  bg: '#0d0d0f',
  headerBg: '#16161a',
  cardBg: '#1c1c20',
  cardBgHover: '#23232a',
  border: 'rgba(255,255,255,0.06)',
  text: '#e6e6e8',
  textDim: '#8a8a92',
  blue: '#3b82f6',
  blueHover: '#2563eb',
  selected: 'rgba(59,130,246,0.18)',
};

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif`;

export const StyledApp = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: ${C.bg};
  color: ${C.text};
  font-family: ${FONT};
  font-size: 13px;
  overflow: hidden;
  user-select: none;
  * {
    box-sizing: border-box;
  }
  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.14);
    border-radius: 6px;
    border: 2px solid transparent;
    background-clip: content-box;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.24);
    background-clip: content-box;
  }
`;

export const Header = styled.div`
  flex-shrink: 0;
  height: 56px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  background: ${C.headerBg};
  border-bottom: 1px solid ${C.border};
  z-index: 10;
`;

export const HeaderLeft = styled.div`
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
`;

export const Title = styled.div`
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
`;

export const Count = styled.div`
  font-size: 12px;
  color: ${C.textDim};
  white-space: nowrap;
`;

export const Spacer = styled.div`
  flex: 1;
`;

export const ViewSwitcher = styled.div`
  display: flex;
  background: ${C.cardBg};
  border-radius: 9px;
  padding: 3px;
  gap: 2px;
`;

export const ViewBtn = styled.button<{$active: boolean}>`
  border: none;
  background: ${(p) => (p.$active ? '#2a2a31' : 'transparent')};
  color: ${(p) => (p.$active ? '#fff' : C.textDim)};
  width: 34px;
  height: 30px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  &:hover {
    color: ${C.text};
  }
`;

export const ToolbarRight = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

export const SelectAllLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  color: ${C.textDim};
  font-size: 12.5px;
  white-space: nowrap;
  &:hover {
    color: ${C.text};
  }
`;

// 通用方形 checkbox(div 模拟,样式可控)。icon 由父组件按 $checked/$indeterminate 渲染。
export const Checkbox = styled.div<{$checked: boolean; $indeterminate?: boolean; $size?: number}>`
  width: ${(p) => p.$size || 18}px;
  height: ${(p) => p.$size || 18}px;
  border-radius: 5px;
  border: 1.5px solid
    ${(p) => (p.$checked || p.$indeterminate ? C.blue : 'rgba(255,255,255,0.28)')};
  background: ${(p) =>
    p.$checked || p.$indeterminate ? C.blue : 'rgba(0,0,0,0.2)'};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s ease;
  svg {
    width: 65%;
    height: 65%;
    color: #fff;
  }
`;

export const ToolbarBtn = styled.button<{$primary?: boolean; $disabled?: boolean}>`
  border: 1px solid ${(p) => (p.$primary ? C.blue : 'rgba(255,255,255,0.14)')};
  background: ${(p) => (p.$primary ? C.blue : 'transparent')};
  color: ${(p) => (p.$disabled ? '#5a5a62' : p.$primary ? '#fff' : C.text)};
  padding: 7px 14px;
  border-radius: 7px;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  font-size: 12.5px;
  font-family: ${FONT};
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  transition: background 0.15s ease, border-color 0.15s ease;
  &:hover {
    ${(p) =>
      p.$disabled
        ? ''
        : `background: ${p.$primary ? C.blueHover : 'rgba(255,255,255,0.06)'};`}
  }
  svg {
    width: 15px;
    height: 15px;
  }
`;

export const Content = styled.div`
  flex: 1;
  overflow: auto;
  padding: 20px;
`;

export const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
`;

export const GridCard = styled.div<{$selected: boolean}>`
  position: relative;
  aspect-ratio: 1 / 1;
  border-radius: 12px;
  overflow: hidden;
  background: ${C.cardBg};
  border: 1px solid ${(p) => (p.$selected ? C.blue : C.border)};
  box-shadow: ${(p) =>
    p.$selected
      ? '0 0 0 1px ' + C.blue + ', 0 8px 24px rgba(0,0,0,0.5)'
      : '0 2px 8px rgba(0,0,0,0.3)'};
  cursor: pointer;
  transition: box-shadow 0.25s ease, border-color 0.25s ease, transform 0.25s ease;
  &:hover {
    transform: translateY(-2px);
    box-shadow: ${(p) =>
      p.$selected
        ? '0 0 0 1px ' + C.blue + ', 0 12px 30px rgba(0,0,0,0.6)'
        : '0 10px 28px rgba(0,0,0,0.55)'};
  }
`;

export const CardImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.3s ease;
  ${GridCard}:hover & {
    transform: scale(1.05);
  }
`;

export const CardOverlay = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 18px 10px 8px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0));
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: #fff;
  pointer-events: none;
`;

export const CardType = styled.span`
  background: rgba(0, 0, 0, 0.5);
  padding: 1px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.3px;
`;

// grid 卡片左上角圆形勾选(hover 显,选中常显)。
export const CardCheckbox = styled.div<{$checked: boolean; $visible: boolean}>`
  position: absolute;
  top: 8px;
  left: 8px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: ${(p) => (p.$checked ? C.blue : 'rgba(0,0,0,0.55)')};
  border: 1.5px solid ${(p) => (p.$checked ? C.blue : 'rgba(255,255,255,0.75)')};
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 2;
  opacity: ${(p) => (p.$checked || p.$visible ? 1 : 0)};
  transition: opacity 0.15s ease, background 0.15s ease;
  svg {
    width: 15px;
    height: 15px;
    color: #fff;
  }
`;

// list 行
export const ListRow = styled.div<{$selected: boolean}>`
  display: flex;
  align-items: center;
  gap: 12px;
  height: 68px;
  padding: 0 12px;
  border-radius: 9px;
  cursor: pointer;
  background: ${(p) => (p.$selected ? C.selected : 'transparent')};
  border-left: 3px solid
    ${(p) => (p.$selected ? C.blue : 'transparent')};
  transition: background 0.15s ease;
  &:hover {
    background: ${(p) => (p.$selected ? C.selected : 'rgba(255,255,255,0.04)')};
  }
  & + & {
    margin-top: 2px;
  }
`;

export const ListThumb = styled.div`
  width: 56px;
  height: 56px;
  border-radius: 8px;
  overflow: hidden;
  background: ${C.cardBg};
  flex-shrink: 0;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
`;

export const ListInfo = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

export const ListAlt = styled.div`
  color: ${C.text};
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const ListUrl = styled.div`
  color: ${C.textDim};
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const ListMeta = styled.div`
  color: ${C.textDim};
  font-size: 11.5px;
  white-space: nowrap;
  flex-shrink: 0;
`;

// strip(平铺/漫画)模式:垂直连续大图,居中限宽,适合漫画/条漫阅读。
export const Strip = styled.div`
  max-width: 960px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
`;

export const StripItem = styled.div<{$selected: boolean}>`
  position: relative;
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
  background: ${C.cardBg};
  border: 1px solid ${(p) => (p.$selected ? C.blue : 'transparent')};
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
`;

export const StripImg = styled.img`
  display: block;
  width: 100%;
  height: auto;
  cursor: zoom-in;
`;

// lightbox
export const Lightbox = styled.div`
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.94);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: none;
`;

export const LightboxImg = styled.img`
  max-width: 90vw;
  max-height: 86vh;
  object-fit: contain;
  border-radius: 4px;
  user-select: none;
  -webkit-user-drag: none;
  transform-origin: center;
  will-change: transform;
`;

export const LightboxArrow = styled.button<{$left?: boolean}>`
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  ${(p) => (p.$left ? 'left: 24px;' : 'right: 24px;')}
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
  &:hover {
    background: rgba(255, 255, 255, 0.22);
  }
  svg {
    width: 26px;
    height: 26px;
  }
`;

export const LightboxBtn = styled.button`
  position: absolute;
  top: 20px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: #fff;
  cursor: pointer;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
  &:hover {
    background: rgba(255, 255, 255, 0.22);
  }
  svg {
    width: 22px;
    height: 22px;
  }
`;

export const LightboxCounter = styled.div`
  position: absolute;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  color: #fff;
  font-size: 13px;
  background: rgba(0, 0, 0, 0.5);
  padding: 6px 14px;
  border-radius: 20px;
`;

// 状态态
export const CenterState = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: ${C.textDim};
  svg {
    width: 56px;
    height: 56px;
    opacity: 0.5;
  }
`;

export const Spinner = styled.div`
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.12);
  border-top-color: ${C.blue};
  animation: ivspin 0.8s linear infinite;
  @keyframes ivspin {
    to {
      transform: rotate(360deg);
    }
  }
`;

// 右下角 toast
export const Toast = styled.div`
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(32, 33, 36, 0.95);
  color: #fff;
  padding: 11px 20px;
  border-radius: 9px;
  font-size: 13px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  z-index: 200;
  max-width: 80vw;
`;

// zip 打包进度模态
export const ZipMask = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 150;
  display: flex;
  align-items: center;
  justify-content: center;
`;

export const ZipDialog = styled.div`
  width: 360px;
  background: ${C.headerBg};
  border: 1px solid ${C.border};
  border-radius: 14px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
`;

export const ZipTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 9px;
  svg {
    width: 18px;
    height: 18px;
    color: ${C.blue};
  }
`;

export const ZipBarTrack = styled.div`
  height: 6px;
  background: ${C.cardBg};
  border-radius: 4px;
  overflow: hidden;
`;

export const ZipBarFill = styled.div<{$pct: number}>`
  height: 100%;
  width: ${(p) => p.$pct}%;
  background: ${C.blue};
  border-radius: 4px;
  transition: width 0.2s ease;
`;

export const ZipProgressText = styled.div`
  font-size: 12px;
  color: ${C.textDim};
  text-align: right;
`;
