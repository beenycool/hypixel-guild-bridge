import type { DatabaseManager } from '../../common/database-manager.js'

export class TournamentTestPanels {
  private readonly entries = new Map<string, TournamentTestPanelEntry>()

  constructor(private readonly databaseManager: DatabaseManager) {}

  public async load(): Promise<void> {
    const rows = await this.databaseManager.queryRows<StoredTournamentTestPanelEntry>(
      'SELECT * FROM "tournamentTestPanels"'
    )
    this.entries.clear()
    for (const row of rows) {
      this.entries.set(row.messageId, fromStoredEntry(row))
    }
  }

  public getAll(): TournamentTestPanelEntry[] {
    return [...this.entries.values()].map((entry) => ({ ...entry }))
  }

  public add(entry: TournamentTestPanelEntry): void {
    const stored = { ...entry }
    this.entries.set(entry.messageId, stored)

    this.databaseManager.enqueueWrite(`saving tournament test panel ${entry.messageId}`, async (database) => {
      await database.query(
        `INSERT INTO "tournamentTestPanels" ("messageId", "channelId", "guildId", "tournamentId", "bridgeId", "currentStep", "historyJson", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT ("messageId") DO UPDATE SET
           "channelId" = EXCLUDED."channelId",
           "guildId" = EXCLUDED."guildId",
           "tournamentId" = EXCLUDED."tournamentId",
           "bridgeId" = EXCLUDED."bridgeId",
           "currentStep" = EXCLUDED."currentStep",
           "historyJson" = EXCLUDED."historyJson"`,
        [
          stored.messageId,
          stored.channelId,
          stored.guildId,
          stored.tournamentId,
          stored.bridgeId,
          stored.currentStep,
          stored.historyJson,
          Math.floor(stored.createdAt / 1000)
        ]
      )
    })
  }

  public get(messageId: string): TournamentTestPanelEntry | undefined {
    const entry = this.entries.get(messageId)
    if (entry === undefined) return undefined
    return { ...entry }
  }

  public remove(messageId: string): void {
    this.entries.delete(messageId)

    this.databaseManager.enqueueWrite(`removing tournament test panel ${messageId}`, async (database) => {
      await database.query('DELETE FROM "tournamentTestPanels" WHERE "messageId" = $1', [messageId])
    })
  }

  public updateStep(messageId: string, currentStep: number, historyJson: string): void {
    const current = this.entries.get(messageId)
    if (current !== undefined) {
      current.currentStep = currentStep
      current.historyJson = historyJson
    }

    this.databaseManager.enqueueWrite(`updating tournament test panel step ${messageId}`, async (database) => {
      await database.query(
        'UPDATE "tournamentTestPanels" SET "currentStep" = $1, "historyJson" = $2 WHERE "messageId" = $3',
        [currentStep, historyJson, messageId]
      )
    })
  }

  public removeByTournamentId(tournamentId: number): void {
    const toRemove: string[] = []
    for (const [messageId, entry] of this.entries) {
      if (entry.tournamentId === tournamentId) {
        toRemove.push(messageId)
      }
    }
    for (const messageId of toRemove) {
      this.entries.delete(messageId)
    }

    this.databaseManager.enqueueWrite(
      `removing tournament test panels for tournament ${tournamentId}`,
      async (database) => {
        await database.query('DELETE FROM "tournamentTestPanels" WHERE "tournamentId" = $1', [tournamentId])
      }
    )
  }
}

export interface TournamentTestPanelEntry {
  messageId: string
  channelId: string
  guildId: string
  tournamentId: number
  bridgeId: string
  currentStep: number
  historyJson: string
  createdAt: number
}

interface StoredTournamentTestPanelEntry {
  messageId: string
  channelId: string
  guildId: string
  tournamentId: number
  bridgeId: string
  currentStep: number
  historyJson: string
  createdAt: number
}

function fromStoredEntry(entry: StoredTournamentTestPanelEntry): TournamentTestPanelEntry {
  return {
    ...entry,
    createdAt: entry.createdAt * 1000
  }
}
