# Expansion engineering contract

18 October 2026. Reviewed specification. Project-local implementation is authorized by the user’s standing BUILD AND VERIFY delegation after this review. None of the new modules, services or commands below is implemented. The existing local foundation remains verified separately. This contract refines every X01–X10 requirement and the CEO, Design and DX amendments without dropping scope.

## Architecture and ownership

```text
Existing React screens / forms / BagLabel / backup
                |
    application services + collection session generation
       |                 |                     |
  Repository         SyncCoordinator       BillingCoordinator
   /      \           |    |    |             /       \
 IDB     SQLite    Auth  SyncTransport Media  web       native
  |       |             |           |      Razorpay  RevenueCat
 blob    durable        +----- authenticated commands ----+
 store   file bridge                  |                  |
                      Supabase Edge handlers + Postgres  |
                         command RPC / RLS / private Storage
                                      |
                    durable jobs: billing, deletion, backups
```

Use a modular application in the current repository, one managed backend and provider adapters. Do not split into microservices or create a public SDK. `src/domain` owns schemas/pure policy; `src/repositories` owns durable records; `src/sync` owns retries; `src/platform` owns browser/native capabilities; `src/billing` owns client purchase intent; `supabase/functions` owns authenticated boundaries and workers; `supabase/migrations` owns command invariants. UI calls application services rather than provider SDKs.

The integrator alone edits `src/App.tsx`, `src/types.ts`, `src/data.ts`, package manifests/lockfiles, global styles, CI and shared protocol after its contract freeze. Parallel owners receive disjoint directories and import the frozen interfaces. Keep `src/data.ts` as a compatibility facade while migrating callers. Do not rewrite the old `loopmark` or `loopmark-drafts` database in place: copy validated records into a new versioned local store, compare counts and media hashes, mark a durable migration receipt, then switch the reader. Keep the old store available for explicit recovery until a successful independent export/restore. Never delete it automatically during rollout.

## Exact interfaces

Place public application contracts in `src/domain/contracts.ts`, schemas in `src/domain/schema.ts`, typed errors in `src/domain/errors.ts` and pure capacity/entitlement rules in `src/domain/policy.ts`. These are planned interfaces, not existing exports.

```ts
type Revision = string // decimal bigint, never a JS number
type CollectionKey = { namespace: string; collectionId: string; epoch: string }
type Generation = number // local session fence, not authorization
type Base = { revision: Revision } | { afterOperationId: string }
type Command = {
  protocolVersion: 2; payloadVersion: 1;
  collectionId: string; epoch: string; deviceId: string; deviceGeneration: string;
  sequence: Revision; operationId: string; kind: CommandKind;
  base: Base | null; payload: unknown; sha256: string;
}
type Receipt = {
  operationId: string; sha256: string; epoch: string;
  revision: Revision; cursor: Revision; resultId: string;
}
interface Repository {
  commitLocal(key: CollectionKey, intent: LocalIntent, generation: Generation): Promise<LocalCommit>;
  readView(key: CollectionKey): Promise<CollectionView>;
  applyPage(key: CollectionKey, page: PullPage, generation: Generation): Promise<void>;
  acknowledge(key: CollectionKey, receipt: Receipt, generation: Generation): Promise<void>;
  recoverPending(key: CollectionKey, reason: RecoveryReason): Promise<CollectionKey>;
  snapshot(key: CollectionKey): Promise<LocalSnapshot>;
}
interface SyncTransport {
  push(command: Command, signal: AbortSignal): Promise<Receipt>;
  pull(input: PullRequest, signal: AbortSignal): Promise<PullPage>;
  snapshot(input: SnapshotRequest, signal: AbortSignal): Promise<SnapshotManifest>;
}
interface PlatformMedia {
  prepare(input: MediaInput, scope: CollectionKey): Promise<PreparedMedia>;
  open(ref: MediaRef): Promise<ReadableStream<Uint8Array>>;
  release(ref: MediaRef): Promise<void>;
}
interface BillingAdapter {
  products(): Promise<LocalizedProduct[]>;
  purchase(intent: PurchaseIntent): Promise<PurchaseOutcome>;
  restore(): Promise<PurchaseOutcome>;
}
```

Define all referenced discriminated unions in the same contract task, including empty results, cancellation, permanent rejection, conflict, retryable overload and unavailable capability. No `any`, provider object or service-role key crosses these interfaces. Cancellation can occur after a server commit; it never means the operation was rolled back. An attempted operation ID and hash are immutable.

## Local intent and synchronization

Store acknowledged server entities separately from ordered pending local intent. The visible view is the acknowledged shadow plus the local overlay; pulls never overwrite pending work. Device-local sequence numbers allocate in the same transaction as intent and record changes. A project create followed by two edits uses `base: {afterOperationId}` dependencies; the server resolves the predecessor receipt under the same collection lock. This reference is part of the frozen hashed payload, so no attempted payload is rewritten just to insert a later revision. Unattempted adjacent metadata edits may coalesce before assigning a wire operation; immutable checkpoints never coalesce. A remote intervening edit produces a real conflict, not silent last-write-wins.

Hash the validated command excluding `sha256` using shared recursive key-sorted JSON, UTF-8 and SHA-256. Reject unknown keys, non-finite numbers and unsupported versions. Both client and server have fixed conformance vectors, including Unicode and optional fields. Owner comes exclusively from the verified session; a supplied account ID is not authority. The server atomically saves effect, quota delta, feed row and receipt. Duplicate ID with equal hash returns the original receipt; different hash returns `OPERATION_REUSED`. Acknowledgement atomically advances the shadow and removes only the matching intent. A pull arriving first recognizes the operation ID and cannot create a duplicate effect.

Each account has one connected collection in this release; multiple named guest, retained and recovered local collections are allowed. Lock order is account state → collection → device → affected records sorted by ID. Every connected mutation obtains the collection row lock before incrementing its transactional `next_cursor`; do not allocate the change cursor from an independent PostgreSQL sequence. The lock remains held through commit, so a later visible cursor cannot skip an earlier uncommitted mutation. This is an application design derived from PostgreSQL's transaction-held row locks; it requires the concurrency test, not an assumption of correctness. [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html)

`pull` returns at most 50 entries or 512 KiB, with `(epoch, afterCursor, nextCursor, hasMore)`. Apply the page, receipt reconciliation and cursor in one local transaction. On failure replay the page. Realtime only requests a pull. Initial hydration creates an immutable metadata snapshot plus its cursor under a short collection lock; paginate that frozen snapshot, then pull strictly after its cursor. Snapshot IDs are random, account-bound and expire after one hour; renewal requires an active session and an unchanged snapshot. Replacement changes the epoch, invalidates old cursors and moves old local pending intent to a named recovered collection before hydration.

Device lease: at most 10 active devices per account, renewed on authenticated sync. After 90 days without contact, retire its generation. New operations require explicit re-registration and full rebase; preserve old pending work in recovery. Maintain a per-device compacted sequence floor. Receipts older than 90 days can be removed only after advancing that floor; retries below it receive `REBASE_REQUIRED`, never execute again. Retain tombstones/feed for 90 days or longer while an unexpired snapshot needs them; older cursors require full hydration. Retiring a device is visible and never deletes its local collection.

## Authorization and server data

Planned tables: `accounts`, `collections`, `projects`, `checkpoints`, `media`, `devices`, `operation_receipts`, `change_feed`, `snapshots`, `snapshot_media`, `upload_reservations`, `billing_principals`, `purchase_grants`, `entitlement_projection`, `webhook_inbox`, `deletion_requests`, `jobs`, `audit_events`. Internal tables live in a non-exposed schema; composite owner/collection foreign keys prevent accidental cross-owner references. Unique constraints bind operation IDs, device sequence, record IDs, canonical purchases and provider event IDs. Index collection/cursor; owner/status; job/status/next-attempt; grant/principal/state; media/account/hash. Check query plans under the load fixture before adding extra indexes.

Anonymous users get only health/public-policy routes and rate-limited authentication initiation. Authenticated users may read authorized views and execute explicitly granted command RPCs; they cannot directly insert/update/delete invariant-bearing tables, receipts, feed, quota, billing or job rows. Worker roles have only their required RPC permissions. RLS checks owner **and active account state**, including Storage reads. Security-definer functions have a fixed empty search path, qualified objects, explicit verified identity/state checks and revoked default PUBLIC/anon execution. Audit grants in migrations and test same-owner direct bypass, not just cross-account access. [Supabase database-function security](https://supabase.com/docs/guides/database/functions)

Prefer same-origin authenticated media proxy/download requests with `Cache-Control: private, no-store`; do not persist bearer signed download URLs. Each request checks active account state. Already downloaded/cached private bytes cannot be recalled; that limit is explicit. Requests authorized before the deletion barrier may finish, but no new authenticated read succeeds after it. Client cache/service worker must never cache account API responses; media cache uses account/epoch/generation-scoped repository storage.

Web auth uses provider PKCE/code flow, redirect allowlist and state/nonce validation. Persist refresh credentials in the supported SDK store with restrictive CSP, no third-party execution on private routes and no unsafe HTML injection; do not claim browser storage is a hardware secret vault. Native refresh credentials use the verified secure-storage adapter. Never use its web plaintext fallback. Short-lived access credentials remain in memory; generation fencing rejects late auth callbacks. Require a fresh one-time reauthentication challenge for account deletion and sensitive purchase recovery, not merely an old token's issuance timestamp. Rate-limit code requests and verification and provide offline help without exposing account existence.

## Media, quotas and native durability

Native media writes use immutable account/epoch-scoped files: write temporary bytes → validate type/size/hash → durable flush/close and same-volume rename → transact record, file reference and outbox in SQLite → acknowledge save. If the selected filesystem plugin cannot guarantee flush/rename semantics, add a narrow Swift/Kotlin durable-file bridge and verify it; never claim file and SQLite writes share one transaction. Startup reconciles prepared-file journal entries and database references. Cleanup preserves files referenced by drafts, pending intents, recovered collections and active exports; sweep only unreferenced files older than 24 hours. Disk failure before commit leaves the draft; failure after commit is recovered by a fresh reader. Record SQLite durability settings and prove process-kill boundaries on both platforms. Exclude internal database/sidecars, journal and media together from automatic OS backup/device transfer; fresh installs recover through explicit JSON import or authenticated hydration. The secure-session adapter uses device-bound keys without the plaintext web fallback. See `expansion-native-feasibility.md` for exact package evidence, platform requirements and exclusion rules.

Upload through an authenticated proxy into private staging, not an unrestricted signed URL. Reserve declared bytes and quota under the account/collection lock first; unique random object keys cannot be overwritten. At most four unfinished uploads and 32 MiB staged per account, each up to the existing 4 MiB photo / 8 MiB voice binary limits, 15-minute reservation. Stream with a hard byte limit and 60-second request timeout; compute actual hash and signature/decoder validation. Finalization rechecks account deletion generation, reservation, checkpoint ownership and collection epoch, then attaches immutable bytes transactionally. Expired/failed staging is swept hourly. Text may synchronize before media, but its status remains pending until every referenced byte is confirmed.

Admission maintains the same portable envelope as local v1: 200 projects, 1,000 checkpoints, 48 MiB summed serialized projects including base64 media. Compute exact UTF-8 metadata plus `4 * ceil(binaryBytes / 3)` and data-URL prefix/JSON syntax, using the frozen v1 encoder and conformance fixtures; a compact exported file must remain under the existing 50 MiB input limit. Reservations account for concurrent pending uploads. Do not infer binary quota from serialized quota. Finish/delete/read/export and over-cap imported records remain available. The server alone enforces connected active-project purchase policy; a local legacy flag never grants a server entitlement. Technical-capacity errors never advertise an upgrade as their remedy.

## Export, replacement and service recovery

Local export pins a consistent local snapshot and media references. Connected export first creates a server metadata manifest at one cursor, pins all immutable media for one hour with renewable active-session leases, then downloads and verifies every byte. Include pending local-only saved records through a separately pinned local overlay; resolve identity collisions explicitly. Show exactly which collection/state is being exported. A failed/missing/corrupt download or expired lease returns actionable incomplete status and no file labeled “full backup.” Produce compact v1 JSON, then parse and verify it before sharing. Drafts are explicitly excluded until saved. No binary archive subsystem is required for this envelope.

Replacement stages a completely validated candidate and all media, calculates quota and binds the confirmation to current collection revision/epoch. A separate replacement reservation permits one candidate per account, at most 40 MiB of raw candidate media plus 8 MiB metadata, for one hour. Enforce the candidate’s exact 48 MiB portable envelope prospectively; do not add old and replacement logical sizes when checking that envelope. Allow bounded temporary old-plus-new physical bytes (at most 80 MiB live/candidate media, excluding separately metered retained service backups); ordinary upload reservations stay capped at 32 MiB. Stage candidate files incrementally, bind them to the reservation, and sweep on cancellation/expiry only after reference checks. Reject insufficient physical budget before changing the source. One command under the account/collection locks swaps the collection epoch and active record set; writes arriving before the lock invalidate confirmation, writes arriving after it are rejected into recovery. Preserve old local pending work and readable-code/legacy-ID mappings. Release old media only after all leases and service recovery retention permit it. Never perform a network operation inside a database transaction.

Service backup is separate from maker export: once daily create a consistent database snapshot identifier plus immutable object manifest, protect referenced objects from GC, copy object bytes to independent recovery storage, hash-verify and mark the recovery point complete. A failed object copy makes that recovery point incomplete. Maintain seven daily complete points initially, with actual provider/account retention documented before activation. Maintain an independently durable append-only erasure ledger outside the primary database and outside any historical recovery point. Its adapter must provide authenticated idempotent append, strongly consistent inventory and a verifiable current inventory watermark; an unavailable or stale ledger fails restoration closed. Persist an authorized deletion intent to that ledger before acknowledging the account-disable barrier. A crash between ledger append and the primary transaction is reconciled idempotently: the authorized deletion still proceeds. Store only account UUID, deletion generation/request ID, the deletion receipt-token hash and timestamps, with no raw capability token, craft content or payment credential. Reconciliation rebuilds the narrow receipt record from this independent intent, so a crash after append but before the primary transaction preserves access with the original client token. Retain entries until every potentially restorable recovery point predating them has expired, at least 90 days. Fetch and apply the current independent ledger to any restored environment **before** it may accept traffic; deleted accounts cannot resurrect from backups. Live account deletion overrides maker export leases and cancels those exports. Retained service recovery points may contain inaccessible deleted data until their disclosed seven-day expiry; erase it on expiry and verify the limit. Do not state immediate physical removal from all historical backups. Read-only backup metadata/bytes have restricted operator access and encryption, with no craft content in routine logs. Drill hash-verified restore into an isolated destination monthly and before release; provisional RPO 24 hours and RTO 4 hours must be measured or reported unmet.

## Purchases and permanent-upgrade recovery

Represent every verified grant independently by `(provider, environment, canonicalPurchaseId)`. Derive access as ANY valid grant or explicit server-authorized promotion; refunding one of two purchases must not revoke the other. Never accept SDK entitlement flags, return URLs, imported research flags or sandbox transactions as production authority. Raw webhook authentication and payload size checks precede durable inbox insert; return 2xx only after insertion. Duplicate event IDs are safe. A per-purchase worker lease serializes authoritative provider fetch and ledger update, so slower old observations cannot overwrite newer reconciliations. Release the lease after updating the derived projection. Per-purchase leases carry monotonically increasing fencing tokens; a stale worker cannot commit after its lease is replaced. After provider fetch, acquire the billing-principal row lock, validate lease fencing, update that grant and recompute the aggregate projection in one transaction. This serializes changes to different purchases for the same principal, including simultaneous refunds and recovery rebinding. Never hold that database lock during provider network calls. Store-level pending/failed/refunded/disputed outcomes have distinct states; reconciliation continues after finite provider webhook retries stop.

Use a random stable billing-principal UUID distinct from the craft/auth account UUID. Require login before purchase, and configure RevenueCat to keep identified purchases with their original App User ID. The app receives only its server-bound principal; changing a client ID cannot change the server ledger. Disable automatic anonymous purchase creation and cross-account receipt transfer. RevenueCat's default permits transfer, while keeping the original ID requires account recovery support; this deliberate choice must be verified in both platform sandboxes. [RevenueCat restore behavior](https://www.revenuecat.com/docs/projects/restore-behavior)

Deleting a craft account detaches that principal and deletes craft/auth data; retain only the minimum purchase linkage needed for permanent-upgrade recovery, fraud prevention and applicable transaction retention. The retained linkage is limited to canonical purchase ID, provider/environment/product, stable billing-principal UUID, verified grant state and observation reference/time, recovery-key hash, current binding or deleted-binding marker, and minimal recovery audit IDs/timestamps/reason. Remove old email, craft identifiers and device content. Record the retention purpose and actual jurisdiction/provider schedule before live sales; no invented universal legal period. Give the purchaser a downloadable high-entropy recovery key (server stores only its hash) and explain it during deletion without requiring them to retain craft data.

For a recreated account, start an authenticated recovery case. Require recent authentication, a freshly provider-verified store purchase (or verified web transaction ownership), and the recovery key or independently verified provider/support ownership evidence. A privileged, audited operation, serialized under the same billing-principal lock and protected against concurrent claims, can bind an **unowned/deleted-account** billing principal to the new account under a lock, rotate the recovery key, revoke previous account links and rederive grants. Never re-create old craft records, email, uploads or auth identities. An active account's principal cannot be reassigned through this path. If evidence is insufficient, keep the case pending with a concrete provider-support route rather than grant from a screenshot/client claim. Real provider recovery capability and disclosure are release gates; do not promise automatic recovery that the sandbox cannot demonstrate.

## Deletion barrier and receipt

Before issuing deletion, generate a random 256-bit receipt token and persist it locally; send its hash with a durable request ID. A lost server response can then query the same receipt rather than strand the user. Validate recent-auth proof and persist the authorized intent in the independent erasure ledger described above; then under the account lock recheck the request/generation, set state `deleting`, increment deletion generation, revoke devices and enqueue one deletion job atomically. All mutations/finalizers/workers verify that generation. New reads fail the active-account check even with a still-cryptographically-valid JWT. Auth refresh credentials are revoked; then sweep private Storage, revoke export leases, clear record rows and finally delete managed Auth user.

Uploads admitted before the barrier have a bounded timeout; deletion waits past their reservation expiry and request timeout, sweeps staging/final storage again, and verifies zero live owned objects before live-purge completion. Late payment events may update the retained billing principal's verified transaction state but cannot create an account or entitlement projection for a deleted account. The receipt reports `pending`, `live-data-removed` with backup-expiry date, `complete` after the retention deadline, or `needs-help`. This clarifies D09's compact completed state; no false all-storage claim. Keep the read-only receipt token for 90 days, hash at rest, rate-limit lookup, use POST so it stays out of URLs/referrers, and return no account/project/payment fields. Local-copy keep/export/remove choice remains explicit and fenced. Test both completion orders for upload, finalizer, payment, sync and deletion; the deleted account must never resurrect.

## Bounded operations and performance

Sync request limits: one command per request, 256 KiB JSON maximum; 60 commands/minute/account with a burst of 20; return typed 429 plus retry delay. Bounded import/replace uses a staged metadata upload up to 8 MiB, not the command payload. Keep at most two active snapshots/account. Webhook body maximum 256 KiB, durable worker batches 20, global concurrency 4, one job/account per batch and one purchase lease at a time. Apply account/IP abuse limits to authentication, uploads, snapshots and receipt lookup. Return 503 with retry metadata when the queue is saturated; do not acknowledge a webhook that was not stored. Retain successful webhook payloads only 30 days with sensitive fields redacted/encrypted as needed; retain dedupe identity and authoritative purchase record for the actual required transaction period. Failed jobs remain actionable until explicitly resolved, with bounded payload storage and backpressure.

Use lazy media loading and bounded media concurrency 2 (range 1–4). Do not download every photo for a shelf render or serialize a full library on each keystroke. Preserve existing local-save responsiveness and indexes; paginate server feeds and histories. Measure on declared hardware: local text save 500 ms for 20 projects/200 checkpoints, search for 50/500, and 10-project/100-media-checkpoint import within 5 seconds in the reference desktop lab. Measure native startup/import peak memory rather than extrapolate browser results. Compact export still creates base64/JSON copies, so record peak memory at the 48 MiB boundary and move encoding to a worker/streamed file writer if measured limits fail; do not expand the format prematurely.

Run baseline 100 concurrent reconnecting accounts and stress 1,000 with delayed commits, interrupted media and webhook replay. These are engineering fixtures, not a capacity claim for a paid plan. Acceptance: no lost/duplicate effects or cross-account data, bounded staging/backlogs, fair progress, typed overload and uninterrupted local capture. Report p50/p95, error rate, queue age, database locks and peak memory; do not invent p99 from tiny samples. Incorporate dormant retained accounts and recovery traffic from `operating-budget.md`; its figures are illustrative and unfunded. Production activation needs actual rates, measured capacity, named owner and funding approval.

## Release and observability

Implement redacted operation IDs and phase timings, queue oldest age, hash mismatch, reconciliation delay and deletion/backup status. Alert on sync/webhook backlog above 5 minutes, deletion live-purge above 24 hours, missed daily complete backup and budget 50/80/100%. Quarantine invariant failures for operator action rather than infinite retry. Drill the planned 15-minute feature disable and one-hour binary rollback; keep N/N-1 additive protocol/schema compatibility and exports. Feature flags can pause new cloud enrollment and payment initiation without blocking existing local capture/read/export. Only a confirmed provider result can render a payment successful.

Native signed binaries, universal/app links, camera/microphone, share/import, safe area, system Back, VoiceOver/TalkBack and process interruption require actual device evidence. Local simulators/emulators and fake provider tests are useful separate gates. Public policy/support/deletion routes contain no private records; all private and receipt routes remain noindex with independent authorization. No deployment, real charge or store submission occurs as part of this plan review.
