import assert from 'node:assert'

import type { ChatCommandContext } from '../../../../common/commands.js'
import { formatNumber, titleCase } from '../../../../common/helper-functions.js'
import { getSkillAverage, getSkills, SkillOrder } from '../skills.js'

import { type SelectedSkyblockProfile, type SkyblockView } from './types.js'

export const skillsView: SkyblockView = {
  name: 'skills',
  description: 'Skills and Skill Average of specified user.',
  example: 'sb %s skills',
  needsProfile: true,
  // eslint-disable-next-line @typescript-eslint/require-await
  async render(
    context: ChatCommandContext,
    username: string,
    uuid: string,
    selected: SelectedSkyblockProfile | undefined
  ): Promise<string> {
    assert.ok(selected)

    const skills = getSkills(selected.member, selected.profile)
    if (!skills) return `${username} has no skills.`

    const skillAverage = getSkillAverage(selected.member)

    const formattedSkills = SkillOrder.map((skill) => {
      const data = skills[skill]
      return `${titleCase(skill)}: ${formatNumber(data.levelWithProgress, 2)}`
    })

    return `${username}'s Skill Average: ${skillAverage} (${formattedSkills.join(', ')})`
  }
}
