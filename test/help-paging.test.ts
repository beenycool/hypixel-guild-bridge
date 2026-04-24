import assert from 'node:assert'
import { describe, it } from 'node:test'

import { Collection } from 'discord.js'

import helpCommand from '../src/instance/discord/commands/help.js'

interface CapturedReply {
  replyArguments: unknown
}

const MakeMockCommand = (name: string, desc: string) => ({
  getCommandBuilder: () => ({ name, description: desc, options: [], toJSON: () => ({}) })
})

interface MockCollector {
  on: () => void
  stop: () => void
}

const CreateFakeCollector = (): MockCollector => ({
  on: () => {
    /* noop */
  },
  stop: () => {
    /* noop */
  }
})

interface MockInteraction {
  inGuild: () => boolean
  inCachedGuild: () => boolean
  deferReply: () => void
  guild: { commands: { fetch: () => Collection<string, { id: string; name: string }> } }
  channel: { createMessageComponentCollector: () => MockCollector }
  editReply: (editArguments: unknown) => void
}

function emptyPromiseCatchReturn(): void {
  /* noop */
}

const EmptyPromiseCatch = () => emptyPromiseCatchReturn

await describe('help command paging', async () => {
  await it('uses pager when help content is very long', async () => {
    const captured: CapturedReply = { replyArguments: undefined }

    const guildCommands = new Collection<string, { id: string; name: string }>([['1', { id: '1', name: 'test' }]])

    const allCommands = []
    for (let index = 0; index < 500; index++) {
      allCommands.push(MakeMockCommand(`cmd${index}`, 'A long description for testing ' + 'x'.repeat(50)))
    }

    const mockInteraction: MockInteraction = {
      inGuild: () => true,
      inCachedGuild: () => true,
      deferReply: () => {
        /* noop */
      },
      guild: { commands: { fetch: () => guildCommands } },
      channel: { createMessageComponentCollector: CreateFakeCollector },
      editReply: (editArguments: unknown) => {
        captured.replyArguments = editArguments
      }
    }

    const context = {
      interaction: mockInteraction,
      allCommands,
      permission: 999,
      errorHandler: { promiseCatch: EmptyPromiseCatch }
    }

    await helpCommand.handler(context as unknown as Parameters<typeof helpCommand.handler>[0])

    assert.ok(captured.replyArguments !== undefined)
    const replyArguments = captured.replyArguments as Record<string, unknown>
    assert.ok(Array.isArray(replyArguments.components) && (replyArguments.components as unknown[]).length > 0)
    const embeds = replyArguments.embeds as Record<string, unknown>[] | undefined
    assert.ok(((embeds?.[0]?.description ?? '') as string).length <= 3300)
  })
})
