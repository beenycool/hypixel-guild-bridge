import type { Client } from 'minecraft-protocol'
import PrismarineChat from 'prismarine-chat'
import type { NBT } from 'prismarine-nbt'
import type { RegistryPc } from 'prismarine-registry'
import PrismarineRegistry from 'prismarine-registry'

export default class ClientSession {
  readonly client: Client

  readonly registry
  readonly prismChat

  silentQuit = false

  constructor(client: Client) {
    this.client = client

    this.registry = PrismarineRegistry(client.version) as RegistryPc
    this.prismChat = PrismarineChat(this.registry)

    this.listenForRegistry(client)
  }

  private listenForRegistry(client: Client): void {
    client.on('registry_data', (packet: { codec: NBT }) => {
      this.registry.loadDimensionCodec(packet.codec)
    })

    client.on('login', (packet: { dimensionCodec?: NBT }) => {
      if (packet.dimensionCodec) {
        this.registry.loadDimensionCodec(packet.dimensionCodec)
      }
    })
    client.on('respawn', (packet: { dimensionCodec?: NBT }) => {
      if (packet.dimensionCodec) {
        this.registry.loadDimensionCodec(packet.dimensionCodec)
      }
    })
  }
}
