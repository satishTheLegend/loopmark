import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAccountAuth, credentialStorage } from './auth-service'
import { parsePublicConfig } from '../config'
const config = parsePublicConfig({
  VITE_LOOPMARK_APP_ORIGIN: 'http://localhost:4182',
  VITE_LOOPMARK_SUPABASE_URL: 'http://127.0.0.1:56621',
  VITE_LOOPMARK_SUPABASE_ANON_KEY: 'sb_publishable_1234567890abcdef',
})
const session = {
  accountId: 'owner',
  billingPrincipalId: 'principal',
  deletionGeneration: '0',
  collection: { namespace: 'account_owner', collectionId: 'collection', epoch: 'epoch' },
  device: { id: 'device', generation: 'server-gen' },
  expiresAt: '2030-01-01T00:00:00.000Z',
}
function setup() {
  const methods = {
    getSession: vi.fn(async () => ({
      data: { session: { access_token: 'private-test-token' } },
      error: null,
    })),
    getUser: vi.fn(async () => ({
      data: { user: { id: 'owner', email: 'verified@example.test' } },
      error: null,
    })),
    signInWithOtp: vi.fn(async () => ({ error: null })),
    verifyOtp: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ error: null })),
    stopAutoRefresh: vi.fn(),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  }
  const devices = {
    read: vi.fn(async () => ({ id: 'device' })),
    write: vi.fn(async () => {}),
    readVerified: vi.fn(async () => null),
    writeVerified: vi.fn(async () => {}),
    clearVerified: vi.fn(async () => {}),
  }
  methods.signOut.mockImplementation(async () => {
    methods.getSession.mockImplementation(async () => ({
      data: { session: null as unknown as { access_token: string } },
      error: null,
    }))
    return { error: null }
  })
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(session), { status: 200 }),
  )
  const auth = createAccountAuth({
    config,
    devices,
    client: { auth: methods } as unknown as SupabaseClient,
    fetch: fetcher,
  })
  return { auth, methods, devices, fetcher }
}
it('uses verified identity and account-scoped server device generation instead of submitted email', async () => {
  const { auth, devices, fetcher } = setup()
  expect(
    await auth.verifyCode('typed@example.test', '123456', new AbortController().signal),
  ).toEqual(session)
  expect(await auth.verifiedIdentity()).toEqual({
    accountId: 'owner',
    email: 'verified@example.test',
  })
  expect(devices.read).toHaveBeenCalledWith('owner')
  expect(devices.write).toHaveBeenCalledWith('owner', session.device)
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ deviceId: 'device' })
})
it('fences a delayed verification before local logout and never registers its device', async () => {
  const { auth, methods, devices } = setup()
  let finish!: () => void
  methods.verifyOtp.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ error: null })
      }),
  )
  const verification = auth.verifyCode('maker@example.test', '123456', new AbortController().signal)
  const rejected = expect(verification).rejects.toMatchObject({
    detail: { code: 'ACCOUNT_CHANGED' },
  })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  const logout = auth.signOut()
  finish()
  await rejected
  await logout
  expect(devices.write).not.toHaveBeenCalled()
  expect(methods.signOut).toHaveBeenCalledWith({ scope: 'local' })
})
it('rejects foreign callbacks, token fragments and repeated code before invoking PKCE exchange', async () => {
  const { auth, methods } = setup(),
    signal = new AbortController().signal
  for (const url of [
    'https://evil.test/auth/callback?code=one',
    'http://localhost:4182/auth/callback#access_token=secret',
    'http://localhost:4182/auth/callback?code=one&code=two',
  ])
    await expect(auth.completeCallback(url, signal)).rejects.toMatchObject({
      detail: { code: 'AUTH_CODE_EXPIRED' },
    })
  expect(methods.exchangeCodeForSession).not.toHaveBeenCalled()
  const callback = config.cloud.enabled ? config.cloud.authCallbackUrl : ''
  expect(await auth.completeCallback(callback + '?code=pkce-code', signal)).toEqual(session)
  expect(methods.exchangeCodeForSession).toHaveBeenCalledWith('pkce-code')
})
it('rejects a mismatched server account without persisting the returned device', async () => {
  const { auth, fetcher, devices } = setup()
  fetcher.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          ...session,
          accountId: 'other',
          collection: { ...session.collection, namespace: 'account_other' },
        }),
      ),
  )
  await expect(auth.currentSession(new AbortController().signal)).rejects.toMatchObject({
    detail: { code: 'SYNC_PAGE_INVALID' },
  })
  expect(devices.write).not.toHaveBeenCalled()
})
it('serializes secure-vault key changes and never stores credentials in a preference fallback', async () => {
  let value: string | null = null
  const store = {
    read: async () => value,
    write: async (v: string) => {
      value = v
    },
    clear: async () => {
      value = null
    },
  }
  const storage = credentialStorage(store)
  await Promise.all([storage.setItem('session', 'private'), storage.setItem('verifier', 'pkce')])
  expect(await storage.getItem('session')).toBe('private')
  await storage.removeItem('session')
  expect(await storage.getItem('verifier')).toBe('pkce')
  await storage.removeItem('verifier')
  expect(value).toBeNull()
})
it('the installed Supabase SDK clears durable credentials when remote logout is unavailable', async () => {
  let raw: string | null = null
  const vault = {
    read: async () => raw,
    write: async (value: string) => {
      raw = value
    },
    clear: async () => {
      raw = null
    },
  }
  const storage = credentialStorage(vault)
  const sdkSession = {
    access_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvd25lciIsImV4cCI6NDAwMDAwMDAwMH0.c2ln',
    refresh_token: 'synthetic-refresh',
    token_type: 'bearer',
    expires_at: 4000000000,
    expires_in: 3600,
    user: {
      id: 'owner',
      email: 'verified@example.test',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-01-01T00:00:00.000Z',
    },
  }
  await storage.setItem('loopmark-auth-v2', JSON.stringify(sdkSession))
  const devices = {
    read: async () => ({ id: 'device' }),
    write: async () => {},
    readVerified: async () => null,
    writeVerified: async () => {},
    clearVerified: vi.fn(async () => {}),
  }
  const auth = createAccountAuth({
    config,
    credentials: vault,
    devices,
    fetch: async () =>
      new Response(JSON.stringify({ message: 'unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
  })
  try {
    await auth.signOut()
    expect(raw).toBeNull()
    expect(await auth.accessToken()).toBeNull()
    expect(devices.clearVerified).toHaveBeenCalled()
  } finally {
    auth.dispose()
  }
})
it('a failed vault clear cannot report successful sign-out or discard the verified cache', async () => {
  const { methods, devices } = setup()
  const auth = createAccountAuth({
    config,
    client: { auth: methods } as unknown as SupabaseClient,
    devices,
    credentials: {
      read: async () => null,
      write: async () => {},
      clear: async () => {
        throw new Error('disk fault')
      },
    },
  })
  await expect(auth.signOut()).rejects.toThrow('disk fault')
  expect(devices.clearVerified).not.toHaveBeenCalled()
})
it('cached verified identity is rejected when durable SDK credentials belong to another account', async () => {
  const { methods, devices } = setup()
  devices.readVerified.mockResolvedValue({
    session,
    identity: { accountId: 'owner', email: 'verified@example.test' },
  } as never)
  const other = JSON.stringify({
    'loopmark-auth-v2': JSON.stringify({ user: { id: 'other-owner' } }),
  })
  const auth = createAccountAuth({
    config,
    client: { auth: methods } as unknown as SupabaseClient,
    devices,
    credentials: { read: async () => other, write: async () => {}, clear: async () => {} },
  })
  expect(await auth.cachedSession()).toBeNull()
})
