import process from 'node:process'

import { type Canvas, createCanvas, type Image, loadImage, registerFont } from 'canvas'
import LRUCache from 'lru-cache'

import type Application from '../../../application'

type Canvas2DContext = NonNullable<ReturnType<Canvas['getContext']>>

export interface MessageImageOptions {
  /** Username for skin rendering when {skin} placeholder is used */
  username?: string
  /** Renderer behavior: `default` (current TS) or `js` (match hypixel-discord-chat-bridge) */
  renderer?: 'default' | 'js'
  /** When true, draws a dark panel behind the text (PNG stays transparent if unset) */
  withBackground?: boolean
  /** With `withBackground` or alone: `gradient`, `solid`, or `transparent` */
  backgroundStyle?: 'gradient' | 'solid' | 'transparent'
  /** Custom background color for solid style */
  backgroundColor?: string
}

export default class MessageToImage {
  private static readonly RgbaColorDefault: Record<string, string> = {
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

  /** JS bridge compat: note that §r is mapped to white to prevent color bleeding. */
  private static readonly RgbaColorJs: Record<string, string> = {
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
    r: 'rgba(255,255,255,1)'
    /* eslint-enable @typescript-eslint/naming-convention */
  }

  // Exact margin match to source
  private static readonly WidthMargin = 5
  private static readonly SkinSize = 35
  private static readonly CanvasWidth = 1000
  /** Rightmost x for text (leave margin for shadow) */
  private static readonly MaxLinePosition = MessageToImage.CanvasWidth - MessageToImage.WidthMargin
  private static readonly LineAdvance = 40

  private static fontsRegistered = false
  private static skinCache = new LRUCache<string, { image: Image; fetchedAt: number }>({ max: 100 })
  private static readonly SkinCacheTTL = 10 * 60 * 1000

  private static measureCanvas?: Canvas

  private static ensureFontsRegistered(): void {
    if (MessageToImage.fontsRegistered) return
    registerFont('./resources/fonts/MinecraftRegular-Bmg3.ttf', { family: 'Minecraft' })
    registerFont('./resources/fonts/unifont.ttf', { family: 'MinecraftUnicode' })
    MessageToImage.fontsRegistered = true
  }

  /**
   * Split on § / newlines without injecting §r per word (preserves Minecraft color carry-over).
   * If the string does not start with §, prepend §f so the first run uses default white.
   */
  private static splitFormattedSegments(message: string): string[] {
    if (message.length === 0) {
      return []
    }
    const withNewlines = message.replaceAll('\n', '§n')
    const normalized = withNewlines.startsWith('§') ? withNewlines : `§f${withNewlines}`
    const parts = normalized.split(/§/g)
    if (parts[0] === '') {
      parts.shift()
    } else {
      parts[0] = `f${parts[0]}`
    }
    return parts
  }

  /**
   * JS bridge compat splitting: inject §r before any space-delimited word without §,
   * then split by § and newlines.
   */
  private static splitFormattedSegmentsJs(message: string): string[] {
    if (message.length === 0) return []

    const normalizedMessage = message.replaceAll('\n', '§n')
    const splitMessageSpace = normalizedMessage.split(' ')
    for (let index = 0; index < splitMessageSpace.length; index++) {
      const segment = splitMessageSpace[index]
      if (segment !== undefined && !segment.startsWith('§')) {
        splitMessageSpace[index] = `§r${segment}`
      }
    }

    const splitMessage = splitMessageSpace.join(' ').split(/§|\n/g)
    // First entry is always the prefix before the first §.
    splitMessage.shift()
    return splitMessage
  }

  private static measureWords(context: Canvas2DContext, text: string, x: number, y: number): { x: number; y: number } {
    if (text.length === 0) {
      return { x, y }
    }
    const tokens = text.split(/(\s+)/).filter((t) => t.length > 0)
    let cx = x
    let cy = y
    const margin = MessageToImage.WidthMargin
    const maxX = MessageToImage.MaxLinePosition
    const line = MessageToImage.LineAdvance
    for (const token of tokens) {
      const tw = context.measureText(token).width
      if (cx + tw > maxX && cx > margin) {
        cy += line
        cx = margin
      }
      cx += tw
    }
    return { x: cx, y: cy }
  }

  private static drawWords(context: Canvas2DContext, text: string, x: number, y: number): { x: number; y: number } {
    if (text.length === 0) {
      return { x, y }
    }
    const tokens = text.split(/(\s+)/).filter((t) => t.length > 0)
    let cx = x
    let cy = y
    const margin = MessageToImage.WidthMargin
    const maxX = MessageToImage.MaxLinePosition
    const line = MessageToImage.LineAdvance
    for (const token of tokens) {
      const tw = context.measureText(token).width
      if (cx + tw > maxX && cx > margin) {
        cy += line
        cx = margin
      }
      context.fillText(token, cx, cy)
      cx += tw
    }
    return { x: cx, y: cy }
  }

  private static measureWrappedSegmentBody(
    context: Canvas2DContext,
    currentMessage: string,
    reserveSkin: boolean,
    x: number,
    y: number
  ): { x: number; y: number } {
    if (!currentMessage.includes('{skin}')) {
      return MessageToImage.measureWords(context, currentMessage, x, y)
    }
    const parts = currentMessage.split('{skin}')
    let pos = { x, y }
    const margin = MessageToImage.WidthMargin
    const maxX = MessageToImage.MaxLinePosition
    const line = MessageToImage.LineAdvance
    for (let index = 0; index < parts.length; index++) {
      pos = MessageToImage.measureWords(context, parts[index] ?? '', pos.x, pos.y)
      if (index < parts.length - 1) {
        const skinW = reserveSkin ? MessageToImage.SkinSize + 20 : context.measureText('{skin}').width
        if (pos.x + skinW > maxX && pos.x > margin) {
          pos.y += line
          pos.x = margin
        }
        pos.x += skinW
      }
    }
    return pos
  }

  constructor(private readonly application: Application) {}

  private async loadSkinImage(username: string, skinSize: number): Promise<Image> {
    const url = `https://mc-heads.net/avatar/${encodeURIComponent(username)}/${skinSize}`
    const cacheKey = `${username}_${skinSize}`
    const cached = MessageToImage.skinCache.get(cacheKey)
    if (cached && Date.now() - cached.fetchedAt < MessageToImage.SkinCacheTTL) {
      return cached.image
    }
    const image = await loadImage(url)
    MessageToImage.skinCache.set(cacheKey, { image, fetchedAt: Date.now() })
    return image
  }

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

  private async drawWrappedSegmentBody(
    context: Canvas2DContext,
    x: number,
    y: number,
    currentMessage: string,
    username: string | undefined
  ): Promise<{ x: number; y: number }> {
    if (!currentMessage.includes('{skin}')) {
      return MessageToImage.drawWords(context, currentMessage, x, y)
    }
    if (username === undefined || username.length === 0) {
      return MessageToImage.drawWords(context, currentMessage, x, y)
    }
    const parts = currentMessage.split('{skin}')
    let pos = { x, y }
    const margin = MessageToImage.WidthMargin
    const maxX = MessageToImage.MaxLinePosition
    const line = MessageToImage.LineAdvance
    for (let index = 0; index < parts.length; index++) {
      pos = MessageToImage.drawWords(context, parts[index] ?? '', pos.x, pos.y)
      if (index < parts.length - 1) {
        const skinW = MessageToImage.SkinSize + 20
        if (pos.x + skinW > maxX && pos.x > margin) {
          pos.y += line
          pos.x = margin
        }
        try {
          const skinImage = await this.loadSkinImage(username, MessageToImage.SkinSize)
          context.drawImage(skinImage, pos.x, pos.y - MessageToImage.SkinSize)
          pos.x += skinW
        } catch {
          pos = MessageToImage.drawWords(context, '{skin}', pos.x, pos.y)
        }
      }
    }
    return pos
  }

  /**
   * Generate an image from a Minecraft-formatted message
   * @param message The message with Minecraft color codes (§)
   * @param options Optional configuration for rendering
   */
  public async generateMessageImage(message: string, options?: MessageImageOptions): Promise<Buffer> {
    MessageToImage.ensureFontsRegistered()
    if (options?.renderer === 'js') {
      return this.generateMessageImageJs(message, options)
    }

    const splitMessage = MessageToImage.splitFormattedSegments(message)
    const canvasHeight = this.getHeight(message, options?.username, splitMessage)
    const canvas = createCanvas(MessageToImage.CanvasWidth, canvasHeight)
    const context = canvas.getContext('2d')

    this.paintBackgroundIfNeeded(canvas, options)

    // Matching source: 4px shadow, #131313, 40px font
    context.shadowOffsetX = 4
    context.shadowOffsetY = 4
    context.shadowColor = '#131313'
    context.font = `40px Minecraft, MinecraftUnicode`
    context.fillStyle = MessageToImage.RgbaColorDefault.f

    let width = MessageToImage.WidthMargin
    let height = 35

    for (const segment of splitMessage) {
      if (segment.startsWith('n')) {
        width = MessageToImage.WidthMargin
        height += MessageToImage.LineAdvance
      }
      const colorCode = MessageToImage.RgbaColorDefault[segment.charAt(0)]
      const currentMessage = segment.slice(1)

      if (colorCode) {
        context.fillStyle = colorCode
      }

      const pos = await this.drawWrappedSegmentBody(context, width, height, currentMessage, options?.username)
      width = pos.x
      height = pos.y
    }

    return canvas.toBuffer()
  }

  /**
   * Generate a simple synchronous image without async features like skins
   */
  public generateMessageImageSync(message: string, options?: MessageImageOptions): Buffer {
    MessageToImage.ensureFontsRegistered()
    if (options?.renderer === 'js') {
      return this.generateMessageImageJsSync(message, options)
    }

    const splitMessage = MessageToImage.splitFormattedSegments(message)
    const canvasHeight = this.getHeight(message, undefined, splitMessage)
    const canvas = createCanvas(MessageToImage.CanvasWidth, canvasHeight)
    const context = canvas.getContext('2d')

    this.paintBackgroundIfNeeded(canvas, options)

    // Matching source: 4px shadow, #131313, 40px font
    context.shadowOffsetX = 4
    context.shadowOffsetY = 4
    context.shadowColor = '#131313'
    context.font = `40px Minecraft, MinecraftUnicode`
    context.fillStyle = MessageToImage.RgbaColorDefault.f

    let width = MessageToImage.WidthMargin
    let height = 35

    for (const segment of splitMessage) {
      if (segment.startsWith('n')) {
        width = MessageToImage.WidthMargin
        height += MessageToImage.LineAdvance
      }
      const colorCode = MessageToImage.RgbaColorDefault[segment.charAt(0)]
      const currentMessage = segment.slice(1)

      if (colorCode) {
        context.fillStyle = colorCode
      }

      const pos = MessageToImage.drawWords(context, currentMessage, width, height)
      width = pos.x
      height = pos.y
    }

    return canvas.toBuffer()
  }

  private getHeightJs(message: string, username?: string, splitMessage?: string[]): number {
    MessageToImage.measureCanvas ??= createCanvas(1, 1)
    const context = MessageToImage.measureCanvas.getContext('2d')
    const segments = splitMessage ?? MessageToImage.splitFormattedSegmentsJs(message)
    context.font = `40px Minecraft, MinecraftUnicode`

    let width = MessageToImage.WidthMargin
    let height = 35

    for (const message_ of segments) {
      const currentMessage = message_.slice(1)
      const isSkin = currentMessage.trim() === '{skin}' && username !== undefined && username.length > 0
      const messageWidth = isSkin ? 55 : context.measureText(currentMessage).width

      if (width + messageWidth > MessageToImage.CanvasWidth || message_.startsWith('n')) {
        width = MessageToImage.WidthMargin
        height += MessageToImage.LineAdvance
      }
      width += messageWidth
    }
    if (width === MessageToImage.WidthMargin) height -= MessageToImage.LineAdvance

    return height + 10
  }

  private async generateMessageImageJs(message: string, options?: MessageImageOptions): Promise<Buffer> {
    MessageToImage.ensureFontsRegistered()
    const username = options?.username
    const splitMessage = MessageToImage.splitFormattedSegmentsJs(message)
    const canvasHeight = this.getHeightJs(message, username, splitMessage)
    const canvas = createCanvas(MessageToImage.CanvasWidth, canvasHeight)
    const context = canvas.getContext('2d')

    this.paintBackgroundIfNeeded(canvas, options)

    context.shadowOffsetX = 4
    context.shadowOffsetY = 4
    context.shadowColor = '#131313'
    context.font = `40px Minecraft, MinecraftUnicode`

    let width = MessageToImage.WidthMargin
    let height = 35

    for (const message_ of splitMessage) {
      const colorCode = MessageToImage.RgbaColorJs[message_.charAt(0)]
      const currentMessage = message_.slice(1)
      const isSkin = currentMessage.trim() === '{skin}' && username !== undefined && username.length > 0
      const messageWidth = isSkin ? 55 : context.measureText(currentMessage).width

      if (width + messageWidth > MessageToImage.CanvasWidth || message_.startsWith('n')) {
        width = MessageToImage.WidthMargin
        height += MessageToImage.LineAdvance
      }

      if (isSkin) {
        try {
          const skinImage = await this.loadSkinImage(username, MessageToImage.SkinSize)
          context.drawImage(skinImage, width, height - MessageToImage.SkinSize)
          width += messageWidth
          continue
        } catch {
          // fall back to rendering literal text
        }
      }

      if (colorCode) {
        context.fillStyle = colorCode
      }

      context.fillText(currentMessage, width, height)
      width += messageWidth
    }

    return canvas.toBuffer()
  }

  private generateMessageImageJsSync(message: string, options?: MessageImageOptions): Buffer {
    MessageToImage.ensureFontsRegistered()
    // JS compat sync renderer intentionally ignores skins (matches how sync is used in TS).
    const splitMessage = MessageToImage.splitFormattedSegmentsJs(message)
    const canvasHeight = this.getHeightJs(message, undefined, splitMessage)
    const canvas = createCanvas(MessageToImage.CanvasWidth, canvasHeight)
    const context = canvas.getContext('2d')

    this.paintBackgroundIfNeeded(canvas, options)

    context.shadowOffsetX = 4
    context.shadowOffsetY = 4
    context.shadowColor = '#131313'
    context.font = `40px Minecraft, MinecraftUnicode`

    let width = MessageToImage.WidthMargin
    let height = 35

    for (const message_ of splitMessage) {
      const colorCode = MessageToImage.RgbaColorJs[message_.charAt(0)]
      const currentMessage = message_.slice(1)

      if (width + context.measureText(currentMessage).width > MessageToImage.CanvasWidth || message_.startsWith('n')) {
        width = MessageToImage.WidthMargin
        height += MessageToImage.LineAdvance
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

  private getHeight(message: string, skinUsername?: string, splitMessage?: string[]): number {
    MessageToImage.measureCanvas ??= createCanvas(1, 1)
    const context = MessageToImage.measureCanvas.getContext('2d')
    const segments = splitMessage ?? MessageToImage.splitFormattedSegments(message)
    context.font = `40px Minecraft, MinecraftUnicode`

    const reserveSkin = skinUsername != undefined && skinUsername.length > 0

    let width = MessageToImage.WidthMargin
    let height = 35

    for (const segment of segments) {
      if (segment.startsWith('n')) {
        width = MessageToImage.WidthMargin
        height += MessageToImage.LineAdvance
      }
      const currentMessage = segment.slice(1)
      const pos = MessageToImage.measureWrappedSegmentBody(context, currentMessage, reserveSkin, width, height)
      width = pos.x
      height = pos.y
    }
    if (width == MessageToImage.WidthMargin && height === 35) {
      height -= MessageToImage.LineAdvance
    }

    return height + 10
  }
}
