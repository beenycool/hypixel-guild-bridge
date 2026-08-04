/* eslint-disable import/no-restricted-paths */
import assert from 'node:assert'

import type { Guild } from 'discord.js'

import type Application from '../application'
import type { CommandsHeat, HeatResult, HeatType } from '../core/moderation/commands-heat'
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

  /**
   * Returns the best available display name for this user
   * @returns the display name, preferring Mojang, then Discord, then the raw identifier
   */
  public displayName(): string {
    const mojangProfile = this.mojangProfile()
    if (mojangProfile !== undefined) return mojangProfile.name

    const discordProfile = this.discordProfile()
    if (discordProfile !== undefined) return discordProfile.displayName

    return this.getUserIdentifier().userId.slice(0, 16)
  }

  /**
   * Returns the user's avatar URL, preferring Mojang over Discord
   * @returns the avatar URL, or undefined if the user has no known avatar
   */
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

  /**
   * Returns a link to the user's SkyBlock stats page
   * @returns the SkyBlock stats URL, or undefined if no Mojang profile is available
   */
  public profileLink(): string | undefined {
    const mojangProfile = this.mojangProfile()
    if (mojangProfile !== undefined) {
      return `https://sky.shiiyu.moe/stats/${mojangProfile.id}`
    }

    return undefined
  }

  /**
   * Returns the user's Mojang profile if available
   * @returns the Mojang profile, or undefined if the user has none
   */
  public mojangProfile(): MojangProfile | undefined {
    return this.userMojang
  }

  /**
   * Returns the user's Discord profile if available
   * @returns the Discord profile, or undefined if the user has none
   */
  public discordProfile(): DiscordProfile | undefined {
    return this.userDiscord
  }

  /**
   * Resolves the user's permission level, checking Discord roles and admin username
   * @param bridgeId the bridge whose Discord roles should be checked
   * @returns the highest permission level the user holds
   */
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
    if (mojangProfile !== undefined) {
      const configurations = this.application.core.minecraftConfigurations
      if (mojangProfile.name.toLowerCase() === configurations.getAdminUsername().toLowerCase()) {
        return Permission.Admin
      }
    }

    return permission
  }

  /**
   * Whether the user has linked their Minecraft and Discord accounts
   * @returns true if both accounts are linked
   */
  public verified(): boolean {
    return this.userLink !== undefined
  }

  /**
   * Whether the user is immune to moderation actions
   * @returns true if the user is admin-level or listed as immune
   */
  public async immune(): Promise<boolean> {
    if ((await this.permission()) >= Permission.Admin) return true

    const discordProfile = this.discordProfile()
    if (discordProfile !== undefined && this.context.moderation.getImmuneDiscordUsers().includes(discordProfile.id))
      return true

    const mojangProfile = this.mojangProfile()
    if (mojangProfile !== undefined && this.context.moderation.getImmuneMojangPlayers().includes(mojangProfile.name))
      return true

    return false
  }

  /**
   * Checks if this user equals another by any shared identifier
   * @param other the user to compare against
   * @returns true when both users share a Discord id, a Mojang id, or the same origin identifier
   */
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

    // Possibly to check displayName() as well but that is too unreliable
    return false
  }

  /**
   * Checks if this user matches a specific identifier
   * @param identifier the identifier to look for
   * @returns true if any of this user's identifiers match
   */
  public equalsIdentifier(identifier: UserIdentifier): boolean {
    return this.allIdentifiers().some(
      (entry) => entry.originInstance === identifier.originInstance && entry.userId === identifier.userId
    )
  }

  /**
   * Returns the primary user identifier
   * @returns the user's primary identifier
   */
  public getUserIdentifier(): UserIdentifier {
    return this.userIdentifier
  }

  /**
   * Returns all known identifiers (Mojang, Discord, linked) for this user
   * @returns every identifier known for this user
   */
  public allIdentifiers(): UserIdentifier[] {
    const result: UserIdentifier[] = []

    /**
     * Add an identifier if not already exists in `result`
     * @param identifier the identifier to add
     */
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

  /**
   * Returns the user's punishment history
   * @returns a view over the user's saved punishments
   */
  public punishments(): PunishmentInstant {
    const punishments = this.context.punishments.findByUser(this)
    return new PunishmentInstant(this, punishments)
  }

  /**
   * Removes all punishments for this user
   * @param executor the event that triggered the forgiveness
   * @returns the punishments that were removed
   */
  public async forgive(executor: InformEvent): Promise<SavedPunishment[]> {
    const savedPunishments = this.context.punishments.remove(this)

    await this.application.emit('punishmentForgive', { ...executor, user: this })

    return savedPunishments
  }

  /**
   * Bans the user for a specified duration and reason
   * @param executor the event that triggered the ban
   * @param purpose why the ban was issued
   * @param duration how long the ban lasts
   * @param reason human readable reason for the ban
   * @returns the saved punishment
   */
  public async ban(
    executor: InformEvent,
    purpose: PunishmentPurpose,
    duration: Duration,
    reason: string
  ): Promise<SavedPunishment> {
    return await this.punish(executor, PunishmentType.Ban, purpose, duration, reason)
  }

  /**
   * Mutes the user for a specified duration and reason
   * @param executor the event that triggered the mute
   * @param purpose why the mute was issued
   * @param duration how long the mute lasts
   * @param reason human readable reason for the mute
   * @returns the saved punishment
   */
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

  /**
   * Records a moderation heat action (with auto-escalation)
   * @param type the heat action to record
   * @returns the resulting heat state
   */
  public async addModerationAction(type: HeatType): Promise<HeatResult> {
    return this.context.commandsHeat.add(this, type)
  }

  /**
   * Attempts to record a moderation heat action (no auto-escalation)
   * @param type the heat action to record
   * @returns the resulting heat state
   */
  public async tryAddModerationAction(type: HeatType): Promise<HeatResult> {
    return this.context.commandsHeat.tryAdd(this, type)
  }

  /**
   * Checks if this user originated from Minecraft
   * @returns true, narrowing the type to MinecraftUser, when the user came from Minecraft
   */
  public isMojangUser(): this is MinecraftUser {
    if (this.userIdentifier.originInstance === InstanceType.Minecraft) {
      assert.ok(this.userMojang !== undefined)
      return true
    }

    return false
  }

  /**
   * Checks if this user originated from Discord
   * @returns true, narrowing the type to DiscordUser, when the user came from Discord
   */
  public isDiscordUser(): this is DiscordUser {
    if (this.userIdentifier.originInstance === InstanceType.Discord) {
      assert.ok(this.userDiscord !== undefined)
      return true
    }

    return false
  }

  /**
   * Serializes the user to a plain object
   * @returns a plain object representation of the user's identifier
   */
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

  /**
   * Returns all punishments for this user
   * @returns every saved punishment of this user
   */
  public all(): SavedPunishment[] {
    return this.punishments
  }

  /**
   * Finds the longest punishment of a given type
   * @param type the punishment type to look for
   * @returns the longest matching punishment, or undefined if none exists
   */
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

  /**
   * Returns the expiration timestamp of the longest punishment of a given type
   * @param type the punishment type to look for
   * @returns the expiration timestamp, or undefined if no matching punishment exists
   */
  public punishedTill(type: PunishmentType): number | undefined {
    return this.longestPunishment(type)?.till
  }
}

export interface UserIdentifier {
  /**
   * The target of the punishment.
   * Where the {@link #userId} resides and how the {@link #userId} should be interpreted.
   */
  readonly originInstance: InstanceType
  /**
   * User unique Identifier within the {@link #originInstance}.
   * It can be Mojang UUID, or Discord user ID, etc.
   */
  readonly userId: string
}

export interface ManagerContext {
  commandsHeat: CommandsHeat
  punishments: Punishments
  moderation: ModerationConfigurations
}
