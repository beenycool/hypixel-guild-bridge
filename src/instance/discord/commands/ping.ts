import type { APIEmbed } from 'discord.js'
import { SlashCommandBuilder } from 'discord.js'

import { Color } from '../../../common/application-event.js'
import type { DiscordCommandContext, DiscordCommandHandler } from '../../../common/commands.js'
import { Status } from '../../../common/connectable-instance.js'
import { DefaultCommandFooter } from '../common/discord-config.js'

type HypixelPingDisplay =
  | { kind: 'value'; ms: number }
  | { kind: 'no_instances' }
  | { kind: 'not_connected' }
  | { kind: 'no_tab_ping' }

function resolveHypixelTabPing(context: DiscordCommandContext): HypixelPingDisplay {
  const instance = context.application.resolveMinecraftInstanceForDiscordPing(context.bridgeId)
  if (instance === undefined) return { kind: 'no_instances' }
  if (instance.currentStatus() !== Status.Connected) return { kind: 'not_connected' }
  const ms = instance.getTabPingMs()
  if (ms === undefined) return { kind: 'no_tab_ping' }
  return { kind: 'value', ms }
}

function formatHypixelTabPingLine(display: HypixelPingDisplay): string {
  switch (display.kind) {
    case 'value': {
      return `**Hypixel — Minecraft bot tab ping:** ${display.ms}ms`
    }
    case 'no_instances': {
      return '**Hypixel — Minecraft bot tab ping:** no Minecraft bot configured'
    }
    case 'not_connected': {
      return '**Hypixel — Minecraft bot tab ping:** bot not connected'
    }
    case 'no_tab_ping': {
      return '**Hypixel — Minecraft bot tab ping:** unavailable (no tab ping yet)'
    }
    default: {
      const exhaustiveCheck: never = display
      return exhaustiveCheck
    }
  }
}

function createPing(latency: number, websocket: number, lag: number, hypixel: HypixelPingDisplay): APIEmbed {
  return {
    color: Color.Default,
    title: 'Ping',
    description:
      `**Discord — latency:** ${latency}ms\n` +
      `**Discord — websocket heartbeat:** ${websocket}ms\n` +
      `**Discord — server lag:** ${lag}ms\n\n` +
      `${formatHypixelTabPingLine(hypixel)}\n` +
      "_Hypixel line is the connected Minecraft bot's in-game/tab-list latency._",
    footer: {
      text: DefaultCommandFooter
    }
  }
}

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder().setName('ping').setDescription('Discord and Hypixel Minecraft bot tab ping'),

  handler: async function (context) {
    const timestamp = Date.now()

    await context.interaction.deferReply()
    const defer = await context.interaction.fetchReply()
    const hypixel = resolveHypixelTabPing(context)

    const latency = defer.createdTimestamp - context.interaction.createdTimestamp
    const websocket = context.interaction.client.ws.ping
    const lag = timestamp - context.interaction.createdTimestamp

    await context.interaction.editReply({ embeds: [createPing(latency, websocket, lag, hypixel)] })
  }
} satisfies DiscordCommandHandler
