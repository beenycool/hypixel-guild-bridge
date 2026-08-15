import { ChannelType, InstanceType, PunishmentPurpose } from '../../../common/application-event.js'
import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import Duration from '../../../utility/duration'
import { canOnlyUseIngame } from '../common/utility'

interface BlackjackGame {
  playerHand: number[]
  dealerHand: number[]
  deck: number[]
}

export default class Blackjack extends ChatCommandHandler {
  private static readonly MaxCards = 5
  private static readonly MuteDuration = Duration.minutes(15)
  private readonly activeGames = new Map<string, BlackjackGame>()

  constructor() {
    super({
      category: 'Fun',
      triggers: ['blackjack', 'bj'],
      description: 'Play blackjack against the bot. Lose and you get muted for 15 minutes',
      example: `bj | bj hit | bj stand`
    })
  }

  handler(context: ChatCommandContext): string {
    if (context.message.instanceType !== InstanceType.Minecraft) {
      return canOnlyUseIngame(context)
    }
    if (context.message.channelType !== ChannelType.Public) {
      return `${context.username}, Command can only be executed in public chat!`
    }

    const subcommand = context.args[0]?.toLowerCase()
    const game = this.activeGames.get(context.username)

    switch (subcommand) {
      case 'hit': {
        if (game === undefined)
          return `${context.username}, you don't have an active game. Start one with ${context.commandPrefix}bj`
        return this.hit(context, game)
      }
      case 'stand': {
        if (game === undefined)
          return `${context.username}, you don't have an active game. Start one with ${context.commandPrefix}bj`
        return this.stand(context, game)
      }
      default: {
        return this.start(context, game)
      }
    }
  }

  private start(context: ChatCommandContext, game: BlackjackGame | undefined): string {
    if (game !== undefined) {
      return `${context.username}, you already have an active game: ${this.formatHand(game.playerHand)} vs dealer showing ${this.formatCard(game.dealerHand[0])}. Use ${context.commandPrefix}bj hit or ${context.commandPrefix}bj stand.`
    }

    const deck = this.newDeck()
    const newGame: BlackjackGame = {
      playerHand: [this.drawCard(deck), this.drawCard(deck)],
      dealerHand: [this.drawCard(deck), this.drawCard(deck)],
      deck: deck
    }
    this.activeGames.set(context.username, newGame)

    return this.render(
      context,
      newGame,
      `Your cards: ${this.formatHand(newGame.playerHand)} (${this.handValue(newGame.playerHand)}) | Dealer shows: ${this.formatCard(newGame.dealerHand[0])}. ${context.commandPrefix}bj hit or ${context.commandPrefix}bj stand`
    )
  }

  private hit(context: ChatCommandContext, game: BlackjackGame): string {
    if (game.playerHand.length >= Blackjack.MaxCards) {
      return this.stand(context, game)
    }

    game.playerHand.push(this.drawCard(game.deck))
    const value = this.handValue(game.playerHand)

    if (value > 21) {
      return this.lose(context, `${context.username} went bust with ${value}!`)
    }
    if (value === 21) {
      return this.stand(context, game)
    }

    return this.render(
      context,
      game,
      `Your cards: ${this.formatHand(game.playerHand)} (${value}) | Dealer shows: ${this.formatCard(game.dealerHand[0])}. ${context.commandPrefix}bj hit or ${context.commandPrefix}bj stand`
    )
  }

  private stand(context: ChatCommandContext, game: BlackjackGame): string {
    const playerValue = this.handValue(game.playerHand)

    while (this.handValue(game.dealerHand) < 17 && game.dealerHand.length < Blackjack.MaxCards) {
      game.dealerHand.push(this.drawCard(game.deck))
    }

    const dealerValue = this.handValue(game.dealerHand)
    const reveal = `Dealer: ${this.formatHand(game.dealerHand)} (${dealerValue}) | You: ${this.formatHand(game.playerHand)} (${playerValue}).`

    if (dealerValue > 21) return this.win(context, `${reveal} Dealer went bust!`)
    if (dealerValue === playerValue) return this.draw(context, `${reveal} Push, nobody wins.`)
    if (dealerValue > playerValue) return this.lose(context, reveal)

    return this.win(context, reveal)
  }

  private win(context: ChatCommandContext, result: string): string {
    this.activeGames.delete(context.username)
    return `${this.message(context, 'win').replaceAll('{username}', context.username)} ${result}`
  }

  private lose(context: ChatCommandContext, result: string): string {
    this.activeGames.delete(context.username)

    void context.message.user
      .mute(
        context.eventHelper.fillBaseEvent(),
        PunishmentPurpose.Game,
        Blackjack.MuteDuration,
        'Lost in Blackjack game'
      )
      .catch((error: unknown) => {
        context.logger.error('Failed to mute blackjack loser', error)
      })

    return `${this.message(context, 'lose').replaceAll('{username}', context.username)} ${result}`
  }

  private draw(context: ChatCommandContext, result: string): string {
    this.activeGames.delete(context.username)
    return `${this.message(context, 'draw').replaceAll('{username}', context.username)} ${result}`
  }

  private render(context: ChatCommandContext, game: BlackjackGame, status: string): string {
    const playerValue = this.handValue(game.playerHand)
    if (playerValue === 21 && game.playerHand.length === 2 && game.dealerHand.length === 2) {
      return this.win(context, `${status} Blackjack! You win instantly.`)
    }
    return status
  }

  private message(context: ChatCommandContext, key: 'win' | 'lose' | 'draw'): string {
    const translator = context.app.getTranslatorForBridge(context.message.bridgeId)
    const override = translator(`commands.blackjack.${key}`)
    if (override && override !== `commands.blackjack.${key}`) {
      try {
        const messages = JSON.parse(override) as string[]
        return messages[Math.floor(Math.random() * messages.length)]
      } catch {
        return override
      }
    }

    const languageConfigurations = context.app.core.languageConfigurations
    let messages: string[]
    switch (key) {
      case 'win': {
        messages = languageConfigurations.getCommandBlackjackWin()
        break
      }
      case 'lose': {
        messages = languageConfigurations.getCommandBlackjackLose()
        break
      }
      default: {
        messages = languageConfigurations.getCommandBlackjackDraw()
      }
    }
    return messages[Math.floor(Math.random() * messages.length)]
  }

  private newDeck(): number[] {
    const deck: number[] = []
    for (let value = 1; value <= 13; value++) {
      for (let suit = 0; suit < 4; suit++) {
        deck.push(value)
      }
    }
    for (let index = deck.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1))
      ;[deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]]
    }
    return deck
  }

  private drawCard(deck: number[]): number {
    const card = deck.pop()
    return card ?? 1
  }

  private cardValue(value: number): number {
    if (value === 1) return 11
    if (value >= 10) return 10
    return value
  }

  private handValue(hand: number[]): number {
    let value = 0
    let aces = 0
    for (const card of hand) {
      if (card === 1) {
        aces++
        value += 11
      } else {
        value += this.cardValue(card)
      }
    }
    while (value > 21 && aces > 0) {
      value -= 10
      aces--
    }
    return value
  }

  private formatCard(value: number): string {
    const face = value === 1 ? 'A' : value === 11 ? 'J' : value === 12 ? 'Q' : value === 13 ? 'K' : String(value)
    return face
  }

  private formatHand(hand: number[]): string {
    return hand.map((card) => this.formatCard(card)).join(' ')
  }
}
