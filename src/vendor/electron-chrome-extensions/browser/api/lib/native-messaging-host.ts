import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { app } from 'electron'
import debug from 'debug'
import { ExtensionSender, IpcEvent } from '../../router'
import { readRegistryKey } from './winreg'

const d = debug('electron-chrome-extensions:nativeMessaging')
const MAX_NATIVE_MESSAGE_BYTES = 64 * 1024 * 1024

interface NativeConfig {
  name: string
  description: string
  path: string
  type: 'stdio'
  allowed_origins: string[]
}

function isValidConfig(config: any): config is NativeConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    typeof config.name === 'string' &&
    typeof config.description === 'string' &&
    typeof config.path === 'string' &&
    config.type === 'stdio' &&
    Array.isArray(config.allowed_origins)
  )
}

// Chromium accepts JavaScript-style comments in native-messaging manifests.
// Several enterprise installers (including CFCA BCM) ship the Chromium
// copyright header as leading `//` lines, so plain JSON.parse rejects a
// manifest Chrome/Edge accepts. Strip comments without touching comment-like
// text inside JSON strings (paths, URLs, descriptions, etc.).
function stripJsonComments(source: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === '/' && next === '/') {
      i += 2
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i++
      if (i < source.length) out += source[i]
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < source.length) {
        if (source[i] === '\n' || source[i] === '\r') out += source[i]
        if (source[i] === '*' && source[i + 1] === '/') {
          i++
          break
        }
        i++
      }
      continue
    }
    out += ch
  }
  return out.replace(/^\uFEFF/, '')
}

async function getConfigSearchPaths(application: string) {
  const appJson = `${application}.json`
  let searchPaths: string[]
  switch (process.platform) {
    case 'darwin':
      searchPaths = [
        path.join('/Library/Google/Chrome/NativeMessagingHosts', appJson),
        // Also look under Chrome's directory since some apps only install their
        // config there
        path.join(
          os.homedir(),
          'Library',
          'Application Support',
          'Google/Chrome/NativeMessagingHosts',
          appJson,
        ),
        path.join(app.getPath('userData'), 'NativeMessagingHosts', appJson),
      ]
      break
    case 'linux':
      searchPaths = [
        path.join('/etc/opt/chrome/native-messaging-hosts/', appJson),
        path.join(os.homedir(), '.config/google-chrome/NativeMessagingHosts/', appJson),
        path.join(app.getPath('userData'), 'NativeMessagingHosts', appJson),
      ]
      break
    case 'win32': {
      const registryPaths = [
        `Software\\Google\\Chrome\\NativeMessagingHosts\\${application}`,
        `Software\\Microsoft\\Edge\\NativeMessagingHosts\\${application}`,
        // Explicit WOW6432Node paths are needed on a few Windows/Electron
        // combinations where `reg query ... /reg:32` succeeds in a terminal
        // but the spawned application process still sees an empty redirected
        // view. Chromium probes the physical 32-bit registration as well.
        `Software\\WOW6432Node\\Google\\Chrome\\NativeMessagingHosts\\${application}`,
        `Software\\WOW6432Node\\Microsoft\\Edge\\NativeMessagingHosts\\${application}`,
      ]
      const lookups: Array<Promise<string | null>> = []
      for (const registryPath of registryPaths) {
        for (const hive of ['HKLM', 'HKCU']) {
          // A 64-bit Electron process queries the 64-bit registry view by
          // default, while many native hosts are installed by 32-bit setup
          // programs under WOW6432Node. Probe both views like Chromium does.
          lookups.push(readRegistryKey(hive, registryPath, undefined, '64'))
          lookups.push(readRegistryKey(hive, registryPath, undefined, '32'))
        }
      }
      searchPaths = (
        await Promise.allSettled(lookups)
      )
        .map((result) => (result.status === 'fulfilled' ? result.value : undefined))
        .filter((value, index, all) => !!value && all.indexOf(value) === index) as string[]
      // CFCA's 32-bit BCM installer uses this stable installation layout.
      // Keep it as a final product-specific fallback because some deployed
      // machines expose the registry entry only to Edge/Chrome's broker view,
      // not to Electron's spawned `reg.exe` process.
      if (application === 'com.cfca.seceditctl.bcm') {
        const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
        const cfcaManifest = path.join(
          programFilesX86,
          'CFCA',
          'SecEditCtlHost.BCM.Setup',
          'com.cfca.SecEditCtl.BCM-win.json',
        )
        if (!searchPaths.includes(cfcaManifest)) searchPaths.push(cfcaManifest)
      }
      break
    }
    default:
      throw new Error('Unsupported platform')
  }
  return searchPaths
}

async function readNativeMessagingHostConfig(
  application: string,
): Promise<NativeConfig | undefined> {
  const searchPaths = await getConfigSearchPaths(application)
  d('searching', searchPaths)
  try {
    console.log(
      `[crx-nmh-diag] search app=${application} paths=${JSON.stringify(searchPaths)}`,
    )
  } catch {}
  for (const filePath of searchPaths) {
    try {
      const data = await fs.readFile(filePath)
      const config = JSON.parse(stripJsonComments(data.toString()))
      if (isValidConfig(config)) {
        // Chrome 规范(Windows):manifest 的 path 可以是相对路径,相对于 manifest 文件
        // 所在目录解析。IDM 的 IDMMsgHost.json 里 path 就是 "IDMMsgHost.exe"(相对),
        // 原代码直接 fs.stat(config.path) 会按 CWD 解析→ENOENT→destroy()→connectNative
        // 失败→扩展拿不到桌面连接(IDM 视频浮层/下载条因此不出现)。这里把相对 path 解析成
        // 相对 manifest 目录的绝对路径。
        if (config.path && !path.isAbsolute(config.path)) {
          config.path = path.join(path.dirname(filePath), config.path)
        }
        d('read config in %s', filePath, config)
        return config
      } else {
        d('%s contained invalid config', filePath, config)
        console.log(`[crx-nmh-diag] invalid-config app=${application} path=${filePath}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        d('unable to read %s', filePath)
      } else {
        d('unknown error', error)
      }
      try {
        console.log(
          `[crx-nmh-diag] read-failed app=${application} path=${filePath} error=${
            (error as any)?.message || error
          }`,
        )
      } catch {}
      continue
    }
  }
  return undefined
}
export class NativeMessagingHost {
  private process?: ReturnType<typeof spawn>
  private sender?: ExtensionSender
  private connectionId: string
  private connected: boolean = false
  private destroyed: boolean = false
  private pending?: any[]
  private keepAlive: boolean
  private endServiceWorkerTask?: () => void
  private pendingResponse?: {
    resolve: (message: any) => void
    reject: (error: Error) => void
  }
  private receiveBuffer = Buffer.alloc(0)

  ready?: Promise<void>

  constructor(
    extensionId: string,
    sender: ExtensionSender,
    connectionId: string,
    application: string,
    keepAlive: boolean = true,
  ) {
    this.keepAlive = keepAlive
    this.sender = sender
    if (keepAlive) {
      this.sender.ipc.on(`crx-native-msg-${connectionId}`, this.receiveExtensionMessage)

      // A native Port is a long-lived extension connection. Chromium keeps an
      // MV3 service worker alive while such a Port is open; otherwise FDM's
      // background worker stops after initialization while wenativehost.exe is
      // left running, and later download commands have no live receiver.
      const serviceWorkerSender = sender as Electron.ServiceWorkerMain
      if (typeof serviceWorkerSender.startTask === 'function') {
        try {
          const task = serviceWorkerSender.startTask()
          this.endServiceWorkerTask = () => task.end()
        } catch (error) {
          d('unable to keep service worker alive: %o', error)
        }
      }
    }
    this.connectionId = connectionId
    this.ready = this.launch(application, extensionId)
  }

  destroy(reason: Error = new Error('Native messaging host disconnected')) {
    if (this.destroyed) return
    this.destroyed = true
    this.connected = false
    this.receiveBuffer = Buffer.alloc(0)
    const pendingResponse = this.pendingResponse
    this.pendingResponse = undefined
    pendingResponse?.reject(reason)
    if (this.process) {
      this.process.kill()
      this.process = undefined
    }
    if (this.keepAlive && this.sender) {
      this.sender.ipc.off(`crx-native-msg-${this.connectionId}`, this.receiveExtensionMessage)
      this.sender.send(`crx-native-msg-${this.connectionId}-disconnect`)
    }
    this.sender = undefined
    if (this.endServiceWorkerTask) {
      try {
        this.endServiceWorkerTask()
      } catch (error) {
        d('unable to end service worker native messaging task: %o', error)
      }
      this.endServiceWorkerTask = undefined
    }
  }

  private async launch(application: string, extensionId: string) {
    const config = await readNativeMessagingHostConfig(application)
    if (this.destroyed) return
    if (!config) {
      d('launch: unable to find %s for %s', application, extensionId)
      console.log(`[crx-nmh-diag] config-not-found ext=${extensionId} app=${application}`)
      this.destroy()
      return
    }

    const extensionUrl = `chrome-extension://${extensionId}/`
    if (!config.allowed_origins?.includes(extensionUrl)) {
      d('launch: %s not in allowed origins', extensionId)
      console.log(`[crx-nmh-diag] origin-denied ext=${extensionId} app=${application}`)
      this.destroy()
      return
    }

    let isFile = false
    try {
      const stat = await fs.stat(config.path)
      isFile = stat.isFile()
    } catch (error) {
      d('launch: unable to find %s', config.path, error)
    }
    if (this.destroyed) return

    if (!isFile) {
      console.log(
        `[crx-nmh-diag] executable-not-found ext=${extensionId} app=${application} path=${config.path}`,
      )
      this.destroy()
      return
    }

    d('launch: spawning %s for %s', config.path, extensionId)
    // [DIAG] 临时诊断:确认 connectNative 被调用 + 路径解析正确(IDM 视频浮层排查)
    console.log(`[crx-nmh-diag] launch ext=${extensionId} app=${application} path=${config.path}`)
    this.process = spawn(config.path, [extensionUrl], {
      shell: false,
    })

    this.process.stdout!.on('data', this.receive)
    this.process.stderr!.on('data', (data: Buffer) => {
      d('stderr: %s', data.toString())
    })
    this.process.on('error', (err: Error) => {
      d('error: %s', err)
      this.destroy(err)
    })
    this.process.on('exit', (code: number | null) => {
      d('exited %d', code)
      this.destroy(new Error(`Native messaging host exited with code ${code ?? 'unknown'}`))
    })

    this.connected = true

    if (this.pending && this.pending.length > 0) {
      d('sending %d pending messages', this.pending.length)
      this.pending.forEach((msg) => this.send(msg))
      this.pending = []
    }
  }

  private receiveExtensionMessage = (_event: IpcEvent, message: any) => {
    this.send(message)
  }

  private send(json: any) {
    d('send', json)

    if (!this.connected) {
      const pending = this.pending || (this.pending = [])
      pending.push(json)
      d('send: pending')
      return
    }

    const payload = Buffer.from(JSON.stringify(json), 'utf8')
    const buffer = Buffer.allocUnsafe(4 + payload.length)
    buffer.writeUInt32LE(payload.length, 0)
    payload.copy(buffer, 4)
    this.process!.stdin!.write(buffer)
  }

  private receive = (data: Buffer) => {
    this.receiveBuffer =
      this.receiveBuffer.length === 0
        ? Buffer.from(data)
        : Buffer.concat([this.receiveBuffer, data])

    while (this.receiveBuffer.length >= 4) {
      const length = this.receiveBuffer.readUInt32LE(0)
      if (length > MAX_NATIVE_MESSAGE_BYTES) {
        d('receive: invalid oversized frame %d', length)
        this.destroy(new Error(`Native messaging host sent an oversized frame (${length} bytes)`))
        return
      }
      if (this.receiveBuffer.length < 4 + length) return

      const payload = this.receiveBuffer.subarray(4, 4 + length)
      this.receiveBuffer = this.receiveBuffer.subarray(4 + length)
      let message: any
      try {
        message = JSON.parse(payload.toString('utf8'))
      } catch (error) {
        d('receive: invalid JSON frame %o', error)
        this.destroy(new Error('Native messaging host sent invalid JSON'))
        return
      }
      d('receive: %s', message)
      if (this.keepAlive && this.sender) {
        this.sender.send(`crx-native-msg-${this.connectionId}`, message)
      } else {
        const pendingResponse = this.pendingResponse
        this.pendingResponse = undefined
        pendingResponse?.resolve(message)
        // runtime.sendNativeMessage is a one-shot connection. Close the
        // process after its first complete response instead of leaving an
        // idle native host behind for every call.
        this.destroy()
      }
    }
  }

  sendAndReceive(message: any) {
    if (this.destroyed) {
      return Promise.reject(new Error('Native messaging host is unavailable'))
    }
    if (this.pendingResponse) {
      return Promise.reject(new Error('Native messaging host already has a pending response'))
    }
    return new Promise((resolve, reject) => {
      this.pendingResponse = { resolve, reject }
      // Register the resolver before writing. A fast native host may return a
      // complete frame in the same turn that stdin is flushed.
      try {
        this.send(message)
      } catch (error) {
        this.pendingResponse = undefined
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
}
