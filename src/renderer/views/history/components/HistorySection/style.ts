import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { getPalette } from '~/renderer/views/bookmarks/utils/palette';

export const Section = styled.div`
  margin-top: 28px;

  &:first-child {
    margin-top: 0;
  }
`;

export const DateHeader = styled.div`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
`;

export const DateTitle = styled.h2`
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const DateSub = styled.p`
  margin: 4px 0 0;
  font-size: 13px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const CountPill = styled.span`
  flex-shrink: 0;
  border-radius: 9999px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      color: ${p.textSub};
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}
`;

export const ListCard = styled.div`
  margin-top: 20px;
  border-radius: 18px;
  overflow: hidden;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line},
        0 1px 2px rgba(20, 27, 45, 0.04),
        0 10px 30px -22px rgba(40, 60, 120, 0.3);
    `;
  }}
`;
