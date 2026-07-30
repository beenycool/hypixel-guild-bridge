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

      const totalRounds = data.tournament.totalRounds ?? 1
      const matchHeight = 60
      const columnWidth = 220
      const padding = 20
      const headerHeight = 40

      const width = totalRounds * columnWidth + padding * 2 + 40
      const height = Math.max(Math.pow(2, totalRounds - 1) * matchHeight * 2 + headerHeight + padding * 2, 200)

      const canvas = createCanvas(width, height)
      const context = canvas.getContext('2d')

      context.fillStyle = '#1a1a2e'
      context.fillRect(0, 0, width, height)

      context.font = '18px Minecraft, sans-serif'
      context.fillStyle = '#e0e0e0'
      context.textAlign = 'center'
      context.fillText(`${data.tournament.name} — Bracket`, width / 2, 30)

      const matchesByRound = new Map<number, TournamentMatch[]>()
      for (const match of data.matches) {
        const round = match.round
        if (!matchesByRound.has(round)) matchesByRound.set(round, [])
        matchesByRound.get(round)!.push(match)
      }

      context.font = '14px Minecraft, sans-serif'
      context.fillStyle = '#888'
      context.textAlign = 'center'
      for (let r = 1; r <= totalRounds; r++) {
        const x = padding + (r - 1) * columnWidth + columnWidth / 2
        const label = r === totalRounds ? 'Final' : r === totalRounds - 1 ? 'Semifinals' : `Round ${r}`
        context.fillText(label, x, headerHeight + 15)
      }

      for (const [round, roundMatches] of matchesByRound) {
        const x = padding + (round - 1) * columnWidth + 20
        const slotsInRound = totalRounds === 1 ? 1 : Math.pow(2, totalRounds - round)
        const slotSpacing = Math.max(80, (height - headerHeight - padding * 2) / (slotsInRound + 1))

        for (const [index, match] of roundMatches.entries()) {
          const y = headerHeight + padding + (index + 0.5) * slotSpacing * 2 - matchHeight / 2

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
              borderColor = '#555'
              bgColor = '#222'
            }
          }

          context.fillStyle = bgColor
          context.strokeStyle = borderColor
          context.lineWidth = 2
          context.beginPath()
          context.roundRect(x, y, columnWidth - 40, matchHeight, 6)
          context.fill()
          context.stroke()

          const p1Name = match.player1Id ? (data.playerNames.get(match.player1Id) ?? 'TBD') : '—'
          const p1Score =
            match.player1Wins !== null && match.player1Wins !== undefined ? match.player1Wins.toString() : ''
          const p1IsWinner = match.winnerId !== null && match.player1Id === match.winnerId

          context.font = '11px Minecraft, sans-serif'
          context.textAlign = 'left'
          context.fillStyle = p1IsWinner ? '#2ecc71' : match.player1Id ? '#ccc' : '#666'
          context.fillText(p1Name, x + 8, y + 20)

          if (p1Score) {
            context.textAlign = 'right'
            context.fillStyle = p1IsWinner ? '#2ecc71' : '#888'
            context.fillText(p1Score, x + columnWidth - 48, y + 20)
          }

          context.strokeStyle = '#444'
          context.lineWidth = 1
          context.beginPath()
          context.moveTo(x + 8, y + matchHeight / 2)
          context.lineTo(x + columnWidth - 48, y + matchHeight / 2)
          context.stroke()

          const p2Name = match.player2Id ? (data.playerNames.get(match.player2Id) ?? 'TBD') : '—'
          const p2Score =
            match.player2Wins !== null && match.player2Wins !== undefined ? match.player2Wins.toString() : ''
          const p2IsWinner = match.winnerId !== null && match.player2Id === match.winnerId

          context.textAlign = 'left'
          context.fillStyle = p2IsWinner ? '#2ecc71' : match.player2Id ? '#ccc' : '#666'
          context.fillText(p2Name, x + 8, y + matchHeight / 2 + 20)

          if (p2Score) {
            context.textAlign = 'right'
            context.fillStyle = p2IsWinner ? '#2ecc71' : '#888'
            context.fillText(p2Score, x + columnWidth - 48, y + matchHeight / 2 + 20)
          }

          if (round < totalRounds) {
            const nextX = x + columnWidth - 40
            const nextYStart = y + matchHeight / 2
            context.strokeStyle = borderColor
            context.lineWidth = 1
            context.beginPath()
            context.moveTo(nextX, nextYStart)
            context.lineTo(nextX + 10, nextYStart)
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
