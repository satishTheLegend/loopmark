# Independent requirements review: initial findings

Review date: 2026-10-18. Initial source: `bb8f051` on `expansion/integration`; implementation continued concurrently after this initial review. This is an independent source/requirements review, not the final integrated release judgment. The reviewer did not author the inspected implementation and changed only this report.

Scope: original master prompt; accepted expansion plan, review, design, developer-experience, engineering, test and implementation documents; current execution ledger; I09 UI/services, deletion tests, contributor commands/docs, release evidence checks and actual test entry points. Brainstorming/gstack routing, surgical review guidance and proportionate private-route SEO guidance were consulted. No live provider purchase, signed distribution, physical-device qualification, human contributor timing or pilot outcome is inferred.

The following findings were sent to the integration owner as soon as confirmed. The owner has accepted the first four for implementation or additional evidence. A later review must inspect the resulting source and executed checks before closing them.

## Findings

### IR01 — P1: requested diagnostic preview/export is missing

Requirement: `docs/expansion-review.md:236` and `docs/expansion-implementation.md:202` require a user-triggered preview/export containing version, platform, queue counts and redacted error IDs, without private craft/account content, tokens or URLs.

Observed source: `src/components/SyncDetails.tsx` displays problems/actions but has no diagnostic preview or export. `src/components/AccountView.tsx` provides privacy/support links only. Search of `src` found diagnostic mentions in help/public copy, not an implementation. `SafeError` has a correlation ID, but normal error UI strips it.

Required closure: an explicit preview action and local download/native share flow built by an allowlisted projection. Test hostile content in every excluded field; compare preview and exported bytes; verify current collection/account fencing, offline behavior, cancel/failure behavior and absence of background transmission. Product UI should expose the action, not only a helper test.

### IR02 — P1: unexpected errors can display unredacted exception contents

Requirement: `docs/expansion-review.md:104` requires unexpected exceptions to produce a redacted diagnostic ID and actionable error; `src/domain/errors.ts:safeError` already states arbitrary exception text must not propagate.

Observed source: `src/components/ui.tsx:132` returns `error.message` for every ordinary `Error`. It is used throughout startup, capture/forms, backup, deletion and purchase surfaces. The domain-safe path also loses correlation/help metadata when flattened to text.

Executed reproduction: loaded the actual helper using Vite's `ssrLoadModule('/src/components/ui.tsx')`, called it with an ordinary synthetic `Error` containing an email, Bearer sentinel and signed-URL sentinel. Output was `{"preservesRawUnexpectedMessage":true,"leaksSentinel":true}`. No real secret was used. This is an executed boundary proof, not a claim that a production provider currently emits those specific strings.

Required closure: preserve intentionally authored validation remedies through a trusted error type or equivalent explicit mapping; send unknown exceptions through safe redaction. Assert sentinel absence and accessible useful error/code/help. Retain existing backup-validation and storage-recovery messages rather than replacing all useful errors with a generic sentence.

### IR03 — P2: incomplete export does not identify missing items

Requirement: the Complete export visible-state row in `docs/expansion-design.md:73` requires no false full-backup success, a missing-item list and resume behavior.

Observed source: `src/services/backup-service.ts:77` and `:94` throw bare `BACKUP_INCOMPLETE`; the download loop propagates a failed item's exception without a bounded item summary. `src/components/BackupView.tsx:133` renders only the generic error. The user cannot identify the affected project/checkpoint/photo/voice note from this flow. Existing download caching means a retry can naturally reuse completed files; a new durable export engine is not inherently necessary.

Required closure: display bounded, current-collection missing-item context and a retry action. Test a two-attachment export with one success and one failure: no file downloaded, correct missing-item text, successful bytes retained, retry fetches only remaining missing bytes, final independent restore contains both exact attachments. Ensure account/collection changes remove the old item details.

### IR04 — P2: final requirement-to-assertion traceability is absent

Requirement: master prompt section 6 requires requirement, acceptance, implementation, evidence and status traceability; I13 requires all accepted rescue branches and controlled race orders to be accounted for.

Observed documents: `docs/expansion-test-plan.md` still labels all T01–T46 `GAP → ADD`. `docs/expansion-implementation.md:275` lists planned canonical filenames that do not always exist; actual tests have moved to `tests/ui/*.ui.ts`, `tests/expansion/*.cloud.ts`, domain/service tests and other locations. `docs/expansion-execution.md` summarizes packages but does not map individual required branches to executed assertions. `docs/verification.md` correctly says it is only historical foundation evidence.

Required closure: retain the planning record as history; add a current T01–T46 / X01–X10 coverage ledger with actual test names/files, source/build revision, executed evidence path and limitations. Distinguish source-implemented, unit/fake-provider, real local backend/browser, actual native simulator/emulator, external-blocked and missing coverage. Test counts do not close an unasserted branch.

### IR05 — P2: T28 deletion receipt branches remain unasserted

Observed tests: `tests/server/deletion.test.ts` has three substantial real local backend tests. They cover pending status, invalid token, live removal and seven-day retention start, independent-ledger append before primary barrier, old JWT denial, idempotence and late upload/finalizer denial. `src/services/deletion-service.test.ts` covers durable token creation before network action, lost response, anonymous refresh, account fencing and local storage refusal. `tests/expansion/accounts.cloud.ts:75` covers the actual keep-copy request, refreshed review, reload, status and receipt download.

Missing assertions at initial review: expired token; `complete` only after backup expiry; receipt-specific lookup rate limit; needs-help UI; actual App plus backend remove-device-copy path with pending work and explicit discard. `tests/ui/deletion.ui.ts` verifies removal choice using a recorded callback result, while controller tests cover removal in isolation; these are useful different levels, not the full integrated product journey.

Required closure: complete the named server/status boundaries and rendered needs-help case; verify removal through the actual App, including fresh repository read/reload and unrelated local/recovered collection preservation. Server owner is concurrently implementing retention/operations, so this review does not duplicate that unfinished work as a newly discovered backend defect.

### IR06 — P2: actual product conflict resolution has no integrated UI oracle

Requirement: T12 and I09 require the user to inspect current full alternatives, defer/refresh/resolve them, and preserve recovered pending work with fresh CAS semantics.

Observed tests: `tests/expansion/sync-smoke.spec.ts:101` uses `window.LoopmarkSyncHarness` to create and resolve a real two-device backend conflict. `tests/ui/account-states.ui.ts:21` renders the conflict component and records mocked `onResolve` input. Neither executes the actual App's Sync details → Review versions → resolution wiring with a real backend conflict. This is a coverage gap, not evidence the source wiring is broken.

Required closure: two actual App instances create a conflict; open Sync details and compare full data; make the review stale and require refresh; resolve through UI; verify final cloud state from a fresh reader and original pending content in the recovered local collection. Keep both controlled completion orders at the service/server level as separately mapped evidence.

### IR07 — P1: a fresh-device bag label loses its destination before sign-in

Requirement: T29 in `docs/expansion-test-plan.md:65`, the QR/deep link state row in `docs/expansion-design.md:77`, and the journey's return-via-label step require owned fetch with login continuation. Generic unavailable state must preserve privacy, while successful authentication and explicit collection choice should let the user continue to the intended project.

Observed source: `src/App.tsx:199` replaces an initial `/p/<id>` path with `/` before calling `open(initial)`. `src/runtime.ts:620` handles an auth callback by returning `account`; `:641` resolves a project only against the currently selected scope. `src/links/link-service.ts:60` only hydrates a connected scope and `:71` rejects a project absent from the guest/current collection. No durable validated target is retained. A fresh device therefore loses the scanned project before login and requires a manual rescan/re-entry after choosing its account collection.

Required closure: retain only a bounded parsed project ID/continuation, never an arbitrary redirect URL or private project metadata. Offer generic sign-in/collection guidance; resume only after explicit owned collection selection. Preserve the target through restart if login is interrupted; wrong-account attempts must not expose metadata or transfer ownership. Test the actual App from `/p/<id>` in a fresh context through delivered-code login, explicit account collection choice and opening the exact project. Separately assert wrong-account privacy, cached offline access and legacy-hash compatibility. Root accepted this as an actionable implementation gap.

## Clarifications and non-findings

- The current release documents explicitly distinguish local implementation from external merchant/store/signing/physical-device/pilot gates. Those gates must remain blocked; lack of provider credentials is not an implementation defect or an excuse for the locally fixable findings above.
- I11 backup/restore/independent erasure-ledger drills and I13 100/1,000-account load are assigned to a worker and were in progress. This report does not reclassify their absence at this intermediate revision as a fresh defect.
- Contributor scripts include real docs/config/link validation, isolated refusal fixtures, examples and separate guest/backend/native instructions. The native owner confirmed that running the four parameterized repository/media examples on actual native adapters is planned next. Current fake-indexeddb examples alone do not meet the I12 both-adapter assertion.
- Native deletion receipt tokens are in app-private, device-transfer/backup-excluded but unencrypted SQLite metadata (`src/platform/native/workflow-store.ts:49`, `src/platform/native/database.ts:22`). The secure vault currently protects refresh-session material only. The design says “protected device storage,” not explicitly Keychain/Keystore for these tokens. The integration owner resolved that wording to the private sandbox plus backup/transfer exclusions; the native owner will document those exact properties without a hardware-vault claim. This is not a demonstrated disclosure exploit or an additional required storage migration.
- No consumer flow imports a downloaded deletion receipt after local storage is lost. The accepted design explicitly covers restart and a saved receipt but does not state a fresh-device import contract. Clarify/document how a saved receipt is used independently; avoid claiming tested recovery from a downloaded receipt file without such an entry point.
- Public help is generated without private content; the application retains noindex, and tests poison cached API paths to prove the service worker bypass. No public crawl or provider account access was performed for this review.

## Initial judgment

**FAIL for complete local accepted scope at this intermediate revision**, due to IR01–IR03/IR07 and incomplete required evidence in IR04–IR06. This is not a final rejection of the project. Recheck the fixes and integrated frozen evidence, then issue a separate final local judgment and external qualification status.
