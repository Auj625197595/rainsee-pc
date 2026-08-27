import styled, { css } from 'styled-components';
import { transparency, BLUE_300, DEEP_BLUE_500 } from '~/renderer/constants';
import { ITheme } from '~/interfaces';
import { body2, centerIcon } from '~/renderer/mixins';

export const StyledSuggestion = styled.div`
  width: 100%;
  height: 38px;
  min-height: 38px;
  display: flex;
  position: relative;
  align-items: center;
  overflow: hidden;
  ${({
    selected,
    hovered,
    theme,
  }: {
    selected: boolean;
    hovered: boolean;
    theme?: ITheme;
  }) => {
    let backgroundColor = 'transparent';
    if (selected) {
      backgroundColor = theme['searchBox.lightForeground']
        ? 'rgba(255, 255, 255, 0.06)'
        : 'rgba(0, 0, 0, 0.06)';
    } else if (hovered) {
      backgroundColor = theme['searchBox.lightForeground']
        ? 'rgba(255, 255, 255, 0.03)'
        : 'rgba(0, 0, 0, 0.03)';
    }
    return css`
      background-color: ${backgroundColor};
    `;
  }};
`;

export const SuggestionText = styled.div`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
`;

export const PrimaryText = styled(SuggestionText)`
  opacity: ${transparency.text.high};
`;

export const RightText = styled(SuggestionText)`
  padding-right: 16px;
  flex: 1;
`;

export const Url = styled(RightText)`
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme['searchBox.lightForeground'] ? BLUE_300 : '#3297FD'};
  `}
`;

export const SecondaryText = styled(RightText)`
  opacity: ${transparency.text.medium};
`;

export const Icon = styled.div`
  margin-left: 11px;
  width: 16px;
  min-width: 16px;
  height: 16px;
  margin-right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  ${centerIcon()};
`;

export const Dash = styled.div`
  margin-left: 4px;
  margin-right: 4px;
  opacity: ${transparency.text.medium};
`;

// 标签页建议右侧的「跳转」按钮
export const JumpButton = styled.div`
  margin-left: auto;
  margin-right: 12px;
  display: flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 12px;
  font-size: 12px;
  white-space: nowrap;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme['searchBox.lightForeground'] ? BLUE_300 : '#3297FD'};
    border: 1px solid
      ${theme['searchBox.lightForeground']
        ? 'rgba(255, 255, 255, 0.24)'
        : 'rgba(0, 0, 0, 0.16)'};
    &:hover {
      background-color: ${theme['searchBox.lightForeground']
        ? 'rgba(255, 255, 255, 0.08)'
        : 'rgba(0, 0, 0, 0.06)'};
    }
  `}
`;

export const RemoveButton = styled.button`
  width: 28px;
  min-width: 28px;
  height: 28px;
  margin: 0 7px 0 auto;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 4px;
  color: inherit;
  background: transparent;
  opacity: ${transparency.icons.inactive};
  cursor: pointer;

  &:hover {
    opacity: ${transparency.icons.active};
    ${({ theme }: { theme?: ITheme }) => css`
      background-color: ${theme['searchBox.lightForeground']
        ? 'rgba(255, 255, 255, 0.1)'
        : 'rgba(0, 0, 0, 0.08)'};
    `}
  }
`;

// 剪贴板置顶项的「剪贴板」标识(位于文字前):实心蓝底白字,点击跳转地址栏设置页。
export const ClipboardTag = styled.div`
  display: flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  margin-right: 8px;
  border-radius: 10px;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
  color: #fff;
  background-color: ${DEEP_BLUE_500};
  &:hover {
    filter: brightness(0.9);
  }
`;

// JSON 剪贴板内容的 bejson 快捷入口。
export const BejsonTag = styled(ClipboardTag)`
  background-color: #1683ff;
`;
