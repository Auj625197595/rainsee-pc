type SecondInstanceHandler = (argv: string[]) => void;

type SecondInstanceWindow = {
  incognito: boolean;
  win: {isDestroyed(): boolean};
};

type SecondInstanceWindowCandidates<T extends SecondInstanceWindow> = {
  incognito: boolean;
  current?: T;
  lastFocused?: T;
  list: T[];
};

// A normal taskbar launch must never resolve to an incognito window (and vice
// versa). The two shortcuts share one process lock, so the primary process has
// to preserve that mode boundary when it handles the secondary launch.
export const findSecondInstanceWindow = <T extends SecondInstanceWindow>({
  incognito,
  current,
  lastFocused,
  list,
}: SecondInstanceWindowCandidates<T>): T | undefined =>
  [current, lastFocused, ...list].find(
    (window): window is T =>
      !!window && !window.win.isDestroyed() && window.incognito === incognito,
  );

// The lightweight launcher owns the lock and queues early requests. The full
// bundle only connects the business handler once its first window exists.
export class SingleInstanceCoordinator {
  public setHandler(handler: SecondInstanceHandler) {
    const launcherGlobal = globalThis as any;
    launcherGlobal.__rainseeSecondInstanceHandler = handler;
    const launcherPending = Array.isArray(launcherGlobal.__rainseeSecondInstanceQueue)
      ? launcherGlobal.__rainseeSecondInstanceQueue
      : [];
    launcherGlobal.__rainseeSecondInstanceQueue = [];
    launcherPending.forEach((argv: string[]) => handler(argv));
  }
}

export const singleInstanceCoordinator = new SingleInstanceCoordinator();
