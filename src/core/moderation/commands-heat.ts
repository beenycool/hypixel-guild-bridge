import type { Logger } from 'log4js'

import type { SqliteManager } from '../../common/sqlite-manager'
import type { User, UserIdentifier } from '../../common/user'
import Duration from '../../utility/duration'

import type { ModerationConfigurations } from './moderation-configurations'

export class CommandsHeat {
  private static readonly ActionExpiresAfter = Duration.days(1)
  private static readonly WarnPercentage = 0.8
  private static readonly WarnEvery = Duration.minutes(30)

  private readonly moderationConfig
  private readonly actions: HeatActionRecord[] = []
  private readonly warnings = new Map<string, number>()

  constructor(
    private readonly sqliteManager: SqliteManager,
    config: ModerationConfigurations,
    logger: Logger
  ) {
    this.moderationConfig = config

    sqliteManager.registerCleaner(() => {
      const oldestTimestamp = Math.floor((Date.now() - CommandsHeat.ActionExpiresAfter.toMilliseconds()) / 1000)
      let deleted = 0

      for (let index = this.actions.length - 1; index >= 0; index--) {
        if (this.actions[index].createdAt < oldestTimestamp) {
          this.actions.splice(index, 1)
          deleted++
        }
      }

      if (deleted > 0) {
        logger.debug(`Deleted ${deleted} entry of expired heats-commands`)
        this.sqliteManager.enqueueWrite('cleaning expired command heats', async (database) => {
          await database.query('DELETE FROM "heatsCommands" WHERE "createdAt" < $1', [oldestTimestamp])
        })
      }
    })
  }

  public async load(): Promise<void> {
    const actions = await this.sqliteManager.queryRows<HeatActionRow>(
      'SELECT "originInstance", "userId", "type", "createdAt" FROM "heatsCommands" ORDER BY "id" ASC'
    )
    const warnings = await this.sqliteManager.queryRows<HeatWarningRow>('SELECT * FROM "heatsCommandsWarnings"')

    this.actions.length = 0
    this.actions.push(...actions.map((action) => ({ ...action, identifier: toIdentifier(action) })))

    this.warnings.clear()
    for (const warning of warnings) {
      this.warnings.set(warningKey(toIdentifier(warning), warning.type), warning.warnedAt)
    }
  }

  public add(user: User, type: HeatType): HeatResult {
    const currentTime = Date.now()
    const userIdentifier = user.getUserIdentifier()
    const allIdentifiers = user.allIdentifiers()
    const action: HeatAction = { identifier: userIdentifier, timestamp: currentTime, type }

    if (user.immune()) {
      this.addEntries([action])
      return HeatResult.Allowed
    }

    const heatActions = this.getUserHeats(currentTime, allIdentifiers, type)
    const typeInfo = this.resolveType(type)
    this.addEntries([action])

    if (heatActions >= typeInfo.maxLimit) return HeatResult.Denied

    if (heatActions + 1 >= typeInfo.warnLimit && !this.warned(currentTime, allIdentifiers, type)) {
      this.setLastWarning(currentTime, userIdentifier, type)
      return HeatResult.Warn
    }

    return HeatResult.Allowed
  }

  public tryAdd(user: User, type: HeatType): HeatResult {
    const currentTime = Date.now()
    const userIdentifier = user.getUserIdentifier()
    const allIdentifiers = user.allIdentifiers()
    const action: HeatAction = { identifier: userIdentifier, timestamp: currentTime, type }

    if (user.immune()) {
      this.addEntries([action])
      return HeatResult.Allowed
    }

    const heatActions = this.getUserHeats(currentTime, allIdentifiers, type)
    const typeInfo = this.resolveType(type)
    if (heatActions >= typeInfo.maxLimit) return HeatResult.Denied

    this.addEntries([action])

    if (heatActions + 1 >= typeInfo.warnLimit && !this.warned(currentTime, allIdentifiers, type)) {
      this.setLastWarning(currentTime, userIdentifier, type)
      return HeatResult.Warn
    }

    return HeatResult.Allowed
  }

  private addEntries(heatActions: HeatAction[]): void {
    const createdAt = heatActions.map((heatAction) => ({
      originInstance: heatAction.identifier.originInstance,
      userId: heatAction.identifier.userId,
      type: heatAction.type,
      createdAt: Math.floor(heatAction.timestamp / 1000)
    }))

    this.actions.push(...createdAt.map((entry) => ({ ...entry, identifier: toIdentifier(entry) })))
    this.sqliteManager.enqueueTransaction('saving command heats', async (database) => {
      for (const heatAction of createdAt) {
        await database.query(
          'INSERT INTO "heatsCommands" ("originInstance", "userId", "type", "createdAt") VALUES ($1, $2, $3, $4)',
          [heatAction.originInstance, heatAction.userId, heatAction.type, heatAction.createdAt]
        )
      }
    })
  }

  private getUserHeats(currentTime: number, identifiers: UserIdentifier[], type: HeatType): number {
    const oldestAllowed = Math.floor((currentTime - CommandsHeat.ActionExpiresAfter.toMilliseconds()) / 1000)
    const allowedIdentifiers = new Set(identifiers.map(identifierKey))

    let count = 0
    for (const action of this.actions) {
      if (action.type !== type || action.createdAt <= oldestAllowed) continue
      if (allowedIdentifiers.has(identifierKey(action.identifier))) count++
    }

    return count
  }

  private warned(currentTime: number, identifiers: UserIdentifier[], type: HeatType): boolean {
    let lastWarning = 0
    for (const identifier of identifiers) {
      lastWarning = Math.max(lastWarning, this.warnings.get(warningKey(identifier, type)) ?? 0)
    }

    return lastWarning * 1000 + CommandsHeat.WarnEvery.toMilliseconds() > currentTime
  }

  private setLastWarning(timestamp: number, identifier: UserIdentifier, type: HeatType): void {
    const warnedAt = Math.floor(timestamp / 1000)
    this.warnings.set(warningKey(identifier, type), warnedAt)

    this.sqliteManager.enqueueWrite(`saving command heat warning ${identifier.userId}`, async (database) => {
      await database.query(
        `INSERT INTO "heatsCommandsWarnings" ("originInstance", "userId", "type", "warnedAt") VALUES ($1, $2, $3, $4)
         ON CONFLICT ("originInstance", "userId", "type") DO UPDATE SET
           "warnedAt" = EXCLUDED."warnedAt"`,
        [identifier.originInstance, identifier.userId, type, warnedAt]
      )
    })
  }

  private resolveType(type: HeatType): { expire: Duration; maxLimit: number; warnLimit: number; warnEvery: Duration } {
    const common = { expire: CommandsHeat.ActionExpiresAfter, warnEvery: CommandsHeat.WarnEvery }
    switch (type) {
      case HeatType.Mute: {
        return { ...common, ...CommandsHeat.resolveLimits(this.moderationConfig.getMutesPerDay()) }
      }
      case HeatType.Kick: {
        return { ...common, ...CommandsHeat.resolveLimits(this.moderationConfig.getKicksPerDay()) }
      }
    }

    throw new Error(`Type ${type satisfies never} does not exists??`)
  }

  private static resolveLimits(maxLimit: number): { maxLimit: number; warnLimit: number } {
    const limits = { maxLimit, warnLimit: maxLimit }
    if (maxLimit <= 0) {
      limits.maxLimit = limits.warnLimit = Number.MAX_SAFE_INTEGER
      return limits
    }
    if (maxLimit === 1) {
      return limits
    }

    limits.warnLimit = maxLimit * this.WarnPercentage
    return limits
  }
}

interface HeatAction {
  identifier: UserIdentifier
  type: HeatType
  timestamp: number
}

interface HeatActionRecord {
  identifier: UserIdentifier
  originInstance: UserIdentifier['originInstance']
  userId: string
  type: HeatType
  createdAt: number
}

interface HeatActionRow {
  originInstance: UserIdentifier['originInstance']
  userId: string
  type: HeatType
  createdAt: number
}

interface HeatWarningRow {
  originInstance: UserIdentifier['originInstance']
  userId: string
  type: HeatType
  warnedAt: number
}

export enum HeatType {
  Kick = 'kick',
  Mute = 'mute'
}

export enum HeatResult {
  Allowed = 'allowed',
  Warn = 'warn',
  Denied = 'denied'
}

function identifierKey(identifier: UserIdentifier): string {
  return `${identifier.originInstance}:${identifier.userId}`
}

function warningKey(identifier: UserIdentifier, type: HeatType): string {
  return `${identifierKey(identifier)}:${type}`
}

function toIdentifier(entry: { originInstance: UserIdentifier['originInstance']; userId: string }): UserIdentifier {
  return { originInstance: entry.originInstance, userId: entry.userId }
}
