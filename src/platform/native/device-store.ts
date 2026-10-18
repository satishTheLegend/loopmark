import type { DeviceStore } from '../../auth/auth-service'
import { accountSessionSchema } from '../../auth/schema'
import { z } from 'zod'
import { id } from '../../domain/schema'
import { DomainError } from '../../domain/errors'
import type { NativeRepository } from './repository'

const cachedSchema = z
  .object({
    session: accountSessionSchema,
    identity: z.object({ accountId: id, email: z.email() }).strict(),
  })
  .strict()
  .refine((value) => value.session.accountId === value.identity.accountId)
export function createNativeDeviceStore(repository: NativeRepository): DeviceStore {
  const key = (owner: string) => {
    if (!id.safeParse(owner).success) throw new DomainError('VALIDATION')
    return `account-device:${owner}`
  }
  return {
    async readVerified() {
      return repository.database.serial(async (db) => {
        const row = (await db.query("SELECT body FROM metadata WHERE key='verified-account'"))
          .values?.[0]
        if (!row) return null
        const value = cachedSchema.safeParse(JSON.parse(row.body as string))
        if (!value.success) throw new DomainError('AUTH_REQUIRED')
        return value.data
      })
    },
    async writeVerified(value) {
      const parsed = cachedSchema.safeParse(value)
      if (!parsed.success) throw new DomainError('AUTH_REQUIRED')
      await repository.database.transaction(async (db) => {
        await db.run(
          "INSERT OR REPLACE INTO metadata(key,body) VALUES('verified-account',?)",
          [JSON.stringify(parsed.data)],
          false,
        )
      })
    },
    async clearVerified() {
      await repository.database.transaction(async (db) => {
        await db.run("DELETE FROM metadata WHERE key='verified-account'", [], false)
      })
    },
    async read(owner) {
      return repository.database.transaction(async (db) => {
        const address = key(owner)
        const row = (await db.query('SELECT body FROM metadata WHERE key=?', [address])).values?.[0]
        if (row) return JSON.parse(row.body as string) as { id: string; generation?: string }
        const value = { id: crypto.randomUUID() }
        await db.run(
          'INSERT INTO metadata(key,body) VALUES(?,?)',
          [address, JSON.stringify(value)],
          false,
        )
        return value
      })
    },
    async write(owner, value) {
      if (!id.safeParse(value.id).success || !id.safeParse(value.generation).success)
        throw new DomainError('VALIDATION')
      await repository.database.transaction(async (db) => {
        const address = key(owner)
        const row = (await db.query('SELECT body FROM metadata WHERE key=?', [address])).values?.[0]
        if (!row || (JSON.parse(row.body as string) as { id: string }).id !== value.id)
          throw new DomainError('ACCOUNT_CHANGED')
        await db.run(
          'UPDATE metadata SET body=? WHERE key=?',
          [JSON.stringify(value), address],
          false,
        )
      })
    },
  }
}
