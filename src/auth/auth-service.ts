import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { AuthPort, CredentialStore } from '../platform/contracts'
import type { AccountSession, DeviceIdentity } from '../domain/contracts'
import { DomainError } from '../domain/errors'
import type { PublicConfig } from '../config'
import { createFunctionClient, type FunctionClient } from '../sync/http-client'
import { accountSessionSchema, reauthenticationSchema } from './schema'

export interface VerifiedIdentity {
  accountId: string
  email: string
}
export interface AccountAuth extends AuthPort {
  verifiedIdentity(): Promise<VerifiedIdentity | null>
  cachedSession(): Promise<{ session: AccountSession; identity: VerifiedIdentity } | null>
  subscribeIdentity(listener: (accountId: string | null) => void): () => void
  accessToken(): Promise<string | null>
  functions: FunctionClient
  completeCallback(url: string, signal: AbortSignal): Promise<AccountSession>
  dispose(): void
}
export interface DeviceStore {
  read(accountId: string): Promise<{ id: string; generation?: string }>
  write(accountId: string, value: DeviceIdentity): Promise<void>
  readVerified(): Promise<{ session: AccountSession; identity: VerifiedIdentity } | null>
  writeVerified(value: { session: AccountSession; identity: VerifiedIdentity }): Promise<void>
  clearVerified(): Promise<void>
}
/** CredentialStore is a secure native vault on native platforms; browser uses its own local storage. */
export function credentialStorage(store: CredentialStore) {
  let queue: Promise<void> = Promise.resolve()
  const read = async () => {
    const value = await store.read()
    if (!value) return {} as Record<string, string>
    try {
      const parsed = JSON.parse(value)
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Object.values(parsed).some((v) => typeof v !== 'string')
      )
        throw new Error()
      return parsed as Record<string, string>
    } catch {
      throw new DomainError('AUTH_REQUIRED')
    }
  }
  const change = (key: string, value: string | null) => {
    const operation = queue.then(async () => {
      const values = await read()
      if (value === null) delete values[key]
      else values[key] = value
      if (Object.keys(values).length) await store.write(JSON.stringify(values))
      else await store.clear()
    })
    queue = operation.catch(() => {})
    return operation
  }
  return {
    async getItem(key: string) {
      await queue
      return (await read())[key] ?? null
    },
    setItem: (key: string, value: string) => change(key, value),
    removeItem: (key: string) => change(key, null),
  }
}
export function createAccountAuth(options: {
  config: PublicConfig
  devices: DeviceStore
  credentials?: CredentialStore
  client?: SupabaseClient
  fetch?: typeof fetch
}): AccountAuth {
  if (!options.config.cloud.enabled) throw new DomainError('CAPABILITY_UNAVAILABLE')
  const cloud = options.config.cloud
  const credentials =
    options.credentials ??
    (options.client
      ? undefined
      : {
          read: async () => {
            try {
              return localStorage.getItem('loopmark-credentials-v2')
            } catch {
              throw new DomainError('LOCAL_STORAGE_FAILED')
            }
          },
          write: async (value: string) => {
            try {
              localStorage.setItem('loopmark-credentials-v2', value)
              if (localStorage.getItem('loopmark-credentials-v2') !== value) throw new Error()
            } catch {
              throw new DomainError('LOCAL_STORAGE_FAILED')
            }
          },
          clear: async () => {
            try {
              localStorage.removeItem('loopmark-credentials-v2')
              if (localStorage.getItem('loopmark-credentials-v2') !== null) throw new Error()
            } catch {
              throw new DomainError('LOCAL_STORAGE_FAILED')
            }
          },
        })
  const client =
    options.client ??
    createClient(cloud.url, cloud.publicKey, {
      auth: {
        flowType: 'pkce',
        experimental: { appendPkceFlowIdToRedirects: true },
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'loopmark-auth-v2',
        ...(credentials ? { storage: credentialStorage(credentials) } : {}),
      },
      ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
    })
  let generation = 0,
    identity: VerifiedIdentity | null = null,
    queue: Promise<void> = Promise.resolve()
  const listeners = new Set<(accountId: string | null) => void>()
  const subscription = client.auth.onAuthStateChange((_event, value) => {
    const accountId = value?.user.id ?? null
    if (identity && accountId !== identity.accountId) {
      generation++
      identity = null
    }
    for (const listener of listeners) listener(accountId)
  }).data.subscription
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work)
    queue = result.then(
      () => {},
      () => {},
    )
    return result
  }
  const assert = (expected: number, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    if (expected !== generation) throw new DomainError('ACCOUNT_CHANGED')
  }
  const token = async () => {
    const { data, error } = await client.auth.getSession()
    if (error) throw new DomainError('AUTH_REQUIRED')
    return data.session?.access_token ?? null
  }
  const functions = createFunctionClient({
    url: cloud.url,
    publicKey: cloud.publicKey,
    token,
    fetch: options.fetch,
  })
  async function verified(): Promise<VerifiedIdentity | null> {
    const expected = generation
    const { data, error } = await client.auth.getUser()
    assert(expected)
    if (error) {
      if (!error.status || error.status >= 500) throw new DomainError('OFFLINE')
      identity = null
      return null
    }
    if (!data.user) {
      identity = null
      return null
    }
    if (!data.user.email || !z.email().safeParse(data.user.email).success)
      throw new DomainError('AUTH_REQUIRED')
    identity = { accountId: data.user.id, email: data.user.email }
    return identity
  }
  async function account(signal: AbortSignal, expected: number): Promise<AccountSession> {
    assert(expected, signal)
    const owner = await verified()
    assert(expected, signal)
    if (!owner) throw new DomainError('AUTH_REQUIRED')
    const device = await options.devices.read(owner.accountId)
    assert(expected, signal)
    const parsed = accountSessionSchema.safeParse(
      await functions.post(
        'account-session',
        {
          deviceId: device.id,
          ...(device.generation ? { deviceGeneration: device.generation } : {}),
        },
        signal,
      ),
    )
    assert(expected, signal)
    if (
      !parsed.success ||
      parsed.data.accountId !== owner.accountId ||
      parsed.data.device.id !== device.id
    )
      throw new DomainError('SYNC_PAGE_INVALID')
    await options.devices.write(owner.accountId, parsed.data.device)
    assert(expected, signal)
    await options.devices.writeVerified({ session: parsed.data, identity: owner })
    assert(expected, signal)
    return parsed.data
  }
  return {
    functions,
    async cachedSession() {
      const cached = await options.devices.readVerified()
      if (!cached) return null
      if (credentials) {
        const value = await credentialStorage(credentials).getItem('loopmark-auth-v2')
        try {
          if (!value || JSON.parse(value)?.user?.id !== cached.identity.accountId) return null
        } catch {
          return null
        }
      }
      return cached
    },
    subscribeIdentity(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    verifiedIdentity: verified,
    accessToken: token,
    requestCode(email, signal) {
      return serial(async () => {
        const expected = generation
        assert(expected, signal)
        if (!z.email().max(254).safeParse(email).success)
          throw new DomainError('VALIDATION', { field: 'email' })
        const { error } = await client.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: cloud.authCallbackUrl, shouldCreateUser: true },
        })
        assert(expected, signal)
        if (error)
          throw new DomainError(error.status === 429 ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE', {
            retryAfterMs: 60000,
          })
        return { retryAt: new Date(Date.now() + 60000).toISOString() }
      })
    },
    verifyCode(email, code, signal) {
      const expected = generation
      return serial(async () => {
        assert(expected, signal)
        if (!z.email().max(254).safeParse(email).success || !/^\d{6}$/.test(code))
          throw new DomainError('VALIDATION')
        const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' })
        assert(expected, signal)
        if (error)
          throw new DomainError(error.status === 429 ? 'RATE_LIMITED' : 'AUTH_CODE_EXPIRED')
        return account(signal, expected)
      })
    },
    currentSession(signal) {
      const expected = generation
      return serial(async () => {
        assert(expected, signal)
        if (!(await token())) return null
        return account(signal, expected)
      })
    },
    reauthenticate(code, signal) {
      const expected = generation
      return serial(async () => {
        assert(expected, signal)
        if (!/^\d{6}$/.test(code)) throw new DomainError('VALIDATION')
        const parsed = reauthenticationSchema.safeParse(
          await functions.post('account-session', { action: 'reauthenticate', code }, signal),
        )
        assert(expected, signal)
        if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now())
          throw new DomainError('SYNC_PAGE_INVALID')
        return parsed.data
      })
    },
    signOut() {
      generation++
      identity = null
      return serial(async () => {
        client.auth.stopAutoRefresh()
        // This installed SDK clears on remote logout errors, but an early refresh failure can bypass it.
        await client.auth.signOut({ scope: 'local' })
        if (credentials) {
          await credentials.clear()
          if ((await credentials.read()) !== null) throw new DomainError('LOCAL_STORAGE_FAILED')
        }
        const remaining = await client.auth.getSession()
        if (remaining.error || remaining.data.session) throw new DomainError('LOCAL_STORAGE_FAILED')
        await options.devices.clearVerified()
      })
    },
    completeCallback(value, signal) {
      const expected = generation
      return serial(async () => {
        assert(expected, signal)
        let url: URL
        try {
          url = new URL(value)
        } catch {
          throw new DomainError('VALIDATION')
        }
        const allowed = new URL(cloud.authCallbackUrl)
        if (
          url.origin !== allowed.origin ||
          url.pathname !== allowed.pathname ||
          url.username ||
          url.password ||
          url.hash ||
          [...url.searchParams.keys()].some((k) => k !== 'code' && k !== 'sb_flow_id') ||
          url.searchParams.getAll('code').length !== 1 ||
          url.searchParams.getAll('sb_flow_id').length > 1
        )
          throw new DomainError('AUTH_CODE_EXPIRED')
        const code = url.searchParams.get('code'),
          flowId = url.searchParams.get('sb_flow_id')
        if (flowId !== null && !/^[a-f0-9]{32}$/.test(flowId))
          throw new DomainError('AUTH_CODE_EXPIRED')
        if (!code || code.length > 2048 || code.includes('\u0000'))
          throw new DomainError('AUTH_CODE_EXPIRED')
        // SDK exchanges only with its locally stored PKCE verifier; callback query never contains a bearer token.
        const { error } = await (flowId
          ? client.auth.exchangeCodeForSession(code, { flowId })
          : client.auth.exchangeCodeForSession(code))
        assert(expected, signal)
        if (error) throw new DomainError('AUTH_CODE_EXPIRED')
        return account(signal, expected)
      })
    },
    dispose() {
      generation++
      client.auth.stopAutoRefresh()
      subscription.unsubscribe()
      listeners.clear()
    },
  }
}
