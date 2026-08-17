import path from 'node:path'

import { createCanvas, registerFont } from 'canvas'

import { MatchStatus } from './types.js'
import type { Tournament, TournamentMatch, TournamentPlayer } from './types.js'

interface BracketData {
  tournament: Tournament
  matches: TournamentMatch[]
  players: TournamentPlayer[]
  playerNames: Map<number, string>
}

export class BracketVisualizer {
  constructor() {
    try {
      registerFont(path.join('resources', 'fonts', 'MinecraftRegular-Bmg3.ttf'), { family: 'Minecraft' })
    } catch (error: unknown) {
      void error
    }
  }

  buildBracketImage(data: BracketData): Buffer | null {
    try {
      /* eslint-disable unicorn/no-null */
      if (data.matches.length === 0) return null

      const totalRounds = Math.max(1, data.tournament.totalRounds)
      const maxMatchesRound1 = Math.pow(2, totalRounds - 1)

      const matchHeight = 60
      const matchSpacing = 20
      const slotHeight = matchHeight + matchSpacing
      const columnWidth = 220
      const padding = 20
      const headerHeight = 50

      const width = totalRounds * columnWidth + padding * 2
      const height = Math.max(headerHeight + padding * 2 + maxMatchesRound1 * slotHeight, 200)

      const canvas = createCanvas(width, height)
      const context = canvas.getContext('2d')

      context.fillStyle = '#1a1a2e'
      context.fillRect(0, 0, width, height)

      context.font = '18px Minecraft, sans-serif'
      context.fillStyle = '#ffffff'
      context.textAlign = 'center'
      context.fillText(`${data.tournament.name} — Bracket`, width / 2, 28, width - 40)

      const matchesByRound = new Map<number, TournamentMatch[]>()
      for (const match of data.matches) {
        const round = match.round
        const roundMatches = matchesByRound.get(round)
        if (roundMatches === undefined) {
          matchesByRound.set(round, [match])
        } else {
          roundMatches.push(match)
        }
      }

      context.font = '14px Minecraft, sans-serif'
      context.fillStyle = '#888888'
      context.textAlign = 'center'
      for (let r = 1; r <= totalRounds; r++) {
        const headerX = padding + (r - 1) * columnWidth + columnWidth / 2
        const label = r === totalRounds ? 'Finals' : r === totalRounds - 1 ? 'Semifinals' : `Round ${r}`
        context.fillText(label, headerX, headerHeight + 5, columnWidth - 20)
      }

      const centerYMap = new Map<number, number>()

      for (let round = 1; round <= totalRounds; round++) {
        const roundMatches = matchesByRound.get(round) ?? []
        const colX = padding + (round - 1) * columnWidth
        const boxX = colX + 15
        const boxWidth = columnWidth - 30

        for (const match of roundMatches) {
          const matchIndex = match.matchIndex
          const slotsInRound = Math.pow(2, round - 1)
          const centerSlotIndex = matchIndex * slotsInRound + (slotsInRound - 1) / 2
          const centerY = headerHeight + padding + (centerSlotIndex + 0.5) * slotHeight
          const y = centerY - matchHeight / 2

          centerYMap.set(match.id, centerY)

          let borderColor: string
          let bgColor: string

          switch (match.status) {
            case MatchStatus.Completed:
            case MatchStatus.Bye: {
              borderColor = '#2ecc71'
              bgColor = '#1a3a1a'
              break
            }
            case MatchStatus.Disputed: {
              borderColor = '#e74c3c'
              bgColor = '#3a1a1a'
              break
            }
            case MatchStatus.Active:
            case MatchStatus.Reported: {
              borderColor = '#f39c12'
              bgColor = '#3a2a1a'
              break
            }
            default: {
              borderColor = '#555555'
              bgColor = '#222222'
            }
          }

          context.fillStyle = bgColor
          context.strokeStyle = borderColor
          context.lineWidth = 2
          context.beginPath()
          context.roundRect(boxX, y, boxWidth, matchHeight, 6)
          context.fill()
          context.stroke()

          const p1Name = match.player1Id ? (data.playerNames.get(match.player1Id) ?? 'TBD') : '—'
          const p1Score = match.player1Wins ? String(match.player1Wins) : ''
          const p1IsWinner = match.winnerId !== undefined && match.player1Id === match.winnerId

          context.font = '12px Minecraft, sans-serif'
          context.textAlign = 'left'
          context.fillStyle = p1IsWinner ? '#2ecc71' : match.player1Id ? '#cccccc' : '#666666'
          context.fillText(p1Name, boxX + 8, y + 20, boxWidth - 45)

          if (p1Score) {
            context.textAlign = 'right'
            context.fillStyle = p1IsWinner ? '#2ecc71' : '#888888'
            context.fillText(p1Score, boxX + boxWidth - 8, y + 20)
          }

          context.strokeStyle = '#444444'
          context.lineWidth = 1
          context.beginPath()
          context.moveTo(boxX + 6, y + matchHeight / 2)
          context.lineTo(boxX + boxWidth - 6, y + matchHeight / 2)
          context.stroke()

          const p2Name = match.player2Id ? (data.playerNames.get(match.player2Id) ?? 'TBD') : '—'
          const p2Score = match.player2Wins ? String(match.player2Wins) : ''
          const p2IsWinner = match.winnerId !== undefined && match.player2Id === match.winnerId

          context.textAlign = 'left'
          context.fillStyle = p2IsWinner ? '#2ecc71' : match.player2Id ? '#cccccc' : '#666666'
          context.fillText(p2Name, boxX + 8, y + matchHeight / 2 + 20, boxWidth - 45)

          if (p2Score) {
            context.textAlign = 'right'
            context.fillStyle = p2IsWinner ? '#2ecc71' : '#888888'
            context.fillText(p2Score, boxX + boxWidth - 8, y + matchHeight / 2 + 20)
          }

          if (round < totalRounds) {
            const nextColX = padding + round * columnWidth
            const nextBoxX = nextColX + 15
            const midX = (boxX + boxWidth + nextBoxX) / 2

            const nextMatchIndex = Math.floor(matchIndex / 2)
            const nextSlotsInRound = Math.pow(2, round)
            const nextCenterSlotIndex = nextMatchIndex * nextSlotsInRound + (nextSlotsInRound - 1) / 2
            const nextCenterY = headerHeight + padding + (nextCenterSlotIndex + 0.5) * slotHeight

            context.strokeStyle = borderColor
            context.lineWidth = 1.5
            context.beginPath()
            context.moveTo(boxX + boxWidth, centerY)
            context.lineTo(midX, centerY)
            context.lineTo(midX, nextCenterY)
            context.lineTo(nextBoxX, nextCenterY)
            context.stroke()
          }
        }
      }

      return canvas.toBuffer('image/png')
    } catch {
      return null
    }
  }

  buildMcBracketSummary(data: BracketData): string {
    const lines: string[] = [`&6&l${data.tournament.name}`]

    const matchesByRound = new Map<number, TournamentMatch[]>()
    for (const match of data.matches) {
      const round = match.round
      const roundMatches = matchesByRound.get(round)
      if (roundMatches === undefined) {
        matchesByRound.set(round, [match])
      } else {
        roundMatches.push(match)
      }
    }

    for (const [round, roundMatches] of matchesByRound) {
      const label = round === data.tournament.totalRounds ? '&e&lFINAL' : `&e&lRound ${round}`
      lines.push('')
      lines.push(label)

      for (const match of roundMatches) {
        const p1 = match.player1Id ? (data.playerNames.get(match.player1Id) ?? 'TBD') : 'BYE'
        const p2 = match.player2Id ? (data.playerNames.get(match.player2Id) ?? 'TBD') : 'BYE'

        let statusIcon: string
        switch (match.status) {
          case MatchStatus.Completed: {
            statusIcon = '&a✔'
            break
          }
          case MatchStatus.Disputed: {
            statusIcon = '&c⚠'
            break
          }
          case MatchStatus.Active:
          case MatchStatus.Reported: {
            statusIcon = '&6⏳'
            break
          }
          default: {
            statusIcon = '&7—'
          }
        }

        if (match.status === MatchStatus.Completed && match.winnerId) {
          const winnerName = match.winnerId === match.player1Id ? p1 : p2
          const score = `${match.player1Wins}-${match.player2Wins}`
          lines.push(`${statusIcon} ${p1} vs ${p2} &7(${score}) &a${winnerName} wins`)
        } else if (match.status === MatchStatus.Bye) {
          const advancerId = match.player1Id ?? match.player2Id
          const advancer = advancerId === undefined ? 'TBD' : (data.playerNames.get(advancerId) ?? 'TBD')
          lines.push(`${statusIcon} ${p1} &7(BYE) &a${advancer} advances`)
        } else {
          lines.push(`${statusIcon} ${p1} vs ${p2}`)
        }
      }
    }

    return lines.join('\n')
  }
}
