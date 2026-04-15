import fs from 'node:fs'

import type { Logger } from 'log4js'

import type Application from '../../application'
import type { BasePunishment } from '../../common/application-event'
import { InstanceType, PunishmentPurpose, PunishmentType } from '../../common/application-event'
import type { DatabaseManager } from '../../common/database-manager'
import type { User, UserIdentifier } from '../../common/user'

export type SavedPunishment = BasePunishment & UserIdentifier

type DatabasePunishment = SavedPunishment & { id: number }

export default class Punishments {
  private readonly entries: DatabasePunishment[] = []
  private nextId = 1

  constructor(
    private readonly databaseManager: DatabaseManager,
    application: Application,
    logger: Logger
  ) {
    databaseManager.registerCleaner(() => {
      const cutoff = Math.floor(Date.now() / 1000)
      const before = this.entries.length
      for (let index = this.entries.length - 1; index >= 0; index--) {
        if (this.entries[index].till <= cutoff * 1000) {
          this.entries.splice(index, 1)
        }
      }

      const deleted = before - this.entries.length
      if (deleted > 0) {
        logger.debug(`Deleted ${deleted} entry of expired punishments`)
        this.databaseManager.enqueueWrite('cleaning expired punishments', async (database) => {
          await database.query('DELETE FROM "punishments" WHERE "till" < $1', [cutoff])
        })
      }
    })

    this.application = application
    this.logger = logger
  }

  private readonly application: Application
  private readonly logger: Logger

  public async initialize(): Promise<void> {
    await this.load()
    await this.migrateAnyOldData(this.application, this.logger)
  }

  public async load(): Promise<void> {
    const rows = await this.databaseManager.queryRows<DatabasePunishment>('SELECT * FROM "punishments" ORDER BY "id" ASC')

    this.entries.length = 0
    for (const row of rows) {
      this.entries.push({ ...row, createdAt: row.createdAt * 1000, till: row.till * 1000 })
    }
    this.nextId = this.entries.reduce((maxId, entry) => Math.max(maxId, entry.id), 0) + 1
  }

  private async migrateAnyOldData(application: Application, logger: Logger): Promise<void> {
    interface OldEntry {
      userName: string
      userUuid?: string
      till: number
      reason: string
    }

    interface OldType {
      mute: OldEntry[]
      ban: OldEntry[]
    }

    async function findIdentifier(entry: OldEntry): Promise<UserIdentifier | undefined> {
      if (entry.userUuid) {
        return { originInstance: InstanceType.Minecraft, userId: entry.userUuid }
      }

      try {
        const mojangProfile = await application.mojangApi.profileByUsername(entry.userName)
        logger.debug(
          `Found a mojang profile to username "${entry.userName}". Migrating the punishment to mojang uuid ${mojangProfile.id}`
        )
        return { originInstance: InstanceType.Minecraft, userId: mojangProfile.id }
      } catch (error: unknown) {
        logger.error(`Failed migrating a legacy punishment entry: ${JSON.stringify(entry)}`)
        logger.warn('Entry will be entirely skipped. Manually re-add the entry if needed.')
        logger.error(error)
        return undefined
      }
    }

    const path = application.getConfigFilePath('punishments.json')
    if (!fs.existsSync(path)) return
    logger.info('Found old punishments file. Migrating this file into the new system...')

    const oldObject = JSON.parse(fs.readFileSync(path, 'utf8')) as OldType
    const currentTime = Date.now()
    const punishments: SavedPunishment[] = []
    let total = 0

    for (const entry of oldObject.mute) {
      if (entry.till < currentTime) continue
      total++

      const identifier = await findIdentifier(entry)
      if (identifier == undefined) continue
      punishments.push({
        ...identifier,
        type: PunishmentType.Mute,
        purpose: PunishmentPurpose.Manual,
        till: entry.till,
        reason: entry.reason,
        createdAt: currentTime
      })
    }

    for (const entry of oldObject.ban) {
      if (entry.till < currentTime) continue
      total++

      const identifier = await findIdentifier(entry)
      if (identifier == undefined) continue
      punishments.push({
        ...identifier,
        type: PunishmentType.Ban,
        purpose: PunishmentPurpose.Manual,
        till: entry.till,
        reason: entry.reason,
        createdAt: currentTime
      })
    }

    logger.info(`Successfully parsed ${punishments.length} legacy punishments out of ${total}`)
    this.addEntries(punishments)

    logger.debug('Deleting punishments legacy file...')
    fs.rmSync(path)
  }

  public add(punishment: SavedPunishment): void {
    this.addEntries([punishment])
  }

  private addEntries(punishments: SavedPunishment[]): void {
    const records = punishments.map((punishment) => ({ ...punishment, id: this.nextId++ }))
    this.entries.push(...records)

    this.databaseManager.enqueueTransaction('saving punishments', async (database) => {
      for (const punishment of records) {
        await database.query(
          `INSERT INTO "punishments" ("id", "originInstance", "userId", "type", "purpose", "reason", "createdAt", "till")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            punishment.id,
            punishment.originInstance,
            punishment.userId,
            punishment.type,
            punishment.purpose,
            punishment.reason,
            Math.floor(punishment.createdAt / 1000),
            Math.floor(punishment.till / 1000)
          ]
        )
      }
    })
  }

  public remove(user: User): SavedPunishment[] {
    const currentTime = Date.now()
    const foundEntries = this.getPunishments(user.allIdentifiers(), currentTime)
    if (foundEntries.length === 0) return []

    const ids = new Set(foundEntries.map((entry) => entry.id))
    for (let index = this.entries.length - 1; index >= 0; index--) {
      if (ids.has(this.entries[index].id)) {
        this.entries.splice(index, 1)
      }
    }

    this.databaseManager.enqueueWrite('removing punishments', async (database) => {
      await database.query('DELETE FROM "punishments" WHERE "id" = ANY($1::int[])', [[...ids]])
    })

    return this.convertDatabaseFields(foundEntries)
  }

  findByUser(user: User): SavedPunishment[] {
    return this.convertDatabaseFields(this.getPunishments(user.allIdentifiers(), Date.now()))
  }

  all(): SavedPunishment[] {
    return this.convertDatabaseFields(this.getPunishments([], Date.now()))
  }

  private getPunishments(identifiers: UserIdentifier[], currentTime: number): DatabasePunishment[] {
    const currentSeconds = Math.floor(currentTime / 1000)
    const allowedIdentifiers = new Set(identifiers.map(identifierKey))

    return this.entries.filter((entry) => {
      if (entry.till <= currentSeconds * 1000) return false
      if (allowedIdentifiers.size === 0) return true
      return allowedIdentifiers.has(identifierKey(entry))
    })
  }

  private convertDatabaseFields(entries: DatabasePunishment[]): SavedPunishment[] {
    return entries.map(({ id: _id, ...entry }) => ({ ...entry }))
  }
}

function identifierKey(identifier: UserIdentifier): string {
  return `${identifier.originInstance}:${identifier.userId}`
}
