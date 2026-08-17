import assert from 'node:assert'

import { type AxiosResponse } from 'axios'

import type { ChatCommandContext } from '../../../../common/commands.js'
import { httpClient } from '../../../../common/http.js'

import { type SkyblockView } from './types.js'

export const weightView: SkyblockView = {
  name: 'weight',
  description: "Returns a player's senither weight",
  example: 'sb %s weight',
  needsProfile: false,

  async render(context: ChatCommandContext, username: string): Promise<string> {
    return getSenitherData(username).then((weight) => `${username}'s weight: ${weight}`)
  }
}

async function getSenitherData(username: string): Promise<number> {
  const skyShiiyuResponse = await httpClient(`https://sky.shiiyu.moe/api/v2/profile/${username}`).then(
    (response: AxiosResponse<SkyShiiyuResponse, unknown>) => response.data
  )

  const selected = Object.values(skyShiiyuResponse.profiles).find((profile) => profile.current)
  assert.ok(selected)

  return Math.floor(selected.data?.weight.senither.overall ?? 0)
}

interface SkyShiiyuResponse {
  profiles: Record<string, SkyShiiyuProfile>
}

interface SkyShiiyuProfile {
  current: boolean
  data?: { weight: { senither: { overall: number } } }
}
