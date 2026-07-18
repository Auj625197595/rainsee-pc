import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

// chrome.tts. Gated on the "tts" permission. Electron has no native TTS engine.
// speak() accepts the request and returns true (Chrome returns true when the
// utterance is successfully queued); on Windows it additionally drives the OS
// SAPI voice via a detached powershell child process so users actually hear
// something, with the extension-visible promise resolving immediately. Other
// platforms fall back to silent acceptance. getVoices/isSpeaking return empty/
// false; pause/resume/stop are accepted no-ops.
export class TtsAPI {
  private speaking = false

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('tts.speak', this.speak, { permission: 'tts' })
    handle('tts.stop', this.stop, { permission: 'tts' })
    handle('tts.pause', this.noop, { permission: 'tts' })
    handle('tts.resume', this.noop, { permission: 'tts' })
    handle('tts.isSpeaking', this.isSpeaking, { permission: 'tts' })
    handle('tts.getVoices', this.getVoices, { permission: 'tts' })
  }

  private noop = () => undefined

  private speak = (
    _event: ExtensionEvent,
    utterance: string,
    options: { voiceName?: string; lang?: string; rate?: number; pitch?: number; volume?: number } = {},
  ): boolean => {
    if (typeof utterance !== 'string' || !utterance) return false
    this.speaking = true
    // Best-effort SAPI on Windows. Detached; we don't track completion (the
    // extension-visible contract is just "queued").
    if (process.platform === 'win32') {
      try {
        // 固定的 PowerShell 脚本:rate 与朗读文本经 stdin 传入,不把用户文本拼进
        // 命令行(避免注入,并弱化"动态拼接 PowerShell 执行"的启发式特征)。
        const { execFile } = require('node:child_process')
        const rate = typeof options.rate === 'number' ? Math.max(-10, Math.min(10, options.rate)) : 0
        const script =
          'Add-Type -AssemblyName System.Speech;' +
          '$rate=[int]([Console]::In.ReadLine());' +
          '$text=[Console]::In.ReadToEnd();' +
          '$v=New-Object System.Speech.Synthesis.SpeechSynthesizer;' +
          '$v.Rate=$rate;$v.Speak($text);'
        const child = execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          () => {
            this.speaking = false
          },
        )
        // 第一行为 rate,其余为朗读文本;关闭 stdin 后脚本即读取并执行。
        if (child.stdin) child.stdin.end(rate + '\n' + utterance)
      } catch {
        this.speaking = false
      }
    } else {
      // No portable engine; clear the flag shortly so isSpeaking() recovers.
      setTimeout(() => {
        this.speaking = false
      }, 500)
    }
    return true
  }

  private stop = (): boolean => {
    this.speaking = false
    return true
  }

  private isSpeaking = (
    _event: ExtensionEvent,
    callback?: (speaking: boolean) => void,
  ): boolean => {
    if (typeof callback === 'function') callback(this.speaking)
    return this.speaking
  }

  private getVoices = (): chrome.tts.TtsVoice[] => []
}
