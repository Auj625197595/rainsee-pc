import styled, { css } from 'styled-components';
import { BLUE_300, DEEP_BLUE_500 } from '~/renderer/constants';
import { ITheme } from '~/interfaces';

// 容器高度不固定:贴合实际内容,实际像素值由 MultiLink 组件在 useLayoutEffect
// 里测量后回传给主进程做窗口高度计算(见 store.multiLinkHeight)。
// 文本区 max-height 限制最多 4 行,超过滚动,故容器封顶约 padding+80。
export const StyledMultiLink = styled.div`
  display: flex;
  align-items: flex-start;
  width: 100%;
  padding: 8px 12px;
  box-sizing: border-box;

  ${({ theme }: { theme?: ITheme }) => css`
    border-top: 1px solid
      ${theme['searchBox.lightForeground']
        ? 'rgba(255, 255, 255, 0.08)'
        : 'rgba(0, 0, 0, 0.08)'};
    border-bottom: 1px solid
      ${theme['searchBox.lightForeground']
        ? 'rgba(255, 255, 255, 0.08)'
        : 'rgba(0, 0, 0, 0.08)'};
  `}
`;

// 「多链接」蓝色胶囊标签(克隆 ClipboardTag 风格,贴在区块顶部,不可点)。
export const MultiLinkTag = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 7px;
  margin-right: 8px;
  margin-top: 2px;
  border-radius: 10px;
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
  color: #fff;
  background-color: ${DEEP_BLUE_500};
`;

// 右侧多行文本区:占满剩余宽度,超长 URL word-break,超出 4 行滚动。
export const MultiLinkText = styled.div`
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  max-height: 80px;
  overflow-y: auto;
  word-break: break-all;
  white-space: pre-wrap;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme['searchBox.lightForeground']
      ? 'rgba(255, 255, 255, 0.87)'
      : 'rgba(0, 0, 0, 0.87)'};
  `}
`;

// 链接:蓝色,hover 下划线(颜色与 Suggestion/style.ts 的 Url 一致)。
export const MultiLinkAnchor = styled.a`
  text-decoration: none;
  cursor: pointer;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme['searchBox.lightForeground'] ? BLUE_300 : '#3297FD'};
  `}
  &:hover {
    text-decoration: underline;
  }
`;

// 右侧链接计数提示。
export const LinkCount = styled.div`
  flex-shrink: 0;
  align-self: flex-start;
  margin-top: 2px;
  margin-left: 8px;
  font-size: 11px;
  white-space: nowrap;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme['searchBox.lightForeground']
      ? 'rgba(255, 255, 255, 0.54)'
      : 'rgba(0, 0, 0, 0.54)'};
  `}
`;
