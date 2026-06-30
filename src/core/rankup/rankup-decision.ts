export type RankupDecision =
  | { kind: 'none'; uuid: string }
  | { kind: 'promote'; uuid: string; currentRank: string; targetRank: string; reason: string }
  | { kind: 'demote'; uuid: string; currentRank: string; targetRank: string; reason: string }
  | { kind: 'kick'; uuid: string; currentRank: string; reason: string }
  | { kind: 'notify'; uuid: string; currentRank: string; reason: string }
