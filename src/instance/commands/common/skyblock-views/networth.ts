import assert from 'node:assert'

import { ProfileNetworthCalculator } from 'skyhelper-networth'

import type { ChatCommandContext } from '../../../../common/commands.js'
import { formatNumber } from '../../../../common/helper-functions.js'

import { type SelectedSkyblockProfile, type SkyblockView } from './types.js'

interface NetworthTypes {
  museum?: { total?: number }
}

export const networthView: SkyblockView = {
  name: 'networth',
  description: 'Networth of specified user.',
  example: 'sb %s networth',
  needsProfile: true,
  async render(
    context: ChatCommandContext,
    username: string,
    uuid: string,
    selected: SelectedSkyblockProfile | undefined
  ): Promise<string> {
    assert.ok(selected)

    const museum = await context.app.hypixelApi
      .getSkyblockMuseum(uuid, selected.profile.profile_id, { raw: true })
      .catch(() => undefined)
    const museumMember = museum?.members[uuid]

    const bankingBalance = selected.profile.banking?.balance ?? 0
    const networthManager = new ProfileNetworthCalculator(
      selected.member as unknown as Record<string, unknown>,
      museumMember as Record<string, unknown> | undefined,
      bankingBalance
    )

    const [networthData, nonCosmeticNetworthData] = await Promise.all([
      networthManager.getNetworth({ onlyNetworth: true }),
      networthManager.getNonCosmeticNetworth({ onlyNetworth: true })
    ])

    if (networthData.noInventory) {
      return `${username} has an Inventory API off!`
    }

    const networth = formatNumber(networthData.networth)
    const unsoulboundNetworth = formatNumber(networthData.unsoulboundNetworth)
    const nonCosmeticNetworth = formatNumber(nonCosmeticNetworthData.networth)
    const nonCosmeticUnsoulboundNetworth = formatNumber(nonCosmeticNetworthData.unsoulboundNetworth)

    const purse = formatNumber(networthData.purse)
    const bank = selected.profile.banking?.balance ? formatNumber(selected.profile.banking.balance) : 'N/A'
    const personalBank = selected.member.profile.bank_account
      ? formatNumber(selected.member.profile.bank_account)
      : 'N/A'
    const museumTotal = museumMember
      ? formatNumber((networthData as { types?: NetworthTypes }).types?.museum?.total ?? 0)
      : 'N/A'

    return (
      `${username}'s Networth is ${networth} | ` +
      `Non-Cosmetic Networth: ${nonCosmeticNetworth} | ` +
      `Unsoulbound Networth: ${unsoulboundNetworth} | ` +
      `Non-Cosmetic Unsoulbound Networth: ${nonCosmeticUnsoulboundNetworth} | ` +
      `Purse: ${purse} | ` +
      `Bank: ${bank} + ${personalBank} | ` +
      `Museum: ${museumTotal}`
    )
  }
}
