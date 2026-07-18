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
    color: ${theme['addressbar.textColor']};
  `};
`;
export const MibileBookmarkSection = styled.div`
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  border: 1px solid #dedede;
  border-radius: 5px;
  padding: 3px 6px;
  white-space: nowrap;
  cursor: pointer;
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
  padding: 4px;
  margin: 0px 2px;
  font-size: 12px;
  display: flex;
  flex-direction: row;
  align-items: center;

  ${({ dragging, theme }: { dragging?: boolean; theme: ITheme }) =>
    dragging &&
    css`
      /* 被拖项:实色卡片底(不透明)+ 圆角 + 收敛阴影,呈现"拾起"观感。
         position:relative 使 z-index 生效,跟手 transform 时盖在邻居之上。
         !important + &:active/:hover 覆盖基类 Button 的 :active{bg!important}(按住时半透明底),
         否则拖拽中背景始终被覆盖成 rgba(0,0,0,0.1) 半透明。 */
      position: relative;
      z-index: 1;
      cursor: grabbing;
      background-color: ${theme['toolbar.lightForeground']
        ? '#3c4043'
        : '#ffffff'} !important;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
      &:active,
      &:hover {
        background-color: ${theme['toolbar.lightForeground']
          ? '#3c4043'
          : '#ffffff'} !important;
      }
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
`;
