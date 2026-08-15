interface RateLimitWindow {
  windowMs: number
  maxRequests: number
}

export class SlidingWindowRateLimiter {
  private readonly timestamps = new Map<string, number[]>()
  private readonly windows: readonly RateLimitWindow[]
  private readonly maxWindowMs: number
  private readonly cleanupInterval: NodeJS.Timeout

  constructor(windows: RateLimitWindow[], cleanupIntervalMs = 300_000) {
    if (windows.length === 0) {
      throw new Error('At least one rate limit window is required')
    }

    this.windows = windows
    this.maxWindowMs = Math.max(...windows.map((w) => w.windowMs))

    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, cleanupIntervalMs)
    this.cleanupInterval.unref()
  }

  check(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now()
    const entries = this.timestamps.get(key) ?? []

    const cutoff = now - this.maxWindowMs
    const pruned = entries.filter((t) => t > cutoff)

    let maxRetryAfterMs = 0

    for (const window of this.windows) {
      const windowStart = now - window.windowMs
      const windowEntries = pruned.filter((t) => t > windowStart)

      if (windowEntries.length >= window.maxRequests) {
        const earliest = windowEntries[windowEntries.length - window.maxRequests]
        const retryAfterMs = earliest + window.windowMs - now
        maxRetryAfterMs = Math.max(maxRetryAfterMs, retryAfterMs)
      }
    }

    if (maxRetryAfterMs > 0) {
      this.timestamps.set(key, pruned)
      return { allowed: false, retryAfterMs: maxRetryAfterMs }
    }

    pruned.push(now)
    this.timestamps.set(key, pruned)
    return { allowed: true, retryAfterMs: 0 }
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.maxWindowMs
    for (const [key, entries] of this.timestamps) {
      const pruned = entries.filter((t) => t > cutoff)
      if (pruned.length === 0) {
        this.timestamps.delete(key)
      } else {
        this.timestamps.set(key, pruned)
      }
    }
  }
}
