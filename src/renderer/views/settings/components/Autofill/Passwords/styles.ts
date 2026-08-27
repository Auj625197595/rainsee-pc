import styled, { css } from 'styled-components';

import {
  transparency,
  ICON_TRASH,
} from '~/renderer/constants';
import { centerIcon } from '~/renderer/mixins';
import { ITheme } from '~/interfaces';
import { getPalette } from '../../../utils/palette';

export const CardHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
`;

export const HeaderTitle = styled.div`
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const HeaderMeta = styled.div`
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const SearchBox = styled.div`
  min-width: 260px;
  height: 42px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px 0 14px;
  border-radius: 14px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      border: 1px solid ${p.line};
      box-shadow: 0 10px 24px -20px rgba(52, 82, 255, 0.5);
    `;
  }}
`;

export const SearchInput = styled.input`
  width: 100%;
  height: 100%;
  border: 0;
  outline: none;
  font-size: 13px;
  font-family: inherit;
  background: transparent;
  user-select: text;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};

    &::placeholder {
      color: ${getPalette(theme).textMute};
    }
  `}
`;

export const SearchClear = styled.button`
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: opacity 0.16s ease, transform 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.primary};
      background-color: ${p.primarySoft};
    `;
  }}

  &:hover {
    opacity: 0.92;
    transform: translateY(-1px);
  }
`;

export const Container = styled.div`
  width: 100%;
  display: grid;
  grid-template-columns: minmax(260px, 1.4fr) minmax(180px, 1fr) minmax(180px, 1fr);
  gap: 12px 18px;
  padding: 18px 0 0;
`;

export const HeaderLabel = styled.div<{ $align?: 'start' | 'end' }>`
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;

  ${({ $align, theme }: { $align?: 'start' | 'end'; theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
    text-align: ${$align === 'end' ? 'right' : 'left'};
  `}
`;

export const Row = styled.div`
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: minmax(260px, 1.4fr) minmax(180px, 1fr) minmax(180px, 1fr);
  gap: 18px;
  align-items: center;
  min-height: 72px;
  padding: 16px 18px;
  border-radius: 16px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      border: 1px solid ${p.line};
      transition: transform 0.16s ease, box-shadow 0.16s ease,
        border-color 0.16s ease;

      &:hover {
        transform: translateY(-1px);
        border-color: ${p.primary}33;
        box-shadow: 0 18px 34px -30px rgba(52, 82, 255, 0.5);
      }
    `;
  }}
`;

export const ValueCell = styled.div<{ $align?: 'start' | 'end' }>`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;

  ${({ $align }: { $align?: 'start' | 'end' }) => css`
    justify-content: ${$align === 'end' ? 'flex-end' : 'flex-start'};
  `}
`;

export const Favicon = styled.div`
  width: 38px;
  height: 38px;
  padding: 6px;
  border-radius: 12px;
  flex-shrink: 0;
  overflow: hidden;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      border: 1px solid ${p.line};
    `;
  }}

  img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
  }
`;

export const FaviconFallback = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  text-transform: uppercase;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.primary};
      background-color: ${p.primarySoft};
    `;
  }}
`;

export const SiteText = styled.div`
  min-width: 0;
  display: flex;
  flex-flow: column;
  gap: 0;
`;

export const SiteMain = styled.div`
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const UserMain = styled.div`
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const TextValue = styled.div`
  max-width: 100%;
  font-size: 13px;
  letter-spacing: 0.04em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const DeleteButton = styled.div`
  width: 24px;
  height: 24px;
  margin-left: 14px;
  opacity: 0.9;
  background-image: url(${ICON_TRASH});
  cursor: pointer;
  transition: 0.16s opacity ease, 0.16s transform ease;
  ${centerIcon(20)};

  &:hover {
    opacity: 1;
    transform: scale(1.06);
  }

  ${({ theme }: { theme: ITheme }) => css`
    filter: ${theme.dark
      ? 'invert(42%) sepia(80%) saturate(1255%) hue-rotate(319deg) brightness(104%) contrast(101%)'
      : 'invert(33%) sepia(93%) saturate(1532%) hue-rotate(328deg) brightness(101%) contrast(96%)'};
  `};
`;

export const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
`;

export const CloudButton = styled.button<{ $variant?: 'primary' }>`
  height: 36px;
  padding: 0 18px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: transform 0.16s ease, box-shadow 0.16s ease,
    background-color 0.16s ease, border-color 0.16s ease;

  ${({ $variant, theme }: { $variant?: 'primary'; theme?: ITheme }) => {
    const p = getPalette(theme);

    if ($variant === 'primary') {
      return css`
        color: #ffffff;
        background-color: ${p.primary};
        border: 1px solid ${p.primary};
        box-shadow: 0 12px 26px -18px rgba(52, 82, 255, 0.7);
      `;
    }

    return css`
      color: ${p.primary};
      background-color: ${p.surface};
      border: 1px solid ${p.line};
    `;
  }}

  &:hover {
    transform: translateY(-1px);
    box-shadow: 0 16px 30px -20px rgba(52, 82, 255, 0.6);
  }

  &:active {
    transform: translateY(0);
  }
`;

export const StatusText = styled.div`
  font-size: 12px;
  margin-left: 6px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const EmptyState = styled.div`
  grid-column: 1 / -1;
  padding: 32px 18px;
  border-radius: 16px;
  text-align: center;
  font-size: 14px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      background-color: ${p.surface};
      border: 1px dashed ${p.line};
    `;
  }}
`;

export const EmptyStateSub = styled.div`
  margin-top: 6px;
  font-size: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;
