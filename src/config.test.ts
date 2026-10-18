import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify, inspect } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfigurationError, loadPublicConfig, parsePublicConfig } from './config'
import { parseServerConfig } from '../supabase/functions/_shared/config'
import valid from '../tests/fixtures/expansion/config-valid.json'
import invalid from '../tests/fixtures/expansion/config-invalid.json'

const execute = promisify(execFile)
const operatorModule = '../scripts/lib/config.mjs'
const doctorModule = '../scripts/doctor.mjs'
const { parseOperatorConfig, loadOperatorConfig } = await import(operatorModule)
const { runDoctor } = await import(doctorModule)
const temporary: string[] = []
const servers: net.Server[] = []
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
  )
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const jwt = (role: string) =>
  `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.synthetic_signature`
const serverConfig = {
  LOOPMARK_PROJECT_ID: 'loopmark-test',
  LOOPMARK_APP_ORIGIN: 'http://127.0.0.1:5173',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_synthetic_server_config_only',
}

async function temporaryCheckout() {
  const root = await mkdtemp(join(tmpdir(), 'loopmark-config-'))
  temporary.push(root)
  for (const file of [
    'package.json',
    'package-lock.json',
    'index.html',
    'src/main.tsx',
    'node_modules/vite/bin/vite.js',
  ]) {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), '{}')
  }
  return root
}

async function occupiedPort() {
  const server = net.createServer()
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  return address.port
}

describe('public configuration boundary', () => {
  it('keeps guest available without cloud/provider credentials and freezes retry bounds', () => {
    const config = parsePublicConfig({
      MODE: 'production',
      SUPABASE_SERVICE_ROLE_KEY: 'not-bundled',
    })
    expect(config.cloud).toEqual({ enabled: false })
    expect(config.guestAvailable).toBe(true)
    expect(config.mediaConcurrency).toBe(2)
    expect(config.retry).toEqual({
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      maxAttemptsPerCycle: 5,
    })
    expect(Object.isFrozen(config)).toBe(true)
    expect(JSON.stringify(config)).not.toContain('not-bundled')
  })

  it('enables only complete validated cloud configuration with a derived callback', () => {
    const config = parsePublicConfig(valid)
    expect(config.cloud).toEqual({
      enabled: true,
      url: valid.VITE_LOOPMARK_SUPABASE_URL,
      publicKey: valid.VITE_LOOPMARK_SUPABASE_ANON_KEY,
      authCallbackUrl: 'https://app.example.test/auth/callback',
    })
    expect(
      parsePublicConfig({ ...valid, VITE_LOOPMARK_SUPABASE_ANON_KEY: jwt('anon') }).cloud.enabled,
    ).toBe(true)
  })

  it.each(invalid.map((input, index) => [index, input] as const))(
    'rejects invalid or authority-changing fixture %s',
    (_, input) => {
      expect(() => parsePublicConfig(input)).toThrow(ConfigurationError)
    },
  )

  it.each(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000'])(
    'allows a loopback origin %s',
    (origin) => {
      expect(parsePublicConfig({ ...valid, VITE_LOOPMARK_APP_ORIGIN: origin }).cloud.enabled).toBe(
        true,
      )
    },
  )

  it.each([
    'sb_secret_DO_NOT_PRINT_THIS_PRIVATE_VALUE',
    jwt('service_role'),
    jwt('authenticated'),
    'invalid-key',
  ])('rejects privileged or invalid keys without leaking their value', (key) => {
    let failure: unknown
    try {
      parsePublicConfig({ ...valid, VITE_LOOPMARK_SUPABASE_ANON_KEY: key })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ConfigurationError)
    expect(String(failure)).not.toContain(key)
  })

  it('fails cloud configuration closed while retaining a usable guest fallback', () => {
    const loaded = loadPublicConfig({ ...valid, VITE_LOOPMARK_MEDIA_CONCURRENCY: '9999' })
    expect(loaded.config.cloud.enabled).toBe(false)
    expect(loaded.config.guestAvailable).toBe(true)
    expect(loaded.errors).toHaveLength(1)
  })
})

describe('server configuration boundary', () => {
  it('requires explicit enrollment and redacts secrets during ordinary serialization and inspection', () => {
    const config = parseServerConfig(serverConfig)
    expect(config.cloudEnrolled).toBe(false)
    expect(config.paymentsEnrolled).toBe(false)
    expect(config.secrets.serviceRole.reveal()).toBe(serverConfig.SUPABASE_SERVICE_ROLE_KEY)
    expect(JSON.stringify(config)).not.toContain(serverConfig.SUPABASE_SERVICE_ROLE_KEY)
    expect(inspect(config)).not.toContain(serverConfig.SUPABASE_SERVICE_ROLE_KEY)
    expect(config.alerts).toEqual({
      syncMs: 300000,
      webhookMs: 300000,
      deletionMs: 86400000,
      backupMs: 86400000,
    })
  })

  it('rejects public keys, invariant overrides, remote local targets, incomplete payment enrollment and invalid durations', () => {
    for (const overrides of [
      { SUPABASE_SERVICE_ROLE_KEY: jwt('anon') },
      { LOOPMARK_MAX_PROJECTS: '999' },
      { SUPABASE_URL: 'https://remote.example.test' },
      { LOOPMARK_RAZORPAY_ENROLLED: 'true' },
      { LOOPMARK_REVENUECAT_ENROLLED: 'true' },
      { LOOPMARK_SYNC_ALERT_MS: '-1' },
      { LOOPMARK_BACKUP_ALERT_MS: '999999999' },
      { LOOPMARK_ENVIRONMENT: 'production' },
      { RAZORPAY_KEY_ID: 'rzp_live_synthetic' },
    ])
      expect(() => parseServerConfig({ ...serverConfig, ...overrides })).toThrow()
  })

  it('does not repeat invalid secrets or environment values in errors', () => {
    for (const overrides of [
      { SUPABASE_SERVICE_ROLE_KEY: 'DO_NOT_PRINT_THIS' },
      { LOOPMARK_ENVIRONMENT: 'DO_NOT_PRINT_THIS' },
    ]) {
      try {
        parseServerConfig({ ...serverConfig, ...overrides })
        throw new Error('expected failure')
      } catch (error) {
        expect(String(error)).not.toContain('DO_NOT_PRINT_THIS')
      }
    }
  })

  it('requires explicit independent provider enrollment; secrets alone never enable payments', () => {
    const revenueCat = {
      REVENUECAT_SECRET_API_KEY: 'synthetic_revenuecat_api_secret',
      REVENUECAT_WEBHOOK_SECRET: 'synthetic_revenuecat_webhook_secret',
    }
    const razorpay = {
      RAZORPAY_KEY_ID: 'rzp_test_synthetic',
      RAZORPAY_KEY_SECRET: 'synthetic_razorpay_api_secret',
      RAZORPAY_WEBHOOK_SECRET: 'synthetic_razorpay_webhook_secret',
    }
    expect(
      parseServerConfig({ ...serverConfig, ...revenueCat, ...razorpay }).paymentsEnrolled,
    ).toBe(false)
    const native = parseServerConfig({
      ...serverConfig,
      ...revenueCat,
      LOOPMARK_CLOUD_ENROLLED: 'true',
      LOOPMARK_REVENUECAT_ENROLLED: 'true',
    })
    expect(native.paymentsEnrolled).toBe(true)
    expect(native.revenueCatEnrolled).toBe(true)
    expect(native.razorpayEnrolled).toBe(false)
    const web = parseServerConfig({
      ...serverConfig,
      ...razorpay,
      LOOPMARK_CLOUD_ENROLLED: 'true',
      LOOPMARK_RAZORPAY_ENROLLED: 'true',
    })
    expect(web.paymentsEnrolled).toBe(true)
    expect(web.razorpayEnrolled).toBe(true)
    expect(web.revenueCatEnrolled).toBe(false)
    expect(() =>
      parseServerConfig({ ...serverConfig, ...revenueCat, LOOPMARK_REVENUECAT_ENROLLED: 'true' }),
    ).toThrow()
  })

  it('allows the exact internal Edge gateway only for the local server, never public or remote configurations', () => {
    expect(
      parseServerConfig({ ...serverConfig, SUPABASE_URL: 'http://kong:8000' }).backendUrl,
    ).toBe('http://kong:8000')
    for (const environment of ['staging', 'production'])
      expect(() =>
        parseServerConfig({
          ...serverConfig,
          LOOPMARK_ENVIRONMENT: environment,
          SUPABASE_URL: 'http://kong:8000',
        }),
      ).toThrow()
    expect(() =>
      parsePublicConfig({ ...valid, VITE_LOOPMARK_SUPABASE_URL: 'http://kong:8000' }),
    ).toThrow()
    expect(() => parseOperatorConfig({ LOOPMARK_LOCAL_URL: 'http://kong:8000' })).toThrow()
  })
})

describe('operator configuration and read-only doctor', () => {
  it('derives stable distinct worktree profiles and honors explicit safe profiles', () => {
    const a = parseOperatorConfig({}, '/tmp/loopmark-a')
    const b = parseOperatorConfig({}, '/tmp/loopmark-b')
    expect(parseOperatorConfig({}, '/tmp/loopmark-a')).toEqual(a)
    expect(a.projectId).not.toBe(b.projectId)
    expect(a.ports).not.toEqual(b.ports)
    expect(parseOperatorConfig({ LOOPMARK_DEV_PROFILE: 'worker-a' }, '/tmp/a').ports).toEqual(
      parseOperatorConfig({ LOOPMARK_DEV_PROFILE: 'worker-a' }, '/tmp/b').ports,
    )
  })

  it('rejects unsafe endpoints, ambiguous duplicate ports and unknown local overrides', () => {
    for (const environment of [
      { LOOPMARK_LOCAL_URL: 'https://production.example.test' },
      { LOOPMARK_LOCAL_URL: 'http://127.0.0.1:1' },
      { LOOPMARK_DEV_PROFILE: '../../another-project' },
      { LOOPMARK_DEV_APP_PORT: '5432', LOOPMARK_DEV_DB_PORT: '5432' },
      { LOOPMARK_DEV_API_PORT: '80' },
      { LOOPMARK_DEV_HOST: '0.0.0.0' },
    ])
      expect(() => parseOperatorConfig(environment, '/tmp/loopmark')).toThrow()
  })

  it('gives process settings precedence over local settings without rewriting them', async () => {
    const root = await temporaryCheckout()
    const contents = 'LOOPMARK_DEV_PROFILE=from-file\nLOOPMARK_DEV_APP_PORT=41000\n'
    await writeFile(join(root, '.env.local'), contents)
    const loaded = await loadOperatorConfig({
      worktree: root,
      environment: { LOOPMARK_DEV_PROFILE: 'from-process', LOOPMARK_DEV_APP_PORT: '' },
    })
    expect(loaded.config.profile).toBe('from-process')
    expect(loaded.config.ports.app).not.toBe(41000)
    expect(await readFile(join(root, '.env.local'), 'utf8')).toBe(contents)
  })

  it('guest readiness ignores absent providers, while sandbox readiness reports each missing prerequisite', async () => {
    const root = await temporaryCheckout()
    const environment = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LOOPMARK_DEV_PROFILE: 'config-doctor-test',
    }
    const guest = await runDoctor({ worktree: root, environment, capability: 'guest' })
    expect(guest.exitCode).toBe(0)
    expect(guest.evidence).toBe('read-only-prerequisites')
    const provider = await runDoctor({
      worktree: root,
      environment,
      capability: 'provider-sandbox',
    })
    expect(provider.exitCode).toBe(2)
    expect(provider.status).toBe('unconfigured')
    expect(
      provider.checks.some(
        (check: { id: string; status: string }) =>
          check.id === 'provider:RAZORPAY_KEY_SECRET' && check.status === 'missing',
      ),
    ).toBe(true)
  })

  it('reports an occupied app port as an unhealthy dependency without disturbing its listener', async () => {
    const port = await occupiedPort()
    const root = await temporaryCheckout()
    const report = await runDoctor({
      worktree: root,
      environment: { ...process.env, LOOPMARK_DEV_APP_PORT: String(port) },
      capability: 'guest',
    })
    expect(report.exitCode).toBe(3)
    expect(report.checks.find((check: { id: string }) => check.id === 'app-port').status).toBe(
      'unhealthy',
    )
    expect(servers[0].listening).toBe(true)
  })

  it('JSON output for a missing prerequisite contains no credential values or subprocess diagnostics', async () => {
    const root = await temporaryCheckout()
    const script = resolve('scripts/doctor.mjs')
    let stdout = ''
    try {
      await execute(process.execPath, [script, '--capability', 'provider-sandbox', '--json'], {
        cwd: root,
        env: { ...process.env, RAZORPAY_KEY_SECRET: 'SYNTHETIC_NEVER_PRINT_SECRET' },
      })
    } catch (error) {
      const failure = error as { code: number; stdout: string; stderr: string }
      expect(failure.code).toBe(2)
      expect(failure.stderr).toBe('')
      stdout = failure.stdout
    }
    const report = JSON.parse(stdout)
    expect(report.schemaVersion).toBe(1)
    expect(report.exitCode).toBe(2)
    expect(stdout).not.toContain('SYNTHETIC_NEVER_PRINT_SECRET')
  })

  it('rejects unsupported arguments with parseable exit-2 JSON', async () => {
    try {
      await execute(process.execPath, [resolve('scripts/doctor.mjs'), '--execute', '--json'])
    } catch (error) {
      const failure = error as { code: number; stdout: string }
      expect(failure.code).toBe(2)
      expect(JSON.parse(failure.stdout).checks[0].id).toBe('usage')
      return
    }
    throw new Error('Expected usage rejection')
  })
})
