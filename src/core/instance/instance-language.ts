import type { StatusChange } from '../../common/application-event'
import { InstanceMessageType } from '../../common/application-event'
import { Status } from '../../common/connectable-instance'

export type Translator = (
  keyOrSelector: string | ((t: (key: string) => string) => string),
  options?: Record<string, unknown>
) => string

export function translateInstanceMessage(t: Translator, key: InstanceMessageType): string {
  switch (key) {
    case InstanceMessageType.MinecraftAuthenticationCode: {
      return t('instance.message.authentication-code')
    }
    case InstanceMessageType.MinecraftInstanceNotAutoConnect: {
      return t('instance.message.no-autoconnect')
    }
    case InstanceMessageType.MinecraftKicked: {
      return t('instance.message.minecraft-kicked')
    }
    case InstanceMessageType.MinecraftBanned: {
      return t('instance.message.minecraft-banned')
    }
    case InstanceMessageType.MinecraftInternetProblems: {
      return t('instance.message.internet-problems')
    }
    case InstanceMessageType.MinecraftFailedTooManyTimes: {
      return t('instance.message.failed-too-many-times')
    }
    case InstanceMessageType.MinecraftEnded: {
      return t('instance.message.minecraft-ended')
    }
    case InstanceMessageType.MinecraftIncompatible: {
      return t('instance.message.version-incompatible')
    }
    case InstanceMessageType.MinecraftKickedLoggedFromAnotherLocation: {
      return t('instance.message.logged-from-another-location')
    }
    case InstanceMessageType.MinecraftXboxDown: {
      return t('instance.message.xbox-down')
    }
    case InstanceMessageType.MinecraftXboxThrottled: {
      return t('instance.message.xbox-throttled')
    }
    case InstanceMessageType.MinecraftNoAccount: {
      return t('instance.message.no-account')
    }
    case InstanceMessageType.MinecraftRestarting: {
      return t('instance.message.restarting')
    }
    case InstanceMessageType.MinecraftGuildKicked: {
      return t('instance.message.guild-kicked')
    }
    case InstanceMessageType.MinecraftAuthExpired: {
      return t('instance.message.auth-expired')
    }
    case InstanceMessageType.MinecraftAuthInvalid: {
      return t('instance.message.auth-invalid')
    }
    default: {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Unknown instance type ${key satisfies never}`)
    }
  }
}

export function translateAuthenticationCodeExpired(t: Translator): string {
  return t('instance.message.authentication-code-expired')
}

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
