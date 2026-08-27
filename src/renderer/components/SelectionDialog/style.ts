import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';

const RIGHT_EDGE_OFFSET = 1024 + 320 + 64 - 16;
const NARROW_BREAK = 1024 + 320 + 64 + 64 + 16;

export const StyledSmallDialog = styled.div`
  width: fit-content;
  position: fixed;
  left: ${RIGHT_EDGE_OFFSET}px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border-radius: 18px;
  border: 1px solid transparent;
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  box-shadow:
    0 1px 4px rgba(20, 32, 72, 0.05),
    0 4px 12px rgba(20, 32, 72, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
  /* translateX(-100%) 用于把右边沿锚定到 left 处,不要拿来做显隐动画 */
  transform: translateX(-100%);
  transition: opacity 0.18s ease, top 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
  z-index: 999;
  will-change: opacity, top;

  @media all and (max-width: ${NARROW_BREAK}px) {
    left: auto;
    right: ${64 + 16 + 16}px;
    transform: translateX(0);
  }

  ${({ visible, theme }: { visible: boolean; theme?: ITheme }) => css`
    top: ${visible ? '16px' : '4px'};
    opacity: ${visible ? 1 : 0};
    pointer-events: ${visible ? 'inherit' : 'none'};
    background-color: ${theme.dark
      ? 'rgba(40, 42, 48, 0.78)'
      : 'rgba(255, 255, 255, 0.78)'};
    border-color: ${theme.dark
      ? 'rgba(255, 255, 255, 0.10)'
      : 'rgba(255, 255, 255, 0.55)'};
    color: ${theme.dark ? '#fff' : '#161b2d'};
  `};
`;

export const Label = styled.div`
  font-size: 12.5px;
  font-weight: 700;
  padding: 0 6px 0 8px;
  white-space: nowrap;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.dark ? 'rgba(255,255,255,0.6)' : '#75809a'};

    b {
      font-weight: 800;
      color: ${theme.dark ? '#fff' : '#161b2d'};
    }
  `};
`;

export const ActionButton = styled.div`
  height: 34px;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  font-size: 12.5px;
  font-weight: 800;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: background-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;

  &:active {
    opacity: 0.85;
  }

  ${({ variant, theme }: { variant: 'danger' | 'ghost' | 'primary'; theme?: ITheme }) => css`
    ${variant === 'danger'
      ? css`
          color: #e14b57;
          background-color: ${theme.dark
            ? 'rgba(255, 96, 109, 0.18)'
            : 'rgba(255, 96, 109, 0.12)'};

          &:hover {
            background-color: ${theme.dark
              ? 'rgba(255, 96, 109, 0.26)'
              : 'rgba(255, 96, 109, 0.18)'};
          }
        `
      : variant === 'primary'
        ? css`
            color: #fff;
            background-color: ${theme.dark ? '#5b72ff' : '#3452ff'};

            &:hover {
              background-color: ${theme.dark ? '#6b80ff' : '#2640e6'};
            }
          `
        : css`
            color: ${theme.dark ? 'rgba(255,255,255,0.82)' : '#5f6679'};
            background-color: ${theme.dark
              ? 'rgba(255,255,255,0.08)'
              : '#f2f4f8'};

            &:hover {
              background-color: ${theme.dark
                ? 'rgba(255,255,255,0.14)'
                : '#e9edf3'};
            }
          `}
  `};
`;
