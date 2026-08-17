interface RateLimitWindow {
  windowMs: number
  maxRequests: number
}

// quick and dirty sliding window rate limiter so people don't spam expensive commands
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>()
  private readonly windows: readonly RateLimitWindow[]
  private readonly longestWindow: number
  private readonly timer: NodeJS.Timeout

  constructor(windows: RateLimitWindow[], gcIntervalMs = 300_000) {
    if (windows.length === 0) {
      throw new Error('Need at least one window for rate limiter lol')
    }

    this.windows = windows
    this.longestWindow = Math.max(...windows.map((w) => w.windowMs))

    // clean up stale entries periodically so we don't leak memory
    this.timer = setInterval(() => {
      this.sweep()
    }, gcIntervalMs)
    this.timer.unref()
  }

  check(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now()
    const ts = (this.hits.get(key) ?? []).filter((t) => t > now - this.longestWindow)

    let waitMs = 0
    for (const win of this.windows) {
      const inWin = ts.filter((t) => t > now - win.windowMs)
      if (inWin.length >= win.maxRequests) {
        // user hit limit for this window
        const oldest = inWin[inWin.length - win.maxRequests]
        const retry = oldest + win.windowMs - now
        if (retry > waitMs) waitMs = retry
      }
    }

    if (waitMs > 0) {
      this.hits.set(key, ts)
      return { allowed: false, retryAfterMs: waitMs }
    }

    ts.push(now)
    this.hits.set(key, ts)
    return { allowed: true, retryAfterMs: 0 }
  }

  private sweep(): void {
    const cutoff = Date.now() - this.longestWindow
    for (const [k, ts] of this.hits) {
      const keep = ts.filter((t) => t > cutoff)
      if (keep.length === 0) {
        this.hits.delete(k)
      } else {
        this.hits.set(k, keep)
      }
    }
  }
}
