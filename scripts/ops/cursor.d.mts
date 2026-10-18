import type { OpsContext } from './common.mjs'
export const resumable: Set<string>
export function encodeCursor(
  ctx: OpsContext,
  options: { command: string; target: string },
  jobId: string,
  position?: number | null,
): string
export function decodeCursor(
  ctx: OpsContext,
  options: { command: string; target: string; cursor?: string | null },
): {
  version: 1
  project: string
  command: string
  target: string
  jobId: string
  position: number | null
} | null
