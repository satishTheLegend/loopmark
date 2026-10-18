import type { PurchaseGrant, PurchaseEnvironment } from './contracts'
import { DomainError } from './errors'
import { supportedMediaType } from './media-contract'

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024
export const MAX_LIBRARY_BYTES = 48 * 1024 * 1024
export const MAX_PROJECTS = 200
export const MAX_CHECKPOINTS = 1000
export const FREE_ACTIVE_PROJECTS = 3
export const LIMITS = Object.freeze({
  photoBytes: 4 * 1024 * 1024,
  voiceBytes: 8 * 1024 * 1024,
  uploads: 4,
  stagedBytes: 32 * 1024 * 1024,
  uploadLeaseMs: 15 * 60_000,
  uploadRequestMs: 60_000,
  replacementCandidates: 1,
  replacementMediaBytes: 40 * 1024 * 1024,
  replacementMetadataBytes: 8 * 1024 * 1024,
  replacementPhysicalBytes: 80 * 1024 * 1024,
  snapshotLeaseMs: 3_600_000,
  snapshots: 2,
  devices: 10,
  retentionDays: 90,
  pullEntries: 50,
  pullBytes: 512 * 1024,
  commandBytes: 256 * 1024,
  commandsPerMinute: 60,
  commandBurst: 20,
  webhookBytes: 256 * 1024,
  workerBatch: 20,
  workerConcurrency: 4,
})
export interface Capacity {
  projects: number
  checkpoints: number
  portableBytes: number
}
export function assertCapacity(value: Capacity): void {
  if (Object.values(value).some((n) => !Number.isSafeInteger(n) || n < 0))
    throw new DomainError('VALIDATION')
  if (
    value.projects > MAX_PROJECTS ||
    value.checkpoints > MAX_CHECKPOINTS ||
    value.portableBytes > MAX_LIBRARY_BYTES
  )
    throw new DomainError('TECHNICAL_CAPACITY_REACHED')
}
export type CapacityAction =
  'create' | 'reopen' | 'finish' | 'delete' | 'read' | 'export' | 'checkpoint' | 'edit'
export function assertActiveCapacity(input: {
  action: CapacityAction
  activeProjects: number
  upgraded: boolean
  connected: boolean
  legacyLocalAccess: boolean
}): void {
  if (!Number.isSafeInteger(input.activeProjects) || input.activeProjects < 0)
    throw new DomainError('VALIDATION')
  if (input.action !== 'create' && input.action !== 'reopen') return
  if (input.upgraded || (!input.connected && input.legacyLocalAccess)) return
  if (input.activeProjects >= FREE_ACTIVE_PROJECTS) throw new DomainError('UPGRADE_REQUIRED')
}
// Caller must supply verified server records. SDK flags/imported data never enter this calculation.
export function deriveUpgrade(
  grants: readonly PurchaseGrant[],
  principalId: string,
  environment: PurchaseEnvironment,
): boolean {
  return grants.some(
    (g) =>
      g.billingPrincipalId === principalId && g.environment === environment && g.state === 'valid',
  )
}
export const utf8Bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength
export function portableMediaBytes(binaryBytes: number, mimeType: string): number {
  if (!Number.isSafeInteger(binaryBytes) || binaryBytes < 0 || !supportedMediaType(mimeType))
    throw new DomainError('VALIDATION')
  // Whole JSON string value, including quotes and escaped codec quotes. Base64 needs no escaping.
  return 4 * Math.ceil(binaryBytes / 3) + utf8Bytes(`data:${mimeType};base64,`)
}
