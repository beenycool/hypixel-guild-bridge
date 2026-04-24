/**
 * Renders sample Minecraft-style PNGs using the current MessageToImage implementation.
 * Run from repo root: npm run script:message-image-preview
 *
 * Outputs under artifacts/message-image-preview/ (needs network for {skin} avatar fetches).
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import type Application from '../src/application.js'
import MessageToImage from '../src/instance/discord/common/message-to-image.js'

const outDir = path.join(process.cwd(), 'artifacts', 'message-image-preview')

const samples: { filename: string; label: string; message: string; username?: string; sync?: boolean }[] = [
  {
    filename: 'guild-join-with-skin.png',
    label: 'Guild join (embedded {skin} + color carry-over)',
    message: '§2Guild §2> {skin} §bUndecagon §ejoined.',
    username: 'Undecagon'
  },
  {
    filename: 'guild-chat-mvp-style.png',
    label: 'Guild chat MVP-style (skin + rank + name carry)',
    message: '§2Guild §2> {skin} §b[MVP§a+§b] GodlySweat§a [STAFF]§f: !b booze',
    username: 'GodlySweat'
  },
  {
    filename: 'color-carry-name.png',
    label: 'Name inherits §b until next code (no § on name word)',
    message: '§2Guild §2> {skin} §b[MVP+] GodlySweat §f: hello',
    username: 'GodlySweat'
  },
  {
    filename: 'stats-sync.png',
    label: 'Sync renderer (no avatars) — command/stats style',
    message: '§eStats §rKills: §a100 §r| §bWins: §f50',
    sync: true
  }
]

async function main(): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true })
  const messageToImage = new MessageToImage({} as Application)

  for (const sample of samples) {
    const target = path.join(outDir, sample.filename)
    try {
      let buffer: Buffer
      buffer = sample.sync
        ? messageToImage.generateMessageImageSync(sample.message)
        : await messageToImage.generateMessageImage(sample.message, {
            username: sample.username
          })
      fs.writeFileSync(target, buffer)
      console.log(`OK  ${sample.label}`)
      console.log(`    -> ${target}`)
    } catch (error) {
      console.error(`FAIL ${sample.label}`)
      console.error(error)
    }
  }

  console.log('')
  console.log('Done. Open the PNGs in artifacts/message-image-preview/')
}

await main()
process.exit(0)
