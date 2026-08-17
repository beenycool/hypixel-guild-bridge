// quick score validator for BO1/BO3/BO5 series - don't overthink it
export function validateSeriesScore(bo: number, p1: number, p2: number): { valid: boolean; message: string } {
  const request = Math.ceil(bo / 2)
  const hi = Math.max(p1, p2)
  const lo = Math.min(p1, p2)

  if (bo <= 0 || p1 < 0 || p2 < 0 || p1 + p2 > bo) {
    return { valid: false, message: 'Invalid score numbers' }
  }
  if (hi < request) {
    return { valid: false, message: `Need ${request} wins for BO${bo} (got ${p1}-${p2})` }
  }
  if (hi > request || lo >= request) {
    return { valid: false, message: `Impossible score for BO${bo} (${p1}-${p2})` }
  }
  return { valid: true, message: 'Score looks good' }
}
