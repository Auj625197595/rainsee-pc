import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';

// 内容区与列表都用 flex: 0 1 auto:高度按内容自适应,超过 max-height 时由列表收缩并滚动。
export const Content = styled.div`
  display: flex;
  flex-flow: column;
  flex: 0 1 auto;
  min-height: 0;
  box-sizing: border-box;
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 48px;
  padding: 0 8px 0 16px;
  flex-shrink: 0;
  transition: 0.15s box-shadow;

  /* 列表滚动后才出现分隔线,未滚动时头部与列表融为一体。 */
  ${({ theme, scrolled }: { theme?: ITheme; scrolled?: boolean }) =>
    scrolled &&
    css`
      box-shadow: 0 1px 0
        ${theme.dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.07)'};
    `}
`;

export const HeaderText = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
`;

export const Heading = styled.h3`
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
`;

export const Subtitle = styled.span`
  font-size: 12px;
  font-weight: 400;
  opacity: 0.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
`;

const buttonBase = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  background-color: transparent;
  color: inherit;
  transition: 0.12s background-color, 0.12s opacity;

  &:disabled {
    cursor: default;
    opacity: 0.25 !important;
    background-color: transparent !important;
  }

  &:focus-visible {
    outline: 2px solid #4f7cff;
    outline-offset: 1px;
  }

  ${({ theme }: { theme?: ITheme }) => css`
    &:hover {
      background-color: ${theme.dark
        ? 'rgba(255, 255, 255, 0.08)'
        : 'rgba(15, 23, 42, 0.05)'};
    }
  `}
`;

export const TextButton = styled.button`
  ${buttonBase};
  padding: 0 10px;
  font-size: 12.5px;
  font-weight: 500;
  opacity: 0.72;

  &:hover {
    opacity: 1;
  }
`;

export const IconButton = styled.button`
  ${buttonBase};
  width: 28px;
  padding: 0;
  opacity: 0.55;

  &:hover {
    opacity: 1;
  }

  svg {
    width: 15px;
    height: 15px;
  }
`;

export const ListCard = styled.div`
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 6px 6px;

  /* 细滚动条,平时透明,悬停列表时才显现。 */
  &::-webkit-scrollbar {
    width: 10px;
  }

  &::-webkit-scrollbar-thumb {
    border: 3px solid transparent;
    background-clip: padding-box;
    border-radius: 999px;
    background-color: transparent;
  }

  ${({ theme }: { theme?: ITheme }) => css`
    &:hover::-webkit-scrollbar-thumb {
      background-color: ${theme.dark
        ? 'rgba(255, 255, 255, 0.2)'
        : 'rgba(15, 23, 42, 0.18)'};
    }
  `}
`;

export const Empty = styled.div`
  display: flex;
  flex-flow: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px 0 28px;
  font-size: 12.5px;
  opacity: 0.45;

  svg {
    width: 28px;
    height: 28px;
  }
`;
