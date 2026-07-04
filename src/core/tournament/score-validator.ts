export interface ScoreValidationResult {
  valid: boolean
  message: string
}

/**
 * Validates a best-of-N series score.
 *
 * Rules:
 *  - Both scores must be non-negative.
 *  - Sum of scores cannot exceed bestOf (impossible to play more games than the series cap).
 *  - The series winner must reach the target win count (ceil(bestOf / 2)).
 *  - The losing score must be strictly less than the target (no ties).
 */
export function validateSeriesScore(bestOf: number, p1Wins: number, p2Wins: number): ScoreValidationResult {
  if (!Number.isInteger(bestOf) || bestOf <= 0) {
    return { valid: false, message: `Best-of must be a positive integer (got ${bestOf}).` }
  }
  if (!Number.isInteger(p1Wins) || !Number.isInteger(p2Wins)) {
    return { valid: false, message: 'Scores must be integers.' }
  }
  if (p1Wins < 0 || p2Wins < 0) {
    return { valid: false, message: 'Scores must be non-negative.' }
  }
  if (p1Wins + p2Wins > bestOf) {
    return { valid: false, message: `Total wins (${p1Wins + p2Wins}) cannot exceed best-of ${bestOf}.` }
  }
  const target = Math.ceil(bestOf / 2)
  const max = Math.max(p1Wins, p2Wins)
  const min = Math.min(p1Wins, p2Wins)
  if (max !== target) {
    if (max < target) {
      return {
        valid: false,
        message: `Series is not finished yet. Best-of ${bestOf} requires ${target} wins (current: ${p1Wins}-${p2Wins}).`
      }
    }
    return { valid: false, message: `Series winner cannot exceed ${target} wins in a best-of ${bestOf}.` }
  }
  if (min >= target) {
    return { valid: false, message: `Series cannot end in a tie (${p1Wins}-${p2Wins}).` }
  }
  return { valid: true, message: 'Score is valid.' }
}
