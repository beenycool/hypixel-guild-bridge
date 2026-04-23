export type BridgeSubMode = 'solo' | 'doubles' | 'threes' | 'fours' | '2v2v2v2' | '3v3v3v3'

export const BridgeSubModeAliases = new Map<string, BridgeSubMode>([
  ['solo', 'solo'],
  ['1v1', 'solo'],
  ['doubles', 'doubles'],
  ['duos', 'doubles'],
  ['2v2', 'doubles'],
  ['threes', 'threes'],
  ['3v3', 'threes'],
  ['fours', 'fours'],
  ['4v4', 'fours'],
  ['2v2v2v2', '2v2v2v2'],
  ['4teams2', '2v2v2v2'],
  ['3v3v3v3', '3v3v3v3'],
  ['4teams3', '3v3v3v3']
])

export const BridgeSubModeDisplayNames = new Map<BridgeSubMode, string>([
  ['solo', 'Bridge 1v1'],
  ['doubles', 'Bridge 2v2'],
  ['threes', 'Bridge 3v3'],
  ['fours', 'Bridge 4v4'],
  ['2v2v2v2', 'Bridge 2v2v2v2'],
  ['3v3v3v3', 'Bridge 3v3v3v3']
])

export const ValidBridgeSubModes: ReadonlySet<BridgeSubMode> = new Set([
  'solo',
  'doubles',
  'threes',
  'fours',
  '2v2v2v2',
  '3v3v3v3'
])
