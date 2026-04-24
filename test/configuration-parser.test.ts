import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loadApplicationConfig, parseApplicationConfig } from '../src/configuration-parser.js'

function writeTemporaryYaml(content: string): string {
  const temporary = path.join(os.tmpdir(), `hypixel-config-test-${Date.now()}.yaml`)
  fs.writeFileSync(temporary, content, 'utf8')
  return temporary
}

function buildMinimalConfig(adminIds: string[] | bigint[]) {
  return `version: 2
general:
  hypixelApiKey: "test-key"
  shareMetrics: false
discord:
  key: "discord-key"
  adminIds: ${JSON.stringify(adminIds)}
prometheus:
  enabled: false
  port: 9090
  prefix: "hypixel_bridge_"
`
}

const NumericYaml = buildMinimalConfig(['117478569652807273'])
const NumericPath = writeTemporaryYaml(NumericYaml)
const NumericConfig = loadApplicationConfig(NumericPath)
if (!Array.isArray(NumericConfig.discord.adminIds)) throw new Error('adminIds not an array')
if (typeof NumericConfig.discord.adminIds[0] !== 'string') throw new Error('numeric adminId was not coerced to string')
assert.ok(true, 'numeric adminId coerced to string')

const StringYaml = buildMinimalConfig(['1174785696528072738'])
const StringPath = writeTemporaryYaml(StringYaml)
const StringConfig = loadApplicationConfig(StringPath)
if (typeof StringConfig.discord.adminIds[0] !== 'string') throw new Error('string adminId is not string')
assert.ok(true, 'string adminId remains string')

const DirectYaml = buildMinimalConfig(['12345'])
const DirectConfig = parseApplicationConfig(DirectYaml)
if (DirectConfig.discord.adminIds[0] !== '12345') throw new Error('parseApplicationConfig failed')
assert.ok(true, 'parseApplicationConfig works')

process.env.TEST_KEY = 'env-test-key'
const EnvironmentYaml = buildMinimalConfig(['123']).replace('test-key', '${TEST_KEY}')
const EnvironmentConfig = parseApplicationConfig(EnvironmentYaml)
if (EnvironmentConfig.general.hypixelApiKey !== 'env-test-key') throw new Error('env var substitution failed')
assert.ok(true, 'environment variable substitution works')

assert.ok(true, 'All configuration-parser tests passed')
