import { Capacitor } from '@capacitor/core'
import { SecureStorage, KeychainAccess } from '@aparajita/capacitor-secure-storage'
import type { CredentialStore } from '../contracts'
import { DomainError } from '../../domain/errors'

const KEY = 'refresh-session'
const PREFIX = 'app.loopmark.session.'
let queue: Promise<unknown> = Promise.resolve()
export class NativeCredentialStore implements CredentialStore {
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(async () => {
      if (!Capacitor.isNativePlatform()) throw new DomainError('NOT_AVAILABLE')
      await SecureStorage.setKeyPrefix(PREFIX)
      await SecureStorage.setSynchronize(false)
      await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly)
      return operation()
    })
    queue = result.catch(() => undefined)
    return result
  }
  read(): Promise<string | null> {
    return this.run(async () => {
      try {
        const value = await SecureStorage.get(KEY, false, false)
        if (value !== null && typeof value !== 'string') throw new DomainError('AUTH_REQUIRED')
        return value
      } catch {
        throw new DomainError('AUTH_REQUIRED')
      }
    })
  }
  write(value: string): Promise<void> {
    if (!value || value.length > 32768) return Promise.reject(new DomainError('VALIDATION'))
    return this.run(() =>
      SecureStorage.set(KEY, value, false, false, KeychainAccess.whenUnlockedThisDeviceOnly),
    )
  }
  clear(): Promise<void> {
    return this.run(async () => {
      await SecureStorage.remove(KEY, false)
    })
  }
}
