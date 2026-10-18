import type { OpsContext } from './common.mjs'
export const compatibleRevision: string
export function rollbackCheck(
  ctx: OpsContext,
  options?: { verify?: (phase: 'previous' | 'current') => Promise<void>; signal?: AbortSignal },
): Promise<{
  id: string
  compatibleRevision: string
  currentHash: string
  previousHash: string
  ready: boolean
  restoredCurrent: boolean
  elapsedMs: number
  oneHourTargetMet: boolean
}>

export function rollbackResume(ctx: OpsContext): Promise<{ restoredCurrent: boolean; id: string }>
