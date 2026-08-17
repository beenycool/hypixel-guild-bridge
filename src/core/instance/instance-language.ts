import type { StatusChange } from '../../common/application-event'
import { Status } from '../../common/connectable-instance'

export type Translator = (
  keyOrSelector: string | ((t: (key: string) => string) => string),
  options?: Record<string, unknown>
) => string

export function translateInstanceStatus(t: Translator, status: StatusChange): string {
  return t('instance.status.change', {
    from: translateStatus(t, status.from),
    to: translateStatus(t, status.to)
  })
}

function translateStatus(t: Translator, status: Status): string {
  switch (status) {
    case Status.Fresh: {
      return t('instance.status.fresh')
    }
    case Status.Connecting: {
      return t('instance.status.connecting')
    }
    case Status.Connected: {
      return t('instance.status.connected')
    }
    case Status.Disconnected: {
      return t('instance.status.disconnected')
    }
    case Status.Ended: {
      return t('instance.status.ended')
    }
    case Status.Failed: {
      return t('instance.status.failed')
    }
    default: {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Unknown status: ${status satisfies never}`)
    }
  }
}
