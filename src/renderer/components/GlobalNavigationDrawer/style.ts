import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { getPalette } from '~/renderer/views/bookmarks/utils/palette';

// 全局图标导航栏：对齐视觉稿（rainpcsettle.html）最左侧 64px 快捷栏。
export const Rail = styled.div`
  width: 64px;
  min-width: 64px;
  height: 100vh;
  display: flex;
  flex-flow: column;
  align-items: center;
  justify-content: space-between;
  padding: 20px 10px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      border-right: 1px solid ${p.line};
    `;
  }}
`;

export const RailGroup = styled.div`
  display: flex;
  flex-flow: column;
  align-items: center;
  gap: 6px;
`;

export const RailItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease,
    transform 0.16s ease;

  &:active {
    transform: scale(0.97);
  }

  ${({ theme, selected }: { theme?: ITheme; selected?: boolean }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${selected ? p.primary : 'transparent'};
      color: ${selected ? '#fff' : p.textSub};
      box-shadow: ${selected ? '0 1px 2px rgba(20, 27, 45, 0.05)' : 'none'};

      &:hover {
        background-color: ${selected ? p.primary : p.surface};
        color: ${selected ? '#fff' : p.textMain};
      }
    `;
  }}
`;
