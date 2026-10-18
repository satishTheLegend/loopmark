# Platform and provider qualification

Status: **external qualification blocked**. No merchant sandbox credentials, Apple/Google developer identity, physical test device, or production link domain has been supplied. The local builds and simulator/emulator results in [native evidence](../evidence/expansion/native/implementation-status.md) do not satisfy these gates. A ready preflight never authorizes publication or a transaction.

## Reproducible preflight

Run from the repository root with Node installed. The scripts read process environment only; they do not load secret files, create accounts, charge/refund, install an app, upload a binary, or publish a domain association.

```sh
node scripts/sandbox/web.mjs --config /private/location/web.json --probe
node scripts/sandbox/ios.mjs --config /private/location/ios.json --probe
node scripts/sandbox/android.mjs --config /private/location/android.json --probe
node --test tests/sandbox/preflight.test.mjs
```

Without the configuration, credentials, artifact or explicit `--probe`, the command emits JSON `status: "blocked"` and exits 2. With all read-only checks passing it exits 0 with `status: "ready-for-operator"`, **not a sandbox PASS**. Every report has `schemaVersion: 1`, `platform`, named `checks` with `pass|blocked`, and `performedTransactions: false`. Unit tests inject synthetic HTTP responses to verify failure handling; they are not provider evidence.

Use a private JSON configuration outside version control. Required fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `1` |
| `platform` | `web`, `ios` or `android`, matching the command |
| `environment` | Exactly `sandbox` |
| `authorizationReference` | Reference to the operator's approval for these read-only probes; letters, digits, dot, underscore or hyphen |
| `sourceCommit` | Full 40-character commit of the reviewed source |
| `appOrigin`, `supabaseUrl` | Exact HTTPS staging origins without a path, slash suffix, credentials or redirects |
| `artifact.path`, `artifact.sha256` | Existing archive/binary file (relative to the JSON file allowed) and its lowercase SHA-256; binary signing is a separate check |
| Web: `razorpayKeyId` | Intended `rzp_test_` public key ID |
| Native: `applicationId` | Intended bundle/package ID; the current development identifier is `app.loopmark.craft` |
| Native: `revenueCatProjectId`, `revenueCatAppId` | Exact RevenueCat project and platform app |
| Native: `publicSdkKey` | Intended platform key beginning `appl_` or `goog_`; Test Store keys are rejected |
| Native: `productIds` | One to ten unique approved non-subscription product IDs |

All platforms require `LOOPMARK_ENVIRONMENT=staging` and `LOOPMARK_PAYMENT_ENVIRONMENT=sandbox`. Web additionally requires matching `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. Native requires matching `LOOPMARK_REVENUECAT_PROJECT_ID`, `REVENUECAT_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_SECRET`, `LOOPMARK_SANDBOX_ACCOUNT_TOKEN` (short-lived token for the authorized synthetic enrolled account), and `VITE_LOOPMARK_SUPABASE_ANON_KEY`. Keep server keys in the operator's secret store; no service-role key is needed by these scripts. Clear the short-lived token after the session.

The web probe sends one credentialed GET to Razorpay's fixed payments endpoint using a test-mode key; it discards the body. The native probe reads the exact RevenueCat app and compares its platform/package identity, then reads authenticated Loopmark `billing-config` and checks exact sandbox products and key. Both also send an uncredentialed HEAD to the selected application origin. Redirects and network failure block readiness; exceptions and provider bodies are not logged. These checks do not prove webhook delivery, store availability, entitlement reconciliation or purchase ownership. Endpoint references: [Razorpay payments API](https://github.com/razorpay/markdown-docs/blob/master/api/payments.md), [RevenueCat app API](https://www.revenuecat.com/docs/api-v2/app).

## Evidence required for every external run

Record platform, UTC date, named operator and independent observer, approval reference, exact source commit, artifact SHA-256, installed version/build, OS/device model, provider environment, selected merchant/project/application/product identities, and each scenario's observed outcome. Attach redacted logs/screenshots and their file SHA-256 values using the release checker's evidence manifest. Reference transaction/event IDs through a restricted evidence store; never commit tokens, payment instruments, raw signed receipts, email addresses, full webhook payloads or private craft content.

For each scenario retain three observations: the UI result, durable local state after process restart, and authoritative provider/server state. Record failure or blocked status rather than skipping. A changed binary, identity, domain, plugin, transfer policy or relevant provider setting invalidates affected evidence. The release owner reviews these records; a script cannot grant release approval.

## Real provider sandbox scenarios

Use only operator-authorized test users and payment instruments. Begin with two independently verified accounts, A and B, each with an enrolled device. Preserve a guest collection with drafts and media to detect cross-account leakage. Explicitly select a product and approve each transaction; restarting a test must never automatically charge again.

| Gate | Action and required observation |
| --- | --- |
| Web purchase | Create a test order through the real app, complete official test checkout, deliver the raw signed webhook, and reconcile through an authoritative provider fetch. One durable paid grant appears only for the correct account/product/environment. |
| Native purchase | Use the signed intended store app with a real Apple sandbox tester or Google license tester. Confirm localized price, identified billing principal and non-subscription product. SDK success alone grants nothing; server verification produces the entitlement. |
| Cancellation | Cancel checkout/store sheet. No successful attempt, entitlement or false error is recorded. Existing projects remain usable. |
| Pending | Exercise provider-supported delayed/pending payment. UI remains pending through restart and later resolves from server verification without initiating another charge. |
| Lost reply | Interrupt the client after provider acceptance and before the app receives confirmation. Relaunch and reconcile the same attempt exactly once. |
| Duplicate/out-of-order events | Replay an authorized test webhook, deliver refund before a delayed paid event, and repeat reconciliation. Ledger ordering remains authoritative; no double grant or resurrection. |
| Restore/reinstall | Restore on the same identified account after a qualified reinstall. Retain proof of store ownership and server binding. Local craft data is restored only from a complete export or verified sync, never presumed to come from OS backup. |
| Account mismatch | Purchase under A; switch to B and request restore. No silent transfer, account disclosure or B entitlement. The configured RevenueCat transfer policy must match the reviewed ownership policy. |
| Owner recovery | Exercise the approved provider-verifiable recovery route with expired login/new device. Screenshots, client claims and email similarity cannot prove purchase ownership. A provider limitation blocks this promise before sales. |
| Refund/revocation | Issue an explicitly approved sandbox refund/revocation. Reconcile on every supported platform and offline/online order. New paid capacity stops appropriately; saved projects, history, read/export and recovery remain available. |
| Account deletion | Delete a synthetic paid account after recent authentication. Old sessions and late payment/webhook events cannot revive its account, collection or entitlement projection. The retained billing linkage matches the privacy disclosure. |
| Environment separation | Sandbox purchases/events cannot grant production access; unapproved products, wrong apps/projects and forged/changed webhook bodies fail closed. |

Web, iOS and Android must each have their own result. A RevenueCat Test Store run, local StoreKit configuration, mocked webhook, or emulator button click cannot substitute for real Apple/Google sandbox qualification.

## Physical device checklist

Run on the intended supported iOS and Android versions with the exact signed artifact. Record each item independently; include a lower-memory device and a device with system text enlarged.

- [ ] Fresh install, upgrade from the previous supported app, offline launch, normal save and force-stop/relaunch preserve the correct project/checkpoint/history and immutable media.
- [ ] Camera capture and selected photo import produce readable photos; microphone start/stop/playback produce clear audio. Deny, revoke in Settings, and cancel each permission without losing text or claiming an attachment was saved.
- [ ] Lock the device, receive an interruption and background during recording. Reopen the original draft; preserved audio is playable and not attached to another project/account.
- [ ] Kill during external camera/picker return and during file publication. Verify source-bound pending/ready recovery, explicit confirmation, original draft-revision conflict, and no cross-account attachment. A synthetic restored callback alone does not satisfy this item.
- [ ] Fill storage using test-owned data, then save/import/export. Failure is actionable, the old record remains valid, and retries do not duplicate work. Measure 48 MiB import/export peak memory and startup on physical hardware; simulator results are separate.
- [ ] Share cancel, share success to a test-owned destination, import cancel, corrupt/incomplete backup and boundary-size round trip. Hash every attachment after restore and confirm the source stays intact on failure.
- [ ] Actual OS backup/restore, device-to-device transfer, uninstall/reinstall and device-key loss: excluded private database/media/credentials do not reappear as a falsely authenticated collection. A missing device-bound key requires login. Preserve a complete maker export before destructive test setup.
- [ ] VoiceOver/TalkBack traverse form labels, focus, errors, dialogs and recovery notices. Test enlarged text, contrast, landscape, safe areas, keyboard avoidance, Android Back and screen-reader capture controls.
- [ ] Print current and legacy readable bag labels, scan on each intended device, and check native-to-web continuation, missing record, wrong account, offline and expired-session paths. QR labels are shortcuts; the copy does not imply backup.

## Signing and domain checklist

- [ ] Human owner supplies intended final app identifier, Apple Team/app-ID prefix, Android signing certificate identity, developer accounts and exact HTTPS origin. Development identifiers and local simulator entitlements are not production identities.
- [ ] Create signed installable artifacts using owner-managed credentials outside git. Inspect the final signature, embedded entitlements, distribution profile/package ID, version/build, permission strings, privacy manifests and dependency/license inventory. Record the artifact hash after signing.
- [ ] Generate associations with `scripts/native/links.mjs`; independently compare exact Apple app ID and Android SHA-256 certificate fingerprints. Publishing those files requires the domain owner's authorization.
- [ ] Fetch both associations from the real HTTPS host without redirects, verify OS association diagnostics, then open current project and auth callback links on fresh and upgraded signed installs. Reject wrong host, invalid credentials, changed path and wrong account. Simulator navigation is not signed-link proof.
- [ ] Verify native origins reach the selected backend under the exact CORS policy; inspect that no native HTTP bypass or plaintext credential fallback was introduced.
- [ ] Retest purchase, account switch, camera recovery, backup exclusions and links on the signed build. Finish [store disclosures](store-disclosures.md), privacy/support/deletion endpoints and release-owner approval before submitting or publishing.

Current Android process-kill evidence is limited: killing the app while the system Photo Picker was open dismissed that picker without delivering an image. Relaunch preserved the draft and displayed a waiting interruption notice, which could be explicitly discarded. This is useful recovery evidence, but the physical restored-result item above remains open.
