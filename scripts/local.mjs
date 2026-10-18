import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import { resolve, dirname, relative } from 'node:path'
import { createServer } from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { loadOperatorConfig } from './lib/config.mjs'
import {
  configureBillingFixture,
  fixtureEnvironment,
  startBillingFixture,
  stopBillingFixture,
} from './billing-fixture.mjs'

const root = process.cwd()
export async function localContext() {
  const { config } = await loadOperatorConfig({ worktree: root })
  return {
    config,
    runtime: resolve(root, '.gstack/local', config.profile),
    network: `${config.projectId}-local`,
  }
}
export function execute(command, args, options = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' },
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = '',
      stderr = ''
    child.stdout.on('data', (data) => {
      stdout += data
    })
    child.stderr.on('data', (data) => {
      stderr += data
    })
    child.on('error', reject)
    child.on('close', (code) => resolveResult({ code: code ?? 1, stdout, stderr }))
  })
}
async function cli(args, context) {
  return execute(
    resolve(root, 'node_modules/.bin/supabase'),
    [...args, '--workdir', context.runtime, '--network-id', context.network],
    {
      env: {
        ...process.env,
        SUPABASE_TELEMETRY_DISABLED: '1',
        DO_NOT_TRACK: '1',
        PATH: resolve(context.runtime, 'bin') + ':' + process.env.PATH,
      },
    },
  )
}
async function available(port) {
  return new Promise((resolveResult) => {
    const server = createServer()
    server.once('error', () => resolveResult(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolveResult(true)))
  })
}
async function copyShared(destination) {
  // One source of truth: copy the transitive domain graph for Deno's isolated function mount.
  // Generated output lives only in .gstack; no second manually maintained implementation.
  const visited = new Set()
  async function copyModule(source) {
    if (visited.has(source)) return
    visited.add(source)
    let text = (await readFile(source, 'utf8')).replaceAll("from 'zod'", "from 'npm:zod@4.6.7'")
    const imports = [...text.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)]
    for (const match of imports) {
      if (!match[1].startsWith('.')) continue
      const target = resolve(dirname(source), `${match[1].replace(/\.ts$/, '')}.ts`)
      if (!target.startsWith(resolve(root, 'src') + '/'))
        throw new Error('Shared import escaped source root')
      await copyModule(target)
      text = text.replaceAll(`'${match[1]}'`, `'${match[1].replace(/\.ts$/, '')}.ts'`)
    }
    const target = resolve(destination, relative(resolve(root, 'src'), source))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, text)
  }
  for (const name of [
    'schema',
    'errors',
    'contracts',
    'policy',
    'canonical-json',
    'revisions',
    'remote-schema',
    'remote-contracts',
  ])
    await copyModule(resolve(root, `src/domain/${name}.ts`))
}
export async function prepare(context) {
  await mkdir(resolve(context.runtime, 'supabase'), { recursive: true, mode: 0o700 })
  await mkdir(resolve(context.runtime, 'bin'), { recursive: true, mode: 0o700 })
  const realDocker = (await execute('which', ['docker'])).stdout.trim()
  if (!realDocker.startsWith('/')) throw new Error('Docker executable was not found')
  const shim = `#!/usr/bin/env node
import {spawn} from 'node:child_process';
const args=process.argv.slice(2);
if(args[0]==='create'||args[0]==='run') {
 const owned=args.includes(${JSON.stringify('com.supabase.cli.project=' + context.config.projectId)});
 if(!owned) { console.error('Refusing container creation outside the selected Loopmark project');process.exit(2); }
 for(let i=0;i<args.length;i++) if(args[i]==='-p'||args[i]==='--publish') {
  const value=args[i+1];
  if(!/^\\d+:\\d+(?:\\/(?:tcp|udp))?$/.test(value)) {console.error('Unrecognized Docker port mapping; refusing non-loopback publication');process.exit(2);}
  args[i+1]='127.0.0.1:'+value;i++;
 }
}
const child=spawn(${JSON.stringify(realDocker)},args,{stdio:'inherit'});child.on('exit',code=>process.exit(code??1));child.on('error',()=>process.exit(1));
`
  await writeFile(resolve(context.runtime, 'bin/docker'), shim, { mode: 0o700 })
  for (const directory of ['migrations', 'functions'])
    await cp(
      resolve(root, 'supabase', directory),
      resolve(context.runtime, 'supabase', directory),
      { recursive: true },
    )
  // Kong bind-mounts template files individually. cp replaces their inodes, leaving
  // a running container on an unlinked file; writeFile preserves that mount.
  await mkdir(resolve(context.runtime, 'supabase/templates'), { recursive: true })
  await writeFile(
    resolve(context.runtime, 'supabase/templates/magic-link.html'),
    await readFile(resolve(root, 'supabase/templates/magic-link.html')),
  )
  await cp(resolve(root, 'supabase/seed.sql'), resolve(context.runtime, 'supabase/seed.sql'))
  const p = context.config.ports
  const replacements = {
    PROJECT_ID: context.config.projectId,
    API_PORT: p.api,
    DB_PORT: p.db,
    SHADOW_PORT: p.db + 5,
    STUDIO_PORT: p.studio,
    MAIL_PORT: p.mail,
    INSPECTOR_PORT: p.db + 6,
    APP_ORIGIN: context.config.appOrigin,
  }
  let config = await readFile(resolve(root, 'supabase/config.toml'), 'utf8')
  for (const [key, value] of Object.entries(replacements))
    config = config.replaceAll(`__${key}__`, String(value))
  await writeFile(resolve(context.runtime, 'supabase/config.toml'), config)
  await copyShared(resolve(context.runtime, 'supabase/functions/_shared/generated'))
  const serverConfigPath = resolve(context.runtime, 'supabase/functions/_shared/config.ts')
  await writeFile(
    serverConfigPath,
    (await readFile(serverConfigPath, 'utf8')).replaceAll("from 'zod'", "from 'npm:zod@4.6.7'"),
  )
  const keyPath = resolve(context.runtime, 'ledger.key')
  let ledgerKey = await readFile(keyPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (ledgerKey === null) {
    ledgerKey = randomBytes(32).toString('hex')
    await writeFile(keyPath, ledgerKey, { mode: 0o600, flag: 'wx' })
  }
  if (!/^[a-f0-9]{64}$/.test(ledgerKey)) throw new Error('Local ledger credential is invalid')
  await mkdir(resolve(context.runtime, 'ledger'), { recursive: true, mode: 0o700 })
  await writeFile(
    resolve(context.runtime, 'ledger/server.mjs'),
    await readFile(resolve(root, 'supabase/erasure-ledger/server.mjs')),
  )
  await writeFile(
    resolve(context.runtime, 'ledger.env'),
    `LOOPMARK_ERASURE_LEDGER_KEY=${ledgerKey}\n`,
    { mode: 0o600 },
  )
  const billingEnvironment = await fixtureEnvironment(context)
  await writeFile(
    resolve(context.runtime, 'supabase/functions/.env'),
    `LOOPMARK_ENVIRONMENT=local\nLOOPMARK_PROJECT_ID=${context.config.projectId}\nLOOPMARK_APP_ORIGIN=${context.config.appOrigin}\nLOOPMARK_CLOUD_ENROLLED=true\nLOOPMARK_ERASURE_LEDGER_URL=http://erasure-ledger:8787\nLOOPMARK_ERASURE_LEDGER_KEY=${ledgerKey}\n${billingEnvironment}`,
    { mode: 0o600 },
  )
}
export async function status(context) {
  const result = await cli(['status', '--output', 'json'], context)
  if (result.code) throw new Error('Local stack is unavailable. Run local:up for this worktree.')
  return JSON.parse(result.stdout)
}
const ledgerImage =
  'node:26.8.2-alpine@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868'
async function checkLedger(name) {
  const script = `for(let i=0;i<20;i++){try{const r=await fetch('http://127.0.0.1:8787/watermark',{method:'POST',headers:{authorization:'Bearer '+process.env.LOOPMARK_ERASURE_LEDGER_KEY,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(1000)});if(r.ok&&/^\\d+:[a-f0-9]{64}$/.test((await r.json()).watermark))process.exit(0)}catch{}await new Promise(r=>setTimeout(r,250))}process.exit(1)`
  const checked = await execute('docker', [
    'exec',
    name,
    'node',
    '--input-type=module',
    '-e',
    script,
  ])
  if (checked.code)
    throw new Error('Local erasure ledger is not ready; account deletion stays unavailable')
}
async function startLedger(context) {
  const name = `loopmark_erasure_ledger_${context.config.projectId}`
  const hash = createHash('sha256')
    .update(await readFile(resolve(context.runtime, 'ledger/server.mjs')))
    .update(await readFile(resolve(context.runtime, 'ledger.env')))
    .digest('hex')
  const existing = await execute('docker', [
    'inspect',
    '--format',
    '{{index .Config.Labels "loopmark.ledger.project"}} {{index .Config.Labels "loopmark.ledger.source"}}',
    name,
  ])
  if (!existing.code) {
    const [project, source] = existing.stdout.trim().split(' ')
    if (project !== context.config.projectId)
      throw new Error('Ledger container belongs to another project')
    if (source !== hash) {
      if (
        (await execute('docker', ['stop', name])).code ||
        (await execute('docker', ['rm', name])).code
      )
        throw new Error('Could not update this local ledger service')
    } else {
      if ((await execute('docker', ['start', name])).code)
        throw new Error('Could not start this local ledger service')
      await checkLedger(name)
      return
    }
  }
  if ((await execute('docker', ['image', 'inspect', ledgerImage])).code) {
    const pulled = await execute('docker', ['pull', ledgerImage])
    await writeFile(resolve(context.runtime, 'ledger-image.log'), pulled.stderr, { mode: 0o600 })
    if (pulled.code) throw new Error('The pinned local ledger image is unavailable')
  }
  const started = await execute('docker', [
    'run',
    '-d',
    '--name',
    name,
    '--label',
    `loopmark.ledger.project=${context.config.projectId}`,
    '--label',
    `loopmark.ledger.source=${hash}`,
    '--network',
    context.network,
    '--network-alias',
    'erasure-ledger',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--memory',
    '96m',
    '--cpus',
    '0.25',
    '--mount',
    `type=volume,source=${context.config.projectId}-erasure-ledger,target=/data`,
    '--mount',
    `type=bind,source=${resolve(context.runtime, 'ledger/server.mjs')},target=/app/server.mjs,readonly`,
    '--env-file',
    resolve(context.runtime, 'ledger.env'),
    ledgerImage,
    'node',
    '/app/server.mjs',
  ])
  if (started.code)
    throw new Error('Could not start the isolated erasure ledger; no host port is exposed')
  await checkLedger(name)
}
async function ensurePrivateBindings(context) {
  const names = await execute('docker', [
    'ps',
    '--filter',
    `label=com.supabase.cli.project=${context.config.projectId}`,
    '--format',
    '{{.Names}}',
  ])
  if (!names.stdout.trim()) throw new Error('No exact-project containers found')
  for (const name of names.stdout.trim().split('\n')) {
    const result = await execute('docker', [
      'inspect',
      '--format',
      '{{json .NetworkSettings.Ports}}',
      name,
    ])
    const ports = JSON.parse(result.stdout)
    for (const mappings of Object.values(ports))
      for (const binding of mappings ?? [])
        if (!['127.0.0.1', '::1'].includes(binding.HostIp)) {
          await cli(['stop'], context)
          throw new Error(`Local stack stopped: ${name} published a non-loopback port.`)
        }
  }
}
export async function main(args = process.argv.slice(2)) {
  const action = args[0] ?? 'status',
    context = await localContext()
  console.log(`Loopmark local ${action}: ${context.config.projectId} (${context.config.worktree})`)
  if (!['up', 'down', 'reset', 'status', 'prepare'].includes(action))
    throw new Error('Use up, down, reset, status or prepare.')
  const runtime = await execute('docker', ['info', '--format', '{{.ServerVersion}}'])
  if (runtime.code)
    throw new Error(
      'DEV_RUNTIME_UNAVAILABLE: Start Docker, then retry. Guest mode remains available.',
    )
  if (action === 'up' || action === 'prepare') {
    await configureBillingFixture(context, args)
    await prepare(context)
    if (action === 'prepare') return
    let existing = await cli(['status', '--output', 'json'], context)
    const configurationHash = createHash('sha256')
      .update(await readFile(resolve(context.runtime, 'supabase/config.toml')))
      .update(await readFile(resolve(context.runtime, 'supabase/templates/magic-link.html')))
      .update(await readFile(resolve(context.runtime, 'supabase/functions/.env')))
      .digest('hex')
    const previousHash = await readFile(
      resolve(context.runtime, 'applied-config.sha256'),
      'utf8',
    ).catch(() => null)
    if (!existing.code && previousHash !== configurationHash) {
      const stop = await cli(['stop'], context)
      if (stop.code)
        throw new Error(
          'Could not restart this local project to apply its updated Auth configuration.',
        )
      existing = { code: 1 }
    }
    if (existing.code) {
      for (const port of [
        ...Object.values(context.config.ports),
        context.config.ports.db + 5,
        context.config.ports.db + 6,
      ])
        if (!(await available(port)))
          throw new Error(
            `Port ${port} is occupied. Set LOOPMARK_DEV_PROFILE to a unique profile; no existing database was reused.`,
          )
    }
    const inspect = await execute('docker', [
      'network',
      'inspect',
      context.network,
      '--format',
      '{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}',
    ])
    if (inspect.code) {
      const network = await execute('docker', [
        'network',
        'create',
        '--label',
        `loopmark.project=${context.config.projectId}`,
        '--opt',
        'com.docker.network.bridge.host_binding_ipv4=127.0.0.1',
        context.network,
      ])
      if (network.code) throw new Error('Could not create the isolated local network.')
    } else if (inspect.stdout.trim() !== '127.0.0.1')
      throw new Error('Existing network is not configured for private loopback bindings.')
    await startLedger(context)
    await startBillingFixture(context, execute)
    console.log(
      'Starting isolated Auth, database, Storage, gateway and Edge services; cold image downloads may take several minutes.',
    )
    const start = await cli(
      ['start', '--exclude', 'studio,postgres-meta,imgproxy,logflare,vector,supavisor'],
      context,
    )
    await writeFile(resolve(context.runtime, 'startup.log'), start.stderr, { mode: 0o600 })
    if (start.code)
      throw new Error(
        `Local stack start failed (exit ${start.code}). Private diagnostic log: ${relative(root, context.runtime)}/startup.log`,
      )
    await ensurePrivateBindings(context)
    const migrations = await cli(['migration', 'up', '--local'], context)
    await writeFile(resolve(context.runtime, 'migration.log'), migrations.stderr, { mode: 0o600 })
    if (migrations.code)
      throw new Error(
        `Pending local migrations failed. Private diagnostic log: ${relative(root, context.runtime)}/migration.log`,
      )
    // Existing Edge workers cache transitive modules. Reload this exact project's worker
    // after copying the shared graph, without touching its database or other projects.
    const edge = await execute('docker', [
      'restart',
      `supabase_edge_runtime_${context.config.projectId}`,
    ])
    if (edge.code)
      throw new Error('The local Edge worker could not reload its current shared contracts.')
    await writeFile(resolve(context.runtime, 'applied-config.sha256'), configurationHash)
    const values = await status(context)
    const publicKey = values.PUBLISHABLE_KEY ?? values.ANON_KEY
    if (!publicKey) throw new Error('The local API did not expose a public key.')
    await writeFile(
      resolve(root, '.env.local'),
      `VITE_LOOPMARK_APP_ORIGIN=${context.config.appOrigin}\nVITE_LOOPMARK_SUPABASE_URL=${context.config.backendUrl}\nVITE_LOOPMARK_SUPABASE_ANON_KEY=${publicKey}\nLOOPMARK_DEV_PROFILE=${context.config.profile}\n`,
      { mode: 0o600 },
    )
    console.log(
      `Local sync ready: ${context.config.backendUrl}. Public-only configuration written to .env.local. Secrets were not printed.`,
    )
  } else if (action === 'down') {
    const stopped = await cli(['stop'], context)
    if (stopped.code) throw new Error('Local stack could not stop.')
    const ledgerName = `loopmark_erasure_ledger_${context.config.projectId}`
    const ledger = await execute('docker', [
      'inspect',
      '--format',
      '{{index .Config.Labels \"loopmark.ledger.project\"}}',
      ledgerName,
    ])
    if (!ledger.code && ledger.stdout.trim() === context.config.projectId)
      await execute('docker', ['stop', ledgerName])
    await stopBillingFixture(context, execute)
    console.log('Stopped this project; database and independent erasure-ledger volumes retained.')
  } else if (action === 'reset') {
    if (
      args[1] !== '--confirm-project' ||
      args[2] !== context.config.projectId ||
      args.length !== 3
    )
      throw new Error(
        `Reset requires --confirm-project ${context.config.projectId}; it erases only this local project.`,
      )
    await prepare(context)
    const result = await cli(['db', 'reset', '--local', '--yes'], context)
    await writeFile(resolve(context.runtime, 'reset.log'), result.stderr, { mode: 0o600 })
    if (result.code)
      throw new Error(
        `Local reset failed. Private diagnostic log: ${relative(root, context.runtime)}/reset.log`,
      )
    const edge = await execute('docker', [
      'restart',
      `supabase_edge_runtime_${context.config.projectId}`,
    ])
    if (edge.code)
      throw new Error('Database reset completed but the local Edge worker could not reload.')
    console.log('Only this local project was reset and migrated.')
  } else {
    await status(context)
    await ensurePrivateBindings(context)
    console.log(
      `Ready: ${context.config.backendUrl}; database loopback port ${context.config.ports.db}.`,
    )
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(root, 'scripts/local.mjs'))
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 2
  })
