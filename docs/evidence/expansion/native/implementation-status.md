# Native persistence implementation evidence

I04 candidate, 18 October 2026. This evidence separates actual native execution from source checks and physical/store qualification.

## Executed checks

- Exact JavaScript pins installed with `npm ci`: 227 packages; npm audit reported zero known vulnerabilities. A byte-identical lockfile comparison allowed sharing the integration worktree's dependencies to reclaim disk. No global dependency installation occurred.
- Capacitor 8.5.3 generated iOS SPM and Android shells; sync detected all nine selected plugins. Every CLI invocation used `CI=1`: inspected `telemetry.js`/`util/term.js` skip opt-out configuration and transmission in CI mode. Root configuration disables bridge payload logging in every build.
- **Combined iOS simulator build PASS**, Xcode 27.1 / SDK 27.1, all nine plugins and custom Swift file bridge. The checked-in SPM `Package.resolved` freezes actual transitive versions, including SQLCipher 4.19.0. The application also builds unsigned; Keychain simulator QA uses Xcode's local `-` identity and the test-only entitlement file. No Apple account, certificate, provisioning profile or store signing was used.
- **Combined Android debug build PASS**, Java 21.0.12.1+1 / Gradle 8.14.3 / AGP 8.13.2 / API 36. The project-local Temurin archive was SHA-256 verified against official Adoptium metadata. Existing SDK/platform/image and accepted host licenses were reused. The app's complete resolved dependency graph is frozen in `android/app/gradle.lockfile`.
- **iOS 26.5 dedicated simulator: 20 native groups PASS twice**, including a process terminate/relaunch and durable restart phase 2. Actual SQLite plugin, Swift file bridge and Keychain are exercised. See `ios-runtime.json`.
- **Android API 36 dedicated emulator: 20 native groups PASS twice**, including force-stop/relaunch and durable restart phase 2; **2 native instrumentation assertions PASS** for immutable file reopen and traversal/hash rejection. Actual SQLite plugin, Java file bridge and Android Keystore are exercised. See `android-runtime.json` and `android-instrumentation.xml`.
- Native groups also verify an export pin remains readable after source removal and an attachment-preserving import rejects stale replacement. Native groups cover save/reopen/idempotence/stale generation/snapshot; byte/hash/immutable behavior; real credentials; record/outbox transaction rollback preserving drafts; normalized media/draft CAS/pins/scope isolation; file promotion followed by SQL fault leaving a recoverable journal and no visible reference; process restart. Eight supplemental mocked credential/capture dispatch tests pass separately and are **not** counted as native evidence.
- An actual native transition test rejects a draft added after review and a changed device identity, persists the new generation across restart, fences the old form callback, and retains source-bound draft metadata/media in a local copy. Runtime origins are recorded as `capacitor://localhost` on iOS and `https://localhost` on Android.
- Additional native groups verify normalized form drafts preserve caller revision/base revision and pins across SQL failure/restart; immutable operation plans preserve media and identity across restart; conflict resolution copies dependent history/media before one atomic retirement/replacement, preserves the original on SQL failure, and deduplicates repeated resolution.
- TypeScript typecheck and formatting pass. The separate synthetic WebView harness bundles independently of production UI. `LOOPMARK_NATIVE_TEST_BUILD=1 node scripts/native/harness.mjs` changes only generated native web assets; `node scripts/native/sync.mjs` restores production assets. Test bundles must never be published.

An additional native restore test stages immutable source media, injects SQL failure, verifies no empty target collection is published, then retries successfully with copied bytes and stale-generation rejection. Native epoch replacement validates its receipt, preserves the prior collection/drafts/pinned bytes through transaction failure, atomically selects a hydrated next epoch, and deduplicates retry. Both tests pass on each actual runtime.

A native authentication recovery test requeues only AUTH_REQUIRED failures from the same enrolled device without changing their command hash; a changed device identity fails atomically and preserves rejected work.

## Native interaction evidence

The actual native identity cache persists and clears across SQLite reopen. Both WebViews support Web Locks: a second sync lease is excluded while the first is held, then succeeds after release. Native app/network event registration and disposal, microphone permission inspection without recording, and synthetic photo normalization to JPEG pass in both runtimes.

Actual iOS XCTest opens and cancels the native share sheet, file picker, and camera source sheet; all resolve as quiet cancellations. Android opens the same three system sheets and returns quiet cancellation; selecting a synthetic 36-byte JSON from Downloads returns the expected Blob and MIME. See `native-ui-flows.json`. No personal file, microphone input, photo or external recipient was used. `scripts/native/test-ios-ui.mjs` reproduces the iOS UI check on an explicitly selected test-owned simulator.

The recorder serializes the single process-wide plugin across form instances, fences late permission callbacks, limits recording to two minutes, and returns interruption data to the source-bound draft callback. Actual recording/background audio remains a separate qualification. Camera process-recreation recovery and signed app link configuration are still in progress.

## Persistence behavior

The repository uses SQLite WAL with `synchronous=FULL`. Its shared queue serializes SQL commits, generation changes and cleanup. Saved record changes, immutable pending commands, operation identity and sequence updates commit together. Per-device sequence counters, imported revision clocks and pending overlays use the same pure state engine as the browser adapter. Draft payload/revision and media pins commit together; portable form values are normalized to immutable refs and expanded only on read. Operation-plan pins protect a failed save until the local commit atomically hands protection to saved/pending records; draft data is excluded from saved-work snapshots.

Scoped immutable media passes size/type/container/photo-decode/hash validation before the private native bridge performs bounded SHA-256 verification, file flush/close, same-volume publication and directory fsync. Only then may SQLite publish references. Failures before SQL visibility preserve existing records and drafts. The prepared-file journal and 24-hour orphan grace period protect interrupted work; saved shadows, pending anchors, recovered copies, draft pins and export pins protect referenced files. This is a two-resource commit protocol, not a filesystem/SQL transaction or a physical power-loss guarantee.

Swift stores media in `Library/Loopmark/Media` and excludes its `Library/Loopmark` parent from backup before SQLite opens `Library/Loopmark/Databases`. Android stores media in app-private `files/loopmark/media`; legacy and Android 12+ cloud/transfer XML exclude the entire database domain, private media and `WSSecureStorageSharedPreferences.xml`. Native credentials request `whenUnlockedThisDeviceOnly`, disable synchronization, and reject web fallback.

## Findings repaired during actual native execution

1. Initial dependency downloads failed with ENOSPC. Only task-owned partial downloads were reclaimed first. After the user separately approved deleting Xcode DerivedData, builds resumed. No unrelated data or host SDK was removed.
2. Capacitor 8.5.3's SceneDelegate constructs its controller directly. Updating the storyboard alone did not register the custom file plugin. The SceneDelegate now constructs `LoopmarkViewController`.
3. Unsigned simulator apps returned Keychain `-34018` (missing entitlement). Direct post-build ad-hoc signing denied launch. Letting Xcode embed simulator-only entitlements with its local identity resolves the simulator check. The fixture entitlement is never used for release/store builds. [Apple's Keychain entitlement explanation](https://developer.apple.com/forums/thread/114456)
4. Android's SQLite bridge rejects query-returning `PRAGMA journal_mode` through `execute`. It now uses `query`; synchronization/foreign-key configuration remains a separate nontransactional statement.
5. The generated Android template's example test asserted its original Capacitor app ID. Unrelated example arithmetic/context tests were removed; actual Loopmark persistence instrumentation remains.

## Remaining qualification

The app shell and native adapter are implemented; root still needs to wire the shared UI/facade, media capture/share/lifecycle and account/billing flows. Actual OS disk-full and power-loss conditions, 48 MiB native import peak memory, physical camera/microphone, OS backup/transfer/reinstall/key-loss behavior, accessibility, signed links and store sandbox transactions remain separate gates. No physical or store result is inferred from simulator tests. No provider configuration, payment transaction or deployment occurred.
