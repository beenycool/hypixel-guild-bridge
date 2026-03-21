import process from 'node:process'

import { type Canvas, createCanvas, loadImage, registerFont } from 'canvas'

import type Application from '../../../application'

registerFont('./resources/fonts/MinecraftRegular-Bmg3.ttf', { family: 'Minecraft' })
registerFont('./resources/fonts/unifont.ttf', { family: 'MinecraftUnicode' })

export interface MessageImageOptions {
  /** Username for skin rendering when {skin} placeholder is used */
  username?: string
  /** When true, draws a dark panel behind the text (PNG stays transparent if unset) */
  withBackground?: boolean
  /** With `withBackground` or alone: `gradient`, `solid`, or `transparent` */
  backgroundStyle?: 'gradient' | 'solid' | 'transparent'
  /** Custom background color for solid style */
  backgroundColor?: string
}

export default class MessageToImage {
  private static readonly RgbaColor: Record<string, string> = {
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
    f: 'rgba(255,255,255,1)',
    /** Minecraft §r reset — same as default chat (white) */
    r: 'rgba(255,255,255,1)'
    /* eslint-enable @typescript-eslint/naming-convention */
  }

  // Exact margin match to source
  private static readonly WidthMargin = 5
  private static readonly SkinSize = 35

  /**
   * Split on § / newlines without injecting §r per word (preserves Minecraft color carry-over).
   * If the string does not start with §, prepend §f so the first run uses default white.
   */
  private static splitFormattedSegments(message: string): string[] {
    if (message.length === 0) {
      return []
    }
    const normalized = message.startsWith('§') ? message : `§f${message}`
    const parts = normalized.split(/§|\n/g)
    if (parts[0] === '') {
      parts.shift()
    } else {
      parts[0] = `f${parts[0]}`
    }
    return parts
  }

  constructor(private readonly application: Application) {}

  public shouldRenderImage(): boolean {
    const config = this.application.core.discordConfigurations
    if (!config.getTextToImage()) return false

    // BUG: image renderer (PANGO library compiled in C) has trouble recognizing fonts on windows platforms.
    // running in on windows will spit out errors on process level outside Node.js control
    if (process.platform === 'win32') return false

    // Although it is true for now, might consider checking for cpu arch if problems encountered
    // since ARM arch sometimes doesn't compile the source code properly
    return true
  }

  /**
   * Generate an image from a Minecraft-formatted message
   * @param message The message with Minecraft color codes (§)
   * @param options Optional configuration for rendering
   */
  public async generateMessageImage(message: string, options?: MessageImageOptions): Promise<Buffer> {
    const canvasHeight = this.getHeight(message)
    const canvas = createCanvas(1000, canvasHeight)
    const context = canvas.getContext('2d')

    this.paintBackgroundIfNeeded(canvas, options)

    const splitMessage = MessageToImage.splitFormattedSegments(message)

    // Matching source: 4px shadow, #131313, 40px font
    context.shadowOffsetX = 4
    context.shadowOffsetY = 4
    context.shadowColor = '#131313'
    context.font = `40px Minecraft, MinecraftUnicode`
    context.fillStyle = MessageToImage.RgbaColor.f

    let width = MessageToImage.WidthMargin
    let height = 35

    for (const segment of splitMessage) {
      const colorCode = MessageToImage.RgbaColor[segment.charAt(0)]
      const currentMessage = segment.slice(1)

      // Handle line wrapping
      if (width + context.measureText(currentMessage).width > 1000 || segment.startsWith('n')) {
        width = MessageToImage.WidthMargin
        height += 40
      }

      // Handle {skin} placeholder - render player head
      if (currentMessage.trim() === '{skin}' && options?.username) {
        try {
          const skinImage = await loadImage(
            `https://mc-heads.net/avatar/${options.username}/${MessageToImage.SkinSize}`
          )
          context.drawImage(skinImage, width, height - MessageToImage.SkinSize)
          width += MessageToImage.SkinSize + 20 // Add some padding after skin
          continue
        } catch {
          // If skin load fails, just skip the placeholder
          continue
        }
      }

      if (colorCode) {
        context.fillStyle = colorCode
      }

      context.fillText(currentMessage, width, height)
      width += context.measureText(currentMessage).width
    }

    return canvas.toBuffer()
  }

  /**
   * Generate a simple synchronous image without async features like skins
   */
  public generateMessageImageSync(message: string, options?: MessageImageOptions): Buffer {
    const canvasHeight = this.getHeight(message)
    const canvas = createCanvas(1000, canvasHeight)
    const context = canvas.getContext('2d')

    this.paintBackgroundIfNeeded(canvas, options)

    const splitMessage = MessageToImage.splitFormattedSegments(message)

    // Matching source: 4px shadow, #131313, 40px font
    context.shadowOffsetX = 4
    context.shadowOffsetY = 4
    context.shadowColor = '#131313'
    context.font = `40px Minecraft, MinecraftUnicode`
    context.fillStyle = MessageToImage.RgbaColor.f

    let width = MessageToImage.WidthMargin
    let height = 35

    for (const segment of splitMessage) {
      const colorCode = MessageToImage.RgbaColor[segment.charAt(0)]
      const currentMessage = segment.slice(1)

      if (width + context.measureText(currentMessage).width > 1000 || segment.startsWith('n')) {
        width = MessageToImage.WidthMargin
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

  /** Background only when `withBackground` or `backgroundStyle` is set (default: transparent PNG). */
  private paintBackgroundIfNeeded(canvas: Canvas, options?: MessageImageOptions): void {
    if (options?.withBackground || options?.backgroundStyle) {
      this.applyBackground(canvas, options.backgroundStyle ?? 'gradient', options.backgroundColor)
    }
  }

  /**
   * Apply background styling to canvas
   */
  private applyBackground(canvas: Canvas, style: 'gradient' | 'solid' | 'transparent', color?: string): void {
    const context = canvas.getContext('2d')

    switch (style) {
      case 'gradient': {
        // Dark Minecraft-style gradient
        const gradient = context.createLinearGradient(0, 0, 0, canvas.height)
        gradient.addColorStop(0, 'rgba(20, 20, 30, 0.95)')
        gradient.addColorStop(0.5, 'rgba(30, 30, 45, 0.95)')
        gradient.addColorStop(1, 'rgba(20, 20, 30, 0.95)')
        context.fillStyle = gradient
        context.fillRect(0, 0, canvas.width, canvas.height)

        // Add subtle border
        context.strokeStyle = 'rgba(80, 80, 120, 0.5)'
        context.lineWidth = 2
        context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2)
        break
      }
      case 'solid': {
        context.fillStyle = color ?? 'rgba(30, 30, 40, 0.95)'
        context.fillRect(0, 0, canvas.width, canvas.height)
        break
      }
      case 'transparent': {
        // No background - intentionally empty
        break
      }
    }
  }

  private getHeight(message: string): number {
    const canvas = createCanvas(1, 1)
    const context = canvas.getContext('2d')
    const splitMessage = MessageToImage.splitFormattedSegments(message)
    context.font = `40px Minecraft, MinecraftUnicode`

    let width = MessageToImage.WidthMargin
    let height = 35

    for (const segment of splitMessage) {
      const currentMessage = segment.slice(1)
      if (width + context.measureText(currentMessage).width > 1000 || segment.startsWith('n')) {
        width = MessageToImage.WidthMargin
        height += 40
      }
      width += context.measureText(currentMessage).width
    }
    if (width == 5) height -= 40

    return height + 10
  }
}
