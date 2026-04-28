import type { APIEmbed } from 'discord.js'
import { SlashCommandBuilder } from 'discord.js'
import minecraftProtocol from 'minecraft-protocol'

import { Color } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'
import { DefaultCommandFooter } from '../common/discord-config.js'

const { ping: minecraftServerPing } = minecraftProtocol

/** Same join target as MinecraftInstance primary host. */
const HypixelStatusHost = 'me.hypixel.net'
const HypixelStatusPort = 25_565
const HypixelProtocolVersion = '1.8.9'

async function measureHypixelStatusPingMs(): Promise<number | undefined> {
  try {
    const result = await minecraftServerPing({
      host: HypixelStatusHost,
      port: HypixelStatusPort,
      version: HypixelProtocolVersion,
      closeTimeout: 12_000,
      noPongTimeout: 5_000
    })
    const ms = (result as { latency?: number }).latency
    return typeof ms === 'number' && Number.isFinite(ms) ? Math.round(ms) : undefined
  } catch {
    return undefined
  }
}

function createPing(
  latency: number,
  websocket: number,
  lag: number,
  hypixelStatusPingMs: number | undefined
): APIEmbed {
  const hypixelLine =
    hypixelStatusPingMs === undefined
      ? `**Hypixel (server list, ${HypixelStatusHost}):** unavailable`
      : `**Hypixel (server list, ${HypixelStatusHost}):** ${hypixelStatusPingMs}ms`

  return {
    color: Color.Default,
    title: 'Ping',
    description:
      `**Discord — latency:** ${latency}ms\n` +
      `**Discord — websocket heartbeat:** ${websocket}ms\n` +
      `**Discord — server lag:** ${lag}ms\n\n` +
      `${hypixelLine}\n` +
      '_Hypixel line is status-protocol RTT from this bridge to the join host (not the same as in-game tab ping)._',
    footer: {
      text: DefaultCommandFooter
    }
  }
}

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder().setName('ping').setDescription('Discord and Hypixel status ping'),

  handler: async function (context) {
    const timestamp = Date.now()

    await context.interaction.deferReply()
    const [defer, hypixelStatusPingMs] = await Promise.all([
      context.interaction.fetchReply(),
      measureHypixelStatusPingMs()
    ])

    const latency = defer.createdTimestamp - context.interaction.createdTimestamp
    const websocket = context.interaction.client.ws.ping
    const lag = timestamp - context.interaction.createdTimestamp

    await context.interaction.editReply({ embeds: [createPing(latency, websocket, lag, hypixelStatusPingMs)] })
  }
} satisfies DiscordCommandHandler
