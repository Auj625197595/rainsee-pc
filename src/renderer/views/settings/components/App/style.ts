import styled, { css, keyframes } from 'styled-components';

import { ITheme } from '~/interfaces';
import { centerIcon } from '~/renderer/mixins';
import { ICON_BACK } from '~/renderer/constants';
import { getPalette } from '../../utils/palette';

// ===== 搜索引擎对话框（重做外观，沿用既有功能）=====

const dialogPop = keyframes`
  from {
    opacity: 0;
    transform: translate(-50%, -46%) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
`;

export const SeDialog = styled.div`
  position: fixed;
  width: 420px;
  max-width: calc(100vw - 40px);
  padding: 26px 26px 22px;
  left: 50%;
  top: 50%;
  border-radius: 22px;
  z-index: 999;
  transform: translate(-50%, -50%);

  ${({ visible, theme }: { visible: boolean; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      opacity: ${visible ? 1 : 0};
      pointer-events: ${visible ? 'inherit' : 'none'};
      background-color: ${p.surface};
      color: ${p.textMain};
      box-shadow: inset 0 0 0 1px ${p.line},
        0 32px 70px -34px rgba(40, 60, 120, 0.5);
      animation: ${visible ? dialogPop : 'none'} 0.22s
        cubic-bezier(0.22, 1, 0.36, 1);
    `;
  }}
`;

export const SeDialogHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 13px;
  margin-bottom: 22px;
`;

export const SeDialogIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  flex-shrink: 0;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.primary};
      background-color: ${p.primarySoft};
    `;
  }}
`;

export const SeDialogHeading = styled.div`
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const SeDialogSub = styled.div`
  margin-top: 2px;
  font-size: 12.5px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const SeFieldGroup = styled.div`
  display: flex;
  flex-flow: column;
  gap: 16px;
`;

export const SeHint = styled.div`
  margin-top: 9px;
  font-size: 12px;
  line-height: 1.5;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMute};

      code {
        font-family: 'SF Mono', 'Roboto Mono', monospace;
        font-size: 11.5px;
        padding: 1px 5px;
        border-radius: 5px;
        color: ${p.primary};
        background-color: ${p.primarySoft};
      }
    `;
  }}
`;

export const SeDialogFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 26px;
`;

// 单个字段：标签在上，输入框在下
export const SeField = styled.label`
  display: flex;
  flex-flow: column;
  gap: 7px;
`;

export const SeFieldLabel = styled.span`
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.01em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const SeInput = styled.input`
  width: 100%;
  height: 42px;
  padding: 0 14px;
  border-radius: 12px;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.16s ease, box-shadow 0.16s ease,
    background-color 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      border: 1px solid ${p.line};

      &::placeholder {
        color: ${p.textMute};
      }

      &:hover {
        border-color: ${p.primary}66;
      }

      &:focus {
        background-color: ${p.surface};
        border-color: ${p.primary};
        box-shadow: 0 0 0 3px ${p.primary}1f;
      }
    `;
  }}
`;

// ===== 设置导航侧栏 =====

export const Nav = styled.div`
  width: 300px;
  min-width: 300px;
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

export const NavTitle = styled.h1`
  margin: 0;
  padding: 0 4px;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const NavSearch = styled.div`
  margin-top: 20px;
  height: 40px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  border-radius: 14px;
  font-size: 13px;
  transition: box-shadow 0.16s ease, border-color 0.16s ease;

  svg {
    flex-shrink: 0;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      border: 1px solid ${p.line};
      color: ${p.textMute};

      &:focus-within {
        border-color: ${p.primary};
        box-shadow: 0 0 0 3px ${p.primary}1f;
      }
    `;
  }}
`;

export const NavSearchInput = styled.input`
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: 13px;
  padding: 0;

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

export const NavSearchClear = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: none;
  background: transparent;
  padding: 3px;
  border-radius: 7px;
  cursor: pointer;
  color: inherit;
  opacity: 0.7;
  transition: opacity 0.16s ease;

  &:hover {
    opacity: 1;
  }
`;

// ===== 搜索结果列表（替换导航列表展示）=====

export const NavResults = styled.div`
  margin-top: 14px;
  flex: 1;
  min-height: 0;
  overflow: hidden auto;
  display: flex;
  flex-flow: column;
  gap: 2px;

  &::-webkit-scrollbar {
    width: 0;
  }
`;

export const NavResultItem = styled.div`
  display: flex;
  flex-flow: column;
  gap: 2px;
  padding: 9px 14px;
  border-radius: 12px;
  cursor: pointer;
  transition: background-color 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      &:hover {
        background-color: ${p.surface};
      }
    `;
  }}
`;

export const NavResultLabel = styled.div`
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const NavResultSection = styled.div`
  font-size: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const NavResultEmpty = styled.div`
  padding: 18px 14px;
  font-size: 13px;
  text-align: center;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const NavList = styled.nav`
  margin-top: 22px;
  flex: 1;
  min-height: 0;
  overflow: hidden auto;
  display: flex;
  flex-flow: column;
  gap: 2px;

  &::-webkit-scrollbar {
    width: 0;
  }
`;

export const NavItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
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

export const NavIcon = styled.span`
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

export const NavLabel = styled.span`
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

// ===== 内容区 =====

export const Main = styled.div`
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
  max-width: 820px;
  margin: 0 auto;
  position: relative;
`;

// ===== 区块原子（沿用既有导入名，重做外观）=====

export const Header = styled.div`
  display: flex;
  align-items: center;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin-bottom: 14px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const Row = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 10px;
  padding: 16px 18px;
  border-radius: 16px;
  cursor: pointer;
  transition: box-shadow 0.18s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line}, 0 1px 2px rgba(20, 27, 45, 0.04);

      &:hover {
        box-shadow: inset 0 0 0 1px ${p.primary}40,
          0 10px 30px -22px rgba(40, 60, 120, 0.3);
      }
    `;
  }}
`;

export const Title = styled.div`
  font-size: 15px;
  font-weight: 700;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const SecondaryText = styled.div`
  margin-top: 3px;
  font-size: 13px;
  font-weight: 400;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const Control = styled.div`
  margin-left: auto;
  display: flex;
  align-items: center;
`;

export const IconButton = styled.div`
  border-radius: 10px;
  cursor: pointer;
  width: 36px;
  height: 36px;
  ${centerIcon(22)};
  opacity: 0.8;

  ${({ theme }: { theme?: ITheme }) => css`
    &:hover {
      background-color: ${getPalette(theme).surface};
    }

    filter: ${theme['pages.lightForeground'] ? 'invert(100%)' : 'none'};
  `}
`;

export const Back = styled(IconButton)`
  margin-right: 10px;
  background-image: url(${ICON_BACK});
`;
