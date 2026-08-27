import {ipcRenderer} from 'electron';

export const rendererStartupTimer = () => {
  const startedAt = performance.now();
  return () => Math.max(0, Math.round(performance.now() - startedAt));
};

export const rendererStartupMark = (
  phase: string,
  details: Record<string, unknown> = {},
) => {
  ipcRenderer.send('startup-timing', {
    phase,
    details: {
      ...details,
      rendererElapsedMs: Math.round(performance.now()),
    },
  });
};
