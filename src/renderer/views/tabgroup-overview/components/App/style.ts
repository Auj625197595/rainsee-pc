import styled, { css, keyframes } from 'styled-components';
import { ITheme } from '~/interfaces';

const isDark = (theme?: ITheme) => Boolean(theme?.['dialog.lightForeground']);

// '#21b0f3' → 'rgba(33, 176, 243, a)'。非 6 位 hex 原样返回(交给 CSS 兜底)。
export const tint = (hex: string, alpha: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const rise = keyframes`
  from { opacity: 0; transform: translateY(14px) scale(0.97); }
  to { opacity: 1; transform: none; }
`;

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const focusRing = css`
  &:focus-visible {
    outline: 2px solid #3452ff;
    outline-offset: 2px;
  }
`;

// 铺满 BrowserView(=网页内容区)。可见性用 opacity 过渡,主进程延迟 160ms 摘视图。
export const Root = styled.div`
  position: absolute;
  inset: 0;
  overflow: hidden;
  transition: opacity 0.14s ease;

  ${({ $visible }: { $visible: boolean }) => css`
    opacity: ${$visible ? 1 : 0};
    pointer-events: ${$visible ? 'auto' : 'none'};
  `};
`;

// 背景:当前页面截图虚化 + 主题色压暗,保留「仍在这个页面上」的空间感。
export const Backdrop = styled.div`
  position: absolute;
  inset: -40px;
  background-size: cover;
  background-position: center top;
  filter: blur(26px) saturate(140%);
  transform: scale(1.04);
  animation: ${fadeIn} 0.22s ease both;
`;

export const Scrim = styled.div`
  position: absolute;
  inset: 0;
  animation: ${fadeIn} 0.18s ease both;

  ${({ theme }: { theme?: ITheme }) =>
    isDark(theme)
      ? css`
          background: linear-gradient(
            180deg,
            rgba(18, 19, 24, 0.82),
            rgba(18, 19, 24, 0.9)
          );
        `
      : css`
          background: linear-gradient(
            180deg,
            rgba(240, 243, 250, 0.8),
            rgba(232, 236, 246, 0.9)
          );
        `};
`;

export const Scroller = styled.div`
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;

  &::-webkit-scrollbar {
    width: 10px;
  }
  &::-webkit-scrollbar-thumb {
    border-radius: 99px;
    border: 3px solid transparent;
    background-clip: padding-box;
    background-color: rgba(127, 135, 160, 0.4);
  }
`;

export const Content = styled.div`
  max-width: 1280px;
  margin: 0 auto;
  padding: 26px 32px 40px;
  box-sizing: border-box;

  @media (max-width: 640px) {
    padding: 18px 16px 32px;
  }
`;

// ---------- 顶栏 ----------

export const TopBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  animation: ${fadeIn} 0.2s ease both;
`;

export const PaletteAnchor = styled.div`
  position: relative;
  flex-shrink: 0;
`;

export const GroupDot = styled.button`
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:hover {
    background-color: rgba(127, 135, 160, 0.16);
  }

  & > span {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.6);
  }

  ${focusRing};
`;

export const Swatches = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 10;
  display: grid;
  grid-template-columns: repeat(9, 18px);
  gap: 6px;
  padding: 10px;
  border-radius: 12px;
  animation: ${fadeIn} 0.12s ease both;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${isDark(theme) ? '#34363f' : '#fff'};
    box-shadow: 0 0 0 1px
        ${isDark(theme) ? 'rgba(255, 255, 255, 0.08)' : 'rgba(20, 32, 72, 0.08)'},
      0 8px 24px rgba(20, 32, 72, 0.16);
  `};
`;

export const Swatch = styled.button`
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.08s ease;

  ${({ $active }: { $active: boolean }) => css`
    box-shadow: ${$active ? '0 0 0 2px #fff, 0 0 0 4px currentColor' : 'none'};
  `};

  &:hover {
    transform: scale(1.18);
  }
`;

// 分组名即标题,原地可改。宽度随内容(size 属性)伸缩。
export const NameInput = styled.input`
  min-width: 0;
  max-width: 50%;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  background: transparent;
  border: 0;
  outline: 0;
  padding: 3px 8px;
  border-radius: 9px;
  text-overflow: ellipsis;
  font-family: inherit;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${isDark(theme) ? '#f3f5fa' : '#161b2d'};

    &::placeholder {
      color: ${isDark(theme) ? 'rgba(235, 238, 247, 0.55)' : '#8b93a7'};
    }

    &:hover {
      background-color: ${isDark(theme)
        ? 'rgba(255, 255, 255, 0.06)'
        : 'rgba(20, 32, 72, 0.045)'};
    }

    &:focus {
      background-color: ${isDark(theme)
        ? 'rgba(255, 255, 255, 0.1)'
        : 'rgba(52, 82, 255, 0.08)'};
    }
  `};
`;

export const Count = styled.span`
  min-width: 26px;
  height: 24px;
  padding: 0 8px;
  border-radius: 99px;
  box-sizing: border-box;
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  ${({ $color }: { $color: string }) => css`
    color: ${$color};
    background-color: ${tint($color, 0.15)};
  `};
`;

export const Spacer = styled.div`
  flex: 1;
`;

export const IconButton = styled.button`
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  background: transparent;
  transition: background-color 0.12s ease, color 0.12s ease,
    transform 0.08s ease;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${isDark(theme) ? 'rgba(235, 238, 247, 0.72)' : '#5f6880'};

    &:hover {
      color: ${isDark(theme) ? '#fff' : '#161b2d'};
      background-color: ${isDark(theme)
        ? 'rgba(255, 255, 255, 0.1)'
        : 'rgba(20, 32, 72, 0.07)'};
    }
  `};

  &:active {
    transform: scale(0.94);
  }

  ${focusRing};
`;

// ---------- 分组切换条 ----------

export const Pills = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
  animation: ${fadeIn} 0.2s ease both;
`;

export const Pill = styled.button`
  height: 30px;
  max-width: 220px;
  padding: 0 10px 0 10px;
  border: 0;
  border-radius: 99px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background-color 0.12s ease, box-shadow 0.12s ease;

  & > i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  & > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  & > b {
    font-weight: 700;
    opacity: 0.6;
  }

  ${({ $color, $active, theme }: {
    $color: string;
    $active: boolean;
    theme?: ITheme;
  }) =>
    $active
      ? css`
          color: ${isDark(theme) ? '#fff' : '#161b2d'};
          background-color: ${tint($color, isDark(theme) ? 0.3 : 0.18)};
          box-shadow: inset 0 0 0 1.5px ${tint($color, 0.7)};
          cursor: default;
        `
      : css`
          color: ${isDark(theme) ? 'rgba(235, 238, 247, 0.78)' : '#4a536b'};
          background-color: ${isDark(theme)
            ? 'rgba(255, 255, 255, 0.07)'
            : 'rgba(255, 255, 255, 0.75)'};
          box-shadow: inset 0 0 0 1px
            ${isDark(theme) ? 'rgba(255, 255, 255, 0.08)' : 'rgba(20, 32, 72, 0.08)'};

          &:hover {
            background-color: ${tint($color, 0.12)};
          }
        `};

  ${focusRing};
`;

// ---------- 标签卡片网格 ----------

export const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
  gap: 18px;

  /* 包裹层撑满格子,新建卡片与标签卡片等高。 */
  & > div {
    display: flex;
    min-width: 0;
  }
  & > div > * {
    flex: 1;
    min-width: 0;
  }
`;

const cardSurface = (theme?: ITheme) => css`
  background-color: ${isDark(theme)
    ? 'rgba(44, 46, 54, 0.94)'
    : 'rgba(255, 255, 255, 0.96)'};
`;

const enter = (index: number) => css`
  animation: ${rise} 0.28s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  animation-delay: ${Math.min(index, 12) * 26}ms;
`;

interface CardProps {
  $color: string;
  $selected: boolean;
  $index: number;
  theme?: ITheme;
}

export const Card = styled.div`
  position: relative;
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  user-select: none;
  transition: box-shadow 0.18s ease, transform 0.18s ease;

  ${({ $color, $selected, $index, theme }: CardProps) => css`
    ${enter($index)};
    ${cardSurface(theme)};
    box-shadow: ${$selected
      ? `0 0 0 2px ${$color}, 0 10px 28px ${tint($color, 0.24)}`
      : `0 0 0 1px ${
          isDark(theme) ? 'rgba(255, 255, 255, 0.07)' : 'rgba(20, 32, 72, 0.06)'
        }, 0 2px 6px rgba(20, 32, 72, 0.05), 0 8px 22px rgba(20, 32, 72, 0.07)`};

    &:hover {
      transform: translateY(-3px);
      box-shadow: ${$selected
        ? `0 0 0 2px ${$color}, 0 16px 36px ${tint($color, 0.3)}`
        : `0 0 0 1.5px ${tint($color, 0.55)}, 0 6px 12px rgba(20, 32, 72, 0.06), 0 16px 34px rgba(20, 32, 72, 0.12)`};
    }
  `};

  &:hover .card-close,
  & .card-close:focus-visible {
    opacity: 1;
    transform: none;
  }

  &:hover img.shot {
    transform: scale(1.04);
  }

  &:active {
    transform: translateY(-1px) scale(0.99);
  }

  ${focusRing};
`;

// 页面截图区,16:10。
export const Preview = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  flex-shrink: 0;

  ${({ $color, $dim }: { $color: string; $dim: boolean }) => css`
    background: linear-gradient(
      135deg,
      ${tint($color, 0.2)},
      ${tint($color, 0.06)}
    );

    & > img.shot {
      filter: ${$dim ? 'grayscale(0.5) opacity(0.7)' : 'none'};
    }
  `};

  & > img.shot {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center top;
    transition: transform 0.3s ease;
  }

  /* 截图底部与信息区之间的细分隔。 */
  &::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 1px;
    background: rgba(20, 32, 72, 0.06);
  }
`;

// 无截图(从未激活过的后台标签)时的大图标占位。
export const Placeholder = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;

  & > img,
  & > svg {
    width: 28px;
    height: 28px;
    padding: 14px;
    border-radius: 16px;
    object-fit: contain;
    box-shadow: 0 3px 10px rgba(20, 32, 72, 0.12);
  }

  ${({ theme }: { theme?: ITheme }) => css`
    & > img,
    & > svg {
      background-color: ${isDark(theme)
        ? 'rgba(255, 255, 255, 0.12)'
        : 'rgba(255, 255, 255, 0.95)'};
    }
  `};
`;

export const CardClose = styled.button`
  position: absolute;
  top: 8px;
  right: 8px;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #fff;
  background-color: rgba(18, 22, 36, 0.55);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 0.12s ease, transform 0.12s ease,
    background-color 0.12s ease;

  &:hover {
    background-color: rgba(220, 53, 69, 0.92);
  }

  ${focusRing};
`;

export const Badges = styled.div`
  position: absolute;
  top: 8px;
  left: 8px;
  display: flex;
  gap: 6px;
  pointer-events: none;
`;

export const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 9px;
  border-radius: 99px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  flex-shrink: 0;

  ${({ $color, $static }: { $color: string; $static?: boolean }) => css`
    background-color: ${tint($color, 0.9)};
    box-shadow: ${$static ? 'none' : `0 2px 6px ${tint($color, 0.35)}`};
  `};
`;

export const CardInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px 12px;
  min-width: 0;
`;

export const CardFav = styled.div`
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;

  & > img {
    width: 18px;
    height: 18px;
    object-fit: contain;
  }

  ${({ $dim }: { $dim: boolean }) =>
    $dim &&
    css`
      opacity: 0.55;
      filter: grayscale(0.4);
    `};
`;

export const Spinner = styled.div`
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid rgba(127, 135, 160, 0.25);
  border-top-color: #3452ff;
  animation: ${spin} 0.8s linear infinite;
`;

export const CardText = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

export const CardTitle = styled.div`
  font-size: 13px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ $selected, theme }: { $selected: boolean; theme?: ITheme }) => css`
    font-weight: ${$selected ? 700 : 600};
    color: ${isDark(theme) ? 'rgba(242, 244, 250, 0.95)' : '#1d2338'};
  `};
`;

export const CardHost = styled.div`
  font-size: 11px;
  line-height: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${isDark(theme) ? 'rgba(235, 238, 247, 0.5)' : '#8189a0'};
  `};
`;

// 末尾的「新建标签页」虚线卡片。
export const AddCard = styled.button`
  min-height: 160px;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  background: transparent;
  transition: background-color 0.15s ease, color 0.15s ease,
    border-color 0.15s ease;

  ${({ $color, $index, theme }: {
    $color: string;
    $index: number;
    theme?: ITheme;
  }) => css`
    ${enter($index)};
    border: 2px dashed
      ${isDark(theme) ? 'rgba(255, 255, 255, 0.16)' : 'rgba(20, 32, 72, 0.14)'};
    color: ${isDark(theme) ? 'rgba(235, 238, 247, 0.62)' : '#6b7489'};

    &:hover {
      color: ${$color};
      border-color: ${tint($color, 0.6)};
      background-color: ${tint($color, 0.07)};
    }
  `};

  ${focusRing};
`;
