# Native feasibility evidence

Evidence checked **2026-10-18** for the proposed Capacitor expansion. This is a dependency and implementation-planning assessment. **Published package compatibility is not a native build PASS.** No dependency was installed, native project generated, account configured, or product file changed for this assessment.

Keep the existing React UI and the portable **JSON v1** contract: **200 projects, 1,000 checkpoints, and 48 MiB serialized data including base64 overhead**. Native storage may use SQLite and private files internally without changing that export format or increasing its limits. A binary archive is not required by this plan.

## Proposed exact dependency pins

Versions below were the public npm registry's stable `latest` releases at the evidence date. The versioned registry links are primary package metadata; published tarballs were also inspected in memory for native manifests and relevant implementations. Use exact application dependency versions and commit the resulting lockfile; a future implementation must recheck availability and security advisories before installation.

| Purpose | Proposed package and exact version | Published license | Capacitor compatibility evidence |
| --- | --- | --- | --- |
| Native runtime and tooling | `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android`: **8.5.3** each | MIT | iOS/Android peer on core `^8.5.0`; CLI Node engine `>=22.0.0`. [Core](https://registry.npmjs.org/@capacitor/core/8.5.3), [CLI](https://registry.npmjs.org/@capacitor/cli/8.5.3), [iOS](https://registry.npmjs.org/@capacitor/ios/8.5.3), [Android](https://registry.npmjs.org/@capacitor/android/8.5.3) |
| Private file IO | `@capacitor/filesystem` **8.1.5** | MIT | Core peer `>=8.0.0`; native SPM dependency from Capacitor 8.0.0. [Metadata](https://registry.npmjs.org/@capacitor/filesystem/8.1.5) |
| Share sheet | `@capacitor/share` **8.0.3** | MIT | Core peer `>=8.0.0`; native Capacitor 8 manifests. [Metadata](https://registry.npmjs.org/@capacitor/share/8.0.3) |
| Camera | `@capacitor/camera` **8.2.6** | MIT | Core peer `>=8.0.0`; native Capacitor 8 manifests. [Metadata](https://registry.npmjs.org/@capacitor/camera/8.2.6) |
| Lifecycle and links | `@capacitor/app` **8.1.2** | MIT | Core peer `>=8.0.0`; native Capacitor 8 manifests. [Metadata](https://registry.npmjs.org/@capacitor/app/8.1.2) |
| Connectivity | `@capacitor/network` **8.0.1** | MIT | Core peer `>=8.0.0`; native Capacitor 8 manifests. [Metadata](https://registry.npmjs.org/@capacitor/network/8.0.1) |
| Native database | `@capacitor-community/sqlite` **8.1.1** | MIT | Core peer `>=8.0.0`; explicit Capacitor 8 upgrade; SPM support in 8.1.0 and dependency-reference fix in 8.1.1. [Metadata](https://registry.npmjs.org/@capacitor-community/sqlite/8.1.1), [release changes](https://github.com/capacitor-community/sqlite/blob/v8.1.1/CHANGELOG.md) |
| Session storage | `@aparajita/capacitor-secure-storage` **8.0.1** | MIT | Explicit Capacitor 8 implementation. Regular dependencies, not peers, include core/iOS/Android `^8.0.2` and app/keyboard `^8.0.0`; resolve these to one locked Capacitor installation. [Metadata](https://registry.npmjs.org/@aparajita/capacitor-secure-storage/8.0.1), [release changes](https://github.com/aparajita/capacitor-secure-storage/blob/v8.0.1/CHANGELOG.md) |
| Microphone bridge | `@capgo/capacitor-audio-recorder` **8.3.4** | **MPL-2.0** | Core peer `>=8.0.0`; native SPM dependency from Capacitor 8.0.0. Retain its license and applicable distribution notices. [Metadata](https://registry.npmjs.org/@capgo/capacitor-audio-recorder/8.3.4), [upstream](https://github.com/Cap-go/capacitor-audio-recorder) |
| Native purchases | `@revenuecat/purchases-capacitor` **13.7.4** | MIT | Core peer `>=8.0.0`; native SPM dependency from Capacitor 8.0.0; hybrid common SDK **19.12.0** pinned on both native platforms. [Metadata](https://registry.npmjs.org/@revenuecat/purchases-capacitor/13.7.4), [upstream](https://github.com/RevenueCat/purchases-capacitor) |

SQLite 8.1.1 is a maintained, explicit Capacitor 8 candidate; a paid replacement is not necessary solely for compatibility. Its Android dependency is SQLCipher **4.17.0**. iOS SPM allows SQLCipher from **4.14.0**, while its CocoaPods specification does not pin SQLCipher. Freeze actual transitive resolution in `Package.resolved` or `Podfile.lock`. Upstream notes that SQLCipher is linked even for unencrypted databases and must be considered in store encryption declarations. [SQLite native manifests and README](https://github.com/capacitor-community/sqlite/tree/v8.1.1)

Do not substitute `capacitor-voice-recorder` **7.0.6** on the strength of its permissive core `>=7.0.0` peer alone: the inspected release did not provide equivalent explicit Capacitor 8 upgrade evidence. The Capgo candidate is selected for stronger native-version evidence, subject to build and device checks. [Voice-recorder metadata](https://registry.npmjs.org/capacitor-voice-recorder/7.0.6)

## Platform requirements and unresolved compatibility

All proposed native package manifests inspected declare **iOS 15+**, **Android API 24+**, Android **compile/target SDK 36**, and Java source/target **21**. Their SPM manifests use Swift tools 5.9 and Capacitor from 8.0.0. Capacitor 8 requires **Node 22+**, **Xcode 26+**, and Android Studio **Otter 2025.2.1+**. [Official Capacitor 8 requirements](https://capacitorjs.com/docs/updating/8-0)

The published CLI 8.5.3 Android template contains **Gradle 8.14.3 / AGP 8.13.0**. Secure-storage and RevenueCat declare **AGP 8.13.2**. The native spike must resolve and verify the combined build configuration, preferably aligning the application root to 8.13.2 while retaining the supported Gradle wrapper. This is a proposed alignment, not evidence that the combination has built. [CLI package archive](https://registry.npmjs.org/@capacitor/cli/-/cli-8.5.3.tgz), [secure-storage archive](https://registry.npmjs.org/@aparajita/capacitor-secure-storage/-/capacitor-secure-storage-8.0.1.tgz), [RevenueCat archive](https://registry.npmjs.org/@revenuecat/purchases-capacitor/-/purchases-capacitor-13.7.4.tgz)

The reported local **Xcode 27.1** meets the documented minimum. Reported **adb 37** does not establish an installed Java 21 runtime, SDK 36 platform, emulator image, or successful Gradle build. Docker 29.8 availability does not establish native or store readiness. No account action is needed to begin unsigned simulator/emulator builds; signing, associated-domain behavior and provider/store testing have separate prerequisites.

The packages declare no React or Vite peer constraint. That supports using the existing **React 19.3.1 / Vite 8.3.4 / TypeScript 7.0.2** application, but does not prove that exact frontend combination is covered by upstream CI. Require the actual lockfile install, typecheck, web build and both native builds. Native packaging also needs permission descriptions and the Filesystem file-timestamp privacy-manifest entry appropriate to the app's usage. [Filesystem privacy-manifest requirement](https://capacitorjs.com/docs/apis/filesystem#apple-privacy-manifest-requirements)

## Proposed adapters and persistence protocol

Put native implementation behind proposed `src/platform/native/*` adapters for the repository, file/media operations, session storage, lifecycle/links, microphone and purchases. Shared services own validation, quotas, JSON v1 export/import and sync policy; React components do not call plugins or branch repeatedly on platform. The SQLite plugin's `exportToJson` format is not a replacement for Loopmark's JSON v1 format.

SQLite transactions can commit records, collection metadata, operation receipts and outbox entries together. **They do not transact Filesystem writes or secure-storage operations.** The APIs expose separate database and file operations; do not describe a database transaction as an atomic database-plus-media commit. [SQLite API](https://github.com/capacitor-community/sqlite/blob/v8.1.1/docs/API.md), [Filesystem API](https://capacitorjs.com/docs/apis/filesystem)

Use this proposed ordering for local writes and restores involving media:

1. Validate through the existing shared data/media rules and capture the collection generation/revision fence. For JSON v1 restore, enforce project/checkpoint counts, serialized size, decoded media validity and aggregate limits before making restored content visible.
2. Write media into private staging storage, verify required bytes and hashes, and promote it to unique immutable final paths. Durable originals belong in private persistent storage, not an evictable cache. Do not overwrite files referenced by the current collection.
3. Commit record references, local revision/generation changes and corresponding outbox entries in one SQLite transaction. A failed fence or transaction leaves the old collection authoritative and preserves the draft.
4. On startup, recover interrupted operations and remove unreferenced staged/promoted files after checking live references. Retire prior-generation files only after commit and the applicable retention policy. A crash before commit may leave orphans; it must not create records pointing to unfinished media.

This makes database visibility the application commit point; it does not create a cross-resource filesystem transaction. Promise resolution, per-file rename, or process-kill tests alone do not prove power-loss durability. Record the chosen database journaling/synchronization settings and verify the actual native filesystem behavior. If explicit flush guarantees are required and unavailable through the selected bridge, add a narrowly scoped native operation or document the remaining durability limit before claiming it solved.

Complete JSON v1 export gathers every referenced media byte, verifies hashes, accounts for base64/serialization overhead and writes a complete file before invoking Share. Missing cloud-only bytes, insufficient space or cancellation must not produce “complete backup” success. Portable JSON contains intended user content and schema metadata, not session tokens, device encryption keys, or trusted entitlement grants. No ZIP extraction or binary archive dependency is required for this scope.

## Secure session storage and OS backup rules

The inspected secure-storage implementation uses **iOS Keychain** and **AES-GCM with AndroidKeyStore keys**. Android stores ciphertext in **`WSSecureStorageSharedPreferences.xml`**. Its web fallback is plain `localStorage`; the native session adapter must reject accidental web fallback and use the separately reviewed web session design. [Android implementation](https://github.com/aparajita/capacitor-secure-storage/blob/v8.0.1/android/src/main/java/com/aparajita/capacitor/securestorage/SecureStorage.java), [published implementation](https://registry.npmjs.org/@aparajita/capacitor-secure-storage/-/capacitor-secure-storage-8.0.1.tgz)

For foreground native sessions, set synchronization **off** and `KeychainAccess.whenUnlockedThisDeviceOnly` explicitly. Choose `afterFirstUnlockThisDeviceOnly` only if a documented background operation requires session access. The default `whenUnlocked` can migrate in encrypted backups. `ThisDeviceOnly` prevents migration to another device; it does not mean the item can never be restored to the original device. Test sign-out, account changes, reinstall and key-unavailable behavior; clear only Loopmark's namespaced session entries. [Plugin access options](https://github.com/aparajita/capacitor-secure-storage/blob/v8.0.1/src/definitions.ts), [Apple accessibility rules](https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility)

Android needs both legacy `android:fullBackupContent` rules and Android 12+ `android:dataExtractionRules`. Exclude the secure preference file from legacy backup and from **both cloud backup and device transfer**:

```xml
<exclude domain="sharedpref" path="WSSecureStorageSharedPreferences.xml" />
```

Place that exclusion inside `<full-backup-content>` for older devices and separately inside `<cloud-backup>` and `<device-transfer>` for Android 12+. `allowBackup="false"` alone does not reliably disable OEM device transfers. Every include/exclude needs a `path`; do not copy the SQLite README's abbreviated exclusions without it. Test backup/restore on both rule paths and treat a missing device-bound key as an expired session requiring login. [Android backup rules](https://developer.android.com/identity/data/autobackup)

For this release, exclude the internal SQLite database (including journal/WAL/SHM sidecars), prepared-file journal and private attachment directories together from automatic OS cloud backup and device transfer. On iOS set the appropriate directory backup-exclusion resource value through the native file bridge; on Android include the actual resolved database/file paths in both legacy and Android 12+ exclusion rules. Verify the resolved plugin paths in the combined build before claiming coverage. A fresh install begins empty and recovers through explicit complete JSON v1 import or authenticated cloud hydration. User-shared JSON backup files are outside this internal exclusion policy. Do not restore database and media independently or claim coherent automatic OS recovery. Secure session keys remain device-bound as specified above.

## Microphone and billing boundaries

Use the recorder for foreground clips first. It exposes native file URIs, pause/resume and permission/status APIs. Configure microphone usage descriptions/permissions, and copy or promote returned files into the persistence protocol before committing references. The recorder **does not create an Android foreground service**. Recording lasts only while the process remains alive; screen-lock/background or hour-long recording requires additional foreground-service work and device testing. On iOS, background audio requires the relevant capability. Do not promise these background behaviors from the plugin dependency alone. [Recorder documentation](https://github.com/Cap-go/capacitor-audio-recorder#background-recording)

RevenueCat 13.7.4 pins `@revenuecat/purchases-typescript-internal-esm` and native `PurchasesHybridCommon` to **19.12.0**; Android declares Kotlin **2.2.20** and Java 21. Its MIT package license does not configure a RevenueCat project or Apple/Google products. Keep the native billing adapter behind the shared server-authoritative entitlement contract. Mocked purchase/restore results and unsigned builds cannot prove actual purchase ownership, delayed verification, store restoration, or webhook reconciliation. [Published RevenueCat package](https://registry.npmjs.org/@revenuecat/purchases-capacitor/13.7.4)

## Verification gates before implementation completion

Proposed native adapter tests live under **`tests/native/ios/`** and **`tests/native/android/`**, with shared contract/fault tests covering **`src/platform/native/*`**. These paths and tests are proposed, not existing evidence. Keep the following results distinct:

| Gate | Required evidence |
| --- | --- |
| Dependency resolution | Exact direct pins; one compatible Capacitor graph; committed JS and native lockfiles; license inventory; no global installs required. |
| Build | Clean typecheck/web build, iOS simulator build and Android debug/emulator build with captured tool versions and full outputs. A skipped or unavailable native job stays unverified. |
| Repository and files | Native save/reopen and process-restart roundtrips; faults at staging, promotion, SQL commit and cleanup; disk-full and stale-generation cases; record/outbox atomicity; no dangling media references or lost drafts. |
| JSON v1 parity | Existing 200/1,000/48 MiB boundaries, malformed media rejection, all-byte export/import roundtrip, missing-download failure, interruption and prior-collection preservation on both native adapters. |
| Sessions and backup | Device-bound Keychain settings, sync disabled, Android legacy/cloud/device-transfer exclusions, key loss, logout, account switching, reinstall and restored-data behavior; no tokens in logs/exports/web fallback. |
| Permissions and lifecycle | Camera/microphone denial and revocation, OS interruptions, process death, share cancellation, native Back, lock/resume, network transitions and deep-link continuation with authorization checks. |
| Real devices | iOS and Android audio capture/playback/media persistence, accessibility and permission/lifecycle tests. Emulator or browser fakes do not replace device evidence. |
| Provider sandbox | Authorized RevenueCat and Apple/Google product configuration, real sandbox buy/cancel/pending/restore, restart and wrong-account cases, server verification and webhook replay. Explicitly blocked until prerequisites exist. |

Current result: **package and source inspection complete; all combined-build, native-runtime and provider-sandbox gates remain unverified**. This evidence supports proceeding to an isolated implementation spike under the user’s standing implementation delegation after the parent review, not claiming native release readiness.
