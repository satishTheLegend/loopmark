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
  }
  const devices = { read: vi.fn(async () => ({ id: 'device' })), write: vi.fn(async () => {}) }
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
