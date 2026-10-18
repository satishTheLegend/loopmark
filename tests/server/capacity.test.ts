import { describe, expect, it } from 'vitest'
import { actor, command, project, quote, request, sql } from './helpers'
import { audioFixture, download, reserve, upload } from './media-fixtures'
import { canonicalHash, sha256Bytes } from '../../src/domain/canonical-json'
import { candidatePortableBytes, verifyCandidatePreparation } from '../../src/domain/remote-schema'
import type { CandidateMetadata } from '../../src/domain/remote-contracts'

describe('I07 full-capacity collection replacement', () => {
  it('commits 200 projects, 1000 checkpoints and 32 MiB of actual bytes; rejects insufficient physical budget before mutation', async () => {
    const a = await actor(),
      media = [1, 2, 3, 4].map((seed) => audioFixture(100 + seed, 8 * 1024 * 1024))
    const projects = Array.from({ length: 200 }, () => project('finished'))
    const candidate: CandidateMetadata = {
      projects,
      checkpoints: Array.from({ length: 1000 }, (_, i) => ({
        id: crypto.randomUUID(),
        projectId: projects[i % projects.length].id,
        createdAt: new Date().toISOString(),
        position: String(i),
        toolSize: '4 mm',
        nextStep: 'Continue',
        notes: '',
        ...(i < media.length ? { voice: media[i].ref } : {}),
      })),
    }
    const prep = {
      action: 'prepare',
      requestId: crypto.randomUUID(),
      destination: {
        collectionId: a.session.collection.collectionId,
        epoch: a.session.collection.epoch,
        revision: '0',
      },
      candidate,
    }
    const prepared = await request(a.token, 'collection-replace', prep)
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(200)
    const checked = await verifyCandidatePreparation(prepared.body)
    expect(checked.replacement).toMatchObject({
      projects: 200,
      checkpoints: 1000,
      mediaBytes: 33554432,
      portableBytes: candidatePortableBytes(candidate),
    })
    expect(checked.replacement.portableBytes).toBeLessThan(50331648)
    for (const item of media) {
      const reserved = await reserve(a, item.ref, {
        candidateId: checked.replacement.reservationId,
        epoch: checked.nextEpoch,
      })
      expect(reserved.status, JSON.stringify(reserved.body)).toBe(200)
      const uploaded = await upload(a, reserved.body, item.bytes)
      expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(200)
    }
    const commit = await command(
      a,
      {
        kind: 'collection.replace',
        payload: {
          reservationId: checked.replacement.reservationId,
          candidateSha256: checked.replacement.candidateSha256,
          nextEpoch: checked.nextEpoch,
        },
      },
      { revision: '0' },
    )
    const receipt = await request(a.token, 'sync-push', commit)
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(200)
    a.session.collection.epoch = checked.nextEpoch
    const fresh = await a.client.rpc('loopmark_candidate_current', {
      p_collection: a.session.collection.collectionId,
    })
    expect(fresh.error).toBeNull()
    expect(fresh.data.candidate.projects).toHaveLength(200)
    expect(fresh.data.candidate.checkpoints).toHaveLength(1000)
    const sorted = (metadata: CandidateMetadata) => ({
      projects: [...metadata.projects].sort((a, b) => a.id.localeCompare(b.id)),
      checkpoints: [...metadata.checkpoints].sort((a, b) => a.id.localeCompare(b.id)),
    })
    expect(await canonicalHash(sorted(fresh.data.candidate))).toBe(
      await canonicalHash(sorted(candidate)),
    )
    for (const item of media) {
      const actual = await download(a, item.ref)
      expect(actual.status).toBe(200)
      expect(await sha256Bytes(actual.bytes)).toBe(item.ref.sha256)
    }
    // Reserved but not uploaded bytes also consume conservative physical allocation.
    for (let i = 0; i < 4; i++)
      expect((await reserve(a, audioFixture(200 + i, 8388608).ref)).status).toBe(200)
    const replacement: CandidateMetadata = {
      projects,
      checkpoints: candidate.checkpoints.map((cp, i) =>
        i < 4 ? { ...cp, voice: audioFixture(300 + i, 8388608).ref } : cp,
      ),
    }
    const rejected = await request(a.token, 'collection-replace', {
      ...prep,
      requestId: crypto.randomUUID(),
      destination: {
        ...prep.destination,
        epoch: checked.nextEpoch,
        revision: receipt.body.revision,
      },
      candidate: replacement,
    })
    expect(rejected.body.error.code).toBe('MEDIA_CAPACITY_REACHED')
    expect(
      await sql(
        `select count(*) from loopmark_private.candidates where owner_id=${quote(a.id)}::uuid and state='prepared'`,
      ),
    ).toBe('0')
    const usage = await request(a.token, 'account-usage', {
      collectionId: a.session.collection.collectionId,
      epoch: checked.nextEpoch,
    })
    expect(usage.body).toMatchObject({
      projects: 200,
      checkpoints: 1000,
      storedBytes: 33554432,
      allocatedBytes: 67108864,
      ordinaryStagedBytes: 33554432,
      revision: receipt.body.revision,
    })
    expect((await request(a.token, 'sync-push', commit)).body).toEqual(receipt.body)
  }, 120_000)
})
