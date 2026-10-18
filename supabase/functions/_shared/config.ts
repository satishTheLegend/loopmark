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
const productIds = z
  .string()
  .transform((value) => value.split(','))
  .pipe(
    z
      .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/))
      .min(1)
      .max(10)
      .refine((values) => new Set(values).size === values.length),
  )
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
    LOOPMARK_REVENUECAT_PROJECT_ID: z
      .string()
      .regex(/^proj[A-Za-z0-9]{4,100}$/)
      .optional(),
    LOOPMARK_PAYMENT_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
    LOOPMARK_BILLING_FIXTURE_ENABLED: flag,
    LOOPMARK_BILLING_FIXTURE_URL: z.literal('http://billing-fixture:8788').optional(),
    LOOPMARK_ERASURE_LEDGER_URL: z
      .union([origin, z.literal('http://erasure-ledger:8787')])
      .optional(),
    LOOPMARK_ERASURE_LEDGER_KEY: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .transform((value) => Object.freeze(new Secret(value)))
      .optional(),
    LOOPMARK_REVENUECAT_IOS_KEY: z
      .string()
      .regex(/^appl_[A-Za-z0-9]{16,}$/)
      .optional(),
    LOOPMARK_REVENUECAT_ANDROID_KEY: z
      .string()
      .regex(/^goog_[A-Za-z0-9]{16,}$/)
      .optional(),
    LOOPMARK_REVENUECAT_IOS_PRODUCTS: productIds.optional(),
    LOOPMARK_REVENUECAT_ANDROID_PRODUCTS: productIds.optional(),
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
      value.LOOPMARK_BILLING_FIXTURE_ENABLED !== !!value.LOOPMARK_BILLING_FIXTURE_URL ||
      (value.LOOPMARK_BILLING_FIXTURE_ENABLED &&
        (value.LOOPMARK_ENVIRONMENT !== 'local' ||
          value.LOOPMARK_PAYMENT_ENVIRONMENT !== 'sandbox'))
    )
      context.addIssue({
        code: 'custom',
        path: ['LOOPMARK_BILLING_FIXTURE_ENABLED'],
        message: 'Provider fixture requires explicit local sandbox isolation.',
      })
    if (!!value.LOOPMARK_ERASURE_LEDGER_URL !== !!value.LOOPMARK_ERASURE_LEDGER_KEY)
      context.addIssue({
        code: 'custom',
        path: ['LOOPMARK_ERASURE_LEDGER_URL'],
        message: 'Ledger URL and credential are required together.',
      })
    if (value.LOOPMARK_ERASURE_LEDGER_URL) {
      const ledger = new URL(value.LOOPMARK_ERASURE_LEDGER_URL)
      const local = value.LOOPMARK_ENVIRONMENT === 'local'
      if (
        (local &&
          value.LOOPMARK_ERASURE_LEDGER_URL !== 'http://erasure-ledger:8787' &&
          !['localhost', '127.0.0.1', '[::1]'].includes(ledger.hostname)) ||
        (!local && ledger.protocol !== 'https:') ||
        ledger.origin === value.SUPABASE_URL
      )
        context.addIssue({
          code: 'custom',
          path: ['LOOPMARK_ERASURE_LEDGER_URL'],
          message:
            'Use an independent HTTPS ledger, or the exact local service/loopback origin in a local environment.',
        })
    }
    for (const platform of ['IOS', 'ANDROID'] as const) {
      if (
        !!value[`LOOPMARK_REVENUECAT_${platform}_KEY`] !==
        !!value[`LOOPMARK_REVENUECAT_${platform}_PRODUCTS`]
      )
        context.addIssue({
          code: 'custom',
          path: [`LOOPMARK_REVENUECAT_${platform}_KEY`],
          message: 'A public platform key and approved product IDs are required together.',
        })
    }
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
        !value.LOOPMARK_REVENUECAT_PROJECT_ID ||
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
  revenueCatProjectId?: string
  paymentsEnrolled: boolean
  billingFixtureUrl?: string
  paymentEnvironment: 'sandbox' | 'production'
  erasureLedgerUrl?: string
  nativeBilling: Readonly<{
    ios?: Readonly<{ publicSdkKey: string; productIds: readonly string[] }>
    android?: Readonly<{ publicSdkKey: string; productIds: readonly string[] }>
  }>
  alerts: Readonly<{ syncMs: number; webhookMs: number; deletionMs: number; backupMs: number }>
  secrets: Readonly<{
    serviceRole: Readonly<Secret>
    revenueCatApi?: Readonly<Secret>
    revenueCatWebhook?: Readonly<Secret>
    razorpayKeyId?: Readonly<Secret>
    razorpayKey?: Readonly<Secret>
    razorpayWebhook?: Readonly<Secret>
    erasureLedger?: Readonly<Secret>
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
    revenueCatProjectId: value.LOOPMARK_REVENUECAT_PROJECT_ID,
    paymentsEnrolled: value.LOOPMARK_RAZORPAY_ENROLLED || value.LOOPMARK_REVENUECAT_ENROLLED,
    paymentEnvironment: value.LOOPMARK_PAYMENT_ENVIRONMENT,
    billingFixtureUrl: value.LOOPMARK_BILLING_FIXTURE_URL,
    erasureLedgerUrl: value.LOOPMARK_ERASURE_LEDGER_URL,
    nativeBilling: Object.freeze({
      ios:
        value.LOOPMARK_REVENUECAT_IOS_KEY && value.LOOPMARK_REVENUECAT_IOS_PRODUCTS
          ? Object.freeze({
              publicSdkKey: value.LOOPMARK_REVENUECAT_IOS_KEY,
              productIds: Object.freeze(value.LOOPMARK_REVENUECAT_IOS_PRODUCTS),
            })
          : undefined,
      android:
        value.LOOPMARK_REVENUECAT_ANDROID_KEY && value.LOOPMARK_REVENUECAT_ANDROID_PRODUCTS
          ? Object.freeze({
              publicSdkKey: value.LOOPMARK_REVENUECAT_ANDROID_KEY,
              productIds: Object.freeze(value.LOOPMARK_REVENUECAT_ANDROID_PRODUCTS),
            })
          : undefined,
    }),
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
      erasureLedger: value.LOOPMARK_ERASURE_LEDGER_KEY,
    }),
  })
}
