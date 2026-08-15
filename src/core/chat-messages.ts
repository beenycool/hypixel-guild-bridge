import type Application from '../application.js'
import { ChannelType } from '../common/application-event.js'
import type { DatabaseManager } from '../common/database-manager.js'
import Duration from '../utility/duration.js'

const MESSAGE_RETENTION = Duration.days(7)
const MAX_MESSAGES_TO_FETCH = 50

export class ChatMessagesService {
  private initialized = false

  constructor(
    private readonly app: Application,
    private readonly databaseManager: DatabaseManager
  ) {}

  init(): void {
    if (this.initialized) return
    this.initialized = true

    this.app.on('chat', (event) => {
      if (event.channelType !== ChannelType.Public) return

      if (event.message.startsWith('!')) return

      const userId = event.user.discordProfile()?.id ?? event.user.mojangProfile()?.id ?? event.user.displayName()
      const username = event.user.displayName()
      const discordId = event.user.discordProfile()?.id ?? undefined
      const bridgeId = event.bridgeId ?? this.app.bridgeResolver.getBridgeIdForInstance(event.instanceName) ?? undefined

      this.databaseManager.enqueueWrite(`storing chat message for ${userId}`, async (database) => {
        await database.query(
          `INSERT INTO "ChatMessages" ("userId", "message", "createdAt", "bridgeId", "username", "discordId") VALUES ($1, $2, $3, $4, $5, $6)`,
          [userId, event.message, Math.floor(Date.now() / 1000), bridgeId, username, discordId]
        )
      })
    })

    this.databaseManager.registerCleaner(() => this.clean())
  }

  async getMessages(userId: string): Promise<string[]> {
    const rows = await this.databaseManager.queryRows<{ message: string }>(
      `SELECT "message" FROM "ChatMessages" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT ${MAX_MESSAGES_TO_FETCH}`,
      [userId]
    )
    return rows.map((r) => r.message).toReversed()
  }

  async getMessagesByUsername(username: string): Promise<string[]> {
    const rows = await this.databaseManager.queryRows<{ message: string }>(
      `SELECT "message" FROM "ChatMessages" WHERE LOWER("username") = LOWER($1) ORDER BY "createdAt" DESC LIMIT ${MAX_MESSAGES_TO_FETCH}`,
      [username]
    )
    return rows.map((r) => r.message).toReversed()
  }

  async getCachedIq(userId: string): Promise<number | undefined> {
    const row = await this.databaseManager.queryOne<{ iq: number; calculatedAt: number }>(
      `SELECT "iq", "calculatedAt" FROM "IqScores" WHERE "userId" = $1`,
      [userId]
    )
    if (row === undefined) return undefined

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayUnix = Math.floor(today.getTime() / 1000)

    if (row.calculatedAt >= todayUnix) {
      return row.iq
    }
    return undefined
  }

  async setCachedIq(userId: string, iq: number): Promise<void> {
    await this.databaseManager.transaction(async (database) => {
      await database.query(
        `INSERT INTO "IqScores" ("userId", "iq", "calculatedAt") VALUES ($1, $2, $3)
         ON CONFLICT ("userId") DO UPDATE SET "iq" = EXCLUDED."iq", "calculatedAt" = EXCLUDED."calculatedAt"`,
        [userId, iq, Math.floor(Date.now() / 1000)]
      )
    })
  }

  private async clean(): Promise<void> {
    const cutoff = Math.floor((Date.now() - MESSAGE_RETENTION.toMilliseconds()) / 1000)
    await this.databaseManager.execute('DELETE FROM "ChatMessages" WHERE "createdAt" < $1', [cutoff])
  }
}
