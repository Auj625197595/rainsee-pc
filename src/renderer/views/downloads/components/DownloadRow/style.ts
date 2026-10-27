import styled, { css, keyframes } from 'styled-components';

import { ITheme } from '~/interfaces';
import { getPalette } from '~/renderer/views/bookmarks/utils/palette';

export const RowActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.16s ease;
`;

export const ActionBtn = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  width: 32px;
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease;

  ${({ theme, danger }: { theme?: ITheme; danger?: boolean }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMute};

      &:hover {
        background-color: ${danger ? `${p.danger}14` : p.bg};
        color: ${danger ? p.danger : p.textMain};
      }
    `;
  }}
`;

export const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 20px;
  transition: background-color 0.16s ease;

  &:hover ${RowActions} {
    opacity: 1;
  }

  ${({ theme, clickable }: { theme?: ITheme; clickable?: boolean }) => {
    const p = getPalette(theme);
    return css`
      cursor: ${clickable ? 'pointer' : 'default'};

      & + & {
        border-top: 1px solid ${p.line};
      }

      &:hover {
        background-color: ${p.bg};
      }
    `;
  }}
`;

export const IconBox = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  width: 40px;
  border-radius: 12px;
  flex-shrink: 0;

  ${({ theme, danger }: { theme?: ITheme; danger?: boolean }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${danger ? `${p.danger}1F` : p.primarySoft};
      color: ${danger ? p.danger : p.primary};
    `;
  }}
`;

export const RowText = styled.div`
  min-width: 0;
  flex: 1;
`;

export const Title = styled.div`
  font-size: 14.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  ${({ theme, missing }: { theme?: ITheme; missing?: boolean }) => css`
    color: ${getPalette(theme).textMain};
    ${missing &&
    css`
      text-decoration: line-through;
      opacity: 0.55;
    `}
  `}
`;

export const SubLine = styled.div`
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  white-space: nowrap;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const SubText = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;

  ${({ theme, tone }: { theme?: ITheme; tone?: 'accent' | 'danger' }) => {
    const p = getPalette(theme);
    if (tone === 'accent') return css`color: ${p.primary}; font-weight: 600;`;
    if (tone === 'danger') return css`color: ${p.danger}; font-weight: 600;`;
    return css``;
  }}
`;

export const Dot = styled.span`
  height: 3px;
  width: 3px;
  border-radius: 9999px;
  flex-shrink: 0;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${getPalette(theme).textMute};
  `}
`;

export const ProgressTrack = styled.div`
  margin-top: 8px;
  height: 6px;
  width: 100%;
  border-radius: 9999px;
  overflow: hidden;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.primarySoft};
    `;
  }}
`;

const stripes = keyframes`
  from { background-position: 1rem 0; }
  to { background-position: 0 0; }
`;

export const ProgressFill = styled.div`
  height: 100%;
  border-radius: 9999px;
  transition: width 0.2s ease;

  ${({ theme, animated }: { theme?: ITheme; animated?: boolean }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.primary};

      ${animated &&
      css`
        background-image: linear-gradient(
          45deg,
          rgba(255, 255, 255, 0.2) 25%,
          transparent 25%,
          transparent 50%,
          rgba(255, 255, 255, 0.2) 50%,
          rgba(255, 255, 255, 0.2) 75%,
          transparent 75%,
          transparent
        );
        background-size: 1rem 1rem;
        animation: ${stripes} 1s linear infinite;
      `}
    `;
  }}
`;
