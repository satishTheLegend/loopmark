import { z } from 'zod'

/** Explicit access is required; JSON and ordinary inspection cannot reveal the value. */
export class Secret {
  #value: string
  constructor(value: string) {
    this.#value = value
  }
  reveal(): string {
    return this.#value
  }
  toString(): string {
    return '[redacted]'
  }
  toJSON(): string {
    return '[redacted]'
  }
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[redacted]'
  }
}

const secret = z
  .string()
  .min(16)
  .transform((value) => Object.freeze(new Secret(value)))
const serviceSecret = z
  .string()
  .refine((value) => {
    if (/^sb_secret_[A-Za-z0-9_-]{16,}$/.test(value)) return true
    try {
      const parts = value.split('.')
      return (
        parts.length === 3 &&
        parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part)) &&
        JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))?.role === 'service_role'
      )
    } catch {
      return false
    }
  }, 'A server secret or service-role key is required.')
  .transform((value) => Object.freeze(new Secret(value)))
const origin = z
  .string()
  .refine((value) => {
    try {
      const url = new URL(value)
      return (
        value.trim() === value &&
        !url.username &&
        !url.password &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      )
    } catch {
      return false
    }
  }, 'Use an HTTPS or loopback HTTP origin without credentials or a path.')
  .transform((value) => new URL(value).origin)
const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true')
const duration = (fallback: number, maximum: number) =>
  z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(maximum))
    .default(fallback)

const schema = z
  .object({
    LOOPMARK_ENVIRONMENT: z.enum(['local', 'staging', 'production']).default('local'),
    LOOPMARK_PROJECT_ID: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    LOOPMARK_APP_ORIGIN: origin,
    // Supabase Edge containers address their internal gateway, not host loopback.
    // This one exact Docker service origin is allowed only in the local environment below.
    SUPABASE_URL: z.union([origin, z.literal('http://kong:8000')]),
    SUPABASE_SERVICE_ROLE_KEY: serviceSecret,
    LOOPMARK_CLOUD_ENROLLED: flag,
    LOOPMARK_RAZORPAY_ENROLLED: flag,
    LOOPMARK_REVENUECAT_ENROLLED: flag,
    LOOPMARK_PAYMENT_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
    LOOPMARK_SYNC_ALERT_MS: duration(300_000, 86_400_000),
    LOOPMARK_WEBHOOK_ALERT_MS: duration(300_000, 86_400_000),
    LOOPMARK_DELETION_ALERT_MS: duration(86_400_000, 604_800_000),
    LOOPMARK_BACKUP_ALERT_MS: duration(86_400_000, 604_800_000),
    REVENUECAT_SECRET_API_KEY: secret.optional(),
    REVENUECAT_WEBHOOK_SECRET: secret.optional(),
    RAZORPAY_KEY_ID: z
      .string()
      .regex(/^rzp_(test|live)_[A-Za-z0-9]+$/)
      .optional(),
    RAZORPAY_KEY_SECRET: secret.optional(),
    RAZORPAY_WEBHOOK_SECRET: secret.optional(),
  })
  .superRefine((value, context) => {
    if (
      value.LOOPMARK_ENVIRONMENT === 'local' &&
      value.SUPABASE_URL !== 'http://kong:8000' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(value.SUPABASE_URL).hostname)
    )
      context.addIssue({
        code: 'custom',
        path: ['SUPABASE_URL'],
        message: 'Local environment requires loopback.',
      })
    if (value.LOOPMARK_ENVIRONMENT !== 'local' && value.SUPABASE_URL === 'http://kong:8000')
      context.addIssue({
        code: 'custom',
        path: ['SUPABASE_URL'],
        message: 'The internal gateway is only available in the local environment.',
      })
    if (
      value.LOOPMARK_ENVIRONMENT === 'production' &&
      (value.LOOPMARK_APP_ORIGIN.startsWith('http:') || value.SUPABASE_URL.startsWith('http:'))
    )
      context.addIssue({
        code: 'custom',
        path: ['LOOPMARK_ENVIRONMENT'],
        message: 'Production endpoints require HTTPS.',
      })
    if (
      value.LOOPMARK_REVENUECAT_ENROLLED &&
      (!value.LOOPMARK_CLOUD_ENROLLED ||
        !value.REVENUECAT_SECRET_API_KEY ||
        !value.REVENUECAT_WEBHOOK_SECRET)
    )
      context.addIssue({
        code: 'custom',
        path: ['LOOPMARK_REVENUECAT_ENROLLED'],
        message:
          'RevenueCat enrollment requires cloud enrollment and its complete provider configuration.',
      })
    if (
      value.LOOPMARK_RAZORPAY_ENROLLED &&
      (!value.LOOPMARK_CLOUD_ENROLLED ||
        !value.RAZORPAY_KEY_ID ||
        !value.RAZORPAY_KEY_SECRET ||
        !value.RAZORPAY_WEBHOOK_SECRET)
    )
      context.addIssue({
        code: 'custom',
        path: ['LOOPMARK_RAZORPAY_ENROLLED'],
        message:
          'Razorpay enrollment requires cloud enrollment and its complete provider configuration.',
      })
    if (
      value.RAZORPAY_KEY_ID &&
      value.RAZORPAY_KEY_ID.startsWith('rzp_live_') !==
        (value.LOOPMARK_PAYMENT_ENVIRONMENT === 'production')
    )
      context.addIssue({
        code: 'custom',
        path: ['RAZORPAY_KEY_ID'],
        message: 'Provider key environment does not match payment environment.',
      })
    if (
      (value.LOOPMARK_RAZORPAY_ENROLLED || value.LOOPMARK_REVENUECAT_ENROLLED) &&
      (value.LOOPMARK_ENVIRONMENT === 'production') !==
        (value.LOOPMARK_PAYMENT_ENVIRONMENT === 'production')
    )
      context.addIssue({
        code: 'custom',
        path: ['LOOPMARK_PAYMENT_ENVIRONMENT'],
        message: 'Enrolled payments must match the server environment.',
      })
  })

export type ServerConfig = Readonly<{
  environment: 'local' | 'staging' | 'production'
  projectId: string
  appOrigin: string
  backendUrl: string
  authCallbackUrl: string
  cloudEnrolled: boolean
  razorpayEnrolled: boolean
  revenueCatEnrolled: boolean
  paymentsEnrolled: boolean
  paymentEnvironment: 'sandbox' | 'production'
  alerts: Readonly<{ syncMs: number; webhookMs: number; deletionMs: number; backupMs: number }>
  secrets: Readonly<{
    serviceRole: Readonly<Secret>
    revenueCatApi?: Readonly<Secret>
    revenueCatWebhook?: Readonly<Secret>
    razorpayKeyId?: Readonly<Secret>
    razorpayKey?: Readonly<Secret>
    razorpayWebhook?: Readonly<Secret>
  }>
}>

export function parseServerConfig(environment: Readonly<Record<string, unknown>>): ServerConfig {
  const allowed = new Set(Object.keys(schema.shape))
  const operatorOnly = new Set([
    'LOOPMARK_DEV_PROFILE',
    'LOOPMARK_DEV_APP_PORT',
    'LOOPMARK_DEV_API_PORT',
    'LOOPMARK_DEV_DB_PORT',
    'LOOPMARK_DEV_STUDIO_PORT',
    'LOOPMARK_DEV_MAIL_PORT',
    'LOOPMARK_LOCAL_URL',
    'LOOPMARK_REVENUECAT_IOS_KEY',
    'LOOPMARK_REVENUECAT_ANDROID_KEY',
  ])
  if (
    Object.keys(environment).some(
      (key) => key.startsWith('LOOPMARK_') && !allowed.has(key) && !operatorOnly.has(key),
    )
  )
    throw new Error(
      'Server configuration contains an unsupported setting. Fixed invariants cannot be overridden.',
    )
  const input = Object.fromEntries(
    Object.entries(environment).filter(
      ([key, value]) => allowed.has(key) && value !== '' && value !== undefined,
    ),
  )
  const parsed = schema.safeParse(input)
  // Zod union messages can include rejected values. Report only known field names, never raw errors.
  if (!parsed.success)
    throw new Error(
      `Server configuration is invalid. Check: ${[...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? 'server configuration')))].join(', ')}.`,
    )
  const value = parsed.data
  return Object.freeze({
    environment: value.LOOPMARK_ENVIRONMENT,
    projectId: value.LOOPMARK_PROJECT_ID,
    appOrigin: value.LOOPMARK_APP_ORIGIN,
    backendUrl: value.SUPABASE_URL,
    authCallbackUrl: `${value.LOOPMARK_APP_ORIGIN}/auth/callback`,
    cloudEnrolled: value.LOOPMARK_CLOUD_ENROLLED,
    razorpayEnrolled: value.LOOPMARK_RAZORPAY_ENROLLED,
    revenueCatEnrolled: value.LOOPMARK_REVENUECAT_ENROLLED,
    paymentsEnrolled: value.LOOPMARK_RAZORPAY_ENROLLED || value.LOOPMARK_REVENUECAT_ENROLLED,
    paymentEnvironment: value.LOOPMARK_PAYMENT_ENVIRONMENT,
    alerts: Object.freeze({
      syncMs: value.LOOPMARK_SYNC_ALERT_MS,
      webhookMs: value.LOOPMARK_WEBHOOK_ALERT_MS,
      deletionMs: value.LOOPMARK_DELETION_ALERT_MS,
      backupMs: value.LOOPMARK_BACKUP_ALERT_MS,
    }),
    secrets: Object.freeze({
      serviceRole: value.SUPABASE_SERVICE_ROLE_KEY,
      revenueCatApi: value.REVENUECAT_SECRET_API_KEY,
      revenueCatWebhook: value.REVENUECAT_WEBHOOK_SECRET,
      razorpayKeyId: value.RAZORPAY_KEY_ID ? new Secret(value.RAZORPAY_KEY_ID) : undefined,
      razorpayKey: value.RAZORPAY_KEY_SECRET,
      razorpayWebhook: value.RAZORPAY_WEBHOOK_SECRET,
    }),
  })
}
