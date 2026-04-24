import fs from 'node:fs'

import { createCheckers } from 'ts-interface-checker'
import Yaml from 'yaml'

import ApplicationConfigTi from './application-config-ti.js'
import type { ApplicationConfig } from './application-config.js'
import { ApplicationConfigVersion } from './application-config.js'

const ApplicationConfigChecker = createCheckers(ApplicationConfigTi)

export function loadApplicationConfig(filepath: fs.PathOrFileDescriptor): ApplicationConfig {
  const fileString = fs.readFileSync(filepath, 'utf8')
  return parseApplicationConfig(fileString)
}

export function parseApplicationConfig(fileString: string): ApplicationConfig {
  // Substitute environment variables in the form of ${VAR_NAME}
  const substitutedString = fileString.replaceAll(/\${(\w+)}/g, (match, p1: string) => {
    return process.env[p1] ?? match
  })

  const config = Yaml.parse(substitutedString) as unknown

  // Normalize `discord.adminIds` to strings so YAML numeric literals are accepted
  if (config && typeof config === 'object' && 'discord' in config) {
    const discord = (config as Record<string, unknown>).discord
    if (discord && typeof discord === 'object' && 'adminIds' in discord) {
      const adminIds = (discord as Record<string, unknown>).adminIds
      if (Array.isArray(adminIds)) {
        ;(discord as Record<string, unknown>).adminIds = (adminIds as unknown[]).map(String)
      }
    }
  }

  // @ts-expect-error the validity of the object has not been checked yet till at last
  if (config.version === undefined || typeof config.version !== 'number' || config.version < ApplicationConfigVersion) {
    throw new Error(
      `Configuration is too old. ` +
        `Check config_example.yaml for the new configuration format. ` +
        `Check MIGRATION.md for further information on how to migrate the configuration file.`
    )
  }
  assertsConfigValidity(config)

  if ('plugins' in config) {
    throw new Error(
      `Detected 'plugins' section in configration. ` +
        'Plugins have been migrated outside the configuration file. ' +
        'Check docs/PLUGINS.md and docs/MIGRATION.md for further information on how to migrate.'
    )
  }

  return config
}

function assertsConfigValidity(value: unknown): asserts value is ApplicationConfig {
  ApplicationConfigChecker.ApplicationConfig.check(value)
}
