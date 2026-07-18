import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';
import { BLUE_300 } from '~/renderer/constants';

export const StyledAddressBar = styled.div`
  height: 38px;
  flex: 1;
  flex-basis: ${({ $minWidth }: { $minWidth: number }) => $minWidth}px;
  min-width: ${({ $minWidth }: { $minWidth: number }) => $minWidth}px;
  border-radius: 14px;
  margin: 0 8px;
  padding: 0 4px;
  display: flex;
  align-items: center;
  position: relative;
  -webkit-app-region: no-drag;

  font-size: 15px;
  overflow: hidden;
  transition: border-color 0.18s ease, background-color 0.18s ease,
    box-shadow 0.18s ease;

  .addressbar-action {
    flex-shrink: 0;
  }

  ${({ $compactLevel }: { $compactLevel: number }) => css`
    ${$compactLevel >= 1 &&
    css`
      .addressbar-action--update {
        display: none;
      }
    `}

    ${$compactLevel >= 2 &&
    css`
      .addressbar-action--video {
        display: none;
      }
    `}

    ${$compactLevel >= 3 &&
    css`
      .addressbar-action--new-tab-search {
        display: none;
      }
    `}

    ${$compactLevel >= 4 &&
    css`
      .addressbar-action--autofill,
      .addressbar-action--pwa {
        display: none;
      }
    `}

    ${$compactLevel >= 5 &&
    css`
      .addressbar-action--translate {
        display: none;
      }
    `}

    ${$compactLevel >= 6 &&
    css`
      .addressbar-action--zoom {
        display: none;
      }
    `}

    ${$compactLevel >= 7 &&
    css`
      .addressbar-action--shield {
        display: none;
      }
    `}

    ${$compactLevel >= 8 &&
    css`
      .addressbar-action--star {
        display: none;
      }
    `}

    ${$compactLevel >= 9 &&
    css`
      .addressbar-action--engine {
        display: none;
      }
    `}
  `}

  ${({ theme, focus }: { theme: ITheme; focus: boolean }) => css`
    background-color: ${theme['addressbar.backgroundColor']};
    border: 1px solid
      ${focus
        ? theme.accentColor
        : theme['toolbar.lightForeground']
        ? 'rgba(255, 255, 255, 0.14)'
        : 'rgba(220, 228, 250, 0.95)'};
    color: ${theme['addressbar.textColor']};
    box-shadow: ${focus
      ? `0 0 0 3px ${
          theme['toolbar.lightForeground']
            ? 'rgba(255, 255, 255, 0.08)'
            : 'rgba(52, 82, 255, 0.12)'
        }`
      : theme['toolbar.lightForeground']
      ? 'none'
      : '0 4px 16px rgba(20, 32, 72, 0.05)'};
  `};
`;

export const InputContainer = styled.div`
  flex: 1;
  position: relative;
  height: 100%;
  margin-left: 2px;
  overflow: hidden;
`;

export const Text = styled.div`
  pointer-events: none;
  position: absolute;
  top: 50%;
  transform: translateY(calc(-50%));
  flex: 1;
  color: inherit;
  margin-top: -1px;
  flex-wrap: nowrap;
  white-space: nowrap;
  overflow: hidden;
  font-size: 14px;
  ${({ visible }: { visible: boolean; theme: ITheme }) => css`
    display: ${visible ? 'flex' : 'none'};
  `};
`;

export const Input = styled.input`
  outline: none;
  min-width: 0;
  width: 100%;
  height: 100%;
  background-color: transparent;
  border: none;
  padding: 0;
  margin: 0;
  color: black;
  font-family: inherit;
  word-spacing: inherit;
  font-size: 14px;

  ${({ visible, theme }: { visible: boolean; theme: ITheme }) => css`
    color: ${visible ? 'inherit' : 'transparent'};

    &::placeholder {
      // 失焦态(visible=false)下由 <Text> 层负责显示网址,
      // 此时即使 DOM input.value 与 store 偶发不同步而落空,
      // 也不能让 placeholder 冒出来与网址重叠。
      color: ${visible
        ? theme['searchBox.lightForeground']
          ? 'rgba(255, 255, 255, 0.54)'
          : 'rgba(0, 0, 0, 0.54)'
        : 'transparent'};
    }

    ${theme['searchBox.lightForeground'] &&
    css`
      ::selection {
        background: rgba(145, 185, 230, 0.99);
        color: black;
        height: 100px;
      }
    `}
  `};
`;
