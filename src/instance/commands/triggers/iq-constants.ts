export const IQ_SYSTEM_PROMPT =
  'You are evaluating intelligence based on chat messages from a Hypixel Minecraft guild. ' +
  'Consider: vocabulary range, grammar, logical reasoning, game knowledge depth, humor, and critical thinking. ' +
  'Note: gaming abbreviations ("idk", "lol", "u") and Minecraft shorthand ("f7", "hyperion", "mana") are normal for this context — do NOT penalize for them. ' +
  'Estimate an IQ (0-200) based on the substance of what they are saying, not just surface formatting. ' +
  'Respond with ONLY the number, nothing else.'

export const IQ_DEFAULT_MODEL = 'nvidia/nemotron-3-nano-30b-a3b:free'
export const IQ_MIN = 0
export const IQ_MAX = 200
export const IQ_MIN_MESSAGES = 10
