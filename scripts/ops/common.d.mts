import type { LocalContext } from '../local.mjs'
export interface OpsContext extends LocalContext {
  url: string
  key: string
  database: string
  recovery: string
  keyPath: string
}
export class OpsError extends Error {
  code: string
  constructor(code?: string)
}
export const uuid: RegExp
export function hash(value: string | Uint8Array): string
export function quote(value: unknown): string
export function context(): Promise<OpsContext>
export function sql(ctx: OpsContext, statement: string, database?: string): Promise<string>
export function run(
  command: string,
  args: string[],
  options?: {
    input?: string | Uint8Array
    timeout?: number
    maxBytes?: number
    signal?: AbortSignal
  },
): Promise<Buffer>
export function rpc(ctx: OpsContext, name: string, args?: Record<string, unknown>): Promise<any>
export function job(ctx: OpsContext, action: string, limit: number, target?: string): Promise<any>
export function durableJson(path: string, value: unknown): Promise<void>
export function readJson(path: string): Promise<any>
export function ledger(ctx: OpsContext, path: string, body: unknown): Promise<any>
export function currentLedger(ctx: OpsContext): Promise<{ watermark: string; entries: any[] }>
