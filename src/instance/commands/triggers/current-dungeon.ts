import assert from 'node:assert'

import type { SkyblockV2Dungeons, SkyblockV2Member } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import type { MojangApi } from '../../../core/users/mojang'
import { relativeTime } from '../../../utility/shared-utility'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'
import {
  getDungeonLevelWithOverflow,
  getUuidIfExists,
  playerNeverPlayedDungeons,
  usernameNotExists
} from '../common/utility'

export default class CurrentDungeon extends SkyblockPlayerCommand {
  private static readonly ShowTimeAfter = 30 * 60 * 1000

  constructor() {
    super({
      triggers: ['currentdungeon', 'currdungeon', 'cd'],
      description: "Returns a player's last dungeon run",
      example: `cd %s`
    })
  }

  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    const uuid = await getUuidIfExists(context.app.mojangApi, username)
    if (uuid == undefined) return usernameNotExists(context, username)

    const dungeons = selectedProfile.dungeons
    if (dungeons === undefined) return playerNeverPlayedDungeons(username)

    let runs = dungeons.treasures?.runs
    if (runs === undefined || runs.length === 0) return `${username} hasn't done any dungeon runs lately.`

    if (runs.length > 1) {
      // runs aren't always chronologically ordered
      runs = runs.toSorted((a, b) => b.completion_ts - a.completion_ts)
    }

    const lastRun = runs[0]
    const floorDisplayName = `${lastRun.dungeon_type === 'catacombs' ? 'F' : 'M'}${lastRun.dungeon_tier}`

    let message = ''
    let foundPlayer = false
    for (const participant of lastRun.participants) {
      if (participant.player_uuid === uuid) {
        message += await this.parseDisplayMessage(
          dungeons,
          context.app.mojangApi,
          participant.display_name,
          participant.player_uuid
        )
        foundPlayer = true
      }
    }
    assert.ok(foundPlayer)

    message +=
      lastRun.completion_ts + CurrentDungeon.ShowTimeAfter < Date.now()
        ? ` was last seen ${relativeTime(lastRun.completion_ts)}`
        : ` is`

    message += ` playing ${floorDisplayName} `
    if (lastRun.participants.length <= 1) {
      message += `solo.`
    } else {
      message += `with `

      const participants = await Promise.all(
        lastRun.participants
          .filter((participant) => participant.player_uuid !== uuid)
          .map((participant) =>
            this.parseDisplayMessage(dungeons, context.app.mojangApi, participant.display_name, participant.player_uuid)
          )
      )
      message += participants.join(', ')

      message += '.'
    }

    return message
  }

  private async parseDisplayMessage(
    dungeonProfile: SkyblockV2Dungeons,
    mojangApi: MojangApi,
    message: string,
    uuid: string
  ): Promise<string> {
    const cleanMessage = message.trim().replaceAll(/§./g, '')
    const regex = /^(\w{2,16}): (\w+) \((\d+)\)$/g
    const match = regex.exec(cleanMessage)

    if (!match) return message
    const oldUsername = match[1]
    const className = match[2]
    const classLevel = match[3]

    assert.ok(/^\d+$/.test(classLevel))
    let parsedLevel = Number.parseInt(classLevel, 10)
    if (parsedLevel === 50) {
      const classes = dungeonProfile.player_classes
      const classNameKey = className.toLowerCase().trim() as 'healer' | 'mage' | 'berserk' | 'archer' | 'tank'
      assert.ok(classes !== undefined)

      const experience = classes[classNameKey]?.experience
      assert.ok(experience !== undefined)

      parsedLevel = getDungeonLevelWithOverflow(experience)
    }

    const updatedUsername = await mojangApi
      .profileByUuid(uuid)
      .then((profile) => profile.name)
      .catch(() => oldUsername)
    return `${updatedUsername} (${className} ${parsedLevel.toFixed(0)})`
  }
}
