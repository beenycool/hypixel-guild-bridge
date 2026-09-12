import type Application from '../application'
import { InstanceType } from '../common/application-event'
import { Instance } from '../common/instance'
import Duration from '../utility/duration'
import { setIntervalAsync } from '../utility/scheduling'
import { sleep } from '../utility/shared-utility'

import { getFirstConnectedBridgeMinecraftInstanceName } from './discord/common/bridge-minecraft-instances.js'

interface FailedLookup {
  timestamp: number
}

export default class AutoLinker extends Instance<InstanceType.Utility> {
  private static readonly DefaultCheckInterval = Duration.minutes(30)
  private static readonly PlayerFetchDelay = Duration.milliseconds(800)
  private static readonly FailedLookupRetry = Duration.hours(24)

  private readonly failedLookups = new Map<string, FailedLookup>()

  constructor(application: Application) {
    super(application, 'auto-linker', InstanceType.Utility)

    setIntervalAsync(() => this.autoLink(), {
      delay: AutoLinker.DefaultCheckInterval,
      errorHandler: this.errorHandler.promiseCatch('auto-linker cycle')
    })
  }

  private async autoLink(): Promise<void> {
    const client = this.application.discordInstance.getClient()
    if (!client.isReady()) return

    let linked = 0
    for (const bridge of this.application.bridgeResolver.getAllBridges()) {
      linked += await this.autoLinkBridge(bridge).catch((error: unknown) => {
        this.logger.warn(`Auto-linker failed for bridge ${bridge.id}`, error)
        return 0
      })
    }

    if (linked > 0) {
      this.logger.info(`Auto-linker completed: ${linked} new links created`)
    }
  }

  private async autoLinkBridge(bridge: {
    id: string
    publicChannelIds: string[]
    officerChannelIds: string[]
    loggerChannelIds: string[]
    promoteChannelIds: string[]
  }): Promise<number> {
    const client = this.application.discordInstance.getClient()

    const botInstanceName = getFirstConnectedBridgeMinecraftInstanceName(this.application, bridge.id)
    if (botInstanceName === undefined) {
      this.logger.info(`Auto-linker: no connected Minecraft account for bridge ${bridge.id}, skipping.`)
      return 0
    }

    const bot = this.application.minecraftManager
      .getMinecraftBots()
      .find((entry) => entry.instanceName === botInstanceName)
    if (bot === undefined) {
      this.logger.info(`Auto-linker: no self-broadcast for Minecraft account ${botInstanceName}, skipping.`)
      return 0
    }

    let hypixelGuild
    try {
      hypixelGuild = await this.application.hypixelApi.getGuild('player', bot.uuid)
    } catch (error: unknown) {
      this.logger.warn(`Failed to fetch Hypixel guild for auto-linker bridge ${bridge.id}`, error)
      return 0
    }

    const guildMembers = hypixelGuild.members
    if (guildMembers.length === 0) return 0

    const configuredChannelIds = new Set<string>([
      ...bridge.publicChannelIds,
      ...bridge.officerChannelIds,
      ...bridge.loggerChannelIds,
      ...bridge.promoteChannelIds
    ])

    if (configuredChannelIds.size === 0) return 0

    const bridgeGuilds = client.guilds.cache.filter((guild) =>
      guild.channels.cache.some((channel) => configuredChannelIds.has(channel.id))
    )

    if (bridgeGuilds.size === 0) return 0

    let linked = 0
    for (const member of guildMembers) {
      if (this.application.core.verification.findByIngame(member.uuid, bridge.id)) continue

      const failed = this.failedLookups.get(member.uuid)
      if (failed && Date.now() - failed.timestamp < AutoLinker.FailedLookupRetry.toMilliseconds()) continue

      await sleep(AutoLinker.PlayerFetchDelay.toMilliseconds())

      let player
      try {
        player = await this.application.hypixelApi.getPlayer(member.uuid)
      } catch {
        this.failedLookups.set(member.uuid, { timestamp: Date.now() })
        continue
      }

      const discordSocial = player.socialMedia.find((s: { id: string }) => s.id === 'DISCORD')
      if (!discordSocial?.link) {
        this.failedLookups.set(member.uuid, { timestamp: Date.now() })
        continue
      }

      const discordUsername = discordSocial.link.toLowerCase()

      for (const guild of bridgeGuilds.values()) {
        try {
          const fetched = await guild.members.fetch({ query: discordUsername, limit: 1 })
          const discordMember = fetched.first()
          if (!discordMember) continue

          const discordId = discordMember.id
          if (this.application.core.verification.findByDiscord(discordId, bridge.id)) continue

          const matchedName =
            discordMember.user.username.toLowerCase() === discordUsername ||
            discordMember.user.tag.toLowerCase() === discordUsername ||
            discordMember.displayName.toLowerCase() === discordUsername

          if (matchedName) {
            this.application.core.verification.addConfirmedLink(discordId, member.uuid, bridge.id)
            this.logger.info(
              `Auto-linked Discord ${discordMember.user.username} (${discordId}) ` +
                `to MC ${player.nickname} (${member.uuid}) for bridge ${bridge.id}`
            )
            linked++
            break
          }
        } catch {
          // Hypixel player fetch failed
        }
      }
    }

    return linked
  }
}
