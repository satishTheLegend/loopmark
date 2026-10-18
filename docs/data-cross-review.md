# Independent data cross-review

Baseline: `5d9bd54`, reviewed 18 October 2026. Scope: data/types, backup, IDB recovery/concurrency, media validation and data tests. References are baseline line numbers. Native execution used Node 26.8.2, fake-indexeddb and installed Chromium. No external service or telemetry was used.

## Confirmed findings

### D1 — High: a valid imported timestamp can permanently block writes and recovery

`src/data.ts:12–15`, `295–298`, `325`, `491–514`.

The timestamp validator accepts the complete JavaScript Date range. Importing a project with `updatedAt: '+275760-09-12T23:59:59.998Z'` succeeds, advances its revision by one millisecond, and stores the maximum Date value as the library watermark. Every subsequent write or empty-backup restore tries to increment that watermark and fails with `Invalid time value`. The app can still export, but cannot recover through its restore UI.

Reproduced directly with `createProject`, `exportBackup`, modifying that timestamp, `parseBackup`, `restoreBackup`, then `createProject` and `restoreBackup` of an empty collection. Both final calls failed. R5 requires validation before writes and R7 requires useful storage recovery.

Fix: bound accepted timestamps and guard generated clock arithmetic before committing a watermark; allow recovery from already corrupt metadata without reviving stale concurrency tokens. Add a regression proving hostile dates preserve the original collection and valid recovery still works.

### D2 — High: an open restore confirmation silently discards later cross-tab writes

`src/components/BackupView.tsx:38–58`, `src/data.ts:474–526`.

The pending preview stores only the incoming file. Replacement never checks whether the current collection changed after the user selected it. Reproduction: select an empty backup, leave its confirmation open, save a checkpoint in another tab, then confirm replacement. The new checkpoint disappears without a refreshed confirmation. Direct execution of this sequence produced one checkpoint before confirmation and an empty library afterward. This violates the R5 cross-tab lost-write protection and weakens concrete destructive confirmation.

Fix: capture a library revision before file validation, carry it with the preview and compare it inside the same transaction that clears projects. On mismatch retain both existing data and the incoming preview, then require explicit review of a refreshed confirmation. Add a concurrent-write regression.

### D3 — Medium: accepted attachments can consist only of a file signature

`src/data.ts:23–55`, `src/data.test.ts:40–41`.

The validator accepts `data:image/jpeg;base64,/9j/` (three bytes) and `data:audio/webm;base64,GkXfow==` (four bytes). Both `addCheckpoint` calls succeeded. Installed Chromium independently rejected both at its image/audio decoder. A backup with such attachments can replace a healthy collection. The current WebM unit fixture is itself a signature followed by `fixture`, so its successful round trip does not demonstrate media integrity. R4 rejects invalid images and R5 validates imported media before writes.

Fix: check complete container structure, decode imported photos before any destructive transaction, and distinguish structurally valid but unsupported audio codecs from malformed media. Replace the fake audio fixture with a valid tiny container. Test header-only and truncated files while preserving the original collection.

### D4 — Low: existing persistent-storage protection is not shown on a fresh view

`src/components/BackupView.tsx:17`, `141–170`.

The protection indicator always starts false and is updated only after clicking the request button. A browser that already granted persistence displays another request rather than its existing status. Initialize from `navigator.storage.persisted()` and handle unavailable/rejected APIs without disrupting backup operations.

## Checks that held

- Independently ran `npm test`: 21/21 passed. These findings are missing cases, not failures in the existing suite.
- IndexedDB transaction structure preserves concurrent appends and atomic replacement rollback. Per-project expected tokens reject stale metadata edits/status/deletes. Open/blocked/closed connection paths reset the cached promise appropriately.
- Imported project/checkpoint IDs are globally unique and project codes have an IDB unique index. Generated UUID collision handling is not explicit; normal CSPRNG collisions are too unlikely to classify as a release blocker. A code collision aborts creation without replacing data.
- Checkpoint mutations retain prior persisted snapshots; caller object mutation cannot change IDB clones. Imports normalize newest-first history.
- At maximum counts (200 projects, 1,000 checkpoints), measured pretty-print overhead was 112,620 bytes. The 2 MiB difference between the 48 MiB library limit and 50 MiB import limit provides sufficient serialization space; no export-capacity defect was reproduced.
- No remote media or HTML rendering sink was found in these paths. This is a private local app; existing indexing protections remain appropriate.

## Repair and regression evidence

The review owner subsequently implemented the data/backup repairs at the root agent's explicit assignment. Final independent unit run: **33/33 passed**, with TypeScript compilation and `git diff --check` also passing. Browser integration remains the separate browser worker's responsibility.

- **D1 fixed, including legacy recovery:** imports require canonical four-digit ISO dates at most 100 years ahead of the device clock; generated date arithmetic fails explicitly before committing an unsupported result. The hostile timestamp regression rejects replacement, retains the original project, and verifies subsequent append and empty restore still work. Explicit valid-backup replacement can also recover metadata already poisoned by the old release: it excludes unsupported existing clock values while advancing beyond every supported existing/imported record date. A raw-IDB legacy fixture proves successful recovery and later writes, stale-token rejection, and full rollback when the recovery transaction encounters an injected quota failure.
- **D2 fixed:** `getLibraryState()` returns revision and counts from the same metadata transaction. The UI captures this before file reading/validation. Replacement compares that revision in its write transaction; a changed library requires reviewing current counts and a second explicit confirmation. Tests verify rejected stale replacements leave the current collection intact.
- **D3 fixed for the reproduced integrity failures:** `src/media-validation.ts` validates container boundaries and required structure, then browser restore preflight decodes imported photos before any write transaction. Audio validation remains independent of codec support, so an unsupported but structurally valid audio codec is retained. The unit fixture is now a complete PCM WAV, and header-only/truncated inputs cannot replace existing data. This is not a claim of full-stream audio codec verification.
- **D4 fixed:** the backup page reads existing persistence status and distinguishes checking, unavailable, failed, unprotected, and enabled states. A declined request has neutral inline feedback. The export description explicitly excludes unfinished drafts.
- **Cross-browser follow-up fixed:** the browser worker found real WebKit data URLs with whitespace before `codecs` and Firefox WebM with an empty SeekHead. The validator handles both. A real synthesized Firefox recording is retained in `src/fixtures/firefox-recording.txt`; it contains generated test audio, not user media.
- **Draft-save retry safety added:** optional operation tokens on project/checkpoint creation write SHA-256 input fingerprints and result receipts in the same transaction as the saved record. Repeated or concurrent identical attempts return the existing result; token reuse with different input/project rejects. Restore clears receipts and deletion clears that project's receipts. Tests cover repeated/concurrent saves, token misuse, cleanup, and injected receipt-persistence failure rollback.

`restoreBackup(backup, expectedRevision?)` retains an optional revision for trusted reset/test callers; the UI always supplies one. `createProject(input, operationToken?)` and `addCheckpoint(id, input, operationToken?)` retain existing callers while allowing draft-origin retries to be idempotent. Receipts and unfinished drafts are not exported.

The root agent also requested a read-only review of its new draft/offline modules. The review identified save-before-draft-cleanup, falsely reported draft discard, pending-write close protection, and stale offline verification responses; the root agent repaired those. No edits to those modules were made by this review owner.

This review does not cover real-device codecs, disk exhaustion or browser eviction. Legacy clock recovery happens only during an explicit valid-backup replacement; ordinary edits do not silently rewrite existing saved content.
