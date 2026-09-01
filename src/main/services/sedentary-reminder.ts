import {app, BrowserWindow, ipcMain, Notification, powerMonitor} from 'electron';
import {Application} from '../application';
import {getMainTranslator} from '../i18n';

type Phase = 'work' | 'break';
type Status = 'running' | 'paused' | 'completed';

interface ReminderConfig {
  workMinutes: number;
  breakMinutes: number;
  loopCount: number;
  notificationEnabled: boolean;
  soundEnabled: boolean;
  workMessage: string;
  breakMessage: string;
}

interface ReminderRuntime {
  status: Status;
  phase: Phase;
  phaseStartedAt: number;
  deadlineAt: number;
  pausedRemainingMs: number;
  completedCycles: number;
  revision: number;
  updatedAt: number;
}

interface ReminderPayload {
  id: string;
  config: ReminderConfig;
  runtime: ReminderRuntime;
}

interface ReminderEventPayload {
  version: number;
  id: string;
  config: ReminderConfig;
  event: {kind: 'work-ended' | 'break-ended' | 'completed'; key?: string};
  runtime?: ReminderRuntime;
}

const VERSION = 1;
const MAX_REMINDERS = 64;
const MINUTE = 60_000;

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function normalizeConfig(value: any): ReminderConfig {
  const t = getMainTranslator(Application.instance.settings?.object?.language);
  const text = (input: unknown, fallback: string) => {
    const result = String(input || '').trim().slice(0, 80);
    return result || fallback;
  };
  return {
    workMinutes: integer(value?.workMinutes, 45, 1, 240),
    breakMinutes: integer(value?.breakMinutes, 5, 1, 60),
    loopCount: integer(value?.loopCount, 0, 0, 99),
    notificationEnabled: value?.notificationEnabled !== false,
    soundEnabled: value?.soundEnabled !== false,
    workMessage: text(value?.workMessage, t('srWorkDefault')),
    breakMessage: text(value?.breakMessage, t('srBreakDefault')),
  };
}

function normalizeRuntime(value: any, config: ReminderConfig): ReminderRuntime {
  const now = Date.now();
  const phase: Phase = value?.phase === 'break' ? 'break' : 'work';
  const started = Number.isFinite(Number(value?.phaseStartedAt)) ? Number(value.phaseStartedAt) : now;
  const duration = (phase === 'break' ? config.breakMinutes : config.workMinutes) * MINUTE;
  const status: Status = ['running', 'paused', 'completed'].includes(value?.status)
    ? value.status : 'running';
  return {
    status,
    phase,
    phaseStartedAt: started,
    deadlineAt: Number.isFinite(Number(value?.deadlineAt)) ? Number(value.deadlineAt) : started + duration,
    pausedRemainingMs: status === 'paused' ? Math.max(0, Math.min(duration, Number(value?.pausedRemainingMs) || 0)) : 0,
    completedCycles: Math.max(0, integer(value?.completedCycles, 0, 0, 99_999_999)),
    revision: Math.max(1, integer(value?.revision, 1, 1, 2_000_000_000)),
    updatedAt: Number.isFinite(Number(value?.updatedAt)) ? Number(value.updatedAt) : now,
  };
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(value);
}

function validPayload(payload: any): payload is {
  version: number;
  reminders: ReminderPayload[];
  removedIds?: string[];
} {
  if (!payload || Number(payload.version) !== VERSION || !Array.isArray(payload.reminders)) return false;
  if (payload.reminders.length > MAX_REMINDERS) return false;
  if (payload.removedIds !== undefined
    && (!Array.isArray(payload.removedIds)
      || payload.removedIds.length > MAX_REMINDERS
      || !payload.removedIds.every((id: unknown) => validId(id)))) return false;
  return payload.reminders.every((item: any) => validId(item?.id));
}

function validTestPayload(payload: any): payload is {version: number; requestId: string; config: ReminderConfig} {
  return Boolean(payload)
    && Number(payload.version) === VERSION
    && validId(payload.requestId)
    && payload.config && typeof payload.config === 'object';
}

function validEventPayload(payload: any): payload is ReminderEventPayload {
  return Boolean(payload)
    && Number(payload.version) === VERSION
    && validId(payload.id)
    && payload.config && typeof payload.config === 'object'
    && ['work-ended', 'break-ended', 'completed'].includes(payload.event?.kind);
}

function duration(config: ReminderConfig, phase: Phase): number {
  return (phase === 'break' ? config.breakMinutes : config.workMinutes) * MINUTE;
}

interface Entry {
  id: string;
  config: ReminderConfig;
  runtime: ReminderRuntime;
  timer?: NodeJS.Timeout;
  notifiedKey?: string;
}

/** Main-process fallback for GoTab's sedentary reminder. */
export class SedentaryReminderService {
  private entries = new Map<string, Entry>();
  private activeNotifications = new Set<Notification>();
  private programmaticallyClosingNotifications = new WeakSet<Notification>();
  // Each new-tab iframe owns a full snapshot. Keep those snapshots separate:
  // an empty/partial sync from one tab must not delete reminders owned by
  // another tab (or by a tab that is being closed).
  private sourceEntries = new Map<number, Map<string, ReminderPayload>>();
  private awayStartedAt = 0;
  // Renderer localStorage survives an Electron restart and contains the last
  // web runtime. Native reminders intentionally do not: on the first sync of
  // a new main-process session, start every existing component from a fresh
  // work phase instead of restoring a stale break/deadline.
  private initialSyncHandled = false;

  public constructor(private readonly getWindows: () => Array<{win?: BrowserWindow}>) {
    ipcMain.handle('sedentary-reminder-sync', (event, payload) => {
      console.info('[sedentary-reminder] sync IPC', {
        url: event.sender.getURL(),
        sourceId: event.sender.id,
        count: payload?.reminders?.length,
        removed: payload?.removedIds?.length || 0,
      });
      if (!this.isNewtabShell(event.sender.getURL())) {
        console.warn('[sedentary-reminder] sync rejected: sender is not newtab shell');
        return {version: VERSION, reminders: []};
      }
      return this.sync(payload, event.sender.id);
    });
    ipcMain.handle('sedentary-reminder-test', (event, payload) => {
      if (!this.isNewtabShell(event.sender.getURL()) || !validTestPayload(payload)) {
        return {version: VERSION, requestId: String(payload?.requestId || '').slice(0, 120), ok: false, reason: 'invalid'};
      }
      const config = normalizeConfig(payload.config);
      const t = getMainTranslator(Application.instance.settings?.object?.language);
      const ok = this.notify(config, config.workMessage, t('srTitleReminderTest'), true);
      return {version: VERSION, requestId: payload.requestId, ok, reason: ok ? undefined : 'unsupported'};
    });
    ipcMain.handle('sedentary-reminder-notify', (event, payload) => {
      console.info('[sedentary-reminder] notify IPC', {
        url: event.sender.getURL(),
        id: payload?.id,
        kind: payload?.event?.kind,
        key: payload?.event?.key,
      });
      if (!this.isNewtabShell(event.sender.getURL()) || !validEventPayload(payload)) {
        console.warn('[sedentary-reminder] notify rejected: invalid sender or payload');
        return {ok: false, reason: 'invalid'};
      }
      const ok = this.notifyFromRenderer(payload);
      console.info('[sedentary-reminder] notify result', {id: payload.id, ok});
      return {ok};
    });
    powerMonitor.on('suspend', () => this.beginAway());
    powerMonitor.on('lock-screen', () => this.beginAway());
    powerMonitor.on('resume', () => this.endAway());
    powerMonitor.on('unlock-screen', () => this.endAway());
    app.on('will-quit', () => this.dispose());
  }

  private isNewtabShell(url: string): boolean {
    return /^(yjllq:|http:\/\/localhost:4444\/).*newtab/i.test(String(url || ''));
  }

  private sync(payload: any, sourceId: number) {
    if (!validPayload(payload)) return this.snapshot();
    const resetOnStartup = !this.initialSyncHandled;
    // Do not replace the source snapshot with an empty list. A renderer can
    // send its last lifecycle update while its tab is being destroyed; that
    // is not a component deletion. Deletions are carried explicitly in
    // removedIds below.
    const source = this.sourceEntries.get(sourceId) || new Map<string, ReminderPayload>();
    payload.reminders.forEach((item: any) => {
      if (!validId(item.id)) return;
      const config = normalizeConfig(item.config);
      let runtime = normalizeRuntime(item.runtime, config);
      if (resetOnStartup) {
        const now = Date.now();
        runtime = {
          ...runtime,
          status: 'running',
          phase: 'work',
          phaseStartedAt: now,
          deadlineAt: now + duration(config, 'work'),
          pausedRemainingMs: 0,
          completedCycles: 0,
          // Ensure a stale renderer snapshot cannot overwrite this reset on
          // its next sync before it receives the native state broadcast.
          revision: Math.max(1, runtime.revision + 1),
          updatedAt: now,
        };
        console.info('[sedentary-reminder] startup runtime reset', {
          id: item.id,
          phase: runtime.phase,
          deadlineAt: runtime.deadlineAt,
        });
      }
      source.set(item.id, {id: item.id, config, runtime});
    });
    if (payload.reminders.length > 0) this.initialSyncHandled = true;
    // Move this sender to the end so equal-version configuration updates from
    // the most recently opened homepage wins deterministically.
    this.sourceEntries.delete(sourceId);
    this.sourceEntries.set(sourceId, source);

    // Explicit removals are generated when a component is deleted. They are
    // global so a closed tab cannot resurrect a component deleted elsewhere.
    for (const removedId of payload.removedIds || []) {
      this.sourceEntries.forEach((items) => items.delete(removedId));
      this.remove(removedId);
    }

    const incoming = new Map<string, ReminderPayload>();
    this.sourceEntries.forEach((items) => {
      items.forEach((item, id) => {
        const previous = incoming.get(id);
        if (!previous
          || item.runtime.revision > previous.runtime.revision
          || (item.runtime.revision === previous.runtime.revision
            && item.runtime.updatedAt > previous.runtime.updatedAt)) {
          incoming.set(id, item);
        }
      });
    });
    for (const [id, entry] of this.entries) {
      if (!incoming.has(id)) this.remove(id);
    }
    incoming.forEach((item, id) => {
      const existing = this.entries.get(id);
      if (existing && existing.runtime.revision > item.runtime.revision) {
        // Text/sound/size changes intentionally keep the same runtime
        // revision, but the native process must still adopt the new config.
        existing.config = item.config;
        return;
      }
      if (existing && existing.runtime.revision === item.runtime.revision && existing.runtime.updatedAt >= item.runtime.updatedAt) {
        existing.config = item.config;
        return;
      }
      // The iframe normally advances its own wall-clock runtime once per
      // second. If that happens before the native timer fires, the incoming
      // payload already contains the next phase and replacing the entry here
      // would otherwise lose the notification entirely. Treat a running
      // phase-version change as the same transition the native timer would
      // have handled.
      if (existing) this.notifyForIncomingTransition(existing, item);
      this.setEntry(item);
    });
    return this.snapshot();
  }

  private setEntry(item: ReminderPayload) {
    this.remove(item.id);
    const entry: Entry = {
      id: item.id,
      config: item.config,
      runtime: item.runtime,
    };
    this.entries.set(item.id, entry);
    this.schedule(entry);
  }

  private notifyForIncomingTransition(existing: Entry, incoming: ReminderPayload) {
    if (existing.runtime.status !== 'running' || !incoming.config.notificationEnabled) return;
    const t = getMainTranslator(Application.instance.settings?.object?.language);
    const previous = existing.runtime;
    const next = incoming.runtime;
    const nextKey = this.runtimeKey(next);
    if (existing.notifiedKey === nextKey) return;
    if (previous.phase === 'work' && next.phase === 'break' && next.status === 'running') {
      existing.notifiedKey = nextKey;
      this.notify(incoming.config, incoming.config.workMessage, t('srTitleReminder'), true);
      return;
    }
    if (previous.phase === 'break' && next.phase === 'work' && next.status === 'running') {
      existing.notifiedKey = nextKey;
      this.notify(incoming.config, incoming.config.breakMessage, t('srTitleBreakEnd'), true);
      return;
    }
    if (previous.phase === 'break' && next.phase === 'break' && next.status === 'completed') {
      existing.notifiedKey = nextKey;
      this.notify(incoming.config, incoming.config.breakMessage, t('srTitleCompleted'), true);
    }
  }

  private runtimeKey(runtime: ReminderRuntime) {
    return `${runtime.phase}:${runtime.phaseStartedAt}:${runtime.completedCycles}`;
  }

  private notifyFromRenderer(payload: ReminderEventPayload): boolean {
    const entry = this.entries.get(payload.id);
    const runtime = payload.runtime || entry?.runtime;
    const key = String(payload.event.key || (runtime ? this.runtimeKey(runtime) : ''));
    if (entry && key && entry.notifiedKey === key) return true;
    if (entry && key) entry.notifiedKey = key;
    const config = entry?.config || normalizeConfig(payload.config);
    if (!config.notificationEnabled) return false;
    const t = getMainTranslator(Application.instance.settings?.object?.language);
    const body = payload.event.kind === 'work-ended'
      ? config.workMessage
      : config.breakMessage;
    const title = payload.event.kind === 'work-ended'
      ? t('srTitleReminder')
      : payload.event.kind === 'completed' ? t('srTitleCompleted') : t('srTitleBreakEnd');
    return this.notify(config, body, title, payload.event.kind === 'completed');
  }

  private schedule(entry: Entry) {
    if (entry.runtime.status !== 'running') return;
    const wait = Math.max(250, entry.runtime.deadlineAt - Date.now());
    console.info('[sedentary-reminder] timer scheduled', {
      id: entry.id,
      phase: entry.runtime.phase,
      deadlineAt: entry.runtime.deadlineAt,
      wait,
    });
    entry.timer = setTimeout(() => this.advance(entry.id), wait);
  }

  private advance(id: string) {
    const entry = this.entries.get(id);
    if (!entry || entry.runtime.status !== 'running') return;
    console.info('[sedentary-reminder] timer fired', {
      id,
      phase: entry.runtime.phase,
      deadlineAt: entry.runtime.deadlineAt,
      now: Date.now(),
    });
    const at = Math.max(Date.now(), entry.runtime.deadlineAt);
    const eventKey = this.runtimeKey(entry.runtime);
    if (entry.notifiedKey !== eventKey && entry.config.notificationEnabled) {
      entry.notifiedKey = eventKey;
      const t = getMainTranslator(Application.instance.settings?.object?.language);
      this.notify(entry.config, entry.runtime.phase === 'work' ? entry.config.workMessage : entry.config.breakMessage, entry.runtime.phase === 'work' ? t('srTitleReminder') : t('srTitleBreakEnd'), true);
    }
    if (entry.runtime.phase === 'work') {
      entry.runtime = {
        ...entry.runtime,
        phase: 'break',
        phaseStartedAt: at,
        deadlineAt: at + duration(entry.config, 'break'),
        revision: entry.runtime.revision + 1,
        updatedAt: at,
      };
    } else {
      const cycles = entry.runtime.completedCycles + 1;
      if (entry.config.loopCount > 0 && cycles >= entry.config.loopCount) {
        entry.runtime = {...entry.runtime, status: 'completed', completedCycles: cycles, deadlineAt: at, revision: entry.runtime.revision + 1, updatedAt: at};
      } else {
        entry.runtime = {
          ...entry.runtime,
          phase: 'work',
          phaseStartedAt: at,
          deadlineAt: at + duration(entry.config, 'work'),
          completedCycles: cycles,
          revision: entry.runtime.revision + 1,
          updatedAt: at,
        };
      }
    }
    this.schedule(entry);
    this.broadcast();
  }

  private notify(config: ReminderConfig, body: string, title: string, persistent = false): boolean {
    let notification: Notification | undefined;
    try {
      this.broadcastNotice({title, body});
      if (!Notification.isSupported()) {
        console.warn('[sedentary-reminder] Electron Notification is not supported');
        return false;
      }
      // Keep at most one native sedentary reminder visible. Some Windows
      // notification-center paths do not emit Electron's `close` event when
      // the user dismisses a toast, so this also prevents stale reminders
      // from accumulating before a later reminder is shown.
      this.clearActiveNotifications();
      notification = new Notification({
        title,
        body,
        silent: !config.soundEnabled,
        urgency: 'normal',
        timeoutType: persistent ? 'never' : 'default',
      });
      this.activeNotifications.add(notification);
      notification.once('close', () => {
        const programmatic = this.programmaticallyClosingNotifications.delete(notification);
        this.activeNotifications.delete(notification);
        if (!programmatic) this.clearActiveNotifications();
      });
      notification.once('failed', () => {
        this.activeNotifications.delete(notification);
      });
      notification.on('click', () => {
        const target = this.getWindows().find((item) => item.win && !item.win.isDestroyed())?.win;
        if (!target) return;
        if (target.isMinimized()) target.restore();
        target.show();
        target.focus();
      });
      notification.show();
      console.info('[sedentary-reminder] system notification shown', {title, silent: !config.soundEnabled});
      return true;
    } catch (error) {
      // A constructor/show failure must not leave a dead notification in the registry.
      if (notification) this.activeNotifications.delete(notification);
      console.warn('[sedentary-reminder] notification failed', error);
      return false;
    }
  }

  private clearActiveNotifications() {
    if (this.activeNotifications.size === 0) return;
    const notifications = [...this.activeNotifications];
    this.activeNotifications.clear();
    notifications.forEach((notification) => {
      this.programmaticallyClosingNotifications.add(notification);
      try {
        notification.close();
      } catch (error) {
        console.warn('[sedentary-reminder] notification close failed', error);
      }
    });
  }

  private broadcastNotice(detail: {title: string; body: string}) {
    const payload = {version: VERSION, ...detail};
    for (const appWindow of this.getWindows()) {
      try {
        const views = (appWindow as any).viewManager?.views;
        if (views?.forEach) {
          views.forEach((view: any) => {
            const url = String(view?.webContents?.getURL?.() || '');
            if (/newtab/i.test(url) && !view.webContents.isDestroyed()) {
              view.webContents.send('sedentary-reminder-notice', payload);
            }
          });
        } else {
          appWindow.win?.webContents.send('sedentary-reminder-notice', payload);
        }
      } catch {
        // Window is closing; the next notification will retry delivery.
      }
    }
  }

  private beginAway() {
    if (!this.awayStartedAt) this.awayStartedAt = Date.now();
  }

  private endAway() {
    if (!this.awayStartedAt) return;
    const awayMs = Date.now() - this.awayStartedAt;
    this.awayStartedAt = 0;
    if (awayMs <= 0) return;
    this.entries.forEach((entry) => {
      if (awayMs < entry.config.breakMinutes * MINUTE || entry.runtime.status === 'completed') return;
      this.removeTimer(entry);
      const now = Date.now();
      entry.runtime = {
        ...entry.runtime,
        status: 'running',
        phase: 'work',
        phaseStartedAt: now,
        deadlineAt: now + duration(entry.config, 'work'),
        pausedRemainingMs: 0,
        revision: entry.runtime.revision + 1,
        updatedAt: now,
      };
      this.schedule(entry);
    });
    this.broadcast();
  }

  private removeTimer(entry: Entry) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  private remove(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.removeTimer(entry);
    this.entries.delete(id);
  }

  private snapshot() {
    return {
      version: VERSION,
      reminders: [...this.entries.values()].map((entry) => ({id: entry.id, runtime: entry.runtime})),
    };
  }

  private broadcast() {
    const payload = this.snapshot();
    for (const appWindow of this.getWindows()) {
      try {
        const views = (appWindow as any).viewManager?.views;
        if (views?.forEach) {
          views.forEach((view: any) => {
            const url = String(view?.webContents?.getURL?.() || '');
            if (/newtab/i.test(url) && !view.webContents.isDestroyed()) {
              view.webContents.send('sedentary-reminder-state', payload);
            }
          });
        } else {
          appWindow.win?.webContents.send('sedentary-reminder-state', payload);
        }
      } catch {
        // Window is closing; the next sync will reconcile it.
      }
    }
  }

  private dispose() {
    this.clearActiveNotifications();
    this.entries.forEach((entry) => this.removeTimer(entry));
    this.entries.clear();
    this.sourceEntries.clear();
  }
}
