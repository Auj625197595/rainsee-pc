import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { getPalette } from '~/renderer/views/bookmarks/utils/palette';

// 下载管理页：沿用书签 / 历史的视觉风格(rainpc 桌面双栏)。
// 左侧 280px 侧栏(标题 + 搜索 + 状态筛选 + 清除) + 右侧分组列表内容区。

// ===== 侧边导航 =====

export const Sidebar = styled.div`
  width: 280px;
  min-width: 280px;
  height: 100vh;
  display: flex;
  flex-flow: column;
  padding: 24px 20px;
  overflow: hidden;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      border-right: 1px solid ${p.line};
    `;
  }}
`;

export const SideHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 4px;
`;

export const SideTitle = styled.h1`
  margin: 0;
  padding: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const SettingsButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  flex-shrink: 0;
  height: 32px;
  padding: 0 9px;
  border: none;
  border-radius: 9px;
  cursor: pointer;
  background-color: transparent;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  transition: background-color 0.16s ease, color 0.16s ease;

  svg {
    flex-shrink: 0;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};

      &:hover {
        color: ${p.primary};
        background-color: ${p.primarySoft};
      }
    `;
  }}
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

export const BottomActions = styled.div`
  margin-top: auto;
  padding-top: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-top: 1px solid ${getPalette(theme).line};
  `}
`;

export const ClearButton = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: background-color 0.16s ease;

  svg {
    flex-shrink: 0;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.danger};

      &:hover {
        background-color: ${p.danger}14;
      }
    `;
  }}
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
  max-width: 900px;
  margin: 0 auto;
  position: relative;
`;

// 空状态(无下载或搜索无结果)。
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

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMute};
    `;
  }}
`;

export const EmptyText = styled.div`
  font-size: 14px;
  font-weight: 500;
`;
