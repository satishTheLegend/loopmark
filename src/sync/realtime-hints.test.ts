import { expect, it, vi } from 'vitest'
import { createRealtimeHints } from './realtime-hints'
import type { AccountSession, SessionScope } from '../domain/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
const accountId = '11111111-1111-4111-8111-111111111111'
function setup() {
  const scope: SessionScope = {
    key: { namespace: 'account', collectionId: 'collection', epoch: 'epoch' },
    generation: 1,
    device: { id: 'device', generation: 'generation' },
  }
  const session: AccountSession = {
    accountId,
    billingPrincipalId: 'principal',
    collection: scope.key,
    device: scope.device,
    deletionGeneration: '0',
    expiresAt: '2030-01-01T00:00:00.000Z',
  }
  let bound: { session: AccountSession; scope: SessionScope } | null = { session, scope }
  const callbacks: Record<string, (value: any) => void> = {}
  const channel = {
    on: vi.fn((name: string, _filter: unknown, callback: (value: any) => void) => {
      callbacks[name] = callback
      return channel
    }),
    subscribe: vi.fn(() => {
      queueMicrotask(() => callbacks.system({ extension: 'postgres_changes', status: 'ok' }))
      return channel
    }),
  }
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => {}),
    realtime: { setAuth: vi.fn(async () => {}) },
  }
  const token = vi.fn(async () => 'verified-jwt'),
    hint = vi.fn()
  const service = createRealtimeHints({
    config: {
      guestAvailable: true,
      mediaConcurrency: 2,
      retry: { initialDelayMs: 1000, maxDelayMs: 60000, maxAttemptsPerCycle: 5 },
      cloud: {
        enabled: true,
        url: 'http://127.0.0.1:56621',
        publicKey: 'public',
        authCallbackUrl: 'http://127.0.0.1:56620/auth/callback',
      },
    },
    client: client as unknown as SupabaseClient,
    token,
    current: () => bound,
    onHint: hint,
  })
  const event = {
    new: {
      owner_id: accountId,
      collection_id: 'collection',
      epoch: 'epoch',
      revision: '1',
      nonce: '22222222-2222-4222-8222-222222222222',
    },
  }
  return {
    service,
    client,
    token,
    hint,
    callbacks,
    event,
    scope,
    session,
    setBound: (value: typeof bound) => {
      bound = value
    },
  }
}
it('only exact owned and scoped validated hints invalidate; no craft payload or subscription reply becomes data', async () => {
  const f = setup()
  await f.service.start()
  expect(f.client.realtime.setAuth).toHaveBeenCalledWith('verified-jwt')
  f.callbacks.postgres_changes(f.event)
  expect(f.hint).toHaveBeenCalledOnce()
  for (const patch of [
    { owner_id: '33333333-3333-4333-8333-333333333333' },
    { epoch: 'other' },
    { collection_id: 'other' },
    { revision: '-1' },
    { notes: 'untrusted craft payload' },
  ])
    f.callbacks.postgres_changes({ new: { ...f.event.new, ...patch } })
  expect(f.hint).toHaveBeenCalledOnce()
  f.setBound({ session: { ...f.session, expiresAt: '2031-01-01T00:00:00.000Z' }, scope: f.scope })
  f.callbacks.postgres_changes(f.event)
  expect(f.hint).toHaveBeenCalledTimes(2)
  f.setBound({ session: f.session, scope: { ...f.scope, generation: 2 } })
  f.callbacks.postgres_changes(f.event)
  expect(f.hint).toHaveBeenCalledTimes(2)
  f.service.dispose()
  expect(f.client.removeChannel).toHaveBeenCalledOnce()
})
it('a token completing after account switch never subscribes or replaces realtime authorization', async () => {
  const f = setup()
  let finish!: (value: string) => void
  f.token.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const start = f.service.start()
  f.setBound(null)
  finish('old-account-token')
  await expect(start).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
  expect(f.client.realtime.setAuth).not.toHaveBeenCalled()
  expect(f.client.channel).not.toHaveBeenCalled()
  f.service.dispose()
})
it('stopped channels cannot invalidate a newer selection even if late payloads arrive', async () => {
  const f = setup()
  await f.service.start()
  f.service.stop()
  f.callbacks.postgres_changes(f.event)
  expect(f.hint).not.toHaveBeenCalled()
  f.service.dispose()
})
