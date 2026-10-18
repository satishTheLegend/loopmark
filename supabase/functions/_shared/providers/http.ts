import type { z } from 'npm:zod@4.6.7'
import type { ServerConfig } from '../config.ts'
import { boundedJson } from '../limits.ts'
import { DomainError } from '../generated/domain/errors.ts'
export type ProviderConfig = ServerConfig & { requestDeadline?: number }
export class ProviderHttpError extends DomainError {
  constructor(readonly status: number) {
    super(status >= 500 || status === 429 ? 'SERVICE_UNAVAILABLE' : 'NOT_AVAILABLE')
  }
}
export async function providerRequest(
  config: ProviderConfig,
  provider: 'razorpay' | 'revenuecat',
  path: string,
  body?: unknown,
): Promise<unknown> {
  if (!path.startsWith('/') || path.includes('..') || path.includes('#'))
    throw new DomainError('VALIDATION')
  const origin =
    config.billingFixtureUrl ??
    (provider === 'razorpay' ? 'https://api.razorpay.com' : 'https://api.revenuecat.com')
  const authorization =
    provider === 'razorpay'
      ? `Basic ${btoa(`${config.secrets.razorpayKeyId!.reveal()}:${config.secrets.razorpayKey!.reveal()}`)}`
      : `Bearer ${config.secrets.revenueCatApi!.reveal()}`
  const remaining = Math.min(10_000, (config.requestDeadline ?? Date.now() + 10_000) - Date.now())
  if (remaining <= 0) throw new DomainError('SERVICE_UNAVAILABLE')
  let response: Response
  try {
    response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(remaining),
    })
  } catch {
    throw new DomainError('SERVICE_UNAVAILABLE')
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new ProviderHttpError(response.status)
  }
  try {
    return await boundedJson(response, 512 * 1024)
  } catch {
    throw new DomainError('SERVICE_UNAVAILABLE')
  }
}
export async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return Array.from(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}
export function constantEqual(actual: string, expected: string): boolean {
  let mismatch = actual.length ^ expected.length
  for (let i = 0; i < expected.length; i++)
    mismatch |= expected.charCodeAt(i) ^ (actual.charCodeAt(i) ?? 0)
  return mismatch === 0
}

export function providerValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new DomainError('SERVICE_UNAVAILABLE')
  return parsed.data
}
