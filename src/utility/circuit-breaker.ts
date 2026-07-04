export class CircuitBreaker {
  private failures = 0
  private lastFailure = 0
  private state: 'closed' | 'open' | 'half-open' = 'closed'
  private halfOpenLock = false

  constructor(
    private readonly threshold = 5,
    private readonly resetMs = 30_000
  ) {}

  async execute<T>(function_: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure >= this.resetMs) {
        if (this.halfOpenLock) {
          throw new Error('Circuit breaker is open')
        } else {
          this.halfOpenLock = true
          this.state = 'half-open'
        }
      } else {
        throw new Error('Circuit breaker is open')
      }
    }

    try {
      const result = await function_()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  getState(): string {
    return this.state
  }

  private onSuccess(): void {
    this.failures = 0
    this.state = 'closed'
    this.halfOpenLock = false
  }

  private onFailure(): void {
    this.failures++
    this.lastFailure = Date.now()
    if (this.failures >= this.threshold) {
      this.state = 'open'
    }
    this.halfOpenLock = false
  }
}
