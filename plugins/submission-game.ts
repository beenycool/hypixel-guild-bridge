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
    if (event.instanceType !== InstanceType.Minecraft) return
    if (event.channelType !== ChannelType.Public && event.channelType !== ChannelType.Officer) return

    const name = event.user.mojangProfile().name
    if (this.application.minecraftManager.isMinecraftBot(name)) return

    const key = `${name}:${event.instanceName}`
    const message = event.message.trim().toLowerCase()

    const session = this.sessions.get(key)
    if (session !== undefined) {
      clearTimeout(session.timeoutId)
      this.sessions.delete(key)

      if (this.matchesReply(session.prompt, message)) {
        const reply = this.alternateToggle ? "who's a good boy" : `${name} is the goodest boy online :3`
        this.alternateToggle = !this.alternateToggle

        const prefix = session.channelType === ChannelType.Public ? 'gc' : 'oc'
        await this.application.sendMinecraft(
          [event.instanceName],
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
      await this.application.sendMinecraft(
        [event.instanceName],
        MinecraftSendChatPriority.Default,
        undefined,
        `/${prefix} ${PromptMessages[prompt]}`
      )

      const timeoutId = setTimeout(() => {
        this.sessions.delete(key)
      }, 60_000)

      this.sessions.set(key, { prompt, channelType: event.channelType, timeoutId })
    }
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
