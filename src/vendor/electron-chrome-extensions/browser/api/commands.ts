import { globalShortcut } from 'electron'
import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'
import debug from 'debug'

const d = debug('electron-chrome-extensions:commands')

/**
 * chrome.commands — keyboard shortcuts declared in the manifest.
 *
 * Scope (per the Chrome docs): a command's shortcut is **app-scoped** by
 * default (fires only while the browser/page is focused); `"global": true`
 * makes it OS-wide. We honor that split:
 *   - app-scoped  → matched in each tab's `before-input-event`
 *   - global      → registered with Electron's `globalShortcut`
 *
 * `_execute_action` / `_execute_browser_action` / `_execute_page_action` are
 * reserved: they do NOT dispatch `commands.onCommand` — they trigger the
 * extension action (open the popup, else fire `action.onClicked`). The
 * orchestrator injects the action activator via `setActionDispatcher`.
 */
export class CommandsAPI {
  private commandMap = new Map</* extensionId */ string, CommandEntry[]>()
  /** app-scoped accelerator lookup: tupleKey → command, live-matched in before-input-event */
  private appScopedMap = new Map<string, { extensionId: string; name: string; isExecuteAction: boolean }>()
  /** accelerator strings registered with globalShortcut, per extension (for unregister) */
  private globalRegistrations = new Map<string, string[]>()
  /** webContents currently wired with a before-input-event listener */
  private attachedWebContents = new Map<
    number,
    { wc: Electron.WebContents; handler: (event: Electron.Event, input: Electron.Input) => void }
  >()

  private actionDispatcher?: (extensionId: string) => void

  /**
   * 用户在设置页为扩展命令改键的覆盖:extId → (commandName → accelerator)。
   * '' 表示用户清除了快捷键。常驻内存;processExtension 与 setShortcut 都读它,
   * 使扩展卸载/重载后覆盖仍生效。由宿主(application.ts)在加载扩展前注入。
   */
  private overrides = new Map<string, Map<string, string>>()

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('commands.getAll', this.getAll)

    const sessionExtensions = ctx.session.extensions || ctx.session
    sessionExtensions.on('extension-loaded', (_event, extension) => {
      this.processExtension(extension)
    })

    sessionExtensions.on('extension-unloaded', (_event, extension) => {
      this.removeCommands(extension)
    })

    // Own the tab wiring at the store boundary. Some host paths register tabs
    // through ExtensionStore directly, so relying only on the public
    // ElectronChromeExtensions.addTab wrapper can leave command shortcuts
    // detached even though chrome.tabs already sees the page.
    this.ctx.store.on('tab-added', (tab: Electron.WebContents) => {
      this.attachWebContents(tab)
    })

    // The API can be constructed after extensions or tabs have already been
    // registered (session restore and extension-host reload both do this).
    // Hydrate both sides so commands work without requiring another reload.
    sessionExtensions.getAllExtensions().forEach((extension) => {
      this.processExtension(extension)
    })
    this.ctx.store.tabs.forEach((tab) => {
      this.attachWebContents(tab)
    })
  }

  /** Inject the host's action activator (opens popup / fires onClicked). */
  setActionDispatcher(fn: (extensionId: string) => void) {
    this.actionDispatcher = fn
  }

  private processExtension(extension: Electron.Extension) {
    const manifest: chrome.runtime.Manifest = extension.manifest
    if (!manifest.commands) return

    // Clean any previous registration for this extension first so a reload
    // does not accumulate duplicates / orphaned global shortcuts.
    this.removeCommands(extension)

    const commands: CommandEntry[] = []
    this.commandMap.set(extension.id, commands)

    for (const [name, detailsRaw] of Object.entries(manifest.commands!)) {
      const details: any = detailsRaw
      const isExecuteAction = EXECUTE_ACTION_RE.test(name)
      const isGlobal = !!details.global
      // 覆盖优先:用户改键命中 overrides 则用覆盖值('' = 清除),否则 manifest suggested_key。
      const ov = this.overrides.get(extension.id)?.get(name)
      const shortcut = ov !== undefined ? ov : resolveShortcut(details.suggested_key)
      const entry: CommandEntry = {
        name,
        description: details.description,
        shortcut,
        isExecuteAction,
        global: isGlobal,
      }
      commands.push(entry)

      if (!shortcut) continue
      // global → globalShortcut;app-scoped → before-input-event 查找表(first-loaded wins)。
      this.registerOne(extension.id, name, shortcut, isGlobal, isExecuteAction)
    }
  }

  private removeCommands(extension: Electron.Extension) {
    for (const accelerator of this.globalRegistrations.get(extension.id) || []) {
      try {
        globalShortcut.unregister(accelerator)
      } catch {
        /* ignore */
      }
    }
    this.globalRegistrations.delete(extension.id)

    for (const [key, entry] of this.appScopedMap) {
      if (entry.extensionId === extension.id) this.appScopedMap.delete(key)
    }

    this.commandMap.delete(extension.id)
  }

  private getAll = ({ extension }: ExtensionEvent): chrome.commands.Command[] => {
    const entries = this.commandMap.get(extension.id) || []
    return entries.map((e) => ({ name: e.name, description: e.description, shortcut: e.shortcut }))
  }

  /** 注册单个命令的快捷键(global → globalShortcut;app-scoped → 查找表,first-loaded wins)。 */
  private registerOne(extensionId: string, name: string, shortcut: string, isGlobal: boolean, isExecuteAction: boolean): boolean {
    if (isGlobal) {
      const accelerator = toElectronAccelerator(shortcut)
      try {
        if (globalShortcut.register(accelerator, () => this.dispatch(extensionId, name))) {
          const list = this.globalRegistrations.get(extensionId) || []
          list.push(accelerator)
          this.globalRegistrations.set(extensionId, list)
          return true
        }
        d(`global shortcut "${accelerator}" for ${extensionId} (${name}) was rejected (conflict)`)
      } catch {
        /* invalid accelerator */
      }
      return false
    }
    const tuple = shortcutToTuple(shortcut)
    if (!tuple) return false
    const key = tupleKey(tuple)
    if (this.appScopedMap.has(key)) return false
    this.appScopedMap.set(key, { extensionId, name, isExecuteAction })
    return true
  }

  /**
   * 注销单个命令的注册。global → globalShortcut.unregister;
   * app-scoped → 仅当查找表持有者正是本命令才删(避免误删被别的命令 first-loaded-wins 抢占的项)。
   */
  private unregisterOne(extensionId: string, name: string, shortcut: string, isGlobal: boolean) {
    if (!shortcut) return
    if (isGlobal) {
      const list = this.globalRegistrations.get(extensionId)
      if (list) {
        const accelerator = toElectronAccelerator(shortcut)
        try { globalShortcut.unregister(accelerator) } catch { /* ignore */ }
        const idx = list.indexOf(accelerator)
        if (idx >= 0) list.splice(idx, 1)
        if (list.length === 0) this.globalRegistrations.delete(extensionId)
      }
    } else {
      const tuple = shortcutToTuple(shortcut)
      if (!tuple) return
      const key = tupleKey(tuple)
      const held = this.appScopedMap.get(key)
      if (held && held.extensionId === extensionId && held.name === name) {
        this.appScopedMap.delete(key)
      }
    }
  }

  /**
   * 运行时修改某扩展命令的快捷键(设置页改键)。立即更新内存三表:
   * 注销旧注册 → 更新 commandMap + overrides → 注册新值。作用域(global/app-scoped)
   * 由 manifest 决定且不可变。注册失败(冲突/系统占用)时回滚到旧值,避免丢失原绑定。
   */
  setShortcut(extensionId: string, name: string, newShortcut: string) {
    const commands = this.commandMap.get(extensionId)
    const entry = commands?.find((c) => c.name === name)
    if (!entry) return // 扩展/命令不存在或无 commands

    const oldShortcut = entry.shortcut
    // 1) 注销旧注册(用 entry 当前生效 shortcut,非 manifest 默认)
    this.unregisterOne(extensionId, name, oldShortcut, entry.global)
    // 2) 更新内存为新值
    entry.shortcut = newShortcut
    let perExt = this.overrides.get(extensionId)
    if (!perExt) { perExt = new Map(); this.overrides.set(extensionId, perExt) }
    perExt.set(name, newShortcut)
    // 3) 注册新值('' = 清除,不注册);失败则回滚到旧值
    if (newShortcut) {
      if (!this.registerOne(extensionId, name, newShortcut, entry.global, entry.isExecuteAction)) {
        entry.shortcut = oldShortcut
        perExt.set(name, oldShortcut)
        if (oldShortcut) this.registerOne(extensionId, name, oldShortcut, entry.global, entry.isExecuteAction)
      }
    }
  }

  /** 清除某扩展命令的覆盖(name 省略=该扩展全部)。调用方随后应 reloadExtension 触发重解析恢复默认。 */
  clearOverride(extensionId: string, name?: string) {
    const perExt = this.overrides.get(extensionId)
    if (!perExt) return
    if (name) perExt.delete(name)
    else this.overrides.delete(extensionId)
  }

  /** 宿主启动时注入持久化的覆盖表(清空旧值后按 map 重建)。需在扩展加载前调。 */
  applyOverrides(map: { [extId: string]: { [name: string]: string } } | undefined) {
    this.overrides.clear()
    if (!map) return
    for (const [extId, cmds] of Object.entries(map)) {
      if (!cmds) continue
      const perExt = new Map<string, string>()
      for (const [name, accel] of Object.entries(cmds)) perExt.set(name, accel)
      this.overrides.set(extId, perExt)
    }
  }

  /**
   * 给宿主设置页用的只读快照:所有有 commands 的扩展及其命令
   * (shortcut = 覆盖后当前生效;defaultShortcut = manifest 平台默认)。
   */
  getHostSnapshot(extensions: Electron.Extension[]): HostCommandSnapshot[] {
    const out: HostCommandSnapshot[] = []
    for (const ext of extensions) {
      const entries = this.commandMap.get(ext.id)
      if (!entries || entries.length === 0) continue
      const manifestCommands: any = (ext.manifest as any)?.commands || {}
      out.push({
        id: ext.id,
        name: ext.name || (ext.manifest as any)?.name || ext.id,
        commands: entries.map((e) => ({
          name: e.name,
          description: e.description,
          shortcut: e.shortcut,
          defaultShortcut: resolveShortcut(manifestCommands[e.name]?.suggested_key),
          isExecuteAction: e.isExecuteAction,
          global: e.global,
        })),
      })
    }
    return out
  }

  /** Route a fired command: `_execute_*` → action, else → commands.onCommand. */
  dispatch(extensionId: string, name: string) {
    const commands = this.commandMap.get(extensionId) || []
    const cmd = commands.find((c) => c.name === name)
    if (cmd?.isExecuteAction) {
      if (this.actionDispatcher) {
        try {
          this.actionDispatcher(extensionId)
        } catch (e) {
          d(`action dispatch for ${extensionId} (${name}) failed: ${e}`)
        }
      }
      return
    }
    this.fireCommand(extensionId, name)
  }

  /**
   * Fire a chrome.commands.onCommand event. The active tab is passed as the
   * second argument (the `(command, tab)` callback signature); omitted when
   * no active tab is resolvable.
   */
  fireCommand(extensionId: string, commandName: string) {
    const tab = this.activeTabDetail()
    if (tab) {
      this.ctx.router.sendEvent(extensionId, 'commands.onCommand', commandName, tab)
    } else {
      this.ctx.router.sendEvent(extensionId, 'commands.onCommand', commandName)
    }
  }

  /** Minimal serializable Tab for the onCommand `tab` arg (full details via chrome.tabs.get). */
  private activeTabDetail(): chrome.tabs.Tab | null {
    const wc = this.ctx.store.getActiveTabOfCurrentWindow()
    if (!wc || wc.isDestroyed()) return null
    const win = this.ctx.store.tabToWindow.get(wc)
    return {
      id: wc.id,
      index: -1,
      windowId: win && !win.isDestroyed() ? win.id : -1,
      active: true,
      highlighted: true,
      selected: true,
      pinned: false,
      incognito: false,
      url: wc.getURL(),
      title: wc.getTitle(),
      status: 'complete',
    } as chrome.tabs.Tab
  }

  /** Attach the app-scoped shortcut matcher to a tab's webContents. */
  attachWebContents(wc: Electron.WebContents) {
    if (wc.isDestroyed() || this.attachedWebContents.has(wc.id)) return
    const handler = (event: Electron.Event, input: Electron.Input) => {
      if (input.type !== 'keyDown' || input.isAutoRepeat) return
      const tuple = inputToTuple(input)
      if (!tuple) return
      const match = this.appScopedMap.get(tupleKey(tuple))
      if (!match) return
      event.preventDefault()
      this.dispatch(match.extensionId, match.name)
    }
    wc.on('before-input-event', handler)
    this.attachedWebContents.set(wc.id, { wc, handler })
    wc.once('destroyed', () => {
      this.attachedWebContents.delete(wc.id)
    })
  }

  detachWebContents(wc: Electron.WebContents) {
    const entry = this.attachedWebContents.get(wc.id)
    if (!entry) return
    this.attachedWebContents.delete(wc.id)
    try {
      if (!entry.wc.isDestroyed()) entry.wc.removeListener('before-input-event', entry.handler)
    } catch {
      /* ignore */
    }
  }
}

interface CommandEntry {
  name: string
  description?: string
  shortcut: string
  isExecuteAction: boolean
  global: boolean
}

/** 宿主(设置页)读取的扩展命令快照条目。 */
interface HostCommandSnapshot {
  id: string
  name: string
  commands: {
    name: string
    description?: string
    shortcut: string // 覆盖后当前生效;'' 表示无快捷键
    defaultShortcut: string // manifest 平台默认
    isExecuteAction: boolean
    global: boolean
  }[]
}

const EXECUTE_ACTION_RE = /^_execute_(action|browser_action|page_action)$/

interface AcceleratorTuple {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
}

/** Map the manifest `suggested_key` (string or per-platform object) to the active platform's shortcut. */
function resolveShortcut(suggestedKey: any): string {
  if (!suggestedKey) return ''
  if (typeof suggestedKey === 'string') return suggestedKey.trim()
  if (typeof suggestedKey === 'object') {
    const plat = platformKey()
    return (suggestedKey[plat] || suggestedKey.default || '').trim()
  }
  return ''
}

function platformKey(): string {
  switch (process.platform) {
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'mac'
    case 'linux':
      return 'linux'
    default:
      return 'default'
  }
}

/** Normalize a Chrome accelerator string ("Ctrl+Shift+Y") into a comparable tuple. */
function shortcutToTuple(shortcut: string): AcceleratorTuple | null {
  const parts = shortcut.split('+').map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return null
  const tuple: AcceleratorTuple = { ctrl: false, alt: false, shift: false, meta: false, key: '' }
  for (const part of parts) {
    switch (part) {
      case 'Ctrl':
      case 'Control':
      case 'CmdOrCtrl': // Electron alias;录制组件 keyEventToAccelerator 产出此 token
      case 'CommandOrCtrl':
      case 'MacCtrl': // macOS Control key (only present in a mac-resolved shortcut)
        tuple.ctrl = true
        break
      case 'Alt':
      case 'Option':
        tuple.alt = true
        break
      case 'Shift':
        tuple.shift = true
        break
      case 'Command':
      case 'Cmd':
      case 'Meta':
      case 'Search': // ChromeOS (best-effort; non-representable elsewhere)
        tuple.meta = true
        break
      default:
        if (tuple.key) return null // two non-modifier tokens → invalid
        tuple.key = part.length === 1 ? part.toUpperCase() : part
    }
  }
  return tuple.key ? tuple : null
}

/** Build a comparable tuple from an Electron before-input-event input. */
function inputToTuple(input: Electron.Input): AcceleratorTuple | null {
  const key = codeToChromeKey(input.code, input.key)
  if (!key) return null
  return {
    ctrl: !!input.control,
    alt: !!input.alt,
    shift: !!input.shift,
    meta: !!input.meta,
    key,
  }
}

/** Map an Electron KeyboardEvent.code to a Chrome command key token (shift/locale independent). */
function codeToChromeKey(code: string, key: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3) // KeyY → Y
  if (/^Digit[0-9]$/.test(code)) return code.slice(5) // Digit0 → 0
  switch (code) {
    case 'Comma':
      return 'Comma'
    case 'Period':
      return 'Period'
    case 'Home':
      return 'Home'
    case 'End':
      return 'End'
    case 'PageUp':
      return 'PageUp'
    case 'PageDown':
      return 'PageDown'
    case 'Space':
      return 'Space'
    case 'Insert':
      return 'Insert'
    case 'Delete':
      return 'Delete'
    case 'ArrowUp':
      return 'Up'
    case 'ArrowDown':
      return 'Down'
    case 'ArrowLeft':
      return 'Left'
    case 'ArrowRight':
      return 'Right'
    case 'MediaTrackNext':
      return 'MediaNextTrack'
    case 'MediaPlayPause':
      return 'MediaPlayPause'
    case 'MediaTrackPrevious':
      return 'MediaPrevTrack'
    case 'MediaStop':
      return 'MediaStop'
    default:
      break
  }
  // Fallback to `key` for anything not covered above (should not occur for
  // valid manifest shortcuts, whose key set is fixed).
  if (key.length === 1 && /[a-z0-9]/i.test(key)) return key.toUpperCase()
  return key
}

/** Canonical string key for an accelerator tuple (stable modifier order). */
function tupleKey(t: AcceleratorTuple): string {
  return (
    (t.ctrl ? 'Ctrl+' : '') +
    (t.alt ? 'Alt+' : '') +
    (t.shift ? 'Shift+' : '') +
    (t.meta ? 'Meta+' : '') +
    t.key
  )
}

/** Translate a Chrome accelerator to an Electron globalShortcut accelerator string. */
function toElectronAccelerator(shortcut: string): string {
  return shortcut
    .split('+')
    .map((s) => s.trim())
    .map((part) => (part === 'MediaPrevTrack' ? 'MediaPreviousTrack' : part))
    .join('+')
}
