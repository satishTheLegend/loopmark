import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { AccountSession, Command, Mutation } from '../../src/domain/contracts'
import { signCommand } from '../../src/domain/schema'
const run = promisify(execFile)
let environment:
  | { url: string; publicKey: string; serviceKey: string; projectId: string; runtime: string }
  | undefined
export async function localEnvironment() {
  if (environment) return environment
  const { localContext } = await import('../../scripts/local.mjs')
  const context = await localContext()
  const { stdout } = await run(
    resolve('node_modules/.bin/supabase'),
    ['status', '--output', 'json', '--workdir', context.runtime],
    { env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' } },
  )
  const status = JSON.parse(stdout)
  const url = status.API_URL
  if (!url || new URL(url).hostname !== '127.0.0.1' || url !== context.config.backendUrl)
    throw new Error('Test target must be this exact loopback worktree stack')
  environment = {
    url,
    publicKey: status.ANON_KEY ?? status.PUBLISHABLE_KEY,
    serviceKey: status.SERVICE_ROLE_KEY ?? status.SECRET_KEY,
    projectId: context.config.projectId,
    runtime: context.runtime,
  }
  return environment
}
export async function sql(statement: string) {
  const env = await localEnvironment()
  try {
    const result = await run(
      'docker',
      [
        'exec',
        `supabase_db_${env.projectId}`,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-X',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        statement,
      ],
      { maxBuffer: 2 * 1024 * 1024 },
    )
    return result.stdout.trim()
  } catch (error) {
    // execFile's default error includes the full SQL command. Proof fixtures may be
    // arguments, so report only a stable uppercase SQL error code when available.
    const safe = String((error as { stderr?: string }).stderr ?? '').match(
      /^ERROR:\s+([A-Z_]+)\s*$/m,
    )?.[1]
    throw new Error(`Local SQL assertion failed${safe ? `: ${safe}` : ''}`)
  }
}
export const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'"
export interface Actor {
  id: string
  token: string
  client: SupabaseClient
  session: AccountSession
  sequence: number
}
export async function actor(): Promise<Actor> {
  const env = await localEnvironment(),
    admin = createClient(env.url, env.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  const email = `loopmark-${randomUUID()}@example.invalid`,
    password = `LocalTest-${randomUUID()}`
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user)
    throw new Error('Synthetic local Auth user creation failed')
  const client = createClient(env.url, env.publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const login = await client.auth.signInWithPassword({ email, password })
  if (login.error || !login.data.session) throw new Error('Synthetic local Auth sign-in failed')
  const token = login.data.session.access_token
  const response = await request(token, 'account-session', { deviceId: randomUUID() })
  if (response.status !== 200)
    throw new Error(
      `Local account-session failed: ${response.status} ${JSON.stringify(response.body)}`,
    )
  return { id: created.data.user.id, token, client, session: response.body, sequence: 0 }
}
export async function request(token: string, path: string, body: unknown) {
  const env = await localEnvironment()
  const response = await fetch(`${env.url}/functions/v1/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      apikey: env.publicKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json(), headers: response.headers }
}
export async function command(
  owner: Actor,
  mutation: Mutation,
  base: Command['base'] = null,
): Promise<Command> {
  return signCommand({
    ...mutation,
    protocolVersion: 2,
    payloadVersion: 1,
    collectionId: owner.session.collection.collectionId,
    epoch: owner.session.collection.epoch,
    deviceId: owner.session.device.id,
    deviceGeneration: owner.session.device.generation,
    sequence: String(++owner.sequence),
    operationId: randomUUID(),
    base,
  })
}
export function project(status: 'active' | 'finished' = 'active') {
  const id = randomUUID(),
    now = new Date().toISOString()
  return {
    id,
    code: `LM-${id.slice(0, 8).toUpperCase()}`,
    name: 'Synthetic scarf 🧶',
    craft: 'Knitting' as const,
    color: 'sage' as const,
    yarn: 'Test yarn',
    toolSize: '4 mm',
    notes: '',
    status,
    createdAt: now,
    updatedAt: now,
  }
}
export async function createProject(owner: Actor, status: 'active' | 'finished' = 'active') {
  const value = project(status),
    cmd = await command(owner, { kind: 'project.create', payload: { project: value } })
  const response = await request(owner.token, 'sync-push', cmd)
  if (response.status !== 200)
    throw new Error(`Synthetic create failed: ${response.status} ${JSON.stringify(response.body)}`)
  return { project: value, cmd, receipt: response.body }
}
export const pullRequest = (owner: Actor, afterCursor = '0') => ({
  collectionId: owner.session.collection.collectionId,
  epoch: owner.session.collection.epoch,
  afterCursor,
  deviceId: owner.session.device.id,
  deviceGeneration: owner.session.device.generation,
})
