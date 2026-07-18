import styled, { css, keyframes } from 'styled-components';

import { ITheme } from '~/interfaces';

const appear = keyframes`
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
`;

export interface IActionAccent {
  color: string;
  surface: string;
  border: string;
  shadow: string;
}

export const DropOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 120;
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 6px 18px;
  box-sizing: border-box;
  overflow: hidden;
  isolation: isolate;
  -webkit-app-region: no-drag;
  backdrop-filter: blur(24px) saturate(165%);
  -webkit-backdrop-filter: blur(24px) saturate(165%);
  animation: ${appear} 160ms cubic-bezier(0.22, 1, 0.36, 1);

  &::before {
    content: '';
    position: absolute;
    z-index: -1;
    inset: 0 0 auto;
    height: 3px;
    background: linear-gradient(
      90deg,
      #38bdf8 0%,
      #6366f1 25%,
      #ec4899 50%,
      #f59e0b 75%,
      #22c55e 100%
    );
  }

  &::after {
    content: '';
    position: absolute;
    z-index: -2;
    inset: 0;
    background: linear-gradient(
      115deg,
      rgba(56, 189, 248, 0.09),
      transparent 34%,
      rgba(236, 72, 153, 0.06) 67%,
      rgba(34, 197, 94, 0.08)
    );
  }

  ${({ theme }: { theme: ITheme }) => css`
    color: ${theme['toolbar.lightForeground']
      ? '#ffffff'
      : theme['addressbar.textColor']};
    background: ${theme['toolbar.lightForeground']
      ? 'rgba(15, 20, 35, 0.78)'
      : 'rgba(248, 251, 255, 0.78)'};
    border-bottom: 1px solid
      ${theme['toolbar.lightForeground']
        ? 'rgba(255, 255, 255, 0.14)'
        : 'rgba(88, 104, 145, 0.18)'};
    box-shadow: inset 0 -1px 0 ${theme['toolbar.lightForeground'] ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.72)'},
      0 14px 32px rgba(20, 32, 72, 0.14);
  `}
`;

export const FileSummary = styled.div`
  min-width: 0;
  max-width: 220px;
  flex: 0 1 220px;
  padding: 4px 18px 4px 0;
  border-right: 1px solid rgba(127, 127, 127, 0.22);

  @media (max-width: 760px) {
    display: none;
  }
`;

export const FileType = styled.div`
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  color: #0891b2;
`;

export const FileName = styled.div`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 18px;
  font-weight: 650;
`;

export const ActionList = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  max-width: min(580px, calc(100vw - 36px));
`;

export const ActionButton = styled.button<{
  $active: boolean;
  $accent: IActionAccent;
}>`
  width: 92px;
  height: 52px;
  flex: 0 1 92px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: 1px solid ${({ $accent }) => $accent.border};
  border-radius: 8px;
  padding: 0 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: ${({ $accent }) => $accent.color};
  background: ${({ $accent }) => $accent.surface};
  cursor: pointer;
  transform: translateY(${({ $active }) => ($active ? '-3px' : '0')});
  transition: transform 120ms ease, background 120ms ease,
    border-color 120ms ease, box-shadow 120ms ease, color 120ms ease;

  ${({ $active, $accent }) =>
    $active &&
    css`
      color: #ffffff;
      background: ${$accent.color};
      border-color: rgba(255, 255, 255, 0.32);
      box-shadow: 0 8px 20px ${$accent.shadow},
        inset 0 1px 0 rgba(255, 255, 255, 0.28);
    `}

  &:disabled {
    cursor: not-allowed;
    opacity: 0.42;
    transform: none;
    box-shadow: none;
  }

  svg {
    flex: 0 0 auto;
  }

  span {
    white-space: nowrap;
  }

  @media (max-width: 620px) {
    width: 76px;
    flex-basis: 76px;
    padding: 0 2px;
    font-size: 11px;
  }
`;
