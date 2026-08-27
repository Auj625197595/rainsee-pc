import styled, { css } from 'styled-components';

// 整个浮层铺满 BrowserView(= 页面内容区)
export const Root = styled.div`
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  user-select: none;
  cursor: crosshair;
`;

// 独立框选事件层，操作控件通过更高层级与框选手势完全隔离。
export const CaptureSurface = styled.div<{ $disabled: boolean }>`
  position: absolute;
  inset: 0;
  z-index: 1;
  cursor: crosshair;
  touch-action: none;
  pointer-events: ${({ $disabled }) => ($disabled ? 'none' : 'auto')};
`;

// 1:1 页面快照背景
export const Snapshot = styled.img`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
`;

// 暗色遮罩(框选区域之外)
export const Dim = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: none;
`;

// 框选高亮区:用 box-shadow 反向挖空(亮出选中区域)
export const Selection = styled.div`
  position: absolute;
  border: 1.5px solid #3b82f6;
  box-shadow: 0 0 0 100000px rgba(0, 0, 0, 0.45);
  pointer-events: none;
  box-sizing: border-box;
`;

export const ResizeHandle = styled.div<{ $direction: string }>`
  position: absolute;
  z-index: 6;
  touch-action: none;
  pointer-events: auto;

  ${({ $direction }) => {
    if ($direction === 'n' || $direction === 's') {
      return css`
        left: 10px;
        right: 10px;
        ${$direction === 'n' ? 'top: -5px;' : 'bottom: -5px;'}
        height: 10px;
        cursor: ns-resize;
      `;
    }
    if ($direction === 'e' || $direction === 'w') {
      return css`
        top: 10px;
        bottom: 10px;
        ${$direction === 'w' ? 'left: -5px;' : 'right: -5px;'}
        width: 10px;
        cursor: ew-resize;
      `;
    }
    const vertical = $direction.includes('n') ? 'top: -5px;' : 'bottom: -5px;';
    const horizontal = $direction.includes('w')
      ? 'left: -5px;'
      : 'right: -5px;';
    return css`
      ${vertical}
      ${horizontal}
      width: 12px;
      height: 12px;
      border: 2px solid #fff;
      border-radius: 50%;
      background: #2f6fed;
      box-sizing: border-box;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
      cursor: ${$direction === 'nw' || $direction === 'se'
        ? 'nwse-resize'
        : 'nesw-resize'};
    `;
  }}
`;

export const AnnotationCanvas = styled.canvas`
  position: absolute;
  z-index: 4;
  touch-action: none;
  cursor: crosshair;
`;

export const TextAnnotationTarget = styled.div<{ $active: boolean }>`
  position: absolute;
  z-index: 5;
  box-sizing: border-box;
  border: 1px dashed ${({ $active }) => ($active ? '#3b82f6' : 'transparent')};
  background: ${({ $active }) =>
    $active ? 'rgba(59, 130, 246, 0.08)' : 'transparent'};
  cursor: move;
  touch-action: none;

  &:hover {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.08);
  }
`;

// 框选完成后的操作工具条(跟随选区右下角)
export const Toolbar = styled.div`
  position: absolute;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border-radius: 8px;
  background: rgba(28, 32, 40, 0.96);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  z-index: 10;
  cursor: default;
  max-width: calc(100vw - 16px);
  overflow-x: auto;
`;

export const ToolButton = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  background: transparent;
  color: #e8eaed;
  font-size: 12px;
  font-weight: 700;
  transition: background-color 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  ${({ primary }: { primary?: boolean }) =>
    primary &&
    css`
      color: #fff;
      background: #2f6fed;
      &:hover {
        background: #4380f5;
      }
    `};
`;

export const ToolIconButton = styled.button<{
  $active?: boolean;
  $danger?: boolean;
}>`
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 5px;
  color: ${({ $danger }) => ($danger ? '#ff7777' : '#e8eaed')};
  background: ${({ $active }) => ($active ? '#2f6fed' : 'transparent')};
  cursor: pointer;

  &:hover {
    background: ${({ $active }) =>
      $active ? '#4380f5' : 'rgba(255,255,255,.14)'};
  }

  &:disabled {
    opacity: 0.38;
    cursor: default;
  }
`;

export const ColorSwatch = styled.input`
  width: 24px;
  height: 24px;
  padding: 0;
  border: 2px solid rgba(255, 255, 255, 0.75);
  border-radius: 50%;
  overflow: hidden;
  background: transparent;
  cursor: pointer;

  &::-webkit-color-swatch-wrapper {
    padding: 0;
  }
  &::-webkit-color-swatch {
    border: 0;
    border-radius: 50%;
  }
`;

export const SizeInput = styled.input`
  width: 54px;
  accent-color: #2f6fed;
`;

export const TextEditor = styled.input`
  position: absolute;
  z-index: 30;
  width: 180px;
  height: 32px;
  box-sizing: border-box;
  border: 1px solid #2f6fed;
  border-radius: 4px;
  outline: none;
  padding: 4px 7px;
  background: rgba(255, 255, 255, 0.96);
  color: #111827;
  font-size: 16px;
`;

export const ToolDivider = styled.span`
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.16);
  margin: 0 2px;
`;

// 顶部提示条 + 关闭
export const TopBar = styled.div`
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: 20px;
  background: rgba(28, 32, 40, 0.9);
  color: #e8eaed;
  font-size: 12px;
  font-weight: 700;
  z-index: 20;
  cursor: default;
`;

export const TopBarCloseButton = styled.button`
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 82, 82, 0.16);
  color: #ff5c5c;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover {
    background: #e54848;
    color: #fff;
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 92, 92, 0.7);
    outline-offset: 2px;
  }
`;

export const TopBarLongButton = styled.button`
  height: 22px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border: 0;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.1);
  color: #e8eaed;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 0.15s ease;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.18);
  }

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
`;

export const Hint = styled.div`
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: 18px;
  background: rgba(28, 32, 40, 0.94);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  z-index: 20;
`;

// 长截图结果预览:可滚动容器 + 底部固定工具条
export const FullPageRoot = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  flex-flow: column;
  background: rgba(0, 0, 0, 0.78);
  cursor: default;
`;

export const FullPageScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;

  scrollbar-width: thin;
  &::-webkit-scrollbar {
    width: 10px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.3);
    border-radius: 6px;
  }
`;

export const FullPageImg = styled.img`
  width: 480px;
  max-width: 90%;
  height: auto;
  align-self: flex-start;
  border-radius: 6px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
`;

export const FullPageActions = styled.div`
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px;
  background: rgba(20, 24, 30, 0.96);
  pointer-events: auto;
`;
