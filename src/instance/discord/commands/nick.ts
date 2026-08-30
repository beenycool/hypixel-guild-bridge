/* eslint-disable prefer-const, unicorn/no-null, prettier/prettier, unicorn/explicit-length-check, unicorn/prevent-abbreviations, unicorn/prefer-includes, @typescript-eslint/prefer-includes */

import { SlashCommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'
import { formatRankPrefix, normalizePlayerRank, PLAYER_RANKS } from '../common/rank-format.js'

const NREG = /^[a-zA-Z0-9_]{1,16}$/

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('nick')
      .setDescription('Set a custom name for rendered chat images / Discord messages')
      .addStringOption((o) =>
        o.setName('name').setDescription('Custom Minecraft username. Leave empty to clear.').setRequired(false).setMaxLength(16)
      )
      .addStringOption((o) =>
        o
          .setName('player')
          .setDescription('Minecraft player whose name to override. Leave empty for the bot itself.')
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addStringOption((o) =>
        o.setName('rank').setDescription('Hypixel rank to spoof. Use "none" to clear.').setRequired(false).setAutocomplete(true)
      ),

  permission: Permission.Helper,

  handler: async function (ctx) {
    const ix = ctx.interaction
    if (ctx.bridgeId == undefined) {
      await ix.reply({ content: 'This command must be used in a configured bridge channel.', ephemeral: true })
      return
    }

    let name = ix.options.getString('name')
    let player = ix.options.getString('player')
    let rank = ix.options.getString('rank')
    const cfg = ctx.application.core.bridgeConfigurations

    if (player != null && player.trim().length > 0) {
      const pname = player.trim()
      if (!NREG.test(pname)) {
        await ix.reply({
          content: 'Invalid player name. Must be 1-16 characters: letters, numbers, or underscores.',
          ephemeral: true
        })
        return
      }

      const out: string[] = []

      if (name != null) {
        if (name.trim() == '') {
          const ex = cfg.getPlayerUsernameOverride(ctx.bridgeId, pname)
          if (ex == undefined) out.push('No custom name is set for `' + pname + '`. They use their real Minecraft username.')
          else {
            cfg.setPlayerUsernameOverride(ctx.bridgeId, pname, undefined)
            out.push('Cleared custom name for `' + pname + '`. They now use their real Minecraft username.')
          }
        } else {
          const t = name.trim()
          if (!NREG.test(t)) {
            await ix.reply({ content: 'Invalid name. Must be 1-16 characters.', ephemeral: true })
            return
          }
          cfg.setPlayerUsernameOverride(ctx.bridgeId, pname, t)
          out.push('Set custom name for `' + pname + '` to `' + t + '`. Their messages will show as `' + t + '` in Discord.')
        }
      }

      if (rank != null) {
        const norm = normalizePlayerRank(rank)
        if (rank.trim().length > 0 && norm == undefined) {
          await ix.reply({
            content: 'Invalid rank. Must be one of: ' + PLAYER_RANKS.join(', ') + ', or "none" to clear.',
            ephemeral: true
          })
          return
        }
        if (norm == undefined || norm == 'Default') {
          const ex = cfg.getPlayerRankOverride(ctx.bridgeId, pname)
          if (ex == undefined) out.push('No custom rank is set for `' + pname + '`. They use their real Hypixel rank.')
          else {
            cfg.setPlayerRankOverride(ctx.bridgeId, pname, undefined)
            out.push('Cleared custom rank for `' + pname + '`. They now use their real Hypixel rank.')
          }
        } else {
          cfg.setPlayerRankOverride(ctx.bridgeId, pname, norm)
          const disp = formatRankPrefix(norm) || norm
          out.push('Set custom rank for `' + pname + '` to `' + disp + '`.')
        }
      }

      if (out.length == 0) {
        const cn = cfg.getPlayerUsernameOverride(ctx.bridgeId, pname)
        const cr = cfg.getPlayerRankOverride(ctx.bridgeId, pname)
        const np: string = cn == undefined ? 'real username' : '`' + cn + '`'
        const rp: string = cr == undefined ? 'real rank' : '`' + (formatRankPrefix(cr) || cr) + '`'
        await ix.reply({
          content: 'Current nicks for `' + pname + '`: name = ' + np + ', rank = ' + rp + '. Provide `name` and/or `rank` to change.',
          ephemeral: true
        })
        return
      }
      await ix.reply({ content: out.join('\n'), ephemeral: true })
      return
    }

    const out: string[] = []

    if (name != null) {
      if (name.trim() == '') {
        const cur = cfg.getBotUsernameOverride(ctx.bridgeId)
        if (cur == undefined) out.push('No custom nick is set. The bot uses its real Minecraft username.')
        else {
          cfg.setBotUsernameOverride(ctx.bridgeId, undefined)
          out.push('Cleared custom nick. The bot now uses its real Minecraft username.')
        }
      } else {
        const t = name.trim()
        if (!NREG.test(t)) {
          await ix.reply({ content: 'Invalid name. Must be 1-16 characters.', ephemeral: true })
          return
        }
        const bots = ctx.application.minecraftManager.getMinecraftBots()
        const bb = bots.filter((b) => ctx.application.bridgeResolver.shouldProcessEvent(ctx.bridgeId, b.instanceName))
        const real: string = bb.length > 0 ? bb[0]?.username ?? 'unknown' : 'unknown'
        cfg.setBotUsernameOverride(ctx.bridgeId, t)
        out.push('Set custom nick to `' + t + '`. Rendered chat images will show `' + t + '` instead of `' + real + '`.')
      }
    }

    if (rank != null) {
      const norm = normalizePlayerRank(rank)
      if (rank.trim().length > 0 && norm == undefined) {
        await ix.reply({
          content: 'Invalid rank. Must be one of: ' + PLAYER_RANKS.join(', ') + ', or "none" to clear.',
          ephemeral: true
        })
        return
      }
      if (norm == undefined || norm == 'Default') {
        const ex = cfg.getBotRankOverride(ctx.bridgeId)
        if (ex == undefined) out.push('No custom rank is set. The bot uses its real Hypixel rank.')
        else {
          cfg.setBotRankOverride(ctx.bridgeId, undefined)
          out.push('Cleared custom rank. The bot now uses its real Hypixel rank.')
        }
      } else {
        cfg.setBotRankOverride(ctx.bridgeId, norm)
        const disp = formatRankPrefix(norm) || norm
        out.push('Set custom rank to `' + disp + '`.')
      }
    }

    if (out.length == 0) {
      const cn = cfg.getBotUsernameOverride(ctx.bridgeId)
      const cr = cfg.getBotRankOverride(ctx.bridgeId)
      const np: string = cn == undefined ? 'real username' : '`' + cn + '`'
      const rp: string = cr == undefined ? 'real rank' : '`' + (formatRankPrefix(cr) || cr) + '`'
      await ix.reply({
        content: 'Current bot nicks: name = ' + np + ', rank = ' + rp + '. Provide `name` and/or `rank` to change.',
        ephemeral: true
      })
      return
    }
    await ix.reply({ content: out.join('\n'), ephemeral: true })
  },

  autoComplete: async function (ctx) {
    const opt = ctx.interaction.options.getFocused(true)
    if (opt.name == 'player') {
      const u: string[] = await ctx.application.core.completeUsername(opt.value, 25)
      await ctx.interaction.respond(u.map((c) => ({ name: c, value: c })))
    } else if (opt.name == 'rank') {
      const q = opt.value.toLowerCase()
      const base: string[] = [...PLAYER_RANKS as readonly string[], 'none']
      const m: string[] = q.length == 0 ? base : base.filter((r) => r.toLowerCase().indexOf(q) >= 0)
      await ctx.interaction.respond(m.slice(0, 25).map((c) => ({ name: c, value: c })))
    }
  }
} satisfies DiscordCommandHandler
