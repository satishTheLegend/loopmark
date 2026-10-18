import { beforeEach, expect, test, vi } from 'vitest'
const fixture = vi.hoisted(() => ({
  native: true,
  store: new Map<string, unknown>(),
  calls: [] as unknown[][],
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => fixture.native } }))
vi.mock('@aparajita/capacitor-secure-storage', () => ({
  KeychainAccess: { whenUnlockedThisDeviceOnly: 1 },
  SecureStorage: {
    setKeyPrefix: async (value: string) => {
      fixture.calls.push(['prefix', value])
    },
    setSynchronize: async (value: boolean) => {
      fixture.calls.push(['sync', value])
    },
    setDefaultKeychainAccess: async (value: number) => {
      fixture.calls.push(['access', value])
    },
    get: async (key: string) => fixture.store.get(key) ?? null,
    set: async (...args: unknown[]) => {
      fixture.calls.push(args)
      fixture.store.set(args[0] as string, args[1])
    },
    remove: async (key: string) => fixture.store.delete(key),
  },
}))
import { NativeCredentialStore } from './session-storage'
beforeEach(() => {
  fixture.native = true
  fixture.calls = []
  fixture.store.clear()
})
test('refuses every credential operation on web before reaching plaintext fallback', async () => {
  fixture.native = false
  const store = new NativeCredentialStore()
  await expect(store.read()).rejects.toThrow()
  await expect(store.write('token')).rejects.toThrow()
  await expect(store.clear()).rejects.toThrow()
  expect(fixture.calls).toEqual([])
})
test('uses only scoped, nonsynchronizing, device-bound session entries', async () => {
  const store = new NativeCredentialStore()
  await store.write('synthetic-token')
  expect(await store.read()).toBe('synthetic-token')
  expect(fixture.calls).toContainEqual(['prefix', 'app.loopmark.session.'])
  expect(fixture.calls).toContainEqual(['sync', false])
  expect(fixture.calls).toContainEqual(['refresh-session', 'synthetic-token', false, false, 1])
  fixture.store.set('unrelated', 'preserve')
  await store.clear()
  expect(await store.read()).toBeNull()
  expect(fixture.store.get('unrelated')).toBe('preserve')
})
test('corrupt or key-unavailable values require sign-in without echoing secrets', async () => {
  fixture.store.set('refresh-session', { damaged: 'secret' })
  await expect(new NativeCredentialStore().read()).rejects.toMatchObject({
    detail: { code: 'AUTH_REQUIRED' },
  })
})
