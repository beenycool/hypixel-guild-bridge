import type { Client, ClientOptions } from 'minecraft-protocol'

const IAS_CLIENT_ID = '54fd49e4-2103-4044-9603-2b028c814ec3'
const IAS_REDIRECT_URI = 'http://localhost:59125'
const IAS_SCOPE = 'XboxLive.signin XboxLive.offline_access'

const MICROSOFT_TOKEN_URL = 'https://login.live.com/oauth20_token.srf'
const XBOX_LIVE_AUTH_URL = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS_AUTH_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MINECRAFT_LOGIN_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MINECRAFT_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'

const CACHE_REFRESH_TOKEN = 'iasRefreshToken'
const CACHE_MC_TOKEN = 'iasMcToken'
const CACHE_PROFILE = 'iasProfile'

export interface IasAuthCache {
  getCacheSync(name: string, cacheName: string): Record<string, unknown>
  setSession(instanceName: string, name: string, cacheName: string, value: Record<string, unknown>): void
  deleteSingleCache(name: string, cacheName: string): number
}

export interface IasAuthOptions {
  instanceName: string
  cache: IasAuthCache
  onError?: (message: string) => void
}

/* eslint-disable @typescript-eslint/naming-convention -- interface mirrors Microsoft OAuth JSON wire format */
interface MicrosoftTokenResponse {
  token_type: string
  expires_in: number
  scope: string
  access_token: string
  refresh_token: string
  user_id: string
}
/* eslint-enable @typescript-eslint/naming-convention */

/* eslint-disable @typescript-eslint/naming-convention -- interface mirrors Xbox Live API JSON wire format */
interface XboxLiveResponse {
  IssueInstant: string
  NotAfter: string
  Token: string
  DisplayClaims?: {
    xui?: { uhs?: string }[]
  }
}
/* eslint-enable @typescript-eslint/naming-convention */

/* eslint-disable @typescript-eslint/naming-convention -- interface mirrors Minecraft Services JSON wire format */
interface MinecraftLoginResponse {
  access_token: string
  token_type: string
  expires_in: number
}
/* eslint-enable @typescript-eslint/naming-convention */

interface MinecraftProfile {
  id: string
  name: string
  skins: { id: string; state: string; url: string; variant: string }[]
  capes: { id: string; state: string; url: string; alias: string }[]
}

interface StoredMcToken {
  accessToken: string
  expiresAt: number
}

interface StoredProfile {
  id: string
  name: string
}

export function createIasAuthFunction(options: IasAuthOptions): (client: Client, clientOptions: ClientOptions) => void {
  return (client: Client, clientOptions: ClientOptions): void => {
    void authenticate(client, clientOptions, options).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      options.onError?.(message)
      client.emit('error', error instanceof Error ? error : new Error(message))
    })
  }
}

async function authenticate(client: Client, clientOptions: ClientOptions, options: IasAuthOptions): Promise<void> {
  const { instanceName, cache } = options

  const refreshToken = getStoredRefreshToken(cache, instanceName)
  if (!refreshToken) {
    throw new Error('No IAS refresh token found. Use /settings → Minecraft → Import IAS Refresh Token.')
  }

  let mcToken = getStoredMcToken(cache, instanceName)
  let profile = getStoredProfile(cache, instanceName)

  if (!mcToken || Date.now() >= mcToken.expiresAt) {
    const microsoftToken = await refreshMicrosoftToken(refreshToken)

    storeRefreshToken(cache, instanceName, microsoftToken.refresh_token)

    const xblToken = await authenticateXboxLive(microsoftToken.access_token)
    const { token: xstsToken, uhs } = await authorizeXsts(xblToken.Token)
    mcToken = await loginToMinecraft(uhs, xstsToken)

    storeMcToken(cache, instanceName, mcToken)

    profile = undefined
  }

  if (!profile) {
    profile = await fetchMinecraftProfile(mcToken.accessToken)
    storeProfile(cache, instanceName, profile)
  }

  const session = {
    accessToken: mcToken.accessToken,
    selectedProfile: {
      name: profile.name,
      id: profile.id
    },
    availableProfile: [
      {
        name: profile.name,
        id: profile.id
      }
    ]
  }

  client.session = session
  client.username = profile.name
  const authClientOptions = clientOptions as ClientOptions & { accessToken?: string; haveCredentials?: boolean }
  authClientOptions.accessToken = mcToken.accessToken
  authClientOptions.haveCredentials = true

  client.emit('session', session)
  clientOptions.connect?.(client)
}

async function refreshMicrosoftToken(refreshToken: string): Promise<MicrosoftTokenResponse> {
  /* eslint-disable @typescript-eslint/naming-convention -- OAuth form field names required by the protocol */
  const body = new URLSearchParams({
    client_id: IAS_CLIENT_ID,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    redirect_uri: IAS_REDIRECT_URI,
    scope: IAS_SCOPE
  })
  /* eslint-enable @typescript-eslint/naming-convention */

  /* eslint-disable @typescript-eslint/naming-convention -- HTTP header name required by the protocol */
  const response = await fetch(MICROSOFT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  /* eslint-enable @typescript-eslint/naming-convention */

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Microsoft token refresh failed: ${response.status} ${response.statusText} - ${text}`)
  }

  return (await response.json()) as MicrosoftTokenResponse
}

async function authenticateXboxLive(msAccessToken: string): Promise<XboxLiveResponse> {
  /* eslint-disable @typescript-eslint/naming-convention -- Xbox Live API wire format (headers and body field names) */
  const response = await fetch(XBOX_LIVE_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${msAccessToken}`
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    })
  })
  /* eslint-enable @typescript-eslint/naming-convention */

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Xbox Live authentication failed: ${response.status} ${response.statusText} - ${text}`)
  }

  return (await response.json()) as XboxLiveResponse
}

async function authorizeXsts(xblToken: string): Promise<{ token: string; uhs: string }> {
  /* eslint-disable @typescript-eslint/naming-convention -- Xbox Live API wire format (headers and body field names) */
  const response = await fetch(XSTS_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      Properties: {
        SandboxId: 'RETAIL',
        UserTokens: [xblToken]
      },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    })
  })
  /* eslint-enable @typescript-eslint/naming-convention */

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`XSTS authorization failed: ${response.status} ${response.statusText} - ${text}`)
  }

  /* eslint-disable @typescript-eslint/naming-convention -- XSTS error fields mirror Xbox wire format */
  const data = (await response.json()) as XboxLiveResponse & {
    XErr?: number
    Message?: string
    Redirect?: string
  }
  /* eslint-enable @typescript-eslint/naming-convention */

  const uhs = data.DisplayClaims?.xui?.[0]?.uhs
  if (!uhs || !data.Token) {
    throw new Error(`XSTS response missing required fields: ${JSON.stringify(data)}`)
  }

  return { token: data.Token, uhs }
}

async function loginToMinecraft(uhs: string, xstsToken: string): Promise<StoredMcToken> {
  /* eslint-disable @typescript-eslint/naming-convention -- HTTP header names required by the protocol */
  const response = await fetch(MINECRAFT_LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      identityToken: `XBL3.0 x=${uhs};${xstsToken}`
    })
  })
  /* eslint-enable @typescript-eslint/naming-convention */

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Minecraft login failed: ${response.status} ${response.statusText} - ${text}`)
  }

  const data = (await response.json()) as MinecraftLoginResponse

  const expiresInMs = (data.expires_in - 60) * 1000

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs
  }
}

async function fetchMinecraftProfile(accessToken: string): Promise<StoredProfile> {
  /* eslint-disable @typescript-eslint/naming-convention -- HTTP header name required by the protocol */
  const response = await fetch(MINECRAFT_PROFILE_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })
  /* eslint-enable @typescript-eslint/naming-convention */

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Minecraft profile fetch failed: ${response.status} ${response.statusText} - ${text}`)
  }

  const data = (await response.json()) as MinecraftProfile

  if (!data.id || !data.name) {
    throw new Error(`Minecraft profile response missing required fields: ${JSON.stringify(data)}`)
  }

  return {
    id: data.id.replaceAll('-', ''),
    name: data.name
  }
}

function getStoredRefreshToken(cache: IasAuthCache, instanceName: string): string | undefined {
  const data = cache.getCacheSync(instanceName, CACHE_REFRESH_TOKEN)
  return typeof data.token === 'string' ? data.token : undefined
}

function storeRefreshToken(cache: IasAuthCache, instanceName: string, token: string): void {
  cache.setSession(instanceName, instanceName, CACHE_REFRESH_TOKEN, { token })
}

function getStoredMcToken(cache: IasAuthCache, instanceName: string): StoredMcToken | undefined {
  const data = cache.getCacheSync(instanceName, CACHE_MC_TOKEN)
  if (typeof data.accessToken === 'string' && typeof data.expiresAt === 'number') {
    return {
      accessToken: data.accessToken,
      expiresAt: data.expiresAt
    }
  }
  return undefined
}

function storeMcToken(cache: IasAuthCache, instanceName: string, token: StoredMcToken): void {
  cache.setSession(instanceName, instanceName, CACHE_MC_TOKEN, {
    accessToken: token.accessToken,
    expiresAt: token.expiresAt
  })
}

function getStoredProfile(cache: IasAuthCache, instanceName: string): StoredProfile | undefined {
  const data = cache.getCacheSync(instanceName, CACHE_PROFILE)
  if (typeof data.id === 'string' && typeof data.name === 'string') {
    return {
      id: data.id,
      name: data.name
    }
  }
  return undefined
}

function storeProfile(cache: IasAuthCache, instanceName: string, profile: StoredProfile): void {
  cache.setSession(instanceName, instanceName, CACHE_PROFILE, {
    id: profile.id,
    name: profile.name
  })
}
