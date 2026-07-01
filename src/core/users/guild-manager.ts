import assert from 'node:assert'
import { performance } from 'node:perf_hooks'

import { SerialExecutor } from '../../utility/serial-executor.js'

import type { InstanceType, MinecraftRawChatEvent } from '../../common/application-event'
import { MinecraftSendChatPriority } from '../../common/application-event'
import SubInstance from '../../common/sub-instance'
import Duration from '../../utility/duration'
import { Timeout } from '../../utility/timeout'
import type { Core } from '../core'

export class GuildManager extends SubInstance<Core, InstanceType.Core, void> {
  public static readonly DefaultDataExpire = Duration.seconds(30)
  private readonly guildInfo = new Map<string, GuildInformation>()

  /**
   * Fetch online players in a guild
   *
   * @param instanceName the minecraft instance name to fetch the stats from
   * @param newerThan duration in milliseconds of how old the data can be at most
   *
   * @return an object containing
   */
  public async list(
    instanceName: string,
    newerThan: Duration = GuildManager.DefaultDataExpire,
    options?: { timeoutMs?: number }
  ): Promise<Readonly<GuildFetch>> {
    const guildInfo = this.getGuildInfo(instanceName)
    const getCached = () => {
      if (guildInfo.guild === undefined || guildInfo.guild.fetchedAt + newerThan.toMilliseconds() < Date.now()) {
        return
      }

      return guildInfo.guild
    }

    let guild = getCached()
    if (guild !== undefined) {
      const age = Date.now() - guild.fetchedAt
      this.logger.debug('[guildManager] list(%s) cache hit (age %dms)', instanceName, age)
      return guild
    }

    const t0 = performance.now()
    const result = await this.queueTask(guildInfo, async () => {
      // check again in an atomic operation before fetching again
      // since there is a chance previous task has already fetched the data while awaiting in queue
      guild = getCached()
      if (guild !== undefined) {
        const age = Date.now() - guild.fetchedAt
        this.logger.debug('[guildManager] list(%s) cache hit after queue (age %dms)', instanceName, age)
        return guild
      }

      this.logger.debug('[guildManager] list(%s) cache miss, sending /guild list...', instanceName)
      const t1 = performance.now()
      guild = await this.listNow(instanceName, options?.timeoutMs)
      this.logger.debug(
        '[guildManager] list(%s) listNow took %dms (%d members)',
        instanceName,
        Math.round(performance.now() - t1),
        guild.members.length
      )
      this.logger.debug('[guildManager] list(%s) members parsed: %d', instanceName, guild.members.length)
      guildInfo.guild = guild
      return guild
    })
    this.logger.debug('[guildManager] list(%s) total with queue %dms', instanceName, Math.round(performance.now() - t0))
    return result
  }

  private getGuildInfo(instanceName: string): GuildInformation {
    let guild = this.guildInfo.get(instanceName)
    if (guild === undefined) {
      guild = { commandQueue: new SerialExecutor(), guild: undefined }
      this.guildInfo.set(instanceName, guild)
    }

    return guild
  }

  /**
   * Finish previous task before calling the new task to execute.
   * All operations in the task but be atomic and fully valid by the end of every cycle in the promise.
   *
   * @param guild the guild object OR instanceName string
   * @param task a callback that will be executed to start the new promise AFTER the old task has finished executing
   */
  public async queueTask<T>(guild: GuildInformation | string, task: () => Promise<T>): Promise<T> {
    if (typeof guild === 'string') guild = this.getGuildInfo(guild)
    return guild.commandQueue.run(task)
  }

  /*
   * All operations on guild object must be atomic.
   * That means data within must be done within a cycle and not separated by an "async/await".
   * So all data must be "whole" across cycles at all times.
   */
  private async listNow(instanceName: string, timeoutMs?: number): Promise<Readonly<GuildFetch>> {
    const timeout = new Timeout<Error | undefined>(timeoutMs ?? 30_000)
    const guild: GuildFetch = { fetchedAt: Date.now(), name: '', members: [] }

    let currentRank: string | undefined = undefined
    let totalEntries = 0

    const nameRegex = /^Guild Name: ([\W\w]{1,64})/g
    const rankRegex = /^\s+-- (Guild Master|[\S -]{1,16}) --$/g
    const memberRegex = /(?:§\w|)(\w{2,16})(§\w) \u25CF/g
    const totalRegex = /^Total Members: (\d+)$/g
    const onlineRegex = /^Online Members: (\d+)$/g

    const logger = this.logger

    const chatListener = function (event: MinecraftRawChatEvent): void {
      if (event.message.length === 0) return
      if (event.instanceName !== instanceName) return

      const nameMatch = nameRegex.exec(event.message)
      if (nameMatch != undefined) {
        guild.name = nameMatch[1]
        return
      }

      const rankMatch = rankRegex.exec(event.message)
      if (rankMatch != undefined) {
        // ranks can end with space but will not show up in chat messages
        currentRank = rankMatch[1].trim()
        return
      }

      let usernameMatch: RegExpExecArray | null
      while ((usernameMatch = memberRegex.exec(event.rawMessage)) != undefined) {
        if (currentRank === undefined) {
          timeout.resolve(new Error('Detected members before detecting rank somehow!'))
          return
        }

        const username = usernameMatch[1]
        totalEntries++
        if (guild.members.some((member) => member.username === username)) continue

        switch (usernameMatch[2]) {
          case '§c': {
            guild.members.push({ username: username, rank: currentRank, online: false })
            // player offline. do nothing
            break
          }
          case '§a': {
            guild.members.push({ username: username, rank: currentRank, online: true })
            break
          }
          default: {
            throw new Error(`invalid online indicator character: ${usernameMatch[0]}`)
          }
        }
      }

      const totalMatch = totalRegex.exec(event.message)
      if (totalMatch != undefined) {
        const displayed = Number(totalMatch[1])
        const detected = totalEntries

        if (detected !== displayed) {
          logger.warn(
            `Detected guild total members count does not match the displayed amount for ${instanceName}. ` +
              `detected=${detected}, displayed=${displayed}. ` +
              `Continuing with partial results (Hypixel may duplicate or truncate member names).`
          )
        }
      }

      const onlineMatch = onlineRegex.exec(event.message)
      if (onlineMatch != undefined) {
        const displayed = Number(onlineMatch[1])
        const detected = guild.members.filter((member) => member.online).length

        if (detected !== displayed) {
          logger.warn(
            `Detected guild online members count does not match the displayed amount for ${instanceName}. ` +
              `detected=${detected}, displayed=${displayed}. Continuing with partial results.`
          )
        }

        timeout.resolve(undefined) // online message is the last in the listing output
        return
      }
    }

    this.application.on('minecraftChat', chatListener)
    await this.application.sendMinecraft([instanceName], MinecraftSendChatPriority.High, undefined, `/guild list`)
    const error = await timeout.wait()
    this.application.off('minecraftChat', chatListener)
    if (error) throw error
    if (timeout.timedOut()) throw new Error('Timed out before fully fetching guild listing data')

    assert.ok(guild.name.length > 0, 'Could not detect any guild name somehow')
    assert.ok(guild.members.length > 0, 'Could not detect any members at all??')

    guild.members = [...new Map(guild.members.map((member) => [member.username, member])).values()]

    return Object.freeze(guild)
  }
}

interface GuildInformation {
  commandQueue: SerialExecutor

  guild: GuildFetch | undefined
}

export interface GuildFetch {
  fetchedAt: number

  name: string
  members: GuildMember[]
}

export interface GuildMember {
  username: string
  rank: string
  online: boolean
}
