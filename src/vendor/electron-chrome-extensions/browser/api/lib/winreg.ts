import { spawn } from 'child_process'
import debug from 'debug'

const d = debug('electron-chrome-extensions:winreg')

export function parseRegistryQueryOutput(output: string, key?: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    // The value-name column is localized by reg.exe and can be mojibake when
    // Electron decodes the active Windows code page as UTF-8. REG_* type names
    // are stable, so parse around that column instead of matching "(Default)".
    const match = line.trim().match(/^(.*?)\s{2,}(REG_[A-Z0-9_]+)\s{2,}(.*)$/i)
    if (!match) continue
    if (key && match[1].trim().toLowerCase() !== key.toLowerCase()) continue
    return match[3] || null
  }
  return null
}

export function readRegistryKey(
  hive: string,
  path: string,
  key?: string,
  registryView?: '32' | '64',
) {
  if (process.platform !== 'win32') {
    return Promise.reject('Unsupported platform')
  }

  return new Promise<string | null>((resolve, reject) => {
    const args = [
      'query',
      `${hive}\\${path}`,
      ...(key ? ['/v', key] : []),
      ...(registryView ? [`/reg:${registryView}`] : []),
    ]
    d('reg %s', args.join(' '))
    const child = spawn('reg', args)

    let output = ''
    let error = ''

    child.stdout.on('data', (data) => {
      output += data.toString()
    })

    child.stderr.on('data', (data) => {
      error += data.toString()
    })

    child.on('close', (code) => {
      if (code !== 0 || error) {
        return reject(new Error(`Failed to read registry: ${error}`))
      }

      resolve(parseRegistryQueryOutput(output, key))
    })
  })
}
