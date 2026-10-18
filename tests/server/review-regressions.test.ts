import { describe, it, expect } from 'vitest'
import {
  actor,
  command,
  localEnvironment,
  project,
  pullRequest,
  quote,
  request,
  sql,
} from './helpers'
import { parseSnapshot } from '../../src/domain/schema'
import { emptyCollection, hydrateState } from '../../src/repositories/state'

describe('I03 independent review regressions on real services', () => {
  it('hydrates byte-bounded pages with shared media declared once across the whole chain', async () => {
    const a = await actor(),
      value = { ...project(), id: `p${crypto.randomUUID().replaceAll('-', '')}`.padEnd(80, 'p') }
    const created = await command(a, { kind: 'project.create', payload: { project: value } })
    expect((await request(a.token, 'sync-push', created)).status).toBe(200)
    const mime = (type: string) => {
      const prefix = `${type}; codecs="`
      return prefix + 'a'.repeat(99 - prefix.length) + '"'
    }
    const photo = {
      id: 'photo'.padEnd(80, 'p'),
      kind: 'photo' as const,
      bytes: 3,
      mimeType: mime('image/png'),
      sha256: 'a'.repeat(64),
    }
    const voice = {
      id: 'voice'.padEnd(80, 'v'),
      kind: 'voice' as const,
      bytes: 3,
      mimeType: mime('audio/webm'),
      sha256: 'b'.repeat(64),
    }
    for (let index = 0; index < 55; index++) {
      await sql(
        `update loopmark_private.rate_buckets set refilled_at=now()-interval '1 minute' where owner_id=${quote(a.id)}::uuid and kind='command'`,
      )
      const checkpoint = {
        id: `cp${String(index).padStart(4, '0')}`.padEnd(80, 'c'),
        projectId: value.id,
        createdAt: new Date().toISOString(),
        position: '編'.repeat(100),
        toolSize: '編'.repeat(80),
        nextStep: '編'.repeat(1000),
        notes: '編'.repeat(2000),
        photo,
        voice: { ...voice, id: `voice${String(index).padStart(4, '0')}`.padEnd(80, 'v') },
      }
      const cmd = await command(
        a,
        { kind: 'checkpoint.create', payload: { checkpoint, updatedAt: checkpoint.createdAt } },
        { revision: String(index + 1) },
      )
      expect((await request(a.token, 'sync-push', cmd)).status).toBe(200)
    }
    const pages = [
      parseSnapshot(
        (
          await request(a.token, 'sync-snapshot', {
            action: 'create',
            collectionId: a.session.collection.collectionId,
            purpose: 'hydrate',
          })
        ).body,
      ),
    ]
    expect(pages[0].projects.length + pages[0].checkpoints.length).toBeLessThan(50)
    while (pages.at(-1)!.nextPage !== null) {
      const prior = pages.at(-1)!
      pages.push(
        parseSnapshot(
          (
            await request(a.token, 'sync-snapshot', {
              action: 'page',
              snapshotId: prior.snapshotId,
              after: prior.nextPage,
            })
          ).body,
        ),
      )
    }
    for (const page of pages)
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(512 * 1024)
    const declared = pages.flatMap((page) => page.media).map((ref) => ref.id)
    expect(declared).toHaveLength(56)
    expect(new Set(declared).size).toBe(56)
    expect(declared.filter((id) => id === photo.id)).toHaveLength(1)
    const state = emptyCollection({
      key: a.session.collection,
      name: 'Synthetic hydration',
      kind: 'connected',
      accountId: a.id,
      createdAt: new Date().toISOString(),
      legacyAccess: false,
    })
    hydrateState(state, pages, Date.now())
    expect(state.hydration).toBe('ready')
    expect(state.projects).toHaveLength(1)
    expect(state.checkpoints).toHaveLength(55)
    const pull = (await request(a.token, 'sync-pull', pullRequest(a))).body
    expect(Buffer.byteLength(JSON.stringify(pull))).toBeLessThanOrEqual(512 * 1024)
    expect(pull.entries.length).toBeLessThan(50)
    expect(pull.hasMore).toBe(true)
  })
  it('visits accounts beyond the batch limit on sequential compaction runs', async () => {
    const targets = await Promise.all([actor(), actor(), actor()])
    // Existing retained/load accounts keep their real progress. Exercise the new cohort's
    // pending work, rather than resetting every account and scaling this small regression
    // with all previously retained stress fixtures.
    const count = Number(
      await sql(
        "select count(*) from loopmark_private.accounts where state='active' and compacted_at is null",
      ),
    )
    expect(count).toBeGreaterThan(2)
    for (let index = 0; index < Math.ceil(count / 2); index++) {
      const processed = await sql(
        'begin;set local request.jwt.claims=\'{"role":"service_role"}\';select public.loopmark_compact(2);commit;',
      )
      expect(processed).toContain('\n2\n')
    }
    expect(
      await sql(
        `select count(*) from loopmark_private.accounts where id in (${targets.map((a) => quote(a.id) + '::uuid').join(',')}) and compacted_at is null`,
      ),
    ).toBe('0')
  })
  it('allows only the configured web origin and the two verified native WebView origins', async () => {
    const a = await actor(),
      env = await localEnvironment()
    const { localContext } = await import('../../scripts/local.mjs')
    const webOrigin = (await localContext()).config.appOrigin
    for (const origin of [webOrigin, 'capacitor://localhost', 'https://localhost']) {
      const headers = {
        origin,
        authorization: `Bearer ${a.token}`,
        apikey: env.publicKey,
        'content-type': 'application/json',
      }
      const preflight = await fetch(`${env.url}/functions/v1/account-session`, {
        method: 'OPTIONS',
        headers,
      })
      expect(preflight.status).toBe(204)
      // The pinned Supabase gateway handles OPTIONS and overwrites CORS response
      // headers with '*'. Actual authenticated POSTs exercise the Edge allowlist.
      expect([origin, '*']).toContain(preflight.headers.get('access-control-allow-origin'))
      const response = await fetch(`${env.url}/functions/v1/account-session`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ deviceId: a.session.device.id }),
      })
      expect(response.status).toBe(200)
      expect([origin, '*']).toContain(response.headers.get('access-control-allow-origin'))
    }
    for (const origin of [
      'https://localhost.evil.invalid',
      'capacitor://evil.invalid',
      'https://evil.invalid',
      'null',
    ]) {
      const response = await fetch(`${env.url}/functions/v1/account-session`, {
        method: 'POST',
        headers: {
          origin,
          authorization: `Bearer ${a.token}`,
          apikey: env.publicKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ deviceId: a.session.device.id }),
      })
      expect(response.status).toBe(403)
      expect((await response.json()).error.code).toBe('NOT_AVAILABLE')
    }
  })
})
