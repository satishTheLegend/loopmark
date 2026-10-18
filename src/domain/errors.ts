import { errorHelp } from '../help/errors'
import type { Conflict } from './contracts'

export type ErrorCode = keyof typeof errorHelp
export interface SafeError {
  code: ErrorCode
  problem: string
  cause: string
  nextAction: string
  retryable: boolean
  retryAfterMs?: number
  correlationId: string
  helpRef: string
  field?: string
}
export class DomainError extends Error {
  readonly detail: SafeError
  constructor(
    code: ErrorCode,
    options: { retryAfterMs?: number; correlationId?: string; field?: string } = {},
  ) {
    const help = errorHelp[code]
    super(help.problem)
    this.name = 'DomainError'
    this.detail = {
      code,
      ...help,
      correlationId: options.correlationId ?? crypto.randomUUID(),
      ...(options.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: Math.max(0, Math.min(3_600_000, options.retryAfterMs)) }),
      ...(options.field === undefined ? {} : { field: options.field }),
    }
  }
}
export class ConflictError extends DomainError {
  readonly conflict: Conflict
  constructor(conflict: Conflict) {
    super('REVISION_CONFLICT')
    this.name = 'ConflictError'
    this.conflict = conflict
  }
}
export function safeError(error: unknown): SafeError {
  // Never propagate a provider body, URL, token, email or arbitrary exception text.
  return error instanceof DomainError ? error.detail : new DomainError('UNEXPECTED').detail
}
