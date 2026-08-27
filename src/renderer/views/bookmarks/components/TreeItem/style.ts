import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { getPalette } from '../../utils/palette';

export const StyledTreeItem = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 12px;
  cursor: pointer;
  transition: background-color 0.16s ease;

  ${({ theme, selected, dropHover }: { theme?: ITheme; selected: boolean; dropHover?: boolean }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${dropHover
        ? p.primarySoft
        : selected
          ? p.primarySoft
          : 'transparent'};
      box-shadow: ${dropHover
        ? `inset 0 0 0 2px ${p.primary}`
        : selected
          ? `inset 0 0 0 1px ${p.primary}26`
          : 'none'};

      &:hover {
        background-color: ${selected || dropHover ? p.primarySoft : p.surface};
      }
    `;
  }}
`;

export const IconBox = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  width: 32px;
  min-width: 32px;
  border-radius: 10px;
  transition: background-color 0.16s ease, color 0.16s ease;

  ${({ theme, selected }: { theme?: ITheme; selected: boolean }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${selected ? p.primary : p.surface};
      color: ${selected ? '#fff' : p.textSub};
      box-shadow: ${selected ? 'none' : `inset 0 0 0 1px ${p.line}`};
    `;
  }}
`;

export const Label = styled.div`
  flex: 1;
  min-width: 0;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ theme, selected }: { theme?: ITheme; selected: boolean }) => {
    const p = getPalette(theme);
    return css`
      font-weight: ${selected ? 700 : 500};
      color: ${selected ? p.primary : p.textMain};
    `;
  }}
`;

export const CountBadge = styled.div`
  font-size: 12px;

  ${({ theme, selected }: { theme?: ITheme; selected: boolean }) => {
    const p = getPalette(theme);
    return css`
      font-weight: ${selected ? 700 : 600};
      color: ${selected ? p.primary : p.textMute};
    `;
  }}
`;

export const DropIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  cursor: pointer;
  transition: transform 0.16s ease, opacity 0.16s ease;

  ${({ visible, expanded }: { visible: boolean; expanded: boolean }) => css`
    opacity: ${visible ? 0.6 : 0};
    pointer-events: ${visible ? 'auto' : 'none'};
    transform: ${expanded ? 'rotate(90deg)' : 'rotate(0deg)'};

    &:hover {
      opacity: ${visible ? 1 : 0};
    }
  `}
`;
