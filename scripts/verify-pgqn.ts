const API_KEY = process.env.HYPIXEL_API_KEY
if (!API_KEY) {
  console.error('HYPIXEL_API_KEY environment variable is required')
  process.exit(1)
}

async function main() {
  const res = await fetch(`https://api.hypixel.net/v2/player?key=${API_KEY}&uuid=f2cda349c6f547b2b7070ec6d06f6a5e`)
  const json = (await res.json()) as any
  const rawDuels = json.player?.stats?.Duels as Record<string, unknown> | undefined

  if (!rawDuels) {
    console.log('No Duels data')
    return
  }

  const winFields = [
    'bridge_duel_wins',
    'bridge_doubles_wins',
    'bridge_threes_wins',
    'bridge_four_wins',
    'bridge_2v2v2v2_wins',
    'bridge_3v3v3v3_wins',
    'capture_threes_wins'
  ]
  const lossFields = [
    'bridge_duel_losses',
    'bridge_doubles_losses',
    'bridge_threes_losses',
    'bridge_four_losses',
    'bridge_2v2v2v2_losses',
    'bridge_3v3v3v3_losses',
    'capture_threes_losses'
  ]

  const wins = winFields.map((k) => (typeof rawDuels[k] === 'number' ? rawDuels[k] : 0))
  const totalWins = wins.reduce((s, v) => s + v, 0)
  const losses = lossFields.map((k) => (typeof rawDuels[k] === 'number' ? rawDuels[k] : 0))
  const totalLosses = losses.reduce((s, v) => s + v, 0)

  console.log('--- pgqn Live Raw Bridge (via fetch, same logic as fix) ---')
  console.log(
    'Wins:',
    totalWins,
    '->',
    totalWins >= 1000 ? `${Math.floor(totalWins / 100) / 10}k` : totalWins.toString()
  )
  console.log('Losses:', totalLosses)
  console.log('WLR:', totalLosses === 0 ? totalWins : (totalWins / totalLosses).toFixed(2))
  console.log('CWS:', rawDuels.current_bridge_winstreak)
  console.log('BWS:', rawDuels.best_bridge_winstreak)
}

main().catch(console.error)
