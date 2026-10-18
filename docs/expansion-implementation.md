# Expansion execution packages

18 October 2026. This is the implementation plan for the accepted cloud sync, checkout and iOS/Android scope. It specifies future work; no expansion module, new command, provider transaction or native build is claimed complete here. The user has selected build-and-verify execution with parallel workers. The master prompt explicitly delegates BUILD AND VERIFY and says to begin implementation after correcting and establishing the reviewed plan. That direct instruction supersedes a routine skill permission gate: ordinary project-local implementation, dependency installation, testing and review now proceed without another approval question. This is standing authorization, not a fabricated individual approval of each artifact.

This document **supersedes the coarse initial P2–P8 task table and dependency diagram** in [expansion-plan.md](expansion-plan.md). P0 remains foundation freeze. P1 is the actual review order **CEO → Design → DX → Engineering**, followed by consolidation and the recorded implementation decision under that standing delegation. The initial “Product→design→engineering” shorthand omits the completed DX stage and must not govern execution. Accepted requirements are [X01–X10 and C decisions](expansion-plan.md), [D01–D12](expansion-design.md), [DX01–DX08](expansion-developer-experience.md), the [engineering contract](expansion-engineering.md), and the [native feasibility contract](expansion-native-feasibility.md). Nothing below removes their acceptance criteria or the existing R1–R9 obligations.

The engineering contract's `src/domain/contracts.ts`, `schema.ts`, `errors.ts` and `policy.ts` are the canonical contract location. Any earlier DX reference to `src/contracts/` means these files, not a second set of wire types. Wire protocol 2, payload versions, local schema versions, SQL migration numbers and portable JSON backup version 1 remain distinct. “All-byte backup” means the complete JSON v1 file with embedded verified media; this release does not add a ZIP/binary archive or raise the 200-project / 1,000-checkpoint / 48 MiB serialized envelope.

The canonical research protocol is `docs/expansion-research-protocol.md`; it supersedes earlier task spellings `docs/research-protocol.md` and `docs/release/pilot-protocol.md`. The canonical release checklist is `docs/release-readiness.md`; it supersedes `docs/release-checklist.md` and `docs/release/checklist.md`. These are path aliases, not additional deliverables. All 46 groups in [expansion-test-plan.md](expansion-test-plan.md) remain required; the file map below assigns their executable homes.

## P0 and P1: establish the execution base

Read-only inspection found one worktree, `/Users/lalaji/Repos/CGProjects/loopmark`, on `main` at `5d9bd54d0770826b5fd800352b3cdcb07f9339be`, with substantial modified and untracked foundation/planning work. That older commit is **not** the verified foundation commit. The accepted candidate is cache `loopmark-ad60daeda70e`, with 33 data tests, 209 browser cases and four isolated scale cases recorded in [completion-judge.md](completion-judge.md). Do not discard, reset, clean, broadly stage or overwrite the working tree to manufacture a clean base.

The integrator must inspect `git status --short`, `git diff --check`, source fingerprints and retained evidence; isolate the exact foundation source/tests/evidence from unrelated or still-changing planning files; and make the local foundation commit only after its contents match the verified candidate. If executable source changed since that run, rerun the affected checks and final baseline before freezing. Record the resulting full SHA in new `docs/evidence/expansion/foundation.json`; do not invent it now. Include the final reviewed planning documents in a separate plan commit if needed. Both commits stay local unless separately authorized for publication.

Worktrunk v0.80.0 is installed. Read-only `wt config show` found no user or project hook configuration; shell integration was inactive in the tool process. No worktree is created during planning. After P0/P1, use the authorized local `wt` workflow with explicit bases and `--no-cd`; each worker receives its absolute worktree path and runs its own `npm ci`. There is no hook provisioning to depend on, so `--no-hooks` avoids unrelated hook execution. Reinspect configuration before creation if it has changed; never auto-approve arbitrary hooks.

```sh
# Future execution only. Set this to the full SHA recorded by P0, never the old HEAD.
LOOPMARK_FOUNDATION_SHA="<P0 recorded full SHA>"
wt switch --create expansion/integration --base "$LOOPMARK_FOUNDATION_SHA" --no-cd --no-hooks --path ../loopmark-expansion-integration

# Run I01 in that integration worktree and record its reviewed contract commit.
LOOPMARK_CONTRACT_SHA="<I01 recorded full SHA>"
wt switch --create expansion/client --base "$LOOPMARK_CONTRACT_SHA" --no-cd --no-hooks --path ../loopmark-expansion-client
wt switch --create expansion/backend --base "$LOOPMARK_CONTRACT_SHA" --no-cd --no-hooks --path ../loopmark-expansion-backend
wt switch --create expansion/native --base "$LOOPMARK_CONTRACT_SHA" --no-cd --no-hooks --path ../loopmark-expansion-native
```

These are command templates whose two SHA values come from execution evidence, not executable placeholder values. Record each worktree's actual path, base SHA, branch, local project ID, ports and output directory. The integrator brings reviewed commits into `expansion/integration` sequentially and records their SHAs. Workers refresh from the reviewed integration checkpoint between dependent packages. No branch deletion, remote push, deployment or store submission is implied.

## Ownership and scheduling rules

At most **four agents run at once: one integrator plus three workers**. Reviewers occupy one of those same three slots after its current work pauses or finishes; there is no extra background review agent. Human roles below are responsibilities to assign before the relevant external gate, not invented named staff.

| Role | Exclusive responsibility and permitted areas |
|---|---|
| Integrator/root | Shared contracts/configuration, application wiring and existing files: `src/App.tsx`, `src/main.tsx`, `src/types.ts`, `src/data.ts`, `src/drafts.ts`, `src/media.ts`, `src/media-validation.ts`, `src/offline.ts`, `src/styles.css`, existing `src/components/*`, existing `src/data.test.ts`, package manifests/lockfiles, root build/test config, service-worker generation, CI and global public-route metadata. Owns I01 and I09, integrates every lane, and accepts protocol changes. |
| Worker A, client | New `src/repositories/browser/*`, `src/services/*`, `src/auth/*`, `src/sync/*`, `src/links/*`, `src/billing/*`, and their colocated tests; new browser specs under `tests/expansion/*` as explicitly assigned. Later owns the disjoint developer docs/examples/tooling files in I12. |
| Worker B, backend | All `supabase/migrations/*`, `supabase/functions/*`, `supabase/tests/*`, `tests/server/*`, `tests/load/*`, and `scripts/ops/*`. One migration owner throughout I03/I07/I08/I11; other lanes request schema changes. Root alone edits the frozen shared protocol and package/CI files. |
| Worker C, native | `src/platform/native/*`, `ios/*`, `android/*`, `tests/native/*`, `scripts/native/*` and native evidence. Plugin-specific bridges stay here. Root alone installs/updates root packages, edits `capacitor.config.ts` and integrates native entry points. |

New component files in I09 are root-owned too; workers do not concurrently edit a shared UI shell. Shared `src/domain/*`, `src/config.ts`, `src/platform/contracts.ts`, `src/repositories/contracts.ts`, `supabase/functions/_shared/config.ts` and `scripts/lib/config.mjs` freeze in I01. Backend may extend its own config implementation only through an integrator-reviewed contract change. A needed contract change stops only its dependent consumers, updates examples and version fixtures, and resumes them on the same new reviewed commit. It is an engineering coordination step, not another user approval gate.

Every worker instruction includes: “You are not alone in the codebase. Edit only this package's allowlist, preserve others' changes, and send shared-file changes to the integrator.” Reassignment is explicit and serialized. Test ports, local Supabase profiles, generated artifacts and fixture accounts are worktree-specific. Performance runs have exclusive machine use for their measured interval; concurrent throughput tests run only when deliberately testing contention.

## Commands and evidence contract

The following commands **exist now**. They remain supported and are run from the relevant worktree:

```sh
npm ci
npm run format:check
npm run build
npm test
npm run test:e2e
npm run test:e2e -- tests/scale.spec.ts --project=chromium --workers=1 --output=test-results-scale --reporter=line
git diff --check
```

The last browser command is the **isolated scale check**, not a currently installed `test:isolatedscale` script. Pause other browser/load/native builds while measuring it. Existing browser projects are Chromium/Firefox/WebKit desktop plus Chromium/WebKit mobile profiles; mobile profiles are browser emulation, not physical native devices. `npm test -- <new src path>` and `npm run test:e2e -- <new spec path>` use existing scripts, but those new test files still must be authored.

Every command in the next table is **PLANNED / NOT CURRENTLY INSTALLED**. I01 registers only working initial commands; the owning package supplies the implementation and root adds its package entry when runnable. Missing prerequisites produce a distinct nonzero/unverified result, never skipped tests counted as PASS. Test scripts refuse production endpoints and use synthetic data unless explicitly named as authorized sandbox/release checks.

| Planned command | Package / exact implementation and required behavior |
|---|---|
| `npm run doctor -- --capability guest --json` | I01/I12, new `scripts/doctor.mjs`; read-only version/config/port probes, capability-specific exit 0/2/3, no secret output. Also accept `local-sync`, `native-ios`, `native-android`, `provider-sandbox`. |
| `npm run local:up`; `npm run local:down`; `npm run local:reset -- --confirm-project <local-id>` | I03/I12, new `scripts/local.mjs` using new `scripts/lib/config.mjs` and project-pinned Supabase CLI. Loopback only; isolated profiles; collision refusal; down preserves volumes; reset separately confirms exact project. |
| `npm run test:server -- --suite <schema|media|replacement|deletion|billing|recovery|all>` | I03/I07/I08/I11, new `scripts/test-server.mjs`, `vitest.server.config.ts`, `supabase/tests/*.test.sql` and `tests/server/*.test.ts`. Run SQL policy/transaction tests plus HTTP callers against the actual local database/Auth/Storage/functions. The harness exercises real roles and raw bodies, not mock RLS. |
| `npm run test:sync:smoke` | I06, new `scripts/test-sync-smoke.mjs` invoking `tests/expansion/sync-smoke.spec.ts` against local services with two independent browser contexts and account A/B. |
| `npm run native:sync`; `npm run native:ios:build`; `npm run native:android:build` | I04/I10, new `scripts/native/sync.mjs`, `build-ios.mjs`, `build-android.mjs`; build web, sync pinned Capacitor, compile unsigned iOS simulator and Android debug targets. Record actual toolchain, target and native lockfiles. |
| `npm run test:native:ios -- --target simulator`; `npm run test:native:android -- --target emulator` | I04/I10, new `scripts/native/test-ios.mjs`, `test-android.mjs`, `tests/native/ios/*`, `tests/native/android/*`; execute native storage/lifecycle tests, not Node-only plugin mocks. `--target device --device-id <id>` selects an explicitly available physical device in I14. |
| `npm run test:ops` | I11, new `scripts/test-ops.mjs` and `tests/ops/*.test.mjs`; grammar/JSON/exits, default dry-run, bounded execution and real local replay/restore evidence. |
| `npm run ops -- <command> --environment local --target <id-or-all> --limit 20 --json` | I11, new `scripts/ops.mjs` plus `scripts/ops/*`; commands are `replay-webhooks`, `reconcile-purchases`, `resume-deletions`, `backup-snapshot`, `restore-check`, `status`. Dry-run unless `--execute`; explicit bound production scope and separate authorization remain required. |
| `npm run test:examples`; `npm run test:docs`; `npm run test:dx` | I12, new `scripts/test-examples.mjs`, `test-docs.mjs`, `test-dx.mjs`; execute `tests/examples/*`, check documented scripts/config/links, and exercise clean guest/isolated local setup without provider accounts. |
| `npm run test:security`; `npm run test:compat` | I13, new `scripts/test-security.mjs`, `test-compat.mjs`, `tests/security/*`, `tests/compat/*`; built-bundle/native-resource secret/test-grant scans, policy bypass tests and N/N-1/wire/local/backup compatibility. Record scope of scans; no universal security claim. |
| `npm run test:load -- --accounts 100`; `npm run test:load -- --accounts 1000` | I13, new `scripts/test-load.mjs` and `tests/load/reconnect.ts`; delayed commits, media interruptions, receipt compaction and webhook replay with bounded workers. Local measurement only unless an authorized isolated staging target is explicitly selected. |
| `npm run test:sandbox:web`; `npm run test:sandbox:ios`; `npm run test:sandbox:android` | I14, new `scripts/sandbox/*.mjs`, `tests/sandbox/*`; require configured authorized test accounts/products/webhooks and reject production payments. Save provider evidence with sensitive values redacted. No fake fallback. |
| `npm run test:release -- --environment staging --platform <web|ios|android>` | I15, new `scripts/test-release.mjs`, `tests/release/*`; reads explicitly configured staging target and runs the five-minute smoke. Production variant is only executed after that external action is authorized; it must not initiate an unsolicited real charge. |

Each package records a machine-readable result in new `docs/evidence/expansion/<package>/result.json` plus redacted logs/screenshots/manifests as relevant. Minimum fields: package/requirement IDs, base and result commit, lockfile hash, command, exit status, environment/tool versions, target platform/device, fixture size, start/end, pass/fail/skipped counts, reviewer and blockers. The reviewer checks both code and durable-state assertions. Do not commit credentials, customer content, receipt tokens, full provider payloads or device identifiers that need redaction. Raw transient test outputs may remain gitignored; durable summaries link to their retained artifact location and hash.

## I01 — Freeze domain, platform, error and configuration contracts

**Owner:** integrator. **Depends:** P0/P1. **Reviewer:** Worker B for authority/transaction contracts and Worker A for caller usability, sequentially before their implementation starts. **Scope:** X01–X10, C14/C17/C18/C21, DX02/DX03/DX06/DX07.

**NEW:** `src/domain/contracts.ts`, `schema.ts`, `errors.ts`, `policy.ts`, `canonical-json.ts`, `contracts.test.ts`, `policy.test.ts`; `src/repositories/contracts.ts`, `contract-suite.ts`; `src/platform/contracts.ts`; `src/config.ts`; `src/config.test.ts`; `src/help/errors.ts`; `supabase/functions/_shared/config.ts`; `scripts/lib/config.mjs`; `.env.example`; `scripts/doctor.mjs`; `docs/developer/contracts.md`; `docs/decisions/001-expansion-contracts.md`; `tests/fixtures/expansion/*`. **EXISTING, root only:** `package.json`, `package-lock.json`, `vite.config.ts`, `.gitignore`, `src/types.ts` for compatibility exports. No implementation import of a provider object into domain/UI.

Define every referenced union and port, not just interface names: decimal-string revisions, canonical hash vectors, receipts, snapshot/pull page, pending intent, account/epoch/generation, purchase principal and outcome, cancellation-after-commit, readonly deletion receipt and errors. Use engineering `Repository` methods and version-2 wire shapes. Map all fourteen CEO rescue rows and setup failures to stable safe errors and bundled offline help. Freeze non-overridable ownership, quota, history, atomicity and entitlement policy. Record configuration precedence/ranges and distinct wire/local/backup compatibility. Establish repository contract fixtures usable against IDB and native implementations before consumers merge.

**Verify:** `npm test -- src/domain src/config.test.ts`; `npm run build`; planned `npm run doctor -- --capability guest --json`. Evidence includes fixed Unicode/key-order hash vectors, malformed/version rejection, valid empty results, useful backup wording, zero provider-specific types in interfaces, false grant/overridden-quota rejection, safe error examples, and exact contract commit. Missing provider config must leave guest usable. **Estimate:** human-engineer equivalent 3–5 days; agent implementation/review 12–20 active hours, excluding tool downloads. These are planning estimates, not measured speedups.

## I02 — Browser repository, migration and durable local intent

**Owner:** Worker A. **Depends:** I01. **Reviewer:** Worker C, then root integration. **Scope:** X01/X02/X03/X07/X08/X10, C01/C08/C15/C16/C17/C18, D01, DX07.

**NEW:** `src/repositories/browser/repository.ts`, `schema.ts`, `migration.ts`, `overlay.ts`, `media-store.ts`, `repository.test.ts`, `migration.test.ts`; `tests/expansion/local-migration.spec.ts`. **EXISTING changes submitted to root:** `src/data.ts`, `src/drafts.ts`, `src/data.test.ts`, `src/types.ts`. Preserve the current data facade and validators.

Copy validated `loopmark` and `loopmark-drafts` content into the new versioned store; retain originals and a durable count/hash migration receipt. Reader switch follows successful comparison. Do not automatically delete old stores even after export. Atomically commit record/local intent/sequence; maintain server shadow separately from overlay; acknowledge only the matching immutable operation. Namespaces include guest/account/collection/epoch; source-bound drafts and pending/recovered data remain discoverable. Implement three-active-project local policy, readable imported/legacy/revoked over-cap collections, complete history and export. A local legacy flag has no server grant authority.

**Verify:** `npm test -- src/repositories/browser`; `npm run test:e2e -- tests/expansion/local-migration.spec.ts`; `npm test -- src/data.test.ts`; `npm run test:e2e -- tests/draft-recovery.spec.ts tests/reliability.spec.ts`. Inject each transaction failure and reader-switch boundary, restart, duplicate acknowledgement, pull-before-ack, corrupt migration and old-clock fixtures. Fresh readers must see either the intact old state or complete new state, never partial records/outbox; compare every media hash and retain drafts. **Estimate:** human 5–8 days; agent 20–32 active hours.

## I03 — Local backend, ownership policies and synchronization commands

**Owner:** Worker B. **Depends:** I01. **Reviewer:** Worker A after I02 plus integrator security review. **Scope:** X01/X02/X07/X09, C14/C16/C18/C21, DX01/DX06/DX07.

**NEW:** `supabase/config.toml`, `supabase/seed.sql`; numbered `supabase/migrations/*` for the complete planned table/role/index foundation; `supabase/functions/_shared/auth.ts`, `command.ts`, `limits.ts`; `supabase/functions/sync-push/index.ts`, `sync-pull/index.ts`, `sync-snapshot/index.ts`, `account-session/index.ts`; `supabase/tests/ownership.test.sql`, `commands.test.sql`; `tests/server/schema.test.ts`, `sync-ordering.test.ts`; `scripts/local.mjs`, `scripts/test-server.mjs`. **ROOT integration:** new `vitest.server.config.ts`, pinned Supabase CLI and root scripts; config contract changes remain root-reviewed.

Build active-account RLS and private Storage checks; composite ownership keys; revoked direct invariant-table writes; narrowly granted RPC/worker roles; safe security-definer search paths. Freeze lock order, transactional collection cursor, effect/feed/quota/receipt transaction and immutable hash dedupe. Implement dependent operation bases, snapshots, deterministic 50-entry/512 KiB pull pages, one-hour snapshot leases, ten-device/90-day lease/floor/tombstone rebase rules. Auth helpers validate PKCE/state/allowlists, fresh reauth proofs, generic errors and rate limits. Local startup uses isolated loopback projects and synthetic fixtures without a cloud account.

**Verify:** planned `npm run local:up`; `npm run test:server -- --suite schema`; `npm run doctor -- --capability local-sync --json`. Real A/B sessions must fail cross-owner and same-owner direct bypass; old JWTs cannot bypass active state. Hold one SQL transaction open while a second commits to prove cursor visibility cannot skip it. Duplicate equal hashes yield one effect; changed hashes reject. Crash/replay, snapshot pages during writes, ancient cursor/sequence rebase and payload/rate limits must pass at the SQL and HTTP caller boundaries. **Estimate:** human 8–12 days; agent 30–48 active hours.

## I04 — Native persistence and package compatibility proof

**Owner:** Worker C. **Depends:** I01; shared repository fixtures from I02 before parity closes. **Reviewer:** Worker A for repository parity; root for toolchain/licensing. **Scope:** X03/X06/X07/X10, C06/C08/C17/C18, DX01/DX02.

**NEW:** `src/platform/native/repository.ts`, `files.ts`, `session-storage.ts`, `recovery-journal.ts` and colocated tests; `ios/*`, `android/*`, `tests/native/ios/persistence/*`, `tests/native/android/persistence/*`; `scripts/native/sync.mjs`, `build-ios.mjs`, `build-android.mjs`, `test-ios.mjs`, `test-android.mjs`. **ROOT:** new `capacitor.config.ts`, package pins/lockfile and entry-point wiring. Native generated files and native lockfiles belong to C; root does not independently regenerate them.

Use the exact candidate pins and license duties in native feasibility, rechecking package availability/advisories at installation. Resolve one Capacitor graph and actual Android AGP/Gradle/Kotlin/Java combination; capture Node/Xcode/SDK versions. Build unsigned targets early. Implement SQLite records/outbox and immutable private files with prepared-file journal, flush/close/rename before database visibility, draft/reference-aware cleanup after 24 hours, generation fences and restart recovery. Add a narrow Swift/Kotlin durable-file bridge inside the native directories if the selected filesystem API cannot establish the required semantics. No preference store for large media and no claim that file and SQL commits share a transaction. Record remaining power-loss limitations honestly.

Set native session Keychain synchronization off and `whenUnlockedThisDeviceOnly`; deny web fallback. Exclude `WSSecureStorageSharedPreferences.xml` from legacy Android backup, Android 12+ cloud backup and device transfer. Exclude SQLite database, WAL/SHM sidecars, prepared-file journal and attachment directories together from automatic OS backup/transfer on both platforms; test every configured path. User-controlled complete JSON v1 is the supported portable recovery path; key loss requires sign-in. Preserve its limits and keep SQLCipher encryption declarations/license notices in release material.

**Verify:** `npm run build`; planned `npm run native:sync`, `npm run native:ios:build`, `npm run native:android:build`, `npm run test:native:ios -- --target simulator`, `npm run test:native:android -- --target emulator`. Require real native save/reopen, byte roundtrip and fault boundaries at staging/promotion/SQL/cleanup, disk full, stale generation, sign-out, key loss, backup restore and killed process. Node plugin mocks are supplemental. Toolchain incompatibility is an implementation defect to resolve; missing local SDK installation is a concrete prerequisite to install where authorized, not a reason to abandon the other lane. Physical durability and OS-backup behavior remain separately tested in I14. **Estimate:** human 6–10 days; agent 24–40 active hours plus build/download time.

## I05 — Account, collection ownership, links and recovery services

**Owner:** Worker A. **Depends:** I02/I03. **Reviewer:** Worker B for authority and root for user flow. **Scope:** X01/X07/X08/X10, C02/C12/C14/C15/C16/C17, D01/D03/D05/D09/D11, DX03.

**NEW:** `src/auth/auth-service.ts`, `session.ts`; `src/services/collection-service.ts`, `account-deletion-service.ts`; `src/links/link-service.ts`; colocated tests; `tests/expansion/accounts.spec.ts`, `collection-connection.spec.ts`, `links.spec.ts`. **ROOT:** existing shell/drafts/`src/components/BagLabel.tsx` wiring in I09; `LabelPreview.tsx` is not an existing module.

Guest stays selected after login until deliberate selection/attachment. Preview named source/destination, exact additions/matches/copies/resulting counts/usage; same-ID divergent content gets a new ID and readable mapping. Bind source/destination revisions and epoch, retry the same operation, preserve source on failure and disallow partial capacity overflow. Abort/fence old account work including cached queries, media, drafts, refresh and events. Sign-out stops listeners and exposes unique-work counts before keep/export/remove; retain a disconnected named copy or guest selection. Implement source-bound draft switch, recent-auth deletion/receipt continuation and authorized cached/uncached project links, including legacy label recovery and native continuation input.

**Verify:** `npm test -- src/auth src/services/collection-service.test.ts src/services/account-deletion-service.test.ts src/links`; `npm run test:e2e -- tests/expansion/accounts.spec.ts tests/expansion/collection-connection.spec.ts tests/expansion/links.spec.ts`. Pause/release both orders of switch versus old callbacks/push, stale previews, collision matching, expired/reused codes, 429, offline links, unauthorized IDs and cancellation. Zero A-to-B namespace writes or metadata disclosure; no automatic upload or draft submission. Deletion backend races close in I07. **Estimate:** human 5–8 days; agent 20–32 active hours.

## I06 — Foreground sync, media availability and complete backup client

**Owner:** Worker A. **Depends:** I02/I03/I05; media/replacement endpoints from I07 before integration closes. **Reviewer:** Worker B and root; C runs shared contracts against native repository. **Scope:** X02/X03/X07/X10, C01/C03/C05/C08/C10/C14/C16/C17/C18, D02/D04/D07/D08, DX02/DX03.

**NEW:** `src/sync/coordinator.ts`, `transport.ts`, `tab-lease.ts`, `status.ts`; `src/services/media-service.ts`, `backup-service.ts`, `replacement-service.ts`; colocated tests; `tests/expansion/sync-smoke.spec.ts`, `sync-races.spec.ts`, `media-backup.spec.ts`; `scripts/test-sync-smoke.mjs`. **ROOT:** compatibility facade and existing BackupView/VoiceNote/offline wiring.

Only the coordinator retries transient errors with injected clock/jitter, bounded foreground cycle and Retry-After support. Serialize account/device/tab ownership; foreground/reconnect/manual sync reconcile the feed even if realtime was lost. Apply page/receipt/cursor atomically; preserve overlay when pull precedes acknowledgement. Keep both concurrent checkpoints; fresh CAS conflict actions and epoch recovery never silently replace pending work. Media concurrency defaults to two, independent item retry, stable missing-download placeholders and separately verified/pinned current-device offline readiness.

Pin a consistent local/server snapshot and media, include saved local overlay, verify all bytes/hashes, encode compact JSON v1, parse it again, then offer share. Missing bytes, expiry, disk failure and cancellation must not claim complete backup. Restore offline to a separate recovered collection; connected replacement uses staged candidate and fresh server CAS, retaining old pending work. No network waits in local save.

**Verify:** `npm test -- src/sync src/services/media-service.test.ts src/services/backup-service.test.ts src/services/replacement-service.test.ts`; planned `npm run test:sync:smoke`; `npm run test:e2e -- tests/expansion/sync-races.spec.ts tests/expansion/media-backup.spec.ts`. Test dropped acknowledgement, duplicate push, two tabs, malformed page, crash before apply/cursor commit, missed realtime, expired auth, both pull/edit orders, lost media download, boundary-size backup and interrupted replacement. Fresh-reader counts and hashes prove convergence; small stable-network text converges under the measured five-second target, with network fixture reported. **Estimate:** human 8–12 days; agent 32–48 active hours.

## I07 — Media admission, collection replacement and deletion barrier

**Owner:** Worker B. **Depends:** I03; I05/I06 contract callers available for end-to-end verification. **Reviewer:** Worker A for callers and root for security/recovery. **Scope:** X03/X07/X09, C03/C05/C08/C10/C14/C16/C18/C20, D03/D05/D07/D09.

**NEW:** subsequent `supabase/migrations/*`; `supabase/functions/media-upload/index.ts`, `media-download/index.ts`, `media-finalize/index.ts`, `collection-attach/index.ts`, `collection-replace/index.ts`, `account-delete/index.ts`, `deletion-status/index.ts`; `supabase/functions/_shared/media.ts`, `deletion.ts`, `leases.ts`, `erasure-ledger.ts`; `supabase/functions/jobs/delete-account.ts`, `sweep-media.ts`; `supabase/tests/media.test.sql`, `replacement.test.sql`, `deletion.test.sql`; `tests/server/media.test.ts`, `replacement.test.ts`, `deletion.test.ts`. Other owners do not edit migrations.

Reserve quota under account/collection lock, stream hard-limited bytes through authenticated staging, verify actual type/hash/size, and finalize against generation/epoch. Enforce four unfinished uploads, 32 MiB ordinary staging, 4/8 MiB individual media limits, 15-minute reservations and hourly sweep. Same-origin no-store downloads check active account each time. Exact portable accounting includes base64/prefix/JSON overhead; serializable limits and provider object bytes remain distinct. Replacement has a separate one-hour reservation, one candidate/account, at most 40 MiB raw candidate media plus 8 MiB metadata and at most 80 MiB old-plus-new live/candidate media, excluding separately metered recovery backups. Check the candidate's prospective 48 MiB portable size without summing both logical collections; reject insufficient physical budget before source mutation. Incremental staging/cancellation cleanup remains reference-safe. Replacement atomically CAS-checks revision/epoch and swaps active set; no network work inside SQL transactions.

After recent-auth validation, append the authorized deletion request and original receipt-token hash to an independently durable erasure ledger before acknowledging the disable barrier; then atomically disable account/device access and enqueue the job in the primary database. A crash between append and primary commit must resume deletion and reconstruct the narrow receipt for the original client token. Revoke refresh, wait for admitted upload timeouts, sweep storage twice, verify zero live owned objects, then delete Auth. Receipt POST lookup is narrow/rate-limited/noindex, hashed at rest, usable after revocation and retained 90 days. Report live-data-removed with backup expiry separately from complete; retain only documented payment linkage. Old JWTs, late uploads/finalizers and jobs cannot resurrect the account. Caches already downloaded cannot be recalled and are described accurately. I07 implements the erasure-ledger append/read port; I11 implements disaster recovery consuming its current independent inventory.

**Verify:** planned `npm run test:server -- --suite media`, `npm run test:server -- --suite replacement`, `npm run test:server -- --suite deletion`; I05/I06 browser callers. Require concurrent quota reservation, truncation/hash mismatch, no overwrite, referenced-orphan preservation, successful full-capacity replacement, candidate expiry/cancel/physical-budget rejection, stale-preview race and both orders of deletion versus upload/finalize/sync/payment. Fresh database/storage reads and old JWT requests prove denial and no residual live objects. Token guessing/replay/response loss and ledger-append-before-primary crash expose no personal fields and preserve the same receipt token/request. **Estimate:** human 7–11 days; agent 28–44 active hours.

## I08 — Purchase ledger, web checkout and native billing coordinator

**Owner:** Worker B owns server; Worker A owns only the client files below after I06. **Depends:** I03/I05/I07; I01 frozen billing contract. **Reviewer:** root plus C for native boundary, without starting a fourth worker. **Scope:** X04/X05/X08/X09, C04/C06/C11/C14/C15/C16/C18/C20, D06/D07, DX03/DX06.

**NEW, B:** purchase migrations; `supabase/functions/checkout/index.ts`, `billing-webhook/index.ts`, `purchase-restore/index.ts`, `purchase-recovery/index.ts`; `_shared/billing.ts`, `providers/razorpay.ts`, `providers/revenuecat.ts`; `jobs/reconcile-purchases.ts`; `tests/server/billing.test.ts`, `supabase/tests/billing.test.sql`. **NEW, A:** `src/billing/coordinator.ts`, `web-adapter.ts`, `continuation.ts`, `entitlement-cache.ts` and tests; `tests/expansion/purchase-continuation.spec.ts`. **ROOT:** UpgradeView integration/package entries. Native plugin adapter belongs solely to C in I10.

Stable attempt IDs bind account/principal before provider order creation; server chooses products/amount/currency. Raw authenticated webhook and size checks precede durable inbox acknowledgement. Serialize per-purchase authoritative fetches with monotonically fenced worker leases; after network fetch acquire the billing-principal lock, check the lease fence, update the grant and recompute the aggregate in one transaction. This also serializes different purchases and recovery claims for one principal. Distinct provider/environment/canonical grants derive ANY-valid access, including dual-purchase refund. Reconciliation recovers beyond webhook retry windows. Use stable billing-principal UUIDs, identified RevenueCat ownership with no automatic transfer, no anonymous purchase and no client/imported-flag grants. Audited allowlist promotions are explicit and one/account.

Cache verified one-time access for outages; revocation blocks only new over-cap actions. Persist account/collection-bound original draft/action across login, cancellation, pending/restart and verified return; explicit Continue is required. Restore/mismatch support never moves craft data. Deletion recovery uses hashed recovery key plus recent authentication and fresh provider/support ownership evidence; only unowned/deleted principals can be rebound under the same principal lock and audit, with concurrent-claim denial, key rotation and no craft resurrection. Lost keys use independently verified provider/support evidence, never screenshots alone. Retained fields are only canonical purchase/provider/environment/product, billing principal, verified grant observation/state, recovery-key hash, binding/deleted marker and minimal recovery audit IDs/times/reason; remove old email/craft/device content. Configure jurisdiction/provider retention only from actual selected accounts before live sales.

**Verify:** planned `npm run test:server -- --suite billing`; `npm test -- src/billing`; `npm run test:e2e -- tests/expansion/purchase-continuation.spec.ts`. Real local HTTP/database tests cover bad signature, replay, DB outage before 2xx, altered amount, duplicate click, delayed verification, reversed events/provider-fetch completion, expired worker fence, refund of one of two grants and simultaneous cross-provider refunds, forged legacy grant, sandbox-to-production rejection, wrong account restore, recovery after deletion, concurrent recovery claims, lost-key support, rotated old-key denial and late webhook. Fake providers are visibly labeled deterministic contract evidence. Actual Razorpay/RevenueCat/store sandbox qualification remains I14 and cannot be satisfied here. **Estimate:** human 8–12 days; agent 30–48 active hours across the two lanes, not each.

## I09 — Integrated account/sync/purchase UI, accessible states and public copy

**Owner:** integrator/root. **Depends:** I02/I05/I06/I08 interfaces; I07 authoritative outcomes. **Reviewer:** Worker A for behavior and Worker C for rendered/native design checks, with their production work paused as needed. **Scope:** X01–X10, C01/C02/C03/C04/C05/C11/C12/C14/C23, D01–D12.

**NEW:** `src/components/AccountView.tsx`, `CollectionPicker.tsx`, `ConnectionPreview.tsx`, `SyncStatus.tsx`, `SyncDetails.tsx`, `ConflictReview.tsx`, `UpgradeView.tsx`, `CloudUsage.tsx`, `AccountDeletion.tsx`; `src/pages/Privacy.tsx`, `Support.tsx`, `DeleteAccount.tsx`, `DeletionReceipt.tsx`; `tests/expansion/states.spec.ts`, `accessibility.spec.ts`, `privacy-routes.spec.ts`; `public/robots.txt` only if route policy needs it. **EXISTING, root:** shell/main/styles, UI/Forms/Shelf/ProjectView/BackupView/Guide/VoiceNote/BagLabel, `README.md`, `index.html`, design-system master and service-worker configuration. Preserve existing source names; no parallel edits to these files.

Implement all sixteen design-state rows and nine-step journey. Keep next step/tool/position/Save checkpoint ahead of settings; stable collection identity; loaded versus empty; all conflict values and fresh revision; unique-work discard counts; durable purchase/deletion continuations; resource-specific quota; independent local/cloud/offline-ready states and prescribed priority. Details retain every concurrent failure; background events neither move focus nor repeatedly announce retries. Preserve Lora/DM Sans and existing tokens; add readable 16px/1.5/44px variants, safe areas, reflow and restrained motion. Check installed Tabler exports before adding icons.

Public `/privacy`, `/support`, `/delete-account` give accurate mode-dependent facts; private app/project and deletion-status routes remain noindex and independently authorized. No private route enters a public sitemap or exposes content through metadata. Service worker cannot cache account API responses. Guest wording stays local-only; connected copy names actual destination/state, and neither sync nor labels are called backups. Update permissions, backup, label, README/Guide and eventual store disclosures consistently.

**Verify:** `npm run build`; `npm run test:e2e -- tests/expansion/states.spec.ts tests/expansion/accessibility.spec.ts tests/expansion/privacy-routes.spec.ts`; all relevant I05/I06/I08 journeys. Capture 320/390/768/1440px, 200% text, long account/price/title, keyboard-only, reduced motion, axe, contrast/target measures, status announcements, focus restoration and noindex/no-store/authorization. Browser evidence cannot close VoiceOver/TalkBack/system sheets. Rendered design reviewer records failures and fixes, not just screenshots. **Estimate:** human 7–11 days; agent 28–44 active hours.

## I10 — Native media, lifecycle, links and in-app purchases

**Owner:** Worker C. **Depends:** I04; I05/I06/I08 contracts; I09 for integrated flows. **Reviewer:** root with A checking shared-service parity. **Scope:** X01/X03/X05/X06/X10, C04/C06/C12/C14/C18/C23, D02/D06/D10/D11/D12.

**NEW:** `src/platform/native/camera.ts`, `audio.ts`, `share.ts`, `lifecycle.ts`, `links.ts`, `purchases.ts`, `network.ts`; `tests/native/ios/flows/*`, `tests/native/android/flows/*`. **EXISTING after I04:** C's native shells/permission and privacy manifests, entitlements, backup XML and native test wrappers. **ROOT:** manifest/install/config and shared entry-point wiring only.

Implement permissions and revoked/denied states, foreground audio interruption and durable promotion, playback, complete export/import/share cancellation, resume/network reconciliation, system Back, native keyboard/safe areas and pending deep-link login with ownership checks. Do not imply screen-lock/background/hour-long recording from the recorder alone. RevenueCat adapter requests real localized products and identified-account purchase/restore behind server ledger; it cannot grant from SDK booleans. Native has no web-checkout steering by default. Add associated-domain/app-link configuration templates and native privacy/license disclosures without inventing an owned domain or signing identity.

**Verify:** planned native sync/build and both simulator/emulator test commands; `npm run build`; shared repository/backup/purchase contract fixtures. Verify kills during media save, sign-out/account change, pending purchase, callback return, permission revocation, expired session and share cancel. Record plugin/toolchain resolution and unsigned binaries; unconfigured stores/links remain unavailable with accurate UI. Actual purchase ownership, signed links, physical audio/accessibility and reinstall/OS backup qualification belong to I14. **Estimate:** human 6–10 days; agent 24–40 active hours plus native build time.

## I11 — Operations, database-plus-object recovery and bounded jobs

**Owner:** Worker B. **Depends:** I03/I07/I08. **Reviewer:** root and Worker A as a fresh operator. **Scope:** X07/X09, C07/C13/C19/C20/C21, D09, DX04/DX06/DX07.

**NEW:** `supabase/functions/jobs/backup.ts`, `restore.ts`, `scheduler.ts`, `observability.ts`; recovery/job migrations; `scripts/ops.mjs`, `scripts/ops/*`, `scripts/test-ops.mjs`, `tests/ops/*`, `tests/server/recovery.test.ts`; `docs/developer/operations.md`, `docs/developer/recovery.md`; `docs/evidence/expansion/recovery/*`. **ROOT:** CI/scripts and existing `docs/runbook.md` integration.

Implement common dry-run grammar, limit 1–100/default 20, bounded batches/concurrency/leases, resumable IDs, cancellation, exit/JSON schema and redacted errors. Operate on exact project identity; restore-check uses an isolated destination. Daily complete database snapshot plus immutable object manifest/bytes has verified hashes and seven complete recovery points. Before restored traffic, fetch the current independent erasure ledger through authenticated idempotent append/strongly consistent inventory/watermark semantics; unavailable or stale ledger fails restoration closed. This ledger lives outside both the primary database and historical recovery points. Retain erasure intents until every older restorable point expires, at least 90 days, including only account UUID, deletion generation/request, receipt-token hash and timestamps. Replay reconstructs the deletion barrier and original receipt without resurrecting craft data. Expiry respects declared retention; deletion cancels maker export leases. Partial object copy never marks recovery complete.

Expose redacted queue age, conflicts, media failures, verification lag, deletion and backup freshness; user-triggered diagnostic preview contains no craft content/email/token/URL secrets. Alert on sync/webhook >5 minutes, live purge >24 hours, missed daily complete backup and 50/80/100% approved budget. Test pause of new enrollment/payment while existing local capture/read/export continue. Drill 15-minute disable and one-hour compatible binary rollback using additive N/N-1 schema; never destructive downgrade.

**Verify:** planned `npm run test:ops`; `npm run test:server -- --suite recovery`; `npm run ops -- status --environment local --target all --limit 20 --json`; dry-run and explicit-execute local `backup-snapshot`/`restore-check` with recorded synthetic target IDs. Assert byte-identical recovered media, snapshot→later deletion→primary database loss does not resurrect an account, original receipt survives append/primary crash, unavailable/stale independent ledger blocks restored traffic, paused jobs resume once, bounded overload, no dry-run mutations, parseable stdout JSON and correct exit codes. Measure 24-hour RPO / four-hour RTO targets in an isolated drill; report unmet targets. Monthly recurring operations start only after service activation ownership exists. **Estimate:** human 6–10 days; agent 24–40 active hours.

## I12 — Contributor workflows, examples, CI and documentation

**Owner:** Worker A after client services; root owns all existing/shared config/CI edits. **Depends:** I01–I11 runnable paths. **Reviewer:** Worker C as clean-checkout contributor plus root. **Scope:** X09, DX01–DX08, C14/C17/C18/C21, D11.

**NEW:** `docs/developer/README.md`, `quickstart.md`, `configuration.md`, `testing.md`, `native.md`, `provider-sandbox.md`, `migrations.md`; `CONTRIBUTING.md`, `CHANGELOG.md`; `tests/examples/local-save.ts`, `offline-retry.ts`, `conflict.ts`, `complete-export.ts`, `webhook-reconciliation.ts`; `scripts/test-examples.mjs`, `test-docs.mjs`, `test-dx.mjs`; `tests/dx/*`; `docs/evidence/expansion/dx/*`. **EXISTING/root:** README, CI, package scripts, root test config, doctor/local tools/config after explicit serialized handoff from I01/I03.

Document four separate paths with exact meaningful success, safe failure/reset and account/tool waits: guest, local sync, unsigned native, authorized provider sandbox. Keep guest first and credential-free. CI validates scripts/config names/links and runs examples against real contracts and both repository adapters where applicable. Separate Linux web/local jobs, macOS iOS jobs and Android jobs; unavailable infrastructure is reported, not silently skipped into a green all-platform claim. Include protocol/local/backup matrix, N/N-1 fixtures, exact native dependency/license inventory, private security reporting and synthetic reproduction. No public SDK, community, remote or new project license is introduced.

**Verify:** planned `npm run test:examples`, `npm run test:docs`, `npm run test:dx`; `npm run doctor -- --capability guest --json` and capability-specific missing-dependency cases; `npm ci`, `npm run dev`, actual saved/reloaded checkpoint from a clean checkout. Check Docker missing, occupied port, wrong project, remote-reset refusal, missing provider secrets and bundle exclusion. Record a human walkthrough per claimed contributor OS, including README, cold download, confusion and first meaningful save; target under five minutes with Node/npm installed, never replace it with warm CI timing. Unsupported/unmeasured OS paths stay labeled. **Estimate:** human 3–5 days; agent 12–20 active hours; human walkthroughs 1–3 hours per supported OS including record/retest.

## I13 — Integrated regression, adversarial races, load and independent judge

**Owner:** root coordinates; independent reviewer occupies a freed worker slot and authors the final judgment. **Depends:** I01–I12. **Reviewer:** an agent who did not implement the inspected boundary; root resolves defects through its original owner. **Scope:** all R/X/C/D/DX requirements.

**NEW:** `tests/security/*`, `tests/compat/*`, `tests/load/reconnect.ts`, `tests/expansion/rollout.spec.ts`, `scripts/test-security.mjs`, `test-compat.mjs`, `test-load.mjs`; `docs/evidence/expansion/requirements.json`, `docs/expansion-verification.md`, `docs/expansion-judge.md`. **ROOT:** existing tests and CI only for justified integration fixes; do not relax prior thresholds or assertions to obtain PASS.

Run all old and new suites on one frozen integrated source/build. Test both controlled completion orders and restart/fresh-reader results for account switch/push, replacement/append, media/deletion, paid/refund, pull/local overlay; add concurrent cursor commit, deletion/finalizer, receipt compaction and recovery-principal races. Every fourteen-row rescue needs caller assertion, durable-state assertion and safe error/help. Test public-key direct bypass, owner spoofing, malicious media/metadata, redirects, test grants, CSP/config secrets and old/native client compatibility. Independent review checks security boundaries rather than counting mocks.

**Verify:** all existing command block checks; planned `npm run test:server -- --suite all`, `npm run test:sync:smoke`, `npm run test:security`, `npm run test:compat`, `npm run test:examples`, `npm run test:docs`; both native builds/tests; load 100 reconnecting accounts then stress 1,000. Performance baseline retains 500 ms text save at 20/200, usable search at 50/500, five-second 10/100 media restore; measure native startup/import/48 MiB export peak memory separately. Record p50/p95 only with sufficient samples, errors, queue age, locks and bounded backlog; no lost/duplicate/cross-account effects and uninterrupted local capture. Include retained/dormant accounts and recovery traffic; a local load result is not a production pricing/capacity claim. Final matrix labels local PASS separately from external BLOCKED/UNVERIFIED. **Estimate:** human 6–10 days; agent 24–40 active hours plus deliberate load/build execution; defect repair revises the estimate.

## I14 — Real sandbox, physical-device and signing qualification

**Owner:** root coordinates with human account/device/signing owner; B handles server/provider failures, C native qualification, A web caller failures, within four agents. **Depends:** I13 shared contracts PASS; available authorized test accounts and devices. **Reviewer:** independent test observer and release owner. **Scope:** X01/X04/X05/X06/X09/X10; all external portions of C04/C06/C12/C13/C18/C23 and D06/D10/D11.

**NEW:** `scripts/sandbox/web.mjs`, `ios.mjs`, `android.mjs`; `tests/sandbox/*`; `docs/evidence/expansion/sandbox/*`, `physical/*`, `signing/*`; `docs/release/qualification.md`, `store-disclosures.md`. **EXISTING:** provider/native config references only, secrets stored outside git; root owns package/script changes, C owns native signing configuration. No account creation, paid plan purchase or live charge is implicit.

First run actual Razorpay test-mode order/payment/webhook/ledger and RevenueCat+Apple/Google sandbox purchase/cancel/pending/restore/reinstall/refund/mismatch/recovery with the intended identified-user transfer policy. Inspect real raw webhook handling and authoritative provider fetch. Sandbox grants remain environment-separated. Provider inability to verify recovery is a blocked promise to resolve before sales, not permission to accept screenshots/client claims.

Then verify physical iOS and Android capture/playback/persistence, denial/revocation, lock/interruption/process death, low disk, share/import, OS backup/key loss, system text/VoiceOver/TalkBack, safe areas/Back/landscape and native-to-web label continuation. Print and scan readable legacy/current bag labels on intended devices. Build signed installable artifacts with supplied authorized identities, verify fresh install/upgrade/reinstall and associated-domain/app-link behavior against the selected HTTPS domain. Retest the signed build where signing changes those surfaces. Sequence may iterate when a physical test itself requires a provisioned build; simulator results are never relabeled.

**Verify:** planned `npm run test:sandbox:web`, `npm run test:sandbox:ios`, `npm run test:sandbox:android`; planned native tests with `--target device --device-id <available device>`; manual signed-install/accessibility/print checklists attached to exact artifact hashes. Mark per platform: unsigned build, simulator/emulator, provider sandbox, physical, signing and link proof separately. A missing account/device/identity blocks only its external gate; keep remaining local fixes and other-platform qualification moving. **Estimate:** human specialist/test work 5–10 days; agent 12–24 active hours for harnesses, observation and fixes. Account approval, store sandbox propagation, physical-device scheduling and signing enrollment waits are unknown calendar time, not part of those estimates.

## I15 — Authorized pilot, funding/research decisions and qualified release

**Owner:** named human product/release/operations owners plus root for preparation. **Depends:** I13 and applicable I14 platform gates. **Reviewer:** independent acceptance judge and human release owner. **Scope:** X09 and remaining R external gates, C13/C19/C20/C21/C22, DX08.

**NEW:** `scripts/test-release.mjs`, `tests/release/*`; `docs/release-readiness.md`, `docs/expansion-research-protocol.md`, `docs/release/pilot-results.md`, `docs/release/activation-record.md`; `docs/evidence/expansion/release/*`. **EXISTING/root:** `docs/operating-budget.md`, runbook, verification/release matrices and store listing drafts. Prepare reviewable configurations, signed artifacts, privacy/support/deletion pages, support/recovery procedure and release notes before any publishing decision.

The private pilot is a separate, explicitly authorized external activity with actual backend/email/domain/provider projects, qualified platforms, privacy/support contact and operational ownership. Broad public activation requires a funded operating decision using measured 100/1,000/10,000 active-user scenarios, dormant retained accounts, backups, media transfer, email, merchant fees/taxes and support. Current budget scenarios are illustrative and **not funded**. Account quotes and observed usage replace assumptions; no package license or quota implies free provider service. Record approved monthly amount/currency, funding duration/continuity response and 50/80/100% alerts; at ceiling pause new enrollment while protecting current local use and access/export obligations. Do not silently introduce a recurring tier.

Research remains independent from engineering PASS: authorized 15-person enriched cohort, each with at least four unfinished projects; 10 voluntary checkpoint users, 8 week-later restarts and 5 actual purchasers. Record prompting, current-method comparison, capture abandonment, next-step recovery time, cross-device use and confidence; separately inspect lighter-use prospects. Below 10/8 holds broad promotion and triggers capture/onboarding investigation; weak purchases require a documented cap/price/value decision before paid promotion. Sandbox payments cannot count as purchasers. No participant contact, analytics collection or real charge is authorized by this planning artifact.

**Verify:** planned `npm run test:release -- --environment staging --platform web` and qualified native variants; authorized post-deploy first-five-minute guest save/auth/A-B denial/sync append/durable webhook smoke; first-hour queue/error/budget review. Real deployment/store submission happens only after the user approves the concrete release action and required accounts are available. Qualify web/iOS/Android independently; blocked store review does not erase its X requirements or justify claiming all-platform availability. Rollback and database-plus-object restore evidence accompany each release decision. **Estimate:** release preparation human 2–4 days and agent 8–16 active hours. Research facilitation/analysis estimate 3–6 human days plus at least the one-week restart interval; recruitment, real purchase outcomes, funding decisions and store review duration are unknown. Do not convert these uncertainties to an agent-hour delivery guarantee.

## Coverage and final execution order

| Accepted obligation | Owning packages and closing evidence |
|---|---|
| X01 auth/guest/isolation | I01/I02/I03/I05/I09/I10; I13 adversarial A/B tests, I14 native auth/links |
| X02 durable sync | I02/I03/I06; I13 two-device/tab, restart, cursor and race evidence |
| X03 private media/export | I04/I06/I07; I13 all-byte parity/quota; I14 device storage |
| X04 web checkout | I08/I09 local authority tests; I14 real web sandbox; I15 sales activation |
| X05 native purchase/restore | I08/I10; I14 both store sandboxes and recovery; I15 platform qualification |
| X06 native applications | I04/I10 unsigned builds; I14 physical/signed installs; I15 store result |
| X07 ownership/deletion | I02/I05/I06/I07/I11; I13 both race orders/backup deletion ledger; I14 provider recovery |
| X08 free/paid access | I01/I02/I08/I09; I13 legacy/over-cap/history/offline/refund tests |
| X09 operations/release | I03/I07/I08/I11/I12/I13; I14/I15 separate release gates |
| X10 capture/accessibility | I02/I06/I09/I10; I13 original R1–R9 regression/performance; I14 assistive devices |
| C00–C08 | I01–I15 retain all three selected additions; I02/I05/I06/I07/I08/I09/I10/I11 prove local durability, account, media, purchases, complete export, stack compatibility and recovery |
| C09 | All packages preserve the scope exclusion: no social/collaboration, marketplace, AI transcription or reminders are added. |
| C10–C18 | I01/I02/I03/I05/I06/I07/I08/I10/I13; CAS/history/labels/qualified release/rescue/legacy/both-order/module/authority proofs |
| C19–C23 | I09/I11/I13/I15; funded pilot, observability, additive rollback, measured research and complete interface states |
| D01–D05 | I02/I05/I06/I07/I09; collection identity/offline readiness/unique work/conflict/connection preview |
| D06–D09 | I07/I08/I09/I10; durable continuation/quota/status/receipt |
| D10–D12 | I09/I10/I13/I14; responsive/assistive-device/copy/private-route/rendered design evidence |
| DX01–DX03 | I01/I03/I04/I06/I12; four setup paths/frozen versioned examples/safe offline-help catalog |
| DX04–DX06 | I01/I11/I12/I13; bounded operations/docs+CI/typed config and test separation |
| DX07–DX08 | I01/I02/I11/I12/I13/I15; version compatibility/rollback and actual human setup measurement |

### Canonical homes for all 46 test-plan groups

Earlier proposed test filenames in `expansion-test-plan.md` are aliases to this map when different. Consolidating related cases into one suite does not remove a branch, oracle or test level; the implementation result must list every T ID and executed case. Native directory entries mean actual XCTest/Android instrumentation suites plus physical checklists, not replacement Node mocks. Files below are new except the existing `tests/scale.spec.ts`.

| Group | Package | Canonical executable/evidence files |
|---|---|---|
| T01 | I01/I02/I09 | `src/domain/policy.test.ts`; `tests/expansion/states.spec.ts` |
| T02 | I02 | `src/repositories/browser/migration.test.ts`; `tests/expansion/local-migration.spec.ts` |
| T03 | I05/I10/I14 | `tests/expansion/accounts.spec.ts`; `tests/native/ios/flows/*`; `tests/native/android/flows/*` |
| T04 | I05/I07 | `tests/expansion/collection-connection.spec.ts`; `tests/server/replacement.test.ts` |
| T05 | I05 | `tests/expansion/accounts.spec.ts` |
| T06 | I02/I04 | `src/repositories/browser/repository.test.ts`; `src/repositories/contract-suite.ts`; `tests/native/ios/persistence/*`; `tests/native/android/persistence/*` |
| T07 | I04/I14 | `tests/native/ios/persistence/*`; `tests/native/android/persistence/*` |
| T08 | I06 | `src/sync/coordinator.test.ts`; `tests/expansion/sync-races.spec.ts` |
| T09 | I01/I03 | `src/domain/contracts.test.ts`; `supabase/tests/commands.test.sql` |
| T10 | I03/I06 | `tests/server/sync-ordering.test.ts`; `tests/expansion/sync-races.spec.ts` |
| T11 | I03/I06 | `tests/server/sync-ordering.test.ts`; `tests/expansion/sync-smoke.spec.ts` |
| T12 | I06/I09 | `tests/expansion/sync-races.spec.ts`; `tests/expansion/states.spec.ts` |
| T13 | I03/I06 | `tests/server/sync-ordering.test.ts`; `src/sync/coordinator.test.ts` |
| T14 | I03/I13 | `supabase/tests/ownership.test.sql`; `tests/server/schema.test.ts` |
| T15 | I07 | `tests/server/media.test.ts`; `supabase/tests/media.test.sql` |
| T16 | I06/I10/I14 | `tests/expansion/media-backup.spec.ts`; `tests/native/ios/flows/*`; `tests/native/android/flows/*` |
| T17 | I01/I07 | `src/domain/policy.test.ts`; `tests/server/media.test.ts`; `tests/server/replacement.test.ts` |
| T18 | I06 | `tests/expansion/media-backup.spec.ts`; `src/services/backup-service.test.ts` |
| T19 | I06/I07 | `tests/expansion/media-backup.spec.ts`; `tests/server/replacement.test.ts` |
| T20 | I07/I11 | `tests/server/recovery.test.ts`; `tests/ops/recovery.test.mjs` |
| T21 | I08/I14 | `tests/expansion/purchase-continuation.spec.ts`; `tests/sandbox/web/*` |
| T22 | I10/I14 | `tests/native/ios/flows/*`; `tests/native/android/flows/*`; `tests/sandbox/ios/*`; `tests/sandbox/android/*` |
| T23 | I08/I14 | `tests/server/billing.test.ts`; `tests/sandbox/web/*`; `tests/sandbox/ios/*`; `tests/sandbox/android/*` |
| T24 | I08 | `supabase/tests/billing.test.sql`; `tests/server/billing.test.ts` |
| T25 | I08/I13 | `tests/server/billing.test.ts`; `tests/security/billing.test.ts` |
| T26 | I08/I14 | `tests/server/billing.test.ts`; `tests/expansion/purchase-continuation.spec.ts`; `tests/sandbox/*` |
| T27 | I07 | `tests/server/deletion.test.ts`; `tests/expansion/accounts.spec.ts` |
| T28 | I07/I09/I11 | `tests/server/deletion.test.ts`; `tests/server/recovery.test.ts`; `tests/expansion/states.spec.ts` |
| T29 | I05/I10/I14 | `tests/expansion/links.spec.ts`; `tests/native/ios/flows/*`; `tests/native/android/flows/*` |
| T30 | I10/I14 | `tests/native/ios/flows/*`; `tests/native/android/flows/*` |
| T31 | I10/I14 | `tests/native/ios/flows/*`; `tests/native/android/flows/*` |
| T32 | I10/I14 | `tests/native/ios/flows/*`; `tests/native/android/flows/*`; `tests/expansion/media-backup.spec.ts` |
| T33 | I06/I09 | `src/sync/status.test.ts`; `tests/expansion/states.spec.ts` |
| T34 | I09 | `tests/expansion/accessibility.spec.ts` |
| T35 | I14 | `docs/evidence/expansion/physical/accessibility.md` |
| T36 | I09 | `tests/expansion/privacy-routes.spec.ts`; `docs/release/store-disclosures.md` |
| T37 | I12 | `tests/dx/doctor.test.mjs`; `docs/evidence/expansion/dx/*` |
| T38 | I03/I12 | `tests/dx/local-stack.test.mjs` |
| T39 | I11 | `tests/ops/commands.test.mjs` |
| T40 | I01/I12/I13 | `src/config.test.ts`; `tests/compat/versions.test.ts`; `tests/examples/*` |
| T41 | I13 | `tests/load/reconnect.ts` |
| T42 | I04/I13 | `tests/scale.spec.ts`; `tests/native/ios/persistence/performance/*`; `tests/native/android/persistence/performance/*`; `docs/evidence/expansion/I13/*` |
| T43 | I11 | `tests/ops/alerts.test.mjs` |
| T44 | I11/I13 | `tests/expansion/rollout.spec.ts`; `tests/ops/recovery.test.mjs` |
| T45 | I15 | `docs/expansion-research-protocol.md`; `docs/release/pilot-results.md` |
| T46 | I14/I15 | `docs/release-readiness.md`; `docs/release/qualification.md`; `tests/release/*` |

Execute these waves; the order names work that can finish locally while external prerequisites are absent:

1. **P0/P1, then I01:** freeze the verified foundation and reviewed plan; root freezes executable contracts/configuration/examples. No consumer guesses interfaces in parallel.
2. **Three lanes:** A builds I02 browser persistence, B builds I03 local backend, C builds I04 native persistence/unsigned compatibility. Root integrates shared-file changes and reviews completed contract fixtures. Resolve real native build incompatibility here, before expanding native features.
3. **Connect the data paths:** A runs I05 then I06; B runs I07; C starts I10 against frozen interfaces and deterministic fakes, then the actual shared services. Root begins I09 only against reviewed service contracts. Integrate/retest source-bound migration, deletion and replacement before claiming sync complete.
4. **Complete purchases and recovery:** B owns server I08 then I11; A contributes its disjoint I08 client coordinator then I12; C completes I10. Root completes I09 and CI/package integration. No fourth worker is added to “speed up” review.
5. **Freeze and judge locally:** I13 runs all required current/new suites on one integrated commit, with isolated performance intervals. Return code defects to their owning lane, rerun affected checks, and refresh final evidence. Local completion does not wait for an account merely to test code that can be exercised deterministically.
6. **Qualify real boundaries:** I14 uses only available authorized provider accounts/devices/signing identities. Complete web sandbox, both native sandboxes, physical cases and signed/link cases with individual statuses. Missing external prerequisites remain a named gate with owner/action, while all independent work continues.
7. **Activate deliberately:** prepare I15 artifacts, secure actual funding/research/account/release decisions and run an authorized private pilot. Review pilot outcomes and release each qualified platform with explicit external publication/submission authorization. Continue to carry unqualified platforms as open scope.

Estimates sum effort, not elapsed delivery: I01–I13 are approximately **78–124 human-engineer days** or **308–496 active agent hours**, before I14/I15, external waits and unforeseen defect repair. These are independent planning ranges, not a measured agent-to-human conversion or a promise that four agents divide elapsed time by four. Contract/backend/native dependencies, root integration, builds and exclusive performance windows constrain overlap. Re-estimate after I04 and the first integrated two-device sync using observed task/build times. Routine code/test/review work has no additional human approval gate under the standing implementation delegation; provider account access, spending, physical access, signing and external publication retain their actual prerequisites and authorization boundaries.
