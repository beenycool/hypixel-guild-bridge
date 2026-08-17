export function validateSeriesScore(
  bestOf: number,
  p1Wins: number,
  p2Wins: number
): { valid: boolean; message: string } {
  const target = Math.ceil(bestOf / 2)
  const max = Math.max(p1Wins, p2Wins)
  const min = Math.min(p1Wins, p2Wins)

  if (bestOf <= 0 || p1Wins < 0 || p2Wins < 0 || p1Wins + p2Wins > bestOf) {
    return { valid: false, message: 'Invalid score.' }
  }
  if (max < target) {
    return { valid: false, message: `Need ${target} wins for BO${bestOf} (currently ${p1Wins}-${p2Wins}).` }
  }
  if (max > target || min >= target) {
    return { valid: false, message: `Invalid score for BO${bestOf} (${p1Wins}-${p2Wins}).` }
  }
  return { valid: true, message: 'Score is valid.' }
}
