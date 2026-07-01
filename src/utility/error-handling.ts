import { Logger } from 'log4js'

export enum ErrorContext {
  EventHandler = 'event_handler',
  OptionalFeature = 'optional_feature',
  CriticalPath = 'critical_path'
}

export function handleError(context: ErrorContext, error: unknown, fallback?: () => unknown, logger?: Logger): void {
  switch (context) {
    case ErrorContext.EventHandler:
      if (logger) {
        logger.error('Unhandled error in event handler:', error)
      } else {
        console.error('Unhandled error in event handler:', error)
      }
      break
    case ErrorContext.OptionalFeature:
      if (fallback) {
        fallback()
      }
      break
    case ErrorContext.CriticalPath:
      throw error
  }
}
