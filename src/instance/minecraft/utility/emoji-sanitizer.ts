import EmojisMap from 'emoji-name-map'

const ALLOWED_EMOJI_SET = new Set(
  (
    '☺ ☹ ☠ ❣ ❤ ✌ ☝ ✍ ♨ ✈ ⌛ ⌚ ☀ ☁ ☂ ❄ ☃ ☄ ♠ ♥ ♦ ♣ ♟ ☎ ⌨ ✉ ✏ ✒ ✂ ☢ ☣ ' +
    '⬆ ⬇ ➡ ⬅ ↗ ↘ ↙ ↖ ↕ ↔ ↩ ↪ ✡ ☸ ☯ ✝ ☦ ☪ ☮ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ ▶ ◀ ♀ ♂ ✖ ‼ 〰 ☑ ✔ ✳ ✴ ' +
    '❇ © ® ™ Ⓜ ㊗ ㊙ ▪ ▫ ☷ ☵ ☶ ☋ ☌ ♜ ♕ ♡ ♬ ☚ ♮ ♝ ♯ ☴ ♭ ☓ ☛ ☭ ♢ ✐ ♖ ☈ ☒ ★ ♚ ♛ ✎ ♪ ☰ ☽ ☡ ☼ ♅ ☐ ☟ ❦ ☊'
  ).split(' ')
)

const DISALLOWED_EMOJIS = Object.entries(EmojisMap.emoji).filter(([, unicode]) => !ALLOWED_EMOJI_SET.has(unicode))

const EMOJI_PATTERN =
  DISALLOWED_EMOJIS.length > 0
    ? DISALLOWED_EMOJIS.map(([, unicode]) => unicode.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)).join('|')
    : '(?!)'

const EMOJI_REPLACE_REGEX = new RegExp(EMOJI_PATTERN, 'g')

const EMOJI_NAME_BY_UNICODE = new Map(DISALLOWED_EMOJIS.map(([name, unicode]) => [unicode, name]))

const SUBSTITUTE_EMOJI_MAP = new Map<string, string[]>([
  [
    '❤',
    ['❤️', '💟', '♥️', '🖤', '💙', '🤎', '💝', '💚', '🩶', '🩵', '🧡', '🩷', '💜', '💖', '🤍', '💛', '💓', '💗', '💕']
  ],
  ['❣', ['❣️']],
  ['☠', ['💀', '☠️']],
  ['👍', ['👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿']],
  ['👎', ['👎', '👎🏻', '👎🏼', '👎🏽', '👎🏾', '👎🏿']]
])

export default class EmojiSanitizer {
  public process(message: string): string {
    message = this.substituteEmoji(message)
    message = this.cleanStandardEmoji(message)
    return message
  }

  private substituteEmoji(message: string): string {
    for (const [substitute, convertEmojis] of SUBSTITUTE_EMOJI_MAP) {
      for (const convertEmoji of convertEmojis) {
        message = message.replaceAll(convertEmoji, substitute)
      }
    }

    return message
  }

  private cleanStandardEmoji(message: string): string {
    return message.replace(EMOJI_REPLACE_REGEX, (match) => `:${EMOJI_NAME_BY_UNICODE.get(match) ?? match}:`)
  }
}
