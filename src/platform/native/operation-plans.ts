import type { SessionScope } from '../../domain/contracts'
import type { OperationPlan, OperationPlanStore } from '../../services/operation-plans'
import { canonicalJson } from '../../domain/canonical-json'
import { DomainError } from '../../domain/errors'
import { hashSchema, id } from '../../domain/schema'
import { intentCommand, mediaRefs } from '../../repositories/state'
import type { NativeRepository } from './repository'
import { assertGeneration, scopeKey } from './recovery-journal'

const address = (scope: SessionScope, operationId: string) =>
  `operation-plan:${scopeKey(scope.key)}:${operationId}`

export function createNativeOperationPlanStore(repository: NativeRepository): OperationPlanStore {
  return {
    async read(scope, operationId) {
      return repository.database.serial(async (db) => {
        await assertGeneration(db, scope.key, scope.generation, true)
        const row = (
          await db.query('SELECT body FROM metadata WHERE key=?', [address(scope, operationId)])
        ).values?.[0]
        return row ? (JSON.parse(row.body as string) as OperationPlan) : undefined
      })
    },
    async putIfAbsent(scope, plan) {
      if (
        !id.safeParse(plan.operationId).success ||
        !hashSchema.safeParse(plan.inputHash).success ||
        plan.intent.operationId !== plan.operationId
      )
        throw new DomainError('VALIDATION')
      intentCommand(plan.intent)
      return repository.database.transaction(async (db) => {
        await assertGeneration(db, scope.key, scope.generation, true)
        const key = address(scope, plan.operationId)
        const row = (await db.query('SELECT body FROM metadata WHERE key=?', [key])).values?.[0]
        if (row) {
          const existing = JSON.parse(row.body as string) as OperationPlan
          if (existing.inputHash !== plan.inputHash) throw new DomainError('OPERATION_REUSED')
          return existing
        }
        const collection = (
          await db.query('SELECT body FROM collections WHERE key=?', [scopeKey(scope.key)])
        ).values![0]
        const committed = Object.hasOwn(
          (JSON.parse(collection.body as string) as { operations: Record<string, unknown> })
            .operations,
          plan.operationId,
        )
        const refs = committed
          ? []
          : plan.intent.kind === 'checkpoint.create'
            ? mediaRefs([{ ...plan.intent.payload.checkpoint, revision: '0' }])
            : plan.intent.kind === 'media.attach'
              ? [plan.intent.payload.media]
              : []
        for (const ref of refs) {
          const saved = (
            await db.query('SELECT body FROM media WHERE scope=? AND id=?', [
              scopeKey(scope.key),
              ref.id,
            ])
          ).values?.[0]
          if (!saved || canonicalJson(JSON.parse(saved.body as string)) !== canonicalJson(ref))
            throw new DomainError('BACKUP_INCOMPLETE')
          await db.run(
            'INSERT INTO pins(owner,scope,media_id) VALUES(?,?,?)',
            [`operation-plan:${plan.operationId}`, scopeKey(scope.key), ref.id],
            false,
          )
        }
        await db.run(
          'INSERT INTO metadata(key,body) VALUES(?,?)',
          [key, canonicalJson(plan)],
          false,
        )
        return plan
      })
    },
  }
}
