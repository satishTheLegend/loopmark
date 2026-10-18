import type { DeviceStore } from '../../auth/auth-service'
import { accountSessionSchema } from '../../auth/schema'
import { z } from 'zod'
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
    async readVerified() {
      return transaction(repository.database, 'readonly', async (tx) => {
        const row = await requestResult(tx.objectStore('meta').get('verified-account'))
        if (!row) return null
        const session = accountSessionSchema.safeParse(row.value.session),
          identity = z
            .object({ accountId: id, email: z.email() })
            .strict()
            .safeParse(row.value.identity)
        if (
          !session.success ||
          !identity.success ||
          session.data.accountId !== identity.data.accountId
        )
          throw new DomainError('AUTH_REQUIRED')
        return { session: session.data, identity: identity.data }
      })
    },
    async writeVerified(value) {
      await transaction(repository.database, 'readwrite', (tx) => {
        tx.objectStore('meta').put({ key: 'verified-account', value })
      })
    },
    async clearVerified() {
      await transaction(repository.database, 'readwrite', (tx) => {
        tx.objectStore('meta').delete('verified-account')
      })
    },
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
