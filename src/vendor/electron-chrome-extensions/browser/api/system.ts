import { screen } from 'electron'
import os from 'node:os'
import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

// chrome.system.cpu / system.memory / system.display. Each sub-namespace is
// gated on its own manifest permission ("system.cpu", "system.memory",
// "system.display"). Implemented in one class for cohesion; the renderer side
// still exposes three separate namespaces (chrome.system.cpu|memory|display).
//
// Read methods return real data from Node os / Electron screen. Write methods
// (setDisplayProperties, setEnabledDisplays, ...) are accepted as no-ops —
// Electron exposes no per-app display mutation, and a resolved promise is
// friendlier to extensions than a thrown "not a registered handler".

const toChromeBounds = (b: Electron.Rectangle) => ({
  left: Math.round(b.x),
  top: Math.round(b.y),
  width: Math.round(b.width),
  height: Math.round(b.height),
})

const ARCH_MAP: Record<string, string> = {
  arm: 'arm',
  arm64: 'arm64',
  ia32: 'x86-32',
  x32: 'x86-32',
  x64: 'x86-64',
  mips: 'mips',
  mipsel: 'mips',
  mips64: 'mips64',
}

export class SystemAPI {
  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('system.cpu.getInfo', this.getCpuInfo, { permission: 'system.cpu' })
    handle('system.memory.getInfo', this.getMemoryInfo, { permission: 'system.memory' })
    handle('system.display.getInfo', this.getDisplayInfo, { permission: 'system.display' })
    handle('system.display.getDisplayLayout', this.getDisplayLayout, {
      permission: 'system.display',
    })
    // Write ops: accept and no-op (Electron has no display-mutation API).
    handle('system.display.setDisplayProperties', this.noop, { permission: 'system.display' })
    handle('system.display.setEnabledDisplays', this.noop, { permission: 'system.display' })
    handle('system.display.setDisplayLayout', this.noop, { permission: 'system.display' })
    handle('system.display.overscanCalibration', this.noop, { permission: 'system.display' })
    handle('system.display.showNativeTouchCalibration', this.noop, {
      permission: 'system.display',
    })
    handle('system.display.completeCustomTouchCalibration', this.noop, {
      permission: 'system.display',
    })
  }

  private noop = () => undefined

  private getCpuInfo = (): chrome.system.cpu.CpuInfo => {
    const cpus = os.cpus()
    const archName = ARCH_MAP[os.arch()] || 'x86-64'
    return {
      archName: archName as chrome.system.cpu.ArchName,
      features: [],
      numOfProcessors: cpus.length,
      processors: cpus.map((c) => {
        const t = c.times
        const total = (t.user || 0) + (t.sys || 0) + (t.idle || 0) + (t.irq || 0) + (t.nice || 0)
        return {
          usage: {
            user: Math.floor(t.user || 0),
            kernel: Math.floor(t.sys || 0),
            idle: Math.floor(t.idle || 0),
            total: Math.floor(total),
          },
        }
      }),
    }
  }

  private getMemoryInfo = (): chrome.system.memory.MemoryInfo => {
    return {
      capacity: os.totalmem(),
      availableCapacity: os.freemem(),
    }
  }

  private toDisplayInfo = (d: Electron.Display, index: number) => {
    const primary = screen.getPrimaryDisplay()
    const isPrimary = d.id === primary.id
    let touchSupport: string = 'none'
    if (d.touchSupport === 'available' || d.touchSupport === 'unknown') touchSupport = 'available'
    return {
      id: String(d.id ?? index),
      name: d.label || `Display ${index + 1}`,
      bounds: toChromeBounds(d.bounds),
      workArea: toChromeBounds(d.workArea),
      scaleFactor: d.scaleFactor || 1,
      rotation: d.rotation || 0,
      isPrimary,
      internal: !!d.internal,
      isUnified: false,
      touchSupport,
      displayZoom: 1,
      availableDisplayZoomFactors: [1],
    }
  }

  private getDisplayInfo = (): any[] => {
    return screen.getAllDisplays().map((d, i) => this.toDisplayInfo(d, i))
  }

  private getDisplayLayout = (): any[] => {
    const primary = screen.getPrimaryDisplay()
    return screen.getAllDisplays().map((d, i) => ({
      id: String(d.id ?? i),
      bounds: toChromeBounds(d.bounds),
      workArea: toChromeBounds(d.workArea),
      isPrimary: d.id === primary.id,
      isUnified: false,
    }))
  }
}
