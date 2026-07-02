import { httpClient } from './http.js'

import type { MojangProfile } from './user.js'

interface HypixelProfilesResponse {
  success: boolean
  profiles?: HypixelProfileData[]
}

interface HypixelProfileData {
  profileId: string
  selected: boolean
  members: Record<string, Record<string, unknown> | undefined>
}

interface HypixelMuseumResponse {
  members?: Record<string, Record<string, unknown>>
}

interface HypixelGardenResponse {
  garden?: Record<string, unknown>
}

interface CachedData<T> {
  data: T
  lastSave: number
}

interface MojangLookup {
  profileByUuid: (uuid: string) => Promise<MojangProfile>
  profileByUsername: (username: string) => Promise<MojangProfile>
}

const Cache = new Map<string, CachedData<unknown>>()

export class HypixelRawApi {
  constructor(
    private readonly apiKey: string,
    private readonly mojangApi: MojangLookup
  ) {}

  async getLatestProfile(
    input: string,
    options: { museum?: boolean; garden?: boolean } = {}
  ): Promise<Record<string, unknown>> {
    let uuid = input
    let username = input

    // Resolve UUID/Username
    if (this.isUuid(input)) {
      const profile = await this.mojangApi.profileByUuid(input)
      if (!profile) {
        throw new Error(`Player not found: ${input}`)
      }
      username = profile.name
    } else {
      const profile = await this.mojangApi.profileByUsername(input)
      if (!profile) {
        throw new Error(`Player not found: ${input}`)
      }
      uuid = profile.id
      username = profile.name
    }

    // Check Cache
    if (Cache.has(uuid)) {
      const Cached = Cache.get(uuid)
      if (Cached && Cached.lastSave + 5 * 60 * 1000 > Date.now()) {
        return Cached.data as Record<string, unknown>
      }
    }

    // Fetch Profiles
    const response = await httpClient
      .get<HypixelProfilesResponse>(`https://api.hypixel.net/v2/skyblock/profiles`, {
        params: { key: this.apiKey, uuid }
      })
      .catch((error: unknown) => {
        const axiosError = error as { response?: { data?: { cause?: string } } } | undefined
        const cause = axiosError?.response?.data?.cause
        throw new Error(cause ?? 'Request to Hypixel API failed.')
      })

    if (!response.data.success) {
      throw new Error('Request to Hypixel API failed.')
    }

    const profiles = response.data.profiles
    if (!profiles || profiles.length === 0) {
      throw new Error('Player has no SkyBlock profiles.')
    }

    const profileData = profiles.find((p) => p.selected)
    if (profileData == undefined) {
      throw new Error('Player does not have a selected profile.')
    }

    const profile = profileData.members[uuid]
    if (!profile) {
      throw new Error('Player is not in this Skyblock profile.')
    }

    const output: Record<string, unknown> = {
      username: username,
      rawUsername: username,
      ['last_save']: Date.now(),
      profiles: profiles,
      profile: profile,
      profileData: profileData,
      uuid: uuid
    }

    if (options.museum) {
      const museum = await this.getMuseum(profileData.profileId, uuid)
      Object.assign(output, museum)
    }

    if (options.garden) {
      const garden = await this.getGarden(profileData.profileId)
      Object.assign(output, garden)
    }

    Cache.set(uuid, { data: output, lastSave: Date.now() })
    return output
  }

  async getMuseum(profileId: string, uuid: string): Promise<Record<string, unknown>> {
    const CacheKey = `museum-${profileId}`
    if (Cache.has(CacheKey)) {
      const Cached = Cache.get(CacheKey)
      if (Cached && Cached.lastSave + 5 * 60 * 1000 > Date.now()) {
        return Cached.data as Record<string, unknown>
      }
    }

    try {
      const { data } = await httpClient.get<HypixelMuseumResponse>(`https://api.hypixel.net/v2/skyblock/museum`, {
        params: { key: this.apiKey, profile: profileId }
      })

      const result = {
        museum: data.members?.[uuid] ?? undefined,
        museumData: data.members ?? undefined
      }

      Cache.set(CacheKey, { data: result, lastSave: Date.now() })
      return result
    } catch {
      return { museum: undefined, museumData: undefined }
    }
  }

  async getGarden(profileId: string): Promise<Record<string, unknown>> {
    const CacheKey = `garden-${profileId}`
    if (Cache.has(CacheKey)) {
      const Cached = Cache.get(CacheKey)
      if (Cached && Cached.lastSave + 5 * 60 * 1000 > Date.now()) {
        return Cached.data as Record<string, unknown>
      }
    }

    try {
      const { data } = await httpClient.get<HypixelGardenResponse>(`https://api.hypixel.net/v2/skyblock/garden`, {
        params: { key: this.apiKey, profile: profileId }
      })

      const result = { garden: data.garden ?? undefined }
      Cache.set(CacheKey, { data: result, lastSave: Date.now() })
      return result
    } catch {
      return { garden: undefined }
    }
  }

  private isUuid(input: string): boolean {
    return /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(input)
  }
}
