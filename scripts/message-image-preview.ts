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

const OutputDirectory = path.join(process.cwd(), 'artifacts', 'message-image-preview')

const SampleList: {
  filename: string
  label: string
  message: string
  username?: string
  sync?: boolean
  /** When true, also render the JS-compat output */
  alsoJs?: boolean
}[] = [
  {
    filename: 'guild-join-with-skin.png',
    label: 'Guild join (embedded {skin} + color carry-over)',
    message: '§2Guild §2> {skin} §bUndecagon §ejoined.',
    username: 'Undecagon',
    alsoJs: true
  },
  {
    filename: 'guild-chat-mvp-style.png',
    label: 'Guild chat MVP-style (skin + rank + name carry)',
    message: '§2Guild §2> {skin} §b[MVP§a+§b] GodlySweat§a [STAFF]§f: !b booze',
    username: 'GodlySweat',
    alsoJs: true
  },
  {
    filename: 'color-carry-name.png',
    label: 'Name inherits §b until next code (no § on name word)',
    message: '§2Guild §2> {skin} §b[MVP+] GodlySweat §f: hello',
    username: 'GodlySweat',
    alsoJs: true
  },
  {
    filename: 'stats-sync.png',
    label: 'Sync renderer (no avatars) — command/stats style',
    message: '§eStats §rKills: §a100 §r| §bWins: §f50',
    sync: true
  },
  {
    filename: 'js-compat-guild-chat.png',
    label: 'JS compat renderer (only exact {skin} segments)',
    message: '§2Guild §2> {skin} §b[MVP§a+§b] GodlySweat§f: hello world',
    username: 'GodlySweat',
    alsoJs: true
  }
]

async function main(): Promise<void> {
  fs.mkdirSync(OutputDirectory, { recursive: true })
  const messageToImage = new MessageToImage({} as Application)

  for (const sample of SampleList) {
    const target = path.join(OutputDirectory, sample.filename)
    try {
      const buffer = sample.sync
        ? messageToImage.generateMessageImageSync(sample.message)
        : await messageToImage.generateMessageImage(sample.message, {
            username: sample.username
          })
      fs.writeFileSync(target, buffer)
      process.stdout.write(`OK ${sample.label}\n`)
      process.stdout.write(` -> ${target}\n`)

      if (sample.alsoJs) {
        const jsTarget = path.join(OutputDirectory, sample.filename.replace(/\.png$/i, '.js.png'))
        const jsBuffer = sample.sync
          ? messageToImage.generateMessageImageSync(sample.message, {
              username: sample.username,
              renderer: 'js'
            })
          : await messageToImage.generateMessageImage(sample.message, {
              username: sample.username,
              renderer: 'js'
            })
        fs.writeFileSync(jsTarget, jsBuffer)
        process.stdout.write(` -> ${jsTarget} (js compat)\n`)
      }
    } catch (error) {
      process.stderr.write(`FAIL ${sample.label}\n`)
      process.stderr.write(`${String(error)}\n`)
    }
  }

  process.stdout.write('\n')
  process.stdout.write('Done. Open the PNGs in artifacts/message-image-preview/\n')
}

await main()
process.exit(0)
