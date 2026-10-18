# I07 endpoint contract

Status: approved protocol, runtime implementation in progress. Canonical types and validators are `src/domain/remote-contracts.ts` and `remote-schema.ts`. The I03 protocol-2 command/receipt types remain authoritative. Every endpoint is POST; all except deletion-status require a verified Supabase bearer JWT and active account. JSON failures use the existing safe error envelope. Binary endpoints return the same JSON envelope on failure. Responses are private/no-store/noindex. Origin policy is the configured web origin plus the two verified Capacitor origins.

## Candidate metadata and atomic attachment/replacement

`CandidateMetadata = { projects: ProjectCreate[], checkpoints: CheckpointCreate[] }`. These are existing domain types: no local revision, grant, sample flag, ownership field, inline bytes, or provider object. MediaRefs remain attached to checkpoints. Validation covers unique record IDs/codes, all project relationships, consistent repeated media descriptors, field limits, exact portable bytes, and the complete collection caps. Metadata is bounded at 8 MiB before parsing.

`collection-attach` prepare request:

```ts
{
  action: 'prepare', requestId: string,
  source: { key: CollectionKey, name: string, revision: Revision },
  destination: { collectionId: string, epoch: string, revision: Revision },
  candidate: CandidateMetadata
}
```

The server verifies the destination revision, computes additions/matches/copies and collision mappings, builds the complete merged candidate, and reserves it. The response is `CandidatePreparation`: `{ mode: 'attach', preview: AttachPreview, replacement: ReplacementPreview, nextEpoch, candidate, mediaMappings, requiredMedia, receipt }`. It includes the complete final mapped metadata bound by candidateSha256, every source-media-ID to destination-ref mapping, distinct still-required final media refs, and null receipt until commit. `preview.id` equals `replacement.reservationId`. The server supplies the authenticated destination email; the caller supplies the local display/source metadata and must recheck its pinned local revision before confirmation. All declared source and destination fields are included in the immutable preparation hash. The same request ID and hash returns the same reservation; changed bytes under that ID reject. A source revision is a client precondition, not server authority over local storage.

`collection-replace` prepare uses `{ action:'prepare', requestId, destination, candidate }`, returns the same CandidatePreparation with `mode: 'replace'` and `preview: null`, and stages a complete replacement rather than a merge. Both modes permit only one active candidate per account and expire after one hour.

Both endpoints accept `{ action:'status', reservationId }` to recover the same bound preview, complete metadata/mappings and original receipt when committed, and `{ action:'cancel', reservationId }` returning `{ cancelled:true }`. Cancel is idempotent, preserves active data, and queues reference-safe candidate cleanup.

Commit is the existing immutable `collection.replace` command sent through `sync-push`: payload reservationId/candidateSha256/nextEpoch, exact old collection revision and epoch, normal operation ID/device sequence/hash. The server verifies that every required media object is present, then swaps the complete active set and epoch in one transaction and returns the existing Receipt. Attachment therefore uses the same atomic swap after constructing the merged collection. No partial upload or candidate preview mutates the active set. Other clients rebase through the ordinary epoch-change path. Local source and pending work remain preserved by the client.

## Ordinary and candidate media

`media-upload` JSON reserve request is `{ action:'reserve', requestId, upload: UploadRequest, candidateId?:string }`; response is the existing UploadReservation. The stable request ID identifies the reservation. Optional candidateId routes admission to the separately bounded replacement reservation and its exact descriptor inventory. It does not bypass the candidate's expiry, ownership, epoch, deletion generation or 40 MiB/80 MiB limits. Ordinary reservations retain four-upload/32 MiB/15-minute limits.

For the bytes, POST `application/octet-stream` to `media-upload` with `x-loopmark-reservation-id`, bearer JWT and apikey. The server obtains expected kind/type/bytes/hash from the reservation, caps the stream and deadline, verifies actual bytes, and writes a new private immutable object without upsert. Response `{ reservationId, verified:true }` acknowledges verified staging only. Retrying must verify equal bytes and cannot overwrite a committed object. `{ action:'cancel', reservationId }` returns `{ cancelled:true }` and schedules reference-safe cleanup.

Ordinary media attaches using the existing `media.attach` command through `sync-push`; `media-finalize` is an alias accepting that exact command and returning the same Receipt. The checkpoint is the CAS target; its owning project also advances. Both paths share one SQL command transaction and receipt identity. Candidate uploads are ready only inside the candidate until collection.replace commits their references. No separate client grant or ready flag is authoritative.

`media-download` JSON body is `{ collectionId, epoch, mediaId, snapshotId?:string }`. Success returns verified private bytes with stored Content-Type, length, no-store and no public/signed URL. Snapshot downloads require the matching active lease and pinned descriptor. Active account state is checked for every request. Old immutable objects remain pinned until valid export leases and recovery retention release them; deletion overrides export leases.

## Deletion and independent erasure ledger

`account-delete` body is `{ requestId, receiptTokenHash, reauthentication: ReauthenticationProof }`. The client generates and durably saves a random 256-bit raw receipt token before sending only its SHA-256 hash. Server preparation consumes the fresh one-use proof and durably binds the request/hash to the verified owner and next deletion generation. It then appends the minimal ErasureIntent to the independent ledger, and only afterward atomically disables the primary account/devices and queues deletion. Equal request/hash retries recover the same authorization; changed hashes reject. No raw receipt token or reauth proof is stored in either ledger.

`deletion-status` body is `{ requestId, receiptToken }` and requires no surviving login. It hashes the token, performs a rate-limited lookup, and returns only the existing DeletionReceipt. A lost account-delete response can use the same token. Primary-state loss after an acknowledged independent append is reconciled from that ledger, preserving the original receipt hash. Incorrect/expired capabilities disclose no account/project/payment fields. Tokens never appear in URLs.

The independent ledger port is the frozen ErasureLedger interface. Approved local implementation: a separately mounted append-only, fsync-backed service with its own persistent Docker volume, outside the primary database and database reset/backup path. Authenticated idempotent append, strongly consistent bounded inventory and a verifiable hash-chain watermark are required. The local environment does not prove an independent physical failure domain; production configuration must point to separately operated durable storage and pass the I11 restore/erasure drill. An unavailable/stale ledger fails append and restoration closed.

Root-owned configuration supplies `LOOPMARK_ERASURE_LEDGER_URL` and `LOOPMARK_ERASURE_LEDGER_KEY` as a required pair; the key is a redacted Secret. Local URL accepts exactly http://erasure-ledger:8787 or loopback; nonlocal requires HTTPS. No server key enters public/native configuration. The local launcher will manage only the exact profile's additional service and preserve its ledger volume on down/reset.

## Enrollment and provider boundary

I08 billing-config is an authenticated enrolled endpoint, request `{ platform:'ios'|'android' }`, response `{ platform, publicSdkKey, productIds, environment }`. Only approved public platform SDK keys and server-approved product IDs are returned; service/provider secrets remain server-only. It confers no entitlement. ServerConfig.nativeBilling retains only these approved public fields; provider secrets remain redacted server-only values. Actual provider sandbox and production qualification remain separate gates.

Pre-replacement snapshots retain their immutable record and media inventory until lease expiry and remain downloadable in their original epoch. Deletion overrides leases. Account deletion fails closed without the independent ledger; live cloud release requires ledger readiness and the I11 restore proof. No runtime test is claimed by this protocol document.
