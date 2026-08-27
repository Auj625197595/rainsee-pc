import styled, { css } from 'styled-components';

import { transparency, ICON_CLOSE, ICON_INCOGNITO } from '~/renderer/constants';
import { ITheme } from '~/interfaces';
import { centerIcon } from '~/renderer/mixins';
import { TAB_PINNED_WIDTH } from '../../constants';

interface CloseProps {
  visible: boolean;
  hoverOnly: boolean;
  $density: number;
  theme?: ITheme;
}

export const StyledClose = styled.div`
  height: 20px;
  min-width: 0;
  border-radius: 99999px;
  background-image: url('${ICON_CLOSE}');
  overflow: hidden;
  transition: 0.1s background-color, 0.1s width, 0.1s margin;
  z-index: 10;
  ${centerIcon(16)};

    ${({ visible, hoverOnly, $density, theme }: CloseProps) => css`
      width: ${visible && hoverOnly ? 0 : 20 * $density}px;
      margin-left: ${visible && hoverOnly ? 0 : 2 * $density}px;
      margin-right: ${visible && hoverOnly ? 0 : 6 * $density}px;
      opacity: ${visible && !hoverOnly ? transparency.icons.inactive : 0};
      display: ${visible ? 'block' : 'none'};
      pointer-events: ${visible && !hoverOnly ? 'auto' : 'none'};
      filter: ${theme['toolbar.lightForeground'] ? 'invert(100%)' : 'none'};

      ${hoverOnly &&
      visible &&
      css`
        div[data-rainsee-part='tab']:hover & {
          width: ${20 * $density}px;
          margin-left: ${2 * $density}px;
          margin-right: ${6 * $density}px;
          opacity: ${transparency.icons.inactive};
          pointer-events: auto;
        }
      `}
    `}

  &:hover {
    background-color: rgba(0, 0, 0, 0.1);
  }
`;

interface ActionProps {
  visible: boolean;
  icon: string;
  $density: number;
  theme?: ITheme;
}

export const StyledAction = styled.div`
  height: 20px;
  width: ${({$density}: ActionProps) => `${20 * $density}px`};
  margin-left: ${({$density}: ActionProps) => `${2 * $density}px`};
  border-radius: 2px;
  transition: 0.1s background-color;
  z-index: 10;
  ${centerIcon(16)};

  ${({ visible, theme, icon }: ActionProps) => css`
      opacity: ${visible ? transparency.icons.inactive : 0};
      display: ${visible ? 'block' : 'none'};
      filter: ${theme['toolbar.lightForeground'] ? 'invert(100%)' : 'none'};
      background-image: url('${icon}');
    `}

  &:hover {
    background-color: rgba(0, 0, 0, 0.1);
  }
`;

interface PinActionProps {
  visible: boolean;
  icon: string;
  theme?: ITheme;
}

export const StyledPinAction = styled.div`
  height: 12px;
  width: 12px;
  border-radius: 100%;
  transition: 0.1s background-color;
  z-index: 10;
  position: fixed;
  right: 8px;
  top: 8px;
  ${centerIcon(10)};

  ${({ visible, theme, icon }: PinActionProps) => css`
      display: ${visible ? 'block' : 'none'};
      background-color: ${
        theme['toolbar.lightForeground'] ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)'
      };
      background-image: url('${icon}');
    `}

  &:hover {
    filter: invert(100%);
  }
`;

interface TabProps {
  selected: boolean;
}

export const StyledTab = styled.div`
  position: absolute;
  height: 100%;
  width: 0;
  left: 0;
  will-change: width, transform;
  -webkit-app-region: no-drag;
  display: flex;
  backface-visibility: hidden;

  ${({ selected }: TabProps) => css`
    z-index: ${selected ? 2 : 1};
  `};
`;

interface TitleProps {
  isIcon: boolean;
  selected: boolean;
  $density: number;
  incognito?: boolean;
  theme?: ITheme;
}

export const StyledTitle = styled.div`
  font-size: 12px;
  overflow: hidden;
  text-overflow: clip;
  white-space: nowrap;
  transition: 0.2s margin-left;
  margin-left: 8px;
  min-width: 0;
  flex: 1;

  ${({ isIcon, selected, $density, incognito, theme }: TitleProps) => css`
    margin-left: ${12 * $density}px;
    color: ${incognito
      ? selected
        ? 'rgba(255, 255, 255, 0.98)'
        : 'rgba(255, 255, 255, 0.82)'
      : selected
      ? theme['tab.selected.textColor']
      : theme['tab.textColor']};
  `};
`;

export const StyledIcon = styled.div`
  height: 16px;
  min-width: 16px;
  transition: 0.2s opacity, 0.2s min-width;
  ${centerIcon()};
  ${({ isIconSet }: { isIconSet: boolean }) => css`
    min-width: ${isIconSet ? 0 : 16},
    opacity: ${isIconSet ? 0 : 1};
  `};
`;

export const StyledContent = styled.div<{$density: number}>`
  overflow: hidden;
  z-index: 2;
  align-items: center;
  display: flex;
  // 72px 时保留完整的内容内缩；继续压缩到约 36px 后归零，避免图标态仍
  // 留出明显的左侧空白。
  margin-left: ${({$density}) => `${Math.max(0, 20 * $density - 10)}px`};
  flex: 1;
`;

// 无痕标签页前的小图标,提示用户当前标签处于隐匿(无痕)模式。
export const StyledIncognitoIcon = styled.div<{$density: number}>`
  height: 16px;
  min-width: 16px;
  margin-right: ${({$density}) => `${6 * $density}px`};
  background-color: rgba(255, 255, 255, 0.92);
  -webkit-mask-image: url('${ICON_INCOGNITO}');
  mask-image: url('${ICON_INCOGNITO}');
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: 16px;
  mask-size: 16px;
`;

interface TabContainerProps {
  pinned: boolean;
  theme?: ITheme;
  hasTabGroup: boolean;
  selected?: boolean;
  incognito?: boolean;
  $density: number;
}

export const TabContainer = styled.div`
  position: relative;

  width: 100%;
  box-sizing: border-box;
  align-items: center;
  overflow: hidden;
  display: flex;
  height: 100%;
  backface-visibility: hidden;
  transition: 0.12s background-color, 0.12s box-shadow, 0.12s border-color;
  border-radius: 9999px;

  ${({ pinned, theme, hasTabGroup, selected, incognito, $density }: TabContainerProps) => css`
    max-width: ${pinned ? `${TAB_PINNED_WIDTH}px` : '100%'};
    padding-right: ${selected ? `${8 * $density}px` : 0};
    margin: ${theme.isCompact
      ? 'auto 0'
      : `${theme.tabMarginTop}px 0 ${4 * $density}px`};
    height: ${theme.isCompact ? theme.tabHeight : 34}px;
    border: 1px solid
      ${incognito
        ? selected
          ? 'rgba(155, 135, 245, 0.85)'
          : 'rgba(123, 104, 200, 0.45)'
        : selected
        ? theme['toolbar.lightForeground']
          ? 'rgba(102, 161, 255, 0.92)'
          : 'rgba(26, 115, 232, 0.92)'
        : 'transparent'};
    box-shadow: ${incognito
      ? selected
        ? '0 2px 8px rgba(76, 53, 158, 0.45)'
        : 'none'
      : selected && !theme['toolbar.lightForeground']
      ? '0 4px 12px rgba(26, 115, 232, 0.28), 0 1px 3px rgba(26, 115, 232, 0.2)'
      : selected
      ? '0 4px 12px rgba(26, 115, 232, 0.38), 0 1px 3px rgba(0, 0, 0, 0.26)'
      : 'none'};
  `};
`;
