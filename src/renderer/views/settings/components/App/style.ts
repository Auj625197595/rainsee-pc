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
  padding: 26px 18px 20px;
  overflow: hidden;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background: ${theme && theme['pages.lightForeground']
        ? p.bg
        : 'linear-gradient(180deg, #FBFBFE 0%, #F5F5FB 100%)'};
      border-right: 1px solid ${p.line};
    `;
  }}
`;

export const NavBrand = styled.div`
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 0 8px 18px;
`;

export const NavLogo = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #fff;
  background: linear-gradient(135deg, #4a5ae9, #7a6ceb);
  box-shadow: 0 6px 14px -5px rgba(74, 90, 233, 0.6);
`;

export const NavTitle = styled.h1`
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 0;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const NavSearch = styled.div`
  height: 38px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 14px;
  margin-bottom: 16px;
  border-radius: 9999px;
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

export const NavKeyboardShortcut = styled.span`
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 16px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMute};
      background-color: ${theme && theme['pages.lightForeground']
        ? 'rgba(255, 255, 255, 0.07)'
        : '#F1F2F8'};
    `;
  }}
`;

export const NavSectionLabel = styled.div`
  padding: 4px 10px 9px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

// ===== 搜索结果列表（替换导航列表展示）=====

export const NavResults = styled.div`
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
  padding: 9px 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.16s ease;

  ${({ theme, selected }: { theme?: ITheme; selected?: boolean }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${selected ? p.primarySoft : 'transparent'};
      box-shadow: none;

      &:hover {
        background-color: ${selected ? p.primarySoft : p.surface};
      }
    `;
  }}
`;

const navTones = {
  blue: ['#4A5AE9', '#EEF0FF'],
  purple: ['#8A7DE8', '#F4F2FF'],
  green: ['#00B06B', '#E6F7F0'],
  orange: ['#FF8F1F', '#FFF4EB'],
  red: ['#F53F3F', '#FFECEC'],
  cyan: ['#00B4C8', '#E5F8FA'],
  pink: ['#EC5BAD', '#FCEAF5'],
};

export type SettingsTone = keyof typeof navTones;

export const NavIcon = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  width: 30px;
  min-width: 30px;
  border-radius: 9px;
  transition: background-color 0.16s ease, color 0.16s ease;

  ${({
    theme,
    selected,
    tone = 'blue',
  }: {
    theme?: ITheme;
    selected?: boolean;
    tone?: SettingsTone;
  }) => {
    const colors = navTones[tone];
    return css`
      background-color: ${theme && theme['pages.lightForeground']
        ? `${colors[0]}22`
        : colors[1]};
      color: ${colors[0]};
      box-shadow: ${selected ? `0 4px 10px -4px ${colors[0]}80` : 'none'};
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
      font-weight: ${selected ? 600 : 500};
      color: ${selected ? p.primary : p.textMain};
    `;
  }}
`;

export const AccountCard = styled.div`
  appearance: none;
  width: 100%;
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 62px;
  padding: 11px 12px;
  border-radius: 14px;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: filter 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.surface};
      border: 1px solid ${p.line};
    `;
  }}

  &:hover {
    filter: brightness(0.98);
  }

  &:focus-visible {
    outline: 2px solid ${({ theme }: { theme?: ITheme }) =>
      getPalette(theme).primary};
    outline-offset: 2px;
  }
`;

export const AccountAvatar = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  background: linear-gradient(135deg, #ff8f1f, #ec5bad);
  overflow: hidden;
`;

export const AccountAvatarImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

export const AccountMeta = styled.div`
  flex: 1;
  min-width: 0;
`;

export const AccountName = styled.div`
  font-size: 13.5px;
  font-weight: 600;
`;

export const AccountStatus = styled.div`
  margin-top: 1px;
  font-size: 11.5px;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

// ===== 内容区 =====

export const Main = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${getPalette(theme).surface};
  `}
`;

export const MainTopbar = styled.div`
  min-height: 73px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 40px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-bottom: 1px solid ${getPalette(theme).line};
  `}
`;

export const Breadcrumb = styled.div`
  font-size: 13px;
  font-weight: 500;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      strong {
        color: ${p.textMain};
        font-weight: 600;
      }
    `;
  }}
`;

export const TopbarActions = styled.div`
  display: flex;
  gap: 8px;
`;

export const TopbarButton = styled.button`
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${theme && theme['pages.lightForeground']
        ? 'rgba(255, 255, 255, 0.07)'
        : '#F4F5FA'};
      &:hover {
        color: ${p.primary};
        background-color: ${p.primarySoft};
      }
    `;
  }}
`;

export const MainContent = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 30px 40px 48px;

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
  max-width: 780px;
  margin: 0 auto;
  position: relative;
`;

export const PageHeading = styled.h2`
  margin: 0;
  font-size: 26px;
  line-height: 1.3;
  font-weight: 600;
  letter-spacing: 0;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

// ===== 区块原子（沿用既有导入名，重做外观）=====

export const Header = styled.div`
  display: flex;
  align-items: center;
  margin-top: 26px;
  padding: 0 4px 9px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const Row = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 10px;
  min-height: 68px;
  padding: 14px 18px;
  border-radius: 18px;
  cursor: pointer;
  transition: box-shadow 0.18s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line};

      &:hover {
        background-color: ${p.hover};
        box-shadow: inset 0 0 0 1px ${p.line};
      }
    `;
  }}
`;

export const Title = styled.div`
  font-size: 14.5px;
  font-weight: 600;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const SecondaryText = styled.div`
  margin-top: 2px;
  font-size: 12.5px;
  line-height: 1.45;
  font-weight: 500;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const Control = styled.div`
  margin-left: auto;
  display: flex;
  align-items: center;
`;

export const SettingGroupLabel = styled.div`
  padding: 0 4px 9px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const SettingGroup = styled.section`
  margin-top: 26px;
  overflow: hidden;
  border-radius: 18px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      border: 1px solid ${p.line};

      ${Row} {
        margin-top: 0;
        border-radius: 0;
        box-shadow: none;
      }

      ${Row} + ${Row} {
        border-top: 1px solid ${p.line};
      }
    `;
  }}
`;

export const SettingGroupBlock = styled.div`
  margin-top: 26px;

  ${SettingGroup} {
    margin-top: 0;
  }
`;

export const SettingIcon = styled.span`
  width: 38px;
  height: 38px;
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  ${({ tone = 'blue', theme }: { tone?: SettingsTone; theme?: ITheme }) => {
    const colors = navTones[tone];
    return css`
      color: ${colors[0]};
      background-color: ${theme && theme['pages.lightForeground']
        ? `${colors[0]}22`
        : colors[1]};
    `;
  }}
`;

export const SettingCopy = styled.div`
  flex: 1;
  min-width: 0;
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
