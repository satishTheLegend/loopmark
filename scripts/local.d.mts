import type { SpawnOptions } from 'node:child_process'
import type { OperatorConfig } from './lib/config.mjs'

export interface LocalContext {
  config: OperatorConfig
  runtime: string
  network: string
}
export function localContext(): Promise<LocalContext>
export function execute(
  command: string,
  args: readonly string[],
  options?: Omit<SpawnOptions, 'stdio'>,
): Promise<{ code: number; stdout: string; stderr: string }>
export function prepare(context: LocalContext): Promise<void>
/** CLI values can include credentials; keep the result private and never log it. */
export function status(context: LocalContext): Promise<Record<string, string>>
export function main(args?: string[]): Promise<void>

export function assertLocalDocker(): Promise<void>
