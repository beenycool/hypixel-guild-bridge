import RateLimiter from './rate-limiter.js'

export class UserRateLimiter {
  private readonly limiters = new Map<string, { limiter: RateLimiter; lastAccess: number }>()
  private static readonly StaleTimeoutMs = 10 * 60 * 1000
  private cleanupInterval: NodeJS.Timeout

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, UserRateLimiter.StaleTimeoutMs)
    this.cleanupInterval.unref()
  }

  async acquire(userId: string): Promise<void> {
    const entry = this.getOrCreate(userId)
    entry.lastAccess = Date.now()
    await entry.limiter.wait()
  }

  tryAcquire(userId: string): boolean {
    const entry = this.getOrCreate(userId)
    entry.lastAccess = Date.now()
    return entry.limiter.tryAcquire()
  }

  private getOrCreate(userId: string): { limiter: RateLimiter; lastAccess: number } {
    let entry = this.limiters.get(userId)
    if (entry === undefined) {
      entry = {
        limiter: new RateLimiter(this.maxRequests, this.windowMs),
        lastAccess: Date.now()
      }
      this.limiters.set(userId, entry)
    }
    return entry
  }

  private cleanup(): void {
    const cutoff = Date.now() - UserRateLimiter.StaleTimeoutMs
    for (const [userId, entry] of this.limiters) {
      if (entry.lastAccess < cutoff) {
        this.limiters.delete(userId)
      }
    }
  }
}
