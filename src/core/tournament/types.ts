export enum TournamentStatus {
  Signup = 'SIGNUP',
  Active = 'ACTIVE',
  Completed = 'COMPLETED',
  Cancelled = 'CANCELLED'
}

export enum PlayerStatus {
  Registered = 'REGISTERED',
  CheckedIn = 'CHECKED_IN',
  Waitlisted = 'WAITLISTED',
  Active = 'ACTIVE',
  Eliminated = 'ELIMINATED',
  Winner = 'WINNER'
}

export enum MatchStatus {
  Pending = 'PENDING',
  Active = 'ACTIVE',
  Reported = 'REPORTED',
  Disputed = 'DISPUTED',
  BothConfirmed = 'BOTH_CONFIRMED',
  Completed = 'COMPLETED',
  Bye = 'BYE'
}

export interface Tournament {
  id: number
  bridgeId: string
  name: string
  gameType: string
  bestOf: number
  status: TournamentStatus
  roundDeadlineHours: number
  createdBy: string
  winnerId: number | undefined
  discordChannelId: string | undefined
  bracketMessageId: string | undefined
  categoryChannelId: string | undefined
  liveChannelId: string | undefined
  checkinOpensAt: number | undefined
  checkinClosesAt: number | undefined
  startedAtUnix: number | undefined
  currentRound: number
  totalRounds: number
  bracketFormat?: string
  createdAt: number
  startedAt: number | undefined
  completedAt: number | undefined
}

export interface TournamentPlayer {
  id: number
  tournamentId: number
  playerUuid: string
  discordId: string | undefined
  seed: number
  status: PlayerStatus
  joinedAt: number
  checkedInAt: number | undefined
}

export interface TournamentMatch {
  id: number
  tournamentId: number
  round: number
  matchIndex: number
  player1Id: number | undefined
  player2Id: number | undefined
  winnerId: number | undefined
  nextMatchId: number | undefined
  loserNextMatchId?: number
  status: MatchStatus
  player1Wins: number
  player2Wins: number
  discordThreadId: string | undefined
  deadlineAt: number | undefined
  warningsSent: number
  completedAt: number | undefined
  deadlineExtensionMinutes: number
  manuallyExtended: boolean
  hadProofAttachment: boolean
}

export interface TournamentReport {
  id: number
  matchId: number
  reporterId: number
  claimedWinnerId: number
  player1Wins: number
  player2Wins: number
  createdAt: number
}
