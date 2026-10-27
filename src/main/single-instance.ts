type SecondInstanceHandler = (argv: string[]) => void;

type SecondInstanceWindow = {
  incognito: boolean;
  workspaceId?: string;
  win: {isDestroyed(): boolean};
};

type SecondInstanceWindowCandidates<T extends SecondInstanceWindow> = {
  incognito: boolean;
  current?: T;
  lastFocused?: T;
  list: T[];
};

// A normal taskbar launch must never resolve to an incognito or workspace
// window. Workspaces are independent browser contexts, so launching the app
// again must restore the regular browsing window instead of silently focusing
// an already-open workspace.
export const findSecondInstanceWindow = <T extends SecondInstanceWindow>({
  incognito,
  current,
  lastFocused,
  list,
}: SecondInstanceWindowCandidates<T>): T | undefined =>
  [current, lastFocused, ...list].find(
    (window): window is T =>
      !!window &&
      !window.win.isDestroyed() &&
      window.incognito === incognito &&
      (incognito || !window.workspaceId),
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
