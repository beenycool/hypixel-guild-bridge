export class SerialExecutor {
  private chain: Promise<void> = Promise.resolve()

  run<T>(fn: () => Promise<T>): Promise<T> {
    let resolve: (value: T) => void
    let reject: (reason: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })

    this.chain = this.chain.then(() => fn()).then(resolve!, reject!)

    return promise
  }
}
