import { TabWheelBehavior } from '~/interfaces';

export type TabWheelDirection = 1 | -1;
export type TabWheelScrollAxis = 'horizontal' | 'vertical';

export interface TabWheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode?: number;
}

export interface TabWheelHandlerOptions {
  axis: TabWheelScrollAxis;
  getBehavior: () => TabWheelBehavior;
  getContainer: () => HTMLElement | null;
  onSwitch: (direction: TabWheelDirection) => boolean | void;
  onSwitched?: (
    direction: TabWheelDirection,
    behavior: TabWheelBehavior,
  ) => void;
  threshold?: number;
  cooldownMs?: number;
  resetMs?: number;
}

export interface TabWheelResult {
  handled: boolean;
  switched: boolean;
}

const normalizeDelta = (value: number, deltaMode: number): number => {
  if (deltaMode === 1) return value * 16;
  if (deltaMode === 2) return value * 400;
  return value;
};

/** 纵向与横向输入统一取绝对值较大的主导轴，并归一化为像素。 */
export const getDominantWheelDelta = (input: TabWheelInput): number => {
  const raw =
    Math.abs(input.deltaX) > Math.abs(input.deltaY)
      ? input.deltaX
      : input.deltaY;
  return normalizeDelta(raw, input.deltaMode || 0);
};

/** 读取标签元素沿滚动轴的外部尺寸；元素不可用时采用布局约定的回退值。 */
export const getTabScrollStep = (
  element: HTMLElement | null | undefined,
  axis: TabWheelScrollAxis,
  fallback: number,
): number => {
  if (!element) return fallback;
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const marginStart = parseFloat(
    axis === 'horizontal' ? style.marginLeft : style.marginTop,
  ) || 0;
  const marginEnd = parseFloat(
    axis === 'horizontal' ? style.marginRight : style.marginBottom,
  ) || 0;
  const size =
    (axis === 'horizontal' ? rect.width : rect.height) +
    marginStart +
    marginEnd;
  return size > 0 ? size : fallback;
};

/**
 * 标签栏滚轮状态机：默认模式先滚动溢出内容，在既有边界继续滚动时切换；
 * 始终切换模式则由调用方在切换后推进一个标签格。
 */
export function createTabWheelHandler(options: TabWheelHandlerOptions) {
  const threshold = options.threshold ?? 30;
  const cooldownMs = options.cooldownMs ?? 80;
  const resetMs = options.resetMs ?? 200;

  let accumulated = 0;
  let lastSwitch = 0;
  let lastEvent = 0;
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  const now = () =>
    typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  const clearAccumulation = () => {
    accumulated = 0;
    lastEvent = 0;
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = null;
  };

  return (input: TabWheelInput): TabWheelResult => {
    const delta = getDominantWheelDelta(input);
    const container = options.getContainer();
    if (!container || !Number.isFinite(delta) || delta === 0) {
      return { handled: false, switched: false };
    }

    const behavior = options.getBehavior();
    const scrollPosition =
      options.axis === 'horizontal'
        ? container.scrollLeft
        : container.scrollTop;
    const clientSize =
      options.axis === 'horizontal'
        ? container.clientWidth
        : container.clientHeight;
    const scrollSize =
      options.axis === 'horizontal'
        ? container.scrollWidth
        : container.scrollHeight;
    const maxScroll = Math.max(0, scrollSize - clientSize);
    const hasOverflow = maxScroll > 1;
    const atBoundary =
      delta > 0 ? scrollPosition >= maxScroll - 1 : scrollPosition <= 1;

    if (behavior === 'auto' && hasOverflow && !atBoundary) {
      clearAccumulation();
      if (options.axis === 'horizontal') {
        container.scrollLeft = scrollPosition + delta;
      } else {
        container.scrollTop = scrollPosition + delta;
      }
      return { handled: true, switched: false };
    }

    const time = now();
    if (lastEvent !== 0 && time - lastEvent > resetMs) accumulated = 0;
    if (accumulated !== 0 && (accumulated < 0) !== (delta < 0)) {
      accumulated = 0;
    }
    accumulated += delta;
    lastEvent = time;

    let switched = false;
    if (
      Math.abs(accumulated) >= threshold &&
      (lastSwitch === 0 || time - lastSwitch >= cooldownMs)
    ) {
      const direction: TabWheelDirection = accumulated > 0 ? 1 : -1;
      switched = options.onSwitch(direction) !== false;
      accumulated = 0;
      lastSwitch = time;
      if (switched) options.onSwitched?.(direction, behavior);
    }

    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      accumulated = 0;
      lastEvent = 0;
      resetTimer = null;
    }, resetMs);

    return { handled: true, switched };
  };
}
