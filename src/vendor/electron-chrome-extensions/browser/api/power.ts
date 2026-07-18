import { powerSaveBlocker } from 'electron'
import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

// chrome.power. Does not require a manifest permission. Maps Chrome's keep-awake
// "level" onto Electron powerSaveBlocker, tracking the active blocker per
// extension+level so releaseKeepAwake stops the right one. Common in media/
// presentation/long-task extensions that must prevent sleep.
const blockers = new Map</* extensionId */ string, Map</* level */ string, number>>()

const LEVEL_TO_TYPE: Record<string, 'prevent-app-suspension' | 'prevent-display-sleep'> = {
  system: 'prevent-app-suspension',
  display: 'prevent-display-sleep',
}

export class PowerAPI {
  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('power.requestKeepAwake', this.requestKeepAwake)
    handle('power.releaseKeepAwake', this.releaseKeepAwake)
  }

  private mapFor(extensionId: string) {
    let m = blockers.get(extensionId)
    if (!m) {
      m = new Map()
      blockers.set(extensionId, m)
    }
    return m
  }

  private requestKeepAwake = (
    { extension }: ExtensionEvent,
    level: 'system' | 'display' = 'system',
  ): void => {
    const type = LEVEL_TO_TYPE[level] || 'prevent-app-suspension'
    const m = this.mapFor(extension.id)
    const existing = m.get(level)
    if (existing !== undefined && powerSaveBlocker.isStarted(existing)) return
    const id = powerSaveBlocker.start(type)
    m.set(level, id)
  }

  private releaseKeepAwake = (
    { extension }: ExtensionEvent,
    level: 'system' | 'display' = 'system',
  ): void => {
    const m = blockers.get(extension.id)
    if (!m) return
    const id = m.get(level)
    if (id !== undefined) {
      if (powerSaveBlocker.isStarted(id)) powerSaveBlocker.stop(id)
      m.delete(level)
    }
  }
}
