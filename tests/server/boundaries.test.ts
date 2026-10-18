import { readFile } from 'node:fs/promises'
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { actor, command, createProject, localEnvironment, quote, request, sql } from './helpers'
import { canonicalHash } from '../../src/domain/canonical-json'
import { commandSchema, parseSnapshot } from '../../src/domain/schema'

async function deliveredCode(email: string) {
  const { localContext } = await import('../../scripts/local.mjs')
  const context = await localContext(),
    mailbox = `http://127.0.0.1:${context.config.ports.mail}`
  for (let attempt = 0; attempt < 30; attempt++) {
    const found = await (
      await fetch(`${mailbox}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    ).json()
    const messageId = found.messages?.[0]?.ID
    if (messageId) {
      const message = await (await fetch(`${mailbox}/api/v1/message/${messageId}`)).json()
      const code = String(message.Text || message.HTML).match(/\b\d{6}\b/)?.[0]
      if (!code) throw new Error('Local Auth delivered an email without a six-digit code')
      return code
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Local Auth email was not delivered')
}

describe('raw SQL authority, exact serialization and real authentication boundaries', () => {
  it('executes the SQL ownership and command suites against real roles', async () => {
    for (const name of ['ownership', 'commands'])
      await sql(await readFile(`supabase/tests/${name}.test.sql`, 'utf8'))
  })
  it('matches frozen cross-language hashes and the shared strict command schema', async () => {
    const vectors = JSON.parse(
      await readFile('tests/fixtures/expansion/canonical-vectors.json', 'utf8'),
    )
    for (const vector of vectors) {
      const encoded = quote(JSON.stringify(vector.input))
      expect(await sql(`select loopmark_private.canonical(${encoded}::jsonb)`)).toBe(
        vector.canonical,
      )
      expect(
        await sql(
          `select encode(extensions.digest(convert_to(loopmark_private.canonical(${encoded}::jsonb),'UTF8'),'sha256'),'hex')`,
        ),
      ).toBe(vector.sha256)
    }
    const checked = JSON.parse(await readFile('supabase/command.schema.json', 'utf8'))
    expect(checked).toEqual(z.toJSONSchema(commandSchema, { unrepresentable: 'any' }))
    expect(JSON.parse(await sql('select loopmark_private.command_schema()'))).toEqual(checked)
  })
  it('counts portable bytes exactly, including emoji and quoted MIME parameters', async () => {
    const a = await actor(),
      saved = await createProject(a)
    const voice = {
      id: crypto.randomUUID(),
      kind: 'voice' as const,
      mimeType: 'audio/webm; codecs="opus"',
      bytes: 3,
      sha256: 'a'.repeat(64),
    }
    const checkpoint = {
      id: crypto.randomUUID(),
      projectId: saved.project.id,
      createdAt: new Date().toISOString(),
      position: 'Row 🧶',
      toolSize: '4 mm',
      nextStep: 'Knit "one"\nrow',
      notes: '',
      voice,
    }
    const cmd = await command(
      a,
      { kind: 'checkpoint.create', payload: { checkpoint, updatedAt: checkpoint.createdAt } },
      { revision: '1' },
    )
    expect((await request(a.token, 'sync-push', cmd)).status).toBe(200)
    const { projectId: _project, ...portableCheckpoint } = checkpoint
    const expected = Buffer.byteLength(
      JSON.stringify({
        ...saved.project,
        updatedAt: checkpoint.createdAt,
        checkpoints: [{ ...portableCheckpoint, voice: `data:${voice.mimeType};base64,AAAA` }],
      }),
    )
    expect(
      Number(
        await sql(
          `select portable_bytes from loopmark_private.collections where owner_id=${quote(a.id)}::uuid`,
        ),
      ),
    ).toBe(expected)
  })
  it('enforces ten active devices including expired-device re-registration', async () => {
    const a = await actor(),
      oldDevice = a.session.device.id
    await sql(
      `update loopmark_private.devices set last_seen=now()-interval '91 days' where owner_id=${quote(a.id)}::uuid`,
    )
    for (let index = 0; index < 10; index++)
      expect(
        (await request(a.token, 'account-session', { deviceId: crypto.randomUUID() })).status,
      ).toBe(200)
    expect(
      (await request(a.token, 'account-session', { deviceId: crypto.randomUUID() })).body.error
        .code,
    ).toBe('TECHNICAL_CAPACITY_REACHED')
    expect(
      (await request(a.token, 'account-session', { deviceId: oldDevice, reregister: true })).body
        .error.code,
    ).toBe('TECHNICAL_CAPACITY_REACHED')
  })
  it('denies another owner snapshots and rejects oversized raw streamed bodies', async () => {
    const a = await actor(),
      b = await actor()
    const snapshot = parseSnapshot(
      (
        await request(a.token, 'sync-snapshot', {
          action: 'create',
          collectionId: a.session.collection.collectionId,
          purpose: 'hydrate',
        })
      ).body,
    )
    expect(
      (
        await request(b.token, 'sync-snapshot', {
          action: 'page',
          snapshotId: snapshot.snapshotId,
          after: null,
        })
      ).status,
    ).not.toBe(200)
    const env = await localEnvironment()
    const body = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 9; i++)
          controller.enqueue(new TextEncoder().encode(' '.repeat(32 * 1024)))
        controller.close()
      },
    })
    const response = await fetch(`${env.url}/functions/v1/sync-push`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${a.token}`,
        apikey: env.publicKey,
        'content-type': 'application/json',
      },
      body,
      duplex: 'half',
    } as RequestInit)
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('VALIDATION')
    expect(
      await sql(
        `select count(*) from loopmark_private.operation_receipts where owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('0')
  })
  it('verifies a delivered local OTP before issuing a short-lived one-use reauthentication proof', async () => {
    const a = await actor(),
      env = await localEnvironment()
    expect(
      (await request(a.token, 'account-session', { action: 'reauthenticate', code: '000000' })).body
        .error.code,
    ).toBe('AUTH_CODE_EXPIRED')
    const user = await a.client.auth.getUser()
    const email = user.data.user!.email!
    const sent = await a.client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
    expect(sent.error).toBeNull()
    const code = await deliveredCode(email)
    const fresh = await request(a.token, 'account-session', { action: 'reauthenticate', code })
    expect(fresh.status).toBe(200)
    expect(new Date(fresh.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(240_000)
    expect(
      await sql(
        `select proof_hash from loopmark_private.reauthentication_challenges where id=${quote(fresh.body.challengeId)}`,
      ),
    ).not.toBe(fresh.body.proof)
    const consume = `select loopmark_private.consume_reauthentication(${quote(a.id)}::uuid,${quote(fresh.body.challengeId)},${quote(fresh.body.proof)})`
    await sql(consume)
    // The secret proof never appears in failed command output; test replay via a catching block.
    expect(
      await sql(
        `do $$ begin begin ${consume}; raise exception 'Proof replay accepted'; exception when raise_exception then if sqlerrm<>'REAUTH_REQUIRED' then raise; end if; end; end $$; select 'replay-denied'`,
      ),
    ).toContain('replay-denied')
    expect(
      (await request(a.token, 'account-session', { action: 'reauthenticate', code })).status,
    ).not.toBe(200)
    expect(
      (
        await a.client.rpc('loopmark_issue_reauthentication', {
          p_owner: a.id,
          p_challenge: crypto.randomUUID(),
          p_hash: await canonicalHash('forged'),
        })
      ).error,
    ).not.toBeNull()
    expect(env.url.startsWith('http://127.0.0.1:')).toBe(true)
  })
  it('signs up a new synthetic user with a delivered OTP and refuses code replay', async () => {
    const env = await localEnvironment(),
      email = `loopmark-first-${crypto.randomUUID()}@example.invalid`
    const client = createClient(env.url, env.publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    expect((await client.auth.signInWithOtp({ email })).error).toBeNull()
    const code = await deliveredCode(email)
    const verified = await client.auth.verifyOtp({ email, token: code, type: 'email' })
    expect(verified.error).toBeNull()
    const response = await request(verified.data.session!.access_token, 'account-session', {
      deviceId: crypto.randomUUID(),
    })
    expect(response.status).toBe(200)
    expect(
      (await client.auth.verifyOtp({ email, token: code, type: 'email' })).error,
    ).not.toBeNull()
  })
})
