export interface AiChatStorage {
  isBridgeEnabled(bridgeId: string | undefined): Promise<boolean>
  isBridgeMuted(bridgeId: string | undefined): Promise<boolean>
  setBridgeMuted(bridgeId: string | undefined, muted: boolean): Promise<void>
  getNote(bridgeId: string | undefined, playerId: string): Promise<string | undefined>
  renderNotesMarkdown(bridgeId: string | undefined, playerId: string): Promise<string>
  saveNote(bridgeId: string | undefined, playerId: string, note: string): Promise<void>
  getUserMode(playerId: string): Promise<string | undefined>
  setUserMode(playerId: string, mode: string | undefined): Promise<void>
}

export const AiChatNoOpStorage: AiChatStorage = {
  isBridgeEnabled: () => Promise.resolve(false),
  isBridgeMuted: () => Promise.resolve(false),
  setBridgeMuted: () => Promise.resolve(),
  getNote: () => Promise.resolve(undefined),
  renderNotesMarkdown: () => Promise.resolve(''),
  saveNote: () => Promise.resolve(),
  getUserMode: () => Promise.resolve(undefined),
  setUserMode: () => Promise.resolve()
}
