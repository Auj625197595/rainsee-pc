import styled, { css, keyframes } from 'styled-components';

import { ITheme } from '~/interfaces';
import { getPalette } from '~/renderer/views/bookmarks/utils/palette';

export const Section = styled.div`
  margin-top: 28px;

  &:first-child {
    margin-top: 0;
  }
`;

export const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
`;

export const SectionTitle = styled.h2`
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;

  ${({ theme, accent }: { theme?: ITheme; accent?: boolean }) => {
    const p = getPalette(theme);
    return css`
      color: ${accent ? p.primary : p.textMain};
    `;
  }}
`;

const pulse = keyframes`
  0% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
  100% { opacity: 1; transform: scale(1); }
`;

export const PulseDot = styled.span`
  display: inline-block;
  height: 8px;
  width: 8px;
  border-radius: 9999px;
  animation: ${pulse} 1.4s ease-in-out infinite;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${getPalette(theme).primary};
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
  margin-top: 16px;
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
