import type {BrowserWindow} from 'electron';

const pendingPageCloseTabs = new WeakMap<BrowserWindow, Set<number>>();

const pendingFor = (window: BrowserWindow) => {
  let pending = pendingPageCloseTabs.get(window);
  if (!pending) {
    pending = new Set<number>();
    pendingPageCloseTabs.set(window, pending);
  }
  return pending;
};

export function beginPageClose(window: BrowserWindow, tabId: number) {
  pendingFor(window).add(tabId);
}

export function consumePendingPageClose(window: BrowserWindow) {
  const pending = pendingPageCloseTabs.get(window);
  if (!pending) return false;
  const next = pending.values().next();
  if (next.done) return false;
  pending.delete(next.value);
  if (pending.size === 0) pendingPageCloseTabs.delete(window);
  return true;
}

export function expirePageClose(window: BrowserWindow, tabId: number) {
  setTimeout(() => {
    const pending = pendingPageCloseTabs.get(window);
    if (!pending) return;
    pending.delete(tabId);
    if (pending.size === 0) pendingPageCloseTabs.delete(window);
  }, 2000).unref?.();
}
