import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';

export const TopGlow = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 64px;
  pointer-events: none;
  background: linear-gradient(180deg, #eef5ff 0%, transparent 100%);

  ${({ theme }: { theme?: ITheme }) =>
    theme.dark &&
    css`
      background: linear-gradient(
        180deg,
        rgba(110, 130, 200, 0.18) 0%,
        transparent 100%
      );
    `}
`;

export const Content = styled.div`
  position: relative;
  display: flex;
  flex-flow: column;
  min-height: 0;
  flex: 1;
  padding: 16px;
  box-sizing: border-box;
`;

export const Header = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
`;

export const Badge = styled.div`
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background-color: #ecf4ff;
  padding: 4px 10px;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #5a7ed6;

  ${({ theme }: { theme?: ITheme }) =>
    theme.dark &&
    css`
      background-color: rgba(90, 126, 214, 0.18);
      color: #9db8ee;
    `}
`;

export const Heading = styled.h3`
  margin: 6px 0 0;
  font-size: 20px;
  font-weight: 900;
  letter-spacing: -0.02em;
`;

export const Subtitle = styled.p`
  margin: 3px 0 0;
  font-size: 12px;
  font-weight: 700;
  opacity: 0.56;
`;

export const HeaderActions = styled.div`
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
`;

export const MoreButton = styled.button`
  height: 32px;
  padding: 0 11px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  background-color: transparent;
  color: #5a7ed6;
  font-size: 12px;
  font-weight: 800;
  transition: 0.15s color, 0.15s background-color, 0.15s transform;

  &:hover {
    color: #3452ff;
    background-color: rgba(90, 126, 214, 0.1);
  }

  &:active {
    transform: scale(0.96);
  }

  ${({ theme }: { theme?: ITheme }) =>
    theme.dark &&
    css`
      color: #9db8ee;

      &:hover {
        color: #c5d4ff;
        background-color: rgba(157, 184, 238, 0.12);
      }
    `}
`;

export const CloseButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: none;
  cursor: pointer;
  border-radius: 12px;
  color: #72809b;
  background-color: rgba(255, 255, 255, 0.88);
  box-shadow: 0 4px 12px rgba(20, 32, 72, 0.05);
  transition: 0.15s color, 0.15s transform;

  &:hover {
    color: #161b2d;
  }

  &:active {
    transform: scale(0.94);
  }

  svg {
    width: 13px;
    height: 13px;
  }

  ${({ theme }: { theme?: ITheme }) =>
    theme.dark &&
    css`
      color: rgba(255, 255, 255, 0.62);
      background-color: rgba(255, 255, 255, 0.08);

      &:hover {
        color: #fff;
      }
    `}
`;

export const ListCard = styled.div`
  margin-top: 12px;
  padding: 0;
  min-height: 0;
  flex: 1;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    background-color: rgba(20, 32, 72, 0.16);
    border-radius: 999px;
  }

  ${({ menuOpen }: { theme?: ITheme; menuOpen?: boolean }) => css`
    overflow-y: ${menuOpen ? 'visible' : 'auto'};
    overflow-x: visible;
  `}

  ${({ theme }: { theme?: ITheme; menuOpen?: boolean }) =>
    theme.dark &&
    css`
      &::-webkit-scrollbar-thumb {
        background-color: rgba(255, 255, 255, 0.18);
      }
    `}
`;

export const Empty = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 22px 0;
  font-size: 13px;
  font-weight: 700;
  opacity: 0.5;
`;
