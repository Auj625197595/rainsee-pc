import styled, { css, createGlobalStyle } from 'styled-components';
import { ITheme } from '~/interfaces';

// 几何常量须与主进程 dialogs/bookmark-overflow.ts 的 COL_WIDTH/ROW_HEIGHT/COL_GAP/PADDING 一致,
// 否则渲染页切列高度与 Panel 尺寸错位。
export const COL_WIDTH = 240;
export const ROW_HEIGHT = 30;
export const COL_GAP = 6;
const PADDING = 8;

const fg = (theme?: ITheme) =>
  theme && theme['dialog.lightForeground'] ? '#fff' : '#161b2d';
const hoverBg = (theme?: ITheme) =>
  theme && theme['dialog.lightForeground']
    ? 'rgba(255,255,255,0.16)'
    : 'rgba(52,82,255,0.14)';

// UIStyle(default-styles)会给 body 设 pages.backgroundColor,全屏 BV 会白屏盖住窗口;
// 此处覆盖为透明,让 Backdrop 真正透出底层窗口。createGlobalStyle 在 UIStyle 之后
// 注入,!important 确保胜出。
export const TransparentBackground = createGlobalStyle`
  html, body {
    background: transparent !important;
  }
`;

// 全屏透明遮罩:BV 全屏覆盖窗口,这里透明(配合主进程 setBackgroundColor('#00000000'))
// 不挡视觉,但捕获窗口任意处点击 → 关闭浮层(modal 行为)。Panel 用 stopPropagation 拦截。
export const Backdrop = styled.div`
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
`;

// 菜单本体:absolute 定位到锚点(主进程下发 panelX/Y/W/H),自带圆角/阴影/背景。
export const Panel = styled.div`
  position: absolute;
  display: flex;
  flex-direction: column;
  padding: ${PADDING}px;
  box-sizing: border-box;
  border-radius: 10px;
  box-shadow: 0 12px 16px rgba(0, 0, 0, 0.12), 0 8px 10px rgba(0, 0, 0, 0.16);
  overflow: hidden;
  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${theme && theme['dialog.backgroundColor']};
    color: ${fg(theme)};
  `}
`;

// row-reverse:DOM 第 1 列(columns[0],书签顺序最前)落在视觉最右,紧贴更多按钮;
// 末列(columns[cols-1])落在视觉最左,作为溢出滚动列。
export const Columns = styled.div`
  display: flex;
  flex-direction: row-reverse;
  gap: ${COL_GAP}px;
  flex: 1;
  min-height: 0;
`;

export const Column = styled.div<{ overflow: boolean }>`
  width: ${COL_WIDTH}px;
  display: flex;
  flex-direction: column;
  position: relative;
  ${({ overflow }) =>
    overflow &&
    css`
      overflow-y: auto;
    `}
  /* 滚动交给底部箭头,隐藏滚动条 */
  &::-webkit-scrollbar {
    width: 0;
    height: 0;
  }
`;

export const Row = styled.div`
  display: flex;
  align-items: center;
  height: ${ROW_HEIGHT}px;
  padding: 0 10px;
  border-radius: 8px;
  cursor: default;
  font-size: 13px;
  white-space: nowrap;
  flex-shrink: 0;
  ${({ theme }: { theme?: ITheme }) => css`
    &:hover {
      background-color: ${hoverBg(theme)};
    }
  `}
`;

export const Favicon = styled.div`
  width: 16px;
  height: 16px;
  margin-right: 10px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  img {
    display: block;
  }
`;

export const Title = styled.div`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
`;

// 二级「返回」按钮(仅 role==='sub' && canBack 显示)
export const BackRow = styled.div`
  display: flex;
  align-items: center;
  height: ${ROW_HEIGHT}px;
  padding: 0 10px;
  margin-bottom: 4px;
  border-radius: 8px;
  font-size: 13px;
  cursor: default;
  flex-shrink: 0;
  ${({ theme }: { theme?: ITheme }) => css`
    &:hover {
      background-color: ${hoverBg(theme)};
    }
  `}
`;

// 末列底部向下滚动箭头:悬停启动 raf 自增 scrollTop。
// sticky bottom:0:它是滚动流末元素,滚动时粘在列可视底部始终可见(不随内容滚走)。
export const ScrollArrow = styled.div`
  position: sticky;
  bottom: 0;
  left: 0;
  right: 0;
  height: 22px;
  margin-top: -4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  cursor: default;
  pointer-events: auto;
  flex-shrink: 0;
  ${({ theme }: { theme?: ITheme }) => css`
    background: linear-gradient(
      to top,
      ${theme && theme['dialog.lightForeground'] ? '#2a2d3a' : '#fff'} 55%,
      transparent
    );
    color: ${fg(theme)};
  `}
`;

export const EmptyHint = styled.div`
  padding: 8px 10px;
  font-size: 13px;
  opacity: 0.5;
`;
