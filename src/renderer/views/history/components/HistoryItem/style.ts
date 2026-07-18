import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { getPalette } from '~/renderer/views/bookmarks/utils/palette';
import { centerIcon } from '~/renderer/mixins';

export const RowRemove = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  width: 32px;
  border-radius: 10px;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.16s ease, background-color 0.16s ease, color 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMute};

      &:hover {
        background-color: ${p.bg};
        color: ${p.textMain};
      }
    `;
  }}
`;

export const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  cursor: pointer;
  transition: background-color 0.16s ease;

  &:hover ${RowRemove} {
    opacity: 1;
  }

  ${({ theme, selected }: { theme?: ITheme; selected?: boolean }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${selected ? p.primarySoft : 'transparent'};

      & + & {
        border-top: 1px solid ${p.line};
      }

      &:hover {
        background-color: ${selected ? p.primarySoft : p.bg};
      }
    `;
  }}
`;

export const IconBox = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  width: 36px;
  border-radius: 10px;
  flex-shrink: 0;
  overflow: hidden;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.primarySoft};
      color: ${p.primary};
    `;
  }}
`;

export const Favicon = styled.div`
  height: 20px;
  width: 20px;
  ${centerIcon()};
`;

export const RowText = styled.div`
  min-width: 0;
  flex: 1;
`;

export const Title = styled.a`
  display: block;
  font-size: 14.5px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}

  &:hover {
    text-decoration: underline;
  }
`;

export const Site = styled.div`
  margin-top: 1px;
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const Time = styled.div`
  flex-shrink: 0;
  font-size: 12.5px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;
