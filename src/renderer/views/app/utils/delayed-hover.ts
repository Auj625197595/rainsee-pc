import * as React from 'react';

const DEFAULT_HOVER_DELAY = 100;

export const useDelayedHover = (
  onHover: () => void,
  delay = DEFAULT_HOVER_DELAY,
) => {
  const timerRef = React.useRef<number | null>(null);
  const hoveringRef = React.useRef(false);
  const onHoverRef = React.useRef(onHover);
  onHoverRef.current = onHover;

  const cancel = React.useCallback(() => {
    hoveringRef.current = false;
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const schedule = React.useCallback(() => {
    cancel();
    hoveringRef.current = true;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (hoveringRef.current) onHoverRef.current();
    }, delay);
  }, [cancel, delay]);

  React.useEffect(() => cancel, [cancel]);

  return { schedule, cancel };
};
