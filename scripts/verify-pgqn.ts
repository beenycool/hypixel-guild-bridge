import { Client } from 'hypixel-api-reborn'

const API_KEY = process.env.HYPIXEL_API_KEY
if (!API_KEY) {
  throw new Error('HYPIXEL_API_KEY environment variable is not set')
}

async function main() {
  const client = new Client(API_KEY!)
  const player = await client.getPlayer('pgqn')
  const bridge = player.stats?.duels?.bridge

  console.log('--- Wrapper Output (buggy) ---')
  console.log('Wins:', bridge?.wins)
  console.log('WLR:', bridge?.WLRatio)
  console.log('CWS:', bridge?.winstreak)
  console.log('BWS:', bridge?.bestWinstreak)
}

main().catch(console.error)
