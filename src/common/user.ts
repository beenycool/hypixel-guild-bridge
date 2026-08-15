/* eslint-disable import/no-restricted-paths */
import assert from 'node:assert'

import type { Guild } from 'discord.js'

import type Application from '../application'
import type { ModerationConfigurations } from '../core/moderation/moderation-configurations'
import type Punishments from '../core/moderation/punishments'
import type { SavedPunishment } from '../core/moderation/punishments'
import type Duration from '../utility/duration'

import type { BasePunishment, InformEvent, PunishmentPurpose, UserLink } from './application-event'
import { InstanceType, Permission, PunishmentType } from './application-event'
import { Status } from './connectable-instance'

export interface InitializeOptions {
  guild?: Guild
}

export class User {
  public constructor(
    protected readonly application: Application,
    protected readonly context: ManagerContext,
    private readonly userIdentifier: UserIdentifier,
    private readonly userMojang: MojangProfile | undefined,
    private readonly userDiscord: DiscordProfile | undefined,
    private readonly userLink: UserLink | undefined
  ) {
    if (userLink !== undefined && userMojang !== undefined && userDiscord !== undefined) {
      assert.strictEqual(userMojang.id, userLink.uuid)
      assert.strictEqual(userDiscord.id, userLink.discordId)
    }
  }

  public displayName(): string {
    const mojangProfile = this.mojangProfile()
    if (mojangProfile !== undefined) return mojangProfile.name

    const discordProfile = this.discordProfile()
    if (discordProfile !== undefined) return discordProfile.displayName

    return this.getUserIdentifier().userId.slice(0, 16)
  }

  public avatar(): string | undefined {
    const mojangProfile = this.mojangProfile()
    if (mojangProfile !== undefined) {
      return `https://mc-heads.net/avatar/${mojangProfile.id}`
    }

    const discordProfile = this.discordProfile()
    if (discordProfile?.avatar !== undefined) {
      return discordProfile.avatar
    }

    return undefined
  }

  public profileLink(): string | undefined {
    const mojangProfile = this.mojangProfile()
    if (mojangProfile !== undefined) {
      return `https://sky.shiiyu.moe/stats/${mojangProfile.id}`
    }

    return undefined
  }

  public mojangProfile(): MojangProfile | undefined {
    return this.userMojang
  }

  public discordProfile(): DiscordProfile | undefined {
    return this.userDiscord
  }

  public async permission(bridgeId?: string): Promise<Permission> {
    let permission = Permission.Anyone

    const discordProfile = this.discordProfile()
    if (discordProfile !== undefined) {
      const discordInstance = this.application.discordInstance
      if (discordInstance.currentStatus() === Status.Connected) {
        const discordPermission = await discordInstance.resolvePermission(discordProfile.id, bridgeId)
        if (discordPermission > permission) permission = discordPermission
      }
    }

    const mojangProfile = this.mojangProfile()
    if (mojangProfile !== undefined && mojangProfile.name.toLowerCase() === 'steve') {
      return Permission.Admin
    }

    return permission
  }

  public verified(): boolean {
    return this.userLink !== undefined
  }

  public equalsUser(other: User): boolean {
    const discordProfile = this.discordProfile()
    if (discordProfile !== undefined && other.discordProfile()?.id === discordProfile.id) {
      return true
    }

    const mojangProfile = this.mojangProfile()
    if (mojangProfile !== undefined && other.mojangProfile()?.id === mojangProfile.id) {
      return true
    }

    const otherIdentifier = other.getUserIdentifier()
    if (
      this.userIdentifier.originInstance === otherIdentifier.originInstance &&
      this.userIdentifier.userId !== otherIdentifier.userId
    )
      return true

    return false
  }

  public equalsIdentifier(identifier: UserIdentifier): boolean {
    return this.allIdentifiers().some(
      (entry) => entry.originInstance === identifier.originInstance && entry.userId === identifier.userId
    )
  }

  public getUserIdentifier(): UserIdentifier {
    return this.userIdentifier
  }

  public allIdentifiers(): UserIdentifier[] {
    const result: UserIdentifier[] = []

    function add(identifier: UserIdentifier) {
      for (const entry of result) {
        if (identifier.originInstance === entry.originInstance && identifier.userId === entry.userId) {
          return
        }
      }

      result.push(identifier)
    }

    add(this.userIdentifier)
    const mojangProfile = this.mojangProfile()
    if (mojangProfile !== undefined) add({ originInstance: InstanceType.Minecraft, userId: mojangProfile.id })

    const discordProfile = this.discordProfile()
    if (discordProfile !== undefined) add({ originInstance: InstanceType.Discord, userId: discordProfile.id })

    if (this.userLink !== undefined) {
      add({ originInstance: InstanceType.Minecraft, userId: this.userLink.uuid })
      add({ originInstance: InstanceType.Discord, userId: this.userLink.discordId })
    }

    return result
  }

  public punishments(): PunishmentInstant {
    const punishments = this.context.punishments.findByUser(this)
    return new PunishmentInstant(this, punishments)
  }

  public async forgive(executor: InformEvent): Promise<SavedPunishment[]> {
    const savedPunishments = this.context.punishments.remove(this)

    await this.application.emit('punishmentForgive', { ...executor, user: this })

    return savedPunishments
  }

  public async ban(
    executor: InformEvent,
    purpose: PunishmentPurpose,
    duration: Duration,
    reason: string
  ): Promise<SavedPunishment> {
    return await this.punish(executor, PunishmentType.Ban, purpose, duration, reason)
  }

  public async mute(
    executor: InformEvent,
    purpose: PunishmentPurpose,
    duration: Duration,
    reason: string
  ): Promise<SavedPunishment> {
    return await this.punish(executor, PunishmentType.Mute, purpose, duration, reason)
  }

  private async punish(
    executor: InformEvent,
    type: PunishmentType,
    purpose: PunishmentPurpose,
    duration: Duration,
    reason: string
  ): Promise<SavedPunishment> {
    const currentTime = Date.now()

    const punishment: BasePunishment = {
      type: type,
      purpose: purpose,
      createdAt: currentTime,
      till: currentTime + duration.toMilliseconds(),
      reason: reason
    }

    const savedPunishment = { ...punishment, ...this.getUserIdentifier() }

    this.context.punishments.add(savedPunishment)
    await this.application.emit('punishmentAdd', { ...executor, user: this, ...punishment })

    return savedPunishment
  }

  public isMojangUser(): this is MinecraftUser {
    if (this.userIdentifier.originInstance === InstanceType.Minecraft) {
      assert.ok(this.userMojang !== undefined)
      return true
    }

    return false
  }

  public isDiscordUser(): this is DiscordUser {
    if (this.userIdentifier.originInstance === InstanceType.Discord) {
      assert.ok(this.userDiscord !== undefined)
      return true
    }

    return false
  }

  public toJSON(): object {
    return { ...this.userIdentifier }
  }
}

export interface MinecraftUser extends User {
  mojangProfile(): MojangProfile

  avatar(): string

  profileLink(): string
}

export interface DiscordUser extends User {
  discordProfile(): DiscordProfile

  avatar(): string

  profileLink(): string
}

export interface DiscordProfile {
  id: string
  username: string
  displayName: string
  avatar: string | undefined
}

export interface MojangProfile {
  id: string
  name: string
}

export class PunishmentInstant {
  constructor(
    private readonly user: User,
    private readonly punishments: SavedPunishment[]
  ) {}

  public all(): SavedPunishment[] {
    return this.punishments
  }

  public longestPunishment(type: PunishmentType): SavedPunishment | undefined {
    const punishments = this.all()

    let longestPunishment: SavedPunishment | undefined = undefined
    for (const punishment of punishments) {
      if (punishment.type !== type) continue

      if (longestPunishment === undefined || punishment.till > longestPunishment.till) {
        longestPunishment = punishment
      }
    }

    return longestPunishment
  }

  public punishedTill(type: PunishmentType): number | undefined {
    return this.longestPunishment(type)?.till
  }
}

export interface UserIdentifier {
  readonly originInstance: InstanceType

  readonly userId: string
}

export interface ManagerContext {
  punishments: Punishments
  moderation: ModerationConfigurations
}
