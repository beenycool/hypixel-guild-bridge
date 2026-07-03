import type Application from '../src/application.js'
import {
  ChannelType,
  type ChatEvent,
  InstanceType,
  MinecraftSendChatPriority
} from '../src/common/application-event.js'
import PluginInstance from '../src/common/plugin-instance.js'
import type { PluginInfo } from '../src/common/plugin-instance.js'
import type { PluginsManager } from '../src/instance/features/plugins-manager.js'

type PromptType = 'meow' | 'bark' | 'woof' | 'goodboy'

interface Session {
  prompt: PromptType
  channelType: ChannelType
  timeoutId: ReturnType<typeof setTimeout>
}

const PromptTypes: PromptType[] = ['meow', 'bark', 'woof', 'goodboy']

const PromptMessages: Record<PromptType, string> = {
  meow: 'meow for me',
  bark: 'bark for me',
  woof: 'woof for me',
  goodboy: "who's a good boy"
}

export default class SubmissionGamePlugin extends PluginInstance {
  private readonly sessions = new Map<string, Session>()
  private alternateToggle = false

  constructor(application: Application, pluginsManager: PluginsManager) {
    super(application, pluginsManager, 'submission-game')
  }

  onReady(): void {
    this.application.on('chat', (event) => {
      void this.onChatEvent(event).catch(this.errorHandler.promiseCatch('handling submission chat event'))
    })
  }

  pluginInfo(): PluginInfo {
    return { description: 'In-game !submission mini-game for guild chat' }
  }

  private async onChatEvent(event: ChatEvent): Promise<void> {
    if (event.instanceType !== InstanceType.Minecraft && event.instanceType !== InstanceType.Discord) return
    if (event.channelType !== ChannelType.Public && event.channelType !== ChannelType.Officer) return

    const userMojang = event.user.mojangProfile()
    const name = userMojang?.name ?? event.user.displayName()
    if (this.application.minecraftManager.isMinecraftBot(name)) return

    const message = event.message.trim().toLowerCase()

    let session: Session | undefined
    let sessionKey: string | undefined

    if (event.instanceType === InstanceType.Minecraft && userMojang !== undefined) {
      sessionKey = `${userMojang.name}:${event.instanceName}`
      session = this.sessions.get(sessionKey)
    }

    if (session === undefined && event.instanceType === InstanceType.Discord) {
      const discordId = event.user.discordProfile()?.id
      if (discordId !== undefined) {
        sessionKey = `discord:${discordId}`
        session = this.sessions.get(sessionKey)
      }
    }

    if (session === undefined && event.instanceType === InstanceType.Minecraft) {
      for (const [key, s] of this.sessions) {
        if (key.startsWith('discord:') && this.matchesReply(s.prompt, message) && s.channelType === event.channelType) {
          session = s
          sessionKey = key
          break
        }
      }
    }

    if (session !== undefined && sessionKey !== undefined) {
      clearTimeout(session.timeoutId)
      this.sessions.delete(sessionKey)

      if (this.matchesReply(session.prompt, message)) {
        const reply = this.alternateToggle ? "who's a good boy" : `${name} is the goodest boy online :3`
        this.alternateToggle = !this.alternateToggle

        const prefix = session.channelType === ChannelType.Public ? 'gc' : 'oc'
        const instances = this.resolveMinecraftInstances(event)
        await this.application.sendMinecraft(
          instances,
          MinecraftSendChatPriority.Default,
          undefined,
          `/${prefix} ${reply}`
        )
      }
      return
    }

    if (message === '!submission') {
      const prompt = PromptTypes[Math.floor(Math.random() * PromptTypes.length)]

      const prefix = event.channelType === ChannelType.Public ? 'gc' : 'oc'
      const instances = this.resolveMinecraftInstances(event)
      await this.application.sendMinecraft(
        instances,
        MinecraftSendChatPriority.Default,
        undefined,
        `/${prefix} ${PromptMessages[prompt]}`
      )

      let newSessionKey: string
      if (event.instanceType === InstanceType.Minecraft && userMojang !== undefined) {
        newSessionKey = `${userMojang.name}:${event.instanceName}`
      } else {
        const discordId = event.user.discordProfile()?.id
        newSessionKey = `discord:${discordId ?? name}`
      }

      const timeoutId = setTimeout(() => {
        this.sessions.delete(newSessionKey)
      }, 60_000)

      this.sessions.set(newSessionKey, { prompt, channelType: event.channelType, timeoutId })
    }
  }

  private resolveMinecraftInstances(event: ChatEvent): string[] {
    if (event.instanceType === InstanceType.Minecraft) {
      return [event.instanceName]
    }

    const instances = this.application
      .getInstancesNames(InstanceType.Minecraft)
      .filter((name) => this.application.bridgeResolver.shouldProcessEvent(event.bridgeId, name))

    return instances.length > 0 ? instances : this.application.getInstancesNames(InstanceType.Minecraft)
  }

  private matchesReply(prompt: PromptType, message: string): boolean {
    switch (prompt) {
      case 'meow': {
        return /^m+e+o+w+|m+e+w+|m+r+o+w+|n+y+a+|p+r+r+|m+i+a+o+u?/.test(message)
      }
      case 'bark':
      case 'woof': {
        return /^b+a+r+k+|w+o+o+f+|a+r+f+|r+u+f+?|d+o+g+|b+o+w+\s*w+o+w+/.test(message)
      }
      case 'goodboy': {
        return /^m+e+|i+\s*a+m+|g+o+o+d+\s*b+o+y+|y+e+s+|i+\s*a+m+\s*a+\s*g+o+o+d+\s*b+o+y/.test(message)
      }
    }
  }
}
