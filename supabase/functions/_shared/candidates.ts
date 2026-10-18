import type {
  CandidateMetadata,
  CandidatePreparation,
  AttachRequest,
  CandidateRequest,
} from './generated/domain/remote-contracts.ts'
import type { MediaRef } from './generated/domain/contracts.ts'
import { canonicalHash } from './generated/domain/canonical-json.ts'
import {
  candidateMetadataSchema,
  candidatePortableBytes,
  verifyCandidatePreparation,
  mergeCandidate,
} from './generated/domain/remote-schema.ts'
import { DomainError } from './generated/domain/errors.ts'
import { rpc } from './command.ts'
import { server } from './server.ts'
import type { authenticated } from './auth.ts'

function refs(candidate: CandidateMetadata): Map<string, MediaRef> {
  return new Map(
    candidate.checkpoints
      .flatMap((cp) => [cp.photo, cp.voice].filter((ref): ref is MediaRef => !!ref))
      .map((ref) => [ref.id, ref]),
  )
}
export async function prepareCandidate(
  mode: 'attach' | 'replace',
  request: AttachRequest | CandidateRequest,
  identity: Awaited<ReturnType<typeof authenticated>>,
) {
  if (request.action !== 'prepare')
    return await rpc(identity.client, 'loopmark_candidate_action', {
      p_id: request.reservationId,
      p_action: request.action,
    })
  const active = await rpc(identity.client, 'loopmark_candidate_current', {
    p_collection: request.destination.collectionId,
  })
  // Retry lookup belongs in the server transaction, so a committed request can recover even though active epoch changed.
  const existing = await rpc(server().client, 'loopmark_candidate_lookup', {
    p_owner: identity.user.id,
    p_request: request,
  })
  if (existing) return await verifyCandidatePreparation(existing)
  if (active.epoch !== request.destination.epoch) throw new DomainError('SYNC_REBASE_REQUIRED')
  if (active.revision !== request.destination.revision) throw new DomainError('REVISION_CONFLICT')
  const source = candidateMetadataSchema.parse(request.candidate)
  const destination = candidateMetadataSchema.parse(active.candidate)
  const {
    candidate: result,
    mediaMappings,
    additions,
    matches,
    copies,
    mappings,
  } = await mergeCandidate(mode, request.requestId, source, destination)
  candidateMetadataSchema.parse(result)
  const id = crypto.randomUUID(),
    expiresAt = new Date(Date.now() + 3_600_000).toISOString()
  const portableBytes = candidatePortableBytes(result)
  const preparation: CandidatePreparation = {
    mode,
    preview:
      mode === 'attach' && 'source' in request
        ? {
            id,
            source: request.source,
            destination: {
              key: {
                namespace: `account_${identity.user.id}`,
                collectionId: request.destination.collectionId,
                epoch: request.destination.epoch,
              },
              name: 'Personal projects',
              revision: request.destination.revision,
              email: identity.user.email!,
            },
            additions,
            matches,
            copies,
            mappings,
            resulting: {
              projects: result.projects.length,
              activeProjects: result.projects.filter((p) => p.status === 'active').length,
              checkpoints: result.checkpoints.length,
              portableBytes,
            },
            expiresAt,
          }
        : null,
    replacement: {
      reservationId: id,
      collectionId: request.destination.collectionId,
      epoch: request.destination.epoch,
      revision: request.destination.revision,
      candidateSha256: await canonicalHash(result),
      projects: result.projects.length,
      checkpoints: result.checkpoints.length,
      mediaBytes: [...refs(result).values()].reduce((sum, ref) => sum + ref.bytes, 0),
      portableBytes,
      expiresAt,
    },
    nextEpoch: crypto.randomUUID(),
    candidate: result,
    mediaMappings,
    requiredMedia: [...refs(result).values()],
    receipt: null,
  }
  return await verifyCandidatePreparation(
    await rpc(server().client, 'loopmark_candidate_prepare', {
      p_owner: identity.user.id,
      p_request: request,
      p_preparation: preparation,
    }),
  )
}
