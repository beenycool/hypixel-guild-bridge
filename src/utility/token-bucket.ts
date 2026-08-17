import RateLimiter from './rate-limiter.js'

export class TokenBucket {
  private readonly limiter: RateLimiter

  constructor(max: number, refillMs: number) {
    this.limiter = new RateLimiter(max, refillMs)
  }

  async acquire(): Promise<void> {
    await this.limiter.wait()
  }

  tryAcquire(): boolean {
    return this.limiter.tryAcquire()
  }
}
