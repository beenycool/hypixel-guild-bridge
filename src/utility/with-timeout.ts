export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  const timer: { timeout: NodeJS.Timeout | undefined } = { timeout: undefined }
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer.timeout = setTimeout(() => reject(new Error(message)), Math.max(1, ms))
    if (timer.timeout) timer.timeout.unref()
  })
  promise.catch(() => {})
  try {
    const result = await Promise.race([promise, timeoutPromise])
    return result
  } finally {
    if (timer.timeout) clearTimeout(timer.timeout)
  }
}
