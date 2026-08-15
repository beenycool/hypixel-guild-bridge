import type { InterviewConfig } from '../../../application-config.js'
import type { ChatEvent, GuildPlayerEvent, MinecraftRawChatEvent } from '../../../common/application-event.js'
import {
  ChannelType,
  GuildPlayerEventType,
  InstanceType,
  MinecraftSendChatPriority
} from '../../../common/application-event.js'
import { Status } from '../../../common/connectable-instance.js'
import SubInstance from '../../../common/sub-instance'
import type ClientSession from '../client-session.js'
import { findPartyMemberJoined, updatePartyState } from '../common/party-state.js'
import type MinecraftInstance from '../minecraft-instance.js'

interface InterviewSession {
  username: string
  question: string

  awaitingJoin: boolean
  timeoutMs: number
  timeoutId: ReturnType<typeof setTimeout> | undefined
}

export default class JoinInterviewHandler extends SubInstance<
  MinecraftInstance,
  InstanceType.Minecraft,
  ClientSession
> {
  private static readonly DefaultQuestion = 'Are you an alt of an existing guild member?'
  private static readonly DefaultTimeoutMs = 10 * 60_000
  private static readonly ExcludePrefix = '-'

  private static readonly PartyChatRegex = /^(?:Party > )?(?:\[[+A-Z]{3,10}] ){0,3}(\w{3,32}): (.{1,256})$/

  private readonly sessions = new Map<string, InterviewSession>()
  private readonly inParty = new Map<string, boolean>()

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

    this.application.on('interviewDenied', (event) => {
      void this.onInterviewDenied(event.instanceName, event.username).catch(
        this.errorHandler.promiseCatch('handling join interview denial')
      )
    })

    this.application.on('minecraftChat', (event) => {
      void this.onMinecraftChat(event).catch(this.errorHandler.promiseCatch('handling minecraft chat for interview'))
    })

    this.application.on('chat', (event) => {
      void this.onChat(event).catch(this.errorHandler.promiseCatch('handling chat for interview'))
    })
  }

  private resolveInterviewConfig(): InterviewConfig | undefined {
    const bridgeId = this.clientInstance.bridgeId
    if (bridgeId === undefined) return undefined

    const dynamic = this.resolveDynamicInterviewConfig(bridgeId)
    if (dynamic !== undefined) return dynamic

    const bridge = this.application.config.bridges?.find((config) => config.id === bridgeId)
    return bridge?.interview
  }

  private resolveDynamicInterviewConfig(bridgeId: string): InterviewConfig | undefined {
    const config = this.application.core.bridgeConfigurations
    if (!config.getInterviewEnabled(bridgeId) && config.getInterviewQuestion(bridgeId) === '') return undefined
    return {
      enabled: config.getInterviewEnabled(bridgeId),
      question: config.getInterviewQuestion(bridgeId) || undefined,
      timeoutMs: config.getInterviewTimeoutMs(bridgeId)
    }
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

  private async onInterviewDenied(instanceName: string, username: string): Promise<void> {
    if (instanceName !== this.clientInstance.instanceName) return

    const session = this.sessions.get(username.toLowerCase())
    if (session === undefined) return

    await this.sendCommand(
      instanceName,
      `/pc Your request to join the guild was denied.`,
      MinecraftSendChatPriority.High
    )
    await this.finish(session, `Interview with ${session.username} ended: join request denied.`)
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
      question: config.question ?? JoinInterviewHandler.DefaultQuestion,
      awaitingJoin: true,
      timeoutMs: config.timeoutMs ?? JoinInterviewHandler.DefaultTimeoutMs,
      timeoutId: undefined
    }
    this.sessions.set(key, session)
    this.armTimeout(session)

    this.logger.info(`[interview] starting interview with ${username} on ${instanceName}`)
    await this.sendOfficer(
      instanceName,
      username,
      `Started interview with ${username}. They will be asked: ${session.question}. Reply in the Discord officer channel to talk with them.`
    )

    if (this.isInParty(instanceName)) {
      await this.sendCommand(instanceName, '/p leave', MinecraftSendChatPriority.High)
    }
    await this.sendCommand(instanceName, `/party invite ${username}`, MinecraftSendChatPriority.High)
    await this.sendCommand(
      instanceName,
      `/msg ${username} Please accept the party invite to start the interview.`,
      MinecraftSendChatPriority.High
    )
  }

  private async onMinecraftChat(event: MinecraftRawChatEvent): Promise<void> {
    if (event.instanceName !== this.clientInstance.instanceName) return

    const message = event.message
    this.inParty.set(event.instanceName, updatePartyState(message, this.isInParty(event.instanceName)))

    for (const session of this.sessions.values()) {
      if (session.awaitingJoin) {
        const joinedUser = findPartyMemberJoined(message)
        if (joinedUser !== undefined && joinedUser.toLowerCase() === session.username.toLowerCase()) {
          session.awaitingJoin = false
          this.logger.info(`[interview] ${session.username} joined the party on ${event.instanceName}`)
          await this.askQuestion(event.instanceName, session)
        }
        continue
      }

      const match = JoinInterviewHandler.PartyChatRegex.exec(message)
      if (match === null) continue
      const [, username, playerMessage] = match
      if (username.toLowerCase() !== session.username.toLowerCase()) continue
      if (this.application.minecraftManager.isMinecraftBot(username)) continue

      this.logger.debug(`[interview] party chat from ${username}: "${playerMessage}"`)
      await this.onPlayerMessage(event.instanceName, session, playerMessage.trim())
    }
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
        if (event.instanceType !== InstanceType.Discord) return
        await this.onOfficerMessage(this.clientInstance.instanceName, event.message)
        break
      }
      default: {
        break
      }
    }
  }

  private async askQuestion(instanceName: string, session: InterviewSession): Promise<void> {
    this.armTimeout(session)
    await this.sendCommand(instanceName, `/pc ${session.question}`, MinecraftSendChatPriority.Default)
  }

  private async onPlayerMessage(instanceName: string, session: InterviewSession, message: string): Promise<void> {
    this.armTimeout(session)
    await this.sendOfficer(instanceName, session.username, `${session.username}: ${message}`)
  }

  private async onOfficerMessage(instanceName: string, message: string): Promise<void> {
    if (message.startsWith(JoinInterviewHandler.ExcludePrefix)) return
    if (this.sessions.size === 0) return

    for (const session of this.sessions.values()) {
      this.armTimeout(session)
      await this.sendCommand(instanceName, `/pc ${message}`, MinecraftSendChatPriority.Default)
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

    const reason = session.awaitingJoin
      ? 'did not accept the party invite in time (offline, already in a party, or party invites disabled)'
      : `did not answer in time`
    await this.finish(session, `Interview with ${session.username} aborted: ${reason}.`)
  }

  private async finish(session: InterviewSession, message: string | undefined): Promise<void> {
    const key = session.username.toLowerCase()
    if (this.sessions.get(key) !== session) return
    this.sessions.delete(key)
    if (session.timeoutId !== undefined) clearTimeout(session.timeoutId)

    if (message !== undefined) await this.sendOfficer(this.clientInstance.instanceName, session.username, message)
    if (this.isInParty(this.clientInstance.instanceName)) {
      await this.sendCommand(this.clientInstance.instanceName, '/p disband', MinecraftSendChatPriority.High)
    }
  }

  private isInParty(instanceName: string): boolean {
    return this.inParty.get(instanceName) ?? false
  }

  private async sendOfficer(instanceName: string, username: string, message: string): Promise<void> {
    await this.sendCommand(instanceName, `/oc [Interview] ${message}`, MinecraftSendChatPriority.Default)

    const bridgeId = this.clientInstance.bridgeId
    if (bridgeId === undefined) return
    await this.application.emit('interviewMessage', {
      bridgeId: bridgeId,
      instanceName: instanceName,
      username: username,
      message: message
    })
  }

  private async sendCommand(instanceName: string, command: string, priority: MinecraftSendChatPriority): Promise<void> {
    await this.application
      .sendMinecraft([instanceName], priority, undefined, command)
      .catch(this.errorHandler.promiseCatch(`sending "${command}" for interview`))
  }
}
