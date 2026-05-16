import DefaultAxios from 'axios'

import type Application from '../src/application.js'
import type { ChatCommandContext } from '../src/common/commands.js'
import { ChatCommandHandler } from '../src/common/commands.js'
import PluginInstance from '../src/common/plugin-instance.js'
import type { PluginsManager } from '../src/instance/features/plugins-manager.js'

export default class NumberDenicker extends PluginInstance {
  constructor(application: Application, pluginsManager: PluginsManager) {
    super(application, pluginsManager, 'number-denicker')
  }

  onReady(): void {
    this.addChatCommand(new DenickCommand())
  }

  pluginInfo() {
    return { description: 'Denick players by their finals and beds numbers from Bedwars games.' }
  }
}

interface AuroraApiResponse {
  success: boolean
  data?: AuroraPlayer[]
}

interface AuroraPlayer {
  name: string
  distance: number
}

class DenickCommand extends ChatCommandHandler {
  private static readonly BaseUrl = 'https://bordic.xyz/api/v2/resources/lookup/'
  private static readonly DefaultRange = 200
  private static readonly DefaultMax = 5

  constructor() {
    super({
      triggers: ['denick'],
      description: 'Look up players by their finals/beds numbers in Bedwars',
      example: 'denick finals 1500'
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const { app } = context

    // Application exposes auroraApiKey getter (optional)
    const apiKey = (app as unknown as { auroraApiKey?: string }).auroraApiKey
    if (apiKey === undefined) {
      return 'Aurora API key not set. Please add auroraApiKey to config.yaml or set AURORA_API_KEY env var'
    }

    const commandArguments = context.args
    const parsedArguments = this.parseArguments(commandArguments)
    if (parsedArguments === undefined) {
      return this.getUsage()
    }

    try {
      const result =
        parsedArguments.bedsNumber === undefined
          ? await this.performSingleLookup(
              apiKey,
              parsedArguments.type,
              parsedArguments.number,
              parsedArguments.range,
              parsedArguments.max
            )
          : await this.performDualLookup(
              apiKey,
              parsedArguments.number,
              parsedArguments.range,
              parsedArguments.max,
              parsedArguments.bedsNumber,
              parsedArguments.bedsRange ?? DenickCommand.DefaultRange,
              parsedArguments.bedsMax ?? DenickCommand.DefaultMax
            )

      return result
    } catch (error) {
      context.logger.error(error)
      return 'Error fetching data from Aurora API. Please try again later.'
    }
  }

  private async performSingleLookup(
    apiKey: string,
    type: 'finals' | 'beds',
    number: number,
    range: number,
    max: number
  ): Promise<string> {
    const response = await this.queryAuroraApi(apiKey, type, number, range, max)

    if (!response.success || response.data === undefined || response.data.length === 0) {
      return `No players found with ${type}#${number}`
    }

    const playerNames = response.data.filter((player) => player.distance <= 0).map((player) => player.name)

    if (playerNames.length === 0) {
      return `No exact matches found for ${type}#${number}`
    }

    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1)
    return `${typeLabel} #${number}: ${playerNames.join(', ')}`
  }

  private async performDualLookup(
    apiKey: string,
    finalsNumber: number,
    finalsRange: number,
    finalsMax: number,
    bedsNumber: number,
    bedsRange: number,
    bedsMax: number
  ): Promise<string> {
    const [finalsResponse, bedsResponse] = await Promise.all([
      this.queryAuroraApi(apiKey, 'finals', finalsNumber, finalsRange, finalsMax),
      this.queryAuroraApi(apiKey, 'beds', bedsNumber, bedsRange, bedsMax)
    ])

    if (!finalsResponse.success || finalsResponse.data === undefined || finalsResponse.data.length === 0) {
      return `No players found with finals#${finalsNumber}`
    }

    if (!bedsResponse.success || bedsResponse.data === undefined || bedsResponse.data.length === 0) {
      return `No players found with beds#${bedsNumber}`
    }

    const finalsPlayers = new Set(
      finalsResponse.data.filter((player) => player.distance <= 0).map((player) => player.name)
    )
    const bedsPlayers = new Set(bedsResponse.data.filter((player) => player.distance <= 0).map((player) => player.name))

    const intersection = [...finalsPlayers].filter((name) => bedsPlayers.has(name))

    if (intersection.length === 0) {
      return `No matching players found with finals#${finalsNumber} AND beds#${bedsNumber}`
    }

    return `Finals #${finalsNumber} + Beds #${bedsNumber}: ${intersection.join(', ')}`
  }

  private async queryAuroraApi(
    apiKey: string,
    type: 'finals' | 'beds',
    value: number,
    range: number,
    max: number
  ): Promise<AuroraApiResponse> {
    const url = `${DenickCommand.BaseUrl}${type}?key=${encodeURIComponent(apiKey)}&value=${value}&range=${range}&max=${max}`

    const response = await DefaultAxios.get<AuroraApiResponse>(url, {
      headers: { ['User-Agent']: 'Hypixel-Guild-Discord-Bridge-NumberDenicker/1.0.0' } as Record<string, string>
    })

    return response.data
  }

  private parseArguments(commandArguments: string[]): ParsedArguments | undefined {
    if (commandArguments.length === 0) {
      return undefined
    }

    const result: ParsedArguments = {
      type: 'finals',
      number: 0,
      range: DenickCommand.DefaultRange,
      max: DenickCommand.DefaultMax
    }

    // Check for dual lookup format: finals <num> [range] [max] beds <num> [range] [max]
    const bedsIndex = commandArguments.findIndex((argument) => argument.toLowerCase() === 'beds')

    if (bedsIndex !== -1) {
      // Parse finals part
      const finalsPart = commandArguments.slice(0, bedsIndex)
      if (finalsPart.length < 2) {
        return undefined
      }

      if (finalsPart[0].toLowerCase() !== 'finals') {
        return undefined
      }

      result.type = 'finals'
      const finalsNumber = this.parseNumber(finalsPart[1])
      if (finalsNumber === undefined) {
        return undefined
      }
      result.number = finalsNumber

      if (finalsPart.length > 2) {
        const finalsRange = this.parseNumber(finalsPart[2])
        if (finalsRange !== undefined) {
          result.range = finalsRange
        }
      }

      if (finalsPart.length > 3) {
        const finalsMax = this.parseNumber(finalsPart[3])
        if (finalsMax !== undefined) {
          result.max = finalsMax
        }
      }

      // Parse beds part
      const bedsPart = commandArguments.slice(bedsIndex + 1)
      if (bedsPart.length === 0) {
        return undefined
      }

      const bedsNumber = this.parseNumber(bedsPart[0])
      if (bedsNumber === undefined) {
        return undefined
      }
      result.bedsNumber = bedsNumber

      if (bedsPart.length > 1) {
        const bedsRange = this.parseNumber(bedsPart[1])
        if (bedsRange !== undefined) {
          result.bedsRange = bedsRange
        }
      }

      if (bedsPart.length > 2) {
        const bedsMax = this.parseNumber(bedsPart[2])
        if (bedsMax !== undefined) {
          result.bedsMax = bedsMax
        }
      }

      return result
    }

    // Single lookup format: <type> <number> [range] [max]
    if (commandArguments.length < 2) {
      return undefined
    }

    const typeArgument = commandArguments[0].toLowerCase()
    if (typeArgument !== 'finals' && typeArgument !== 'beds') {
      return undefined
    }

    result.type = typeArgument

    const number = this.parseNumber(commandArguments[1])
    if (number === undefined) {
      return undefined
    }
    result.number = number

    if (commandArguments.length > 2) {
      const range = this.parseNumber(commandArguments[2])
      if (range !== undefined) {
        result.range = range
      }
    }

    if (commandArguments.length > 3) {
      const max = this.parseNumber(commandArguments[3])
      if (max !== undefined) {
        result.max = max
      }
    }

    return result
  }

  private parseNumber(value: string): number | undefined {
    const cleanValue = value.replaceAll(',', '')
    const parsed = Number.parseInt(cleanValue, 10)
    return Number.isNaN(parsed) ? undefined : parsed
  }

  private getUsage(): string {
    return (
      'Usage: !denick <finals|beds> <number> [range] [max] | ' +
      '!denick finals <number> [range] [max] beds <number> [range] [max]'
    )
  }
}

interface ParsedArguments {
  type: 'finals' | 'beds'
  number: number
  range: number
  max: number
  bedsNumber?: number
  bedsRange?: number
  bedsMax?: number
}
