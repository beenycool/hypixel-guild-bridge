/* eslint-disable unicorn/prevent-abbreviations, unicorn/no-for-loop, @typescript-eslint/prefer-for-of */

export const PLAYER_RANKS = [
  'Default',
  'VIP',
  'VIP+',
  'MVP',
  'MVP+',
  'MVP++',
  'YouTube',
  'Game Master',
  'Admin',
  'PIG+++',
  'INNIT',
  'MOMMY',
  'DADDY',
  'RICE',
  'GINGER',
  'WIFEY',
  'WANKER',
  'MUG',
  'IRISH WANKER',
  'FRENCHIE',
  'LESBIAN',
  'GAY'
] as const

export type PlayerRank = (typeof PLAYER_RANKS)[number]

export function isPlayerRank(v: string): v is PlayerRank {
  return (PLAYER_RANKS as readonly string[]).includes(v)
}

export function normalizePlayerRank(v: string): PlayerRank | undefined {
  v = v.trim()
  if (v == '') return undefined
  for (let i = 0; i < PLAYER_RANKS.length; i++) {
    if (PLAYER_RANKS[i].toLowerCase() == v.toLowerCase()) return PLAYER_RANKS[i]
  }
  return undefined
}

export function formatRankPrefix(rank: string): string {
  if (rank == 'VIP') return '§a[VIP]'
  if (rank == 'VIP+') return '§a[VIP§6+§a]'
  if (rank == 'MVP') return '§b[MVP]'
  if (rank == 'MVP+') return '§b[MVP§c+§b]'
  if (rank == 'MVP++') return '§6[MVP§c+§c+§6]'
  if (rank == 'YouTube') return '§c[§fYOUTUBE§c]'
  if (rank == 'Game Master') return '§2[GM]'
  if (rank == 'Admin') return '§c[ADMIN]'
  if (rank == 'PIG+++') return '§d[PIG§c+++§d]'
  if (rank == 'INNIT') return '§9[INNIT]'
  if (rank == 'MOMMY') return '§d[MOMMY]'
  if (rank == 'DADDY') return '§9[DADDY]'
  if (rank == 'RICE') return '§e[RICE]'
  if (rank == 'GINGER') return '§6[GINGER]'
  if (rank == 'WIFEY') return '§b[WIFEY]'
  if (rank == 'WANKER') return '§5[WANKER]'
  if (rank == 'MUG') return '§4[MUG]'
  if (rank == 'IRISH WANKER') return '§2[IRISH WANKER]'
  if (rank == 'FRENCHIE') return '§9[§fFREN§cCHIE§9]'
  if (rank == 'LESBIAN') return '§6[§fLES§dBIAN§6]'
  if (rank == 'GAY') return '§c[§6G§eA§aY§c]'
  return ''
}

const RE = /^\s*(?:§[0-9a-fr])*\[[^\]]*](?:§[0-9a-fr])*/

export function stripRealRankPrefix(m: string): string {
  return m.replace(RE, '')
}
