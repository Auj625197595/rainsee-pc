import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';
import { getPalette } from '~/renderer/views/bookmarks/utils/palette';

// 书签页 / 历史页右上角共享的「在新页面打开」勾选项。两页都套了同款
// ThemeProvider 且共用同一个 getPalette,故主题在此一处即打通。

export const Wrapper = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  border-radius: 11px;
  cursor: pointer;
  user-select: none;
  font-size: 12.5px;
  font-weight: 600;
  font-family: inherit;
  transition: background-color 0.16s ease, border-color 0.16s ease,
    color 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      border: 1px solid ${p.line};
      color: ${p.textSub};
      &:hover {
        color: ${p.textMain};
      }
    `;
  }}
`;

export const Box = styled.span`
  position: relative;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  transition: background-color 0.16s ease, border-color 0.16s ease;

  ${({ checked, theme }: { checked: boolean; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${checked ? p.primary : 'transparent'};
      border: 1.5px solid ${checked ? p.primary : p.textMute};
    `;
  }}
`;

export const Label = styled.span`
  white-space: nowrap;
`;
