import type { SkyblockV2Member } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { formatNumber, titleCase } from '../../../common/helper-functions.js'
import { getLevelByXp } from '../common/skills'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'
import { playerNeverPlayedDungeons } from '../common/utility'

const DungeonClasses = ['healer', 'mage', 'berserk', 'archer', 'tank'] as const
type DungeonClass = (typeof DungeonClasses)[number]

export default class Catacomb extends SkyblockPlayerCommand {
  constructor() {
    super({
      triggers: ['catacombs', 'cata', 'dungeons'],
      description: 'Skyblock Dungeons stats of specified user.',
      example: `catacombs %s`
    })
  }

  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    const dungeons = selectedProfile.dungeons
    if (!dungeons) return playerNeverPlayedDungeons(username)

    const catacombsExperience = dungeons.dungeon_types.catacombs.experience
    const catacombsLevel = getLevelByXp(catacombsExperience, { type: 'dungeoneering' }).levelWithProgress

    const playerClasses = dungeons.player_classes
    if (!playerClasses) return playerNeverPlayedDungeons(username)

    const classLevels: { className: DungeonClass; level: number }[] = DungeonClasses.map((className) => {
      const experience = playerClasses[className]?.experience ?? 0
      return {
        className: className,
        level: getLevelByXp(experience, { type: 'dungeoneering' }).levelWithProgress
      }
    })

    const classAverage = classLevels.reduce((total, entry) => total + entry.level, 0) / classLevels.length
    const classesDisplay = classLevels
      .map((entry) => `${formatNumber(entry.level, 2)}${entry.className[0].toUpperCase()}`)
      .join(', ')

    const selectedClass = titleCase(dungeons.selected_dungeon_class ?? 'none')
    const secretsFound = dungeons.secrets ?? 0

    return (
      `${username}'s Catacombs: ${formatNumber(catacombsLevel, 2)} | ` +
      `Selected Class: ${selectedClass} | ` +
      `Class Average: ${formatNumber(classAverage, 2)} | ` +
      `Secrets Found: ${formatNumber(secretsFound, 0)} | ` +
      `Classes: ${classesDisplay}`
    )
  }
}
