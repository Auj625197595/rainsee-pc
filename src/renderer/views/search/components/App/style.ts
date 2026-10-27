import styled, { css } from 'styled-components';
import { centerIcon, body2 } from '~/renderer/mixins';
import { ITheme } from '~/interfaces';
import { DialogStyle } from '~/renderer/mixins/dialogs';
import { TOOLBAR_HEIGHT } from '~/constants/design';

export const StyledApp = styled(DialogStyle)<{ $immersive?: boolean }>`
  transition: none;
  padding-bottom: 4px;
  // 搜索框展开后仍复用地址栏的上边缘,顶部圆角与 AddressBar 的 14px 对齐;
  // 底部保留弹窗的 26px 圆角,让联想列表自然收束。
  border-radius: 14px 14px 26px 26px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);

  ${({ theme }: { theme?: ITheme }) => css`
    box-shadow: ${theme.dark
      ? 'inset 0 1px 0 rgba(255, 255, 255, 0.04)'
      : `0 1px 4px rgba(20, 32, 72, 0.05),
         0 4px 12px rgba(20, 32, 72, 0.06),
         inset 0 1px 0 rgba(255, 255, 255, 0.7)`};
    background-color: ${theme.dark
      ? 'rgba(15, 18, 24, 0.88)'
      : 'rgba(255, 255, 255, 0.72)'};
    color: ${theme['dialog.textColor']};
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
  box-sizing: border-box;
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

export const InputArea = styled.div`
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
`;

export const InlineCompletion = styled.div`
  position: absolute;
  z-index: 1;
  inset: 0;
  display: flex;
  align-items: center;
  overflow: hidden;
  padding: 1px 8px 0 12px;
  box-sizing: border-box;
  pointer-events: none;
  white-space: pre;
  font-family: inherit;
  font-size: 14px;
`;

export const InlineCompletionPrefix = styled.span`
  visibility: hidden;
  flex-shrink: 0;
`;

export const InlineCompletionSuffix = styled.span`
  flex-shrink: 0;
  color: HighlightText;
  background-color: Highlight;
`;

export const CurrentIcon = styled.button`
  width: 16px;
  height: 16px;
  min-width: 16px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background-color: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  ${centerIcon()};
  margin-left: 11px;
  cursor: pointer;

  &:hover {
    background-color: ${({ theme }: { theme: ITheme }) =>
      theme['searchBox.lightForeground']
        ? 'rgba(255, 255, 255, 0.14)'
        : 'rgba(52, 82, 255, 0.12)'};
  }
`;

export const SearchBox = styled.div<{ $immersive?: boolean }>`
  display: flex;
  align-items: center;

  ${({ theme }: { theme?: any }) => css`
    height: ${theme.searchBoxHeight}px;
  `}

  ${({ $immersive }) =>
    $immersive &&
    css`
      position: absolute;
      left: 0;
      top: 0;
      width: 1px;
      height: 1px !important;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
    `}
`;

export const SearchEnginePicker = styled.div<{ $height: number }>`
  height: ${({ $height }) => $height}px;
  max-height: 224px;
  margin: 0 8px 4px;
  overflow-y: auto;
  border: 1px solid
    ${({ theme }: { theme: ITheme }) =>
      theme['searchBox.lightForeground']
        ? 'rgba(255, 255, 255, 0.18)'
        : 'rgba(0, 0, 0, 0.12)'};
  border-radius: 6px;
  background-color: ${({ theme }: { theme: ITheme }) =>
    theme['searchBox.lightForeground']
      ? 'rgba(255, 255, 255, 0.08)'
      : 'rgba(255, 255, 255, 0.7)'};
`;

export const SearchEngineOption = styled.button<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: none;
  background-color: ${({
    $selected,
    theme,
  }: {
    $selected: boolean;
    theme: ITheme;
  }) =>
    $selected
      ? theme['searchBox.lightForeground']
        ? 'rgba(255, 255, 255, 0.14)'
        : 'rgba(52, 82, 255, 0.12)'
      : 'transparent'};
  color: inherit;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  text-align: left;

  &:hover {
    background-color: ${({ theme }: { theme: ITheme }) =>
      theme['searchBox.lightForeground']
        ? 'rgba(255, 255, 255, 0.16)'
        : 'rgba(52, 82, 255, 0.14)'};
  }
`;

export const SearchEngineOptionIcon = styled.div`
  width: 16px;
  height: 16px;
  margin-right: 10px;
  flex-shrink: 0;
  background-position: center;
  background-repeat: no-repeat;
  background-size: contain;
`;

export const SearchEngineOptionName = styled.div`
  overflow: hidden;
  flex: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const SearchEngineOptionCheck = styled.div`
  margin-left: 8px;
  opacity: 0.72;
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

// 快捷字词模式:输入框前的引擎胶囊(「字词 + 空格」临时切换引擎)。
export const ShortcutChip = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  max-width: 160px;
  height: 22px;
  margin-left: 8px;
  padding: 0 8px 0 6px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  ${({ theme }: { theme?: any }) => css`
    color: ${theme['searchBox.lightForeground'] ? '#dbe3ff' : '#2b4fc7'};
    background: ${theme['searchBox.lightForeground']
      ? 'rgba(120, 150, 255, 0.22)'
      : 'rgba(74, 123, 255, 0.12)'};
  `}
`;

export const ShortcutChipIcon = styled.span`
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border-radius: 3px;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
`;

export const ShortcutChipName = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
`;

// 输入恰为某快捷字词时的右侧提示:「按 空格 用 xx 搜索」。
export const ShortcutHint = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-right: 10px;
  font-size: 12px;
  white-space: nowrap;

  kbd {
    font-family: inherit;
    font-size: 11px;
    padding: 0 5px;
    line-height: 16px;
    border-radius: 4px;
  }

  ${({ theme }: { theme?: any }) => css`
    color: ${theme['searchBox.lightForeground']
      ? 'rgba(255, 255, 255, 0.6)'
      : 'rgba(0, 0, 0, 0.55)'};

    kbd {
      border: 1px solid
        ${theme['searchBox.lightForeground']
          ? 'rgba(255, 255, 255, 0.3)'
          : 'rgba(0, 0, 0, 0.2)'};
    }
  `}
`;
