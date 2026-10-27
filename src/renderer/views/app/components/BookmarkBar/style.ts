import styled, { css } from 'styled-components';
import { Button } from '../ToolbarButton/style';
import { ITheme } from '~/interfaces';

export const BookmarkBar = styled.div`
  position: relative;
  z-index: 100;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-flow: row;
  color: rgba(0, 0, 0, 0.8);
  width: 100%;
  min-height: 32px;
  padding: 2px 8px;
  padding-top: 0px;
  padding-right: 4px;
  ${({ theme }: { theme: ITheme }) => css`
    margin-top: ${theme.isCompact ? 0 : -1}px;
    background-color: ${theme.isCompact
      ? theme['titlebar.backgroundColor']
      : theme['toolbar.backgroundColor']};
    border-bottom: 1px solid
      ${theme.isCompact
        ? 'transparent'
        : theme['toolbar.bottomLine.backgroundColor']};
    color: ${theme['bookmark.textColor'] || theme['addressbar.textColor']};
  `};

  &[data-drop-active='true'] {
    box-shadow: inset 0 0 0 2px rgba(26, 115, 232, 0.7);
  }
`;

export const BookmarkDropIndicator = styled.div`
  position: absolute;
  z-index: 3;
  width: 2px;
  border-radius: 1px;
  pointer-events: none;
  background: #1a73e8;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.75);
`;
export const MibileBookmarkSection = styled.div`
  position: relative;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid #dedede;
  border-radius: 5px;
  padding: 3px 6px;
  white-space: nowrap;
  cursor: pointer;

  &[data-icons-only='true'] {
    width: 28px;
    height: 24px;
    padding: 3px;

    & > div {
      display: none;
    }

    &:hover {
      z-index: 2;

      & > div {
        position: absolute;
        top: -1px;
        right: 23px;
        display: flex;
        align-items: center;
        height: 24px;
        padding: 0 5px 0 7px;
        border: 1px solid #dedede;
        border-right: 0;
        border-radius: 5px 0 0 5px;
        ${({ theme }: { theme: ITheme }) =>
          `background-color: ${theme['toolbar.backgroundColor']};`}
      }
    }
  }

  &:hover {
    background-color: rgba(0, 0, 0, 0.1);
  }
`;

export const MobileBookmarkIcon = styled.img`
  width: 15px;
  height: 15px;

  ${({ theme }: { theme: ITheme }) => css`
    filter: ${theme['toolbar.lightForeground'] ? 'invert(100%)' : 'none'};
  `};
`;
export const BookmarkSection = styled.div<{
  rows?: number;
  dragging?: boolean;
}>`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  /* flex-flow 是简写,设为 'row' 会把 flex-wrap 重置为 nowrap——多行必须用 'row wrap' */
  flex-flow: row wrap;
  /* 撑满剩余宽度,使换行点与 store 实测的 section 宽度一致 */
  flex: 1 1 0;
  min-width: 0;
  row-gap: 4px;
  overflow: hidden;
  /* 书签栏无需选中文字,始终禁用可避免长按等待期内误触发文本选中 */
  user-select: none;

  ${({ rows }) =>
    rows &&
    css`
      /* 密集书签按钮高 26px(见 ToolbarButton/style.ts),rows 行最多占 rows*26 + (rows-1)*row-gap */
      max-height: calc(${rows} * 26px + (${rows} - 1) * 4px);
    `}

  ${({ dragging }) =>
    dragging &&
    css`
      cursor: grabbing;
    `};
`;

export const BookmarkButton = styled(Button)`
  max-width: ${({ width }: { width: number }) => width}px;
  width: auto;
  /* Keep the intrinsic bookmark width so flex-wrap can expose items that do
   * not fit. Allowing the buttons to shrink makes long titles silently clip
   * in the first row, leaving overflowItems empty and hiding the more arrow. */
  flex: 0 0 auto;
  padding: 4px;
  margin: 0px 2px;
  font-size: 12px;
  display: flex;
  flex-direction: row;
  align-items: center;

  &[data-icons-only='true'] {
    position: relative;
    width: 34px;
    padding: 4px 1px;
    justify-content: center;

    [data-rainsee-part='bookmark-title'] {
      display: none;
    }

    &:hover {
      z-index: 2;

      [data-rainsee-part='bookmark-title'] {
        position: absolute;
        top: 0;
        left: 30px;
        display: flex;
        align-items: center;
        width: max-content;
        height: 26px;
        padding: 0 8px 0 4px;
        border-radius: 0 2px 2px 0;
        ${({ theme }: { theme: ITheme }) =>
          `background-color: ${theme['toolbar.backgroundColor']};`}
      }
    }

    &[data-expand-left='true']:hover [data-rainsee-part='bookmark-title'] {
      right: 30px;
      left: auto;
      padding: 0 4px 0 8px;
      border-radius: 2px 0 0 2px;
    }
  }

  &[data-drop-active='true'] {
    background-color: rgba(26, 115, 232, 0.16) !important;
    box-shadow: inset 0 0 0 1px rgba(26, 115, 232, 0.55);
  }

  ${({ dragging }: { dragging?: boolean; theme: ITheme }) =>
    dragging &&
    css`
      /* 实体留在原槽位，独立虚影负责跟随指针。 */
      cursor: grabbing;
      opacity: 0.35;
    `};
`;

export const Title = styled.div`
  min-width: 0px;
  max-width: 150px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: clip;
  padding: 0px 4px 0px 0px;
`;

export const Favicon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 16px;
  width: 16px;
  margin-left: 4px;
  margin-right: 4px;

  & > img,
  & > svg {
    height: 16px;
    width: 16px;
    object-fit: contain;
  }

  [data-icons-only='true'] & {
    margin-left: 0;
    margin-right: 0;
  }
`;
