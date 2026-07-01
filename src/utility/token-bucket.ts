export class TokenBucket {
  private tokens: number
  private queue: Array<{ resolve: () => void; timer: NodeJS.Timeout }> = []
  private lastRefill = Date.now()
  private static readonly MaxQueueSize = 1000
  private static readonly AcquireTimeoutMs = 30_000

  constructor(
    private max: number,
    private refillMs: number
  ) {
    this.max = Math.max(1, max)
    this.refillMs = Math.max(1, refillMs)
    this.tokens = this.max
  }

  async acquire(): Promise<void> {
    this.lazyRefill()
    if (this.tokens > 0) {
      this.tokens--
      return
    }
    if (this.queue.length >= TokenBucket.MaxQueueSize) {
      throw new Error('TokenBucket queue full')
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex((e) => e.resolve === resolve)
        if (idx !== -1) this.queue.splice(idx, 1)
        reject(new Error('TokenBucket acquire timeout'))
      }, TokenBucket.AcquireTimeoutMs)
      timer.unref()
      this.queue.push({ resolve, timer })
    })
  }

  tryAcquire(): boolean {
    this.lazyRefill()
    if (this.tokens > 0) {
      this.tokens--
      return true
    }
    return false
  }

  private lazyRefill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    if (elapsed < this.refillMs) return
    const intervals = Math.floor(elapsed / this.refillMs)
    this.tokens = Math.min(this.max, this.tokens + intervals)
    this.lastRefill += intervals * this.refillMs
    while (this.tokens > 0 && this.queue.length > 0) {
      const entry = this.queue.shift()
      if (entry) {
        clearTimeout(entry.timer)
        this.tokens--
        entry.resolve()
      }
    }
  }
}
