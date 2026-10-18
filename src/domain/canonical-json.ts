import { DomainError } from './errors'

export function canonicalJson(value: unknown): string {
  const seen = new Set<object>()
  function encode(item: unknown): string {
    if (item === null || typeof item === 'boolean') return JSON.stringify(item)
    if (typeof item === 'string') {
      // Reject isolated UTF-16 surrogates; UTF-8 and PostgreSQL cannot preserve them consistently.
      if (/[\u0000\uD800-\uDFFF]/u.test(item)) throw new DomainError('VALIDATION')
      return JSON.stringify(item)
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new DomainError('VALIDATION')
      return JSON.stringify(item)
    }
    if (typeof item !== 'object' || item === undefined || seen.has(item))
      throw new DomainError('VALIDATION')
    seen.add(item)
    try {
      if (Array.isArray(item)) {
        for (let i = 0; i < item.length; i++) if (!(i in item)) throw new DomainError('VALIDATION')
        return `[${item.map(encode).join(',')}]`
      }
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        throw new DomainError('VALIDATION')
      if (Object.getOwnPropertySymbols(item).length) throw new DomainError('VALIDATION')
      const record = item as Record<string, unknown>
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${encode(key)}:${encode(record[key])}`)
        .join(',')}}`
    } finally {
      seen.delete(item)
    }
  }
  return encode(value)
}
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
export const canonicalHash = (value: unknown) =>
  sha256Bytes(new TextEncoder().encode(canonicalJson(value)))
