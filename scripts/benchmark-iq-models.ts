import { IQ_DEFAULT_MODEL, IQ_SYSTEM_PROMPT } from '../src/instance/commands/triggers/iq-constants.js'
import { OpenRouterClient } from '../src/utility/openrouter-client.js'

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

const MODELS = [IQ_DEFAULT_MODEL, 'nvidia/nemotron-3-super-120b-a12b:free']

async function testModel(client: OpenRouterClient, model: string): Promise<void> {
  const start = Date.now()

  const result = await client.chatCompletion({
    model,
    systemPrompt: IQ_SYSTEM_PROMPT,
    userPrompt: `Chat messages from Steve:\n${SAMPLE_MESSAGES.join('\n')}`,
    reasoningEffort: 'minimal'
  })

  const elapsed = ((Date.now() - start) / 1000).toFixed(2)

  console.log(`Model: ${model}`)
  console.log(`  IQ:          ${result.content}`)
  console.log(`  Time:        ${elapsed}s`)
  console.log()
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('Error: OPENROUTER_API_KEY environment variable is required')
    process.exit(1)
  }

  const client = new OpenRouterClient(apiKey)

  const target = process.argv[2]
  if (target) {
    await testModel(client, target)
  } else {
    for (const model of MODELS) {
      await testModel(client, model)
    }
  }
}

await main()
