import { roleMention, userMention } from 'discord.js'

import type Application from '../../../application'
import { Permission } from '../../../common/application-event'

export function translateNoPermission(
  application: Application,
  requiredPermission: Exclude<Permission, Permission.Anyone>,
  bridgeId?: string
): string {
  const roles: string[] = []
  const admins = application.discordInstance.getStaticConfig().adminIds

  switch (requiredPermission) {
    case Permission.Helper: {
      roles.push(
        ...application.core.discordConfigurations.getHelperRoleIds(),
        ...application.core.discordConfigurations.getOfficerRoleIds(),
        ...application.core.discordConfigurations.getOwnerRoleIds()
      )
      if (bridgeId) {
        roles.push(
          ...application.core.bridgeConfigurations.getHelperRoleIds(bridgeId),
          ...application.core.bridgeConfigurations.getOfficerRoleIds(bridgeId),
          ...application.core.bridgeConfigurations.getOwnerRoleIds(bridgeId)
        )
      }
      break
    }
    case Permission.Officer: {
      roles.push(
        ...application.core.discordConfigurations.getOfficerRoleIds(),
        ...application.core.discordConfigurations.getOwnerRoleIds()
      )
      if (bridgeId) {
        roles.push(
          ...application.core.bridgeConfigurations.getOfficerRoleIds(bridgeId),
          ...application.core.bridgeConfigurations.getOwnerRoleIds(bridgeId)
        )
      }
      break
    }
    case Permission.Owner: {
      roles.push(...application.core.discordConfigurations.getOwnerRoleIds())
      if (bridgeId) {
        roles.push(...application.core.bridgeConfigurations.getOwnerRoleIds(bridgeId))
      }
      break
    }
    case Permission.Admin: {
      break
    }
  }

  const t = application.getTranslatorForBridge(bridgeId)

  let result: string
  if (roles.length === 0 && admins.length === 0) {
    result = t(($) => $['discord.message.no-permission'])
  } else if (roles.length > 0 && admins.length === 0) {
    result = t(($) => $['discord.message.no-permission-roles'], {
      roles: roles.map((roleId) => roleMention(roleId))
    })
  } else if (roles.length === 0 && admins.length > 0) {
    result = t(($) => $['discord.message.no-permission-admin'], {
      admins: admins.map((adminId) => userMention(adminId))
    })
  } else {
    result = t(($) => $['discord.message.no-permission-roles-admin'], {
      roles: roles.map((roleId) => roleMention(roleId)),
      admins: admins.map((adminId) => userMention(adminId))
    })
  }

  return simpleEscape(result)
}

function simpleEscape(text: string): string {
  return text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}
