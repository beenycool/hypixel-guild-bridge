const fs = require('node:fs')

const file = 'src/instance/commands/triggers/woolwars.ts'
let code = fs.readFileSync(file, 'utf8')

code = code.replace(
  `    const stats = (player.stats as any)?.woolwars as
      | {
          level?: number
          stats?: { overall?: Record<string, number> }
        }
      | undefined
    if (stats?.stats?.overall == undefined) return \`\${givenUsername} has never played Wool Wars.\`

    const level = stats.level ?? 0
    const overall = stats.stats.overall

    const roundWins = overall.roundWins ?? 0
    const gamesPlayed = overall.gamesPlayed ?? 0
    const woolsPlaced = overall.woolsPlaced ?? 0
    const blocksBroken = overall.blocksBroken ?? 0
    const kdRatio = overall.KDRatio ?? 0`,
  `    const stats = (player.stats as Record<string, unknown> | undefined)?.woolgames as
      | {
          level?: number
          woolWars?: {
            wins?: number
            gamesPlayed?: number
            woolsPlaced?: number
            blocksBroken?: number
            /* eslint-disable-next-line @typescript-eslint/naming-convention */
            KDRatio?: number
          }
        }
      | undefined

    if (stats?.woolWars == undefined) return \`\${givenUsername} has never played Wool Wars.\`

    const level = stats.level ?? 0
    const overall = stats.woolWars

    const roundWins = overall.wins ?? 0
    const gamesPlayed = overall.gamesPlayed ?? 0
    const woolsPlaced = overall.woolsPlaced ?? 0
    const blocksBroken = overall.blocksBroken ?? 0
    const kdRatio = overall.KDRatio ?? 0`
)

fs.writeFileSync(file, code)
