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
  questions: string[]
  questionIndex: number

  awaitingJoin: boolean
  timeoutMs: number
  timeoutId: ReturnType<typeof setTimeout> | undefined
}

export default class JoinInterviewHandler extends SubInstance<
  MinecraftInstance,
  InstanceType.Minecraft,
  ClientSession
> {
  private static readonly DefaultTimeoutMs = 10 * 60_000
  private static readonly ExcludePrefix = '-'

  private static readonly PartyChatRegex =
    /^(?:(?:Party|P)\s*>\s*)?(?:\[[^\]]+\]\s*)*([a-zA-Z0-9_]{3,32})(?:\s*\[[^\]]+\])*:\s*(.+)$/i

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

    return this.resolveDynamicInterviewConfig(bridgeId)
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

  private buildInterviewQuestions(): string[] {
    if (this.clientInstance.bridgeId === 'guab') {
      return [
        '1) Are you an alt or is this your main?',
        '2) Are you good in bridge or another hypixel gamemode (if so what)?',
        '3) Are you active and stuff?',
        '4) What were u doing on April 14th at 02:03 pm BST 2014?',
        '5) Do you accept John Guab as your Lord and Saviour?'
      ]
    }
    return [
      '1) Are you an alt or is this your main?',
      '2) Are you active and able to meet guild requirements?',
      '3) Why do you want to join this guild?'
    ]
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
      questions: this.buildInterviewQuestions(),
      questionIndex: 0,
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
      `Started interview with ${username}. They will be asked ${session.questions.length} questions. Reply in the Discord officer channel to talk with them.`
    )

    if (this.isInParty(instanceName)) {
      await this.sendCommand(instanceName, '/p leave', MinecraftSendChatPriority.High)
    }
    await this.sendCommand(instanceName, `/party invite ${username}`, MinecraftSendChatPriority.High)
    await this.sendCommand(
      instanceName,
      `/msg ${username} Please accept the party invite to start the interview to join this guild.`,
      MinecraftSendChatPriority.High
    )
  }

  private async onMinecraftChat(event: MinecraftRawChatEvent): Promise<void> {
    if (event.instanceName !== this.clientInstance.instanceName) return

    const message = event.message.replaceAll(/§./g, '').trim()
    this.inParty.set(event.instanceName, updatePartyState(message, this.isInParty(event.instanceName)))

    for (const session of this.sessions.values()) {
      if (session.awaitingJoin) {
        const joinedUser = findPartyMemberJoined(message)
        if (joinedUser !== undefined && joinedUser.toLowerCase() === session.username.toLowerCase()) {
          session.awaitingJoin = false
          this.logger.info(`[interview] ${session.username} joined the party on ${event.instanceName}`)
          await this.sendCommand(
            event.instanceName,
            '/pc Hey! Welcome! A few quick questions before we let you in - just type your answers in party chat :)',
            MinecraftSendChatPriority.Default
          )
          await this.sendOfficer(
            event.instanceName,
            session.username,
            'Hey! Welcome! A few quick questions before we let you in - just type your answers in party chat :)'
          )
          await this.askNextQuestion(event.instanceName, session)
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

  private async askNextQuestion(instanceName: string, session: InterviewSession): Promise<void> {
    this.armTimeout(session)
    const index = session.questionIndex
    if (index < session.questions.length) {
      session.questionIndex = index + 1
      const question = session.questions[index]
      await this.sendCommand(instanceName, `/pc ${question}`, MinecraftSendChatPriority.Default)
      await this.sendOfficer(instanceName, session.username, `Question ${index + 1}: ${question}`)
      return
    }
    if (index === session.questions.length) {
      session.questionIndex = index + 1
      await this.sendCommand(
        instanceName,
        '/pc Please wait shortly, a staff member will be here to review your answers. If nobody answers try again at another date.',
        MinecraftSendChatPriority.Default
      )
      await this.sendOfficer(
        instanceName,
        session.username,
        'Please wait shortly, a staff member will be here to review your answers. If nobody answers try again at another date.'
      )
    }
  }

  private async onPlayerMessage(instanceName: string, session: InterviewSession, message: string): Promise<void> {
    this.armTimeout(session)
    await this.sendOfficer(instanceName, session.username, `${session.username}: ${message}`)
    await this.askNextQuestion(instanceName, session)
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
