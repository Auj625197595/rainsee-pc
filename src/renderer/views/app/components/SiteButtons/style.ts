import styled, { css, keyframes } from 'styled-components';

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: translateY(0); }
`;

// 地址栏右侧"有新版本"胶囊
export const UpdatePill = styled.div`
  display: flex;
  flex-shrink: 0;
  align-items: center;
  height: 26px;
  padding: 0 12px;
  margin: 0 4px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  -webkit-app-region: no-drag;
  color: #ffffff;
  background: linear-gradient(90deg, #28c78e 0%, #4ad6a4 100%);
  box-shadow: 0 4px 12px rgba(40, 199, 142, 0.32);
  animation: ${fadeIn} 0.2s ease;
  transition: filter 0.18s ease;

  &:hover {
    filter: brightness(1.04);
  }
`;

// 地址栏右侧"新标签搜索"气泡按钮:唤起搜索框,结果在新标签页打开。
// 小巧精致的渐变胶囊,作为地址栏右侧一个醒目的彩色气泡。
export const NewTabSearchPill = styled.div<{$iconOnly?: boolean}>`
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px 0 7px;
  margin: 0 3px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  -webkit-app-region: no-drag;
  color: #ffffff;
  background: linear-gradient(135deg, #5b8cff 0%, #7b6fff 100%);
  box-shadow: 0 2px 6px rgba(91, 124, 255, 0.28);
  animation: ${fadeIn} 0.2s ease;
  transition: filter 0.18s ease, transform 0.18s ease;

  svg {
    flex-shrink: 0;
  }

  &:hover {
    filter: brightness(1.07);
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
    filter: brightness(0.95);
  }

  ${({$iconOnly}) =>
    $iconOnly &&
    css`
      flex: 0 0 24px;
      justify-content: center;
      gap: 0;
      width: 24px;
      padding: 0;

      > span {
        display: none;
      }
    `}
`;
