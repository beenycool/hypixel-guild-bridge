import type Application from '../application'
import { InstanceType } from '../common/application-event'
import { Instance } from '../common/instance'
import Duration from '../utility/duration'
import { setIntervalAsync } from '../utility/scheduling'
import { sleep } from '../utility/shared-utility'

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

    const bots = this.application.minecraftManager.getMinecraftBots()
    if (bots.length === 0) return
    const bot = bots[0]

    let hypixelGuild
    try {
      hypixelGuild = await this.application.hypixelApi.getGuild('player', bot.uuid)
    } catch (error: unknown) {
      this.logger.warn('Failed to fetch Hypixel guild for auto-linker', error)
      return
    }

    const guildMembers = hypixelGuild.members
    if (guildMembers.length === 0) return

    const bridges = this.application.bridgeResolver.getAllBridges()
    const configuredChannelIds = new Set<string>()
    for (const bridge of bridges) {
      for (const id of bridge.publicChannelIds) configuredChannelIds.add(id)
      for (const id of bridge.officerChannelIds) configuredChannelIds.add(id)
      for (const id of bridge.loggerChannelIds) configuredChannelIds.add(id)
      for (const id of bridge.promoteChannelIds) configuredChannelIds.add(id)
    }

    if (configuredChannelIds.size === 0) return

    const bridgeGuilds = client.guilds.cache.filter((guild) =>
      guild.channels.cache.some((channel) => configuredChannelIds.has(channel.id))
    )

    if (bridgeGuilds.size === 0) return

    let linked = 0
    for (const member of guildMembers) {
      if (this.application.core.verification.findByIngame(member.uuid)) continue

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
          if (this.application.core.verification.findByDiscord(discordId)) continue

          const matchedName =
            discordMember.user.username.toLowerCase() === discordUsername ||
            discordMember.user.tag.toLowerCase() === discordUsername ||
            discordMember.displayName.toLowerCase() === discordUsername

          if (matchedName) {
            this.application.core.verification.addConfirmedLink(discordId, member.uuid)
            this.logger.info(
              `Auto-linked Discord ${discordMember.user.username} (${discordId}) ` +
                `to MC ${player.nickname} (${member.uuid})`
            )
            linked++
            break
          }
        } catch {
          // member not found or fetch error, skip
        }
      }
    }

    if (linked > 0) {
      this.logger.info(`Auto-linker completed: ${linked} new links created`)
    }
  }
}
