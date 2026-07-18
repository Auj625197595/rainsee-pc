import styled, { css } from 'styled-components';
import { centerIcon } from '~/renderer/mixins';
import { ICON_DROPDOWN } from '~/renderer/constants';
import { ITheme } from '~/interfaces';
import { getPalette } from '../../../utils/palette';

export const StyledSection = styled.div`
  width: 100%;
  margin-top: 10px;
`;

export const Header = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
  padding: 15px 18px;
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

export const Icon = styled.div`
  width: 32px;
  height: 32px;
  min-width: 32px;
  border-radius: 10px;
  background-size: 18px;
  background-position: center;
  background-repeat: no-repeat;

  ${({ icon, theme }: { icon: string; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-image: url(${icon});
      background-color: ${p.primarySoft};
      filter: ${theme['pages.lightForeground'] ? 'invert(100%)' : 'none'};
    `;
  }};
`;

export const Label = styled.div`
  margin-left: 14px;
  font-size: 15px;
  font-weight: 700;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const DropIcon = styled.div`
  width: 20px;
  height: 20px;
  background-image: url(${ICON_DROPDOWN});
  opacity: 0.55;
  margin-left: auto;
  ${centerIcon('contain')};
  transition: transform 0.2s ease;

  ${({ expanded, theme }: { expanded: boolean; theme?: ITheme }) => css`
    transform: ${expanded ? 'rotate(180deg)' : 'rotate(0deg)'};
    filter: ${theme['pages.lightForeground'] ? 'invert(100%)' : 'none'};
  `}
`;

export const Container = styled.div`
  width: 100%;
  margin-top: 10px;
  padding: 20px;
  border-radius: 16px;

  ${({ expanded, theme }: { expanded: boolean; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      display: ${expanded ? 'block' : 'none'};
      background-color: ${p.bg};
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }};
`;
