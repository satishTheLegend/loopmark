export type OperatorEnvironment = Readonly<Record<string, string | undefined>>
export type OperatorConfig = Readonly<{
  profile: string
  projectId: string
  worktree: string
  host: '127.0.0.1'
  ports: Readonly<{ app: number; api: number; db: number; studio: number; mail: number }>
  appOrigin: string
  backendUrl: string
}>
export class OperatorConfigurationError extends Error {
  constructor(fields: readonly string[])
}
export function parseOperatorConfig(
  environment?: OperatorEnvironment,
  worktree?: string,
): OperatorConfig
export function loadOperatorConfig(options?: {
  environment?: OperatorEnvironment
  worktree?: string
}): Promise<{ config: OperatorConfig; environment: Record<string, string | undefined> }>
