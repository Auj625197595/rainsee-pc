import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';

export const Buttons = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  margin-right: 4px;
  flex-shrink: 0;
  -webkit-app-region: no-drag;

  .right-action {
    flex-shrink: 0;
  }

  @media (max-width: 850px) {
    .right-action--extension {
      display: none;
    }
  }

  @media (max-width: 825px) {
    .right-action--ai {
      display: none;
    }
  }

  @media (max-width: 800px) {
    .right-action--subscribe {
      display: none;
    }
  }

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme['toolbar.lightForeground'] ? '#fff' : 'rgb(117 128 154)'};
  `};
`;

export const Separator = styled.div`
  height: 16px;
  width: 1px;
  margin-left: 4px;
  margin-right: 4px;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${theme['toolbar.separator.color']};
  `};
`;

// 「雨见 AI」胶囊按钮:蓝底白字 + 星形图标。
export const AiPill = styled.div`
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 12px 0 10px;
  margin: 0 6px;
  border-radius: 14px;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  -webkit-app-region: no-drag;
  background-color: #4f5bd5;
  transition: background-color 0.15s ease, filter 0.15s ease;

  &:hover {
    filter: brightness(1.07);
  }

  &:active {
    filter: brightness(0.93);
  }

  svg {
    margin-right: 5px;
  }

  ${({ toggled }: { toggled?: boolean }) =>
    toggled &&
    css`
      background-color: #3a45b8;
    `};
`;
