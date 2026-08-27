import * as React from 'react';

import { normalizeTabHoverActivationDelay } from '~/constants';

interface ITabHoverActivationOptions {
  enabled: boolean;
  delay: number;
  selected: boolean;
  activate: () => void | Promise<void>;
  blocked?: () => boolean;
}

export const useTabHoverActivation = ({
  enabled,
  delay,
  selected,
  activate,
  blocked,
}: ITabHoverActivationOptions) => {
  const timerRef = React.useRef<number | null>(null);
  const optionsRef = React.useRef<ITabHoverActivationOptions>({
    enabled,
    delay,
    selected,
    activate,
    blocked,
  });
  optionsRef.current = { enabled, delay, selected, activate, blocked };

  const cancel = React.useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const schedule = React.useCallback(() => {
    cancel();
    const options = optionsRef.current;
    if (!options.enabled || options.selected || options.blocked?.()) {
      return;
    }

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const current = optionsRef.current;
      if (!current.enabled || current.selected || current.blocked?.()) {
        return;
      }
      void current.activate();
    }, normalizeTabHoverActivationDelay(options.delay));
  }, [cancel]);

  React.useEffect(() => {
    if (!enabled || selected) cancel();
  }, [cancel, enabled, selected]);

  React.useEffect(() => cancel, [cancel]);

  return { schedule, cancel };
};
