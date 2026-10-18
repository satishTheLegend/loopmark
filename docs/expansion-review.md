# Expansion review record

18 October 2026. Review depth: implementation-ready. The selected gstack route is CEO → Design → DX → Engineering. This is a planning review; no expansion implementation, account creation, charge, deployment or store submission is being performed.

## Execution provenance

The installed autoplan helper initialized `docs/expansion-plan.md` and its immutable restore point. CEO methodology `d32f7325ecbe77cd174184edda46a1ec7dd322854527bf297a79895e780d3fe9` was read through all 2,466 lines: requested ranges 1–600, 601–1200, 1201–1800, 1801–2400, 2401–2466; tool-truncated portions were reread in smaller ranges (250–420, 1470–1600, 2210–2260, final 2401–2466). Skip-listed shared preambles were loaded and not re-executed. Source checkpoint: `autoplan-ceo-A7FHoB/ceo-implementation.md`, SHA `ffbf3b1533be8b76a2655b465043ef5c7a6d7cb69384221215d502c104c9e1ea`.

Claude Code is enabled by configuration but its executable did not resolve during actual preflight. Outside coverage is unavailable, not a clean review; all cross-model consensus cells remain N/A. Each applicable native review must complete independently. External services, telemetry and artifact synchronization remain off. The available toolchain (Xcode, Docker, adb) proves tool presence, not signing, account eligibility or real-device testing.

## CEO Step 0: system and premise audit

The repository has one baseline commit, `5d9bd54`, no stash and no remote. The current local reliability work is explicitly owned by the parent and browser/data reviewers; this plan must begin from its final committed, verified output. No repository-local AGENTS.md or TODOS.md existed at intake; the user's supplied AGENTS instructions govern. Existing `docs/architecture.md` describes the local release; its exclusions are historical and superseded only for the proposed expansion, not evidence of shipped cloud features.

Taste references are `src/data.ts` (transactional receipts and restore checks), `src/components/Forms.tsx` (recovered drafts with explicit save/leave handling), and `src/components/ProjectView.tsx` (latest next step first). Avoid copying the growing all-responsibilities shape of `src/App.tsx` into account/sync/billing, and avoid retaining base64 project aggregates as the native media store. The repeated local failures around asynchronous conversion, cleanup retries and stale snapshots are evidence that cross-service operations need explicit completion and ownership boundaries.

**0A, premise challenges.** Forgotten restart context is directly evidenced in the user's research; cloud or native packaging alone does not establish stronger restart habits. Existing competitors already offer cloud and project tracking, so those are delivery capabilities rather than a distinctive promise. The do-nothing cost is continued manual transfer and loss risk between devices; the cost of indiscriminate expansion is a slower capture interaction and recurring hosting/support obligations. The requested X01–X10 remain in scope; no reviewer may silently exchange them for a smaller product.

**Landscape, three layers.** Layer 1: a physical tag or exported notebook already solves single-device restart for some makers. Layer 2: [Pocket Crochet](https://pocketcrochet.app/) currently advertises remembered pattern position plus paid cloud storage/sync; [Knitting Buddy 2](https://apps.apple.com/us/app/knitting-buddy-2/id1510616471) advertises cross-device cloud data. Layer 3: Loopmark's differentiator must remain the speed and clarity of the checkpoint and next action, measured after a real interruption. Sync should preserve that record, not demand new project administration. Official sources were searched on 18 October 2026; historical Reddit claims about absent competitor cloud are not treated as current facts.

**0B, reuse map.** Preserve domain types/validators (`src/types.ts`), portable backup/media validation (`src/data.ts`, `src/media-validation.ts`), input media preparation (`src/media.ts`), draft behavior (`src/drafts.ts`), and capture/resume UI. Introduce repository interfaces only where IndexedDB/native transactions and network coordination differ. A full UI rewrite offers no demonstrated benefit and would discard actual browser regression evidence; the existing persistence module can be extracted behind a compatibility facade without rewriting accepted validation rules.

**0C, dream-state map.**

```text
CURRENT                      THIS PLAN                         12-MONTH IDEAL
one private browser  -->  optional shared personal library --> trusted restart habit
manual full exports      web + iOS + Android + real purchase   proven use after weeks
no recurring service     bounded recoverable service          measured sustainable support
```

This plan closes distribution and recovery gaps. It does not prove willingness to pay, sustainable cloud economics, store acceptance, or the 15-person outcome thresholds. The research experiment remains a release/business evidence track with no fabricated result.

**0D/0E, choices.** Select Capacitor + shared React UI + Supabase explicit sync + RevenueCat native entitlement verification + Razorpay web adapter, subject to required compatibility/sandbox and merchant-account gates. Expo DOM/native hybrid is a viable alternative if the named native feasibility slice fails; separate Swift/Kotlin implementations are rejected for this release because three independent UIs add maintenance without a demanded native-only interaction. This is a provisional taste choice for the final gate. SELECTIVE EXPANSION comes from the autoplan driver, not a claim that the user selected that mode; it preserves every requested expansion despite the >15-file complexity warning.

**0F/0G, complexity and delight scan.** Three delivery areas share identity, domain storage and entitlements, so one contractual core with separate adapters is the smallest complete design. Remove duplicated UI work, not accepted capabilities. Five small opportunities were considered individually: (C01) plain-language “saved here / waiting to sync / synced” status, accepted within X02/X10; (C02) exact account and project counts before collection attachment, accepted within X01/X07; (C03) retry only the failed media item from sync details, accepted within X03; (C04) purchase restoration beside upgrade status with a clear account mismatch explanation, accepted within X05/X08; (C05) show export readiness and missing download counts, accepted within X03. Each is S implementation effort, low-to-medium interaction risk, and prevents a failure already in the accepted scope. A public social feed, pattern marketplace, AI transcription, collaborator editing and reminders are declined as unrelated new capabilities. None of X01–X10 is deferred.

The 10x ambition is returning on any owned device and seeing a reliable next step immediately. A platform for third-party developers, marketplace or automation API is unnecessary. DX review still runs because the helper's term detector is positive; its subject will be the implementation/operator workflow and provider contracts, not an invented public SDK.

## Step 0 decisions

| ID / owner | Contract and evidence | Current | Proposed | Status | Exact authority and scope |
|---|---|---|---|---|---|
| C00 / product | User selected all three additions | Local R1–R9 | Preserve R1–R9 plus X01–X10 | Accepted | Latest user answer “1,2,3”; no scope cut |
| C01 / UI | Save must remain independent of network | Local success notice | Distinct local/pending/synced states and tests | Auto-decided | Autoplan P1/P5; X02/X10 |
| C02 / identity | No silent upload or cross-account leak | Guest library | Account/count preview and generation fences | Auto-decided | P1; X01/X07 |
| C03 / media | Quota or transport failure retains checkpoint | Local attachment | Per-item retries and visible pending state | Auto-decided | P1/P5; X03 |
| C04 / billing | Restore does not transfer craft data | No billing | Restore + account mismatch recovery | Auto-decided | P1; X05/X08 |
| C05 / backup | A full export contains all media | Complete local JSON | Download/verify completeness before export | Auto-decided | P1; X03 |
| C06 / architecture | Existing UI is proven, native adapters are new | React/IndexedDB | Capacitor/Supabase/RevenueCat/Razorpay | Provisional taste | P3/P4/P5; final gate retains Expo/direct-IAP alternatives |
| C07 / operations | Provider database backups omit object bytes | Generic backend restore drill | Separate object snapshot and hash-verified recovery | Auto-decided | P1; X09; official provider evidence |
| C08 / product | Permanent upgrade does not fund infinite storage | Price hypotheses | Same 48 MiB export-safe cloud envelope; no lifetime service promise | Auto-decided | P1/P5; X03/X08; no price change |

No new scope deferrals require a TODO entry at this point. The declined unrelated features are deliberate non-goals, not hidden backlog work.

## CEO Step 0H and 0I

Two actual fresh-context spec reviewers read both full inputs. Attempt 1 returned 8/10 and two issues; the replacement concurrency contract and unconditional history access were amended through the immutable checkpoint. Attempt 2 returned PASS 9/10, confirmed both fixes, and reported no further issues. Required spec metrics were persisted under the actual gstack state root. The intermediate document-continue decision is auto-selected under autoplan; it does not approve product implementation or the final design.

Temporal interrogation: the first foundation block must define namespace migration, repository transactions and file durability before changing account UI (human 2–3 days / agent-assisted 1–2 days, conditional estimates). Core work must settle cursor commit ordering, idempotency retention and media reservation before workers build consumers (human 4–6 days / agent-assisted 2–3 days). Integration must expect deep-link account races, native process death, stale snapshots and webhook reordering (human 4–8 days / agent-assisted 2–4 days). Polish requires store sandbox accounts, physical devices, recovery drills and accessibility evidence; these external calendar gates are not compressed by an AI effort estimate. Native storage and production merchant eligibility are explicit verification gates, not assumed capabilities.

## CEO independent voices

Native `ceo_voice` completed against input `68349aea490208f319e08805d09262963edcd8092b0371a222c38f75e02e7e6c`. It found five concerns: high outcome-measurement risk, high unfunded recurring-cost risk, high biased-cohort conversion inference, medium release sequencing risk and medium unclear comparative advantage. No critical strategic defect was reported. The outside executable was rechecked immediately after native completion and returned `CODEX_MODE: not_installed`; no outside result exists.

| Dimension | Native finding | Claude Code | Consensus |
|---|---|---|---|
| Premises valid | Delivery does not prove voluntary restart habit | Unavailable | N/A |
| Right problem | Cross-device dependable resumption is the outcome | Unavailable | N/A |
| Scope calibration | Keep all three; stage qualified releases | Unavailable | N/A |
| Alternatives | Compare release policies as well as frameworks | Unavailable | N/A |
| Competitive risk | Compare against each maker's current method | Unavailable | N/A |
| Six-month trajectory | Fund ongoing operations before activation | Unavailable | N/A |

No cross-model user challenge exists because the outside voice is absent. The five native findings are accepted as release-evidence obligations, not grounds to delete the user's selected features.

## CEO Section 1: Architecture

Current scope remains SELECTIVE EXPANSION under the driver: C00 retains X01–X10; C01–C08 and C10–C12 are accepted/provisional per the audit trail; C09 unrelated additions are declined. None of the requested cloud, billing or native work is deferred. C06 is the only framework/provider taste choice at this stage.

The primary boundary is the durable local repository, not the network client. Auth is needed to exchange data or buy an account-bound entitlement, while capture commits to the selected collection without a network dependency. One typed application layer and explicit browser/native adapters are justified; a custom auth service, public SDK or three independent UI implementations are not. Postgres and the merchant/store providers become availability dependencies, but their failure must leave local capture and existing exports usable.

```text
BEFORE: React -> data.ts -> IndexedDB aggregate; local media -> data URL
AFTER:
 existing React capture/resume ---- application commands ---- local repository
              |                      |                     /                \
 account/sync/purchase screens        |              IDB transactions    SQLite + files
              |                      +------ durable outbox -----+
              |                                                   |
 secure session adapter -> account generation -> foreground coordinator
                                              -> authenticated server commands
                                                -> owner-locked Postgres / private objects
 verified provider event -> durable inbox -> entitlement grant ledger
 private support tools -> audited replay/deletion/backup jobs
```

At 10x traffic, media transfer, auth email and periodic reconciliation cost become visible before project text storage; at 100x, change-feed indexing, connection pressure and webhook/deletion queues need measured capacity, not more client cache promises. Use per-account bounded pages/jobs, owner+cursor indexes and quotas. A broken client release is disabled by feature flags while preserving local writes; database changes are expand-only until old clients retire. Target operator disablement within 15 minutes and validated binary rollback within one hour; actual recovery time must be drilled before production.

Decision C13 (mechanical, P1/P5): require private pilot and separately qualified platform rollout. The native finding's alternative, simultaneous public release held by the slowest store, adds calendar coupling without strengthening data correctness. Cross-platform availability claims require all named platforms qualified; a blocked storefront remains plainly unavailable while its accepted work continues.

## CEO Section 2: Error and rescue registry

The initial prose named important failures but did not name their caller contracts. The following are proposed application interfaces, not existing exports. Each failure is typed, leaves the last durable state intact and is verified at the caller as well as the helper; an unexpected exception produces a redacted diagnostic ID and an actionable error without claiming success. No AI invocation is proposed, so refusal/hallucination handling is inapplicable.

| Method/codepath | Failure classes and trigger | Rescue | User result | Required regression |
|---|---|---|---|---|
| `AuthService.requestCode/verifyCode` | `ValidationError`, `RateLimited`, `ExpiredCode`, transport timeout | Validate first; respect retry-after; retain intended route | Field hint, resend timer, retry | Empty/invalid email, expired/reused code, 429 |
| `CollectionService.attach` | `AccountChanged`, `RevisionConflict`, ID collision | Abort old generation; re-preview; preserve source copy | Correct account/count preview | Login A then switch B before commit |
| `Repository.commitLocal` | Quota, disk-full, transaction abort, native file failure | Roll back record/outbox together; retain draft | Not saved; retry/export guidance | Fault every write boundary |
| `SyncCoordinator.push` | Offline, timeout, 401, 429, `Conflict`, `EpochMismatch` | Backoff transient only; pause auth/conflict; recover old epoch | Pending/reconnect/conflict detail | Server committed but response lost |
| `SyncCoordinator.pull` | Malformed page, missing cursor, partial apply | Reject page; keep old cursor; retry validated batch | Last synchronized state remains | Crash before cursor transaction commits |
| `MediaService.stage/attach` | Size/type/hash mismatch, quota, interrupted upload | Reject invalid bytes; retry staged upload; never false synced | Specific attachment pending/failure | Hash mismatch, quota race, stale signed URL |
| `BackupService.exportComplete` | Missing bytes, download error, local space failure | Keep manifest pinned; retry missing items; no success file | Count of missing attachments | Interrupted final media download |
| `CollectionService.replace` | Stale revision/epoch, invalid backup, storage failure | Atomic reject/rollback; re-preview | Existing library unchanged | Another device commits after preview |
| `BillingService.createAttempt` | Invalid product/currency, provider outage, duplicate click | Server allowlist; stable attempt key; retry same attempt | Price unavailable/cancelled/pending | Double click; spoofed amount |
| `WebhookInbox.accept/process` | Bad signature, duplicate, DB unavailable, provider timeout | Reject auth; durable insert before 2xx; dedupe/reconcile | Verifying until authoritative grant | Inbox unavailable; reversed event order |
| `PurchaseService.restore` | Cancelled OS prompt, wrong account, revoked receipt | No transfer; explain support/re-login; reconcile | Restored / none / mismatch | Reinstall and account B restore |
| `AccountDeletion.run` | Old JWT, failed object delete, job interruption | Disable row first; retry idempotently; keep receipt | Deletion pending then completed | Old JWT on every endpoint after request |
| `LinkService.resolve` | Invalid ID, not owned, offline uncached, expired login | Generic unavailable; cached same-account route; retry | No metadata leak; reconnect/restore | A's URL while signed into B |
| `NativePlatform.capture/export` | Permission denied, process death, share cancellation | Retain prepared data; stop tracks; reopen recovered draft | Permission help / draft recovered | Kill between file write and DB reference |

Decision C14 (mechanical, P1): adopt this typed rescue/test map instead of a catch-all “sync failed.” It closes fourteen named failure boundaries already required by X01–X10. Exact module types and numeric retry limits are finalized in Engineering; this does not introduce a new product feature.

## CEO Section 3: Security and privacy

Accounts introduce email/session data, private craft media and purchase identifiers; none belongs in public pages, analytics payloads or crash attachments. Every command obtains owner identity from validated auth, checks an active account row, uses parameterized database operations and enforces server schema/size limits. Public keys receive only minimal row/object privileges; service keys stay server-side. API responses, signed URLs and temporary files must be excluded from service-worker caching. Backend object URLs are short-lived capabilities with a documented residual exposure until expiry or object removal, not a claim of instant link revocation.

| Threat | Likelihood / impact | Remedy and proof |
|---|---|---|
| Guessed project/media ID across users | Medium / high | Owner foreign keys, RLS and private-object policies; direct A/B token tests |
| Late account-A request updates B's UI/store | High / high | Immutable namespace + account generation checks at every async completion |
| Forged legacy/import flag grants upgrade | High / high | Local access preservation never mints server entitlement; signed/allowlisted promotions only |
| Stolen old JWT after account deletion | Medium / high | Active-account check on all RPC/policy paths; old-token denial tests |
| Forged/replayed payment event | High / high | Raw signature/auth, event inbox dedupe, authoritative state fetch, account binding |
| Malicious media/metadata or oversized manifest | Medium / high | Existing safe-raster/container validators, server decoding/limits, bounded requests |
| Credential in client bundle/log/export | Medium / high | Secret scanning, explicit public/server env schemas, redacted diagnostics |
| Arbitrary deep-link redirect | Medium / medium | Allowed route parser and verified app links; no arbitrary external next URL |

Decision C15 (mechanical, P1/P5): preserve legacy local behavior but reject every server purchase claim derived solely from an IndexedDB flag, imported backup or client payload. A genuine research promotion uses a server-admin allowlist with an audited reason and one grant per account. Existing over-cap records remain readable/exportable even without that grant; server create/reopen capacity uses authoritative entitlements. This answers the parent's concrete forged-legacy risk while preserving user data and the original grandfathering intent.

## CEO Section 4: Data and interaction edge cases

Each boundary has happy, nil, empty and upstream-error paths. An empty collection is a valid result and is not an authorization error; a missing owner/token is an authorization error and cannot become an anonymous upload. Empty next-step text remains a field validation failure. Empty change pages advance only the server-declared safe cursor in the same transaction and never erase local records.

```text
FLOW           INPUT -> VALIDATE -> TRANSFORM -> PERSIST -> OUTPUT
account        email/code -> syntax/expiry -> stable owner -> secure session -> explicit attach
               nil/empty: field error; upstream: retry; late generation: discard
local save     draft -> domain/limits -> entity+operation -> one transaction -> saved here
               nil/empty required: reject; quota/crash: rollback; duplicate: receipt
sync push/pull  operation/page -> owner/schema/epoch -> revision/delta -> atomic commit -> ack/cursor
               nil cursor: reject; empty page: valid; conflict: preserve both; timeout: pending
media          file -> type/size/hash/quota -> staged object -> verified reference -> available
               nil optional: absent; empty file: reject; partial/encoding: retry or invalid
purchase       attempt -> account/product/amount -> provider -> inbox+grant -> paid/revoked
               nil auth: login; empty products: unavailable; cancelled: no grant; late event: reconcile
replacement    backup+preview -> schema/revision/epoch -> staged collection -> atomic swap -> rebase
               empty valid library: explicit confirm; invalid/changed: reject; crash: prior or complete
deletion       confirm -> recent auth -> disabled owner -> idempotent purge -> deletion receipt
               missing auth: reauth; empty owned set: complete; object error: pending/retry
links          URL -> allowlisted route+owner -> record lookup -> cache if allowed -> resume
               nil/invalid: unavailable; empty lookup: generic; offline: cached or reconnect
```

```text
Account: guest -> signing-in -> authenticated -> connecting -> connected
         failure -> guest/authenticated; sign-out/deletion increments generation
Outbox: queued -> sending -> acknowledged; transient -> retry-wait -> queued
        conflict -> needs-choice -> new operation; stale epoch -> recovered collection
Media: local -> staged -> verified -> attached; failure -> retry; unreferenced -> GC candidate
Purchase: idle -> attempt -> pending -> verifying -> granted -> revoked
          cancel -> idle; replay never duplicates; late paid cannot override verified refund
Deletion: active -> disabled -> purge-pending -> purged -> auth-deleted
          disabled cannot return to active through a retry; failure stays pending
Restore: preview -> confirmed(revision,epoch) -> commit -> new epoch -> client rebase
         changed revision/epoch -> new preview; stale client never auto-overwrites
Native media: recording -> converting -> staged-file -> DB reference -> durable checkpoint
              process death before reference -> orphan sweep; after reference -> recover
```

The important concurrency pairs are controlled rather than assumed sequential:

```text
Order A                     Order B                     Shared state / assertion
push(A,g1) awaits           sign-in(B,g2) commits        late A response cannot mutate B namespace
push(A,g1) commits first    sign-in(B,g2) follows         A remains A; B loads only B
restore preview(r7)         append commits(r8)          restore CAS rejects r7; renewed confirmation
restore commits epoch2     old append resumes epoch1   reject epoch1; preserve pending as recovery
upload staged object       deletion disables account   attach checks disabled state and fails
attach commits first       deletion purge follows      purge removes reference/object idempotently
refund authoritative       delayed paid event arrives  reconciled current state remains revoked
paid event first            refund follows              grant then revoke; saved craft data retained
pull page validates        local edit commits          merge respects pending local state; no overwrite
local edit first           pull page commits            retain pending version plus base/conflict
```

Tests must pause/release both orderings at actual await/transaction boundaries, then start a fresh reader to assert durable results. Double-clicks reuse operation/attempt IDs; navigating during save preserves drafts; failed/backlogged jobs expose counts and retry; stale list/count previews require refresh; an empty native product list disables purchase with an explanation. Decision C16 (mechanical, P1/P5): adopt the combined ordering matrix and recovery state machines, closing the five concrete cross-service race pairs rather than testing only the favorable order.

## CEO Section 5: Code quality

`src/data.ts` already centralizes validation, capacity, transactions and receipts; `src/types.ts` defines the v1 portable domain; `src/drafts.ts` owns recovery. Reuse those rules through a facade while extracting domain schemas and repository ports. Do not duplicate backup rules into a native plugin or Supabase handler, or put auth/purchase conditionals through every existing component. Platform SDK calls belong in adapters and application state belongs in services/hooks; a generic plugin framework or event bus would add indirection without a current requirement.

Decision C17 (mechanical, P4/P5): create named modules for auth, sync, media, entitlements and platform bridges, with pure shared validators and explicit discriminated error results. Keep public function names tied to user operations (`commitLocal`, `replaceCollection`, `restorePurchases`), not generic `executeAction`. A function growing past five meaningful branches triggers decomposition by failure boundary during review, not an arbitrary line-count rewrite. Existing UI tests must continue to exercise the facade during the staged extraction.

## CEO Section 6: Test review

The old browser suite establishes local behavior only. Cloud, payment and native guarantees need tests at their own authority boundaries: ordinary user tokens for policies, real local database transactions for ordering, native process restarts for persistence, and actual provider sandboxes for payment. Stable operation IDs and explicit pause/release hooks avoid time-based race tests; randomized cases record their seed. External latency tests remain separated from deterministic CI and never turn a failed sandbox into a mocked pass.

```text
R1–R9 existing journeys --------------------> existing data + five-browser suites
X01 auth/attach/account switch -------------> unit parser + local backend + two-session E2E
X02 commit/outbox/push/pull/conflict --------> repository contract + SQL concurrency + two-device E2E
X03 staging/download/export/GC -------------> byte/hash tests + storage policy + interrupted export
X04 web order/inbox/reconciliation ---------> signed-fixture integration + real Razorpay test mode
X05 native purchase/restore/refund ----------> adapter contract + Apple/Play sandbox + reinstall
X06 lifecycle/secure store/media/files -----> simulator/emulator + physical platform checklist
X07 replace/delete/sign-out ----------------> both await orders + old-JWT denial + recovery drill
X08 caps/legacy/revocation -----------------> policy matrix + forged flag + offline entitlement
X09 rollout/backup/secret boundary ---------> migration rollback + DB/object restore + secret scan
X10 capture/accessibility/links ------------> no-network save + keyboard/axe + screen-reader/device
```

The Friday-night test is a two-device offline capture followed by a lost acknowledgement, app kill, re-login and duplicate retry, asserting exactly one server effect and both checkpoints preserved. Hostile QA switches accounts while media, auth refresh and purchase verification are paused; no completion may write into the new namespace. Chaos tests stop the backend or native process at durable boundaries and replay the queue. The plan must count exact effects, compare complete media hashes and assert the old state after failed replacement; “at least one checkpoint” is insufficient.

Decision C18 (mechanical, P1): retain all requested correctness assertions and add caller-level coverage for each registry row, while keeping provider sandbox/manual gates separately visible. No product LLM/prompt feature is included, so model eval suites are inapplicable. Required coverage is not replaced by a percentage goal.

## CEO Section 7: Performance and operating costs

Preserve the existing local save/search/import budgets on the declared lab and measure native devices separately. The likely slow paths are complete media export, initial cloud hydration and bulk replacement; none belongs in capture's local commit. Batch change pages and metadata lookups, index owner+cursor/owner+entity, and bound upload concurrency to avoid one request per visible card. Do not invent p99 measurements before implementation: targets are <500 ms local text-save feedback and <5 s small text convergence on stable test connectivity; media/export latency is reported with bytes, network and device.

Decision C19 (mechanical, P1/P3): public cloud activation requires a funded operating sheet at 100, 1,000 and 10,000 active cloud users, using measured media sizes/downloads and separately pricing database, email, object backup, egress, provider fees and support. Select a controlled subsidized pilot provisionally; a recurring cloud tier remains an alternative requiring a commercial decision, not a silent subscription. Alert at 50%, 80% and 100% of the owner-approved monthly budget; at the ceiling pause new account/cloud enrollment while preserving existing reads, export and local capture, then require an explicit funding response. This addresses the native high-risk cost finding without pretending a 48 MiB quota caps all expenses.

## CEO Section 8: Observability and debugging

Operations need to distinguish “saved locally but not uploaded” from a lost write. Carry a redacted operation/attempt/job ID across client and server; record start, durable commit, acknowledgement, retry category and completion time, without craft text, images, email addresses, tokens or signed URLs. A user-triggered diagnostic export contains version, platform, queue counts and redacted error IDs only, with preview before sharing. It is not automatic telemetry or outbound messaging.

Decision C20 (mechanical, P1/P5): provide day-one panels for pending-sync age, conflict rate, media failures, webhook-inbox age, pending entitlements, deletion-job age and backup freshness. Alert on sustained sync failures >5 minutes, authenticated webhook queue >5 minutes, deletion pending >24 hours or a failed daily backup; make these configurable environment thresholds with a named release owner. Supply bounded replay/reconcile/delete/restore commands with dry-run defaults and runbooks. Three-week debugging must be possible from IDs and categories; raw personal content is not the shortcut.

## CEO Section 9: Deployment and rollout

The initial package sequence was technically plausible but tied every public channel to the slowest prerequisite. Keep every accepted package while qualifying web, iOS and Android independently after the shared cross-platform contract passes. Inventory merchant eligibility, signing access and physical devices before building dependent adapters. The private pilot must run a complete account/sync/purchase journey before a broad release; local deterministic tests and platform sandboxes are necessary but do not establish real user outcomes.

```text
freeze tested local base -> add backward-compatible schema/policies
 -> deploy commands disabled by feature flags -> staging isolation/restore drill
 -> compatible clients -> private pilot + native sandbox/device checks
 -> per-platform release qualification -> explicit public deployment/submission

rollback trigger -> disable new cloud/payment enrollment
 -> preserve local writes + existing export/read -> stop faulty worker
 -> replay known-good commands/client build -> verify receipts/cursors
 -> resume only after recovery evidence; never drop new-schema user data
```

Decision C21 (mechanical, P1/P5): old and new clients must coexist through additive schema changes, explicit payload versions and server minimum supported version errors. Rollback disables capabilities and restores compatible binaries without deleting new columns or queues. Smoke tests in the first five minutes cover guest save, sign-in, A/B denial, sync append and webhook inbox; the first hour reviews backlog, error and budget panels. A platform release remains blocked only by its own unqualified gates unless it makes a cross-platform promise requiring another platform.

## CEO Section 10: Long-term trajectory

The native review correctly separates implementation completeness from demand. The 15-person cohort is intentionally enriched for four-or-more unfinished projects; 5 purchases in it cannot be called population conversion. Retain its 10 voluntary checkpoints, 8 week-later restarts and 5 actual purchases, recording researcher prompts and distinguishing sandbox from real payment. Compare each maker's actual current method on the same restart task, measure retrieval time, confidence, capture abandonment and cross-device use, and collect a separately labeled lighter-use sample before generalizing cap/price conversion.

Decision C22 (mechanical, P1/P3): connect evidence to rollout actions. Falling below the original 10/8 habit thresholds holds broad promotion and triggers observed onboarding/capture investigation; meeting them allows the next cohort, not a claim of market fit. Low voluntary purchase calls for a documented cap/price/value decision before paid promotion, not hidden coercion. Record funding runway and a service-continuity/export notice plan before broad activation. No outreach, behavioral analytics or real purchases occur during planning.

Reversibility is 3/5: React/domain reuse and a provider-neutral entitlement ledger make adapters replaceable, but account identity, stored media and store purchase records create lasting obligations. Three debt risks are provider migration, retained old client versions and operating knowledge concentration; bounded contracts, export fixtures and runbooks address them. The selected small UI touches remain relevant; none of the declined social/marketplace/AI features became required.

## CEO Section 11: Design and user experience

Shelf and the latest next step remain first; account and sync detail are secondary settings. Account connection, purchase and destructive replacement each explain the destination before action. Existing warm paper, Lora/DM Sans and Tabler language remains; no generic analytics dashboard should dominate a maker's restart screen. Mobile keyboard/safe areas, touch targets, text scaling, reduced motion, focus restoration and screen-reader status are planned from the start, with rendered verification after implementation.

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Account/connect | Code verification | Guest library | Expired code/wrong account | Explicitly connected | Local collection not attached |
| Sync | Quiet pending count | Nothing pending | Conflict/auth/quota detail | Last complete sync | Text saved, media pending |
| Upgrade/restore | Localized products/verifying | Product unavailable/no purchase | Cancel/mismatch/failure | Verified upgrade | Pending store approval |
| Export/replace | Manifest/download/validation | Valid empty library | Missing media/stale preview | Complete file/atomic replace | Incomplete download count |
| Deletion | Disabling/purging | No owned records | Retryable job failure | Completed receipt | Cloud disabled, purge pending |

```text
Shelf -> Resume (latest checkpoint) -> Capture -> Saved here -> quiet sync status
  |                                  |                            |
  +-> Account -> sign in -> collection preview -> connect <------- details/retry
  +-> Upgrade -> account requirement -> store/web price -> verify -> entitlement
  +-> Backup -> fetch missing media -> complete export -> reviewed replacement
  +-> Account deletion -> recent auth -> consequences -> disabled -> purge status
Label -> cached record OR login -> authorized fetch -> same Resume screen
```

Decision C23 (mechanical, P5/P1): design the complete state matrix and keep the next-step-first hierarchy. Run the full Design phase next and a rendered design audit after implementation; the plan-level review cannot certify pixels or physical accessibility. A quiet status detail is preferable to continuous animation or modal retry prompts because craft capture must stay quick.

## CEO required outputs and closure facts

NOT in scope: social feed, marketplace, AI transcription, collaborative editing and reminders (five declined capabilities, C09). No accepted X requirement was deferred. Existing code reuse and dream-state delta are recorded in Step 0B/0C; the delta is safer cross-device delivery, not evidence of product-market fit. Six diagram types were produced: architecture, data/shadow flows, state machines, async/error ordering, deployment and rollback; the UI flow is additional. The historical local architecture diagram remains accurate for that release and must be explicitly labeled when expansion docs are implemented; the new architecture does not claim to be shipped.

| Failure mode registry | Rescue planned | Test planned | User-visible outcome | Redacted log |
|---|---|---|---|---|
| Invalid/expired authentication | Yes | Yes | Retry/resend explanation | Yes |
| Account-switch late completion | Yes | Yes | Current account unchanged | Yes |
| Local disk/transaction failure | Yes | Yes | Draft retained, not-saved error | Yes |
| Push acknowledgement lost | Yes | Yes | Pending then one receipt | Yes |
| Pull batch interrupted | Yes | Yes | Prior cursor/state intact | Yes |
| Media invalid/over quota | Yes | Yes | Attachment pending/rejected | Yes |
| Full export missing media | Yes | Yes | Missing count, no false full backup | Yes |
| Stale replacement confirmation | Yes | Yes | Re-review required | Yes |
| Duplicate/spoofed checkout | Yes | Yes | Same attempt or rejected price | Yes |
| Bad/duplicate/reordered webhook | Yes | Yes | Verifying until authoritative | Yes |
| Restore purchase wrong account | Yes | Yes | Mismatch/support path | Yes |
| Partial account purge | Yes | Yes | Disabled, deletion pending | Yes |
| Unauthorized/offline project link | Yes | Yes | Generic unavailable/reconnect | Yes |
| Native kill/permission failure | Yes | Yes | Recovered draft/help | Yes |

These are required tests/rescues in the plan, not executed expansion results. Fourteen rows have no unhandled *planned* critical gap; implementation must prove them.

| Completion Summary field | Actual result |
|---|---|
| Mode | SELECTIVE EXPANSION, autoplan override |
| System audit | One baseline commit; local foundation separately verified; no remote/stash |
| Step 0 | Scope retained; 2 spec launches, 2 issues independently confirmed fixed, latest score 9/10 |
| Section 1 architecture | 1 rollout coupling finding resolved in plan |
| Section 2 errors | 14 paths mapped, 0 unnamed planned rescues |
| Section 3 security | 8 threats mapped; forged legacy entitlement gap resolved |
| Section 4 data/UX | 5 race pairs plus 8 flow boundaries; 0 unhandled planned outcomes |
| Section 5 quality | 1 module-boundary concern resolved |
| Section 6 tests | Full requirement diagram; caller/authority-boundary gap resolved |
| Section 7 performance | 1 funded-cost gate added; no invented p99 figures |
| Section 8 observability | 1 operator visibility/runbook gap resolved |
| Section 9 deployment | 1 mixed-version/qualification risk resolved |
| Section 10 future | Reversibility 3/5; 3 debt risks; cohort inference and comparative value gates resolved |
| Section 11 design | 1 state coverage/hierarchy obligation accepted |
| Required outputs | Non-goals, reuse map, dream delta, 14-row error/failure registries and 7 diagrams saved |
| Scope proposals | 5 delight proposals, all accepted within X scope; 0 accepted requirements deferred |
| CEO archive | Saved at actual gstack state root; both spec inputs reviewed |
| Outside voice | Claude Code unavailable; no completed external review |
| Native voice | Completed, 5 findings; all dispositioned as obligations |
| Lake score | N/A: choices differed in kind; no scored coverage shortcuts |
| Unresolved decisions | Provisional C06 provider/framework taste and final approval remain; no silently cut requirement |

### CEO implementation tasks

- [ ] **CEO-T1 (P1, human: 2 days / agent-assisted: 1 day)** — Product evidence — prepare the private pilot and current-method comparison, preserve 10/8/5 thresholds and separate cohort conversion inference. Files: `docs/research-protocol.md`, `docs/release-checklist.md`. Verify: each metric has a consented collection method, prompt count, denominator and rollout action; no study result is fabricated. Source: native findings 1/3/5, C22.
- [ ] **CEO-T2 (P1, human: 1 day / agent-assisted: 4 hours)** — Operations — calculate funded scenarios and enrollment guardrails. Files: `docs/operating-budget.md`, `docs/runbook.md`, `supabase/functions/ops-status/index.ts`. Verify: 100/1,000/10,000-user scenarios include media backups, egress/email/support, actual account prices and owner-approved ceiling. Source: native finding 2, C19/C20.
- [ ] **CEO-T3 (P1, human: 2 days / agent-assisted: 1 day)** — Release — build per-platform prerequisites, recovery qualification and rollback checklist. Files: `docs/release-checklist.md`, `.github/workflows/ci.yml`, `scripts/release-check.mjs`. Verify: each platform has signed/sandbox/device gates and cross-platform promises cannot pass with a missing platform. Source: native finding 4, C13/C21.
- [ ] **CEO-T4 (P1, human: 2 days / agent-assisted: 1 day)** — Ownership — implement legacy-grant and account-boundary tests as part of account/entitlement work. Files: `src/account/collection-service.ts`, `src/billing/entitlements.ts`, `supabase/tests/ownership.test.sql`, `tests/account-isolation.spec.ts`. Verify: forged legacy flags grant no server feature; every saved record remains viewable/exportable. Source: C15.

Effort labels are conditional engineering estimates for these tasks, not elapsed-time promises or substitutes for provider/account waiting time. Remaining implementation tasks are detailed by later phases from the amended plan.

## Design system audit and Step 0

Design methodology SHA239b341e295da4474646a5251b05a4fdffcca1f6a999ca8d32c4c407419796ec was read through1972lines:1–600,601–900,901–1200,1201–1500,1501–1800,1801–1972, with320–345 reread after truncation. Source/native checkpoint `autoplan-design-ScNDry/design-implementation.md` is bc9cee68c5a63f2a2a36a9835b13b2e441d0807cd38029d403712e898b483924. The full1972-line export includes the seven-pass section, which was read rather than inferred from the driver. No shared onboarding was rerun.

No root `DESIGN.md` exists, but a real authoritative design system exists at `design-system/loopmark/MASTER.md`, with screens/states in `docs/design-system.md`; both were read completely. The plan adds account/collection, sync/conflict, purchase/restore, native shell/permissions, complete backup and deletion surfaces. Reuse existing shell, Dialog, forms, buttons, next-step slip, photo/audio controls, backup preview and label. No existing design-review log was found. Prior actual learnings about recorder finalization and service-worker repair inform lifecycle interruption and offline readiness tests. Brain context was unavailable and no cached brand digest existed; explicit repository design sources supply the required context without repeating user questions.

Initial design completeness impression:6/10. The previous plan names states and protections but lacks operable collection/conflict/purchase transitions. A10would have every new screen's content hierarchy, truthful state, recovery, responsive behavior and accessible interaction specified and verified visually. Final plan completeness is9/10; rendering and physical-device behavior remain untested.

## Design voices and mockup attempt

**Claude Code says:** unavailable; actual executable recheck returned `CODEX_MODE: not_installed`. There is no external design critique and no cross-model consensus.

**Codex in-host independent voice:** completed, exact input hash matched. It found9issues:6high(collection identity, offline media readiness, removing unique pending work, conflict UI, meaningful connection preview, purchase return-to-task) and3medium(resource-specific quota, status precedence, durable deletion receipt). Each is mapped to D01–D09 below. Its hierarchy assessment supported next-step-first and local-save reassurance, with account/cloud secondary.

The designer binary was available and its version probe succeeded. Actual `generate` using a synthetic craft screen brief failed with `No OpenAI API key found`: requested1,saved0, no image/check/board or network request. No paid provider was configured, no private source uploaded, no substitute image called a gstack mockup. Text/ASCII screen specifications are in `docs/expansion-design.md`. The later detailed fallback instruction forbids substituting hand-built HTML as designer output, so none was made. A visual design audit remains a required implementation task.

| Litmus | Native voice evidence | Outside | Consensus | Primary assessment after amendments |
|---|---|---|---|---|
| Brand unmistakable | Existing typography/palette can remain; no explicit yes/no | Unavailable | N/A | Yes, explicit quiet-workbasket tokens and next-step slip |
| Strong visual anchor | Next-step hierarchy sound | Unavailable | N/A | Yes, large sage next instruction |
| Scannable headlines | Collection/conflict gaps found | Unavailable | N/A | Yes, named collection and task headings |
| One job per section | Administrative navigation unspecified | Unavailable | N/A | Yes, separate capture,connection,purchase,recovery |
| Cards necessary | Not explicitly assessed | Unavailable | N/A | Yes for distinct project interactions only; settings rows |
| Motion helps hierarchy | Restrained motion can remain | Unavailable | N/A | Yes, one-shot save/dialog feedback, static reduced alternative |
| Works without decorative shadow | Not explicitly assessed | Unavailable | N/A | Yes by specified typography/surfaces; pixels untested |
| Hard rejections | None named; missing specificity concerns | Unavailable | N/A | None specified after fixes; no generated pixels inspected |

## Design Pass1: information architecture —6→9

D01 selects a visible collection identity and explicit selector over changing the shelf implicitly on login. D05 expands connection counts into predicted outcomes rather than two unrelated totals. D08 provides one stable priority label with complete details rather than alternating errors. Each is a separate P1/P5 automatic decision under the user's delegated routine choices. These fixes make location and next action legible without putting administration above the checkpoint. The ASCII navigation and wide/compact structure in `expansion-design.md` are the required artifacts. A10requires rendered scan testing with real makers; the plan earns9.

## Design Pass2: states —5→9

D02 distinguishes upload acknowledgement from local offline readiness; the alternative single Synced status is misleading. D03 requires unique-work counts and separate discard over a generic removal confirmation. D04 specifies complete conflict alternatives, stale-review invalidation and focus behavior rather than an opaque keep-current choice. D07 separates commercial and technical quotas so Upgrade cannot falsely promise more storage. D09 supplies a receipt that still works after account revocation instead of a broken authenticated status page. All five are separate P1 completeness decisions; accepted requirements include every named failure and regression. The16-row state matrix records what a person sees, with empty and partial states as full cases. Remaining uncertainty is integration rendering, not an undefined state policy.

## Design Pass3: journey and emotional arc —6→9

D06 preserves the initiating purchase task across login,cancel,pending and restart and offers explicit continuation after verification. The rejected alternative loses the draft or automatically creates work after payment. D03/D05/D09 are reused unchanged in the nine-step storyboard, not counted as extra decisions. Five-second orientation, five-minute capture, and five-year recovery are specified. The arc is uncertainty→small note→local reassurance→controlled connection→familiar restart; conflict and deletion supply reversible choices rather than unexplained anxiety. Cohort observation still has to test it.

## Design Pass4: AI-slop risk —8→9

Classifier: OPERATE for private app; READ for support/privacy/deletion explanations. No marketing hero or new persuasion surface is introduced. Seven hard-rejection patterns were checked: no generic first-screen SaaS grid, no weak-brand stock image, no headline without action, no text over busy imagery, no repeated mood sections, no carousel, no stacked settings-card UI. Existing project cards are the project interaction, not decoration. D12 retains exact tokens and one-shot feedback, themes browser affordances, and rejects a generic cloud dashboard. The cream/serif direction is justified by the already accepted project system, not guessed from the craft category. Litmus answers above are primary plan judgments, never invented native/outside agreement. Pixel quality cannot be certified from prose.

## Design Pass5: system alignment —7→9

Reuse `--canvas`, `--surface`, `--ink`, `--clay`, `--sage-soft`, `--danger`, `--focus`; Lora headings and DM Sans controls; existing dialog/buttons/status semantics and Tabler-first exports. D10 adds a readable-control variant for the new essential account/conflict/purchase/recovery content because the old compact desktop system includes12–14px text and smaller targets. This is an explicit addition, not a claim the old design already satisfies16px/44px. D11 updates mode-dependent privacy copy across existing screens/docs/disclosures and retains public/private route separation. Contradictory “no upload” copy would breach the same trust system. No palette/font redesign is needed.

## Design Pass6: responsive and accessibility —5→9

D10 separately defines320/390,768,950+and1440verification, stacked comparisons, safe areas, keyboard-visible errors, system-sheet return, native Back,200%text,44pxtouch areas,contrast,focus and screen-reader transitions. Rejected: generic “stack on mobile” and assuming browser emulation proves real native behavior. D08 provides quiet announcements and no forced focus on sync retries. VoiceOver/TalkBack and actual native text scaling remain mandatory physical-device gates; no score here means they passed.

## Design Pass7: decision register (unscored)

Twelve independent structural choices D01–D12 are individually recorded in the plan with alternatives and P1/P5 authorization. No new aesthetic taste choice was introduced; the CEO's provisional provider/framework choice and final plan review remain pending. The actual presence of controls is established by the plan's account,sync,purchase,backup,deletion,link surfaces. No speculative dashboard or third-party SDK UI was invented. No approved choice is reopened. There are0deferred in-scope design remedies; visual verification is required implementation work, not optional debt.

NOT in scope: brand redesign,marketing landing page overhaul,new motion runtime,public developer portal,fake testimonials(5items). What already exists: design master,screen specification,local components/assets and209browser/33data foundation tests. No TODOS.md proposals: all design fixes and their verification belong to the implementation plan. Mockups:0generated,0approved. Overall score uses the minimum of passes1–6:5→9, with Step0impression6 separate. All plan dimensions are8+; plan design is specified, but visual/native QA is still required. Unresolved design remedies:0; final plan/provider taste approval is not fabricated.

### Design implementation tasks

- [ ] **DES-T1 (P1,human:3days / agent-assisted:1day)** — Collection/recovery UI — implement D01–D05,D08,D09 with destination-aware state and tests. Files:`src/components/CollectionPicker.tsx`,`AccountView.tsx`,`SyncStatus.tsx`,`SyncDetails.tsx`,`ConflictReview.tsx`,`AccountDeletion.tsx`,`tests/account-journeys.spec.ts`. Verify:collection transitions,missing offline media,unique-work discard,stale conflict,connection preview and receipt after revocation. Source:native1–5,8–9.
- [ ] **DES-T2 (P1,human:2days / agent-assisted:1day)** — Purchase continuation/quota — implement D06–D07. Files:`src/components/UpgradeView.tsx`,`src/billing/purchase-continuation.ts`,`tests/purchase-journeys.spec.ts`. Verify:cancel/pending/login/restart return to draft,actual quota remedy,no repeat charge. Source:native6–7.
- [ ] **DES-T3 (P1,human:2days / agent-assisted:1day)** — Accessibility and truthful copy — implement D10–D12 and rendered/native audit. Files:`src/styles.css`,`src/components/Guide.tsx`,`BackupView.tsx`,`Forms.tsx`,`BagLabel.tsx`,`design-system/loopmark/MASTER.md`,`docs/privacy.md`,`docs/support.md`,`tests/expansion-accessibility.spec.ts`. Verify:mode-dependent copy,320–1440px,200%text,keyboard/axe,reduced motion,VoiceOver/TalkBack/system sheets on devices. Source:passes4–6 plus parent cross-surface privacy finding.

These estimates include integration review; provider/device scheduling is additional. Phase-close semantic verification must retain every D requirement in the implementation projection before proceeding to DX.

## DX investigation: scope, persona and evidence

DX methodology `4dbc48bd7606f62cab283e5ac4077a0b5b2dd49c660d330d4122115695903bcc` was read through all2,121lines:1–600,601–1200,1201–1800,1801–2121, with220–345 reread in smaller portions to recover truncation. Each Hall-of-Fame section for passes1–8 was then read separately at its pass; its unsourced marketing statistics are not treated as empirical evidence for Loopmark. No prior DX review exists. Origin is absent, so remote-diff scope is unknown; the named expansion plan is the actual review scope, not a guessed origin/main diff. README/package/scripts,runbook,current error examples,design master and expansion design supplied concrete evidence. No CHANGELOG,environment template or contributor guide was found by the scoped file search. Their absence is a new expansion deliverable, not a defect in the completed account-free local release.

**0A persona:** TypeScript generalist joining the small maker-app team to implement a feature or diagnose lost-sync reports. Context: fresh checkout, known Node/npm, limited familiarity with native/store/backend tools. Tolerance target: useful guest behavior in5minutes; specialized setup gets separate explicit prerequisites. Expects exact commands,local fixtures,typed interfaces,safe reset and reproducible tests. Classification: internal API/service,operator CLI and documentation; DX POLISH auto-selected by autoplan. No public SDK or community platform is added. These routine selection decisions follow P6,not an invented user answer.

**0B developer perspective (first-person, inferred from inspected documents):** I open the README and can identify the product immediately. It tells me which Node version is required and gives me npm ci and npm run dev. I expect to create a project and save a checkpoint before learning any provider configuration. The README also explains that service workers need the production preview and that changing a port changes the data origin, which protects me from mistaking a blank shelf for deleted data. When I move to the expansion plan, I see durable queues, account epochs and verified payments. Those are useful promises, but I cannot yet copy a command that exercises two clients or tell which version numbers must agree. I would look for a configuration template and a short example before editing a repository adapter. If a webhook stalls, I want a command that names its target and previews the repair before it writes. I would be worried if a test adapter could grant production access or if clearing a local stack were the recommended troubleshooting step. These are predicted points of confusion from the documented gap, not observations of a real developer failing a completed implementation.

**0C benchmark and target.** Aside probe returned NEEDS_ASIDE; official web search was used. Peer documents do not give comparable human timing, so no adoption percentage or timing superiority is claimed.

| Tool/workflow | Start→useful result | Time/evidence type | Useful DX choice | Source |
|---|---|---|---|---|
| Loopmark guest | Clean checkout+Node/npm→saved checkpoint survives reload | Unmeasured; documented2commands+browser actions | No credential before value | README Run locally |
| Supabase local | CLI+container runtime→local Auth/DB/Storage | Unmeasured; docs warn initial image download takes time | Project-pinned CLI,local services,explicit prerequisites | [Official local CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) |
| Capacitor existing web app | Existing package/build/index→native platforms | Unmeasured; platform setup separate | Reuse web build,explicit native environment | [Official setup](https://capacitorjs.com/docs/getting-started) |
| RevenueCat Test Store/platform sandbox | Provider project/key→test entitlement; real store setup separately | Unmeasured,not identical to guest boundary | Distinguish fast dev test from real store proof | [Official sandbox guide](https://www.revenuecat.com/docs/test-and-launch/sandbox) |

Target auto-decision DX01 under P1/P5: competitive under5minutes for the exact guest boundary, including README reading and cold npm dependencies with supported Node/npm already present. An under2minute target was rejected as unsupported by any fresh measurement. Backend cold images,native tool installation and provider accounts are distinct journeys, not excluded secretly from a claim covering them. Current TTHW remains unknown; no stopwatch was run on a person.

**0D magical moment:** use the existing guest app to save a next step,reload and see it again. DX01 keeps its two terminal commands and adds an explicit verification instruction. A hosted playground/new SDK would add unrelated infrastructure and is rejected. The local-sync walkthrough then proves two independent clients plus denied cross-account access, rather than printing canned success. **0E mode:** DX POLISH, current scope fixed. **0F journey:**

| Stage | Developer does | Evidence/friction | Resolution/status |
|---|---|---|---|
| Discover | README product,verification,project map | Good local entry; expansion paths not indexed | DX05 contributor index planned |
| Install | npm ci/dev,then local backend/native | Guest clear; new prerequisites/overrides missing | DX01 four recipes and doctor planned |
| Hello World | Save/reload,then two-client smoke | Guest useful result exists; sync recipe absent | DX01 meaningful fixture walkthrough planned |
| Real Usage | Implement ports and provider adapter | Names exist; epoch/version/result shape incomplete | DX02 contract freeze before parallel consumers |
| Debug | Read rescue table,inspect failures | No common help/error/ops grammar | DX03 catalog,DX04 bounded CLI planned |
| Upgrade | Change client/schema/provider packages | Additive intent exists,compatibility guide absent | DX07 matrix,migration fixtures and changelog planned |

**0G confusion report, simulated timestamps, not an observed runtime:** T+0:00read README Run locally, see Node22.12+and npm; T+0:30start npm ci, download duration unknown; T+1:00read production-preview caveat while dependencies may still download; T+2:00hypothetically start dev and save/reload,actual time unknown; T+3:00look for a local-sync command and find only proposed work packages. DX01/DX05 resolve the documented missing recipe/index. This roleplay does not assert an actual terminal result or five-minute success.

## DX voices

Native fresh reviewer completed input07a840f51c332823cf2d3b152adbe5b54399e627f35fb989cc003af2685902ff,all232lines:3high(setup/contracts/errors),3medium(operator grammar/docs/config). No critical finding. Outside preflight again returned not_installed; no external review ran.

| Dimension | Native finding | Claude Code | Consensus |
|---|---|---|---|
| Getting started<5min | Unmeasurable expansion path | Unavailable | N/A |
| Guessable API/CLI | Named ports incomplete;ops grammar absent | Unavailable | N/A |
| Actionable errors | Problem/cause/fix/help unspecified | Unavailable | N/A |
| Findable docs | Contributor paths/examples missing | Unavailable | N/A |
| Safe upgrade | Version distinctions need definition | Unavailable | N/A |
| Friction-free environment | Config/default/invariant distinction missing | Unavailable | N/A |

## DX eight passes and individual decisions

1. **Getting started7→9:** DX01 preserves guest setup and defines four separate recipes plus read-only doctor. A10needs an observed fresh human run,not a faster warm CI timer. Official Supabase first-run downloads make a universal under5minute native/backend claim unjustified. Decision: exact guest target and progressive paths over a mandatory all-provider bootstrap. Authority P1/P5; all other product rules fixed.
2. **API/CLI5→8:** DX02 freezes protocolVersion,payloadVersion,local schema,backup format,collection/epoch ownership and typed result/cancel/retry contracts before P3–P6. DX04 chooses a single ops grammar over ad-hoc scripts:explicit environment/target,bounded limit/cursor,JSON,stable exit codes,dry-run and explicit execute. These are two independent decisions under P1/P5. A10requires executing examples against both actual adapters and operational drills. No public API contract is promised.
3. **Errors6→9:** DX03 selects a shared stable safe error catalog over per-screen strings. Three concrete traces are local runtime unavailable,old epoch andmedia quota; current implementation for those is absent,so proposed text is labeled. The fourth existing malformed-backup message was actually read and its remedy is preserved. `expansion-developer-experience.md` specifies problem,cause,next action,retryability,retry-after,correlation/help and offline help. Unauthorized errors stay generic. A10needs real fault injection proving every mapping.
4. **Docs5→8:** DX05 adds a small Markdown contributor index and executable examples in CI over a new hosted docs portal. Quickstart/config/contracts/testing/native/sandbox/ops/migration are linked; actual names are checked by tests. Documentation examples are local synthetic cases,never evidence of a store purchase. A10needs new-contributor findability observation. Authority P1/P5.
5. **Upgrade7→8:** DX07 refines existing additive migration obligations with an explicit version compatibility matrix,upgrade/recovery guide,old-client fixtures and changelog. Rejected: automatic destructive rollback/codemod without supported transformations. Private internal APIs need no public deprecation marketing; supported stored data does need recovery. A10requires N/N-1 and failed-migration drills on both local adapters. Authority P1,carrying C21.
6. **Environment6→8:** DX06 defines typed config/defaults/precedence/ranges and constructor-injected test adapters,with invariants non-overridable. Worktree profiles isolate ports/containers and reset refuses remote endpoints. CI has a credential-free lane and explicit separate provider/native lanes. A10requires measured supported-OS onboarding and exact plugin compatibility. P1/P5; no new hosting setup.
7. **Community6→8:** The relevant ecosystem is the private maintenance team. DX05 includes CONTRIBUTING,synthetic reproduction,ownership and private vulnerability reporting procedure. No source license/public remote/community exists; no Discord,OSS publication,plugin marketplace or public SDK is invented to inflate a score. A10would require observed successful handoff/support usage. No additional decision/task beyond DX05.
8. **Measurement3→8:** DX08 specifies a clean-checkout human walkthrough and separate cold/warm CI timings for the chosen useful result. No hidden analytics,recurring survey or release claim from unobserved time. A10requires actual timing/confusion evidence and a post-implementation DX review. P1completeness; adding broad developer telemetry was rejected.

| DX dimension | Before | After plan fixes | Prior historical review |
|---|---:|---:|---|
| Getting started |7|9|None|
| API/CLI |5|8|None|
| Error messages |6|9|None|
| Documentation |5|8|None|
| Upgrade |7|8|None|
| Environment |6|8|None|
| Community/internal handoff |6|8|None|
| Measurement |3|8|None|
| Overall (arithmetic mean) |5.625|8.25|None|

TTHW:unmeasured→under5min target; target tierCompetitive,observed rankunknown. Magical momentdesigned via existing guest capture/reload. Producttypeinternal service/CLI/docs;modePOLISH. Principles covered in plan:zero-friction guest,learn by doing,fight uncertainty,typed defaults with safe overrides,code in context,and useful first result. No result is called measured merely because this scorecard exists.

### DX implementation checklist and tasks

Required before expansion developer-workflow completion: [ ]measure chosen TTHW;[ ]preserve npmci/dev path;[ ]doctor and meaningful first result;[ ]local two-client example;[ ]error catalog/offline help;[ ]consistent contracts/ops grammar;[ ]typed defaults/invariants;[ ]executable examples in CI;[ ]migration matrix/guide/changelog;[ ]TypeScript and dependency pins;[ ]isolated CI/local profile;[ ]credential-free guest/testing;[ ]searchable Markdown index;[ ]maintainer handoff. Public community channel,additional SDK languages,hosted playground and codemods for unspecified public breaking APIs are out of scope,not silently deferred accepted work. No TODOS.md item is necessary.

- [ ] **DX-T1(P1,human2days/agent-assisted1day)** — Setup/config — implement four recipes,doctor,local scripts,typed env and isolated profiles. Files:`package.json`,`.env.example`,`scripts/doctor.mjs`,`scripts/local-stack.mjs`,`src/config.ts`,`docs/developer/quickstart.md`,`docs/developer/configuration.md`. Verify:clean-checkout guest/local sync,missing runtime,port collision,no secrets,no production reset. Source:DX01/DX06,native1/6.
- [ ] **DX-T2(P1,human2days/agent-assisted1day)** — Contracts/errors — freeze shapes and error catalog. Files:`src/contracts/`,`src/errors/`,`public/help/`,`docs/developer/contracts.md`,`tests/contracts/`. Verify:shared adapter examples and every rescue mapping,cancellation/no nested retries. Source:DX02/DX03,native2/3.
- [ ] **DX-T3(P1,human2days/agent-assisted1day)** — Ops grammar — implement bounded safe commands. Files:`scripts/ops.mjs`,`scripts/lib/config.mjs`,`docs/developer/operations.md`,`tests/ops.test.ts`. Verify:dry-run default,target/environment,limit,cursor,JSON/exit codes,idempotent replay. Source:DX04,native4.
- [ ] **DX-T4(P2,human1day/agent-assisted4hours)** — Contributor learning — index,examples,migration guide,changelog and measured walkthrough. Files:`CONTRIBUTING.md`,`CHANGELOG.md`,`docs/developer/README.md`,`docs/developer/migrations.md`,`tests/examples/`,`docs/evidence/dx-onboarding.md`,`.github/workflows/ci.yml`. Verify:examples execute,links/scripts match,old data/clients survive and real timing distinct from automation. Source:DX05/DX07/DX08,native5.

All8decisions have an individual evidence/current/proposal/authority row in the plan. No new DX taste disagreement remains. Native plugin/version feasibility is being researched for engineering; providers,signing and owner-funded activation remain external gates. No durable operational learning beyond already recorded local tool constraints was found in this DX pass.


# Engineering review — actual Phase 3

Methodology: all 2,219 lines of `autoplan-eng-methodology-ilFP6U/methodology.md` read through EOF, including required outputs and finish sections; the initial final-range truncation was repaired with 1801–2020 and 2021–2219 reads. Frozen native input: `8a8bbf3597059c407e19175ee02e2d56bd0cd196876effd52936efc77cfd6edc`. Fresh independent `eng_voice` completed after full input reads. No expansion implementation was performed.

## Step 0 — scope challenge grounded in code

The user explicitly chose all three expansions. Scope accepted as-is (FULL_REVIEW); no requested feature is reduced. The simpler local notebook remains guest mode. The complexity trigger fires: more than eight affected/new files and external auth/storage, payment and store services. Choose a modular application with managed backend and explicit adapters; a custom service fleet or three UI rewrites adds no requirement coverage. Freeze contracts and integrate in packages instead of one broad mutation.

| Subproblem | Actual code read | Reuse and required change |
|---|---|---|
| Domain validation/capacity | `src/data.ts:6–141`, `src/types.ts` | Preserve strict Zod formats, limits and immutable checkpoint fields; extract pure schemas for browser/server/native callers |
| Local durability/CAS/idempotence | `src/data.ts:146–237,282–610` | Preserve commit-complete notification, record/receipt atomicity and revision checks; new repository adds namespaces/outbox/shadow |
| Draft safety | `src/drafts.ts` and `Forms.tsx:179–270` | Retain CAS, flush, stable save tokens and cleanup-warning behavior; namespace drafts and native file refs |
| Backup/restore | `src/data.ts:612–720`, `BackupView.tsx:1–160` | Reuse validation/preview/current-revision guard; add all-byte remote snapshot and epoch replacement |
| App composition/routing | `src/App.tsx:1–210`, `BagLabel.tsx` | Preserve capture hierarchy and old hash links; add services, authorized HTTPS links and account continuation |
| Media | `src/media.ts`, `VoiceNote.tsx:1–120` | Keep input bounds/conversion; supply actual native camera/recorder/file adapters |
| Tests | `src/data.test.ts`, `tests/reliability.spec.ts`, `tests/offline.spec.ts`, Playwright config | Keep Vitest/fake-IDB and five browser projects; add real backend/native contracts instead of treating browser mocks as native proof |

Actual code currently stores nested full projects and uses browser APIs directly. That is acceptable at the verified local size; it is not an existing sync engine. No current cloud/payment/native commands or accounts were found. Native package metadata and local tools are available evidence, while compile/signing/provider capability remains unverified.

## Step 0.5 — independent voices

**Codex (in-host) SUBAGENT (eng — independent review):** 8 concerns, 7 high and 1 medium: commit-safe cursors; own offline-edit dependencies; command-only privileges; native file/DB durability; late-work deletion barrier; consistent DB/object snapshot; per-purchase grant aggregation; bounded operational resources. All accepted and resolved as concrete plan obligations E01–E07/E11. The parent additionally required migration preservation, truthful copy, native license proof and permanent-purchase recovery after account deletion.

**Claude Code SAYS (eng — architecture challenge):** unavailable. Actual executable resolver returned `command:null`, `outside_status:unavailable` after native completion. No CLI was installed or invoked, no external model output exists, and no outside findings or consensus are inferred.

| Dimension | Native result | Claude Code | Consensus |
|---|---|---|---|
| Architecture sound? | Concerns 1–7 require protocol detail | Unavailable | N/A |
| Test coverage sufficient? | Eight explicit fault/race test families needed | Unavailable | N/A |
| Performance addressed? | Resource growth requires separate bounds | Unavailable | N/A |
| Security covered? | Same-owner bypass, deletion and grant boundaries require tests | Unavailable | N/A |
| Error paths handled? | Existing user-facing empty/offline/error design sound; protocol fixes required | Unavailable | N/A |
| Deployment manageable? | Real build/provider/recovery gates remain essential | Unavailable | N/A |

These are single-native-voice high findings, not cross-model agreement. Unknown model identity remains unknown. Primary review integrates the concerns rather than substituting for missing outside coverage.

## Section 1 — architecture

The dependency ASCII diagram and exact interfaces/data/locking contracts are in `docs/expansion-engineering.md`; that artifact is part of the accepted implementation plan. Eight primary architecture findings below are risks in planned implementation, not claims that absent product code already contains bugs. The plan now specifies commit-safe collection cursors, shadow/overlay intents, command privileges, file preparation, deletion generations, pinned snapshots, independent grants and non-destructive migration. Ownership and quota checks remain server authoritative; tests include attacks by a legitimate owner bypassing command paths.

## Sections 1, 2 and 4 — evidence and decisions

`eng input` refers to the immutable `autoplan-eng-vIrj30/eng-implementation.md` reviewed by the native voice. Exact quotes below establish the design seam, not proof of an implemented failure. Confidence measures the need to resolve that seam. E14 is a separate execution decision and is excluded from the four-section issue count.

| ID | Section | Severity / confidence | Exact evidence | Accepted remedy | Rejected alternative |
|---|---|---|---|---|---|
| E01 | Architecture | HIGH / 9 | `eng input:77`: “Pull changes by an opaque monotonically increasing server cursor” | Serialize cursor allocation and commit under the collection row lock; frozen snapshot plus catch-up | Global sequence allocated before commit |
| E02 | Architecture | HIGH / 9 | `eng input:75`: “Concurrent project metadata edits return a conflict with both versions” | Keep server shadow + local overlay; frozen dependency IDs resolve own edit revisions | Rewrite attempted payloads or lose pending edits |
| E03 | Architecture | HIGH / 9 | `eng input:40`: “Immediately disable account access in database policies and server commands” | Command-only mutation privileges, active-account RLS, same-owner bypass tests, authenticated media requests | Owner RLS alone or bearer URLs that outlive promised revocation |
| E04 | Architecture | HIGH / 9 | `eng input:65`: “The local record and its outbound operation must commit atomically” | Prepare durable immutable files before DB refs/outbox; crash recovery and protected GC roots | Treat filesystem and SQLite as one transaction |
| E05 | Architecture | HIGH / 9 | `eng input:40`: “Delete owned records and media through an idempotent job” | Deletion generation barrier, bounded uploads, final sweep and pre-persisted receipt token | One sweep followed by late object resurrection |
| E06 | Architecture | HIGH / 9 | `eng input:79`: “Orphan cleanup is bounded and never deletes an object referenced by a committed checkpoint” | Pin export and recovery manifests, immutable objects, deletion ledger and explicit backup expiry | Only protect currently live checkpoint references |
| E07 | Architecture | HIGH / 9 | `eng input:85`: “Duplicate/out-of-order events, refunds, revocation and restoration must converge” | Independent grants and stable recoverable billing principal; authoritative serialized reconciliation | Single account paid boolean or automatic receipt transfer |
| E08 | Architecture | HIGH / 8 | `eng input:11`: “Do not rewrite or delete the existing browser database” | Copy/validate/hash migration into new store; preserve old data and account-fenced recovery | In-place destructive migration |
| E09 | Code quality | MEDIUM / 9 | `src/App.tsx:16`: “listProjects,” | Compatibility facade plus pure shared domain and repository ports; freeze exact contracts before consumers | Provider SDK calls scattered across React or speculative general framework |
| E10 | Code quality | MEDIUM / 9 | `src/components/BackupView.tsx:135`: “No account. No cloud uploads.” | Mode-specific copy and typed safe errors/config with bundled help; preserve useful existing backup messages | Global copy replacement or generic catch-all errors |
| E11 | Performance | HIGH / 9 | `eng input:28`: “48 MiB of serialized v1 library data” | Bound staging, devices, receipts, feeds, requests and fair worker batches separately | Assume user-library quota bounds operational cost |
| E12 | Performance | MEDIUM / 8 | `src/data.ts:335`: “getAll()” | Keep bounded local reads; lazy media, paged remote changes and measured export peak memory | Download all media on every shelf render |
| E13 | Performance | MEDIUM / 8 | `eng input:89`: “A temporary network/provider outage must not remove paid local features” | Stress reconnect and provider failure while preserving local capture; measure budgets and dormant-account costs | Infer capacity or sustainable lifetime service from a small happy-path run |
| E14 | Execution | MEDIUM / 9 | `eng input:122`: “domain contracts, repository ports, migration layer, native-store feasibility” | Exact task ownership, contract freeze, three parallel lanes and sequential integration; full evidence gates | Overlapping shared-file edits or account prerequisites blocking all local work |

### Section 2 — reuse and extraction check

Two real current callers of domain/storage behavior are App save/status handlers and BackupView import/export; proposed native repository and server commands become additional callers. Extract existing strict schemas/capacity/media rules once, with golden vectors, rather than duplicate them. Repository is justified by web/native durable implementations; BillingAdapter by web/native purchase providers. A general workflow engine, event-sourcing framework or public SDK is unjustified. Keep pure functions small, explicit dependency injection at application composition and provider-specific types inside adapters. Existing draft hook remains responsible for UI draft lifecycle; it does not gain payment/network logic.

The compatibility extraction is estimated to move 150–300 lines from `data.ts` and add 250–450 domain/port lines; this is not a net code reduction claim. Full service/native implementation adds substantially more code (rough order 5,000–10,000 source/test lines across all packages, unmeasured estimate). Complexity is controlled through ownership, contract tests and incremental integration, not a fabricated negative line count. Review actual diff after each package and remove unused abstractions. Preserve existing subscription/notification behavior and never add production test-only switches.

## Section 3 — test review

Immediately before building the test diagram, a dedicated tool call read actual `App.tsx`, checkpoint Form, data tests, reliability tests, offline tests and Playwright configuration. It contained source/test reads only. The durable artifact and repository copy were then written with **46 individually enumerated new coverage groups**, every UX/data branch mapped to required level, file/owner and GAP → ADD decision. See `docs/expansion-test-plan.md` for the full ASCII branch diagram, all 46 rows and value cards. Each card states protects/fails_when/why_new/seam and is under 160 bytes. No new test execution or coverage pass is claimed.

Durable required path: `/Users/lalaji/.gstack/projects/lalaji/lalaji-main-eng-review-test-plan-20261018-142000.md`. Existing 209 browser / 33 data / 4 isolated scale results are local-foundation evidence only. New backend/native/provider coverage is absent by design until implementation; every gap is accepted under P1 completeness. Existing regression tests are retained. Real store sandbox, physical accessibility and process-kill durability tests cannot be replaced by fake SDK returns. No LLM/prompt behavior is added; eval suites are N/A with that reason.

## Section 4 — performance

Evaluate N+1 by inspecting query counts for shelf/project/pull and plans on `(collection,cursor)` and owner/status indexes. Keep metadata/feed pages bounded and media lazy; do not serialize the full library on each draft keystroke. Exact base64/UTF-8 admission preserves the current portable envelope. Export still risks multiple memory copies; measure the 48 MiB boundary on browser and native targets and use worker/file streaming if necessary without inventing an archive format.

Test 100 reconnecting accounts and 1,000 stress accounts with interrupted media, stalled commits and replay. These fixtures establish bounded behavior, not a provider-size capacity claim. Measure local-save/search/import targets on declared hardware and native startup/import memory separately. Resource admission covers staged bytes, snapshots, devices, receipts, feed retention and worker batches. The independently reviewed operating worksheet includes dormant libraries; its prices/allowances are illustrative and funding is unresolved. No public activation is justified by a one-time purchase hypothesis alone.

## Failure modes registry

| Boundary | Failure and user/operational response | Required proof | Critical unhandled gap after plan amendment |
|---|---|---|---|
| Auth / collection | Expired or changed account: preserve source, generic auth remedy, reject late completion | T03–T05 | None planned; implementation pending |
| Local persistence | DB/file/draft failure: no false save, recover staged work | T02/T06/T07 | None planned; implementation pending |
| Push / receipt | Lost ACK, duplicate/hash mismatch: same ID retry or permanent typed error | T08/T09 | None planned; implementation pending |
| Pull / hydration | Out-of-order commit, missed event, failed page: cursor-safe replay and rebase | T10–T13 | None planned; implementation pending |
| Ownership | Same-owner bypass or cross-account attempt: denied command/table/media access | T14 | None planned; implementation pending |
| Media / quotas | Full/corrupt/interrupted bytes: local pending, actionable retry or cleanup | T15–T17 | None planned; implementation pending |
| Export / replace | Missing bytes/stale revision: incomplete export or fresh confirmation, recover pending work | T18/T19 | None planned; implementation pending |
| Disaster recovery | Incomplete object copy: no complete backup status, alert and retry; isolated restore | T20 | None planned; implementation pending |
| Web/native checkout | Cancel/pending/false callback: preserve intent, wait for verified ledger | T21/T22/T25 | None planned; implementation pending |
| Webhook / entitlement | Bad signature/DB outage/order/refund: reject or durable inbox, independent reconciliation | T23/T24 | None planned; implementation pending |
| Purchase recovery | Deleted account or wrong owner: authenticated proof and audited principal rebind | T26 | None planned; real provider proof required |
| Account deletion | Late upload/payment/response loss: generation fence, final sweep, retained receipt | T27/T28 | None planned; implementation pending |
| Native capability / label | Denied permission/cancel/process/link failure: preserve draft, readable code and useful recovery | T29–T32/T35 | None planned; real devices required |
| Status / accessibility / privacy | Concurrent faults, unreadable action or false copy: priority/details/focus and mode-correct text | T33–T36 | None planned; rendered evidence required |
| Setup / ops / compatibility | Missing runtime, wrong target, stale version: safe typed refusal and bounded resumable commands | T37–T40 | None planned; implementation pending |
| Load / release | Saturation, expensive retention, failed rollback: backpressure, alert, funded gate, preserved local/export | T41–T46 | None planned; external activation pending |

## Required completion outputs

**NOT in scope:** public sharing/collaboration/feed, pattern marketplace, AI/transcription, reminder system, public SDK/community, binary archive expansion and automatic paid deployment. These are declined unrelated expansions, not deferred X requirements. **What already exists:** working local capture/resume/history/media/drafts/backup/restore/labels/Guide/offline, the preserved design system and browser/data tests documented above. **TODOS.md:** zero accepted scope items deferred; no artificial future-feature task is written. Implementation gaps remain explicit tasks in the approved scope.

Parallelization: three disjoint worker lanes plus one root integrator; contract/package freeze and final integration are sequential, independent client/backend/native work parallelizes within package dependencies. Exact task branches, ownership, resource limits, reviewer and commands are in `docs/expansion-implementation.md`. Do not put separate worktrees on shared local ports or let two workers change package locks.

Completion Summary: Step 0 scope accepted as-is; Architecture 8 issues; Code Quality 2; Test diagram produced, 46 coverage gaps; Performance 3; total four-section issues **59**, all mapped to required work. Failure modes: **0 unmapped critical plan gaps** after amendments (not zero implementation risk). Unresolved engineering choice: **0 internal choices**; final overall plan/taste and external activation evidence remain open. Outside voice unavailable; native completed 8 concerns. Parallelization 3 worker lanes, sequential contract/integration gates. Lake Score **N/A**: no human completeness-answer denominator was sampled. No expansion review is logged as approved or CLEAR before the final gate.

### Engineering native amendment check

A read-only followup on the concrete engineering/test artifacts found three residual details within E06/E07/E11: independent per-purchase workers still needed a principal-level aggregate lock; full replacement needed its own bounded staging allowance; and disaster restore needed erasure records newer than its database snapshot. All three were corrected before phase close. Added fenced worker leases plus principal transaction serialization, a 40 MiB candidate/80 MiB temporary physical replacement bound with prospective portable quota, and an independent current erasure ledger whose unavailability blocks restored traffic. T17/T19/T20/T24 carry the adversarial cases. Purchase recovery now enumerates minimum retained fields and T26 covers lost-key verified support, simultaneous claims, key rotation and no craft-data resurrection. These refine the same existing issue IDs; they do not inflate the 59-issue count or imply implementation.

The final native amendment check confirmed the three main corrections and purchase recovery, then identified one narrow cross-store crash gap: the independent deletion intent also needs the receipt-token hash. That hash is now persisted (never the raw token), reconciliation reconstructs the receipt record, and T28 covers append → crash before primary commit → reconcile → original token still works. This is a refinement of E05/E06, not additional scope.

Final native confirmation: the independent engineering voice verified the receipt-token persistence/reconstruction fix and T28 crash test, then confirmed all targeted concerns resolved at the planning level. Implementation remains unverified.

## Current authorization and final consistency correction

The user-supplied master prompt, lines 26 and 280, explicitly selects BUILD AND VERIFY and directs implementation after correcting the reviewed plan without a routine permission check. That direct instruction supersedes the skill’s normal final approval question. Earlier approval-pending sentences are historical, not the current task state. Implementation is authorized under standing delegation; no individual human artifact approval, external account authorization or human CLEAR is fabricated. Root begins I01 after freezing the verified foundation and reviewed plan.

The final consistency check found the design matrix contained 14 rows despite its accepted requirement for 16. The two already-required Cloud usage and Deletion receipt state rows are now explicit; restore-purchase error states include verified recovery support. This fills existing D07/D09 obligations without adding scope or changing decision counts. All 16 rows were recounted. The final package has 104 decisions and 26 aggregated tasks; the completed engineering close retains all accepted requirements.
