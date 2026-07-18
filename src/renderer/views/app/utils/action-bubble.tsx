import * as React from 'react';
import { createPortal } from 'react-dom';
import styled, { keyframes } from 'styled-components';

const bubbleIn = keyframes`
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
`;

const ActionBubbleView = styled.div`
  position: fixed;
  z-index: 99999;
  transform: translateY(-50%);
  background: rgb(38, 43, 51);
  color: #fff;
  font-size: 12px;
  line-height: 1;
  padding: 7px 12px;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.24);
  pointer-events: none;
  white-space: nowrap;
  animation: ${bubbleIn} 0.12s ease-out;
`;

interface ActionBubbleState {
  text: string;
  x: number;
  y: number;
}

// 右键工具栏按钮执行快捷/批量动作后的反馈气泡。
// 用法:
//   const { show, portal } = useActionBubble();
//   show('文案', anchorElement);   // 在 anchor 右侧、垂直居中弹出
//   return <>{...}{portal}</>;     // 在组件 JSX 末尾渲染 {portal}
export const useActionBubble = (duration = 900) => {
  const [bubble, setBubble] = React.useState<ActionBubbleState | null>(null);
  const timer = React.useRef<any>(null);

  const show = React.useCallback(
    (text: string, anchor: Element) => {
      const rect = anchor.getBoundingClientRect();
      if (timer.current) {
        clearTimeout(timer.current);
      }
      setBubble({ text, x: rect.right + 8, y: rect.top + rect.height / 2 });
      timer.current = setTimeout(() => setBubble(null), duration);
    },
    [duration],
  );

  React.useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const portal = bubble
    ? createPortal(
        <ActionBubbleView style={{ left: bubble.x, top: bubble.y }}>
          {bubble.text}
        </ActionBubbleView>,
        document.body,
      )
    : null;

  return { show, portal };
};
