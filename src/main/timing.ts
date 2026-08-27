// Startup timing uses process.uptime() so launcher, main-process and renderer
// IPC events can be read as one monotonic timeline in the file log.

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

type StartupDetails = Record<string, unknown> | string | number | boolean;
type LauncherMark = {
  phase: string;
  atMs: number;
  details?: StartupDetails;
};

const startupNowMs = () => Math.round(process.uptime() * 1000);
let lastStartupMarkMs = 0;

const formatDetails = (details?: StartupDetails) => {
  if (details === undefined) return '';
  if (typeof details === 'object') {
    try {
      return ` details=${JSON.stringify(details)}`;
    } catch {
      return ` details=${String(details)}`;
    }
  }
  return ` details=${String(details)}`;
};

const writeStartupMark = (
  phase: string,
  atMs: number,
  details?: StartupDetails,
) => {
  const safePhase = String(phase || 'unknown').replace(/\s+/g, '_').slice(0, 100);
  const deltaMs = lastStartupMarkMs ? Math.max(0, atMs - lastStartupMarkMs) : atMs;
  lastStartupMarkMs = Math.max(lastStartupMarkMs, atMs);
  console.log(
    `[STARTUP] phase=${safePhase} +${atMs}ms delta=${deltaMs}ms${formatDetails(details)}`,
  );
};

export function startupMark(phase: string, details?: StartupDetails) {
  writeStartupMark(phase, startupNowMs(), details);
}

export function startupTimer() {
  const startedAt = startupNowMs();
  return () => Math.max(0, startupNowMs() - startedAt);
}

const startupGlobal = global as any;
const launcherMarks = Array.isArray(startupGlobal.__rainseeStartupMarks)
  ? (startupGlobal.__rainseeStartupMarks as LauncherMark[])
  : [];
for (const mark of launcherMarks) {
  if (!mark || typeof mark.phase !== 'string' || !Number.isFinite(mark.atMs)) continue;
  writeStartupMark(mark.phase, Math.round(mark.atMs), mark.details);
}
startupGlobal.__rainseeStartupMarks = [];
startupGlobal.__rainseeStartupMark = startupMark;
