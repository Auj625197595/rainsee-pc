import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

interface StoredAlarm {
  alarm: chrome.alarms.Alarm
  timer: ReturnType<typeof setTimeout>
}

const MINUTE_MS = 60_000

/**
 * Generic chrome.alarms implementation. Electron's native runtime does not
 * provide chrome.alarms, so extensions that schedule work with it (very common)
 * would crash with "Cannot read properties of undefined (reading 'create')".
 *
 * Alarms are kept in-memory per extension and fire `alarms.onAlarm` through the
 * router — which for an MV3 background starts the service worker for the scope
 * before delivering, so a fired alarm wakes a suspended SW (matching Chrome).
 * Not persisted across app restarts (Chrome persists alarms); acceptable for a
 * compatibility shim and can be upgraded later if needed.
 */
export class AlarmsAPI {
  private alarms = new Map</* extensionId */ string, Map</* name */ string, StoredAlarm>>()

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('alarms.create', this.create)
    handle('alarms.get', this.get)
    handle('alarms.getAll', this.getAll)
    handle('alarms.clear', this.clear)
    handle('alarms.clearAll', this.clearAll)

    const sessionExtensions = (ctx.session as any).extensions || ctx.session
    sessionExtensions.on?.('extension-unloaded', (_event: any, extension: Electron.Extension) => {
      this.clearAllForExtension(extension.id)
    })
  }

  private mapFor(extensionId: string) {
    let m = this.alarms.get(extensionId)
    if (!m) {
      m = new Map()
      this.alarms.set(extensionId, m)
    }
    return m
  }

  private schedule(extensionId: string, alarm: chrome.alarms.Alarm) {
    const m = this.mapFor(extensionId)
    const existing = m.get(alarm.name)
    if (existing) clearTimeout(existing.timer)

    const fire = () => {
      const cur = this.alarms.get(extensionId)?.get(alarm.name)
      if (!cur) return
      this.ctx.router.sendEvent(extensionId, 'alarms.onAlarm', { ...cur.alarm })
      if (typeof cur.alarm.periodInMinutes === 'number') {
        cur.alarm.scheduledTime = Date.now() + cur.alarm.periodInMinutes * MINUTE_MS
        cur.timer = setTimeout(fire, cur.alarm.periodInMinutes * MINUTE_MS)
        if ((cur.timer as any).unref) (cur.timer as any).unref()
      } else {
        this.alarms.get(extensionId)?.delete(alarm.name)
      }
    }

    const delay = Math.max(0, alarm.scheduledTime - Date.now())
    const timer = setTimeout(fire, delay)
    if ((timer as any).unref) (timer as any).unref()
    m.set(alarm.name, { alarm, timer })
  }

  private create = (
    { extension }: ExtensionEvent,
    arg1?: string | chrome.alarms.AlarmCreateInfo,
    arg2?: chrome.alarms.AlarmCreateInfo,
  ): void => {
    let name = ''
    let info: chrome.alarms.AlarmCreateInfo
    if (typeof arg1 === 'string') {
      name = arg1
      info = arg2 || ({} as chrome.alarms.AlarmCreateInfo)
    } else {
      info = arg1 || ({} as chrome.alarms.AlarmCreateInfo)
    }

    const now = Date.now()
    let scheduledTime: number
    if (typeof info.when === 'number') {
      scheduledTime = info.when
    } else if (typeof info.delayInMinutes === 'number') {
      scheduledTime = now + info.delayInMinutes * MINUTE_MS
    } else if (typeof info.periodInMinutes === 'number') {
      scheduledTime = now + info.periodInMinutes * MINUTE_MS
    } else {
      // No timing given — Chrome warns and fires roughly immediately.
      scheduledTime = now
    }

    this.schedule(extension.id, {
      name,
      scheduledTime,
      periodInMinutes: info.periodInMinutes,
    })
  }

  private get = (
    { extension }: ExtensionEvent,
    name = '',
  ): chrome.alarms.Alarm | undefined => {
    const a = this.alarms.get(extension.id)?.get(name)
    return a ? { ...a.alarm } : undefined
  }

  private getAll = ({ extension }: ExtensionEvent): chrome.alarms.Alarm[] => {
    const m = this.alarms.get(extension.id)
    return m ? [...m.values()].map((s) => ({ ...s.alarm })) : []
  }

  private clear = ({ extension }: ExtensionEvent, name = ''): boolean => {
    const m = this.alarms.get(extension.id)
    const s = m?.get(name)
    if (s) {
      clearTimeout(s.timer)
      m!.delete(name)
      return true
    }
    return false
  }

  private clearAll = ({ extension }: ExtensionEvent): boolean => {
    const m = this.alarms.get(extension.id)
    if (!m || m.size === 0) return false
    for (const s of m.values()) clearTimeout(s.timer)
    m.clear()
    return true
  }

  private clearAllForExtension(extensionId: string) {
    const m = this.alarms.get(extensionId)
    if (!m) return
    for (const s of m.values()) clearTimeout(s.timer)
    this.alarms.delete(extensionId)
  }
}
