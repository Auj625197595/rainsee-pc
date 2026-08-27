import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { getPalette } from '../../utils/palette';

export const PickerWrap = styled.div`
  display: flex;
  flex-flow: column;
  gap: 10px;
`;

export const PickerToolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

export const SearchBox = styled.div`
  flex: 1;
  min-width: 0;
  height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-radius: 11px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      border: 1px solid ${p.line};
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

export const ToolbarBtn = styled.button`
  height: 32px;
  flex-shrink: 0;
  border: none;
  border-radius: 10px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.primarySoft};
      color: ${p.primary};
    `;
  }}
`;

export const TreeViewport = styled.div`
  max-height: 280px;
  min-height: 160px;
  overflow-y: auto;
  border-radius: 14px;
  padding: 6px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      border: 1px solid ${p.line};
    `;
  }}

  &::-webkit-scrollbar {
    width: 8px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(149, 163, 184, 0.34);
    border-radius: 999px;
  }
`;

export const TreeItemRow = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: ${({ depth }: { depth: number }) =>
    `8px 10px 8px ${10 + depth * 18}px`};
  border-radius: 11px;
  cursor: pointer;
  transition: background-color 0.15s ease;

  ${({ selected, disabled, theme }: { selected: boolean; disabled: boolean; depth: number; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${selected ? p.primarySoft : 'transparent'};
      opacity: ${disabled ? 0.4 : 1};
      pointer-events: ${disabled ? 'none' : 'auto'};

      &:hover {
        background-color: ${selected ? p.primarySoft : p.surface};
      }
    `;
  }}
`;

export const TreeToggle = styled.button`
  height: 18px;
  width: 18px;
  min-width: 18px;
  border: none;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  ${({ expanded, theme }: { expanded: boolean; theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
    transform: ${expanded ? 'rotate(90deg)' : 'rotate(0deg)'};
    transition: transform 0.15s ease;
  `}
`;

export const TreeToggleSpacer = styled.span`
  height: 18px;
  width: 18px;
  min-width: 18px;
`;

export const TreeIconBox = styled.span`
  height: 26px;
  width: 26px;
  min-width: 26px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  ${({ selected, theme }: { selected: boolean; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${selected ? p.primary : p.surface};
      color: ${selected ? '#fff' : p.textSub};
      box-shadow: ${selected ? 'none' : `inset 0 0 0 1px ${p.line}`};
    `;
  }}
`;

export const TreeLabel = styled.span`
  flex: 1;
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ selected, theme }: { selected: boolean; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      font-weight: ${selected ? 700 : 500};
      color: ${selected ? p.primary : p.textMain};
    `;
  }}
`;

export const TreeMeta = styled.span`
  flex-shrink: 0;
  font-size: 11px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const TreeCheck = styled.span`
  min-width: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  ${({ selected, theme }: { selected: boolean; theme?: ITheme }) => css`
    color: ${selected ? getPalette(theme).primary : 'transparent'};
  `}
`;

export const EmptyState = styled.div`
  padding: 24px 16px;
  text-align: center;
  font-size: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;
