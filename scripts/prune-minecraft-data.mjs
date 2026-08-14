import { existsSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const bedrockDir = join(repoRoot, 'node_modules', 'minecraft-data', 'minecraft-data', 'data', 'bedrock')

if (!existsSync(bedrockDir)) {
  process.exit(0)
}

const keep = new Set(['common'])
let removedCount = 0
for (const entry of readdirSync(bedrockDir)) {
  if (!keep.has(entry)) {
    rmSync(join(bedrockDir, entry), { recursive: true, force: true })
    removedCount += 1
  }
}

process.stdout.write(`prune-minecraft-data: removed ${removedCount} bedrock data directories\n`)
