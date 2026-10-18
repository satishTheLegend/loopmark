import { z } from 'zod'

export type ConfigIssue = Readonly<{ field: string; problem: string }>

/** Never include input values: this error can safely reach diagnostics or the UI. */
export class ConfigurationError extends Error {
  readonly issues: readonly ConfigIssue[]
  constructor(issues: readonly ConfigIssue[]) {
    super(
      `Configuration is invalid: ${issues.map(({ field, problem }) => `${field}: ${problem}`).join('; ')}`,
    )
    this.name = 'ConfigurationError'
    this.issues = issues
  }
}

export function isLoopbackUrl(url: URL): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}

export const originSchema = z
  .string()
  .superRefine((value, context) => {
    try {
      const url = new URL(value)
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        (url.protocol !== 'https:' && !isLoopbackUrl(url)) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        value.trim() !== value
      )
        throw new Error()
    } catch {
      context.addIssue({
        code: 'custom',
        message:
          'Use an HTTPS origin, or HTTP on loopback, without credentials, a path, query or fragment.',
      })
    }
  })
  .transform((value) => new URL(value).origin)

/** Key classification only; the provider still verifies authentication and authorization. */
export function isPublicAuthKey(value: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(value)) return true
  const segments = value.split('.')
  if (segments.length !== 3 || !segments.every((part) => /^[A-Za-z0-9_-]+$/.test(part)))
    return false
  try {
    const payload = JSON.parse(atob(segments[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'anon'
  } catch {
    return false
  }
}

const publicSchema = z
  .object({
    VITE_LOOPMARK_APP_ORIGIN: originSchema.optional(),
    VITE_LOOPMARK_SUPABASE_URL: originSchema.optional(),
    VITE_LOOPMARK_SUPABASE_ANON_KEY: z
      .string()
      .refine(isPublicAuthKey, 'Only a Supabase publishable or anon key is allowed.')
      .optional(),
    VITE_LOOPMARK_MEDIA_CONCURRENCY: z
      .string()
      .regex(/^[1-4]$/, 'Use an integer from 1 to 4.')
      .default('2')
      .transform(Number),
  })
  .strict()
  .superRefine((value, context) => {
    const fields = [
      'VITE_LOOPMARK_APP_ORIGIN',
      'VITE_LOOPMARK_SUPABASE_URL',
      'VITE_LOOPMARK_SUPABASE_ANON_KEY',
    ] as const
    const present = fields.filter((field) => value[field] !== undefined)
    // A stable app origin alone is useful for public pages. A backend/key requires all three.
    if (
      present.some((field) => field !== 'VITE_LOOPMARK_APP_ORIGIN') &&
      present.length !== fields.length
    ) {
      for (const field of fields.filter((field) => value[field] === undefined)) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'Cloud setup requires an app origin, backend URL and public auth key together.',
        })
      }
    }
  })

export type PublicConfig = Readonly<{
  guestAvailable: true
  appOrigin?: string
  mediaConcurrency: number
  retry: Readonly<{ initialDelayMs: 1000; maxDelayMs: 60000; maxAttemptsPerCycle: 5 }>
  cloud:
    | Readonly<{ enabled: false }>
    | Readonly<{ enabled: true; url: string; publicKey: string; authCallbackUrl: string }>
}>

const retry = Object.freeze({
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  maxAttemptsPerCycle: 5,
} as const)

export function parsePublicConfig(environment: Readonly<Record<string, unknown>>): PublicConfig {
  // Vite's MODE/BASE_URL/etc. are unrelated. All application VITE_ keys are an allowlist.
  const entries = Object.entries(environment).filter(
    ([key, value]) => key.startsWith('VITE_') && value !== undefined && value !== '',
  )
  const allowed = new Set(Object.keys(publicSchema.shape))
  if (entries.some(([key]) => !allowed.has(key))) {
    // Do not repeat untrusted key names: even a key name may contain sensitive input.
    throw new ConfigurationError([
      {
        field: 'public environment',
        problem:
          'Unsupported public setting. Secrets, test grants, redirect targets and invariant overrides are forbidden.',
      },
    ])
  }
  const parsed = publicSchema.safeParse(Object.fromEntries(entries))
  if (!parsed.success)
    throw new ConfigurationError(
      parsed.error.issues.map((issue) => ({
        field: String(issue.path[0] ?? 'public environment'),
        problem: issue.message,
      })),
    )
  const value = parsed.data
  return Object.freeze({
    guestAvailable: true,
    appOrigin: value.VITE_LOOPMARK_APP_ORIGIN,
    mediaConcurrency: value.VITE_LOOPMARK_MEDIA_CONCURRENCY,
    retry,
    cloud:
      value.VITE_LOOPMARK_SUPABASE_URL &&
      value.VITE_LOOPMARK_SUPABASE_ANON_KEY &&
      value.VITE_LOOPMARK_APP_ORIGIN
        ? Object.freeze({
            enabled: true as const,
            url: value.VITE_LOOPMARK_SUPABASE_URL,
            publicKey: value.VITE_LOOPMARK_SUPABASE_ANON_KEY,
            authCallbackUrl: `${value.VITE_LOOPMARK_APP_ORIGIN}/auth/callback`,
          })
        : Object.freeze({ enabled: false as const }),
  })
}

/** Call once at app startup. Invalid cloud settings must not take away local work. */
export function loadPublicConfig(
  environment: Readonly<Record<string, unknown>>,
): Readonly<{ config: PublicConfig; errors: readonly ConfigIssue[] }> {
  try {
    return Object.freeze({ config: parsePublicConfig(environment), errors: [] })
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error
    return Object.freeze({ config: parsePublicConfig({}), errors: error.issues })
  }
}
