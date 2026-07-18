import styled, { css } from 'styled-components';
import { centerIcon, body2 } from '~/renderer/mixins';
import { ITheme } from '~/interfaces';
import { DialogStyle } from '~/renderer/mixins/dialogs';
import { TOOLBAR_HEIGHT } from '~/constants/design';

export const StyledApp = styled(DialogStyle)`
  transition: none;
  padding-bottom: 4px;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${theme['searchBox.backgroundColor']};
    color: ${theme['searchBox.lightForeground']
      ? 'rgba(255, 255, 255, 0.87)'
      : 'black'};
  `}
`;

export const Title = styled.div`
  font-size: 16px;
`;

export const Subtitle = styled.div`
  font-size: 13px;
  opacity: 0.54;
  margin-top: 8px;
`;

export const Buttons = styled.div`
  display: flex;
  margin-top: 16px;
  float: right;
`;

export const Input = styled.input.attrs(() => ({
  spellCheck: false,
}))`
  outline: none;
  border: none;
  width: 100%;
  height: 100%;
  font-family: inherit;
  font-size: 14px;
  padding-left: 12px;
  padding-right: 8px;
  padding-top: 1px;
  background-color: transparent;
  color: inherit;

  ${({ theme }: { theme?: ITheme }) => css`
    &::placeholder {
      color: ${theme['searchBox.lightForeground']
        ? 'rgba(255, 255, 255, 0.54)'
        : 'rgba(0, 0, 0, 0.54)'};
    }
  `}
`;

export const CurrentIcon = styled.div`
  width: 16px;
  height: 16px;
  min-width: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  ${centerIcon()};
  margin-left: 11px;
`;

export const SearchBox = styled.div`
  display: flex;
  align-items: center;

  ${({ theme }: { theme?: any }) => css`
    height: ${theme.searchBoxHeight}px;
  `}
`;

// 「新标签页搜索」模式下, 置于搜索框右上角的小巧标注胶囊:提醒本次结果将在新标签页打开。
// 作为 SearchBox 内的 flex 末项, flex-shrink:0 让输入框自动让位, 始终贴在右上角。
export const NewTabHint = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  height: 20px;
  margin-right: 8px;
  padding: 0 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;
  white-space: nowrap;

  svg {
    flex-shrink: 0;
  }

  ${({ theme }: { theme?: any }) => css`
    color: ${theme['searchBox.lightForeground'] ? '#aebfff' : '#3d6ae8'};
    background: ${theme['searchBox.lightForeground']
      ? 'rgba(120, 150, 255, 0.16)'
      : 'rgba(74, 123, 255, 0.10)'};
    border: 1px solid
      ${theme['searchBox.lightForeground']
        ? 'rgba(120, 150, 255, 0.30)'
        : 'rgba(74, 123, 255, 0.22)'};
  `}
`;
