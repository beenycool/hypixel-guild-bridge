import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { OpenRouterClient } from '../src/utility/openrouter-client.js'

const SYSTEM_PROMPT = `You are a hyper-dramatic, gossipy, high-school-style server chat commentator. Your job is to read Minecraft guild chat logs and write a highly entertaining, cohesive narrative summary of today's events.

GUIDELINES:
1. Start with the exact title "Server Talk 💬" followed by a newline.
2. Organize the summary by major narrative threads and drama arcs rather than a strict minute-by-minute timeline, ensuring the transitions between topics feel natural and connected by cause-and-effect.
3. Adopt an exaggerated, drama-obsessed tone. Use dramatic commentary (e.g., "SO super dramatic!", "swoops in like a super-villain!", "kinda sassy", "so intense!") and speculate playfully on users' motivations and feelings.
4. Write in a few long, flowing narrative paragraphs. It must read like a single continuous gossip column, avoiding disjointed or repetitive sentences.
5. Capture the authentic flavor of the community. Actively look for and preserve specific text emoticons (like ( ﾟ◡ﾟ)/), inside jokes, and exact slang used in the logs.
6. Focus on the sassiest conflicts, pile-ons, and smug moments. Weave in short, direct quotes from users naturally within your sentences.
7. Include exactly one line in this format, placed exactly after the first paragraph: "<@discordId> was today's chattiest with X messages! :first_place:"
8. Do NOT censor language from the logs—no asterisks, no partial redaction. Reframe crude moments in a story-like way instead of blanking them out.
9. Limit emoji use to 1-2 per paragraph maximum—the drama should come from your word choice and pacing, not emoji decoration.
10. Do not include any reasoning, meta-commentary, or notes about your process—output only the final summary text.`

interface LogEntry {
  name: string
  discordId: string | null
  message: string
}

function parseLogs(raw: string): {
  entries: LogEntry[]
  chattiest: { name: string; discordId: string | null; count: number }
} {
  const lines = raw.split('\n')
  const entries: LogEntry[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const discordMatch = trimmed.match(/^(.+?)\s\(Discord:\s<@(\d+)>\):\s(.+)$/)
    if (discordMatch) {
      entries.push({ name: discordMatch[1], discordId: discordMatch[2], message: discordMatch[3] })
    } else {
      const noDiscordMatch = trimmed.match(/^([a-zA-Z0-9_]+):\s(.+)$/)
      if (noDiscordMatch) {
        entries.push({ name: noDiscordMatch[1], discordId: null, message: noDiscordMatch[2] })
      }
    }
  }

  const counts = new Map<string, { name: string; discordId: string | null; count: number }>()
  for (const e of entries) {
    const key = e.discordId ?? e.name
    const existing = counts.get(key)
    if (existing) {
      existing.count++
    } else {
      counts.set(key, { name: e.name, discordId: e.discordId, count: 1 })
    }
  }

  let chattiest = { name: '', discordId: null as string | null, count: 0 }
  for (const v of counts.values()) {
    if (v.count > chattiest.count) chattiest = v
  }

  return { entries, chattiest }
}

function countChars(text: string): number {
  return [...text].length
}

function countEmoji(text: string): number {
  const emojiRegex = /\p{Emoji}/gu
  const matches = text.match(emojiRegex)
  return matches ? matches.length : 0
}

function evaluateResponse(
  response: string,
  chattiest: { name: string; discordId: string | null; count: number }
): Record<string, boolean | number | string> {
  const results: Record<string, boolean | number | string> = {}

  const charCount = countChars(response)
  results.charCount = charCount
  results.under1800 = charCount <= 1800

  results.startsWithTitle = response.startsWith('Server Talk 💬')

  const chattiestRegex = /<@(\d+)> was today's chattiest with (\d+) messages!/
  const chattiestMatch = response.match(chattiestRegex)
  results.hasChattiestLine = chattiestMatch !== null
  if (chattiestMatch) {
    results.chattiestId = chattiestMatch[1]
    results.chattiestCount = parseInt(chattiestMatch[2], 10)
    results.chattiestCorrect =
      chattiestMatch[1] === chattiest.discordId && parseInt(chattiestMatch[2], 10) === chattiest.count
  } else {
    results.chattiestCorrect = false
  }

  results.noBulletPoints = !/^[-*]\s/m.test(response)

  results.noCensorAsterisks = !/\*\*\*/m.test(response)

  const paragraphs = response.split('\n\n').filter((p) => p.trim().length > 0)
  results.paragraphCount = paragraphs.length
  results.paragraphs3to4 = paragraphs.length >= 3 && paragraphs.length <= 4

  let maxEmojiPerPara = 0
  for (const p of paragraphs) {
    const e = countEmoji(p)
    if (e > maxEmojiPerPara) maxEmojiPerPara = e
  }
  results.maxEmojiPerPara = maxEmojiPerPara
  results.emojiRule = maxEmojiPerPara <= 2

  results.allPassed =
    results.under1800 &&
    results.startsWithTitle &&
    results.hasChattiestLine &&
    results.noBulletPoints &&
    results.noCensorAsterisks &&
    results.paragraphs3to4 &&
    results.emojiRule

  return results
}

function formatResult(
  label: string,
  result: Record<string, boolean | number | string>,
  elapsed: string,
  response: string
): string {
  const check = (v: unknown) => (v === true ? '✓' : v === false ? '✗' : String(v))
  return [
    `=== ${label} ===`,
    `Time: ${elapsed}s | Chars: ${result.charCount}/1800 ${check(result.under1800)}`,
    `Title: ${check(result.startsWithTitle)} | Chattiest: ${check(result.hasChattiestLine)} | Correct: ${check(result.chattiestCorrect)}`,
    `No bullets: ${check(result.noBulletPoints)} | No censor: ${check(result.noCensorAsterisks)}`,
    `Paragraphs: ${result.paragraphCount} (3-4: ${check(result.paragraphs3to4)}) | Max emoji/para: ${result.maxEmojiPerPara} ${check(result.emojiRule)}`,
    `ALL PASS: ${check(result.allPassed)}`,
    '',
    response,
    '',
    '---',
    ''
  ].join('\n')
}

async function main(): Promise<void> {
  const apiKey = process.env.HACKCLUB_API_KEY
  if (!apiKey) {
    console.error('Error: HACKCLUB_API_KEY environment variable is required')
    process.exit(1)
  }

  const rawLogs = readFileSync('logs.txt', 'utf-8')
  const parsed = JSON.parse(rawLogs)
  const chatLogs: string = parsed.content

  const { chattiest } = parseLogs(chatLogs)
  console.log(
    `Chattiest user: ${chattiest.name} (${chattiest.discordId ? `<@${chattiest.discordId}>` : chattiest.name}) with ${chattiest.count} messages\n`
  )

  const client = new OpenRouterClient(apiKey, {
    baseUrl: 'https://ai.hackclub.com/proxy/v1/chat/completions',
    timeoutMs: 120_000
  })

  const variants = [
    { label: 'sonnet5-none', reasoningEffort: undefined as string | undefined },
    { label: 'sonnet5-low', reasoningEffort: 'low' },
    { label: 'sonnet5-medium', reasoningEffort: 'medium' },
    { label: 'sonnet5-high', reasoningEffort: 'high' }
  ]

  mkdirSync('outputs', { recursive: true })

  const tableRows: string[] = []
  tableRows.push(
    `| Variant | Time(s) | Chars | ≤1800 | Title | Chattiest | Bullets✗ | Censor✗ | Para 3-4 | Emoji≤2 | ALL PASS |`
  )
  tableRows.push(
    `|---------|---------|-------|-------|-------|-----------|----------|---------|----------|---------|----------|`
  )

  for (const v of variants) {
    console.log(`Testing ${v.label}...`)
    const start = Date.now()

    await new Promise((r) => setTimeout(r, 2000))

    try {
      const result = await client.chatCompletion({
        model: 'anthropic/claude-sonnet-5',
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: chatLogs,
        reasoningEffort: v.reasoningEffort
      })

      const elapsed = ((Date.now() - start) / 1000).toFixed(2)
      const evalResult = evaluateResponse(result.content, chattiest)

      const output = formatResult(v.label, evalResult, elapsed, result.content)
      writeFileSync(`outputs/${v.label}.txt`, output)

      const check = (x: unknown) => (x === true ? '✓' : '✗')
      tableRows.push(
        `| ${v.label} | ${elapsed} | ${evalResult.charCount} | ${check(evalResult.under1800)} | ${check(evalResult.startsWithTitle)} | ${check(evalResult.hasChattiestLine)} | ${check(evalResult.noBulletPoints)} | ${check(evalResult.noCensorAsterisks)} | ${check(evalResult.paragraphs3to4)} | ${check(evalResult.emojiRule)} | ${check(evalResult.allPassed)} |`
      )

      console.log(`  Done in ${elapsed}s — ALL PASS: ${evalResult.allPassed}`)
    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(2)
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  FAILED after ${elapsed}s: ${msg}`)
      writeFileSync(`outputs/${v.label}.txt`, `=== ${v.label} ===\nERROR after ${elapsed}s:\n${msg}\n`)
      tableRows.push(`| ${v.label} | ${elapsed} | ERROR | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |`)
    }
  }

  console.log('\n\n=== RESULTS TABLE ===')
  console.log(tableRows.join('\n'))

  const summaryPath = 'outputs/SUMMARY.md'
  const summary = [
    '# Daily Summariser Benchmark: Claude Sonnet 5 Thinking Variants',
    '',
    `Chattiest in logs: **${chattiest.name}** (${chattiest.discordId ? `<@${chattiest.discordId}>` : chattiest.name}) with **${chattiest.count}** messages`,
    '',
    '## Results',
    '',
    tableRows.join('\n'),
    '',
    '## Legend',
    '',
    '| Check | Meaning |',
    '|-------|---------|',
    '| ≤1800 | Response ≤ 1800 characters (rule 8) |',
    '| Title | Starts with "Server Talk 💬" (rule 1) |',
    "| Chattiest | Contains `<@id> was today's chattiest with X messages!` (rule 7) |",
    '| Bullets✗ | No bullet-point formatting (rule 4) |',
    '| Censor✗ | No asterisk censorship (rule 9) |',
    '| Para 3-4 | Written in 3-4 paragraphs (rule 4) |',
    '| Emoji≤2 | ≤2 emoji per paragraph (rule 10) |',
    '| ALL PASS | All rule checks passed |',
    ''
  ].join('\n')
  writeFileSync(summaryPath, summary)
  console.log(`\nSummary written to ${summaryPath}`)
  console.log('Individual responses saved to outputs/<variant>.txt')
}

await main()
