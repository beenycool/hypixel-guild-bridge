export function validateSeriesScore(
  bestOf: number,
  p1Wins: number,
  p2Wins: number
): { valid: boolean; message: string } {
  if (!Number.isInteger(bestOf) || bestOf <= 0) {
    return { valid: false, message: `Best-of must be a positive integer (got ${bestOf}).` }
  }
  if (!Number.isInteger(p1Wins) || !Number.isInteger(p2Wins) || p1Wins < 0 || p2Wins < 0) {
    return { valid: false, message: 'Scores must be non-negative integers.' }
  }
  if (p1Wins + p2Wins > bestOf) {
    return { valid: false, message: `Total wins (${p1Wins + p2Wins}) cannot exceed best-of ${bestOf}.` }
  }

  const target = Math.ceil(bestOf / 2)
  const max = Math.max(p1Wins, p2Wins)
  const min = Math.min(p1Wins, p2Wins)

  if (max < target) {
    return {
      valid: false,
      message: `Series is not finished yet. Best-of ${bestOf} requires ${target} wins (current: ${p1Wins}-${p2Wins}).`
    }
  }
  if (max > target || min >= target) {
    return { valid: false, message: `Invalid score for best-of ${bestOf} (${p1Wins}-${p2Wins}).` }
  }

  return { valid: true, message: 'Score is valid.' }
}
