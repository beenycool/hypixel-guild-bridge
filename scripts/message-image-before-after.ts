/**
 * Writes two PNGs for the same sample text: legacy renderer (pre-fix) vs current MessageToImage.
 * Run from the repository root: npm run script:message-image-compare
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { createCanvas } from 'canvas'

import type Application from '../src/application.js'
import MessageToImage from '../src/instance/discord/common/message-to-image.js'

const WidthMargin = 5

/** Pre-fix color table: §r segments did not map to a color (black canvas default). */
const RgbaColorLegacy: Record<string, string> = {
  /* eslint-disable @typescript-eslint/naming-convention */
  0: 'rgba(0,0,0,1)',
  1: 'rgba(0,0,170,1)',
  2: 'rgba(0,170,0,1)',
  3: 'rgba(0,170,170,1)',
  4: 'rgba(170,0,0,1)',
  5: 'rgba(170,0,170,1)',
  6: 'rgba(255,170,0,1)',
  7: 'rgba(170,170,170,1)',
  8: 'rgba(85,85,85,1)',
  9: 'rgba(85,85,255,1)',
  a: 'rgba(85,255,85,1)',
  b: 'rgba(85,255,255,1)',
  c: 'rgba(255,85,85,1)',
  d: 'rgba(255,85,255,1)',
  e: 'rgba(255,255,85,1)',
  f: 'rgba(255,255,255,1)'
  /* eslint-enable @typescript-eslint/naming-convention */
}

const DefaultSample =
  '[Stone 7*] r4kz Kills: 483 KDR: 0.93 | Wins: 50.0\nWLR: 0.10 | Coins: 189k\n§aGreen §cRed §rreset/white'

function getHeight(message: string): number {
  const canvas = createCanvas(1, 1)
  const context = canvas.getContext('2d')
  const splitMessageSpace = message.split(' ')
  for (let index = 0; index < splitMessageSpace.length; index++) {
    const segment = splitMessageSpace[index]
    if (!segment.startsWith('§')) splitMessageSpace[index] = `§r${segment}`
  }
  const splitMessage = splitMessageSpace.join(' ').split(/§|\n/g)
  splitMessage.shift()
  context.font = `40px Minecraft, MinecraftUnicode`

  let width = WidthMargin
  let height = 35

  for (const segment of splitMessage) {
    const currentMessage = segment.slice(1)
    if (width + context.measureText(currentMessage).width > 1000 || segment.startsWith('n')) {
      width = WidthMargin
      height += 40
    }
    width += context.measureText(currentMessage).width
  }
  if (width == 5) height -= 40

  return height + 10
}

/** Matches MessageToImage before §r handling, default fill, and default background. */
function renderLegacySync(message: string): Buffer {
  const canvasHeight = getHeight(message)
  const canvas = createCanvas(1000, canvasHeight)
  const context = canvas.getContext('2d')

  const splitMessageSpace = message.split(' ')
  for (let index = 0; index < splitMessageSpace.length; index++) {
    const segment = splitMessageSpace[index]
    if (!segment.startsWith('§')) splitMessageSpace[index] = `§r${segment}`
  }

  const splitMessage = splitMessageSpace.join(' ').split(/§|\n/g)
  splitMessage.shift()

  context.shadowOffsetX = 4
  context.shadowOffsetY = 4
  context.shadowColor = '#131313'
  context.font = `40px Minecraft, MinecraftUnicode`

  let width = WidthMargin
  let height = 35

  for (const segment of splitMessage) {
    const colorCode = RgbaColorLegacy[segment.charAt(0)]
    const currentMessage = segment.slice(1)

    if (width + context.measureText(currentMessage).width > 1000 || segment.startsWith('n')) {
      width = WidthMargin
      height += 40
    }

    if (colorCode) {
      context.fillStyle = colorCode
    }

    context.fillText(currentMessage, width, height)
    width += context.measureText(currentMessage).width
  }

  return canvas.toBuffer()
}

function main(): void {
  const sample = process.argv[2] ?? DefaultSample
  const outDirectory = path.join(process.cwd(), 'artifacts', 'message-to-image-compare')
  fs.mkdirSync(outDirectory, { recursive: true })

  const beforePath = path.join(outDirectory, 'before.png')
  const afterPath = path.join(outDirectory, 'after.png')

  fs.writeFileSync(beforePath, renderLegacySync(sample))

  const messageToImage = new MessageToImage({} as Application)
  fs.writeFileSync(afterPath, messageToImage.generateMessageImageSync(sample))

  process.stdout.write('Sample text (first line):\n')
  process.stdout.write(`${sample.split('\n')[0] ?? sample}\n`)
  process.stdout.write('\n')
  process.stdout.write('Wrote:\n')
  process.stdout.write(` ${beforePath} (legacy: black §r text, transparent background)\n`)
  process.stdout.write(` ${afterPath} (current: white §r text, transparent background)\n`)
}

main()
process.exit(0)
