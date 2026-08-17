declare module 'prismarine-chat' {
  export declare class ChatMessage {
    json: Record<string, unknown>
    toMotd: () => string
    toString: () => string
  }

  export interface PrismarineChatFormatter {
    fromNotch: (message: string) => ChatMessage
    fromNetwork: (messageType: number, parameters: Record<string, object>) => ChatMessage
  }

  type PrismarineChatConstructor = (registryOrVersion: string | object) => PrismarineChatFormatter
  declare const constructor: PrismarineChatConstructor

  export = constructor
}
