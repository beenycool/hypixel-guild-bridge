import type { Registry } from 'prom-client'
import { Counter, Gauge } from 'prom-client'

import type {
  BaseInGameEvent,
  ChatEvent,
  CommandEvent,
  MinecraftReactiveEvent
} from '../../common/application-event.js'

export default class ApplicationMetrics {
  private readonly chatMetrics
  private readonly commandMetrics
  private readonly eventMetrics
  private readonly tournamentsActive
  private readonly tournamentParticipants
  private readonly tournamentMatches
  private readonly tournamentDisputesTotal

  constructor(
    register: Registry,
    prefix: string,
    private readonly resolveBridgeId?: (instanceName: string) => string | undefined
  ) {
    this.chatMetrics = new Counter({
      name: prefix + 'chat',
      help: 'Chat messages sent in guild-bridge.',
      labelNames: ['location', 'scope', 'instance', 'bridge']
    })
    register.registerMetric(this.chatMetrics)

    this.commandMetrics = new Counter({
      name: prefix + 'command',
      help: 'Commands executed in guild-bridge.',
      labelNames: ['location', 'instance', 'command', 'bridge']
    })
    register.registerMetric(this.commandMetrics)

    this.eventMetrics = new Counter({
      name: prefix + 'event',
      help: 'Events happened in guild-bridge.',
      labelNames: ['location', 'instance', 'event', 'bridge']
    })
    register.registerMetric(this.eventMetrics)

    this.tournamentsActive = new Gauge({
      name: prefix + 'tournaments_active',
      help: 'Number of active tournaments'
    })
    register.registerMetric(this.tournamentsActive)

    this.tournamentParticipants = new Gauge({
      name: prefix + 'tournament_participants',
      help: 'Tournament participants by tournament and status',
      labelNames: ['tournament_id', 'status'] as const
    })
    register.registerMetric(this.tournamentParticipants)

    this.tournamentMatches = new Gauge({
      name: prefix + 'tournament_matches',
      help: 'Tournament matches by tournament and status',
      labelNames: ['tournament_id', 'status'] as const
    })
    register.registerMetric(this.tournamentMatches)

    this.tournamentDisputesTotal = new Counter({
      name: prefix + 'tournament_disputes_total',
      help: 'Total number of tournament disputes'
    })
    register.registerMetric(this.tournamentDisputesTotal)
  }

  private bridgeLabel(event: { instanceName: string; bridgeId?: string }): string {
    return event.bridgeId ?? this.resolveBridgeId?.(event.instanceName) ?? 'unknown'
  }

  onChatEvent(event: ChatEvent): void {
    this.chatMetrics.inc({
      location: event.instanceType,
      scope: event.channelType,
      instance: event.instanceName,
      bridge: this.bridgeLabel(event)
    })
  }

  onCommandEvent(event: CommandEvent): void {
    this.commandMetrics.inc({
      location: event.instanceType,
      instance: event.instanceName,
      command: event.commandName,
      bridge: this.bridgeLabel(event)
    })
  }

  onClientEvent(event: BaseInGameEvent<string> | MinecraftReactiveEvent): void {
    this.eventMetrics.inc({
      location: event.instanceType,
      instance: event.instanceName,
      event: event.type,
      bridge: this.bridgeLabel(event)
    })
  }

  onTournamentActiveChange(count: number): void {
    this.tournamentsActive.set(count)
  }

  onTournamentParticipants(tournamentId: number, status: string, count: number): void {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    this.tournamentParticipants.set({ tournament_id: String(tournamentId), status }, count)
  }

  onTournamentMatches(tournamentId: number, status: string, count: number): void {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    this.tournamentMatches.set({ tournament_id: String(tournamentId), status }, count)
  }

  onTournamentDispute(): void {
    this.tournamentDisputesTotal.inc()
  }
}
