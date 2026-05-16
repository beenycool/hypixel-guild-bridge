import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import assert from 'node:assert'

import GetMinecraftData from 'minecraft-data'
import type { ChatMessage } from 'prismarine-chat'

import type { InstanceType } from '../../common/application-event.js'
import SubInstance from '../../common/sub-instance'

import type ClientSession from './client-session.js'
import type { MinecraftChatMessage } from './common/chat-interface.js'
import type MessageAssociation from './common/message-association.js'
import { stufDecode } from './common/stuf.js'
import type MinecraftInstance from './minecraft-instance.js'

export default class ChatManager extends SubInstance<MinecraftInstance, InstanceType.Minecraft, ClientSession> {
  private readonly chatModules: MinecraftChatMessage[]
  private readonly minecraftData

  constructor(
    clientInstance: MinecraftInstance,
    private readonly messageAssociation: MessageAssociation
  ) {
    super(clientInstance)

    this.minecraftData = GetMinecraftData(clientInstance.defaultVersion)

    const require = createRequire(import.meta.url)
    const chatDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'chat')
    const files = fs.readdirSync(chatDir).filter((f) => f.endsWith('.ts'))

    this.chatModules = files
      .map((file) => {
        try {
          const mod = require(path.join(chatDir, file))
          return mod.default as MinecraftChatMessage
        } catch (err) {
          this.logger.error(`Failed to load chat module ${file}:`, err)
          return undefined
        }
      })
      .filter((m): m is MinecraftChatMessage => m !== undefined)
  }

  override registerEvents(clientSession: ClientSession): void {
    clientSession.client.on('systemChat', (data) => {
      const chatMessage = clientSession.prismChat.fromNotch(data.formattedMessage)
      void this.onMessage(chatMessage.toString(), chatMessage.toMotd(), chatMessage.json).catch(
        this.errorHandler.promiseCatch('processing minecraft raw chat')
      )
    })

    clientSession.client.on('playerChat', (data: object) => {
      void this.onFormattedMessage(clientSession, data).catch(
        this.errorHandler.promiseCatch('processing minecraft raw chat')
      )
    })
  }

  private async onFormattedMessage(clientSession: ClientSession, data: object): Promise<void> {
    const message = (data as { formattedMessage?: string }).formattedMessage
    let resultMessage: ChatMessage & Partial<{ unsigned: ChatMessage }>

    if (this.minecraftData.supportFeature('clientsideChatFormatting')) {
      const verifiedPacket = data as {
        senderName?: string
        targetName?: string
        plainMessage: string
        unsignedContent?: string
        type: number
      }
      const parameters: { content: object; sender?: object; target?: object } = {
        content: message ? (JSON.parse(message) as object) : { text: verifiedPacket.plainMessage }
      }

      if (verifiedPacket.senderName) {
        Object.assign(parameters, { sender: JSON.parse(verifiedPacket.senderName) as object })
      }
      if (verifiedPacket.targetName) {
        Object.assign(parameters, { target: JSON.parse(verifiedPacket.targetName) as object })
      }
      resultMessage = clientSession.prismChat.fromNetwork(verifiedPacket.type, parameters as Record<string, object>)

      if (verifiedPacket.unsignedContent) {
        resultMessage.unsigned = clientSession.prismChat.fromNetwork(verifiedPacket.type, {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          sender: parameters.sender!,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          target: parameters.target!,
          content: JSON.parse(verifiedPacket.unsignedContent) as object
        })
      }
    } else {
      assert.ok(message) // old packet means message exists
      resultMessage = clientSession.prismChat.fromNotch(message)
    }

    await this.onMessage(resultMessage.toString(), resultMessage.toMotd(), resultMessage.json)
  }

  private async onMessage(message: string, rawMessage: string, jsonMessage: unknown): Promise<void> {
    message = stufDecode(message)

    for (const module of this.chatModules) {
      await Promise.resolve(
        module.onChat({
          application: this.application,

          clientInstance: this.clientInstance,
          instanceName: this.clientInstance.instanceName,
          eventHelper: this.eventHelper,

          logger: this.logger,
          errorHandler: this.errorHandler,
          messageAssociation: this.messageAssociation,

          message: message,
          rawMessage: rawMessage,
          jsonMessage: jsonMessage
        })
      ).catch(this.errorHandler.promiseCatch('handling chat trigger'))
    }

    await this.application.emit('minecraftChat', {
      ...this.eventHelper.fillBaseEvent(),
      message: message,
      rawMessage: rawMessage
    })
  }
}
