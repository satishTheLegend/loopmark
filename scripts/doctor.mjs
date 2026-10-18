#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import net from 'node:net'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { loadOperatorConfig } from './lib/config.mjs'

const execute = promisify(execFile)
export const CAPABILITIES = Object.freeze([
  'guest',
  'local-sync',
  'native-ios',
  'native-android',
  'provider-sandbox',
])
const exists = async (path) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
const safeCommandEnvironment = (environment) =>
  Object.fromEntries(
    [
      'PATH',
      'HOME',
      'TMPDIR',
      'SystemRoot',
      'JAVA_HOME',
      'ANDROID_HOME',
      'ANDROID_SDK_ROOT',
      'DEVELOPER_DIR',
      'DOCKER_HOST',
      'DOCKER_CONTEXT',
      'DOCKER_CONFIG',
    ]
      .filter((key) => environment[key])
      .map((key) => [key, environment[key]]),
  )

async function command(file, args, environment, cwd) {
  try {
    const result = await execute(file, args, {
      cwd,
      env: safeCommandEnvironment(environment),
      timeout: 10_000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    })
    return { ok: true, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    // Raw child output and error.message may contain credentials. They never leave this function.
    return { ok: false, missing: error.code === 'ENOENT', stdout: '', stderr: '' }
  }
}

async function portFree(port, host) {
  return new Promise((resolvePort) => {
    const server = net.createServer()
    server.once('error', () => resolvePort(false))
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolvePort(true)))
  })
}

function result(capability, checks, config) {
  const exitCode = checks.some((check) => check.status === 'unhealthy')
    ? 3
    : checks.some((check) => check.status === 'missing')
      ? 2
      : 0
  return {
    schemaVersion: 1,
    capability,
    status: exitCode === 0 ? 'ready' : exitCode === 2 ? 'unconfigured' : 'unhealthy',
    exitCode,
    evidence: 'read-only-prerequisites',
    projectId: config?.projectId ?? null,
    profile: config?.profile ?? null,
    ports: config?.ports ?? null,
    checks,
  }
}

/** Read-only readiness probes. No package installs, builds, account calls or provider validation. */
export async function runDoctor({
  capability = 'guest',
  environment = process.env,
  worktree = process.cwd(),
} = {}) {
  const checks = []
  const check = (id, status, problem, nextAction = '') =>
    checks.push({ id, status, problem, nextAction })
  if (!CAPABILITIES.includes(capability)) {
    check('usage', 'missing', 'Unknown capability.', `Choose one of: ${CAPABILITIES.join(', ')}.`)
    return result('unknown', checks)
  }
  let config
  let env
  try {
    ;({ config, environment: env } = await loadOperatorConfig({ environment, worktree }))
  } catch {
    check(
      'configuration',
      'missing',
      'Local profile configuration could not be read or validated.',
      'Check .env.local, LOOPMARK_DEV_PROFILE and documented local port overrides. No input values are printed.',
    )
    return result(capability, checks)
  }
  check(
    'configuration',
    'ready',
    'Local profile is valid; process environment takes precedence over .env.local.',
  )
  const [major, minor] = process.versions.node.split('.').map(Number)
  check(
    'node',
    major > 22 || (major === 22 && minor >= 12) ? 'ready' : 'missing',
    `Node ${process.versions.node}.`,
    'Use Node 24 LTS or a compatible version satisfying package.json.',
  )
  const npm = await command(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['--version'],
    env,
    config.worktree,
  )
  check(
    'npm',
    npm.ok ? 'ready' : npm.missing ? 'missing' : 'unhealthy',
    npm.ok ? 'npm is available.' : 'npm could not be used.',
    'Install a compatible Node/npm distribution.',
  )
  for (const name of [
    'package.json',
    'package-lock.json',
    'index.html',
    'src/main.tsx',
    'node_modules/vite/bin/vite.js',
  ]) {
    const found = await exists(resolve(config.worktree, name))
    check(
      `file:${name}`,
      found ? 'ready' : 'missing',
      found ? `${name} is present.` : `${name} is missing.`,
      name.startsWith('node_modules')
        ? 'Run npm ci in this worktree.'
        : 'Use a complete project checkout.',
    )
  }
  const appPortFree = await portFree(config.ports.app, config.host)
  check(
    'app-port',
    appPortFree ? 'ready' : 'unhealthy',
    appPortFree
      ? 'The profile app port is free.'
      : 'The profile app port is occupied or unavailable.',
    'Stop the known local server or select LOOPMARK_DEV_APP_PORT; do not reuse an unknown process.',
  )

  if (capability === 'local-sync') {
    const cli = resolve(config.worktree, 'node_modules/.bin/supabase')
    const cliFound = await exists(cli)
    check(
      'supabase-cli',
      cliFound ? 'ready' : 'missing',
      cliFound
        ? 'Project-local Supabase CLI is present.'
        : 'Project-local Supabase CLI is missing.',
      'Install the project-pinned dependencies with npm ci.',
    )
    if (cliFound) {
      const version = await command(cli, ['--version'], env, config.worktree)
      check(
        'supabase-cli-health',
        version.ok ? 'ready' : 'unhealthy',
        version.ok ? 'Supabase CLI responds.' : 'Supabase CLI cannot run.',
        'Repair the project-local CLI installation.',
      )
    }
    let identityMatches = false
    try {
      const toml = await readFile(resolve(config.worktree, 'supabase/config.toml'), 'utf8')
      const identity = toml.match(/^\s*project_id\s*=\s*"([a-z0-9-]+)"\s*$/m)?.[1]
      identityMatches = identity === config.projectId
      check(
        'local-project',
        identityMatches ? 'ready' : 'missing',
        identityMatches
          ? 'Supabase project identity matches this worktree profile.'
          : 'Supabase project identity is absent or does not match this profile.',
        'Run the local setup instructions for this profile; never reset another project.',
      )
    } catch {
      check(
        'local-project',
        'missing',
        'Local Supabase configuration is missing.',
        'Complete local backend setup in this worktree.',
      )
    }
    const context = await command(
      'docker',
      ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'],
      env,
      config.worktree,
    )
    let localDocker = false
    if (context.ok) {
      try {
        const endpoint = JSON.parse(context.stdout.trim())
        const localSocket = (value) =>
          typeof value === 'string' && (value.startsWith('unix://') || value.startsWith('npipe://'))
        // DOCKER_CONTEXT can take precedence over DOCKER_HOST. Neither may hide a remote target.
        localDocker = localSocket(endpoint) && (!env.DOCKER_HOST || localSocket(env.DOCKER_HOST))
      } catch {
        /* Unrecognized context fails closed. */
      }
    }
    check(
      'docker-context',
      localDocker ? 'ready' : context.missing ? 'missing' : 'unhealthy',
      localDocker ? 'Docker uses a local socket.' : 'A usable local Docker socket was not found.',
      'Start a local Docker-compatible runtime and select its local context; remote contexts are refused.',
    )
    if (localDocker) {
      const docker = await command(
        'docker',
        ['info', '--format', '{{.ServerVersion}}'],
        env,
        config.worktree,
      )
      check(
        'docker-runtime',
        docker.ok ? 'ready' : 'unhealthy',
        docker.ok ? 'Local Docker runtime responds.' : 'Local Docker runtime is unavailable.',
        'Start the selected local runtime and rerun doctor.',
      )
    }
    const ownRunningPorts = new Set()
    if (cliFound && identityMatches && localDocker) {
      const status = await command(cli, ['status', '--output', 'json'], env, config.worktree)
      if (status.ok) {
        try {
          const state = JSON.parse(status.stdout)
          if (state.API_URL === config.backendUrl) {
            for (const [name, field] of Object.entries({
              api: 'API_URL',
              db: 'DB_URL',
              studio: 'STUDIO_URL',
              mail: 'INBUCKET_URL',
            })) {
              if (!state[field]) continue
              const endpoint = new URL(state[field])
              if (
                ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) &&
                Number(endpoint.port) === config.ports[name]
              )
                ownRunningPorts.add(name)
            }
          }
        } catch {
          /* Never print status: it contains secrets. */
        }
        if (!ownRunningPorts.has('api'))
          check(
            'running-project',
            'unhealthy',
            'The running stack does not match the selected profile.',
            'Stop and inspect the selected local stack; do not reuse it.',
          )
      }
    }
    for (const name of ['api', 'db', 'studio', 'mail']) {
      const free = await portFree(config.ports[name], config.host)
      const owned = ownRunningPorts.has(name)
      check(
        `port:${name}`,
        free || owned ? 'ready' : 'unhealthy',
        free
          ? `The ${name} port is free.`
          : owned
            ? `The ${name} port matches the selected running stack.`
            : `The ${name} port is occupied or unavailable.`,
        'Choose another LOOPMARK_DEV_PROFILE or documented port override.',
      )
    }
    check(
      'scope',
      'ready',
      'These checks establish local prerequisites only; run the sync smoke suite to verify convergence and ownership.',
    )
  }

  if (capability.startsWith('native-')) {
    const platform = capability === 'native-ios' ? 'ios' : 'android'
    for (const name of [
      'node_modules/@capacitor/core/package.json',
      'node_modules/@capacitor/cli/package.json',
      `node_modules/@capacitor/${platform}/package.json`,
      'capacitor.config.ts',
    ]) {
      const found = await exists(resolve(config.worktree, name))
      check(
        `native-file:${name}`,
        found ? 'ready' : 'missing',
        found ? `${name} is present.` : `${name} is missing.`,
        'Install pinned native dependencies and follow the native setup guide.',
      )
    }
    if (platform === 'ios') {
      check(
        'macos',
        process.platform === 'darwin' ? 'ready' : 'missing',
        process.platform === 'darwin' ? 'Running on macOS.' : 'iOS builds require macOS.',
        'Use the supported macOS contributor path.',
      )
      const xcode = await command('xcodebuild', ['-version'], env, config.worktree)
      const version = Number(xcode.stdout.match(/Xcode (\d+)/)?.[1])
      check(
        'xcode',
        xcode.ok && version >= 26
          ? 'ready'
          : xcode.missing || (xcode.ok && version < 26)
            ? 'missing'
            : 'unhealthy',
        xcode.ok && version >= 26
          ? 'Xcode 26 or newer responds.'
          : 'A compatible selected Xcode is unavailable.',
        'Install/select a supported Xcode and accept its license yourself.',
      )
      const simulator = await command(
        'xcrun',
        ['simctl', 'list', 'devices', 'available', '--json'],
        env,
        config.worktree,
      )
      let available = false
      try {
        available = Object.values(JSON.parse(simulator.stdout).devices).some(
          (devices) =>
            Array.isArray(devices) && devices.some((device) => device.isAvailable === true),
        )
      } catch {
        /* Bad output is an unhealthy dependency. */
      }
      check(
        'ios-simulator',
        available ? 'ready' : simulator.missing ? 'missing' : 'unhealthy',
        available
          ? 'An available iOS simulator is listed.'
          : 'No available simulator could be verified.',
        'Install an iOS simulator runtime/device using Xcode.',
      )
      const shell = await exists(resolve(config.worktree, 'ios/App/App.xcodeproj/project.pbxproj'))
      check(
        'ios-shell',
        shell ? 'ready' : 'missing',
        shell ? 'The iOS project exists.' : 'The iOS project is missing.',
        'Generate the reviewed native shell and run native:sync.',
      )
    } else {
      const sdk = env.ANDROID_SDK_ROOT || env.ANDROID_HOME
      const sdkValid = typeof sdk === 'string' && isAbsolute(sdk) && (await exists(sdk))
      check(
        'android-sdk',
        sdkValid ? 'ready' : 'missing',
        sdkValid
          ? 'The configured Android SDK directory exists.'
          : 'The Android SDK path is absent or invalid.',
        'Set ANDROID_HOME or ANDROID_SDK_ROOT to an installed SDK.',
      )
      const javaFile = env.JAVA_HOME ? resolve(env.JAVA_HOME, 'bin/java') : 'java'
      const java = await command(javaFile, ['-version'], env, config.worktree)
      const version = Number(`${java.stdout}\n${java.stderr}`.match(/version "(\d+)/)?.[1])
      check(
        'java',
        java.ok && version >= 21
          ? 'ready'
          : java.missing || (java.ok && version < 21)
            ? 'missing'
            : 'unhealthy',
        java.ok && version >= 21 ? 'JDK 21 or newer responds.' : 'A compatible JDK is unavailable.',
        'Install JDK 21 and configure JAVA_HOME.',
      )
      if (sdkValid) {
        const api = await exists(resolve(sdk, 'platforms/android-36/android.jar'))
        check(
          'android-api',
          api ? 'ready' : 'missing',
          api ? 'Android API 36 is installed.' : 'Android API 36 is missing.',
          'Install the pinned Android platform through SDK Manager.',
        )
        const adb = await command(
          resolve(sdk, 'platform-tools/adb'),
          ['version'],
          env,
          config.worktree,
        )
        check(
          'adb',
          adb.ok ? 'ready' : adb.missing ? 'missing' : 'unhealthy',
          adb.ok ? 'Android platform tools respond.' : 'Android platform tools are unavailable.',
          'Install platform-tools through SDK Manager.',
        )
        const emulators = await command(
          resolve(sdk, 'emulator/emulator'),
          ['-list-avds'],
          env,
          config.worktree,
        )
        check(
          'android-emulator',
          emulators.ok && !!emulators.stdout.trim() ? 'ready' : 'missing',
          emulators.ok && !!emulators.stdout.trim()
            ? 'An Android virtual device is configured.'
            : 'No Android virtual device is configured.',
          'Create a supported emulator using Android Studio.',
        )
      }
      const shell = await exists(resolve(config.worktree, 'android/gradlew'))
      check(
        'android-shell',
        shell ? 'ready' : 'missing',
        shell ? 'The Android Gradle wrapper exists.' : 'The Android project is missing.',
        'Generate the reviewed native shell and run native:sync.',
      )
    }
    check(
      'scope',
      'ready',
      'Toolchain prerequisites do not establish build success, signing, physical-device behavior or store qualification.',
    )
  }

  if (capability === 'provider-sandbox') {
    const sandbox =
      env.LOOPMARK_PAYMENT_ENVIRONMENT === 'sandbox' &&
      ['local', 'staging'].includes(env.LOOPMARK_ENVIRONMENT)
    check(
      'provider-environment',
      sandbox ? 'ready' : 'missing',
      sandbox
        ? 'A nonproduction sandbox environment is selected.'
        : 'Explicit local/staging and sandbox settings are required.',
      'Set LOOPMARK_ENVIRONMENT and LOOPMARK_PAYMENT_ENVIRONMENT=sandbox; never use live keys here.',
    )
    const fields = [
      'SUPABASE_SERVICE_ROLE_KEY',
      'REVENUECAT_SECRET_API_KEY',
      'REVENUECAT_WEBHOOK_SECRET',
      'RAZORPAY_KEY_ID',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
      'LOOPMARK_REVENUECAT_IOS_KEY',
      'LOOPMARK_REVENUECAT_ANDROID_KEY',
    ]
    for (const field of fields) {
      const value = env[field]
      let present = typeof value === 'string' && value.trim().length >= 16
      if (field === 'RAZORPAY_KEY_ID')
        present = typeof value === 'string' && /^rzp_test_[A-Za-z0-9]+$/.test(value)
      if (field === 'LOOPMARK_REVENUECAT_IOS_KEY')
        present = typeof value === 'string' && /^appl_[A-Za-z0-9]+$/.test(value)
      if (field === 'LOOPMARK_REVENUECAT_ANDROID_KEY')
        present = typeof value === 'string' && /^goog_[A-Za-z0-9]+$/.test(value)
      check(
        `provider:${field}`,
        present ? 'ready' : 'missing',
        present
          ? `${field} is configured; its value is hidden.`
          : `${field} is absent or not a supported sandbox setting.`,
        'Supply credentials from authorized test accounts outside version control. Do not send them in chat.',
      )
    }
    for (const field of ['SUPABASE_URL', 'LOOPMARK_APP_ORIGIN']) {
      let valid = false
      try {
        const url = new URL(env[field])
        valid =
          !url.username &&
          !url.password &&
          url.pathname === '/' &&
          !url.search &&
          !url.hash &&
          (url.protocol === 'https:' ||
            (url.protocol === 'http:' &&
              ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
      } catch {
        /* Missing or invalid URL is a configuration failure. */
      }
      check(
        `provider:${field}`,
        valid ? 'ready' : 'missing',
        valid ? `${field} is configured.` : `${field} is absent or invalid.`,
        'Use a supported HTTPS or local loopback origin.',
      )
    }
    check(
      'scope',
      'ready',
      'Credential presence only: merchant eligibility, authorization, webhook delivery and actual sandbox purchases remain unverified. No account network calls were made.',
    )
  }
  return result(capability, checks, config)
}

export async function main(argv = process.argv.slice(2)) {
  let capability = 'guest'
  let json = false
  let usageError = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--json') json = true
    else if (argument === '--capability' && argv[index + 1] && !argv[index + 1].startsWith('--'))
      capability = argv[++index]
    else if (argument === '--help' && argv.length === 1) {
      process.stdout.write(
        `Usage: npm run doctor -- [--capability ${CAPABILITIES.join('|')}] [--json]\nDefault capability: guest. Read-only prerequisite probes; no installs, account calls or setup.\nExit codes: 0 ready, 2 usage/configuration/prerequisite missing, 3 unhealthy local dependency.\nJSON schemaVersion 1: capability, status, exitCode, evidence, projectId, profile, ports, checks.\nLocal profile: LOOPMARK_DEV_PROFILE; process environment overrides .env.local.\n`,
      )
      return 0
    } else usageError = true
  }
  let report
  try {
    report = usageError
      ? result('unknown', [
          {
            id: 'usage',
            status: 'missing',
            problem: 'Invalid arguments.',
            nextAction: 'Run npm run doctor -- --help.',
          },
        ])
      : await runDoctor({ capability })
  } catch {
    report = result(CAPABILITIES.includes(capability) ? capability : 'unknown', [
      {
        id: 'probe',
        status: 'unhealthy',
        problem: 'A prerequisite probe could not complete.',
        nextAction:
          'Check the local runtime and rerun doctor. No raw dependency output is printed.',
      },
    ])
  }
  if (json) process.stdout.write(`${JSON.stringify(report)}\n`)
  else {
    process.stdout.write(`${report.capability}: ${report.status}. Prerequisite checks only.\n`)
    if (report.projectId) process.stdout.write(`Project: ${report.projectId}\n`)
    for (const check of report.checks)
      process.stdout.write(
        `[${check.status}] ${check.problem}${check.status !== 'ready' ? ` ${check.nextAction}` : ''}\n`,
      )
  }
  return report.exitCode
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href ===
    pathToFileURL(fileURLToPath(import.meta.url)).href
)
  process.exitCode = await main()
