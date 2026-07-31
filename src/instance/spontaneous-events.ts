import assert from 'node:assert'

import type Application from '../application'
import { ChannelType, type ChatEvent, Color, InstanceType, PunishmentPurpose } from '../common/application-event'
import { Instance } from '../common/instance'
import SubInstance from '../common/sub-instance'
import type { User } from '../common/user'
import { SpontaneousEventsNames } from '../core/spontaneous-events-configurations'
import triviaData from '../resources/data/trivia-entries.json' with { type: 'json' }
import Duration from '../utility/duration'
import { SerialExecutor } from '../utility/serial-executor.js'
import { Timeout } from '../utility/timeout'

export class SpontaneousEvents extends Instance<InstanceType.Utility> {
  private readonly registeredEventHandlers: SpontaneousEventHandler[] = []
  private readonly singletonPromise = new SerialExecutor()

  private lastEventAt = -1
  private lastEventType: SpontaneousEventHandler | undefined

  private chatHeat: { user: User; timestamp: number; bridgeId?: string }[] = []

  constructor(application: Application) {
    super(application, 'spontaneous-events', InstanceType.Utility)

    this.application.on('chat', async (event: ChatEvent) => {
      if (event.channelType !== ChannelType.Public) return
      await this.singletonPromise.run(() => this.handlePublicChatEvent(event.user, event.createdAt, event.bridgeId))
    })

    this.registerEvent(new QuickMath(this))
    this.registerEvent(new CountingChain(this))
    this.registerEvent(new Unscramble(this))
    this.registerEvent(new Trivia(this))
  }

  public registerEvent(handler: SpontaneousEventHandler): void {
    assert.ok(!this.registeredEventHandlers.includes(handler))
    this.registeredEventHandlers.push(handler)
  }

  private async handlePublicChatEvent(user: User, eventCreatedAt: number, bridgeId?: string): Promise<void> {
    const config = this.application.core.spontaneousEventsConfigurations
    const activityDuration = config.getActivityDuration()
    const minimumMessages = config.getMinimumMessages()
    const cooldownDuration = config.getCooldownDuration()
    const minimumUsers = config.getMinimumUsers()

    this.chatHeat.push({ user: user, timestamp: eventCreatedAt, bridgeId })
    this.chatHeat = this.chatHeat.filter(
      (entry) => entry.timestamp + activityDuration.toMilliseconds() > eventCreatedAt
    )

    if (this.lastEventAt + cooldownDuration.toMilliseconds() > eventCreatedAt) return

    const bridgeActivity = new Map<string | undefined, { messages: number; users: Set<User> }>()
    for (const entry of this.chatHeat) {
      const key = entry.bridgeId
      let activity = bridgeActivity.get(key)
      if (activity === undefined) {
        activity = { messages: 0, users: new Set() }
        bridgeActivity.set(key, activity)
      }
      activity.messages++
      activity.users.add(entry.user)
    }

    let bestBridgeId: string | undefined
    let bestScore = -1
    for (const [bridgeIdKey, activity] of bridgeActivity) {
      if (activity.messages < minimumMessages) continue
      if (activity.users.size < minimumUsers) continue
      if (activity.messages > bestScore) {
        bestScore = activity.messages
        bestBridgeId = bridgeIdKey
      }
    }
    if (bestBridgeId === undefined) return

    if (!this.application.core.spontaneousEventsConfigurations.getEnabled()) {
      return undefined
    }

    const spontaneousEventHandler = this.pickRandomEvent()
    if (spontaneousEventHandler === undefined) return

    await spontaneousEventHandler.startEvent(bestBridgeId).finally(() => {
      this.lastEventAt = Date.now()
      this.lastEventType = spontaneousEventHandler
    })
  }

  private pickRandomEvent(): SpontaneousEventHandler | undefined {
    const enabledHandlers = this.registeredEventHandlers.filter((handler) => handler.enabled())
    if (enabledHandlers.length === 0) return undefined

    let preferredHandlers = enabledHandlers.filter((handler) => handler !== this.lastEventType)
    if (preferredHandlers.length === 0) {
      if (enabledHandlers.length > 0) {
        preferredHandlers = enabledHandlers
      } else {
        return undefined
      }
    }

    shuffleArrayInPlace(preferredHandlers)
    return preferredHandlers[Math.floor(Math.random() * preferredHandlers.length)]
  }
}

export abstract class SpontaneousEventHandler extends SubInstance<SpontaneousEvents, InstanceType.Utility, void> {
  override registerEvents() {
    // do nothing
  }

  public abstract enabled(): boolean

  protected async broadcastMessage(message: string, color: Color, bridgeId?: string): Promise<void> {
    await this.application.emit('broadcast', {
      ...this.eventHelper.fillBaseEvent(),

      channels: [ChannelType.Public],
      color: color,
      bridgeId: bridgeId,

      user: undefined,
      message: message
    })
  }

  abstract startEvent(bridgeId?: string): Promise<void>
}

class QuickMath extends SpontaneousEventHandler {
  override enabled(): boolean {
    return this.application.core.spontaneousEventsConfigurations
      .getEnabledEvents()
      .includes(SpontaneousEventsNames.QuickMath)
  }

  override async startEvent(bridgeId?: string): Promise<void> {
    const math = this.createMath()
    if (math === undefined) return

    const timeout = new Timeout<ChatEvent>(10_000)

    const listener = (event: ChatEvent) => {
      if (event.channelType !== ChannelType.Public) return
      if (bridgeId !== undefined && event.bridgeId !== bridgeId) return

      const match = /^\d+/g.exec(event.message)
      if (!match) return

      const guess = Number.parseInt(match[0], 10)
      if (guess === math.answer) timeout.resolve(event)
    }

    this.application.on('chat', listener)
    await this.broadcastMessage(
      this.application.getTranslatorForBridge(bridgeId)('instance.spontaneous.quickMath.question', {
        expression: math.expression
      }),
      Color.Good,
      bridgeId
    )
    timeout.refresh()

    const result = await timeout.wait()
    this.application.off('chat', listener)

    // eslint-disable-next-line unicorn/prefer-ternary
    if (result === undefined) {
      await this.broadcastMessage(
        this.application.getTranslatorForBridge(bridgeId)('instance.spontaneous.quickMath.answer', {
          answer: math.answer
        }),
        Color.Info,
        bridgeId
      )
    } else {
      await this.broadcastMessage(
        this.application.getTranslatorForBridge(bridgeId)('instance.spontaneous.quickMath.correct', {
          user: result.user.displayName()
        }),
        Color.Good,
        bridgeId
      )
    }
  }

  private createMath(): { expression: string; answer: number } | undefined {
    const possibilities = [
      ...Array.from({ length: 5 }).fill('multiplication'),
      ...Array.from({ length: 10 }).fill('addition'),
      ...Array.from({ length: 5 }).fill('trickyAddition'),
      ...Array.from({ length: 5 }).fill('division'),
      ...Array.from({ length: 2 }).fill('hard')
    ] as ('multiplication' | 'addition' | 'trickyAddition' | 'division' | 'hard')[]

    const selected = possibilities[Math.floor(Math.random() * possibilities.length)]
    switch (selected) {
      case 'multiplication': {
        const a = Math.round(Math.random() * 12) + 1
        const b = Math.round(Math.random() * 12) + 1
        return { expression: `${a} * ${b}`, answer: a * b }
      }
      case 'addition': {
        const a = Math.round(Math.random() * 100) + 1
        const b = Math.round(Math.random() * 100) + 1
        return { expression: `${a} + ${b}`, answer: a + b }
      }
      case 'division': {
        for (let tries = 0; tries < 100; tries++) {
          const a = Math.round(Math.random() * 100) + 1
          const b = Math.round(Math.random() * 100) + 1
          if (a % b !== 0) continue
          return { expression: `${a} / ${b}`, answer: a / b }
        }

        return undefined
      }
      case 'trickyAddition': {
        const a = Math.round(Math.random() * 100) + 1
        const b = Math.round(Math.random() * 10) + 1
        const c = Math.round(Math.random() * 10) + 1
        return { expression: `${a} + ${b} * ${c}`, answer: a + b * c }
      }
      case 'hard': {
        const a = Math.round(Math.random() * 5) + 1
        const b = Math.round(Math.random() * 10) + 1
        const c = Math.round(Math.random() * 12) + 1
        const d = Math.round(Math.random() * 4) + 1
        return { expression: `${a} + (${b} * ${c})^${d}`, answer: a + Math.pow(b * c, d) }
      }
    }
  }
}

class CountingChain extends SpontaneousEventHandler {
  override enabled(): boolean {
    return this.application.core.spontaneousEventsConfigurations
      .getEnabledEvents()
      .includes(SpontaneousEventsNames.CountingChain)
  }

  override async startEvent(bridgeId?: string): Promise<void> {
    const timeout = new Timeout<ChatEvent>(10_000)
    let beforeLast: User | undefined
    let lastUser: User | undefined
    let currentCount = 0

    const listener = (event: ChatEvent) => {
      if (event.channelType !== ChannelType.Public) return
      if (bridgeId !== undefined && event.bridgeId !== bridgeId) return
      if (lastUser !== undefined && event.user.equalsUser(lastUser)) return

      const match = /^\d+/g.exec(event.message)
      if (!match) return

      const nextPossibleCount = Number.parseInt(match[0], 10)
      if (nextPossibleCount === currentCount + 1) {
        timeout.refresh()
        currentCount = nextPossibleCount
        beforeLast = lastUser
        lastUser = event.user
      }
    }

    this.application.on('chat', listener)
    await this.broadcastMessage(
      this.application.getTranslatorForBridge(bridgeId)('instance.spontaneous.counting.start'),
      Color.Good,
      bridgeId
    )
    timeout.refresh()

    await timeout.wait()
    this.application.off('chat', listener)

    if (beforeLast === undefined) {
      await this.broadcastMessage(
        this.application.getTranslatorForBridge(bridgeId)('instance.spontaneous.counting.fail'),
        Color.Info,
        bridgeId
      )
    } else {
      await this.broadcastMessage(
        this.application.getTranslatorForBridge(bridgeId)('instance.spontaneous.counting.blame', {
          user: beforeLast.displayName()
        }),
        Color.Good,
        bridgeId
      )
    }
  }
}

class Unscramble extends SpontaneousEventHandler {
  private static readonly ScrambleWords = [
    // generic
    ...'apple banana orange grape lemon cherry peach mango kiwi plum table chair couch desk shelf'.split(' '),
    ...'blanket carpet curtain house garden porch fence roof window door floor stairs attic water coffee'.split(' '),
    ...'juice soda milk bread cheese butter egg dog cat bird fish horse rabbit mouse snake frog sun'.split(' '),
    ...'star cloud rain snow wind storm thunder lightning red blue green yellow orange purple pink brown'.split(' '),
    ...'white happy sad angry scared brave tired sleepy hungry thirsty excited run walk jump swim'.split(' '),
    ...'sing read write draw car bike bus train plane boat ship truck scooter school teacher student'.split(' '),
    ...'pencil paper eraser ruler clock map pillow tea moon black dance book lamp turtle climb taxi'.split(' '),

    // hypixel generic
    ...'skyblock bedwars duels skywars murdermystery blitzsg paintball quakecraft tntgames arcade megawalls'.split(' '),
    ...'buildbattle pit classic arena lobby hub quest daily reward token crown relic dragon phoenix'.split(' '),
    ...'wither ender slime zombie skeleton creeper minion pet armor sword bow axe pickaxe shovel hoe'.split(' '),
    ...'shield potion brew enchant grindstone anvil forge talisman rune scroll gem island farm'.split(' '),
    ...'mine quarry nether overworld end portal warp spawn lobby queue match round team solo duo'.split(' '),
    ...'trio squad clan rank level xp prestige boost upgrade shop market auction trade vote'.split(' '),
    ...'votecrate crate loot chest key mysterybox surprise event festival holiday halloween christmas'.split(' '),
    ...'easter summer winter spring autumn fireworksa'.split(' '),

    // minecraft
    ...''.split('smelting diamond banner netherrack packedice bone zombie'),
    ...'block pickaxe shovel axe hoe sword bow arrow helmet chestplate leggings boots furnace crafting'.split(' '),
    ...'enchanting brewing redstone piston lever button pressureplate torch lantern glowstone obsidian'.split(' '),
    ...'emerald gold iron coal charcoal lapis quartz netherite slimeball feather leather wool carpet'.split(' '),
    ...'map compass clock bucket water lava sand gravel dirt grass stone cobblestone mossy basalt'.split(' '),
    ...'soulsoil endstone prismarine sea‑lantern kelp coral sponge ice snow cactus vines lilypad oak'.split(' '),
    ...'birch spruce jungle acacia darkoak mangrove bamboo chorus mushroom creeper skeleton spider'.split(' '),
    ...'enderman witch slime ghast blaze shulker villager horse pig cow sheep chicken rabbit dolphin'.split(' '),

    ...'skyblock combat garden jerry farming foraging galatea kills slayer sven hub player skill'.split(' '),
    ...'dungeon healer berserk mage archer tank floor'.split(' ')
  ]

  override enabled(): boolean {
    return this.application.core.spontaneousEventsConfigurations
      .getEnabledEvents()
      .includes(SpontaneousEventsNames.Unscramble)
  }

  override async startEvent(bridgeId?: string): Promise<void> {
    const chosenWord = this.pickWord()

    const timeout = new Timeout<ChatEvent>(30_000)

    const listener = (event: ChatEvent) => {
      if (event.channelType !== ChannelType.Public) return
      if (bridgeId !== undefined && event.bridgeId !== bridgeId) return

      const match = event.message.trim().split(' ')[0].toLowerCase().trim()
      if (match === chosenWord.original) timeout.resolve(event)
    }

    this.application.on('chat', listener)
    await this.broadcastMessage(
      this.application.getTranslatorForBridge(bridgeId)('instance.spontaneous.unscramble.question', {
        word: chosenWord.scrambled
      }),
      Color.Good,
      bridgeId
    )
    timeout.refresh()

    const result = await timeout.wait()
    this.application.off('chat', listener)

    // eslint-disable-next-line unicorn/prefer-ternary
    if (result === undefined) {
      await this.broadcastMessage(
        this.application.getTranslatorForBridge(bridgeId)('instance.spontaneous.unscramble.answer', {
          word: chosenWord.original
        }),
        Color.Info,
        bridgeId
      )
    } else {
      await this.broadcastMessage(
        this.application.getTranslatorForBridge(bridgeId)('instance.spontaneous.unscramble.correct', {
          user: result.user.displayName()
        }),
        Color.Good,
        bridgeId
      )
    }
  }

  private pickWord(): { original: string; scrambled: string } {
    const wordsToPickFrom = Unscramble.ScrambleWords.map((entry) => entry.toLowerCase().trim())
      .filter((entry) => entry.length >= 3)
      .filter((entry) => /^\w+$/.test(entry))

    const pickedWord = wordsToPickFrom[Math.floor(Math.random() * wordsToPickFrom.length)]
    // eslint-disable-next-line unicorn/prefer-spread
    const pickedWordReversed = pickedWord.split('').toReversed().join('')

    for (let tryCount = 0; tryCount < 50; tryCount++) {
      // eslint-disable-next-line unicorn/prefer-spread
      const scrambled = shuffleArrayInPlace(pickedWord.split('')).join('')

      if (scrambled !== pickedWord && scrambled !== pickedWordReversed) {
        return { original: pickedWord, scrambled: scrambled }
      }
    }

    // eslint-disable-next-line unicorn/prefer-spread
    return { original: pickedWord, scrambled: pickedWord.split('').toReversed().join('') }
  }
}

class Trivia extends SpontaneousEventHandler {
  private static readonly IndexLetters = ['a', 'b', 'c', 'd', 'e']
  private static readonly TriviaEntries = triviaData

  override enabled(): boolean {
    return this.application.core.spontaneousEventsConfigurations
      .getEnabledEvents()
      .includes(SpontaneousEventsNames.Trivia)
  }

  override async startEvent(bridgeId?: string): Promise<void> {
    const trivia = this.createQuiz()

    const timeout = new Timeout<ChatEvent>(30_000)
    const correctUsers: User[] = []
    const incorrectUsers: User[] = []

    const listener = (event: ChatEvent) => {
      if (event.channelType !== ChannelType.Public) return
      if (bridgeId !== undefined && event.bridgeId !== bridgeId) return

      const match = event.message.trim().split(' ')[0].toLowerCase().trim()
      if (!Trivia.IndexLetters.includes(match)) return

      for (const answeredUsers of [...correctUsers, ...incorrectUsers]) {
        if (answeredUsers.equalsUser(event.user)) return
      }

      if (match === trivia.answerLetter.toLowerCase()) {
        correctUsers.push(event.user)
      } else {
        incorrectUsers.push(event.user)
      }
    }

    this.application.on('chat', listener)
    await this.broadcastMessage(
      this.application.getTranslatorForBridge(bridgeId)('instance.spontaneous.trivia.question', {
        question: trivia.question
      }),
      Color.Good,
      bridgeId
    )
    timeout.refresh()

    await timeout.wait()
    this.application.off('chat', listener)

    // eslint-disable-next-line unicorn/prefer-ternary
    if (correctUsers.length === 0) {
      await this.broadcastMessage(
        this.application.getTranslatorForBridge(bridgeId)('instance.spontaneous.trivia.answer', {
          answer: trivia.answerDisplay
        }),
        Color.Info,
        bridgeId
      )
    } else {
      await this.broadcastMessage(
        this.application.getTranslatorForBridge(bridgeId)('instance.spontaneous.trivia.correct', {
          users: correctUsers.map((u) => u.displayName()).join(', ')
        }),
        Color.Good,
        bridgeId
      )
    }
  }

  private createQuiz(): { question: string; answerDisplay: string; answerLetter: string } {
    const trivia = Trivia.TriviaEntries[Math.floor(Math.random() * Trivia.TriviaEntries.length)]

    let question = trivia.question + '\n'

    const answers = [trivia.correctAnswer, ...trivia.otherAnswers]
    shuffleArrayInPlace(answers)

    for (const [index, answer] of answers.entries()) {
      question += `${Trivia.IndexLetters[index].toUpperCase()}. ${answer}\n`
    }

    return {
      question: question.trim(),
      answerDisplay: trivia.correctAnswer,
      answerLetter: Trivia.IndexLetters[answers.indexOf(trivia.correctAnswer)]
    }
  }
}

// https://stackoverflow.com/a/2450976
function shuffleArrayInPlace<T>(array: T[]): T[] {
  let currentIndex = array.length

  while (currentIndex != 0) {
    const randomIndex = Math.floor(Math.random() * currentIndex)
    currentIndex--
    ;[array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]]
  }

  return array
}
