import { Capacitor } from '@capacitor/core'
import type { BoundaryResult } from '../../domain/contracts'
import { DomainError, safeError } from '../../domain/errors'

export const cancelled = (): BoundaryResult<never> => ({
  status: 'cancelled',
  mayHaveCommitted: false,
})
export function requireNative() {
  if (!Capacitor.isNativePlatform()) throw new DomainError('CAPABILITY_UNAVAILABLE')
}
export function nativeFailure(error: unknown): BoundaryResult<never> {
  const message =
    error && typeof error === 'object' && 'message' in error ? String(error.message) : ''
  if (/\bcancel(?:l)?ed\b/i.test(message)) return cancelled()
  if (/\b(denied|not granted|permission)\b/i.test(message))
    return { status: 'rejected', error: new DomainError('PERMISSION_DENIED').detail }
  const detail = safeError(error)
  return {
    status:
      detail.code === 'CAPABILITY_UNAVAILABLE'
        ? 'unavailable'
        : detail.retryable
          ? 'retryable'
          : 'rejected',
    error: detail,
  }
}
