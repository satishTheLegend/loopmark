import { z } from 'zod'
import { collectionKeySchema, id } from '../domain/schema'
import { canonicalHash, canonicalJson } from '../domain/canonical-json'
import { DomainError } from '../domain/errors'
import type { SessionScope } from '../domain/contracts'
import type { WorkflowStore } from '../services/workflow-store'
import type { PurchaseAction } from './coordinator'

const schema = z
  .object({
    type: z.literal('upgrade-prompt'),
    version: z.literal(1),
    collection: collectionKeySchema,
    operationToken: z.uuid(),
    returnAction: z.enum(['new-project', 'reopen-project', 'settings']),
    draftKey: z.string().min(1).max(200).optional(),
    projectId: id.optional(),
  })
  .strict()
export type UpgradePrompt = z.infer<typeof schema>

/** Device-local navigation only. The local owner namespace is never an account or purchase grant. */
export function createUpgradePrompts(options: { workflows: WorkflowStore; scope(): SessionScope }) {
  const location = async () => {
    const scope = options.scope(),
      hash = (await canonicalHash(scope.key)).slice(0, 48)
    return { scope, id: `upgrade_${hash}`, owner: `local_${hash}` }
  }
  return {
    async read(): Promise<UpgradePrompt | null> {
      const at = await location(),
        row = await options.workflows.read<UpgradePrompt>(at.id)
      if (canonicalJson(options.scope()) !== canonicalJson(at.scope))
        throw new DomainError('ACCOUNT_CHANGED')
      if (!row) return null
      if (
        row.accountId !== at.owner ||
        !schema.safeParse(row.value).success ||
        canonicalJson(row.value.collection) !== canonicalJson(at.scope.key)
      )
        throw new DomainError('VALIDATION')
      return row.value
    },
    async save(action: PurchaseAction): Promise<UpgradePrompt> {
      const at = await location(),
        old = await options.workflows.read<UpgradePrompt>(at.id)
      const value = schema.parse({
        ...action,
        type: 'upgrade-prompt',
        version: 1,
        collection: at.scope.key,
        operationToken: crypto.randomUUID(),
      })
      await options.workflows.write(
        at.id,
        old?.revision ?? null,
        {
          kind: 'purchase',
          accountId: at.owner,
          collection: at.scope.key,
          value,
        },
        at.scope,
      )
      return value
    },
    async clear() {
      const at = await location(),
        row = await options.workflows.read(at.id)
      if (row) await options.workflows.remove(at.id, row.revision, at.scope)
    },
  }
}
