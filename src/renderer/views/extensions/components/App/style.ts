import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { getPalette } from '~/renderer/views/bookmarks/utils/palette';

// 拓展管理页:沿用 历史 / 书签 / 下载 的双栏视觉风格。
// 左侧 280px 侧栏(标题 + 搜索 + 筛选 + 开发者模式 + 安装入口) + 右侧扩展列表。

// ===== 侧边导航 =====

export const Sidebar = styled.div`
  width: 280px;
  min-width: 280px;
  height: 100vh;
  display: flex;
  flex-flow: column;
  padding: 24px 20px;
  overflow-y: auto;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      border-right: 1px solid ${p.line};
    `;
  }}
`;

export const SideTitle = styled.h1`
  margin: 0;
  padding: 0 4px;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const SearchBox = styled.div`
  margin-top: 20px;
  height: 40px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  border-radius: 14px;

  svg {
    flex-shrink: 0;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      border: 1px solid ${p.line};
      color: ${p.textMute};
    `;
  }}
`;

export const SearchInput = styled.input`
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  font-family: inherit;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};

      &::placeholder {
        color: ${p.textMute};
      }
    `;
  }}
`;

export const SectionLabel = styled.div`
  margin: 24px 0 8px;
  padding: 0 4px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const FilterNav = styled.nav`
  display: flex;
  flex-flow: column;
  gap: 2px;
`;

export const FilterButton = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  cursor: pointer;
  transition: background-color 0.16s ease;

  ${({ theme, selected }: { theme?: ITheme; selected?: boolean }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${selected ? p.primarySoft : 'transparent'};
      box-shadow: ${selected ? `inset 0 0 0 1px ${p.primary}26` : 'none'};

      &:hover {
        background-color: ${selected ? p.primarySoft : p.surface};
      }
    `;
  }}
`;

export const FilterIconBox = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  width: 32px;
  min-width: 32px;
  border-radius: 10px;
  transition: background-color 0.16s ease, color 0.16s ease;

  ${({ theme, selected }: { theme?: ITheme; selected?: boolean }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${selected ? p.primary : p.surface};
      color: ${selected ? '#fff' : p.textSub};
      box-shadow: ${selected ? 'none' : `inset 0 0 0 1px ${p.line}`};
    `;
  }}
`;

export const FilterLabel = styled.span`
  flex: 1;
  min-width: 0;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ theme, selected }: { theme?: ITheme; selected?: boolean }) => {
    const p = getPalette(theme);
    return css`
      font-weight: ${selected ? 700 : 500};
      color: ${selected ? p.primary : p.textMain};
    `;
  }}
`;

export const FilterCount = styled.span`
  font-size: 12px;

  ${({ theme, selected }: { theme?: ITheme; selected?: boolean }) => {
    const p = getPalette(theme);
    return css`
      font-weight: ${selected ? 700 : 600};
      color: ${selected ? p.primary : p.textMute};
    `;
  }}
`;

// ===== 侧栏底部:开发者模式 + 安装入口 =====

export const BottomActions = styled.div`
  margin-top: auto;
  padding-top: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-top: 1px solid ${getPalette(theme).line};
  `}
`;

export const DevToggleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px 14px;
  font-size: 13px;
  font-weight: 600;

  & > span {
    flex: 1;
  }

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const InstallButton = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 12px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: background-color 0.16s ease;

  svg {
    flex-shrink: 0;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};

      &:hover {
        background-color: ${p.surface};
        color: ${p.primary};
      }
    `;
  }}
`;

// 「检查更新」按钮下方的结果提示小字。
export const UpdateStatus = styled.div`
  margin: 6px 4px 2px;
  font-size: 12px;
  line-height: 1.5;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

// ===== 内容区 =====

export const MainScroll = styled.div`
  flex: 1;
  min-width: 0;
  height: 100vh;
  overflow: auto;
  padding: 36px 48px;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${getPalette(theme).surface};
  `}

  &::-webkit-scrollbar {
    width: 9px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(149, 163, 184, 0.28);
    border-radius: 9999px;
    border: 3px solid transparent;
    background-clip: content-box;
  }
`;

export const MainInner = styled.div`
  max-width: 1000px;
  margin: 0 auto;
  position: relative;
`;

export const DragOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  pointer-events: none;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background: rgba(17, 24, 39, 0.18);
      backdrop-filter: blur(4px);
      color: ${p.textMain};
    `;
  }}
`;

export const DragCard = styled.div`
  width: min(520px, 100%);
  padding: 28px 32px;
  border-radius: 24px;
  text-align: center;

  svg {
    width: 42px;
    height: 42px;
    margin-bottom: 14px;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background: ${p.bg};
      border: 2px dashed ${p.primary};
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.18);
    `;
  }}
`;

export const DragTitle = styled.div`
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.03em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const DragText = styled.div`
  margin-top: 10px;
  font-size: 14px;
  line-height: 1.7;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
`;

export const EmptyState = styled.div`
  display: flex;
  flex-flow: column;
  align-items: center;
  justify-content: center;
  padding: 120px 0;
  text-align: center;

  svg {
    opacity: 0.25;
    margin-bottom: 16px;
  }

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const EmptyText = styled.div`
  font-size: 14px;
  font-weight: 500;
`;

// ===== 拓展商店区(列表下方:分割线 + 商店卡片) =====

export const StoreDivider = styled.div`
  margin: 40px 0 28px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-top: 1px solid ${getPalette(theme).line};
  `}
`;

export const StoreHeader = styled.div`
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 20px;
`;

export const StoreTitle = styled.h2`
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const StoreSubtitle = styled.span`
  font-size: 13px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const StoreGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
`;

export const StoreCard = styled.div`
  display: flex;
  flex-flow: column;
  padding: 16px;
  border-radius: 16px;
  transition: box-shadow 0.16s ease, transform 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      border: 1px solid ${p.line};

      &:hover {
        box-shadow: 0 6px 18px rgba(20, 32, 72, 0.08);
      }
    `;
  }}
`;

export const StoreCardHead = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

export const StoreIcon = styled.div`
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 10px;
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${getPalette(theme).surface};
  `}
`;

export const StoreName = styled.div`
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const StoreIntro = styled.div`
  margin: 12px 0 16px;
  font-size: 13px;
  line-height: 1.6;
  height: 62px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const StoreInstallBtn = styled.button<{ installed?: boolean }>`
  margin-top: auto;
  height: 36px;
  border: none;
  border-radius: 10px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.16s ease, background-color 0.16s ease;

  &:disabled {
    cursor: default;
  }

  ${({ theme, installed }: { theme?: ITheme; installed?: boolean }) => {
    const p = getPalette(theme);
    return installed
      ? css`
          background-color: ${p.surface};
          color: ${p.textMute};
          box-shadow: inset 0 0 0 1px ${p.line};
        `
      : css`
          background-color: ${p.primary};
          color: #fff;

          &:hover {
            opacity: 0.9;
          }
          &:disabled {
            opacity: 0.6;
          }
        `;
  }}
`;
