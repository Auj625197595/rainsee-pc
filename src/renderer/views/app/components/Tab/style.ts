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
  height: 16px;
  width: 16px;
  border-radius: 50%;
  box-sizing: border-box;
  transition: 0.12s background-color, 0.12s box-shadow, 0.12s transform;
  z-index: 10;
  position: fixed;
  right: 6px;
  top: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  ${({ visible, theme, icon }: PinActionProps) => css`
      display: ${visible ? 'flex' : 'none'};
      /* Keep the glyph and its circular hit target contrasting in either theme. */
      background-color: ${theme['toolbar.lightForeground']
        ? 'rgba(255, 255, 255, 0.94)'
        : 'rgba(255, 255, 255, 0.96)'};
      border: 1px solid ${theme['toolbar.lightForeground']
        ? 'rgba(0, 0, 0, 0.28)'
        : 'rgba(0, 0, 0, 0.18)'};
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);

      &::after {
        content: '';
        width: 10px;
        height: 10px;
        background-color: #182033;
        -webkit-mask-image: url('${icon}');
        mask-image: url('${icon}');
        -webkit-mask-position: center;
        mask-position: center;
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
        -webkit-mask-size: contain;
        mask-size: contain;
      }
    `}

  &:hover {
    transform: scale(1.08);
    background-color: #ffffff;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.36);
  }
`;

interface TabProps {
  selected: boolean;
  $row: number;
}

// 第 0 行标签的顶部偏移:在单行高度(titlebarBaseHeight)内垂直居中,与品牌块/工具箱/
// 窗口控制同一中线;第 1 行起按 row * pitch 向下叠加(transform 驱动),视为额外的标签栏。
// 标签/芯片/新建按钮/拖入指示线共用此原点;指针命中换算见 TabsStore.getTabsBlockOffset,两者须一致。
export const tabsBlockTop = (theme: ITheme) =>
  `${Math.max(0, (theme.titlebarBaseHeight - theme.tabSurfaceHeight) / 2)}px`;

// 窗口最大化/全屏时,第 0 行标签上方 tabsBlockTop 的空隙是屏幕顶边的「盲点」区域:
// 用透明伪元素把命中区向上补到容器顶部(=窗口顶边),鼠标顶到屏幕最上沿也能点中/悬停/拖拽
// (Fitts 定律,同 Chrome)。非贴顶时保留这条空隙给窗口拖动与顶边缩放,不延伸。
// extra:元素自身相对标签表面的额外下移量(如新建按钮在表面内再居中的偏移)。
export const topHitExtension = (theme: ITheme, extra = 0) => {
  if (!theme.tabHitExtendTop) return '';
  const gap =
    Math.max(0, (theme.titlebarBaseHeight - theme.tabSurfaceHeight) / 2) + extra;
  if (gap <= 0) return '';
  return css`
    &::before {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: -${gap}px;
      height: ${gap}px;
      /* 盖住标题栏 ::before 的拖动区,否则这条带仍被系统当作标题栏拖动 */
      -webkit-app-region: no-drag;
    }
  `;
};

export const StyledTab = styled.div`
  position: absolute;
  top: ${({ theme }: { theme: ITheme }) => tabsBlockTop(theme)};
  height: ${({ theme }: { theme: ITheme }) => theme.tabSurfaceHeight}px;
  width: 0;
  left: 0;
  will-change: width, transform;
  -webkit-app-region: no-drag;
  display: flex;
  backface-visibility: hidden;
  /* The parent owns the complete tab gesture surface. */
  pointer-events: auto;

  ${({ $row, theme }: TabProps & { theme: ITheme }) =>
    $row === 0 && topHitExtension(theme)};

  ${({ selected, $row }: TabProps) => css`
    /* Rows overlap by the top margin. Give the lower row precedence in the
       overlap, while keeping the selected tab above its siblings in the same
       row. */
    z-index: ${$row * 2 + (selected ? 1 : 0)};
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
  pointer-events: auto;
  border-radius: 9999px;

  ${({ pinned, theme, hasTabGroup, selected, incognito, $density }: TabContainerProps) => css`
    max-width: ${pinned ? `${TAB_PINNED_WIDTH}px` : '100%'};
    padding-right: ${selected ? `${8 * $density}px` : 0};
    height: ${theme.tabSurfaceHeight}px;
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
