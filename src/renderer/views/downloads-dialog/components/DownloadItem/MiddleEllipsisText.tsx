import * as React from 'react';
import styled from 'styled-components';

const ELLIPSIS = '…';

// 用 canvas 按当前字体精确测量文本宽度(离屏,全局复用)。
let measureCtx: CanvasRenderingContext2D | null = null;

const getMeasureCtx = () => {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
  }
  return measureCtx;
};

const getFont = (el: HTMLElement) => {
  const s = getComputedStyle(el);
  return `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
};

const textWidth = (font: string, text: string) => {
  const ctx = getMeasureCtx();
  if (!ctx) return text.length * 8;
  ctx.font = font;
  return ctx.measureText(text).width;
};

// 中间截断:扩展名完整保留在尾部,文件名部分从头尾两端均匀收缩。
// 返回 null 表示无需截断。
const splitMiddle = (
  text: string,
  font: string,
  available: number,
): { head: string; tail: string } => {
  const dot = text.lastIndexOf('.');
  const ext = dot > 0 && dot < text.length - 1 ? text.slice(dot) : '';
  const name = text.slice(0, text.length - ext.length);
  const n = name.length;

  const build = (removed: number) => {
    const keep = Math.max(0, n - removed);
    const headCount = Math.ceil(keep / 2);
    const tailCount = keep - headCount;
    return {
      head: name.slice(0, headCount),
      tail: (tailCount > 0 ? name.slice(n - tailCount) : '') + ext,
    };
  };

  const fits = (removed: number) => {
    const { head, tail } = build(removed);
    return textWidth(font, head + ELLIPSIS + tail) <= available;
  };

  // 二分查找:能放下的最少删除字符数。
  let lo = 0;
  let hi = n;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) {
      ans = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  // 连省略号都放不下,交给外层 CSS 兜底裁切。
  if (ans < 0) return { head: '', tail: '' };
  return build(ans);
};

const Text = styled.span`
  display: block;
  overflow: hidden;
  white-space: nowrap;
`;

type Props = {
  text: string;
};

export const MiddleEllipsisText = ({ text }: Props) => {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [trimmed, setTrimmed] = React.useState<{
    head: string;
    tail: string;
  } | null>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const compute = () => {
      const available = el.clientWidth;
      if (available > 0) {
        const font = getFont(el);
        if (textWidth(font, text) <= available) {
          setTrimmed(null);
        } else {
          setTrimmed(splitMiddle(text, font, available));
        }
      }
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    // 字体异步加载完成后宽度会变,重算一次。
    const fonts = (document as any).fonts;
    fonts?.ready.then(compute).catch(() => {});

    return () => observer.disconnect();
  }, [text]);

  return (
    <Text ref={ref}>
      {trimmed ? `${trimmed.head}${ELLIPSIS}${trimmed.tail}` : text}
    </Text>
  );
};
