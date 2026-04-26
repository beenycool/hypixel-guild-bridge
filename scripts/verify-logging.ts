
import Application from '../src/application.js'
import AiChatPlugin from '../plugins/ai-chat.js'
import { InstanceType, ChannelType } from '../src/common/application-event.js'

async function test() {
  console.log('Starting logging verification test...')
  
  // Minimal mock of Application/Core
  const mockApp = {
    rootDirectory: process.cwd(),
    getAiChatConfig: () => ({ apiKey: 'mock-key', debounceMs: 0 }),
    on: () => {},
    emit: () => Promise.resolve(),
    minecraftManager: {
        isMinecraftBot: () => false,
        getMinecraftBots: () => [],
        sanitizer: { sanitizeChatMessage: (_: any, msg: string) => Promise.resolve(msg) }
    },
    core: {
        aiChatStorage: {
            isBridgeEnabled: () => Promise.resolve(true),
            isBridgeMuted: () => Promise.resolve(false),
            getUserMode: () => Promise.resolve('gooner'),
            renderNotesMarkdown: () => Promise.resolve('none'),
            saveNote: () => Promise.resolve(),
            setUserMode: () => Promise.resolve()
        },
        commandsConfigurations: { getChatPrefix: () => '!' },
        bridgeConfigurations: { getCommandPrefix: () => '!' }
    },
    sendMinecraft: () => Promise.resolve(),
    logger: {
      error: console.error,
      debug: console.log,
      warn: console.warn,
      info: console.info
    },
    errorHandler: { promiseCatch: () => (err: any) => console.error(err) }
  } as any

  const plugin = new AiChatPlugin(mockApp, {} as any)
  
  // We need to mock generateAiReply to avoid actual API calls
  // @ts-ignore
  plugin.generateAiReply = async () => ({
    reply: 'this is a test sussy reply',
    memory: 'test memory',
    fallbackUsed: false
  })

  console.log('Simulating chat event...')
  // @ts-ignore
  await plugin.generateAndSend({
    bridgeId: 'test-bridge',
    instanceName: 'test-instance',
    eventId: 'test-event',
    username: 'TestUser',
    playerId: 'test-uuid',
    latestMessage: 'hello bot'
  })

  console.log('Checking log file...')
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const logPath = path.join(process.cwd(), 'logs', 'ai-responses.json')
  
  try {
    const content = await fs.readFile(logPath, 'utf-8')
    console.log('Log file found! Content:')
    console.log(content)
  } catch (err) {
    console.error('Log file not found or could not be read:', err)
  }
}

test().catch(console.error)
