import assert from 'node:assert'

import DefaultAxios, { AxiosError, HttpStatusCode } from 'axios'
import PromiseQueue from 'promise-queue'

import type { DatabaseManager } from '../../common/database-manager'
import type { MojangProfile } from '../../common/user'
import RateLimiter from '../../utility/rate-limiter'

export class MojangApi {
  private static readonly RetryCount = 3
  private static readonly MaxQueueSize = 15
  private readonly queue = new PromiseQueue(1)
  private readonly rateLimit = new RateLimiter(1, 800)

  private readonly mojangDatabase: MojangDatabase

  constructor(private readonly databaseManager: DatabaseManager) {
    this.mojangDatabase = new MojangDatabase(this.databaseManager)
  }

  public async load(): Promise<void> {
    await this.mojangDatabase.load()
  }

  async profileByUsername(username: string): Promise<MojangProfile> {
    const cachedResult = this.mojangDatabase.profileByUsername(username)
    if (cachedResult) return cachedResult

    if (this.queue.getQueueLength() >= MojangApi.MaxQueueSize) {
      throw new Error('Mojang API queue is full. Try again later.')
    }

    const result = await this.queue.add(async () => {
      let lastError: Error | undefined
      for (let retry = 0; retry < MojangApi.RetryCount; retry++) {
        await this.rateLimit.wait()

        try {
          return await DefaultAxios.get<MojangProfile>(
            `https://api.minecraftservices.com/minecraft/profile/lookup/name/${username}`
          ).then((response) => response.data)
        } catch (error: unknown) {
          if (error instanceof Error) lastError = error
          if (error instanceof AxiosError && error.status === HttpStatusCode.TooManyRequests) continue

          throw error
        }
      }

      throw lastError ?? new Error('Failed fetching new data')
    })

    this.cache([result])
    return result
  }

  async profileByUuid(uuid: string): Promise<MojangProfile> {
    assert.ok(uuid.length === 32 || uuid.length === 36, `'uuid' must be valid UUID. given ${uuid}`)

    const cachedResult = this.mojangDatabase.profileByUuid(uuid)
    if (cachedResult) return cachedResult

    if (this.queue.getQueueLength() >= MojangApi.MaxQueueSize) {
      throw new Error('Mojang API queue is full. Try again later.')
    }

    const result = await this.queue.add(async () => {
      let lastError: Error | undefined

      for (let retry = 0; retry < MojangApi.RetryCount; retry++) {
        await this.rateLimit.wait()

        try {
          return await DefaultAxios.get<MojangProfile>(
            `https://api.minecraftservices.com/minecraft/profile/lookup/${uuid}`
          ).then((response) => response.data)
        } catch (error: unknown) {
          if (error instanceof Error) lastError = error
          if (error instanceof AxiosError && error.status === HttpStatusCode.TooManyRequests) continue

          throw error
        }
      }

      throw lastError ?? new Error('Failed fetching new data')
    })

    this.cache([result])
    return result
  }

  async profilesByUsername(usernames: Set<string>): Promise<Map<string, string | undefined>> {
    const result = new Map<string, string | undefined>()

    const requests: Promise<void>[] = []

    const queue = (usernamesChunk: string[]) =>
      this.lookupUsernames(usernamesChunk)
        .then((profiles) => {
          for (const profile of profiles) {
            result.set(profile.name, profile.id)
          }

          const resolvedProfileNames = new Set(profiles.map((profile) => profile.name.toLowerCase()))
          for (const username of usernamesChunk) {
            if (!resolvedProfileNames.has(username.toLowerCase())) {
              result.set(username, undefined)
            }
          }
        })
        .catch(() => {
          for (const username of usernamesChunk) {
            result.set(username, undefined)
          }
        })

    const chunkSize = 10
    let chunk: string[] = []
    for (const username of usernames) {
      const cachedProfile = this.mojangDatabase.profileByUsername(username)
      if (cachedProfile !== undefined) {
        result.set(username, cachedProfile.id)
        continue
      }

      chunk.push(username)
      if (chunk.length >= chunkSize) {
        requests.push(queue(chunk))
        chunk = []
      }
    }
    if (chunk.length > 0) requests.push(queue(chunk))

    await Promise.all(requests)

    return result
  }

  public cache(profiles: MojangProfile[]): void {
    this.mojangDatabase.add(profiles)
  }

  private async lookupUsernames(usernames: string[]): Promise<MojangProfile[]> {
    if (this.queue.getQueueLength() >= MojangApi.MaxQueueSize) {
      throw new Error('Mojang API queue is full. Try again later.')
    }

    const result = await this.queue.add(async () => {
      let lastError: Error | undefined
      for (let retry = 0; retry < MojangApi.RetryCount; retry++) {
        await this.rateLimit.wait()
        try {
          return await DefaultAxios.post<MojangProfile[]>(
            'https://api.minecraftservices.com/minecraft/profile/lookup/bulk/byname',
            usernames
          ).then((response) => response.data)
        } catch (error: unknown) {
          if (error instanceof Error) lastError = error
          if (error instanceof AxiosError && error.status === HttpStatusCode.TooManyRequests) continue

          throw error
        }
      }

      throw lastError ?? new Error('Failed fetching new data')
    })

    this.cache(result)
    return result
  }
}

class MojangDatabase {
  private static readonly MaxAge = 7 * 24 * 60 * 60 * 1000

  private readonly profilesByLoweredName = new Map<string, CachedMojangProfile>()
  private readonly profilesByUuid = new Map<string, CachedMojangProfile>()

  constructor(private readonly databaseManager: DatabaseManager) {}

  public async load(): Promise<void> {
    const rows = await this.databaseManager.queryRows<CachedMojangProfile>(
      'SELECT "uuid", "username", "loweredName", "createdAt" FROM "mojang"'
    )

    this.profilesByLoweredName.clear()
    this.profilesByUuid.clear()
    for (const row of rows) {
      this.profilesByLoweredName.set(row.loweredName, row)
      this.profilesByUuid.set(row.uuid, row)
    }
  }

  public add(profiles: MojangProfile[]): void {
    const createdAt = Math.floor(Date.now() / 1000)
    for (const profile of profiles) {
      const cachedProfile = {
        uuid: profile.id,
        username: profile.name,
        loweredName: profile.name.toLowerCase(),
        createdAt
      }
      this.profilesByLoweredName.set(cachedProfile.loweredName, cachedProfile)
      this.profilesByUuid.set(cachedProfile.uuid, cachedProfile)
    }

    this.databaseManager.enqueueTransaction('caching mojang profiles', async (database) => {
      for (const profile of profiles) {
        await database.query('DELETE FROM "mojang" WHERE "uuid" = $1 OR "loweredName" = $2', [
          profile.id,
          profile.name.toLowerCase()
        ])
        await database.query(
          'INSERT INTO "mojang" ("uuid", "username", "loweredName", "createdAt") VALUES ($1, $2, $3, $4)',
          [profile.id, profile.name, profile.name.toLowerCase(), createdAt]
        )
      }
    })
  }

  public profileByUsername(username: string): MojangProfile | undefined {
    const cached = this.profilesByLoweredName.get(username.toLowerCase())
    if (cached === undefined || cached.createdAt <= Math.floor((Date.now() - MojangDatabase.MaxAge) / 1000)) {
      return undefined
    }

    return { id: cached.uuid, name: cached.username }
  }

  public profileByUuid(uuid: string): MojangProfile | undefined {
    const cached = this.profilesByUuid.get(uuid)
    if (cached === undefined || cached.createdAt <= Math.floor((Date.now() - MojangDatabase.MaxAge) / 1000)) {
      return undefined
    }

    return { id: cached.uuid, name: cached.username }
  }
}

interface CachedMojangProfile {
  uuid: string
  username: string
  loweredName: string
  createdAt: number
}
