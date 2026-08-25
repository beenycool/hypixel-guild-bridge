import type { Player } from 'hypixel-api-reborn'

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

export class CommandApiCache {
  private static readonly TtlMs = 30_000

  private readonly mojangCache = new Map<string, CacheEntry<string>>()
  private readonly hypixelPlayerCache = new Map<string, CacheEntry<Player>>()

  getMojangUuid(username: string): string | undefined {
    const key = username.toLowerCase()
    const entry = this.mojangCache.get(key)
    if (entry !== undefined && entry.expiresAt > Date.now()) {
      return entry.data
    }
    this.mojangCache.delete(key)
    return undefined
  }

  setMojangUuid(username: string, uuid: string): void {
    this.mojangCache.set(username.toLowerCase(), {
      data: uuid,
      expiresAt: Date.now() + CommandApiCache.TtlMs
    })
  }

  getHypixelPlayer(uuid: string): Player | undefined {
    const entry = this.hypixelPlayerCache.get(uuid)
    if (entry !== undefined && entry.expiresAt > Date.now()) {
      return entry.data
    }
    this.hypixelPlayerCache.delete(uuid)
    return undefined
  }

  setHypixelPlayer(uuid: string, player: Player): void {
    this.hypixelPlayerCache.set(uuid, {
      data: player,
      expiresAt: Date.now() + CommandApiCache.TtlMs
    })
  }

  clear(): void {
    this.mojangCache.clear()
    this.hypixelPlayerCache.clear()
  }
}
