export interface AiChatStorage {
  isMuted(bridgeId: string | undefined, playerId: string): Promise<boolean>
  renderNotesMarkdown(bridgeId: string | undefined, playerId: string): Promise<string>
  saveNote(bridgeId: string | undefined, playerId: string, note: string): Promise<void>
}

export const AiChatNoOpStorage: AiChatStorage = {
  isMuted: () => Promise.resolve(false),
  renderNotesMarkdown: () => Promise.resolve(''),
  saveNote: () => Promise.resolve()
}
