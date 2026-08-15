import assert from 'node:assert'
import { describe, it } from 'node:test'

import Arcade from '../src/instance/commands/triggers/arcade.js'

await describe('Arcade triggers and argument parsing', async () => {
  await it('includes direct arcade game mode triggers', () => {
    const arcade = new Arcade()
    assert.ok(arcade.triggers.includes('football'))
    assert.ok(arcade.triggers.includes('soccer'))
    assert.ok(arcade.triggers.includes('fb'))
    assert.ok(arcade.triggers.includes('zombies'))
    assert.ok(arcade.triggers.includes('pixelparty'))
    assert.ok(arcade.triggers.includes('blockingdead'))
    assert.ok(arcade.triggers.includes('bountyhunters'))
    assert.ok(arcade.triggers.includes('dragonwars'))
    assert.ok(arcade.triggers.includes('enderspleef'))
    assert.ok(arcade.triggers.includes('farmhunt'))
    assert.ok(arcade.triggers.includes('galaxywars'))
    assert.ok(arcade.triggers.includes('hideandseek'))
    assert.ok(arcade.triggers.includes('holeinthewall'))
    assert.ok(arcade.triggers.includes('hypixelsays'))
    assert.ok(arcade.triggers.includes('miniwalls'))
    assert.ok(arcade.triggers.includes('throwout'))
  })

  await it('correctly parses direct command arguments', () => {
    const arcade = new Arcade() as unknown as {
      parseArgs(context: { commandPrefix: string; username: string; args: string[]; message: { message: string } }): {
        subcommand: string
        username: string
      }
    }

    const context1 = {
      commandPrefix: '!',
      username: 'CallerUser',
      args: ['PlayerName'],
      message: { message: '!football PlayerName' }
    }
    const result1 = arcade.parseArgs(context1)
    assert.strictEqual(result1.subcommand, 'football')
    assert.strictEqual(result1.username, 'PlayerName')

    const context2 = {
      commandPrefix: '!',
      username: 'CallerUser',
      args: [],
      message: { message: '!soccer' }
    }
    const result2 = arcade.parseArgs(context2)
    assert.strictEqual(result2.subcommand, 'football')
    assert.strictEqual(result2.username, 'CallerUser')

    const context3 = {
      commandPrefix: '!',
      username: 'CallerUser',
      args: ['football', 'PlayerName'],
      message: { message: '!arcade football PlayerName' }
    }
    const result3 = arcade.parseArgs(context3)
    assert.strictEqual(result3.subcommand, 'football')
    assert.strictEqual(result3.username, 'PlayerName')

    const context4 = {
      commandPrefix: '!',
      username: 'CallerUser',
      args: ['PlayerName'],
      message: { message: '!arcade PlayerName' }
    }
    const result4 = arcade.parseArgs(context4)
    assert.strictEqual(result4.subcommand, 'summary')
    assert.strictEqual(result4.username, 'PlayerName')
  })
})
