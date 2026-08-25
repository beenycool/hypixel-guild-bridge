export class SerialExecutor {
  private chain: Promise<void> = Promise.resolve()

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(() => task())
    this.chain = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
