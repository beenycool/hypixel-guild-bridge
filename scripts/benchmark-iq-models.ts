import axios from 'axios'

const SAMPLE_MESSAGES = [
  'guys wat is the best sword for dungeons',
  'lol idk',
  'how do i get more mana',
  'wat is the command for party',
  'bruh why is my damage so low',
  'the hyperion is like 2 bil right',
  'how do i get into f7',
  'what class should i play',
  'is mage good',
  'my gear is like full wise dragon',
  'can someone carry me'
]

const SYSTEM_PROMPT =
  'You are evaluating intelligence based on chat messages from a Hypixel Minecraft guild. ' +
  'Consider: vocabulary range, grammar, logical reasoning, game knowledge depth, humor, and critical thinking. ' +
  'Note: gaming abbreviations ("idk", "lol", "u") and Minecraft shorthand ("f7", "hyperion", "mana") are normal for this context — do NOT penalize for them. ' +
  'Estimate an IQ (0-200) based on the substance of what they are saying, not just surface formatting. ' +
  'Respond with ONLY the number, nothing else.'

const MODELS = ['nvidia/nemotron-3-nano-30b-a3b:free', 'nvidia/nemotron-3-super-120b-a12b:free']

async function testModel(apiKey: string, model: string): Promise<void> {
  const start = Date.now()

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Chat messages from Steve:\n${SAMPLE_MESSAGES.join('\n')}` }
      ],
      temperature: 0,
      reasoning: { effort: 'minimal' }
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30_000
    }
  )

  const elapsed = ((Date.now() - start) / 1000).toFixed(2)
  const choice = response.data.choices[0]
  const msg = choice.message
  const usage = response.data.usage

  console.log(`Model: ${model}`)
  console.log(`  IQ:          ${msg.content}`)
  console.log(`  Time:        ${elapsed}s`)
  console.log(
    `  Tokens:      total=${usage.total_tokens}, completion=${usage.completion_tokens}, reasoning=${usage.completion_tokens_details?.reasoning_tokens ?? 0}`
  )
  console.log(`  Reasoning:`)
  console.log(`    ${(msg.reasoning ?? 'N/A').replace(/\n/g, '\n    ')}`)
  console.log()
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('Error: OPENROUTER_API_KEY environment variable is required')
    process.exit(1)
  }

  const target = process.argv[2]
  if (target) {
    await testModel(apiKey, target)
  } else {
    for (const model of MODELS) {
      await testModel(apiKey, model)
    }
  }
}

await main()
