import assert from 'node:assert'
import { performance } from 'node:perf_hooks'

import type { APIEmbed } from 'discord.js'
import { escapeMarkdown, SlashCommandBuilder, userMention } from 'discord.js'
import type { Client, Status } from 'hypixel-api-reborn'

import type Application from '../../../application.js'
import type { UserLink } from '../../../common/application-event.js'
import { Color, InstanceType } from '../../../common/application-event.js'
import { Status as InstanceStatus } from '../../../common/connectable-instance.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'
import { CommandScope } from '../../../common/commands.js'
import type UnexpectedErrorHandler from '../../../common/unexpected-error-handler.js'
import type { GuildFetch } from '../../../core/users/guild-manager'
import type { MojangApi } from '../../../core/users/mojang'
import type { Verification } from '../../../core/users/verification'
import { DefaultCommandFooter } from '../common/discord-config.js'
import { pageMessage } from '../utility/discord-pager.js'

function createEmbed(instances: Map<string, string[]>, onlyOnline: boolean): APIEmbed[] {
  const entries: string[] = []
  let total = 0

  for (const [guildName, list] of instances) {
    const players = list.filter((value) => value.startsWith('  - ')).length

    total += players

    entries.push(`**${escapeMarkdown(guildName)} (${players})**\n`)

    if (list.length > 0) {
      for (const user of list) {
        entries.push(user + '\n')
      }
    } else {
      entries.push('_Could not fetch information from this instance._\n')
    }

    entries[entries.length - 1] += '\n'
  }

  const pages = []

  /*
    Max allowed characters length is 4000.
    Originally the variable was set to 3900 with 100 leeway for headers/etc.
    However, for some unknown bug, nearing the max length will result in weird artifacts and bugs
    trimming the end of the text when displayed on client side.
   */
  const MaxLength = 3300
  /*
   * Although still unknown, sometimes too many bullet points
   * create the weird client artifact.
   */
  const MaxCount = 150

  let currentLength = 0
  let currentCount = 0
  for (const entry of entries) {
    if (pages.length === 0 || currentLength + entry.length > MaxLength || currentCount >= MaxCount) {
      currentLength = 0
      currentCount = 0

      pages.push({
        color: Color.Default,
        title: onlyOnline ? `Guild Online Players (${total}):` : `Guild Players (${total}):`,
        description: '',
        footer: {
          text: DefaultCommandFooter
        }
      })
    }

    currentLength += entry.length
    currentLength++
    const lastPage = pages.at(-1)
    assert.ok(lastPage)
    lastPage.description += entry
  }

  return pages as APIEmbed[]
}

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .addSubcommand((subCommand) =>
        subCommand.setName('online').setDescription('List online players in your guild(s)')
      )
      .addSubcommand((subCommand) =>
        subCommand.setName('all').setDescription('List all players in your guild(s), even offline players')
      )
      .setName('list')
      .setDescription('List players in your guild(s)'),
  scope: CommandScope.Chat,

  handler: async function (context) {
    const t0 = performance.now()
    context.application.logger.info('[list] deferring reply...')
    await context.interaction.deferReply()
    context.application.logger.info('[list] deferred reply in %dms', Math.round(performance.now() - t0))

    const onlyOnline = context.interaction.options.getSubcommand() === 'online'
    const t1 = performance.now()
    const lists: Map<string, string[]> = await listMembers(
      context.application,
      context.errorHandler,
      context.application.mojangApi,
      context.application.hypixelApi,
      onlyOnline,
      context.bridgeId
    )
    context.application.logger.info('[list] listMembers took %dms', Math.round(performance.now() - t1))

    if (lists.size === 0) {
      await context.interaction.editReply({
        embeds: [
          {
            description:
              `No Minecraft instance exist.\n` +
              'This is a Minecraft command that requires a working Minecraft account connected to the bridge.\n' +
              `Check the tutorial on how to add a Minecraft account before using this command.`,
            color: Color.Info,
            footer: {
              text: DefaultCommandFooter
            }
          }
        ]
      })
      context.application.logger.info('[list] no instances, total %dms', Math.round(performance.now() - t0))
      return
    }

    const t2 = performance.now()
    await pageMessage(context.interaction, createEmbed(lists, onlyOnline), context.errorHandler)
    context.application.logger.info(
      '[list] embed+reply took %dms, total %dms',
      Math.round(performance.now() - t2),
      Math.round(performance.now() - t0)
    )
  }
} satisfies DiscordCommandHandler

async function listMembers(
  app: Application,
  errorHandler: UnexpectedErrorHandler,
  mojangApi: MojangApi,
  hypixelApi: Client,
  onlyOnline: boolean,
  bridgeId?: string
): Promise<Map<string, string[]>> {
  const t0 = performance.now()
  const guildsLookup = await getGuilds(app, errorHandler, bridgeId)
  app.logger.info(
    '[list] getGuilds took %dms (%d fetched, %d failed)',
    Math.round(performance.now() - t0),
    guildsLookup.fetched.length,
    guildsLookup.failed.length
  )

  const allUsernames = new Set<string>()
  const onlineUsernames = new Set<string>()
  for (const guild of guildsLookup.fetched) {
    for (const member of guild.members) {
      allUsernames.add(member.username)
      if (!member.online) continue
      onlineUsernames.add(member.username.toLowerCase())
    }
  }
  app.logger.info('[list] %d total members, %d online across all guilds', allUsernames.size, onlineUsernames.size)

  const t1 = performance.now()
  const mojangProfiles = await mojangApi.profilesByUsername(allUsernames)
  app.logger.info(
    '[list] mojangApi.profilesByUsername(%d users) took %dms',
    allUsernames.size,
    Math.round(performance.now() - t1)
  )
  const onlineMojangProfiles = new Map<string, string>()
  for (const [username, uuid] of mojangProfiles) {
    if (uuid === undefined) continue
    if (onlineUsernames.has(username.toLowerCase())) {
      onlineMojangProfiles.set(username, uuid)
    }
  }

  const t2 = performance.now()
  const statuses = await look(onlineMojangProfiles, hypixelApi, errorHandler, app.logger)
  app.logger.info('[list] look(%d profiles) took %dms', onlineMojangProfiles.size, Math.round(performance.now() - t2))

  const t3 = performance.now()
  const result = new Map<string, string[]>()
  for (const failedInstanceName of guildsLookup.failed) {
    result.set(failedInstanceName, [])
  }
  for (const guild of guildsLookup.fetched) {
    let guildResult = result.get(guild.name)
    if (guildResult === undefined) {
      guildResult = []
      result.set(guild.name, guildResult)
    }

    const ranksOrder: string[] = []
    for (const member of guild.members) {
      if (!ranksOrder.includes(member.rank)) ranksOrder.push(member.rank)
    }

    const sortedMembers = guild.members.toSorted((a, b) => a.username.localeCompare(b.username))
    for (const currentRank of ranksOrder) {
      const guildTemporarilyResult: string[] = []
      for (const member of sortedMembers) {
        if (!member.online || member.rank !== currentRank) continue

        const link = await getUserLink(app.core.verification, mojangProfiles, member.username)
        const status = statuses.get(member.username.toLowerCase())
        guildTemporarilyResult.push(`  - ${formatLocation(member.username, link, status)}`)
      }
      if (!onlyOnline) {
        for (const member of sortedMembers) {
          if (member.online || member.rank !== currentRank) continue

          const link = await getUserLink(app.core.verification, mojangProfiles, member.username)
          guildTemporarilyResult.push(`  - ${formatUser(member.username, link)}`)
        }
      }

      if (guildTemporarilyResult.length > 0) {
        guildResult.push(`- **${escapeMarkdown(currentRank)}**`)
        guildResult.push(...guildTemporarilyResult)
      }
    }
  }

  app.logger.info('[list] formatting took %dms', Math.round(performance.now() - t3))
  app.logger.info('[list] listMembers total %dms', Math.round(performance.now() - t0))

  return result
}

/*
  Map of username-status where username is always lowercased
 */
async function look(
  mojangProfiles: Map<string, string>,
  hypixelApi: Client,
  errorHandler: UnexpectedErrorHandler,
  logger?: { info: (message: string, ...arguments_: unknown[]) => void }
): Promise<Map<string, Status>> {
  const t0 = performance.now()
  const result = new Map<string, Status>()

  const entries = [...mojangProfiles.entries()]
  const batchSize = 10

  logger?.info('[list] look() %d profiles, processing in batches of %d', entries.length, batchSize)

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize)
    await Promise.all(
      batch.map(([username, uuid]) =>
        hypixelApi
          .getStatus(uuid)
          .then((status) => result.set(username.toLowerCase(), status))
          .catch(errorHandler.promiseCatch(`fetching hypixel status of ${uuid} for command /list`))
      )
    )
  }

  logger?.info('[list] look() %d statuses in %dms', result.size, Math.round(performance.now() - t0))
  return result
}

async function getUserLink(
  verification: Verification,
  mojangProfiles: Map<string, string | undefined>,
  username: string
): Promise<UserLink | undefined> {
  for (const [mojangUsername, uuid] of mojangProfiles) {
    if (mojangUsername.toLowerCase() !== username.toLowerCase()) continue
    if (uuid === undefined) return undefined

    return verification.findByIngame(uuid)
  }

  return undefined
}

function formatUser(username: string, link: UserLink | undefined): string {
  let message = `**${escapeMarkdown(username)}**`
  if (link !== undefined) message += ` (${userMention(link.discordId)})`

  return message
}

function formatLocation(username: string, link: UserLink | undefined, session: Status | undefined): string {
  let message = `${formatUser(username, link)} `

  if (session === undefined) return message + ' is *__unknown?__*'
  if (!session.online) return message + ' is *__offline?__*'

  message += '*' // START discord markdown. italic
  if (session.game != undefined) message += `playing __${escapeMarkdown(session.game.name)}__`
  if (session.mode != undefined) message += ` in ${escapeMarkdown(session.mode.toLowerCase())}`
  message += '*' // END discord markdown. italic

  return message
}

async function getGuilds(
  app: Application,
  errorHandler: UnexpectedErrorHandler,
  bridgeId?: string
): Promise<GuildsLookup> {
  const t0 = performance.now()
  const tasks: Promise<unknown>[] = []

  const result: GuildsLookup = { fetched: [], failed: [] }

  const connectedInstances = new Map<string, boolean>()
  for (const inst of app.minecraftManager.getAllInstances()) {
    connectedInstances.set(inst.instanceName.toLowerCase(), inst.currentStatus() === InstanceStatus.Connected)
  }

  for (const instanceName of app.getInstancesNames(InstanceType.Minecraft)) {
    if (!app.bridgeResolver.shouldProcessEvent(bridgeId, instanceName)) continue

    if (!connectedInstances.get(instanceName.toLowerCase())) {
      const status = app.minecraftManager
        .getAllInstances()
        .find((i) => i.instanceName.toLowerCase() === instanceName.toLowerCase())
        ?.currentStatus()
      app.logger.info('[list] guildManager.list(%s) SKIPPED (status=%s)', instanceName, status ?? 'unknown')
      result.failed.push(instanceName)
      continue
    }

    const tInstance = performance.now()
    const task = app.core.guildManager
      .list(instanceName, undefined, { timeoutMs: 5000 })
      .then((guild) => {
        app.logger.info(
          '[list] guildManager.list(%s) took %dms (%d members, %d online)',
          instanceName,
          Math.round(performance.now() - tInstance),
          guild.members.length,
          guild.members.filter((m) => m.online).length
        )
        result.fetched.push(guild)
      })
      .catch((error: unknown) => {
        app.logger.info(
          '[list] guildManager.list(%s) FAILED after %dms: %s',
          instanceName,
          Math.round(performance.now() - tInstance),
          String(error)
        )
        errorHandler.error('fetching guild info', error)
        result.failed.push(instanceName)
      })

    tasks.push(task)
  }

  await Promise.all(tasks)
  app.logger.info('[list] getGuilds total %dms', Math.round(performance.now() - t0))
  return result
}

interface GuildsLookup {
  fetched: GuildFetch[]
  failed: string[]
}
