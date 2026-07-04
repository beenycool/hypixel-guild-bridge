import type { PromiseCatchHandler } from '../common/unexpected-error-handler'

import type Duration from './duration'
import { SerialExecutor } from './serial-executor.js'

export interface ScheduleOptions {
  errorHandler: PromiseCatchHandler
  abortSignal?: AbortSignal
}

export function setIntervalAsync(
  callback: () => Promise<unknown>,
  options: ScheduleOptions & { delay: Duration }
): NodeJS.Timeout {
  const queue = new SerialExecutor()
  let pendingCount = 0

  return setInterval(() => {
    if (pendingCount === 0) {
      pendingCount++
      void queue
        .run(() => callback())
        .finally(() => {
          pendingCount--
        })
        .catch(options.errorHandler)
    }
  }, options.delay.toMilliseconds())
}

export function setTimeoutAsync(
  callback: () => Promise<unknown>,
  options: ScheduleOptions & { delay: Duration }
): NodeJS.Timeout {
  const queue = new SerialExecutor()

  return setTimeout(() => {
    // allow to queue as many as possible if refresh() is used
    void queue.run(() => callback()).catch(options.errorHandler)
  }, options.delay.toMilliseconds())
}
