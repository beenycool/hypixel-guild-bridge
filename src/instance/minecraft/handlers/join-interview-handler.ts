import type { InterviewConfig } from '../../../application-config.js'
import type { ChatEvent, GuildPlayerEvent } from '../../../common/application-event.js'
import {
  ChannelType,
  GuildPlayerEventType,
  InstanceType,
  MinecraftSendChatPriority
} from '../../../common/application-event.js'
import { Status } from '../../../common/connectable-instance.js'
import SubInstance from '../../../common/sub-instance'
import type ClientSession from '../client-session.js'
import type MinecraftInstance from '../minecraft-instance.js'

interface InterviewSession {
  username: string
  timeoutMs: number
  timeoutId: ReturnType<typeof setTimeout> | undefined
}

/**
 * Asks players that request to join the guild whether they are an alt.
 * The bot friends the applicant and asks the configured question via private
 * message, relaying every answer to officer chat. Officers can reply in
 * officer chat (in-game or on Discord) and the bot relays their response back
 * to the player via PM. Officer messages prefixed with `-` are excluded from
 * being relayed to the player.
 * Can be triggered automatically on a join request or manually via the
 * /interrogate command / the Interrogate button on the join request embed.
 */
export default class JoinInterviewHandler extends SubInstance<
  MinecraftInstance,
  InstanceType.Minecraft,
  ClientSession
> {
  private static readonly DefaultQuestion = 'Are you an alt of an existing guild member?'
  private static readonly DefaultTimeoutMs = 10 * 60_000
  private static readonly ExcludePrefix = '-'

  private readonly sessions = new Map<string, InterviewSession>()

  constructor(clientInstance: MinecraftInstance) {
    super(clientInstance)

    this.application.on('guildPlayer', (event) => {
      void this.onGuildPlayer(event).catch(this.errorHandler.promiseCatch('handling guild player event for interview'))
    })

    this.application.on('joinInterviewRequest', (event) => {
      void this.onInterviewRequest(event.instanceName, event.username).catch(
        this.errorHandler.promiseCatch('handling join interview request')
      )
    })

    this.application.on('chat', (event) => {
      void this.onChat(event).catch(this.errorHandler.promiseCatch('handling chat for interview'))
    })
  }

  private resolveInterviewConfig(): InterviewConfig | undefined {
    const bridgeId = this.clientInstance.bridgeId
    if (bridgeId === undefined) return undefined

    const bridge = this.application.config.bridges?.find((config) => config.id === bridgeId)
    return bridge?.interview
  }

  public isInterviewing(username: string): boolean {
    return this.sessions.has(username.toLowerCase())
  }

  private async onGuildPlayer(event: GuildPlayerEvent): Promise<void> {
    if (event.instanceName !== this.clientInstance.instanceName) return

    const username = event.user.mojangProfile().name
    if (event.type === GuildPlayerEventType.Join) {
      const session = this.sessions.get(username.toLowerCase())
      if (session !== undefined) {
        await this.finish(session, `Interview with ${username} ended: joined the guild.`)
      }
      return
    }
    if (event.type !== GuildPlayerEventType.Request) return

    const config = this.resolveInterviewConfig()
    if (config?.enabled !== true) return

    await this.startInterview(event.instanceName, username)
  }

  private async onInterviewRequest(instanceName: string, username: string): Promise<void> {
    if (instanceName !== this.clientInstance.instanceName) return
    if (this.resolveInterviewConfig() === undefined) return

    await this.startInterview(instanceName, username)
  }

  private async startInterview(instanceName: string, username: string): Promise<void> {
    if (this.clientInstance.currentStatus() !== Status.Connected) return

    const key = username.toLowerCase()
    if (this.sessions.has(key)) {
      this.logger.info(`[interview] ${username} already has an active interview on ${instanceName}`)
      return
    }

    const config = this.resolveInterviewConfig()
    if (config === undefined) return

    const session: InterviewSession = {
      username: username,
      timeoutMs: config.timeoutMs ?? JoinInterviewHandler.DefaultTimeoutMs,
      timeoutId: undefined
    }
    this.sessions.set(key, session)
    this.armTimeout(session)

    const question = config.question ?? JoinInterviewHandler.DefaultQuestion

    this.logger.info(`[interview] starting interview with ${username} on ${instanceName}`)
    await this.sendOfficer(
      instanceName,
      `Started interview with ${username}. Asked: ${question}. Reply in officer chat to talk with them; prefix your message with \`-\` to keep it internal.`
    )

    await this.sendCommand(instanceName, `/friend add ${username}`, MinecraftSendChatPriority.High)
    await this.sendCommand(instanceName, `/msg ${username} ${question}`, MinecraftSendChatPriority.High)
  }

  private async onChat(event: ChatEvent): Promise<void> {
    if (!this.application.bridgeResolver.bridgesMatch(event.bridgeId, this.clientInstance.bridgeId)) return

    switch (event.channelType) {
      case ChannelType.Private: {
        if (event.instanceType !== InstanceType.Minecraft) return
        if (!event.user.isMojangUser()) return
        const session = this.sessions.get(event.user.mojangProfile().name.toLowerCase())
        if (session === undefined) return

        this.logger.debug(`[interview] PM from ${session.username}: "${event.message}"`)
        await this.onPlayerMessage(this.clientInstance.instanceName, session, event.message)
        break
      }
      case ChannelType.Officer: {
        await this.onOfficerMessage(this.clientInstance.instanceName, event.message)
        break
      }
      default: {
        break
      }
    }
  }

  private async onPlayerMessage(instanceName: string, session: InterviewSession, message: string): Promise<void> {
    this.armTimeout(session)
    await this.sendOfficer(instanceName, `${session.username}: ${message}`)
  }

  private async onOfficerMessage(instanceName: string, message: string): Promise<void> {
    if (message.startsWith(JoinInterviewHandler.ExcludePrefix)) return
    if (this.sessions.size === 0) return

    for (const session of this.sessions.values()) {
      this.armTimeout(session)
      await this.sendCommand(instanceName, `/msg ${session.username} ${message}`, MinecraftSendChatPriority.Default)
    }
  }

  private armTimeout(session: InterviewSession): void {
    if (session.timeoutId !== undefined) clearTimeout(session.timeoutId)
    session.timeoutId = setTimeout(() => {
      void this.onTimeout(session).catch(this.errorHandler.promiseCatch('handling interview timeout'))
    }, session.timeoutMs)
    session.timeoutId.unref()
  }

  private async onTimeout(session: InterviewSession): Promise<void> {
    if (!this.sessions.has(session.username.toLowerCase())) return

    await this.finish(session, `Interview with ${session.username} aborted: no response.`)
  }

  private async finish(session: InterviewSession, message: string | undefined): Promise<void> {
    const key = session.username.toLowerCase()
    if (this.sessions.get(key) !== session) return
    this.sessions.delete(key)
    if (session.timeoutId !== undefined) clearTimeout(session.timeoutId)

    if (message !== undefined) await this.sendOfficer(this.clientInstance.instanceName, message)
  }

  private async sendOfficer(instanceName: string, message: string): Promise<void> {
    await this.sendCommand(instanceName, `/oc [Interview] ${message}`, MinecraftSendChatPriority.Default)
  }

  private async sendCommand(instanceName: string, command: string, priority: MinecraftSendChatPriority): Promise<void> {
    await this.application
      .sendMinecraft([instanceName], priority, undefined, command)
      .catch(this.errorHandler.promiseCatch(`sending "${command}" for interview`))
  }
}
