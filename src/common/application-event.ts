// eslint-disable-next-line import/no-restricted-paths -- known architecture violation: common events reference core rankup types, pending refactor
import type { PendingReview, RankupHistoryEntry } from '../core/rankup/pending-review-manager.js'

import type { Status } from './connectable-instance.js'
import type { DiscordUser, MinecraftUser, User } from './user'

export interface ApplicationEvents {
  chat: Readonly<ChatEvent>

  guildPlayer: Readonly<GuildPlayerEvent>

  guildGeneral: Readonly<GuildGeneralEvent>

  minecraftChatEvent: Readonly<MinecraftReactiveEvent>

  command: Readonly<CommandEvent>

  commandFeedback: Readonly<CommandFeedbackEvent>

  broadcast: Readonly<BroadcastEvent>

  instanceStatus: Readonly<InstanceStatus>

  instanceReactive: Readonly<InstanceReactive>

  minecraftSelfBroadcast: Readonly<MinecraftSelfBroadcast>

  minecraftChat: Readonly<MinecraftRawChatEvent>

  bridgeConfigChanged: Readonly<{ bridgeId: string; key: string; value: unknown }>

  pendingReviewAdded: Readonly<{ bridgeId: string; review: PendingReview }>
  pendingReviewRemoved: Readonly<{ bridgeId: string; id: number }>
  pendingHistoryAppended: Readonly<{ bridgeId: string; entry: RankupHistoryEntry }>

  joinInterviewRequest: Readonly<{ instanceName: string; username: string }>

  interviewMessage: Readonly<{ bridgeId: string; instanceName: string; username: string; message: string }>

  interviewDenied: Readonly<{ instanceName: string; username: string }>
}

export enum InstanceType {
  Main = 'main',

  Commands = 'commands',
  Core = 'core',
  Metrics = 'metrics',

  Prometheus = 'prometheus',

  Discord = 'discord',
  Minecraft = 'minecraft',

  Utility = 'utility'
}

export enum ChannelType {
  Officer = 'officer',
  Public = 'public',
  Private = 'private'
}

export enum Color {
  Good = 0x00_8a_00,
  Info = 0x84_84_00,
  Bad = 0x8a_2d_00,
  Error = 0xff_00_00,
  Default = 0x09_0a_16
}

export interface BaseEvent extends InstanceIdentifier {
  readonly eventId: string

  readonly createdAt: number
}

export interface InstanceIdentifier {
  readonly instanceName: string

  readonly instanceType: InstanceType

  readonly bridgeId?: string
}

export type InformEvent = BaseEvent

export interface ReplyEvent extends BaseEvent {
  readonly originEventId: string
}

export interface MinecraftRawMessage {
  readonly rawMessage: string
}

export enum Permission {
  Anyone,
  Helper,
  Officer,
  Owner,
  Admin
}

export type ChatEvent = ChatLike

export type ChatLike =
  | MinecraftGuildChat
  | MinecraftPrivateChat
  | DiscordChat
  | (BaseChat & {
      readonly instanceType: Exclude<InstanceType, InstanceType.Discord | InstanceType.Minecraft>
      readonly rawMessage?: string
    })

export interface BaseChat extends InformEvent {
  readonly channelType: ChannelType

  readonly user: User

  readonly message: string
}

export interface MinecraftChat extends BaseChat, MinecraftRawMessage {
  readonly instanceType: InstanceType.Minecraft
  readonly hypixelRank: string

  readonly user: MinecraftUser
}

export interface MinecraftPrivateChat extends MinecraftChat {
  readonly channelType: ChannelType.Private
}

export interface MinecraftGuildChat extends MinecraftChat {
  readonly channelType: ChannelType.Public | ChannelType.Officer
  readonly guildRank: string
}

export interface DiscordChat extends BaseChat {
  readonly instanceType: InstanceType.Discord

  readonly user: DiscordUser

  readonly replyUsername: string | undefined

  readonly channelId: string
}

export enum GuildPlayerEventType {
  Request = 'request',

  Join = 'join',

  Leave = 'leave',

  Kick = 'kick',

  Promote = 'promote',

  Demote = 'demote',

  Mute = 'mute',

  Unmute = 'unmute',

  Muted = 'muted',

  Unmuted = 'unmuted',

  Offline = 'offline',

  Online = 'online',

  Gifted = 'gifted',

  Joined = 'joined',

  Kicked = 'kicked'
}

export interface BaseInGameEvent<K extends string> extends InformEvent, MinecraftRawMessage {
  readonly type: K

  readonly message: string

  readonly color: Color

  readonly channels: (ChannelType.Public | ChannelType.Officer)[]
}

export interface BaseGuildPlayerEvent extends MinecraftRawMessage {
  readonly user: MinecraftUser
}

export type GuildPlayerEvent = GuildPlayerResponsible | GuildPlayerSolo

export type GuildPlayerResponsibleTypes =
  | GuildPlayerEventType.Muted
  | GuildPlayerEventType.Kick
  | GuildPlayerEventType.Mute
  | GuildPlayerEventType.Unmute
  | GuildPlayerEventType.Gifted

export type GuildPlayerSoloTypes = Exclude<GuildPlayerEventType, GuildPlayerResponsibleTypes>

export type GuildPlayerSolo = BaseGuildPlayerEvent & BaseInGameEvent<GuildPlayerSoloTypes>

export interface GuildPlayerResponsible extends BaseGuildPlayerEvent, BaseInGameEvent<GuildPlayerResponsibleTypes> {
  readonly responsible: MinecraftUser
}

export enum GuildGeneralEventType {
  Quest = 'quest',

  Level = 'level'
}

export type GuildGeneralEvent = BaseInGameEvent<GuildGeneralEventType> & MinecraftRawMessage

export enum MinecraftReactiveEventType {
  Repeat = 'repeat',

  Block = 'block',

  Advertise = 'advertise',

  Muted = 'muted',

  RequireGuild = 'require_guild',

  NoOfficer = 'no_officer',

  GuildMuted = 'guild_muted',

  MessageTruncated = 'truncated'
}

export interface MinecraftReactiveEvent extends ReplyEvent, MinecraftRawMessage {
  readonly type: MinecraftReactiveEventType

  readonly message: string

  readonly color: Color
}

export interface BroadcastGuildChatImageStyle {
  readonly channelType: ChannelType.Public | ChannelType.Officer
  readonly skinUsername: string

  readonly imageBodyFormatted?: string
}

export interface BroadcastEvent extends InformEvent {
  readonly message: string

  readonly color: Color

  readonly user: User | undefined

  readonly channels: (ChannelType.Public | ChannelType.Officer)[]

  readonly guildChatImageStyle?: BroadcastGuildChatImageStyle
}

export interface BaseCommandEvent extends InformEvent, ReplyEvent {
  readonly channelType: ChannelType

  readonly user: User

  readonly commandName: string

  readonly commandResponse: string
}

export interface DiscordCommandEvent extends BaseCommandEvent {
  instanceType: InstanceType.Discord

  user: DiscordUser
}

export interface MinecraftCommandEvent extends BaseCommandEvent {
  instanceType: InstanceType.Minecraft

  user: MinecraftUser
}

export type CommandLike =
  | DiscordCommandEvent
  | MinecraftCommandEvent
  | (BaseCommandEvent & { instanceType: Exclude<InstanceType, InstanceType.Discord | InstanceType.Minecraft> })

export type CommandEvent = CommandLike

export type CommandFeedbackEvent = CommandLike

export interface UserLink {
  uuid: string
  discordId: string
}

interface InstanceStatusWithBroadcast extends InformEvent {
  readonly message: InstanceMessage
  readonly status: undefined
}

interface InstanceStatusWithChange extends InformEvent {
  readonly message: undefined
  readonly status: StatusChange
}

interface InstanceStatusWithBoth extends InformEvent {
  readonly message: InstanceMessage

  readonly status: StatusChange & { to: Exclude<Status, Status.Connected> }
}

export type InstanceStatus = InstanceStatusWithBroadcast | InstanceStatusWithChange | InstanceStatusWithBoth

export interface MinecraftRawChatEvent extends InformEvent, MinecraftRawMessage {
  readonly message: string
}

export interface MinecraftSelfBroadcast extends InformEvent {
  readonly username: string

  readonly uuid: string
}

export enum InstanceMessageType {
  MinecraftAuthenticationCode = 'minecraftAuthenticationCode',
  MinecraftGuildKicked = 'minecraftGuildKicked',
  MinecraftInstanceNotAutoConnect = 'minecraftInstanceNotAutoConnect',
  MinecraftEnded = 'minecraftEnded',
  MinecraftRestarting = 'minecraftRestarting',
  MinecraftKicked = 'minecraftKicked',
  MinecraftInternetProblems = 'minecraftInternetProblems',
  MinecraftXboxDown = 'minecraftXboxDown',
  MinecraftXboxThrottled = 'minecraftXboxThrottled',
  MinecraftNoAccount = 'minecraftNoAccount',
  MinecraftIncompatible = 'minecraftIncompatible',
  MinecraftBanned = 'minecraftBanned',
  MinecraftFailedTooManyTimes = 'minecraftFailedTooManyTimes',
  MinecraftKickedLoggedFromAnotherLocation = 'minecraftKickedLoggedFromAnotherLocation',
  MinecraftAuthExpired = 'minecraftAuthExpired',
  MinecraftAuthInvalid = 'minecraftAuthInvalid'
}

export interface InstanceMessage {
  readonly type: InstanceMessageType

  readonly value: string | undefined
}

export interface StatusChange {
  from: Status
  to: Status
}

export interface InstanceReactive extends ReplyEvent {
  type: InstanceReactiveType
  message: string
}

export enum InstanceReactiveType {
  MessageTruncated = 'messageTruncated'
}

export enum MinecraftSendChatPriority {
  Default = 'default',

  High = 'high',

  Instant = 'instant'
}

export enum InstanceSignalType {
  Shutdown = 'shutdown',
  Restart = 'restart'
}
