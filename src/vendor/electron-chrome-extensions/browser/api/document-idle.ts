const DOCUMENT_IDLE_FALLBACK_MS = 1_000

type PendingIdle = {
  timer: ReturnType<typeof setTimeout>
  token: number
}

/**
 * Runs document_idle work after load when possible, with a bounded fallback
 * for pages whose load event is delayed indefinitely by a hanging resource.
 */
export class DocumentIdleScheduler<Frame extends object> {
  private readonly pending = new WeakMap<Frame, PendingIdle>()

  constructor(
    private readonly tokenFor: (frame: Frame) => number,
    private readonly fallbackMs = DOCUMENT_IDLE_FALLBACK_MS,
  ) {}

  schedule(frame: Frame, callback: () => void) {
    this.cancel(frame)
    const token = this.tokenFor(frame)
    const timer = setTimeout(() => {
      const current = this.pending.get(frame)
      if (!current || current.timer !== timer) return
      this.pending.delete(frame)
      if (current.token !== this.tokenFor(frame)) return
      callback()
    }, this.fallbackMs)
    this.pending.set(frame, { timer, token })
  }

  runNow(frame: Frame, callback: () => void) {
    this.cancel(frame)
    callback()
  }

  cancel(frame: Frame) {
    const current = this.pending.get(frame)
    if (!current) return
    clearTimeout(current.timer)
    this.pending.delete(frame)
  }
}
