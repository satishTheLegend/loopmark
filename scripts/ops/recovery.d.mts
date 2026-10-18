import type { OpsContext } from './common.mjs'
export function backupSnapshot(
  ctx: OpsContext,
  options?: { id?: string; signal?: AbortSignal; beforeCopy?: () => Promise<void> },
): Promise<any>
export function verifyPoint(ctx: OpsContext, id: string): Promise<any>
export function expirePoints(ctx: OpsContext, limit?: number, now?: number): Promise<number>
export function replayErasure(
  ctx: OpsContext,
  inventory: { watermark: string; entries: any[] },
  database?: string,
  signal?: AbortSignal,
): Promise<void>
export function restoreCheck(
  ctx: OpsContext,
  id: string,
  options?: {
    signal?: AbortSignal
    inspect?: (result: any) => Promise<void>
    ledgerReader?: (ctx: OpsContext) => Promise<{ watermark: string; entries: any[] }>
  },
): Promise<any>
export function recoveredBytes(ctx: OpsContext, result: any, objectKey: string): Promise<Buffer>

export function cleanupDrill(ctx: OpsContext, id: string): Promise<void>
export function cleanupExpiredDrills(ctx: OpsContext, limit?: number, now?: number): Promise<number>
