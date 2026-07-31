import path from 'node:path'

import { createCanvas, registerFont } from 'canvas'

import { MatchStatus, TournamentStatus } from './types.js'
import type { Tournament, TournamentMatch, TournamentPlayer } from './types.js'

export interface BracketData {
  tournament: Tournament
  matches: TournamentMatch[]
  players: TournamentPlayer[]
  playerNames: Map<number, string>
}

export class BracketVisualizer {
  constructor() {
    try {
      registerFont(path.join('resources', 'fonts', 'MinecraftRegular-Bmg3.ttf'), { family: 'Minecraft' })
    } catch {
      // Font registration is optional; canvas will fall back to sans-serif
    }
  }

  buildBracketImage(data: BracketData): Buffer | null {
    try {
      if (data.matches.length === 0) return null

      const totalRounds = Math.max(1, data.tournament.totalRounds ?? 1)
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

      // Dark background
      context.fillStyle = '#1a1a2e'
      context.fillRect(0, 0, width, height)

      // Header title
      context.font = '18px Minecraft, sans-serif'
      context.fillStyle = '#ffffff'
      context.textAlign = 'center'
      context.fillText(`${data.tournament.name} — Bracket`, width / 2, 28, width - 40)

      // Group matches by round
      const matchesByRound = new Map<number, TournamentMatch[]>()
      for (const match of data.matches) {
        const round = match.round
        if (!matchesByRound.has(round)) matchesByRound.set(round, [])
        matchesByRound.get(round)!.push(match)
      }

      // Render round header labels
      context.font = '14px Minecraft, sans-serif'
      context.fillStyle = '#888888'
      context.textAlign = 'center'
      for (let r = 1; r <= totalRounds; r++) {
        const headerX = padding + (r - 1) * columnWidth + columnWidth / 2
        const label = r === totalRounds ? 'Finals' : r === totalRounds - 1 ? 'Semifinals' : `Round ${r}`
        context.fillText(label, headerX, headerHeight + 5, columnWidth - 20)
      }

      // Map to store center Y coordinates for matches
      const centerYMap = new Map<number, number>()

      for (let round = 1; round <= totalRounds; round++) {
        const roundMatches = matchesByRound.get(round) ?? []
        const colX = padding + (round - 1) * columnWidth
        const boxX = colX + 15
        const boxWidth = columnWidth - 30

        for (const [index, match] of roundMatches.entries()) {
          const matchIdx = match.matchIndex ?? index
          const slotsInRound = Math.pow(2, round - 1)
          const centerSlotIndex = matchIdx * slotsInRound + (slotsInRound - 1) / 2
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

          // Draw match card container
          context.fillStyle = bgColor
          context.strokeStyle = borderColor
          context.lineWidth = 2
          context.beginPath()
          context.roundRect(boxX, y, boxWidth, matchHeight, 6)
          context.fill()
          context.stroke()

          // Draw player 1 info
          const p1Name = match.player1Id ? (data.playerNames.get(match.player1Id) ?? 'TBD') : '—'
          const p1Score =
            match.player1Wins !== null && match.player1Wins !== undefined ? match.player1Wins.toString() : ''
          const p1IsWinner = match.winnerId !== null && match.player1Id === match.winnerId

          context.font = '12px Minecraft, sans-serif'
          context.textAlign = 'left'
          context.fillStyle = p1IsWinner ? '#2ecc71' : match.player1Id ? '#cccccc' : '#666666'
          context.fillText(p1Name, boxX + 8, y + 20, boxWidth - 45)

          if (p1Score) {
            context.textAlign = 'right'
            context.fillStyle = p1IsWinner ? '#2ecc71' : '#888888'
            context.fillText(p1Score, boxX + boxWidth - 8, y + 20)
          }

          // Divider line between players
          context.strokeStyle = '#444444'
          context.lineWidth = 1
          context.beginPath()
          context.moveTo(boxX + 6, y + matchHeight / 2)
          context.lineTo(boxX + boxWidth - 6, y + matchHeight / 2)
          context.stroke()

          // Draw player 2 info
          const p2Name = match.player2Id ? (data.playerNames.get(match.player2Id) ?? 'TBD') : '—'
          const p2Score =
            match.player2Wins !== null && match.player2Wins !== undefined ? match.player2Wins.toString() : ''
          const p2IsWinner = match.winnerId !== null && match.player2Id === match.winnerId

          context.textAlign = 'left'
          context.fillStyle = p2IsWinner ? '#2ecc71' : match.player2Id ? '#cccccc' : '#666666'
          context.fillText(p2Name, boxX + 8, y + matchHeight / 2 + 20, boxWidth - 45)

          if (p2Score) {
            context.textAlign = 'right'
            context.fillStyle = p2IsWinner ? '#2ecc71' : '#888888'
            context.fillText(p2Score, boxX + boxWidth - 8, y + matchHeight / 2 + 20)
          }

          // Draw connector line to next round if available
          if (round < totalRounds) {
            const nextColX = padding + round * columnWidth
            const nextBoxX = nextColX + 15
            const midX = (boxX + boxWidth + nextBoxX) / 2

            const nextMatchIdx = Math.floor(matchIdx / 2)
            const nextSlotsInRound = Math.pow(2, round)
            const nextCenterSlotIndex = nextMatchIdx * nextSlotsInRound + (nextSlotsInRound - 1) / 2
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
      if (!matchesByRound.has(round)) matchesByRound.set(round, [])
      matchesByRound.get(round)!.push(match)
    }

    for (const [round, roundMatches] of matchesByRound) {
      const label = round === (data.tournament.totalRounds ?? 1) ? '&e&lFINAL' : `&e&lRound ${round}`
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
          const score = `${match.player1Wins ?? 0}-${match.player2Wins ?? 0}`
          lines.push(`${statusIcon} ${p1} vs ${p2} &7(${score}) &a${winnerName} wins`)
        } else if (match.status === MatchStatus.Bye) {
          const advancer = match.player1Id
            ? (data.playerNames.get(match.player1Id) ?? 'TBD')
            : (data.playerNames.get(match.player2Id!) ?? 'TBD')
          lines.push(`${statusIcon} ${p1} &7(BYE) &a${advancer} advances`)
        } else {
          lines.push(`${statusIcon} ${p1} vs ${p2}`)
        }
      }
    }

    return lines.join('\n')
  }
}
