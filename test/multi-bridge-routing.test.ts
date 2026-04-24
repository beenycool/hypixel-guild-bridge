import assert from 'node:assert'
import { describe, it } from 'node:test'

import { ChannelType } from '../src/common/application-event.js'
import ChatManager from '../src/instance/discord/chat-manager.js'
import DiscordBridge from '../src/instance/discord/discord-bridge.js'

type ResolveChannelsFunction = (
  channels: ChannelType[],
  bridgeId: string | undefined,
  routingHint?: { kind: string; instanceName: string }
) => string[]
type ResolveBridgeScopedChannelsFunction = (channels: ChannelType[], bridgeId: string) => string[]
type ResolveAllBridgeChannelsFunction = (channels: ChannelType[]) => string[]
type HandlePassthroughCommandFunction = (
  event: { channel: { id: string } },
  content: string,
  channelType: ChannelType,
  bridgeId: string | undefined
) => Promise<boolean>

const DiscordBridgePrototype = DiscordBridge.prototype as unknown as {
  resolveBridgeScopedChannels: ResolveBridgeScopedChannelsFunction
  resolveAllBridgeChannels: ResolveAllBridgeChannelsFunction
  resolveChannelsForEvent: ResolveChannelsFunction
}

const ChatManagerPrototype = ChatManager.prototype as unknown as {
  handlePassthroughCommand: HandlePassthroughCommandFunction
}

await describe('multi-bridge routing hardening', async () => {
  await it('routes Discord-bound chat by Minecraft instance when bridgeId is omitted', () => {
    const warnings: string[] = []

    const context = {
      application: {
        bridgeResolver: {
          isMultiBridgeEnabled: () => true,
          getBridgeIdForInstance: (instanceName: string) => (instanceName === 'bot1' ? 'bridge-a' : undefined),
          getPublicChannelIds: (bridgeId: string) => (bridgeId === 'bridge-a' ? ['public-a'] : []),
          getOfficerChannelIds: () => [],
          getAllBridges: () => []
        },
        core: {
          discordConfigurations: {
            getPublicChannelIds: () => ['legacy-public'],
            getOfficerChannelIds: () => []
          }
        }
      },
      logger: { warn: (message: string) => warnings.push(message) },
      resolveChannels: () => ['legacy-public'],
      resolveBridgeScopedChannels: DiscordBridgePrototype.resolveBridgeScopedChannels,
      resolveAllBridgeChannels: DiscordBridgePrototype.resolveAllBridgeChannels
    }

    const result = DiscordBridgePrototype.resolveChannelsForEvent.call(context, [ChannelType.Public], undefined, {
      kind: 'chat',
      instanceName: 'bot1'
    })

    assert.deepStrictEqual(result, ['public-a'])
    assert.deepStrictEqual(warnings, [])
  })

  await it('fails closed for routed guild traffic when no bridge mapping exists', () => {
    const warnings: string[] = []

    const context = {
      application: {
        bridgeResolver: {
          isMultiBridgeEnabled: () => true,
          getBridgeIdForInstance: () => undefined,
          getPublicChannelIds: () => [],
          getOfficerChannelIds: () => [],
          getAllBridges: () => []
        },
        core: {
          discordConfigurations: {
            getPublicChannelIds: () => ['legacy-public'],
            getOfficerChannelIds: () => []
          }
        }
      },
      logger: { warn: (message: string) => warnings.push(message) },
      resolveChannels: () => ['legacy-public'],
      resolveBridgeScopedChannels: DiscordBridgePrototype.resolveBridgeScopedChannels,
      resolveAllBridgeChannels: DiscordBridgePrototype.resolveAllBridgeChannels
    }

    const result = DiscordBridgePrototype.resolveChannelsForEvent.call(context, [ChannelType.Public], undefined, {
      kind: 'chat',
      instanceName: 'unmapped-bot'
    })

    assert.deepStrictEqual(result, [])
    assert.strictEqual(warnings.length, 1)
    assert.match(warnings[0] ?? '', /no target channels/i)
  })

  await it('fans out bridge-less broadcasts across all configured bridge channels', () => {
    const context = {
      application: {
        bridgeResolver: {
          isMultiBridgeEnabled: () => true,
          getBridgeIdForInstance: () => undefined,
          getPublicChannelIds: () => [],
          getOfficerChannelIds: () => [],
          getAllBridges: () => [
            {
              id: 'bridge-a',
              minecraftInstanceNames: ['bot1'],
              publicChannelIds: ['public-a'],
              officerChannelIds: ['officer-a'],
              loggerChannelIds: []
            },
            {
              id: 'bridge-b',
              minecraftInstanceNames: ['bot2'],
              publicChannelIds: ['public-b'],
              officerChannelIds: ['officer-b'],
              loggerChannelIds: []
            }
          ]
        },
        core: {
          discordConfigurations: {
            getPublicChannelIds: () => [],
            getOfficerChannelIds: () => []
          }
        }
      },
      logger: {
        warn: () => {
          /* empty */
        }
      },
      resolveChannels: () => [],
      resolveBridgeScopedChannels: DiscordBridgePrototype.resolveBridgeScopedChannels,
      resolveAllBridgeChannels: DiscordBridgePrototype.resolveAllBridgeChannels
    }

    const result = DiscordBridgePrototype.resolveChannelsForEvent.call(
      context,
      [ChannelType.Public, ChannelType.Officer],
      undefined,
      { kind: 'broadcast', instanceName: 'internal/main' }
    )

    assert.deepStrictEqual(result, ['public-a', 'officer-a', 'public-b', 'officer-b'])
  })

  await it('drops passthrough commands from unmapped channels in multi-bridge mode', async () => {
    const warnings: string[] = []
    const sentCommands: unknown[] = []

    const context = {
      application: {
        bridgeResolver: {
          isMultiBridgeEnabled: () => true,
          shouldProcessEvent: () => true
        },
        core: {
          bridgeConfigurations: {
            getPassthroughPrefix: () => undefined,
            getPassthroughCommands: () => []
          },
          commandsConfigurations: {
            getPassthroughPrefix: () => '!',
            getPassthroughCommands: () => ['bw']
          }
        },
        getInstancesNames: () => ['bot1', 'bot2'],
        sendMinecraft: (...sentArguments: unknown[]) => {
          sentCommands.push(sentArguments)
        }
      },
      logger: {
        warn: (message: string) => warnings.push(message),
        debug: () => {
          /* empty */
        }
      }
    }

    const handled = await ChatManagerPrototype.handlePassthroughCommand.call(
      context,
      { channel: { id: 'channel-1' } },
      '!bw aidn5',
      ChannelType.Public,
      undefined
    )

    assert.strictEqual(handled, true)
    assert.deepStrictEqual(sentCommands, [])
    assert.strictEqual(warnings.length, 1)
    assert.match(warnings[0] ?? '', /dropping passthrough command/i)
  })
})
