import { powerMonitor } from 'electron'
import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

// chrome.idle. Does not require a manifest permission. Electron's native
// runtime has no chrome.idle, so extensions that poll idle state (productivity
// timers, presence, auto-pause) would crash without this.
//
// state detection reuses Electron's powerMonitor: getSystemIdleTime() reports
// seconds since last input, and the idle/active/lock-screen/unlock-screen
// events drive chrome.idle.onStateChanged. Per-extension detection interval is
// remembered (Chrome clamps the minimum to 15s in MV3).
const intervals = new Map</* extensionId */ string, number>()
const DEFAULT_INTERVAL = 60

export class IdleAPI {
  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('idle.queryState', this.queryState)
    handle('idle.setDetectionInterval', this.setDetectionInterval)

    // powerMonitor events fire app-wide; broadcast to every listening extension
    // (Chrome's idle API is likewise system-wide, not per-extension).
    powerMonitor.on?.('idle', () => this.ctx.router.broadcastEvent('idle.onStateChanged', 'idle'))
    powerMonitor.on?.('active', () => this.ctx.router.broadcastEvent('idle.onStateChanged', 'active'))
    powerMonitor.on?.('lock-screen', () =>
      this.ctx.router.broadcastEvent('idle.onStateChanged', 'locked'),
    )
    powerMonitor.on?.('unlock-screen', () =>
      this.ctx.router.broadcastEvent('idle.onStateChanged', 'active'),
    )
  }

  private queryState = (
    { extension }: ExtensionEvent,
    detectionIntervalInSeconds?: number,
  ): chrome.idle.IdleState => {
    const threshold =
      typeof detectionIntervalInSeconds === 'number'
        ? detectionIntervalInSeconds
        : intervals.get(extension.id) ?? DEFAULT_INTERVAL
    const idleTime =
      typeof powerMonitor.getSystemIdleTime === 'function'
        ? powerMonitor.getSystemIdleTime()
        : 0
    return idleTime >= threshold ? 'idle' : 'active'
  }

  private setDetectionInterval = (
    { extension }: ExtensionEvent,
    intervalInSeconds: number,
  ): void => {
    if (typeof intervalInSeconds === 'number' && intervalInSeconds > 0) {
      // Chrome enforces a 15-second minimum; mirror that.
      intervals.set(extension.id, Math.max(15, Math.floor(intervalInSeconds)))
    }
  }
}
