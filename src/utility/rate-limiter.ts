export default class RateLimiter {
  private readonly maxCount: number
  private readonly interval: number

  private currentTokens: number
  private lastRefill: number

  constructor(count: number, interval: number) {
    this.maxCount = Math.max(1, count)
    this.interval = Math.max(1, interval)
    this.currentTokens = this.maxCount
    this.lastRefill = Date.now()
  }

  async wait(): Promise<void> {
    this.refill()

    while (this.currentTokens <= 0) {
      const waitTime = Math.max(1, this.interval / this.maxCount)
      await new Promise((resolve) => setTimeout(resolve, waitTime))
      this.refill()
    }

    this.currentTokens--
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    if (elapsed < this.interval) return

    const tokensToAdd = Math.floor((elapsed / this.interval) * this.maxCount)
    this.currentTokens = Math.min(this.maxCount, this.currentTokens + tokensToAdd)
    this.lastRefill = now
  }
}
