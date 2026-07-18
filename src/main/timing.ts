// Lightweight startup timing instrumentation.
//
// TEMPORARY: added to diagnose the ~20s delay before the extension background
// service worker starts. Safe to delete (and remove its imports) once resolved.
//
// `+N.NNs` is seconds since the Electron process started (process.uptime()),
// so logs can be correlated across the main process and the extension SW.

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function nowTs(): string {
  const d = new Date();
  const wall = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
    d.getSeconds(),
  )}.${pad(d.getMilliseconds(), 3)}`;
  return `${wall} +${process.uptime().toFixed(2)}s`;
}

export function tlog(...args: any[]) {
  console.log(`[T ${nowTs()}]`, ...args);
}
