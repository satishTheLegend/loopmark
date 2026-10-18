import { describe, expect, it } from 'vitest'
import { canonicalHash } from '../../src/domain/canonical-json'
import {
  candidateMetadataSchema,
  candidatePortableBytes,
  nativeBillingConfigSchema,
  verifyCandidatePreparation,
} from '../../src/domain/remote-schema'
import type { CandidateMetadata, CandidatePreparation } from '../../src/domain/remote-contracts'
const candidate: CandidateMetadata = {
  projects: [
    {
      id: 'project',
      code: 'P-001',
      name: '編み物',
      craft: 'Crochet',
      color: 'clay',
      yarn: '',
      toolSize: '',
      notes: '',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  checkpoints: [
    {
      id: 'checkpoint',
      projectId: 'project',
      createdAt: '2026-01-01T00:00:00.000Z',
      position: '',
      toolSize: '',
      nextStep: '続ける',
      notes: '',
      voice: {
        id: 'voice',
        kind: 'voice',
        mimeType: 'audio/webm;codecs="opus"',
        bytes: 3,
        sha256: 'a'.repeat(64),
      },
    },
  ],
}
describe('remote candidate contracts', () => {
  it('accounts for serialized project objects and escaped MIME bytes', () => {
    const { projectId: _parent, voice: _ref, ...checkpoint } = candidate.checkpoints[0]
    const portable = {
      format: 'loopmark',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      projects: [
        {
          ...candidate.projects[0],
          checkpoints: [{ ...checkpoint, voice: 'data:audio/webm;codecs="opus";base64,YWJj' }],
        },
      ],
    }
    expect(candidatePortableBytes(candidate)).toBe(
      new TextEncoder().encode(JSON.stringify(portable.projects[0])).length,
    )
    expect(candidateMetadataSchema.safeParse(candidate).success).toBe(true)
  })
  it('rejects cross-record collisions, broken relationships and conflicting repeated media', () => {
    for (const changed of [
      { ...candidate, checkpoints: [{ ...candidate.checkpoints[0], id: 'project' }] },
      { ...candidate, checkpoints: [{ ...candidate.checkpoints[0], projectId: 'missing' }] },
      {
        ...candidate,
        checkpoints: [
          candidate.checkpoints[0],
          {
            ...candidate.checkpoints[0],
            id: 'checkpoint2',
            voice: { ...candidate.checkpoints[0].voice!, sha256: 'b'.repeat(64) },
          },
        ],
      },
      { ...candidate, projects: [{ ...candidate.projects[0], sample: true }] },
    ])
      expect(candidateMetadataSchema.safeParse(changed).success).toBe(false)
  })
  it('binds complete mapped metadata to its hash and exact preview', async () => {
    const value: CandidatePreparation = {
      mode: 'replace',
      preview: null,
      nextEpoch: 'next',
      candidate,
      mediaMappings: [{ sourceId: 'voice', destination: candidate.checkpoints[0].voice! }],
      requiredMedia: [candidate.checkpoints[0].voice!],
      receipt: null,
      replacement: {
        reservationId: 'reservation',
        collectionId: 'collection',
        epoch: 'old',
        revision: '0',
        candidateSha256: await canonicalHash(candidate),
        projects: 1,
        checkpoints: 1,
        mediaBytes: 3,
        portableBytes: candidatePortableBytes(candidate),
        expiresAt: '2026-11-01T00:00:00.000Z',
      },
    }
    await expect(verifyCandidatePreparation(value)).resolves.toEqual(value)
    await expect(
      verifyCandidatePreparation({
        ...value,
        candidate: { ...candidate, projects: [{ ...candidate.projects[0], name: 'different' }] },
      }),
    ).rejects.toThrow()
    await expect(
      verifyCandidatePreparation({
        ...value,
        requiredMedia: [...value.requiredMedia, ...value.requiredMedia],
      }),
    ).rejects.toThrow()
    await expect(verifyCandidatePreparation({ ...value, nextEpoch: 'old' })).rejects.toThrow()
  })
  it('never accepts a native secret or key for the other platform', () => {
    expect(
      nativeBillingConfigSchema.safeParse({
        platform: 'ios',
        publicSdkKey: 'appl_' + 'a'.repeat(16),
        productIds: ['loopmark.lifetime'],
        environment: 'sandbox',
      }).success,
    ).toBe(true)
    for (const publicSdkKey of ['sk_secret_' + 'a'.repeat(16), 'goog_' + 'a'.repeat(16)])
      expect(
        nativeBillingConfigSchema.safeParse({
          platform: 'ios',
          publicSdkKey,
          productIds: ['loopmark.lifetime'],
          environment: 'sandbox',
        }).success,
      ).toBe(false)
  })
})
