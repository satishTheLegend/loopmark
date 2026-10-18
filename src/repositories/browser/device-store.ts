import type { DeviceStore } from '../../auth/auth-service'
import { id } from '../../domain/schema'
import { DomainError } from '../../domain/errors'
import { requestResult, transaction } from './schema'
import type { BrowserRepository } from './repository'
export function createBrowserDeviceStore(repository: BrowserRepository): DeviceStore {
  const key = (owner: string) => {
    if (!id.safeParse(owner).success) throw new DomainError('VALIDATION')
    return JSON.stringify(['account-device', owner])
  }
  return {
    async read(owner) {
      return transaction(repository.database, 'readwrite', async (tx) => {
        const address = key(owner),
          row = await requestResult(tx.objectStore('meta').get(address))
        if (row) return row.value
        const value = { id: crypto.randomUUID() }
        tx.objectStore('meta').add({ key: address, value })
        return value
      })
    },
    async write(owner, value) {
      if (!id.safeParse(value.id).success || !id.safeParse(value.generation).success)
        throw new DomainError('VALIDATION')
      await transaction(repository.database, 'readwrite', async (tx) => {
        const address = key(owner),
          row = await requestResult(tx.objectStore('meta').get(address))
        if (!row || row.value.id !== value.id) throw new DomainError('ACCOUNT_CHANGED')
        tx.objectStore('meta').put({ key: address, value })
      })
    },
  }
}
