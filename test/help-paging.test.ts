import assert from 'node:assert'
import { describe, it } from 'node:test'

import { Collection } from 'discord.js'

import helpCommand from '../src/instance/discord/commands/help.js'
import * as pager from '../src/instance/discord/utility/discord-pager.js'

// Create mock command handlers
function makeMockCommand(name: string, desc: string) {
  return {
    getCommandBuilder: () => ({ name, description: desc, options: [], toJSON: () => ({}) })
  }
}

void describe('help command paging', () => {
  void it('uses pager when help content is very long', async () => {
    const captured: any = {
      replyArgs: undefined
    }

    const guildCommands = new Collection<string, any>([['1', { id: '1', name: 'test' }]])

    // create many commands to force large help text
    const allCommands = []
    for (let index = 0; index < 500; index++) {
      allCommands.push(makeMockCommand(`cmd${index}`, 'A long description for testing ' + 'x'.repeat(50)))
    }

    const fakeCollector = () => ({ on: (_: string, __: (...arguments_: any[]) => void) => {}, stop: () => {} })

    const context: any = {
      interaction: {
        inGuild: () => true,
        inCachedGuild: () => true,
        deferReply: async () => {},
        guild: { commands: { fetch: async () => guildCommands } },
        channel: { createMessageComponentCollector: fakeCollector },
        editReply: async (arguments_: any) => {
          captured.replyArgs = arguments_
        }
      },
      allCommands,
      permission: 999,
      errorHandler: { promiseCatch: (_: string) => (_: unknown) => {} }
    }

    // run handler
    await helpCommand.handler(context)

    assert.ok(captured.replyArgs !== undefined)
    // components present on reply indicate paging was used
    assert.ok(Array.isArray(captured.replyArgs.components) && captured.replyArgs.components.length > 0)
    assert.ok((captured.replyArgs.embeds?.[0]?.description ?? '').length <= 3300)
  })
})
