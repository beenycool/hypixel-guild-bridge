import { TokenBucket } from './token-bucket.js'

export class UserRateLimiter {
  private readonly buckets = new Map<string, { bucket: TokenBucket; lastAccess: number }>()
  private static readonly StaleTimeoutMs = 10 * 60 * 1000
  private cleanupInterval: NodeJS.Timeout

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {
    this.cleanupInterval = setInterval(() => this.cleanup(), UserRateLimiter.StaleTimeoutMs)
    this.cleanupInterval.unref()
  }

  async acquire(userId: string): Promise<void> {
    const entry = this.getOrCreate(userId)
    entry.lastAccess = Date.now()
    await entry.bucket.acquire()
  }

  tryAcquire(userId: string): boolean {
    const entry = this.getOrCreate(userId)
    entry.lastAccess = Date.now()
    return entry.bucket.tryAcquire()
  }

  private getOrCreate(userId: string): { bucket: TokenBucket; lastAccess: number } {
    let entry = this.buckets.get(userId)
    if (entry === undefined) {
      entry = {
        bucket: new TokenBucket(this.maxRequests, this.windowMs),
        lastAccess: Date.now()
      }
      this.buckets.set(userId, entry)
    }
    return entry
  }

  private cleanup(): void {
    const cutoff = Date.now() - UserRateLimiter.StaleTimeoutMs
    for (const [userId, entry] of this.buckets) {
      if (entry.lastAccess < cutoff) {
        this.buckets.delete(userId)
      }
    }
  }
}
