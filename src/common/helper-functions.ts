export function formatNumber(number: number | undefined | null, decimals = 2): string {
  if (number === undefined || number === null || number === 0) return '0'

  const isNegative = number < 0
  const unformattedNumber = Math.abs(number)

  if (unformattedNumber < 100_000) {
    return number.toLocaleString()
  }

  const abbrev = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'S', 'O', 'N', 'D']
  const abbrevIndex = Math.floor(Math.log10(unformattedNumber) / 3)

  if (abbrevIndex >= abbrev.length) return number.toExponential(decimals)

  const shortNumber = (unformattedNumber / Math.pow(10, abbrevIndex * 3)).toFixed(decimals)

  return `${isNegative ? '-' : ''}${shortNumber}${abbrev[abbrevIndex]}`
}

export function titleCase(inputString: string | undefined | null): string {
  if (!inputString) return ''
  return inputString
    .toLowerCase()
    .replaceAll('_', ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
